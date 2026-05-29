const express = require('express');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const db = require('../database/db');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// Log every request that reaches /api/stream/* — visible in Portainer container logs
router.use((req, res, next) => {
  console.log(`[stream] ${req.method} ${req.path} ip=${req.ip} token=${req.query.token ? 'present' : 'missing'}`);
  next();
});

// ─── helpers ──────────────────────────────────────────────────────────────────

function getFilePath(type, id) {
  if (type === 'movie') {
    const row = db.prepare('SELECT file_path FROM movies WHERE id = ?').get(id);
    return row?.file_path || null;
  }
  const row = db.prepare('SELECT file_path FROM episodes WHERE id = ?').get(id);
  return row?.file_path || null;
}

// ─── pre-flight check ─────────────────────────────────────────────────────────

router.get('/check/:type/:id', authenticate, (req, res) => {
  const filePath = getFilePath(req.params.type, req.params.id);
  if (!filePath) return res.json({ ok: false, error: 'Media not found in database' });

  if (!fs.existsSync(filePath)) {
    return res.json({ ok: false, error: `File not found on disk: ${filePath}` });
  }
  try {
    fs.accessSync(filePath, fs.constants.R_OK);
  } catch {
    return res.json({ ok: false, error: `File not readable — check Docker volume permissions: ${filePath}` });
  }

  res.json({ ok: true, filePath: path.basename(filePath), ext: path.extname(filePath).toLowerCase() });
});

// ─── video stream ─────────────────────────────────────────────────────────────
//
// ALL files are transcoded through FFmpeg to H.264 + AAC in a fragmented MP4.
// This handles H.265/HEVC MP4, MKV, AVI, TS — anything the browser can't play
// natively. The browser receives a progressive video/mp4 stream and starts
// playing as soon as the first chunks arrive.
//
// Optional: ?start=SECONDS  restarts the transcode from that position (seeking)

router.get('/video/:type/:id', authenticate, (req, res) => {
  const { type, id } = req.params;
  const filePath = getFilePath(type, id);

  if (!filePath) {
    console.error(`[stream] No file path found for ${type}/${id}`);
    return res.status(404).json({ error: 'Media not found in database' });
  }
  if (!fs.existsSync(filePath)) {
    console.error(`[stream] File not on disk: ${filePath}`);
    return res.status(404).json({ error: `File not found on disk: ${filePath}` });
  }
  try {
    fs.accessSync(filePath, fs.constants.R_OK);
  } catch {
    console.error(`[stream] Permission denied: ${filePath}`);
    return res.status(403).json({ error: `Cannot read file — check Docker volume permissions: ${filePath}` });
  }

  const startSec = Math.max(0, parseFloat(req.query.start || '0') || 0);
  console.log(`[stream] Starting transcode: ${path.basename(filePath)} start=${startSec}s`);

  const ffmpegArgs = [
    '-hide_banner',
    '-loglevel', 'warning',          // 'warning' shows codec issues; 'error' is too quiet
    ...(startSec > 0 ? ['-ss', String(startSec)] : []),
    '-i', filePath,
    // Always re-encode video to H.264 baseline — works in every browser
    // regardless of whether the source is H.264, H.265, VP9, AV1, etc.
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-profile:v', 'baseline',
    '-level', '3.1',
    '-crf', '23',
    '-pix_fmt', 'yuv420p',
    // Always re-encode audio to AAC stereo — handles AC3, DTS, FLAC, etc.
    '-c:a', 'aac',
    '-b:a', '128k',
    '-ac', '2',
    '-ar', '44100',
    // Fragmented MP4 piped to stdout — browser can play progressively
    '-movflags', 'frag_keyframe+empty_moov+faststart',
    '-f', 'mp4',
    'pipe:1',
  ];

  const proc = spawn('ffmpeg', ffmpegArgs, { stdio: ['ignore', 'pipe', 'pipe'] });

  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Accel-Buffering', 'no');

  proc.stdout.pipe(res);

  let ffmpegLog = '';
  proc.stderr.on('data', (chunk) => {
    const txt = chunk.toString();
    ffmpegLog += txt;
    process.stderr.write(`[ffmpeg] ${txt}`);
  });

  proc.on('error', (err) => {
    console.error(`[stream] FFmpeg spawn failed: ${err.message}`);
    if (!res.headersSent) res.status(500).json({ error: `FFmpeg not found: ${err.message}` });
    else res.end();
  });

  proc.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.error(`[stream] FFmpeg exit code ${code} for ${path.basename(filePath)}`);
    } else {
      console.log(`[stream] Transcode done: ${path.basename(filePath)}`);
    }
  });

  req.on('close', () => {
    proc.kill('SIGTERM');
  });
});

// ─── watch progress ───────────────────────────────────────────────────────────

router.post('/progress', authenticate, (req, res) => {
  const { mediaType, mediaId, position, completed } = req.body;
  const existing = db.prepare(
    'SELECT id FROM watch_history WHERE user_id=? AND media_type=? AND media_id=?'
  ).get(req.user.id, mediaType, mediaId);

  if (existing) {
    db.prepare('UPDATE watch_history SET position=?, completed=?, watched_at=CURRENT_TIMESTAMP WHERE id=?')
      .run(position, completed ? 1 : 0, existing.id);
  } else {
    db.prepare('INSERT INTO watch_history (user_id, media_type, media_id, position, completed) VALUES (?,?,?,?,?)')
      .run(req.user.id, mediaType, mediaId, position, completed ? 1 : 0);
  }
  res.json({ success: true });
});

router.get('/progress/:mediaType/:mediaId', authenticate, (req, res) => {
  const row = db.prepare(
    'SELECT position, completed FROM watch_history WHERE user_id=? AND media_type=? AND media_id=?'
  ).get(req.user.id, req.params.mediaType, req.params.mediaId);
  res.json(row || { position: 0, completed: false });
});

module.exports = router;
