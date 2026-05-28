const express = require('express');
const db = require('../database/db');
const { authenticate } = require('../middleware/auth');
const { posterUrl, backdropUrl, resolveGenreNames, getMovieCredits, getSimilarMovies } = require('../services/tmdb');

const router = express.Router();

function formatMovie(m) {
  const genreIds = m.genres ? JSON.parse(m.genres) : [];
  return {
    ...m,
    genre_ids: genreIds,
    genres: resolveGenreNames(genreIds),
    poster_url: posterUrl(m.poster_path),
    backdrop_url: backdropUrl(m.backdrop_path),
  };
}

router.get('/', authenticate, (req, res) => {
  const { search, sort = 'added_at', order = 'DESC', limit = 50, offset = 0 } = req.query;
  let query = 'SELECT * FROM movies WHERE 1=1';
  const params = [];

  if (search) { query += ' AND title LIKE ?'; params.push(`%${search}%`); }

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

// Full detail page: movie + cast + similar (fetched live from TMDB)
router.get('/:id/details', authenticate, async (req, res) => {
  const movie = db.prepare('SELECT * FROM movies WHERE id = ?').get(req.params.id);
  if (!movie) return res.status(404).json({ error: 'Movie not found' });

  const formatted = formatMovie(movie);
  let cast = [];
  let director = null;
  let similarTmdb = [];

  if (movie.tmdb_id) {
    const [credits, similar] = await Promise.all([
      getMovieCredits(movie.tmdb_id),
      getSimilarMovies(movie.tmdb_id),
    ]);

    if (credits) {
      cast = (credits.cast || []).slice(0, 12).map(c => ({
        id: c.id,
        name: c.name,
        character: c.character,
        profile_url: c.profile_path ? `https://image.tmdb.org/t/p/w185${c.profile_path}` : null,
      }));
      const dir = (credits.crew || []).find(c => c.job === 'Director');
      if (dir) director = dir.name;
    }

    if (similar) {
      similarTmdb = similar.map(s => ({
        tmdb_id: s.id,
        title: s.title,
        year: s.release_date?.split('-')[0],
        rating: s.vote_average,
        poster_url: s.poster_path ? `https://image.tmdb.org/t/p/w300${s.poster_path}` : null,
      }));
    }
  }

  // Also find similar movies already in our library
  const similarLocal = db.prepare(`
    SELECT * FROM movies WHERE id != ? AND genres LIKE ?
    ORDER BY rating DESC LIMIT 8
  `).all(movie.id, `%${(JSON.parse(movie.genres || '[]')[0] || '')}%`).map(formatMovie);

  res.json({ movie: formatted, cast, director, similarTmdb, similarLocal });
});

module.exports = router;
