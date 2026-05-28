const express = require('express');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const db = require('../database/db');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// ─── helpers ──────────────────────────────────────────────────────────────────

function getFilePath(type, id) {
  if (type === 'movie') {
    const row = db.prepare('SELECT file_path FROM movies WHERE id = ?').get(id);
    return row?.file_path || null;
  }
  const row = db.prepare('SELECT file_path FROM episodes WHERE id = ?').get(id);
  return row?.file_path || null;
}

const DIRECT_EXTENSIONS = new Set(['.mp4', '.m4v', '.webm']);
function canDirectPlay(filePath) {
  return DIRECT_EXTENSIONS.has(path.extname(filePath).toLowerCase());
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

  const stat = fs.statSync(filePath);
  res.json({
    ok: true,
    filePath: path.basename(filePath),
    ext: path.extname(filePath).toLowerCase(),
    size: stat.size,
    canDirectPlay: canDirectPlay(filePath),
  });
});

// ─── direct stream (MP4 / WebM — native browser formats) ─────────────────────

router.get('/direct/:type/:id', authenticate, (req, res) => {
  const filePath = getFilePath(req.params.type, req.params.id);
  if (!filePath || !fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }

  const stat = fs.statSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const mime = ext === '.webm' ? 'video/webm' : 'video/mp4';
  const range = req.headers.range;

  if (range) {
    const [startStr, endStr] = range.replace(/bytes=/, '').split('-');
    const start = parseInt(startStr, 10);
    const end = endStr ? Math.min(parseInt(endStr, 10), stat.size - 1) : stat.size - 1;
    const chunkSize = end - start + 1;

    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': mime,
    });
    fs.createReadStream(filePath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': stat.size,
      'Content-Type': mime,
      'Accept-Ranges': 'bytes',
    });
    fs.createReadStream(filePath).pipe(res);
  }
});

// ─── transcoding stream (MKV / AVI / anything non-native) ────────────────────
//
// FFmpeg transcodes to a fragmented MP4 piped directly to the HTTP response.
// The browser plays it progressively as chunks arrive — no temp files, no HLS.
// Optional ?start=SECONDS for seeking to a position before transcoding begins.

router.get('/transcode/:type/:id', authenticate, (req, res) => {
  const filePath = getFilePath(req.params.type, req.params.id);

  if (!filePath) {
    return res.status(404).json({ error: 'Media not found in database' });
  }
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: `File not found on disk: ${filePath}` });
  }
  try {
    fs.accessSync(filePath, fs.constants.R_OK);
  } catch {
    return res.status(403).json({ error: `Cannot read file (check volume permissions): ${filePath}` });
  }

  const startSec = parseFloat(req.query.start || '0') || 0;

  const ffmpegArgs = [
    '-hide_banner',
    '-loglevel', 'error',
    ...(startSec > 0 ? ['-ss', String(startSec)] : []),
    '-i', filePath,
    // Video: re-encode to H.264 baseline (broadest browser support)
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-tune', 'zerolatency',
    '-profile:v', 'baseline',
    '-level', '3.1',
    '-crf', '23',
    '-pix_fmt', 'yuv420p',
    // Audio: AAC stereo
    '-c:a', 'aac',
    '-b:a', '128k',
    '-ac', '2',
    '-ar', '44100',
    // Output: fragmented MP4 piped to stdout
    '-movflags', 'frag_keyframe+empty_moov+faststart',
    '-f', 'mp4',
    'pipe:1',
  ];

  console.log(`[stream] Transcoding: ${path.basename(filePath)}${startSec > 0 ? ` from ${startSec}s` : ''}`);

  const proc = spawn('ffmpeg', ffmpegArgs, { stdio: ['ignore', 'pipe', 'pipe'] });

  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Accel-Buffering', 'no');   // disable nginx buffering if behind a proxy

  // Pipe FFmpeg stdout directly to the HTTP response
  proc.stdout.pipe(res);

  // Print all FFmpeg output to container stderr (visible in Portainer logs)
  proc.stderr.on('data', (chunk) => {
    process.stderr.write(`[ffmpeg] ${chunk.toString()}`);
  });

  proc.on('error', (err) => {
    console.error(`[stream] Failed to start FFmpeg: ${err.message}`);
    if (!res.headersSent) res.status(500).json({ error: `FFmpeg not found: ${err.message}` });
    else res.end();
  });

  proc.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.error(`[stream] FFmpeg exited with code ${code} for: ${path.basename(filePath)}`);
    } else {
      console.log(`[stream] Transcode done: ${path.basename(filePath)}`);
    }
  });

  // Kill FFmpeg when client disconnects (prevents runaway processes)
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
