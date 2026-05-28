const express = require('express');
const db = require('../database/db');
const { authenticate } = require('../middleware/auth');
const { posterUrl, backdropUrl } = require('../services/tmdb');

const router = express.Router();

function formatMovie(m) {
  return {
    ...m,
    genres: m.genres ? JSON.parse(m.genres) : [],
    poster_url: posterUrl(m.poster_path),
    backdrop_url: backdropUrl(m.backdrop_path)
  };
}

router.get('/', authenticate, (req, res) => {
  const { search, genre, sort = 'added_at', order = 'DESC', limit = 50, offset = 0 } = req.query;
  let query = 'SELECT * FROM movies WHERE 1=1';
  const params = [];

  if (search) {
    query += ' AND title LIKE ?';
    params.push(`%${search}%`);
  }

  const validSorts = { title: 'title', year: 'year', rating: 'rating', added: 'added_at' };
  const sortCol = validSorts[sort] || 'added_at';
  const sortDir = order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
  query += ` ORDER BY ${sortCol} ${sortDir} LIMIT ? OFFSET ?`;
  params.push(parseInt(limit), parseInt(offset));

  const movies = db.prepare(query).all(...params).map(formatMovie);
  const total = db.prepare('SELECT COUNT(*) as count FROM movies').get().count;
  res.json({ movies, total });
});

router.get('/recent', authenticate, (req, res) => {
  const movies = db.prepare('SELECT * FROM movies ORDER BY added_at DESC LIMIT 20').all().map(formatMovie);
  res.json({ movies });
});

router.get('/featured', authenticate, (req, res) => {
  const movie = db.prepare('SELECT * FROM movies WHERE backdrop_path IS NOT NULL ORDER BY RANDOM() LIMIT 1').get();
  res.json({ movie: movie ? formatMovie(movie) : null });
});

router.get('/:id', authenticate, (req, res) => {
  const movie = db.prepare('SELECT * FROM movies WHERE id = ?').get(req.params.id);
  if (!movie) return res.status(404).json({ error: 'Movie not found' });
  res.json({ movie: formatMovie(movie) });
});

module.exports = router;
