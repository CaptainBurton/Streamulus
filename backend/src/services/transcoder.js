const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');

const HLS_BASE = path.join(os.tmpdir(), 'streamulus-hls');
fs.mkdirSync(HLS_BASE, { recursive: true });

// Active transcode sessions: key → { process, dir, lastAccess, ready, readyPromise }
const sessions = new Map();

// Clean up sessions idle > 30 minutes
setInterval(() => {
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [key, s] of sessions) {
    if (s.lastAccess < cutoff) destroySession(key);
  }
}, 5 * 60 * 1000);

function makeKey(filePath, startTime) {
  return crypto.createHash('sha256')
    .update(`${filePath}:${Math.floor(startTime / 30)}`) // bucket by 30-sec windows
    .digest('hex')
    .slice(0, 24);
}

async function getHLSSession(filePath, startTime = 0) {
  const key = makeKey(filePath, startTime);

  if (sessions.has(key)) {
    const s = sessions.get(key);
    s.lastAccess = Date.now();
    if (!s.ready) await s.readyPromise;
    return key;
  }

  const dir = path.join(HLS_BASE, key);
  fs.mkdirSync(dir, { recursive: true });

  const manifestPath = path.join(dir, 'index.m3u8');

  let resolveReady, rejectReady;
  const readyPromise = new Promise((res, rej) => { resolveReady = res; rejectReady = rej; });

  const session = { dir, lastAccess: Date.now(), ready: false, readyPromise, process: null };
  sessions.set(key, session);

  const ffmpegArgs = [
    '-hide_banner', '-loglevel', 'warning',
    '-ss', String(Math.max(0, startTime)),
    '-i', filePath,
    // Video: H.264, ultrafast for low latency
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-tune', 'zerolatency',
    '-crf', '23',
    '-pix_fmt', 'yuv420p',
    // Force keyframes every 2s for clean seeking
    '-g', '48',
    '-keyint_min', '48',
    '-sc_threshold', '0',
    // Audio: AAC stereo
    '-c:a', 'aac',
    '-b:a', '128k',
    '-ac', '2',
    '-ar', '44100',
    // HLS output
    '-hls_time', '4',
    '-hls_list_size', '0',
    '-hls_segment_type', 'mpegts',
    '-hls_segment_filename', path.join(dir, 'seg%05d.ts'),
    '-hls_flags', 'independent_segments+append_list',
    '-f', 'hls',
    manifestPath,
    '-y'
  ];

  const proc = spawn('ffmpeg', ffmpegArgs, { stdio: ['ignore', 'ignore', 'pipe'] });
  session.process = proc;

  // Wait for first segment to appear (indicates transcode is rolling)
  const checkInterval = setInterval(() => {
    if (fs.existsSync(manifestPath) && fs.statSync(manifestPath).size > 0) {
      clearInterval(checkInterval);
      session.ready = true;
      resolveReady();
    }
  }, 300);

  const startTimeout = setTimeout(() => {
    clearInterval(checkInterval);
    if (!session.ready) {
      rejectReady(new Error('FFmpeg did not produce output in time. Check that ffmpeg is installed.'));
      destroySession(key);
    }
  }, 30000);

  proc.stderr.on('data', (data) => {
    const msg = data.toString();
    if (msg.includes('No such file') || msg.includes('Invalid data') || msg.includes('moov atom not found')) {
      clearInterval(checkInterval);
      clearTimeout(startTimeout);
      if (!session.ready) {
        rejectReady(new Error('FFmpeg error: ' + msg.slice(0, 200)));
        destroySession(key);
      }
    }
  });

  proc.on('error', (err) => {
    clearInterval(checkInterval);
    clearTimeout(startTimeout);
    if (!session.ready) rejectReady(new Error('FFmpeg not found. Make sure ffmpeg is installed in the container.'));
    sessions.delete(key);
  });

  proc.on('exit', (code) => {
    clearInterval(checkInterval);
    clearTimeout(startTimeout);
    if (!session.ready && code !== 0) {
      rejectReady(new Error(`FFmpeg exited with code ${code}`));
      sessions.delete(key);
    } else if (session.ready) {
      // Finished transcoding whole file — keep session for serving segments
    }
  });

  await readyPromise;
  return key;
}

function getManifestContent(key, baseSegmentUrl) {
  const session = sessions.get(key);
  if (!session) return null;
  session.lastAccess = Date.now();

  const manifestPath = path.join(session.dir, 'index.m3u8');
  if (!fs.existsSync(manifestPath)) return null;

  // Rewrite segment filenames to use our API URL (seg param style)
  let content = fs.readFileSync(manifestPath, 'utf8');
  // baseSegmentUrl already has ?key=... appended
  content = content.replace(/^(seg\d+\.ts)$/gm, `${baseSegmentUrl}&seg=$1`);
  return content;
}

async function getSegmentPath(key, segmentName) {
  const session = sessions.get(key);
  if (!session) return null;
  session.lastAccess = Date.now();

  const segPath = path.join(session.dir, segmentName);

  // Wait up to 20s for segment to be written by ffmpeg
  let waited = 0;
  while (!fs.existsSync(segPath) && waited < 20000) {
    await new Promise(r => setTimeout(r, 300));
    waited += 300;
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

// Formats that might play directly without transcoding in modern browsers
const DIRECT_EXTENSIONS = new Set(['.mp4', '.m4v', '.webm']);

function canDirectPlay(filePath) {
  return DIRECT_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

module.exports = { getHLSSession, getManifestContent, getSegmentPath, canDirectPlay };
