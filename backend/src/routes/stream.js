const express = require('express');
const fs = require('fs');
const path = require('path');
const db = require('../database/db');
const { authenticate } = require('../middleware/auth');
const { getHLSSession, getManifestContent, getSegmentPath, canDirectPlay } = require('../services/transcoder');

const router = express.Router();

function getFilePath(type, id) {
  if (type === 'movie') {
    const row = db.prepare('SELECT file_path FROM movies WHERE id = ?').get(id);
    return row?.file_path || null;
  }
  const row = db.prepare('SELECT file_path FROM episodes WHERE id = ?').get(id);
  return row?.file_path || null;
}

// Diagnostic endpoint — checks file accessibility before player tries anything
router.get('/check/:type/:id', authenticate, (req, res) => {
  const filePath = getFilePath(req.params.type, req.params.id);
  if (!filePath) return res.json({ ok: false, error: 'Media not found in database' });

  const exists = fs.existsSync(filePath);
  if (!exists) return res.json({ ok: false, error: `File not found on disk: ${filePath}` });

  try {
    fs.accessSync(filePath, fs.constants.R_OK);
  } catch {
    return res.json({ ok: false, error: `File exists but is not readable (permissions issue): ${filePath}` });
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

// HLS manifest — authenticated; starts or reuses a transcode session
router.get('/hls/:type/:id/index.m3u8', authenticate, async (req, res) => {
  const { type, id } = req.params;
  const startTime = parseFloat(req.query.start || '0');
  const token = req.query.token || req.headers.authorization?.split(' ')[1] || '';

  const filePath = getFilePath(type, id);
  if (!filePath) return res.status(404).json({ error: 'Media not found in database' });
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: `File not found on disk: ${filePath}` });

  try {
    fs.accessSync(filePath, fs.constants.R_OK);
  } catch {
    return res.status(403).json({ error: `File not readable — check that your media volume is mounted with read permissions` });
  }

  try {
    const key = await getHLSSession(filePath, startTime);
    // Token is embedded in the segment URL so HLS.js can fetch segments without custom headers
    const baseSegmentUrl = `/api/stream/hls/${type}/${id}/seg?token=${token}&key=${key}`;
    const manifest = getManifestContent(key, baseSegmentUrl);

    if (!manifest) return res.status(500).json({ error: 'Manifest not ready' });

    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Cache-Control', 'no-cache');
    res.send(manifest);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// HLS segment — validated by session key only (no JWT needed; key is a secret per-session token)
router.get('/hls/:type/:id/seg', authenticate, async (req, res) => {
  const { key, seg } = req.query;
  if (!key || !seg) return res.status(400).json({ error: 'key and seg required' });

  const segPath = await getSegmentPath(key, seg);
  if (!segPath) return res.status(404).json({ error: 'Segment not found or session expired' });

  res.setHeader('Content-Type', 'video/mp2t');
  res.setHeader('Cache-Control', 'max-age=3600');
  fs.createReadStream(segPath).pipe(res);
});

// Direct stream — HTTP range-request passthrough for MP4/WebM
router.get('/direct/:type/:id', authenticate, (req, res) => {
  const filePath = getFilePath(req.params.type, req.params.id);
  if (!filePath) return res.status(404).json({ error: 'Not found' });
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found on disk' });

  const stat = fs.statSync(filePath);
  const range = req.headers.range;

  if (range) {
    const [startStr, endStr] = range.replace(/bytes=/, '').split('-');
    const start = parseInt(startStr, 10);
    const end = endStr ? parseInt(endStr, 10) : stat.size - 1;
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': end - start + 1,
      'Content-Type': 'video/mp4',
    });
    fs.createReadStream(filePath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': stat.size,
      'Content-Type': 'video/mp4',
      'Accept-Ranges': 'bytes',
    });
    fs.createReadStream(filePath).pipe(res);
  }
});

// Info endpoint
router.get('/info/:type/:id', authenticate, (req, res) => {
  const filePath = getFilePath(req.params.type, req.params.id);
  if (!filePath) return res.status(404).json({ error: 'Not found' });
  const exists = fs.existsSync(filePath);
  res.json({
    exists,
    filePath: path.basename(filePath),
    ext: path.extname(filePath).toLowerCase(),
    canDirectPlay: exists && canDirectPlay(filePath),
  });
});

// Save watch progress
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

// Get watch progress
router.get('/progress/:mediaType/:mediaId', authenticate, (req, res) => {
  const row = db.prepare(
    'SELECT position, completed FROM watch_history WHERE user_id=? AND media_type=? AND media_id=?'
  ).get(req.user.id, req.params.mediaType, req.params.mediaId);
  res.json(row || { position: 0, completed: false });
});

module.exports = router;
