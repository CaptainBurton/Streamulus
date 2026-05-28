const express = require('express');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const db = require('../database/db');
const { requireAdmin } = require('../middleware/auth');
const { scanAllWithProgress, validatePath } = require('../services/scanner');

const router = express.Router();

router.get('/stats', requireAdmin, (req, res) => {
  const movieCount = db.prepare('SELECT COUNT(*) as count FROM movies').get().count;
  const showCount = db.prepare('SELECT COUNT(*) as count FROM tv_shows').get().count;
  const episodeCount = db.prepare('SELECT COUNT(*) as count FROM episodes').get().count;
  const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
  const libraries = db.prepare('SELECT * FROM libraries').all();
  res.json({ movieCount, showCount, episodeCount, userCount, libraries });
});

// SSE endpoint — streams scan progress events in real time
router.get('/scan/stream', requireAdmin, async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const send = (data) => {
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    }
  };

  req.on('close', () => { res.end(); });

  try {
    await scanAllWithProgress(send);
  } catch (err) {
    send({ type: 'error', message: err.message });
    res.end();
  }
});

// Non-streaming scan (kept for compatibility)
router.post('/scan', requireAdmin, async (req, res) => {
  const results = [];
  try {
    await scanAllWithProgress((event) => {
      if (event.type === 'library_done') results.push(event);
    });
    res.json({ success: true, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Validate a path before adding as library
router.get('/validate-path', requireAdmin, (req, res) => {
  const { path: dirPath } = req.query;
  if (!dirPath) return res.status(400).json({ error: 'path query param required' });
  res.json(validatePath(dirPath));
});

router.get('/libraries', requireAdmin, (req, res) => {
  const libraries = db.prepare('SELECT * FROM libraries').all();
  res.json({ libraries });
});

router.post('/libraries', requireAdmin, (req, res) => {
  const { name, path: libPath, type } = req.body;
  if (!name || !libPath || !type) return res.status(400).json({ error: 'name, path, and type required' });
  if (!['movies', 'tv'].includes(type)) return res.status(400).json({ error: 'type must be movies or tv' });

  const { exists, fileCount } = validatePath(libPath);
  const result = db.prepare('INSERT INTO libraries (name, path, type) VALUES (?, ?, ?)').run(name, libPath, type);
  res.json({ id: result.lastInsertRowid, name, path: libPath, type, pathExists: exists, fileCount });
});

router.put('/libraries/:id', requireAdmin, (req, res) => {
  const { name, path: libPath } = req.body;
  db.prepare('UPDATE libraries SET name = ?, path = ? WHERE id = ?').run(name, libPath, req.params.id);
  res.json({ success: true });
});

router.delete('/libraries/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM libraries WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

router.get('/users', requireAdmin, (req, res) => {
  const users = db.prepare('SELECT id, username, email, role, created_at FROM users').all();
  res.json({ users });
});

router.post('/users', requireAdmin, async (req, res) => {
  const { username, email, password, role = 'user' } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  const hash = await bcrypt.hash(password, 12);
  try {
    const result = db.prepare('INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)').run(username, email || null, hash, role);
    res.json({ id: result.lastInsertRowid, username, role });
  } catch {
    res.status(409).json({ error: 'Username already exists' });
  }
});

router.delete('/users/:id', requireAdmin, (req, res) => {
  if (parseInt(req.params.id) === req.user.id) return res.status(400).json({ error: 'Cannot delete your own account' });
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

router.get('/config', requireAdmin, (req, res) => {
  const tmdbKey = db.prepare('SELECT value FROM config WHERE key = ?').get('tmdb_api_key');
  res.json({ tmdbApiKey: tmdbKey?.value ? '***configured***' : null });
});

router.put('/config', requireAdmin, (req, res) => {
  const { tmdbApiKey } = req.body;
  if (tmdbApiKey !== undefined) {
    db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run('tmdb_api_key', tmdbApiKey);
  }
  res.json({ success: true });
});

router.post('/movies/:id/refresh', requireAdmin, async (req, res) => {
  const movie = db.prepare('SELECT * FROM movies WHERE id = ?').get(req.params.id);
  if (!movie) return res.status(404).json({ error: 'Movie not found' });
  const tmdb = require('../services/tmdb');
  const result = await tmdb.searchMovie(movie.title, movie.year);
  if (result) {
    db.prepare(`UPDATE movies SET tmdb_id=?, overview=?, poster_path=?, backdrop_path=?, rating=?, genres=? WHERE id=?`)
      .run(result.id, result.overview, result.poster_path, result.backdrop_path, result.vote_average, JSON.stringify(result.genre_ids), movie.id);
  }
  res.json({ success: true, found: !!result });
});

module.exports = router;
