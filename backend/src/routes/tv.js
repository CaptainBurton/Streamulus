const express = require('express');
const db = require('../database/db');
const { authenticate } = require('../middleware/auth');
const { posterUrl, backdropUrl } = require('../services/tmdb');

const router = express.Router();

const IMAGE_BASE = 'https://image.tmdb.org/t/p';

const isFullUrl = (p) => p && (p.startsWith('http://') || p.startsWith('https://'));

function formatShow(s) {
  return {
    ...s,
    genres: s.genres ? JSON.parse(s.genres) : [],
    poster_url: isFullUrl(s.poster_path) ? s.poster_path : posterUrl(s.poster_path),
    backdrop_url: isFullUrl(s.backdrop_path) ? s.backdrop_path : backdropUrl(s.backdrop_path),
  };
}

router.get('/', authenticate, (req, res) => {
  const { search, sort = 'added_at', order = 'DESC', limit = 50, offset = 0 } = req.query;
  let query = 'SELECT * FROM tv_shows WHERE 1=1';
  const params = [];

  if (search) {
    query += ' AND title LIKE ?';
    params.push(`%${search}%`);
  }

  const validSorts = { title: 'title', rating: 'rating', added: 'added_at' };
  const sortCol = validSorts[sort] || 'added_at';
  const sortDir = order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
  query += ` ORDER BY ${sortCol} ${sortDir} LIMIT ? OFFSET ?`;
  params.push(parseInt(limit), parseInt(offset));

  const shows = db.prepare(query).all(...params).map(formatShow);
  const total = db.prepare('SELECT COUNT(*) as count FROM tv_shows').get().count;
  res.json({ shows, total });
});

router.get('/recent', authenticate, (req, res) => {
  const shows = db.prepare('SELECT * FROM tv_shows ORDER BY added_at DESC LIMIT 20').all().map(formatShow);
  res.json({ shows });
});

router.get('/episode/:id', authenticate, (req, res) => {
  const row = db.prepare(`
    SELECT e.season, e.episode_number, e.title as episode_title,
           s.title as show_title, s.id as show_id, s.intro_start_time, s.intro_end_time
    FROM episodes e
    JOIN tv_shows s ON s.id = e.show_id
    WHERE e.id = ?
  `).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Episode not found' });
  res.json(row);
});

router.patch('/:id/intro', authenticate, (req, res) => {
  const { introEndTime, introStartTime } = req.body;
  const end   = introEndTime   != null ? Math.max(0, Math.floor(Number(introEndTime)))   : null;
  const start = introStartTime != null ? Math.max(0, Math.floor(Number(introStartTime))) : null;
  db.prepare('UPDATE tv_shows SET intro_start_time = ?, intro_end_time = ? WHERE id = ?').run(start, end, req.params.id);
  res.json({ ok: true, intro_start_time: start, intro_end_time: end });
});

router.get('/:id', authenticate, (req, res) => {
  const show = db.prepare('SELECT * FROM tv_shows WHERE id = ?').get(req.params.id);
  if (!show) return res.status(404).json({ error: 'Show not found' });

  const seasons = db.prepare(`
    SELECT e.season, COUNT(*) as episode_count,
           s.poster_path as season_poster
    FROM episodes e
    LEFT JOIN seasons s ON s.show_id = e.show_id AND s.season_number = e.season
    WHERE e.show_id = ?
    GROUP BY e.season ORDER BY e.season
  `).all(req.params.id);

  res.json({ show: formatShow(show), seasons });
});

router.get('/:id/season/:season', authenticate, (req, res) => {
  const episodes = db.prepare(`
    SELECT * FROM episodes
    WHERE show_id = ? AND season = ?
    ORDER BY episode_number
  `).all(req.params.id, req.params.season);

  const formatted = episodes.map(ep => ({
    ...ep,
    still_url: ep.still_path
      ? (isFullUrl(ep.still_path) ? ep.still_path : `${IMAGE_BASE}/w300${ep.still_path}`)
      : null,
  }));
  res.json({ episodes: formatted });
});

module.exports = router;
