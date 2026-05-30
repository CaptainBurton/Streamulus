const express = require('express');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const db = require('../database/db');
const { requireAdmin } = require('../middleware/auth');
const { scanAllWithProgress, validatePath } = require('../services/scanner');
const { detectAllIntros } = require('../services/intro-detector');

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

  const libraryId = req.query.libraryId ? parseInt(req.query.libraryId) : null;
  try {
    await scanAllWithProgress(send, libraryId);
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
  const lib = db.prepare('SELECT * FROM libraries WHERE id = ?').get(req.params.id);
  if (!lib) return res.status(404).json({ error: 'Library not found' });

  db.transaction(() => {
    if (lib.type === 'movies') {
      db.prepare('DELETE FROM movies WHERE library_id = ?').run(lib.id);
    } else {
      const shows = db.prepare('SELECT id FROM tv_shows WHERE library_id = ?').all(lib.id);
      for (const show of shows) {
        db.prepare('DELETE FROM episodes WHERE show_id = ?').run(show.id);
      }
      db.prepare('DELETE FROM tv_shows WHERE library_id = ?').run(lib.id);
    }
    db.prepare('DELETE FROM libraries WHERE id = ?').run(lib.id);
  })();

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
  const get = (key) => db.prepare('SELECT value FROM config WHERE key = ?').get(key)?.value ?? null;
  const parseArr = (key, def) => { try { return JSON.parse(get(key) || def); } catch { return JSON.parse(def); } };
  res.json({
    tmdbApiKey:         get('tmdb_api_key'),
    tvdbApiKey:         get('tvdb_api_key'),
    omdbApiKey:         get('omdb_api_key'),
    imdbApiKey:         get('imdb_api_key'),
    movieSourceOrder:   parseArr('movie_source_order', '["tmdb","imdb"]'),
    tvSourceOrder:      parseArr('tv_source_order',    '["tvdb","tmdb","imdb"]'),
    videoCrf:           get('video_crf')            ?? '23',
    videoPreset:        get('video_preset')         ?? 'ultrafast',
    videoResolution:    get('video_resolution')     ?? 'original',
    audioBitrate:       get('audio_bitrate')        ?? '192k',
    audioChannels:      get('audio_channels')       ?? '2',
    hlsSegmentDuration: get('hls_segment_duration') ?? '4',
    progressMinSeconds: get('progress_min_seconds') ?? '10',
  });
});

router.put('/config', requireAdmin, (req, res) => {
  const {
    tmdbApiKey, tvdbApiKey, omdbApiKey, imdbApiKey,
    movieSourceOrder, tvSourceOrder,
    videoCrf, videoPreset, videoResolution, audioBitrate, audioChannels, hlsSegmentDuration,
    progressMinSeconds,
  } = req.body;
  const upsert = db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)');
  if (tmdbApiKey       !== undefined) upsert.run('tmdb_api_key',       tmdbApiKey);
  if (tvdbApiKey       !== undefined) { upsert.run('tvdb_api_key', tvdbApiKey); require('../services/tvdb').invalidateCache(); }
  if (omdbApiKey       !== undefined) upsert.run('omdb_api_key',       omdbApiKey);
  if (imdbApiKey       !== undefined) upsert.run('imdb_api_key',       imdbApiKey);
  if (movieSourceOrder !== undefined) upsert.run('movie_source_order', JSON.stringify(movieSourceOrder));
  if (tvSourceOrder    !== undefined) upsert.run('tv_source_order',    JSON.stringify(tvSourceOrder));
  if (videoCrf         !== undefined) upsert.run('video_crf',          videoCrf);
  if (videoPreset      !== undefined) upsert.run('video_preset',       videoPreset);
  if (videoResolution  !== undefined) upsert.run('video_resolution',   videoResolution);
  if (audioBitrate     !== undefined) upsert.run('audio_bitrate',      audioBitrate);
  if (audioChannels    !== undefined) upsert.run('audio_channels',     audioChannels);
  if (hlsSegmentDuration !== undefined) upsert.run('hls_segment_duration', hlsSegmentDuration);
  if (progressMinSeconds !== undefined) upsert.run('progress_min_seconds', progressMinSeconds);
  res.json({ success: true });
});

// Merge TV show rows that share the same tmdb_id or tvdb_id into the oldest record.
// Fixes duplicates created before the ID-based dedup logic was introduced.
router.post('/tv/deduplicate', requireAdmin, (req, res) => {
  let merged = 0;
  db.transaction(() => {
    for (const col of ['tmdb_id', 'tvdb_id']) {
      const dupes = db.prepare(`
        SELECT ${col} as match_id, MIN(id) as keep_id
        FROM tv_shows WHERE ${col} IS NOT NULL
        GROUP BY ${col} HAVING COUNT(*) > 1
      `).all();
      for (const { match_id, keep_id } of dupes) {
        const dupIds = db.prepare(`SELECT id FROM tv_shows WHERE ${col} = ? AND id != ?`)
          .all(match_id, keep_id).map(r => r.id);
        for (const dupId of dupIds) {
          db.prepare('UPDATE episodes SET show_id = ? WHERE show_id = ?').run(keep_id, dupId);
          db.prepare('DELETE FROM tv_shows WHERE id = ?').run(dupId);
          merged++;
        }
      }
    }
  })();
  res.json({ success: true, merged });
});

// Refresh metadata for every movie (TMDB) and TV show (TVDB then TMDB) — SSE
router.get('/refresh-metadata/stream', requireAdmin, async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const send = (data) => { if (!res.writableEnded) res.write(`data: ${JSON.stringify(data)}\n\n`); };
  req.on('close', () => res.end());

  const tmdb = require('../services/tmdb');
  const tvdb = require('../services/tvdb');
  const omdb = require('../services/omdb');
  const imdb = require('../services/imdb');

  const getConf = (key) => db.prepare('SELECT value FROM config WHERE key = ?').get(key)?.value ?? null;
  const parseArr = (key, def) => { try { return JSON.parse(getConf(key) || def); } catch { return JSON.parse(def); } };
  const movieSourceOrder = parseArr('movie_source_order', '["tmdb","imdb"]');
  const tvSourceOrder    = parseArr('tv_source_order',    '["tvdb","tmdb","imdb"]');

  const movies = db.prepare('SELECT * FROM movies').all();
  const shows = db.prepare('SELECT * FROM tv_shows').all();
  const total = movies.length + shows.length;
  let moviesUpdated = 0;
  let showsUpdated = 0;
  let index = 0;

  send({ type: 'start', total });

  // ── Movies — try each source in configured priority order ──
  for (const movie of movies) {
    index++;
    send({ type: 'progress', index, total, title: movie.title, percent: Math.round((index / total) * 100) });

    let updated = false;
    for (const src of movieSourceOrder) {
      if (updated) break;
      if (src === 'imdb' && imdb.isConfigured()) {
        const result = await imdb.searchMovie(movie.title, movie.year);
        if (result) {
          db.prepare('UPDATE movies SET imdb_id=?, overview=?, poster_path=?, backdrop_path=?, rating=?, genres=?, imdb_rating=?, content_rating=? WHERE id=?')
            .run(result.imdb_id, result.overview, result.poster_path, result.backdrop_path, result.rating, result.genres, result.imdb_rating, result.content_rating, movie.id);
          updated = true;
        }
      } else if (src === 'tmdb') {
        const result = await tmdb.searchMovie(movie.title, movie.year);
        if (result) {
          db.prepare('UPDATE movies SET tmdb_id=?, overview=?, poster_path=?, backdrop_path=?, rating=?, genres=? WHERE id=?')
            .run(result.id, result.overview, result.poster_path, result.backdrop_path, result.vote_average, JSON.stringify(result.genre_ids), movie.id);
          updated = true;
        }
      }
    }
    if (updated) moviesUpdated++;
    // OMDb always supplements with IMDb rating/content-rating data
    if (omdb.isConfigured()) {
      const od = await omdb.searchMovie(movie.title, movie.year);
      if (od) db.prepare('UPDATE movies SET imdb_id=?, imdb_rating=?, content_rating=? WHERE id=?')
        .run(od.imdb_id, od.imdb_rating, od.content_rating, movie.id);
    }
  }

  // ── TV shows — try each source in configured priority order ──
  for (const show of shows) {
    index++;
    send({ type: 'progress', index, total, title: show.title, percent: Math.round((index / total) * 100) });

    let refreshed = false;

    for (const src of tvSourceOrder) {
      if (refreshed) break;

      if (src === 'tvdb' && tvdb.isConfigured()) {
        const tvdbMeta = await tvdb.searchSeries(show.title);
        if (tvdbMeta?.tvdb_id) {
          const artwork = await tvdb.getSeriesArtwork(tvdbMeta.tvdb_id);
          const poster = artwork.poster || tvdbMeta.poster_path || show.poster_path;
          const backdrop = artwork.backdrop || show.backdrop_path;

          db.prepare('UPDATE tv_shows SET tvdb_id=?, overview=?, poster_path=?, backdrop_path=?, status=?, first_air_date=? WHERE id=?')
            .run(tvdbMeta.tvdb_id, tvdbMeta.overview || show.overview, poster, backdrop,
                 tvdbMeta.status || show.status, tvdbMeta.first_air_date || show.first_air_date, show.id);

          let seasonPosters = artwork.seasonPosters;
          if (seasonPosters.size === 0) seasonPosters = await tvdb.getSeasonPosters(tvdbMeta.tvdb_id);
          for (const [sNum, sUrl] of seasonPosters) {
            db.prepare('INSERT OR REPLACE INTO seasons (show_id, season_number, poster_path) VALUES (?, ?, ?)')
              .run(show.id, sNum, sUrl);
          }

          const episodes = db.prepare('SELECT * FROM episodes WHERE show_id = ?').all(show.id);
          for (const ep of episodes) {
            const epData = await tvdb.getEpisodeDetails(tvdbMeta.tvdb_id, ep.season, ep.episode_number);
            if (epData) {
              db.prepare('UPDATE episodes SET title=?, overview=?, still_path=? WHERE id=?')
                .run(epData.name || ep.title, epData.overview || ep.overview, epData.still_path, ep.id);
            }
          }
          showsUpdated++;
          refreshed = true;
        }

      } else if (src === 'tmdb') {
        const tmdbMeta = await tmdb.searchTV(show.title);
        if (tmdbMeta) {
          db.prepare('UPDATE tv_shows SET tmdb_id=?, overview=?, poster_path=?, backdrop_path=?, rating=?, genres=? WHERE id=?')
            .run(tmdbMeta.id, tmdbMeta.overview, tmdbMeta.poster_path, tmdbMeta.backdrop_path,
                 tmdbMeta.vote_average, JSON.stringify(tmdbMeta.genre_ids), show.id);

          // Episode details from TMDB
          const episodes = db.prepare('SELECT * FROM episodes WHERE show_id = ?').all(show.id);
          for (const ep of episodes) {
            const epData = await tmdb.getEpisodeDetails(tmdbMeta.id, ep.season, ep.episode_number);
            if (epData) {
              db.prepare('UPDATE episodes SET title=?, overview=?, still_path=? WHERE id=?')
                .run(epData.name || ep.title, epData.overview || ep.overview, epData.still_path, ep.id);
            }
          }
          showsUpdated++;
          refreshed = true;
        }

      } else if (src === 'imdb' && imdb.isConfigured()) {
        const result = await imdb.searchSeries(show.title);
        if (result) {
          db.prepare('UPDATE tv_shows SET imdb_id=?, overview=?, poster_path=?, rating=?, genres=?, imdb_rating=?, content_rating=? WHERE id=?')
            .run(result.imdb_id, result.overview, result.poster_path, result.rating, result.genres, result.imdb_rating, result.content_rating, show.id);
          showsUpdated++;
          refreshed = true;
        }
      }
    }

    if (omdb.isConfigured()) {
      const od = await omdb.searchSeries(show.title);
      if (od) db.prepare('UPDATE tv_shows SET imdb_id=?, imdb_rating=?, content_rating=? WHERE id=?')
        .run(od.imdb_id, od.imdb_rating, od.content_rating, show.id);
    }
  }

  send({ type: 'complete', moviesUpdated, showsUpdated, updated: moviesUpdated + showsUpdated, total });
  res.end();
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

// SSE — streams intro detection progress in real time
router.get('/detect-intros/stream', requireAdmin, async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const send = (data) => {
    if (!res.writableEnded) res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  req.on('close', () => { res.end(); });

  const force = req.query.force === '1';
  const showId = req.query.showId ? parseInt(req.query.showId) : null;

  try {
    await detectAllIntros(send, { showId, force });
  } catch (err) {
    send({ type: 'error', message: err.message });
  }
  res.end();
});

module.exports = router;
