const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const db = require('../database/db');

const HLS_BASE = path.join(os.tmpdir(), 'streamulus-hls');
fs.mkdirSync(HLS_BASE, { recursive: true });

// Active transcode sessions: key → { process, dir, lastAccess, ready, readyPromise, precomputedManifest }
const sessions = new Map();

setInterval(() => {
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [key, s] of sessions) {
    if (s.lastAccess < cutoff) destroySession(key);
  }
}, 5 * 60 * 1000);

function makeKey(filePath, startTime) {
  return crypto.createHash('sha256')
    .update(`${filePath}:${Math.floor(startTime / 30)}`)
    .digest('hex')
    .slice(0, 24);
}

function probeFileDuration(filePath) {
  return new Promise((resolve) => {
    const proc = spawn('ffprobe', [
      '-v', 'quiet', '-print_format', 'json', '-show_format', filePath,
    ], { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    proc.stdout.on('data', d => { out += d.toString(); });
    proc.on('error', () => resolve(0));
    proc.on('exit', () => {
      try { resolve(parseFloat(JSON.parse(out).format?.duration) || 0); }
      catch { resolve(0); }
    });
  });
}

function getSettings() {
  const get = (key, fallback) => db.prepare('SELECT value FROM config WHERE key = ?').get(key)?.value ?? fallback;
  return {
    crf: get('video_crf', '23'),
    preset: get('video_preset', 'ultrafast'),
    resolution: get('video_resolution', 'original'),
    audioBitrate: get('audio_bitrate', '192k'),
    audioChannels: get('audio_channels', '2'),
    segmentDuration: parseInt(get('hls_segment_duration', '4')) || 4,
  };
}

function buildVideoFilter(resolution) {
  const even = 'scale=trunc(iw/2)*2:trunc(ih/2)*2';
  const fmt = 'format=yuv420p';
  const limits = {
    '1080': 'scale=1920:1080:force_original_aspect_ratio=decrease',
    '720':  'scale=1280:720:force_original_aspect_ratio=decrease',
    '480':  'scale=854:480:force_original_aspect_ratio=decrease',
  };
  return limits[resolution] ? `${limits[resolution]},${even},${fmt}` : `${even},${fmt}`;
}

// Build FFmpeg args for HLS transcoding into the given output directory.
// Segments are always named seg00000.ts, seg00001.ts, ... within that dir.
// Seek restarts use separate subdirectories so -start_number is not needed.
function buildFfmpegArgs(filePath, startSec, settings, dir) {
  return [
    '-hide_banner', '-loglevel', 'warning',
    '-fflags', '+genpts+discardcorrupt',
    '-err_detect', 'ignore_err',
    ...(startSec > 0 ? ['-ss', String(startSec)] : []),
    '-i', filePath,
    '-map', '0:v:0', '-map', '0:a:0?', '-sn',
    '-c:v', 'libx264',
    '-preset', settings.preset, '-tune', 'zerolatency', '-crf', settings.crf,
    '-profile:v', 'high', '-level:v', '5.1',
    '-pix_fmt', 'yuv420p',
    '-vf', buildVideoFilter(settings.resolution),
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
    '-max_muxing_queue_size', '4096',
    '-g', '48', '-keyint_min', '48', '-sc_threshold', '0',
    '-c:a', 'aac', '-b:a', settings.audioBitrate,
    ...(settings.audioChannels !== 'original' ? ['-ac', settings.audioChannels] : []),
    '-ar', '48000',
    '-hls_time', String(settings.segmentDuration),
    '-hls_list_size', '0',
    '-hls_segment_filename', path.join(dir, 'seg%05d.ts'),
    '-hls_flags', 'independent_segments',
    '-f', 'hls', '-y',
    path.join(dir, 'index.m3u8'),
  ];
}


async function getHLSSession(filePath, startTime = 0) {
  const key = makeKey(filePath, startTime);

  if (sessions.has(key)) {
    const s = sessions.get(key);
    s.lastAccess = Date.now();
    if (!s.ready) await s.readyPromise;
    return key;
  }

  try {
    fs.accessSync(filePath, fs.constants.R_OK);
  } catch {
    throw new Error(`File not readable (check volume mount permissions): ${filePath}`);
  }

  const settings = getSettings();
  const totalDuration = await probeFileDuration(filePath);

  const dir = path.join(HLS_BASE, key);
  fs.mkdirSync(dir, { recursive: true });

  const manifestPath = path.join(dir, 'index.m3u8');

  let resolveReady, rejectReady;
  const readyPromise = new Promise((res, rej) => { resolveReady = res; rejectReady = rej; });

  // seekPoints tracks sub-sessions created by seek restarts.
  // Each entry { fromIdx, dir } maps a range of global segment indices to a
  // local directory where FFmpeg wrote seg00000.ts, seg00001.ts, ...
  // Global segment N → seek point with highest fromIdx ≤ N → local file seg{N-fromIdx}.ts
  const session = { dir, lastAccess: Date.now(), ready: false, readyPromise, process: null, precomputedManifest: null, filePath, startTime, settings, seekPoints: [{ fromIdx: 0, dir }] };

  if (totalDuration > 0) {
    const effectiveDuration = Math.max(1, totalDuration - Math.max(0, startTime));
    const segCount = Math.ceil(effectiveDuration / settings.segmentDuration);
    const lines = [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      `#EXT-X-TARGETDURATION:${settings.segmentDuration}`,
      '#EXT-X-PLAYLIST-TYPE:VOD',
      '#EXT-X-MEDIA-SEQUENCE:0',
    ];
    for (let i = 0; i < segCount; i++) {
      const remaining = effectiveDuration - i * settings.segmentDuration;
      const segDur = i < segCount - 1 ? settings.segmentDuration : Math.min(remaining, settings.segmentDuration);
      lines.push(`#EXTINF:${segDur.toFixed(6)},`);
      lines.push(`seg${String(i).padStart(5, '0')}.ts`);
    }
    lines.push('#EXT-X-ENDLIST');
    session.precomputedManifest = lines.join('\n') + '\n';
  }

  sessions.set(key, session);

  const ffmpegArgs = buildFfmpegArgs(filePath, startTime, settings, dir);

  console.log(`[transcode] Starting FFmpeg for: ${path.basename(filePath)} start=${startTime}s`);
  console.log(`[transcode] Command: ffmpeg ${ffmpegArgs.join(' ')}`);
  const proc = spawn('ffmpeg', ffmpegArgs, { stdio: ['ignore', 'ignore', 'pipe'] });
  session.process = proc;

  let ffmpegOutput = '';
  proc.stderr.on('data', (data) => {
    const msg = data.toString();
    ffmpegOutput += msg;
    // Always print FFmpeg output so it appears in Portainer container logs
    process.stderr.write(`[ffmpeg] ${msg}`);
  });

  // Wait until 2 segments are ready before resolving, so hls.js starts with a
  // buffer cushion and doesn't immediately stall waiting for the second segment.
  // For very short videos (< 2 segments total) we accept 1 segment once FFmpeg
  // has written #EXT-X-ENDLIST, meaning the file is fully transcoded.
  const checkInterval = setInterval(() => {
    if (!fs.existsSync(manifestPath)) return;
    try {
      const content = fs.readFileSync(manifestPath, 'utf8');
      const segCount = (content.match(/#EXTINF/g) || []).length;
      const done = content.includes('#EXT-X-ENDLIST');
      if (segCount >= 2 || (segCount >= 1 && done)) {
        clearInterval(checkInterval);
        clearTimeout(startTimeout);
        session.ready = true;
        console.log(`[transcode] ${segCount} segment(s) ready for: ${path.basename(filePath)} (key=${key.slice(0, 8)})`);
        resolveReady();
      }
    } catch { /* manifest not fully written yet, retry */ }
  }, 250);

  const startTimeout = setTimeout(() => {
    clearInterval(checkInterval);
    if (!session.ready) {
      const detail = ffmpegOutput.slice(-800) || '(no output — is ffmpeg installed?)';
      console.error(`[transcode] Timeout for ${filePath}. FFmpeg output:\n${detail}`);
      rejectReady(new Error(`Transcoding timed out after 90s. FFmpeg output: ${detail.slice(0, 400)}`));
      destroySession(key);
    }
  }, 90000);

  proc.on('error', (err) => {
    clearInterval(checkInterval);
    clearTimeout(startTimeout);
    console.error(`[transcode] Could not spawn FFmpeg: ${err.message}`);
    if (!session.ready) rejectReady(new Error('Could not start FFmpeg. Is ffmpeg installed in the container?'));
    sessions.delete(key);
  });

  proc.on('exit', (code) => {
    clearInterval(checkInterval);
    clearTimeout(startTimeout);
    if (!session.ready) {
      const msg = `FFmpeg exited with code ${code}. Output: ${ffmpegOutput.slice(-300)}`;
      console.error(`[transcode] ${msg}`);
      rejectReady(new Error(msg));
      sessions.delete(key);
    } else {
      console.log(`[transcode] FFmpeg finished transcoding: ${path.basename(filePath)}`);
    }
  });

  await readyPromise;
  return key;
}

function getManifestContent(key, baseSegmentUrl) {
  const session = sessions.get(key);
  if (!session) return null;
  session.lastAccess = Date.now();

  let content;
  if (session.precomputedManifest) {
    content = session.precomputedManifest;
  } else {
    const manifestPath = path.join(session.dir, 'index.m3u8');
    if (!fs.existsSync(manifestPath)) return null;
    content = fs.readFileSync(manifestPath, 'utf8');
  }
  // Rewrite .ts segment lines so browsers fetch them through our auth endpoint
  content = content.replace(/^[^\n#]*?(seg\d{5}\.ts)\s*$/gm, `${baseSegmentUrl}&seg=$1`);
  return content;
}

// Seeks further than this many segments ahead of FFmpeg's current position
// restart FFmpeg immediately. 10 segments = 40s at 4s/seg.
const SEEK_THRESHOLD = 10;

// Map a global segment index to the local file path within the appropriate
// seek sub-session directory. The seek point with the highest fromIdx that
// is still ≤ requestedIdx owns that segment.
function resolveSegPath(session, requestedIdx) {
  let best = null;
  for (const sp of session.seekPoints) {
    if (sp.fromIdx <= requestedIdx && (!best || sp.fromIdx > best.fromIdx)) best = sp;
  }
  if (!best) return null;
  return path.join(best.dir, `seg${String(requestedIdx - best.fromIdx).padStart(5, '0')}.ts`);
}

async function getSegmentPath(key, segmentName) {
  const session = sessions.get(key);
  if (!session) return null;
  session.lastAccess = Date.now();

  if (!/^seg\d{5}\.ts$/.test(segmentName)) return null;
  const requestedIdx = parseInt(segmentName.match(/\d+/)[0], 10);

  // Fast path: file already on disk
  const fastPath = resolveSegPath(session, requestedIdx);
  if (fastPath && fs.existsSync(fastPath)) return fastPath;

  // Find where the current (latest) FFmpeg process has gotten to
  const latestSP = session.seekPoints[session.seekPoints.length - 1];
  let lastLocalIdx = -1;
  try {
    for (const f of fs.readdirSync(latestSP.dir)) {
      const m = f.match(/^seg(\d{5})\.ts$/);
      if (m) { const n = parseInt(m[1], 10); if (n > lastLocalIdx) lastLocalIdx = n; }
    }
  } catch {}
  const lastGlobalIdx = latestSP.fromIdx + lastLocalIdx;

  // Restart FFmpeg when:
  //  a) Forward seek: requested segment is far ahead of what FFmpeg has written
  //  b) Backward seek to a segment the current FFmpeg can never produce (it
  //     started after that segment), e.g. user seeks back past the seek point
  const needsRestart = session.filePath && (
    requestedIdx > lastGlobalIdx + SEEK_THRESHOLD ||
    latestSP.fromIdx > requestedIdx
  );

  if (needsRestart) {
    const seekSec = session.startTime + requestedIdx * session.settings.segmentDuration;
    // Each seek gets its own subdirectory so segments are always named from
    // seg00000.ts — no need for FFmpeg's -start_number option.
    const seekDir = path.join(session.dir, `seek_${requestedIdx}`);
    fs.mkdirSync(seekDir, { recursive: true });
    console.log(`[transcode] Seek: t=${seekSec}s → seg${String(requestedIdx).padStart(5,'0')} (prev lastGlobal=${lastGlobalIdx})`);
    if (session.process) { try { session.process.kill('SIGTERM'); } catch {} session.process = null; }
    session.seekPoints.push({ fromIdx: requestedIdx, dir: seekDir });
    const proc = spawn('ffmpeg',
      buildFfmpegArgs(session.filePath, seekSec, session.settings, seekDir),
      { stdio: ['ignore', 'ignore', 'pipe'] });
    session.process = proc;
    proc.stderr.on('data', d => process.stderr.write(`[ffmpeg] ${d}`));
    proc.on('error', err => console.error(`[transcode] seek spawn error: ${err.message}`));
    proc.on('exit', code => { if (code) console.error(`[transcode] seek FFmpeg exit ${code}`); });
  }

  // Wait up to 30s for FFmpeg to write the segment
  const segPath = resolveSegPath(session, requestedIdx);
  if (!segPath) return null;
  let waited = 0;
  while (!fs.existsSync(segPath) && waited < 30000) {
    await new Promise(r => setTimeout(r, 250));
    waited += 250;
  }
  return fs.existsSync(segPath) ? segPath : null;
}

function destroySession(key) {
  const session = sessions.get(key);
  if (!session) return;
  try { session.process?.kill('SIGTERM'); } catch {}
  try { fs.rmSync(session.dir, { recursive: true, force: true }); } catch {}
  sessions.delete(key);
}

const DIRECT_EXTENSIONS = new Set(['.mp4', '.m4v', '.webm']);
function canDirectPlay(filePath) {
  return DIRECT_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

module.exports = { getHLSSession, getManifestContent, getSegmentPath, canDirectPlay };
