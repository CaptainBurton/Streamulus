const express = require('express');
const db = require('../database/db');
const { authenticate } = require('../middleware/auth');
const { posterUrl, backdropUrl, resolveGenreNames, getMovieCredits, getSimilarMovies } = require('../services/tmdb');

const router = express.Router();

const isFullUrl = (p) => p && (p.startsWith('http://') || p.startsWith('https://'));

function formatMovie(m) {
  // genres may be stored as TMDB integer IDs ["28","12"] or IMDb name strings ["Action","Crime"]
  let genres = [];
  if (m.genres) {
    try {
      const parsed = JSON.parse(m.genres);
      if (Array.isArray(parsed)) {
        genres = typeof parsed[0] === 'number' || (parsed[0] && !isNaN(Number(parsed[0])))
          ? resolveGenreNames(parsed.map(Number))
          : parsed; // already name strings
      }
    } catch {}
  }
  return {
    ...m,
    genres,
    // IMDb stores full Amazon CDN URLs; TMDB stores relative paths that need the base prepended
    poster_url:   isFullUrl(m.poster_path)   ? m.poster_path   : posterUrl(m.poster_path),
    backdrop_url: isFullUrl(m.backdrop_path) ? m.backdrop_path : backdropUrl(m.backdrop_path),
  };
}

router.get('/', authenticate, (req, res) => {
  const { search, sort = 'added_at', order = 'DESC', limit = 50, offset = 0 } = req.query;
  let query = `
    SELECT m.*, wh.completed AS watch_completed, wh.position AS watch_position
    FROM movies m
    LEFT JOIN watch_history wh ON wh.media_id = m.id AND wh.user_id = ? AND wh.media_type = 'movie'
    WHERE 1=1
  `;
  const params = [req.user.id];

  if (search) { query += ' AND m.title LIKE ?'; params.push(`%${search}%`); }

  const validSorts = { title: 'm.title', year: 'm.year', rating: 'm.rating', added: 'm.added_at' };
  const sortCol = validSorts[sort] || 'm.added_at';
  const sortDir = order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
  query += ` ORDER BY ${sortCol} ${sortDir} LIMIT ? OFFSET ?`;
  params.push(parseInt(limit), parseInt(offset));

  const movies = db.prepare(query).all(...params).map(formatMovie);
  const total = db.prepare('SELECT COUNT(*) as count FROM movies' + (search ? ' WHERE title LIKE ?' : '')).get(...(search ? [`%${search}%`] : [])).count;
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
