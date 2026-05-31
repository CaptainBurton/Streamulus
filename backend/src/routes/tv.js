const express = require('express');
const db = require('../database/db');
const { authenticate } = require('../middleware/auth');
const { posterUrl, backdropUrl, resolveGenreNames, getTVCredits } = require('../services/tmdb');

const router = express.Router();

const IMAGE_BASE = 'https://image.tmdb.org/t/p';

const isFullUrl = (p) => p && (p.startsWith('http://') || p.startsWith('https://'));

function formatShow(s) {
  let genres = [];
  if (s.genres) {
    try {
      const parsed = JSON.parse(s.genres);
      if (Array.isArray(parsed)) {
        genres = typeof parsed[0] === 'number' || (parsed[0] && !isNaN(Number(parsed[0])))
          ? resolveGenreNames(parsed.map(Number), true)
          : parsed;
      }
    } catch {}
  }
  return {
    ...s,
    genres,
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
           s.title as show_title, s.id as show_id
    FROM episodes e
    JOIN tv_shows s ON s.id = e.show_id
    WHERE e.id = ?
  `).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Episode not found' });
  res.json(row);
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

router.get('/:id/details', authenticate, async (req, res) => {
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

  const formatted = formatShow(show);
  let cast = [];

  if (show.tmdb_id) {
    const credits = await getTVCredits(show.tmdb_id);
    if (credits) {
      cast = (credits.cast || []).slice(0, 12).map(c => ({
        id: c.id,
        name: c.name,
        character: c.character || '',
        profile_url: c.profile_path ? `https://image.tmdb.org/t/p/w185${c.profile_path}` : null,
      }));
    }
  }

  const firstGenre = (() => {
    try { return (JSON.parse(show.genres || '[]')[0] || ''); } catch { return ''; }
  })();
  const similarLocal = db.prepare(`
    SELECT * FROM tv_shows WHERE id != ? AND genres LIKE ?
    ORDER BY rating DESC LIMIT 8
  `).all(show.id, `%${firstGenre}%`).map(formatShow);

  res.json({ show: formatted, seasons, cast, similarLocal });
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
