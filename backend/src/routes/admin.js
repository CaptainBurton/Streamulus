const express = require('express');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const db = require('../database/db');
const { requireAdmin } = require('../middleware/auth');
const { scanAllWithProgress, validatePath } = require('../services/scanner');
const { ensureMainProfile, publicProfile, deleteProfileData } = require('../services/profiles');
const accounts = require('../services/accounts');

const uploadsDir = path.join(process.env.DATA_DIR || '/data', 'uploads');
const upload = multer({
  storage: multer.diskStorage({
    destination: uploadsDir,
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname) || '.jpg';
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
    },
  }),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) return cb(new Error('Images only'));
    cb(null, true);
  },
});

const router = express.Router();

router.get('/stats', requireAdmin, (req, res) => {
  const movieCount = db.prepare('SELECT COUNT(*) as count FROM movies').get().count;
  const showCount = db.prepare('SELECT COUNT(*) as count FROM tv_shows').get().count;
  const episodeCount = db.prepare('SELECT COUNT(*) as count FROM episodes').get().count;
  const userCount = db.prepare("SELECT COUNT(*) as count FROM users WHERE status = 'active'").get().count;
  const pendingCount = db.prepare("SELECT COUNT(*) as count FROM users WHERE status = 'pending'").get().count;
  const libraries = db.prepare('SELECT * FROM libraries').all();
  res.json({ movieCount, showCount, episodeCount, userCount, pendingCount, libraries });
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
router.get('/validate-path', requireAdmin, async (req, res) => {
  const { path: dirPath } = req.query;
  if (!dirPath) return res.status(400).json({ error: 'path query param required' });
  res.json(await validatePath(dirPath));
});

router.get('/libraries', requireAdmin, (req, res) => {
  const libraries = db.prepare('SELECT * FROM libraries').all();
  res.json({ libraries });
});

router.post('/libraries', requireAdmin, async (req, res) => {
  const { name, path: libPath, type } = req.body;
  if (!name || !libPath || !type) return res.status(400).json({ error: 'name, path, and type required' });
  if (!['movies', 'tv'].includes(type)) return res.status(400).json({ error: 'type must be movies or tv' });

  const { exists, fileCount } = await validatePath(libPath);
  const result = db.prepare('INSERT INTO libraries (name, path, type) VALUES (?, ?, ?)').run(name, libPath, type);
  res.json({ id: result.lastInsertRowid, name, path: libPath, type, pathExists: exists, fileCount });
});

router.put('/libraries/:id', requireAdmin, async (req, res) => {
  const lib = db.prepare('SELECT * FROM libraries WHERE id = ?').get(req.params.id);
  if (!lib) return res.status(404).json({ error: 'Library not found' });

  const trimSlash = (p) => (p.length > 1 ? p.replace(/\/+$/, '') : p);
  const name    = req.body.name?.trim() || lib.name;
  const newPath = trimSlash((req.body.path ?? lib.path).trim());
  const oldPath = trimSlash(lib.path);
  if (!newPath) return res.status(400).json({ error: 'path required' });

  // When the folder moves (e.g. a different container mount after redeploying),
  // rewrite every stored file path under the old folder so existing items —
  // and their watch history — keep working without a rescan.
  let remapped = 0;
  db.transaction(() => {
    db.prepare('UPDATE libraries SET name = ?, path = ? WHERE id = ?').run(name, newPath, lib.id);
    if (newPath !== oldPath) {
      const oldPrefix = oldPath === '/' ? '/' : `${oldPath}/`;
      const newPrefix = newPath === '/' ? '/' : `${newPath}/`;
      const like = oldPrefix.replace(/[\\%_]/g, '\\$&') + '%';
      // SQLite substr() counts characters, so measure the prefix in code points.
      const rest = [...oldPrefix].length + 1;
      const table = lib.type === 'movies' ? 'movies' : 'episodes';
      // OR IGNORE: skip rows whose new path already exists (e.g. re-added by a scan).
      remapped = db.prepare(`UPDATE OR IGNORE ${table} SET file_path = ? || substr(file_path, ?) WHERE file_path LIKE ? ESCAPE '\\'`)
        .run(newPrefix, rest, like).changes;
    }
  })();

  const { exists, fileCount } = await validatePath(newPath);
  res.json({ success: true, remapped, pathExists: exists, fileCount });
});

router.delete('/libraries/:id', requireAdmin, (req, res) => {
  const lib = db.prepare('SELECT * FROM libraries WHERE id = ?').get(req.params.id);
  if (!lib) return res.status(404).json({ error: 'Library not found' });

  // Remove every row that references this library, whatever its type — with
  // foreign_keys ON a single leftover row (e.g. a show attached to a movies
  // library) would otherwise make the whole delete fail.
  try {
    db.transaction(() => {
      db.prepare('DELETE FROM movies WHERE library_id = ?').run(lib.id);
      const showIds = db.prepare('SELECT id FROM tv_shows WHERE library_id = ?').all(lib.id).map(s => s.id);
      for (const showId of showIds) {
        db.prepare('DELETE FROM episodes WHERE show_id = ?').run(showId);
        db.prepare('DELETE FROM seasons WHERE show_id = ?').run(showId);
      }
      db.prepare('DELETE FROM tv_shows WHERE library_id = ?').run(lib.id);
      db.prepare('DELETE FROM libraries WHERE id = ?').run(lib.id);
    })();
  } catch (err) {
    console.error(`[admin] Failed to remove library ${lib.id}:`, err.message);
    return res.status(500).json({ error: `Could not remove library: ${err.message}` });
  }

  res.json({ success: true });
});

// Accounts with their profiles nested underneath (main profile first). Accounts
// people created themselves show as status 'pending' until they're activated
// with an Admin Passphrase; passphraseExpiresAt says whether one is out (ms).
router.get('/users', requireAdmin, (req, res) => {
  const users = db.prepare('SELECT id, username, email, role, status, passphrase_expires_at, created_at FROM users ORDER BY id').all();
  const profiles = db.prepare('SELECT * FROM profiles ORDER BY is_main DESC, id').all();
  res.json({
    users: users.map(({ passphrase_expires_at, ...u }) => ({
      ...u,
      passphraseExpiresAt: u.status === 'pending' ? passphrase_expires_at : null,
      profiles: profiles.filter(p => p.user_id === u.id).map(p => ({ ...publicProfile(p), created_at: p.created_at })),
    })),
  });
});

// Make a new single-use Admin Passphrase for an account that's waiting, valid for
// an hour. It replaces any earlier one and is only ever shown here, once.
router.post('/users/:id/passphrase', requireAdmin, (req, res) => {
  const user = db.prepare('SELECT id, username, status FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Account not found' });
  if (user.status !== 'pending') return res.status(400).json({ error: 'That account is already active' });
  const passphrase = accounts.generatePassphrase();
  const expiresAt = Date.now() + accounts.PASSPHRASE_TTL_MS;
  db.prepare('UPDATE users SET passphrase_hash = ?, passphrase_expires_at = ?, passphrase_attempts = 0 WHERE id = ?')
    .run(accounts.hashPassphrase(passphrase), expiresAt, user.id);
  res.json({ passphrase, expiresAt, username: user.username });
});

router.post('/users', requireAdmin, async (req, res) => {
  const { username, email, password, role = 'user' } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  const hash = await bcrypt.hash(password, 12);
  try {
    const result = db.prepare('INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)').run(username, email || null, hash, role);
    ensureMainProfile(result.lastInsertRowid, username);
    res.json({ id: result.lastInsertRowid, username, role });
  } catch {
    res.status(409).json({ error: 'Username already exists' });
  }
});

router.delete('/users/:id', requireAdmin, (req, res) => {
  if (parseInt(req.params.id) === req.user.id) return res.status(400).json({ error: 'Cannot delete your own account' });
  // Remove the account's profiles, their avatars and watch history first —
  // with foreign keys on, leftover rows made the delete fail.
  const profiles = db.prepare('SELECT * FROM profiles WHERE user_id = ?').all(req.params.id);
  db.transaction(() => {
    for (const p of profiles) deleteProfileData(p.id);
    db.prepare('DELETE FROM watch_history WHERE user_id = ?').run(req.params.id);
    db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  })();
  for (const p of profiles) {
    if (p.avatar_path) fs.rm(path.join(uploadsDir, 'avatars', p.avatar_path), { force: true }, () => {});
  }
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
    upNextSeconds:      get('up_next_seconds')      ?? '30',
    featuredRotateSeconds: get('featured_rotate_seconds') ?? '120',
    preferredLanguage:  get('preferred_language')   ?? 'en',
    preferredCountry:   get('preferred_country')    ?? 'US',
  });
});

router.put('/config', requireAdmin, (req, res) => {
  const {
    tmdbApiKey, tvdbApiKey, omdbApiKey, imdbApiKey,
    movieSourceOrder, tvSourceOrder,
    videoCrf, videoPreset, videoResolution, audioBitrate, audioChannels, hlsSegmentDuration,
    progressMinSeconds, upNextSeconds, preferredLanguage, preferredCountry,
    featuredRotateSeconds,
  } = req.body;
  if (featuredRotateSeconds !== undefined) {
    const raw = String(featuredRotateSeconds).trim();
    const secs = Number(raw);
    if (!/^\d+$/.test(raw) || secs < 10 || secs > 86400) {
      return res.status(400).json({ error: 'Featured movie interval must be a whole number of seconds between 10 and 86400 (24 hours)' });
    }
  }
  if (upNextSeconds !== undefined) {
    const secs = parseInt(upNextSeconds);
    if (!(secs >= 5 && secs <= 300)) return res.status(400).json({ error: 'Up Next countdown must be between 5 and 300 seconds' });
  }
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
  if (upNextSeconds !== undefined) upsert.run('up_next_seconds', String(parseInt(upNextSeconds)));
  if (featuredRotateSeconds !== undefined) upsert.run('featured_rotate_seconds', String(Number(String(featuredRotateSeconds).trim())));
  if (preferredLanguage !== undefined) upsert.run('preferred_language', preferredLanguage);
  if (preferredCountry  !== undefined) {
    const current = db.prepare('SELECT value FROM config WHERE key = ?').get('preferred_country')?.value ?? 'US';
    upsert.run('preferred_country', preferredCountry);
    if (preferredCountry !== current) {
      // Clear cached ratings so they are re-fetched from TMDB using the new country.
      db.prepare('UPDATE movies SET content_rating = NULL').run();
      db.prepare('UPDATE tv_shows SET content_rating = NULL').run();
    }
  }
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

// ── Fix Match ───────────────────────────────────────────────────
// Search the configured metadata sources (Settings → source order) for the
// right movie/show, then apply the chosen result to a library item.

router.get('/match/search', requireAdmin, async (req, res) => {
  const type = req.query.type === 'show' ? 'show' : 'movie';
  const query = String(req.query.query || '').trim();
  const year = /^\d{4}$/.test(String(req.query.year || '').trim()) ? parseInt(req.query.year, 10) : null;
  if (!query) return res.status(400).json({ error: 'Enter a title to search for' });
  const result = await require('../services/match').search(type, query, year);
  if (!result.sources.length) {
    return res.status(400).json({ error: `No metadata source is set up for ${type === 'movie' ? 'movies' : 'TV shows'} — add an API key in Settings.` });
  }
  res.json(result);
});

router.post('/match/apply', requireAdmin, async (req, res) => {
  const { type, mediaId, source, id } = req.body || {};
  if (!['movie', 'show'].includes(type) || !['tmdb', 'tvdb', 'imdb'].includes(source) || !id || !mediaId) {
    return res.status(400).json({ error: 'type, mediaId, source and id are required' });
  }
  try {
    const { episodes } = await require('../services/match').apply(type, parseInt(mediaId, 10), source, String(id));
    // English title/overview for the new match (and its episodes, once they've updated).
    setTimeout(() => require('../services/english').fillMissingEnglish().catch(() => {}), episodes ? 60000 : 0);
    res.json({ success: true, episodesUpdating: episodes });
  } catch (e) {
    res.status(e.status || 502).json({ error: e.message || 'Could not apply that match' });
  }
});

// ── Artwork management ──────────────────────────────────────────

const mapImg = (img) => ({
  url:   `https://image.tmdb.org/t/p/original${img.file_path}`,
  thumb: `https://image.tmdb.org/t/p/w300${img.file_path}`,
  width: img.width, height: img.height,
  rating: img.vote_average, language: img.iso_639_1,
});

// Fetch available artwork from TMDB
router.get('/artwork/movie/:id', requireAdmin, async (req, res) => {
  const movie = db.prepare('SELECT tmdb_id FROM movies WHERE id = ?').get(req.params.id);
  if (!movie) return res.status(404).json({ error: 'Not found' });
  if (!movie.tmdb_id) return res.json({ posters: [], backdrops: [] });
  const tmdb = require('../services/tmdb');
  const images = await tmdb.getMovieImages(movie.tmdb_id);
  if (!images) return res.json({ posters: [], backdrops: [] });
  res.json({
    posters:   (images.posters   || []).sort((a, b) => b.vote_average - a.vote_average).slice(0, 40).map(mapImg),
    backdrops: (images.backdrops || []).sort((a, b) => b.vote_average - a.vote_average).slice(0, 20).map(mapImg),
  });
});

router.get('/artwork/tv/:id', requireAdmin, async (req, res) => {
  const show = db.prepare('SELECT tmdb_id FROM tv_shows WHERE id = ?').get(req.params.id);
  if (!show) return res.status(404).json({ error: 'Not found' });
  if (!show.tmdb_id) return res.json({ posters: [], backdrops: [] });
  const tmdb = require('../services/tmdb');
  const images = await tmdb.getTVImages(show.tmdb_id);
  if (!images) return res.json({ posters: [], backdrops: [] });
  res.json({
    posters:   (images.posters   || []).sort((a, b) => b.vote_average - a.vote_average).slice(0, 40).map(mapImg),
    backdrops: (images.backdrops || []).sort((a, b) => b.vote_average - a.vote_average).slice(0, 20).map(mapImg),
  });
});

// Save a selected TMDB artwork URL
router.post('/artwork/movie/:id', requireAdmin, (req, res) => {
  const { type, url } = req.body;
  if (!['poster', 'backdrop'].includes(type) || !url) return res.status(400).json({ error: 'type and url required' });
  const col = type === 'poster' ? 'poster_path' : 'backdrop_path';
  db.prepare(`UPDATE movies SET ${col} = ? WHERE id = ?`).run(url, req.params.id);
  res.json({ success: true });
});

router.post('/artwork/tv/:id', requireAdmin, (req, res) => {
  const { type, url } = req.body;
  if (!['poster', 'backdrop'].includes(type) || !url) return res.status(400).json({ error: 'type and url required' });
  const col = type === 'poster' ? 'poster_path' : 'backdrop_path';
  db.prepare(`UPDATE tv_shows SET ${col} = ? WHERE id = ?`).run(url, req.params.id);
  res.json({ success: true });
});

// Upload custom artwork image
router.post('/artwork/movie/:id/upload', requireAdmin, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const { type } = req.body;
  if (!['poster', 'backdrop'].includes(type)) return res.status(400).json({ error: 'type must be poster or backdrop' });
  const url = `/uploads/${req.file.filename}`;
  const col = type === 'poster' ? 'poster_path' : 'backdrop_path';
  db.prepare(`UPDATE movies SET ${col} = ? WHERE id = ?`).run(url, req.params.id);
  res.json({ success: true, url });
});

router.post('/artwork/tv/:id/upload', requireAdmin, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const { type } = req.body;
  if (!['poster', 'backdrop'].includes(type)) return res.status(400).json({ error: 'type must be poster or backdrop' });
  const url = `/uploads/${req.file.filename}`;
  const col = type === 'poster' ? 'poster_path' : 'backdrop_path';
  db.prepare(`UPDATE tv_shows SET ${col} = ? WHERE id = ?`).run(url, req.params.id);
  res.json({ success: true, url });
});

// ── Streamlings (kids profiles) ──────────────────────────────────────────────
// Rules: titles whose age rating is within maxAge (when useRatings is on), plus
// per-title choices that always win. See services/kids.js.
const kids = require('../services/kids');

router.get('/kids', requireAdmin, (req, res) => {
  const { posterUrl } = require('../services/tmdb');
  const isFullUrl = (p) => p && (p.startsWith('http://') || p.startsWith('https://') || p.startsWith('/uploads/'));
  const img = (p) => (isFullUrl(p) ? p : posterUrl(p));
  const cfg = kids.getKidsConfig();
  const list = (mediaType, table, yearExpr) => {
    const overrides = kids.getOverrides(mediaType);
    return db.prepare(`SELECT id, title, ${yearExpr} AS year, content_rating, poster_path FROM ${table} ORDER BY title COLLATE NOCASE`).all()
      .map(r => {
        const d = kids.decide(r, cfg, overrides);
        return { id: r.id, title: r.title, year: r.year, content_rating: r.content_rating, age: d.age,
                 poster_url: img(r.poster_path), allowed: d.allowed, byRating: d.byRating, override: d.override };
      });
  };
  res.json({
    config: cfg,
    movies: list('movie', 'movies', 'year'),
    shows: list('show', 'tv_shows', "substr(first_air_date, 1, 4)"),
  });
});

router.put('/kids/config', requireAdmin, (req, res) => {
  const { useRatings, maxAge, allowUnrated } = req.body;
  const upsert = db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)');
  if (maxAge !== undefined) {
    const age = parseInt(maxAge, 10);
    if (!(age >= 0 && age <= 18)) return res.status(400).json({ error: 'Maximum age must be between 0 and 18' });
    upsert.run('kids_max_age', String(age));
  }
  if (useRatings !== undefined) upsert.run('kids_use_ratings', useRatings ? 'true' : 'false');
  if (allowUnrated !== undefined) upsert.run('kids_allow_unrated', allowUnrated ? 'true' : 'false');
  kids.clearKidsCache();
  res.json({ config: kids.getKidsConfig() });
});

// allowed: true / false = manual choice; null = go back to the rating rule.
router.put('/kids/override', requireAdmin, (req, res) => {
  const { mediaType, mediaId, allowed } = req.body;
  if (!['movie', 'show'].includes(mediaType)) return res.status(400).json({ error: 'mediaType must be movie or show' });
  const table = mediaType === 'movie' ? 'movies' : 'tv_shows';
  if (!db.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(mediaId)) return res.status(404).json({ error: 'Title not found' });
  if (allowed === null || allowed === undefined) {
    db.prepare('DELETE FROM kids_overrides WHERE media_type = ? AND media_id = ?').run(mediaType, mediaId);
  } else {
    db.prepare('INSERT OR REPLACE INTO kids_overrides (media_type, media_id, allowed) VALUES (?, ?, ?)').run(mediaType, mediaId, allowed ? 1 : 0);
  }
  kids.clearKidsCache();
  res.json({ success: true });
});

router.post('/kids/override/reset', requireAdmin, (req, res) => {
  const { mediaType } = req.body || {};
  const r = ['movie', 'show'].includes(mediaType)
    ? db.prepare('DELETE FROM kids_overrides WHERE media_type = ?').run(mediaType)
    : db.prepare('DELETE FROM kids_overrides').run();
  kids.clearKidsCache();
  res.json({ success: true, cleared: r.changes });
});

module.exports = router;
