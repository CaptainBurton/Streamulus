const express = require('express');
const db = require('../database/db');
const { authenticate } = require('../middleware/auth');
const { posterUrl, backdropUrl, resolveGenreNames, getTVCredits, getTVContentRating, searchTV } = require('../services/tmdb');

const router = express.Router();

const IMAGE_BASE = 'https://image.tmdb.org/t/p';

const isFullUrl = (p) => p && (p.startsWith('http://') || p.startsWith('https://') || p.startsWith('/uploads/'));

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
  let query = `
    SELECT s.*,
      COALESCE(ws.total_episodes, 0) as total_episodes,
      COALESCE(ws.watched_episodes, 0) as watched_episodes
    FROM tv_shows s
    LEFT JOIN (
      SELECT e.show_id,
        COUNT(*) as total_episodes,
        SUM(CASE WHEN wh.completed = 1 THEN 1 ELSE 0 END) as watched_episodes
      FROM episodes e
      LEFT JOIN watch_history wh ON wh.media_id = e.id AND wh.user_id = ? AND wh.media_type = 'episode'
      GROUP BY e.show_id
    ) ws ON ws.show_id = s.id
    WHERE 1=1
  `;
  const params = [req.user.id];

  if (search) {
    query += ' AND s.title LIKE ?';
    params.push(`%${search}%`);
  }

  const validSorts = { title: 's.title', rating: 's.rating', added: 's.added_at' };
  const sortCol = validSorts[sort] || 's.added_at';
  const sortDir = order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
  query += ` ORDER BY ${sortCol} ${sortDir} LIMIT ? OFFSET ?`;
  params.push(parseInt(limit), parseInt(offset));

  const shows = db.prepare(query).all(...params).map(formatShow);
  const total = db.prepare('SELECT COUNT(*) as count FROM tv_shows' + (search ? ' WHERE title LIKE ?' : '')).get(...(search ? [`%${search}%`] : [])).count;
  res.json({ shows, total });
});

// Backfill rating/genres/tmdb_id for shows that were indexed via TVDB (which returns no TMDB data).
// Runs in parallel; results are persisted so subsequent requests are instant.
async function enrichMissingTMDB(shows) {
  const missing = shows.filter(s => !s.tmdb_id);
  if (!missing.length) return;
  await Promise.all(missing.map(async (show) => {
    const result = await searchTV(show.title);
    if (!result) return;
    const cols = ['tmdb_id = ?'];
    const vals = [result.id];
    if (!show.rating && result.vote_average) { cols.push('rating = ?'); vals.push(result.vote_average); }
    if (!show.genres && result.genre_ids?.length) { cols.push('genres = ?'); vals.push(JSON.stringify(result.genre_ids)); }
    if (!show.backdrop_path && result.backdrop_path) { cols.push('backdrop_path = ?'); vals.push(result.backdrop_path); }
    vals.push(show.id);
    db.prepare(`UPDATE tv_shows SET ${cols.join(', ')} WHERE id = ?`).run(...vals);
  }));
}

const RECENT_WITH_WATCH_SQL = `
  SELECT s.*,
    COALESCE(ws.total_episodes, 0) as total_episodes,
    COALESCE(ws.watched_episodes, 0) as watched_episodes
  FROM tv_shows s
  LEFT JOIN (
    SELECT e.show_id,
      COUNT(*) as total_episodes,
      SUM(CASE WHEN wh.completed = 1 THEN 1 ELSE 0 END) as watched_episodes
    FROM episodes e
    LEFT JOIN watch_history wh ON wh.media_id = e.id AND wh.user_id = ? AND wh.media_type = 'episode'
    GROUP BY e.show_id
  ) ws ON ws.show_id = s.id
  ORDER BY s.added_at DESC LIMIT 20
`;

router.get('/recent', authenticate, async (req, res) => {
  let shows = db.prepare(RECENT_WITH_WATCH_SQL).all(req.user.id);
  await enrichMissingTMDB(shows);
  if (shows.some(s => !s.tmdb_id)) {
    shows = db.prepare(RECENT_WITH_WATCH_SQL).all(req.user.id);
  }
  res.json({ shows: shows.map(formatShow) });
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
           s.poster_path as season_poster,
           SUM(CASE WHEN wh.completed = 1 THEN 1 ELSE 0 END) as watched_count
    FROM episodes e
    LEFT JOIN seasons s ON s.show_id = e.show_id AND s.season_number = e.season
    LEFT JOIN watch_history wh ON wh.media_id = e.id AND wh.user_id = ? AND wh.media_type = 'episode'
    WHERE e.show_id = ?
    GROUP BY e.season ORDER BY e.season
  `).all(req.user.id, req.params.id);

  res.json({ show: formatShow(show), seasons });
});

router.get('/:id/details', authenticate, async (req, res) => {
  let show = db.prepare('SELECT * FROM tv_shows WHERE id = ?').get(req.params.id);
  if (!show) return res.status(404).json({ error: 'Show not found' });

  const seasons = db.prepare(`
    SELECT e.season, COUNT(*) as episode_count,
           s.poster_path as season_poster,
           SUM(CASE WHEN wh.completed = 1 THEN 1 ELSE 0 END) as watched_count
    FROM episodes e
    LEFT JOIN seasons s ON s.show_id = e.show_id AND s.season_number = e.season
    LEFT JOIN watch_history wh ON wh.media_id = e.id AND wh.user_id = ? AND wh.media_type = 'episode'
    WHERE e.show_id = ?
    GROUP BY e.season ORDER BY e.season
  `).all(req.user.id, req.params.id);

  // If TVDB was the scanner source, tmdb_id/rating/genres may be null.
  // Do a live TMDB search by title and backfill so cast + ratings work.
  let tmdbId = show.tmdb_id;
  if (!tmdbId) {
    const tmdbResult = await searchTV(show.title);
    if (tmdbResult) {
      tmdbId = tmdbResult.id;
      const cols = ['tmdb_id = ?'];
      const vals = [tmdbId];
      if (!show.rating && tmdbResult.vote_average) { cols.push('rating = ?'); vals.push(tmdbResult.vote_average); }
      if (!show.genres && tmdbResult.genre_ids?.length) { cols.push('genres = ?'); vals.push(JSON.stringify(tmdbResult.genre_ids)); }
      if (!show.backdrop_path && tmdbResult.backdrop_path) { cols.push('backdrop_path = ?'); vals.push(tmdbResult.backdrop_path); }
      vals.push(show.id);
      db.prepare(`UPDATE tv_shows SET ${cols.join(', ')} WHERE id = ?`).run(...vals);
      show = db.prepare('SELECT * FROM tv_shows WHERE id = ?').get(req.params.id);
    }
  }

  let cast = [];
  if (tmdbId) {
    const [credits, contentRating] = await Promise.all([
      getTVCredits(tmdbId),
      show.content_rating ? Promise.resolve(null) : getTVContentRating(tmdbId),
    ]);

    if (contentRating) {
      db.prepare('UPDATE tv_shows SET content_rating = ? WHERE id = ?').run(contentRating, show.id);
      show = db.prepare('SELECT * FROM tv_shows WHERE id = ?').get(req.params.id);
    }

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

  res.json({ show: formatShow(show), seasons, cast, similarLocal });
});

router.get('/:id/season/:season', authenticate, (req, res) => {
  const episodes = db.prepare(`
    SELECT e.*, wh.completed as watch_completed, wh.position as watch_position
    FROM episodes e
    LEFT JOIN watch_history wh ON wh.media_id = e.id AND wh.user_id = ? AND wh.media_type = 'episode'
    WHERE e.show_id = ? AND e.season = ?
    ORDER BY e.episode_number
  `).all(req.user.id, req.params.id, req.params.season);

  const formatted = episodes.map(ep => ({
    ...ep,
    still_url: ep.still_path
      ? (isFullUrl(ep.still_path) ? ep.still_path : `${IMAGE_BASE}/w300${ep.still_path}`)
      : null,
  }));
  res.json({ episodes: formatted });
});

module.exports = router;
