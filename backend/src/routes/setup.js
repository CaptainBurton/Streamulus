const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../database/db');
const { scanAll } = require('../services/scanner');

const router = express.Router();

// Check if setup has been completed
router.get('/status', (req, res) => {
  const row = db.prepare('SELECT value FROM config WHERE key = ?').get('setup_complete');
  res.json({ setupComplete: row?.value === 'true' });
});

// Complete initial setup
router.post('/complete', async (req, res) => {
  const already = db.prepare('SELECT value FROM config WHERE key = ?').get('setup_complete');
  if (already?.value === 'true') {
    return res.status(400).json({ error: 'Setup already completed' });
  }

  const { adminUsername, adminPassword, adminEmail, moviePath, tvPath, tmdbApiKey } = req.body;

  if (!adminUsername || !adminPassword) {
    return res.status(400).json({ error: 'Admin username and password are required' });
  }

  if (adminPassword.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  const hash = await bcrypt.hash(adminPassword, 12);

  const insertConfig = db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)');
  const insertUser = db.prepare('INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)');
  const insertLibrary = db.prepare('INSERT INTO libraries (name, path, type) VALUES (?, ?, ?)');

  db.transaction(() => {
    insertUser.run(adminUsername, adminEmail || null, hash, 'admin');

    if (moviePath && moviePath.trim()) {
      insertLibrary.run('Movies', moviePath.trim(), 'movies');
    }
    if (tvPath && tvPath.trim()) {
      insertLibrary.run('TV Shows', tvPath.trim(), 'tv');
    }
    if (tmdbApiKey && tmdbApiKey.trim()) {
      insertConfig.run('tmdb_api_key', tmdbApiKey.trim());
    }

    insertConfig.run('setup_complete', 'true');
  })();

  // Kick off background scan
  scanAll().catch(() => {});

  res.json({ success: true, message: 'Setup complete. Media scan started.' });
});

module.exports = router;
