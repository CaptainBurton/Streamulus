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
  const cutoff = Date.now() - 120 * 60 * 1000;
  for (const [key, s] of sessions) {
    if (s.lastAccess < cutoff) destroySession(key);
  }
}, 5 * 60 * 1000);

// Stop FFmpeg for sessions nobody is reading from (player closed, paused for a
// while, or replaced by a new session after a seek). Without this, every
// abandoned session kept transcoding to the end of the file at full CPU — on a
// long movie that is an hour of work per skip, which starves the transcode the
// viewer is actually watching. A paused session resumes on its next request.
const IDLE_PAUSE_MS = 60 * 1000;
setInterval(() => pauseIdleSessions(IDLE_PAUSE_MS), 10 * 1000);

function pauseIdleSessions(maxIdleMs) {
  const cutoff = Date.now() - maxIdleMs;
  for (const s of sessions.values()) {
    if (s.process && s.lastAccess < cutoff) pauseSession(s, 'idle');
  }
}

// Kill the session's FFmpeg without marking it finished; getSegmentPath
// restarts it at the requested segment if the player asks for more.
function pauseSession(session, reason) {
  const proc = session.process;
  if (!proc) return;
  session.process = null; // exit handlers ignore processes that are no longer current
  try { proc.kill('SIGTERM'); } catch {}
  console.log(`[transcode] Paused (${reason}): ${path.basename(session.filePath)} start=${session.startTime}s`);
}

function makeKey(filePath, startTime) {
  return crypto.createHash('sha256')
    .update(`${filePath}:${Math.floor(startTime / 30)}`)
    .digest('hex')
    .slice(0, 24);
}

function runProbe(args) {
  return new Promise((resolve) => {
    const proc = spawn('ffprobe', args, { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    proc.stdout.on('data', d => { out += d.toString(); });
    proc.on('error', () => resolve(''));
    proc.on('exit', () => resolve(out));
  });
}

const EMPTY_PROBE = { duration: 0, vCodec: null, aCodec: null, video: null, audio: null };

async function probeFile(filePath) {
  const out = await runProbe(['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', filePath]);
  try {
    const parsed = JSON.parse(out);
    const duration = parseFloat(parsed.format?.duration) || 0;
    const streams = parsed.streams || [];
    // Skip embedded cover art: MKV/MP4 files often carry the poster as a
    // one-frame "video" stream, sometimes listed before the film itself.
    const IMAGE_CODECS = ['mjpeg', 'png', 'bmp', 'gif', 'webp'];
    const videos = streams.filter(s => s.codec_type === 'video' && !s.disposition?.attached_pic);
    const video = videos.find(s => !IMAGE_CODECS.includes(s.codec_name)) || videos[0] || null;
    const audio = streams.find(s => s.codec_type === 'audio') || null;
    return { duration, vCodec: video?.codec_name || null, aCodec: audio?.codec_name || null, video, audio };
  } catch { return EMPTY_PROBE; }
}

// Longest gap between keyframes in two short samples (start and middle of the
// file). Reads packet headers only — no decoding.
async function maxKeyframeGap(filePath, streamIndex, duration) {
  const intervals = ['%+20'];
  if (duration > 120) intervals.push(`${Math.floor(duration / 2)}%+20`);
  const out = await runProbe([
    '-v', 'quiet', '-select_streams', String(streamIndex),
    '-read_intervals', intervals.join(','),
    '-show_entries', 'packet=pts_time,flags', '-of', 'csv=p=0', filePath,
  ]);
  let maxGap = 0, keyframes = 0, last = null;
  for (const line of out.split('\n')) {
    const [pts, flags] = line.trim().split(',');
    const t = parseFloat(pts);
    if (!flags || !flags.includes('K') || isNaN(t)) continue;
    keyframes++;
    // A jump backwards or far forward is the start of the second sample.
    if (last !== null && t > last && t - last < 25) maxGap = Math.max(maxGap, t - last);
    last = t;
  }
  return keyframes >= 2 ? maxGap : Infinity;
}

// Whether the source video can go into the HLS stream as-is. Apple TV and
// Safari only decode 8-bit 4:2:0 progressive H.264 (High profile at most), and
// the playlist lists one segment every `segmentDuration` seconds from the
// start, which only matches what FFmpeg writes when it can cut there — i.e.
// when there is a keyframe at least that often. Many movie encodes only have
// one every ~10 s (x264's default), so copying them gave a playlist whose
// segments didn't match their contents and Apple TV refused to play
// ("CoreMediaErrorDomain error -12971").
const copyCache = new Map(); // filePath → { mtimeMs, copy, reason }
async function canCopyVideo(filePath, video, duration, segmentDuration) {
  if (!video || video.codec_name !== 'h264') return { copy: false, reason: `codec ${video?.codec_name || 'none'}` };
  const pixFmt = video.pix_fmt || '';
  if (pixFmt && !['yuv420p', 'yuvj420p'].includes(pixFmt)) return { copy: false, reason: `pixel format ${pixFmt}` };
  const profile = (video.profile || '').toLowerCase();
  if (profile && !['baseline', 'constrained baseline', 'main', 'high'].includes(profile)) return { copy: false, reason: `profile ${video.profile}` };
  if (video.level > 52) return { copy: false, reason: `level ${video.level}` };
  if (['tt', 'bb', 'tb', 'bt'].includes(video.field_order)) return { copy: false, reason: 'interlaced' };

  let mtimeMs = 0;
  try { mtimeMs = fs.statSync(filePath).mtimeMs; } catch {}
  const cached = copyCache.get(filePath);
  if (cached && cached.mtimeMs === mtimeMs) return cached;
  const gap = await maxKeyframeGap(filePath, video.index, duration);
  const result = gap <= segmentDuration + 0.1
    ? { mtimeMs, copy: true, reason: `keyframes every ≤${gap.toFixed(1)}s` }
    : { mtimeMs, copy: false, reason: `keyframes up to ${isFinite(gap) ? gap.toFixed(1) + 's' : '?'} apart` };
  copyCache.set(filePath, result);
  return result;
}

// AAC (LC or HE) in up to 5.1 channels plays everywhere, so it can be copied.
function canCopyAudio(audio) {
  if (!audio || audio.codec_name !== 'aac') return false;
  if ((audio.channels || 2) > 6) return false;
  return !audio.profile || ['lc', 'he-aac', 'he-aacv2'].includes(audio.profile.toLowerCase());
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

function buildVideoFilter(resolution, deinterlace) {
  const even = 'scale=trunc(iw/2)*2:trunc(ih/2)*2';
  const fmt = 'format=yuv420p';
  const limits = {
    '1080': 'scale=1920:1080:force_original_aspect_ratio=decrease',
    '720':  'scale=1280:720:force_original_aspect_ratio=decrease',
    '480':  'scale=854:480:force_original_aspect_ratio=decrease',
  };
  const filters = [
    ...(deinterlace ? ['yadif'] : []),
    ...(limits[resolution] ? [limits[resolution]] : []),
    even, fmt,
  ];
  return filters.join(',');
}

// media (from getHLSSession):
//   copyMode   — the source video can be copied as-is (see canCopyVideo)
//   audioCopy  — the source audio is AAC that can be copied as-is
//   vMap/aMap  — FFmpeg -map specifiers for the film's video and audio streams
//   deinterlace, audioMaxChannels
function buildFfmpegArgs(filePath, startSec, settings, dir, outputTsOffset = 0, media = {}) {
  const { copyMode = false, audioCopy = false, vMap = '0:v:0', aMap = '0:a:0?', deinterlace = false, audioMaxChannels = 0 } = media;
  // "Original" channels still has to fit AAC in HLS: at most 5.1.
  const channels = settings.audioChannels !== 'original'
    ? settings.audioChannels
    : (audioMaxChannels > 6 ? '6' : null);
  return [
    '-hide_banner', '-loglevel', 'warning',
    '-fflags', '+genpts+discardcorrupt',
    '-err_detect', 'ignore_err',
    '-avoid_negative_ts', 'make_zero',
    ...(startSec > 0 ? ['-ss', String(startSec)] : []),
    '-i', filePath,
    '-map', vMap, '-map', aMap, '-sn', '-dn',
    ...(copyMode ? [
      '-c:v', 'copy',
    ] : [
      '-c:v', 'libx264',
      '-preset', settings.preset, '-crf', settings.crf,
      '-threads', '0',
      '-profile:v', 'high', '-level:v', '5.1',
      '-pix_fmt', 'yuv420p',
      '-vf', buildVideoFilter(settings.resolution, deinterlace),
      '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
      // Force keyframes at exact segment boundaries regardless of source framerate.
      // -g/-keyint_min depends on fps (e.g. -g 120 at 24fps = 5s GOPs, wrong for 4s segments).
      '-force_key_frames', `expr:gte(t,n_forced*${settings.segmentDuration})`,
      '-sc_threshold', '0',
    ]),
    '-max_muxing_queue_size', '4096',
    ...(audioCopy ? [
      '-c:a', 'copy',
    ] : [
      '-c:a', 'aac', '-b:a', settings.audioBitrate,
      ...(channels ? ['-ac', channels] : []),
      '-ar', '48000',
    ]),
    ...(outputTsOffset > 0 ? ['-output_ts_offset', String(outputTsOffset)] : []),
    '-hls_time', String(settings.segmentDuration),
    '-hls_list_size', '0',
    '-hls_segment_filename', path.join(dir, 'seg%05d.ts'),
    // temp_file: write each segment as segNNNNN.ts.tmp and rename it when complete.
    // Without it the .ts file exists from its first byte, so a segment still being
    // encoded was served half-written (often 0 bytes) right after start-up and
    // every seek, which made the player stall and re-request.
    '-hls_flags', 'independent_segments+temp_file',
    '-f', 'hls', '-y',
    path.join(dir, 'index.m3u8'),
  ];
}


// Number of HLS segments that must be written to disk before the manifest is
// returned. One is enough: the manifest already lists every segment (the
// precomputed VOD manifest), and requests for segments that aren't written yet
// wait in getSegmentPath until FFmpeg produces them. Waiting for more only
// delayed the first frame (3 × 4 s segments = 12 s of video encoded up front).
const INITIAL_SEGMENT_BUFFER = 1;

// compat: always re-encode (H.264 + AAC) — the Apple TV app asks for this when
// a stream fails to play, in case copying the source was the problem.
async function getHLSSession(filePath, startTime = 0, { compat = false } = {}) {
  const key = makeKey(compat ? `${filePath}#compat` : filePath, startTime);

  // A new stream of this file (the player seeked somewhere outside its current
  // stream, or reopened it) — stop transcoding for its other streams.
  const pauseOthers = (keep) => {
    for (const other of sessions.values()) {
      if (other !== keep && other.filePath === filePath) pauseSession(other, 'replaced');
    }
  };

  if (sessions.has(key)) {
    const s = sessions.get(key);
    s.lastAccess = Date.now();
    pauseOthers(s);
    if (!s.ready) await s.readyPromise;
    return key;
  }

  try {
    fs.accessSync(filePath, fs.constants.R_OK);
  } catch {
    throw new Error(`File not readable (check volume mount permissions): ${filePath}`);
  }

  const settings = getSettings();
  const { duration: totalDuration, vCodec, aCodec, video, audio } = await probeFile(filePath);
  require('./durations').recordDuration(filePath, totalDuration); // for "Ends at" times
  // Copy mode: if the source is H.264 the player can take as-is, skip video
  // re-encoding (10-50x faster segment generation).
  const copyCheck = compat ? { copy: false, reason: 'compatibility mode' }
    : await canCopyVideo(filePath, video, totalDuration, settings.segmentDuration);
  const copyMode = copyCheck.copy;
  // Only copy audio when both video AND audio can be passthrough.
  const audioCopy = copyMode && canCopyAudio(audio);
  const media = {
    copyMode, audioCopy,
    vMap: video ? `0:${video.index}` : '0:v:0',
    aMap: audio ? `0:${audio.index}` : '0:a:0?',
    deinterlace: ['tt', 'bb', 'tb', 'bt'].includes(video?.field_order),
    audioMaxChannels: audio?.channels || 0,
  };
  console.log(`[transcode] ${copyMode ? 'Copy' : 'Transcode'} mode (${copyCheck.reason}): ${path.basename(filePath)} video=${vCodec} audio=${aCodec} audioCopy=${audioCopy}`);

  const dir = path.join(HLS_BASE, key);
  fs.mkdirSync(dir, { recursive: true });

  const manifestPath = path.join(dir, 'index.m3u8');

  let resolveReady, rejectReady;
  const readyPromise = new Promise((res, rej) => { resolveReady = res; rejectReady = rej; });

  // seekPoints tracks sub-sessions created by seek restarts.
  // Each entry { fromIdx, dir } maps a range of global segment indices to a
  // local directory where FFmpeg wrote seg00000.ts, seg00001.ts, ...
  // Global segment N → seek point with highest fromIdx ≤ N → local file seg{N-fromIdx}.ts
  const session = { dir, lastAccess: Date.now(), ready: false, readyPromise, process: null, precomputedManifest: null, filePath, startTime, totalDuration, settings, copyMode, audioCopy, media, ffmpegDone: false, seekPoints: [{ fromIdx: 0, dir }] };

  // Precompute a VOD manifest so Safari and Apple TV see a scrubber instead of
  // a "Live" badge from the very first request.  Copy mode uses approximate
  // segment durations (all equal to segmentDuration) because actual
  // keyframe-aligned boundaries aren't known upfront; the proc.on('exit')
  // handler below upgrades precomputedManifest to the accurate FFmpeg manifest
  // once encoding is complete.
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
  pauseOthers(session);

  const ffmpegArgs = buildFfmpegArgs(filePath, startTime, settings, dir, 0, media);

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

  // Wait for INITIAL_SEGMENT_BUFFER segments before resolving so the player
  // has a comfortable head start over the real-time transcoder.
  const markReady = (segCount) => {
    if (session.ready) return;
    session.ready = true;
    console.log(`[transcode] Ready (${segCount} segment(s) buffered): ${path.basename(filePath)} key=${key.slice(0, 8)}`);
    resolveReady();
  };

  const checkInterval = setInterval(() => {
    if (!fs.existsSync(manifestPath)) return;
    try {
      const content = fs.readFileSync(manifestPath, 'utf8');
      const segCount = (content.match(/#EXTINF/g) || []).length;
      if (segCount >= INITIAL_SEGMENT_BUFFER) {
        clearInterval(checkInterval);
        clearTimeout(startTimeout);
        markReady(segCount);
      }
    } catch { /* manifest not fully written yet, retry */ }
  }, 100);

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
    // Stopped on purpose (paused, or replaced by a seek restart) — that is not
    // "finished". Marking it done here made the request waiting for the new
    // FFmpeg's first segment give up at once, so every skip ahead 404'd and the
    // player sat in retry back-off.
    if (session.process !== proc) {
      if (!session.ready) {
        rejectReady(new Error('Transcode was stopped before it was ready'));
        sessions.delete(key);
      }
      return;
    }
    session.process = null;
    session.ffmpegDone = true;

    // For copy mode, replace the approximate precomputed manifest (uniform 4 s
    // durations) with the accurate one FFmpeg just finished writing — correct
    // #EXTINF durations and a real segment count mean the scrubber maps correctly.
    if (session.copyMode && code === 0 && fs.existsSync(manifestPath)) {
      try {
        let accurate = fs.readFileSync(manifestPath, 'utf8');
        if (!accurate.includes('#EXT-X-ENDLIST')) accurate += '#EXT-X-ENDLIST\n';
        accurate = accurate.replace(/(#EXT-X-VERSION:\d+\n)/, '$1#EXT-X-PLAYLIST-TYPE:VOD\n');
        session.precomputedManifest = accurate;
        console.log(`[transcode] Upgraded copy-mode manifest to accurate VOD: ${path.basename(filePath)}`);
      } catch {}
    }

    if (!session.ready) {
      // FFmpeg finished before INITIAL_SEGMENT_BUFFER segments were written.
      // This is normal for very short clips — resolve with whatever was written
      // (≥1 segment), or reject if FFmpeg produced nothing.
      try {
        const content = fs.existsSync(manifestPath) ? fs.readFileSync(manifestPath, 'utf8') : '';
        const segCount = (content.match(/#EXTINF/g) || []).length;
        if (code === 0 && segCount >= 1) {
          markReady(segCount);
          return;
        }
      } catch {}
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

    // Copy-mode: FFmpeg writes a "live" manifest with no #EXT-X-PLAYLIST-TYPE.
    // Safari treats that as a live stream — no scrubber, AirPlay shows "Live".
    // Inject EVENT while FFmpeg is still running, then upgrade to VOD+ENDLIST
    // once encoding is complete so the scrubber and AirPlay timer work correctly.
    if (!content.includes('#EXT-X-PLAYLIST-TYPE')) {
      if (session.ffmpegDone) {
        let vod = content;
        if (!vod.includes('#EXT-X-ENDLIST')) vod += '#EXT-X-ENDLIST\n';
        vod = vod.replace(/(#EXT-X-VERSION:\d+\n)/, '$1#EXT-X-PLAYLIST-TYPE:VOD\n');
        session.precomputedManifest = vod;
        content = vod;
      } else {
        content = content.replace(/(#EXT-X-VERSION:\d+\n)/, '$1#EXT-X-PLAYLIST-TYPE:EVENT\n');
      }
    }
  }
  // Rewrite .ts segment lines so browsers fetch them through our auth endpoint
  content = content.replace(/^[^\n#]*?(seg\d{5}\.ts)\s*$/gm, `${baseSegmentUrl}&seg=$1`);
  return content;
}

// How far ahead (in segments) of FFmpeg's current write position a seek request
// must be before we restart FFmpeg at the new position.
// Copy mode (H.264 passthrough) produces segments at 10–50× real-time, so
// waiting for up to 25 segments is cheap (~2 s at 50× speed).
// Transcode mode (libx264) runs at ~2× real-time; waiting for more than 5
// segments would mean a 10 s stall — restart instead.
const SEEK_THRESHOLD_COPY = 25;
const SEEK_THRESHOLD_TRANSCODE = 5;

// Map a global segment index to the local file path within the appropriate
// seek sub-session directory. The seek point with the highest fromIdx that
// is still ≤ requestedIdx owns that segment.
function resolveSegPath(session, requestedIdx) {
  let best = null;
  for (const sp of session.seekPoints) {
    // >= so a later restart at the same index wins over an earlier one
    if (sp.fromIdx <= requestedIdx && (!best || sp.fromIdx >= best.fromIdx)) best = sp;
  }
  if (!best) return null;
  return path.join(best.dir, `seg${String(requestedIdx - best.fromIdx).padStart(5, '0')}.ts`);
}

// A segment is complete once FFmpeg lists it in its playlist. FFmpeg creates the
// .ts file at the start and fills it as it encodes, so "file exists" is not
// enough — that served half-written segments (often 0 bytes). temp_file avoids
// it on newer FFmpeg builds; this check works on every build.
function isSegmentComplete(segPath) {
  if (!fs.existsSync(segPath)) return false;
  try {
    const list = fs.readFileSync(path.join(path.dirname(segPath), 'index.m3u8'), 'utf8');
    return list.split('\n').some(line => line.trim() === path.basename(segPath));
  } catch { return false; }
}

async function getSegmentPath(key, segmentName) {
  const session = sessions.get(key);
  if (!session) return null;
  session.lastAccess = Date.now();

  if (!/^seg\d{5}\.ts$/.test(segmentName)) return null;
  const requestedIdx = parseInt(segmentName.match(/\d+/)[0], 10);

  // Fast path: file already on disk
  const fastPath = resolveSegPath(session, requestedIdx);
  if (fastPath && isSegmentComplete(fastPath)) return fastPath;

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
  //  c) Nothing is transcoding (paused when idle or replaced) and the segment
  //     isn't on disk — resume from the segment being asked for.
  const seekThreshold = session.copyMode ? SEEK_THRESHOLD_COPY : SEEK_THRESHOLD_TRANSCODE;
  const needsRestart = session.filePath && (
    requestedIdx > lastGlobalIdx + seekThreshold ||
    latestSP.fromIdx > requestedIdx ||
    (!session.process && !session.ffmpegDone)
  );

  if (needsRestart) {
    const seekSec = session.startTime + requestedIdx * session.settings.segmentDuration;
    if (session.totalDuration > 0 && seekSec >= session.totalDuration) return null;
    // Each restart gets its own subdirectory so segments are always named from
    // seg00000.ts — no need for FFmpeg's -start_number option. Unique per
    // restart so returning to an earlier position never rewrites files that an
    // older playlist already lists as complete.
    const seekDir = path.join(session.dir, `seek_${requestedIdx}_${Date.now()}`);
    fs.mkdirSync(seekDir, { recursive: true });
    console.log(`[transcode] Seek: t=${seekSec}s → seg${String(requestedIdx).padStart(5,'0')} (prev lastGlobal=${lastGlobalIdx})`);
    pauseSession(session, 'seek');
    session.seekPoints.push({ fromIdx: requestedIdx, dir: seekDir });
    session.ffmpegDone = false;
    // Timestamps must match the player's timeline, which starts at 0 where this
    // session started (the initial FFmpeg's output starts at 0) — not the file's
    // own time. Using seekSec put every skip in a resumed stream off by the
    // resume position, so the player stalled waiting for the right timestamps.
    const tsOffset = requestedIdx * session.settings.segmentDuration;
    const proc = spawn('ffmpeg',
      buildFfmpegArgs(session.filePath, seekSec, session.settings, seekDir, tsOffset, session.media),
      { stdio: ['ignore', 'ignore', 'pipe'] });
    session.process = proc;
    proc.stderr.on('data', d => process.stderr.write(`[ffmpeg] ${d}`));
    proc.on('error', err => console.error(`[transcode] seek spawn error: ${err.message}`));
    proc.on('exit', code => {
      if (session.process !== proc) return; // stopped on purpose — not finished
      session.process = null;
      session.ffmpegDone = true;
      if (code) console.error(`[transcode] seek FFmpeg exit ${code}`);
    });
  }

  // Wait up to 30s for FFmpeg to write the segment
  const segPath = resolveSegPath(session, requestedIdx);
  if (!segPath) return null;
  let waited = 0;
  while (!isSegmentComplete(segPath) && waited < 30000) {
    if (session.ffmpegDone) break;
    session.lastAccess = Date.now(); // a waiting request means the session is in use
    await new Promise(r => setTimeout(r, 100));
    waited += 100;
  }
  return isSegmentComplete(segPath) ? segPath : null;
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

function getSessionTotalDuration(key) {
  return sessions.get(key)?.totalDuration ?? 0;
}

module.exports = { getHLSSession, getManifestContent, getSegmentPath, canDirectPlay, getSessionTotalDuration, pauseIdleSessions };
