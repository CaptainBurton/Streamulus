const express = require('express');
const fs = require('fs');
const path = require('path');
const db = require('../database/db');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

function streamFile(req, res, filePath) {
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });

  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const range = req.headers.range;
  const ext = path.extname(filePath).toLowerCase();

  const mimeTypes = {
    '.mp4': 'video/mp4',
    '.mkv': 'video/x-matroska',
    '.avi': 'video/x-msvideo',
    '.mov': 'video/quicktime',
    '.wmv': 'video/x-ms-wmv',
    '.webm': 'video/webm',
    '.m4v': 'video/mp4',
    '.ts': 'video/mp2t',
    '.flv': 'video/x-flv'
  };
  const contentType = mimeTypes[ext] || 'video/mp4';

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunkSize = end - start + 1;

    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': contentType
    });
    fs.createReadStream(filePath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes'
    });
    fs.createReadStream(filePath).pipe(res);
  }
}

router.get('/movie/:id', authenticate, (req, res) => {
  const movie = db.prepare('SELECT * FROM movies WHERE id = ?').get(req.params.id);
  if (!movie) return res.status(404).json({ error: 'Movie not found' });
  streamFile(req, res, movie.file_path);
});

router.get('/episode/:id', authenticate, (req, res) => {
  const episode = db.prepare('SELECT * FROM episodes WHERE id = ?').get(req.params.id);
  if (!episode) return res.status(404).json({ error: 'Episode not found' });
  streamFile(req, res, episode.file_path);
});

// Save watch progress
router.post('/progress', authenticate, (req, res) => {
  const { mediaType, mediaId, position, completed } = req.body;
  db.prepare(`
    INSERT INTO watch_history (user_id, media_type, media_id, position, completed, watched_at)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT DO NOTHING
  `).run(req.user.id, mediaType, mediaId, position, completed ? 1 : 0);

  db.prepare(`
    UPDATE watch_history SET position = ?, completed = ?, watched_at = CURRENT_TIMESTAMP
    WHERE user_id = ? AND media_type = ? AND media_id = ?
  `).run(position, completed ? 1 : 0, req.user.id, mediaType, mediaId);

  res.json({ success: true });
});

router.get('/progress/:mediaType/:mediaId', authenticate, (req, res) => {
  const row = db.prepare(`
    SELECT position, completed FROM watch_history
    WHERE user_id = ? AND media_type = ? AND media_id = ?
  `).get(req.user.id, req.params.mediaType, req.params.mediaId);
  res.json(row || { position: 0, completed: false });
});

module.exports = router;
