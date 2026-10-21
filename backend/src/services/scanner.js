const fs = require('fs');
const path = require('path');
const db = require('../database/db');
const tmdb = require('./tmdb');
const tvdb = require('./tvdb');
const imdb = require('./imdb');
const naming = require('./naming');
const library = require('./library');

function getSource(key, fallback) {
  return db.prepare('SELECT value FROM config WHERE key = ?').get(key)?.value || fallback;
}

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.ts', '.m2ts']);

// Async on purpose: on a large or network-mounted library a synchronous walk
// blocks the whole server — every request, and the Docker health check, waits
// until it finishes, which marks the container unhealthy.
async function getVideoFiles(dirPath) {
  const files = [];
  async function walk(dir) {
    let entries;
    try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile() && VIDEO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        files.push(full);
      }
    }
  }
  await walk(dirPath);
  return files;
}

// A file that isn't in the DB by its exact path may be one we already know
// about that has moved (e.g. the media folder is mounted somewhere else after a
// redeploy). If exactly one row has the same filename and its old path no
// longer exists on disk, point that row at the new path instead of adding a
// duplicate, so its watch history is kept. Returns the updated row or null.
function relocateMissing(table, filePath) {
  const like = '%/' + path.basename(filePath).replace(/[\\%_]/g, '\\$&');
  const stale = db.prepare(`SELECT * FROM ${table} WHERE file_path LIKE ? ESCAPE '\\'`).all(like)
    .filter(r => !fs.existsSync(r.file_path));
  if (stale.length !== 1) return null;
  db.prepare(`UPDATE ${table} SET file_path = ? WHERE id = ?`).run(filePath, stale[0].id);
  return stale[0];
}

// Metadata for a movie: straight from an id in its folder / file name when there
// is one ({tmdb-123}, {imdb-tt123}), otherwise searched by title and year.
// "ja", "jpn", "Japanese" → "ja" (NULL when the source doesn't say, so the
// languages.js look-up still runs for it).
const langCode = (raw) => (raw ? (require('./subtitles').language(raw)?.code || String(raw).toLowerCase()) : null);

async function lookupMovie(parsed) {
  const { title, year, ids } = parsed;
  if (ids.tmdb) {
    const d = await tmdb.getMovieDetails(ids.tmdb);
    if (d) return {
      resolvedTitle: d.title || title, year: d.release_date?.split('-')[0] || year,
      tmdb_id: d.id, overview: d.overview, poster_path: d.poster_path, backdrop_path: d.backdrop_path,
      rating: d.vote_average, genres: d.genres ? JSON.stringify(d.genres.map(g => g.id)) : null,
      imdb_id: d.imdb_id || null, imdb_rating: null, content_rating: null,
      original_language: langCode(d.original_language),
    };
  }
  if (ids.imdb && imdb.isConfigured()) {
    const d = await imdb.getTitle(ids.imdb).catch(() => null);
    if (d) return {
      resolvedTitle: d.title || title, year: d.year || year, tmdb_id: null, overview: d.overview,
      poster_path: d.poster_path, backdrop_path: d.backdrop_path, rating: d.rating, genres: d.genres,
      imdb_id: d.imdb_id || ids.imdb, imdb_rating: d.imdb_rating, content_rating: d.content_rating,
    };
  }
  const sourceOrder = JSON.parse(getSource('movie_source_order', '["tmdb","imdb"]'));
  for (const src of sourceOrder) {
    if (src === 'imdb' && imdb.isConfigured()) {
      const d = await imdb.searchMovie(title, year);
      if (d) return {
        resolvedTitle: d.title || title, year: d.year || year,
        tmdb_id: null, overview: d.overview,
        poster_path: d.poster_path, backdrop_path: d.backdrop_path,
        rating: d.rating, genres: d.genres,
        imdb_id: d.imdb_id, imdb_rating: d.imdb_rating, content_rating: d.content_rating,
      };
    } else if (src === 'tmdb') {
      const d = await tmdb.searchMovie(title, year);
      if (d) return {
        resolvedTitle: d.title || title, year: d.release_date?.split('-')[0] || year,
        tmdb_id: d.id, overview: d.overview,
        poster_path: d.poster_path, backdrop_path: d.backdrop_path,
        rating: d.vote_average, genres: d.genre_ids ? JSON.stringify(d.genre_ids) : null,
        imdb_id: null, imdb_rating: null, content_rating: null,
        original_language: langCode(d.original_language),
      };
    }
  }
  return null;
}

// Returns { status: 'added'|'skipped', title }
async function processMovieFile(filePath, lib, ctx) {
  const libraryId = lib.id;
  if (ctx.isExcluded(filePath)) return { status: 'skipped', title: `${path.basename(filePath)} (removed by admin)` };
  const existing = db.prepare('SELECT id, title FROM movies WHERE file_path = ?').get(filePath);
  if (existing) return { status: 'skipped', title: existing.title };

  const moved = relocateMissing('movies', filePath);
  if (moved) {
    db.prepare('UPDATE movies SET library_id = ? WHERE id = ?').run(libraryId, moved.id);
    return { status: 'skipped', title: `${moved.title} (path updated)` };
  }

  const parsed = naming.parseMovie(lib.path, filePath, ctx.cfg);
  if (!parsed) return { status: 'skipped', title: `${path.basename(filePath)} (extra / sample — not a movie)` };
  const { title, year } = parsed;
  const meta = await lookupMovie(parsed);

  // Replaced file (e.g. a quality upgrade with a new name): take over the old
  // entry whose file is gone, keeping its watch history, instead of a duplicate.
  if (meta?.tmdb_id) {
    const old = db.prepare('SELECT id, title, file_path FROM movies WHERE tmdb_id = ? AND library_id = ?').all(meta.tmdb_id, libraryId)
      .find(r => !fs.existsSync(r.file_path));
    if (old) {
      db.prepare('UPDATE movies SET file_path = ?, duration = NULL WHERE id = ?').run(filePath, old.id);
      return { status: 'skipped', title: `${old.title} (file replaced)` };
    }
  }

  const resolvedTitle = meta?.resolvedTitle || title;
  const r = db.prepare(`
    INSERT OR IGNORE INTO movies
      (library_id, file_path, title, year, tmdb_id, overview, poster_path, backdrop_path,
       rating, genres, imdb_id, imdb_rating, content_rating, original_language)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    libraryId, filePath, resolvedTitle, meta?.year || year,
    meta?.tmdb_id || null, meta?.overview || null,
    meta?.poster_path || null, meta?.backdrop_path || null,
    meta?.rating || null, meta?.genres || null,
    meta?.imdb_id || null, meta?.imdb_rating || null, meta?.content_rating || null,
    meta?.original_language || null,
  );
  return { status: r.changes > 0 ? 'added' : 'skipped', title: resolvedTitle };
}

// Show metadata: from an id in the folder name when there is one ({tvdb-123},
// [tmdbid-456]), otherwise searched by the folder's title (and year), in the
// configured source order.
async function lookupShow(parsed) {
  const { showTitle, year, ids } = parsed;
  if (ids.tvdb && tvdb.isConfigured()) {
    const d = await tvdb.getSeriesInfo(ids.tvdb).catch(() => null);
    if (d) return {
      source: 'tvdb', tvdb_id: d.tvdb_id, tmdb_id: ids.tmdb || null, name: d.name || showTitle, overview: d.overview,
      poster_path: d.image, backdrop_path: null, rating: null,
      genres: d.genres?.length ? JSON.stringify(d.genres) : null, status: d.status, first_air_date: d.first_air_date,
      original_language: langCode(d.original_language),
    };
  }
  if (ids.tmdb) {
    const d = await tmdb.getTVDetails(ids.tmdb);
    if (d) return {
      source: 'tmdb', tvdb_id: ids.tvdb || null, tmdb_id: d.id, name: d.name || showTitle, overview: d.overview,
      poster_path: d.poster_path, backdrop_path: d.backdrop_path, rating: d.vote_average,
      genres: d.genres ? JSON.stringify(d.genres.map(g => g.id)) : null, status: d.status, first_air_date: d.first_air_date,
      original_language: langCode(d.original_language),
    };
  }
  const tvSourceOrder = JSON.parse(getSource('tv_source_order', '["tvdb","tmdb","imdb"]'));
  for (const src of tvSourceOrder) {
    if (src === 'tvdb' && tvdb.isConfigured()) {
      if (year) {
        const hit = (await tvdb.searchSeriesList(showTitle, year).catch(() => []))[0];
        if (hit) return { source: 'tvdb', tvdb_id: hit.tvdb_id, name: hit.name, overview: hit.overview, poster_path: hit.poster, first_air_date: hit.year ? `${hit.year}-01-01` : null };
      }
      const d = await tvdb.searchSeries(showTitle);
      if (d) return { ...d, source: 'tvdb' };
    } else if (src === 'tmdb') {
      const tmdbData = year
        ? ((await tmdb.searchTVList(showTitle, year).catch(() => []))[0] || await tmdb.searchTV(showTitle))
        : await tmdb.searchTV(showTitle);
      if (tmdbData) return {
        source: 'tmdb', tvdb_id: null, tmdb_id: tmdbData.id, name: tmdbData.name,
        overview: tmdbData.overview, poster_path: tmdbData.poster_path,
        backdrop_path: tmdbData.backdrop_path, rating: tmdbData.vote_average,
        genres: tmdbData.genre_ids ? JSON.stringify(tmdbData.genre_ids) : null,
        status: tmdbData.status, first_air_date: tmdbData.first_air_date,
        original_language: langCode(tmdbData.original_language),
      };
    } else if (src === 'imdb' && imdb.isConfigured()) {
      const d = await imdb.searchSeries(showTitle);
      if (d) return { ...d, source: 'imdb' };
    }
  }
  return null;
}

// The show a file belongs to: one per series folder (looked up once per scan).
async function resolveShow(parsed, libraryId, ctx) {
  const cached = ctx.shows.get(parsed.showKey);
  if (cached) return cached;
  const isFolder = !parsed.showKey.startsWith('title:');
  const find = (where, ...args) => db.prepare(`SELECT id, title, tmdb_id, tvdb_id, folder_path FROM tv_shows WHERE ${where} AND library_id = ?`).get(...args, libraryId);

  let show = isFolder ? find('folder_path = ?', parsed.showKey) : null;
  if (!show && parsed.ids.tvdb) show = find('tvdb_id = ?', parsed.ids.tvdb);
  if (!show && parsed.ids.tmdb) show = find('tmdb_id = ?', parsed.ids.tmdb);
  if (!show) {
    const meta = await lookupShow(parsed);
    if (meta?.tvdb_id) show = find('tvdb_id = ?', meta.tvdb_id);
    if (!show && meta?.tmdb_id) show = find('tmdb_id = ?', meta.tmdb_id);
    // Same title, not already claimed by another folder.
    if (!show) show = find('title = ? AND (folder_path IS NULL OR folder_path = ?)', meta?.name || parsed.showTitle, parsed.showKey);
    if (!show) {
      const result = db.prepare(`
        INSERT INTO tv_shows
          (library_id, title, tmdb_id, tvdb_id, overview, poster_path, backdrop_path, rating, genres, status, first_air_date, folder_path, original_language)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        libraryId, meta?.name || parsed.showTitle, meta?.tmdb_id || null, meta?.tvdb_id || null,
        meta?.overview || null, meta?.poster_path || null, meta?.backdrop_path || null, meta?.rating || null,
        meta?.genres || null, meta?.status || null,
        meta?.first_air_date || (parsed.year ? `${parsed.year}-01-01` : null),
        isFolder ? parsed.showKey : null,
        meta?.original_language || null,
      );
      show = { id: result.lastInsertRowid, title: meta?.name || parsed.showTitle, tmdb_id: meta?.tmdb_id || null, tvdb_id: meta?.tvdb_id || null };
    }
  }
  if (isFolder && show.folder_path !== parsed.showKey) {
    db.prepare('UPDATE tv_shows SET folder_path = ? WHERE id = ?').run(parsed.showKey, show.id);
    show.folder_path = parsed.showKey;
  }
  ctx.shows.set(parsed.showKey, show);
  return show;
}

// Returns { status: 'added'|'skipped', title }
async function processTVFile(filePath, lib, ctx) {
  if (ctx.isExcluded(filePath)) return { status: 'skipped', title: `${path.basename(filePath)} (removed by admin)` };
  const existing = db.prepare('SELECT id FROM episodes WHERE file_path = ?').get(filePath);
  if (existing) return { status: 'skipped', title: path.basename(filePath) };

  const moved = relocateMissing('episodes', filePath);
  if (moved) {
    // Keep the show attached to the library it was found in, so removing an
    // old library later doesn't take the relocated episodes with it.
    db.prepare('UPDATE tv_shows SET library_id = ? WHERE id = ?').run(lib.id, moved.show_id);
    return { status: 'skipped', title: `${moved.title || path.basename(filePath)} (path updated)` };
  }

  const parsed = naming.parseEpisode(lib.path, filePath, ctx.cfg);
  if (!parsed) return { status: 'skipped', title: `${path.basename(filePath)} (couldn't tell which episode)` };

  const show = await resolveShow(parsed, lib.id, ctx);
  const { season } = parsed;
  let episode = parsed.episode;
  if (episode == null) {
    // An unnumbered extra: next free number in its season (usually Specials).
    episode = (db.prepare('SELECT MAX(episode_number) AS n FROM episodes WHERE show_id = ? AND season = ?').get(show.id, season).n || 0) + 1;
  }

  // Replaced file (e.g. a quality upgrade with a new name): take over the old
  // episode whose file is gone, keeping its watch history.
  if (!parsed.extra) {
    const old = db.prepare('SELECT id, file_path, title FROM episodes WHERE show_id = ? AND season = ? AND episode_number = ?')
      .all(show.id, season, episode).find(r => !fs.existsSync(r.file_path));
    if (old) {
      db.prepare('UPDATE episodes SET file_path = ?, duration = NULL WHERE id = ?').run(filePath, old.id);
      return { status: 'skipped', title: `${show.title} — ${old.title} (file replaced)` };
    }
  }

  // Episode metadata from whichever service has a match (not for extras).
  let epData = null;
  if (!parsed.extra) {
    if (show.tvdb_id && tvdb.isConfigured()) {
      epData = await tvdb.getEpisodeDetails(show.tvdb_id, season, episode);
    }
    if (!epData && show.tmdb_id) {
      const tmdbEp = await tmdb.getEpisodeDetails(show.tmdb_id, season, episode);
      if (tmdbEp) epData = { name: tmdbEp.name, overview: tmdbEp.overview, still_path: tmdbEp.still_path };
    }
  }

  const epTitle = epData?.name || parsed.episodeTitle || `S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`;

  const r = db.prepare(`
    INSERT OR IGNORE INTO episodes
      (show_id, file_path, season, episode_number, title, overview, still_path)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(show.id, filePath, season, episode, epTitle, epData?.overview || null, epData?.still_path || null);

  return { status: r.changes > 0 ? 'added' : 'skipped', title: `${show.title} — ${epTitle}` };
}

const extrasPath = (f) => path.dirname(f).split(path.sep).some(naming.isExtrasFolder);

async function scanAllWithProgress(onProgress, filterLibraryId = null) {
  const libraries = filterLibraryId
    ? db.prepare('SELECT * FROM libraries WHERE id = ?').all(filterLibraryId)
    : db.prepare('SELECT * FROM libraries').all();

  if (libraries.length === 0) {
    onProgress({ type: 'error', message: filterLibraryId ? 'Library not found.' : 'No libraries configured. Add a library first.' });
    return;
  }

  let grandTotal = { added: 0, skipped: 0, errors: 0, files: 0 };

  for (const lib of libraries) {
    if (!fs.existsSync(lib.path)) {
      onProgress({ type: 'library_error', library: lib.name, path: lib.path, message: `Path not found: ${lib.path}` });
      continue;
    }

    onProgress({ type: 'library_start', library: lib.name, path: lib.path, kind: lib.type });

    const allFiles = await getVideoFiles(lib.path);
    // Numbered episodes before unnumbered extras, so extras are numbered after them.
    const files = [...allFiles.filter(f => !extrasPath(f)), ...allFiles.filter(extrasPath)];
    onProgress({ type: 'found', library: lib.name, count: files.length });

    if (files.length === 0) {
      onProgress({ type: 'library_done', library: lib.name, added: 0, skipped: 0, errors: 0, total: 0 });
      continue;
    }

    let added = 0, skipped = 0, errors = 0;
    // Per-scan state: naming formats, removed-by-admin paths, and shows found so far.
    const ctx = { cfg: naming.getConfig(), isExcluded: library.excludedMatcher(), shows: new Map() };

    for (let i = 0; i < files.length; i++) {
      const filePath = files[i];
      const fileName = path.basename(filePath);
      const percent = Math.round(((i + 1) / files.length) * 100);

      // Announce which file is about to be processed
      onProgress({ type: 'file_start', library: lib.name, file: fileName, index: i + 1, total: files.length, percent });

      try {
        const res = lib.type === 'movies'
          ? await processMovieFile(filePath, lib, ctx)
          : await processTVFile(filePath, lib, ctx);

        // Report result for this file
        onProgress({ type: 'file_done', file: fileName, title: res.title, result: res.status, index: i + 1, total: files.length, percent });

        if (res.status === 'added') added++;
        else skipped++;
      } catch (err) {
        errors++;
        onProgress({ type: 'file_error', file: fileName, message: err.message });
      }
    }

    // Entries whose files are gone (renamed, upgraded or deleted outside Streamulus).
    if (getSource('library_remove_missing', 'true') === 'true') {
      const cleanup = library.removeMissing(lib, new Set(files));
      if (cleanup.removed) onProgress({ type: 'cleanup', library: lib.name, removed: cleanup.removed, message: `Removed ${cleanup.removed} item(s) whose files are gone` });
      if (cleanup.skipped) onProgress({ type: 'cleanup', library: lib.name, removed: 0, message: `Kept missing items: ${cleanup.skipped}` });
    }

    db.prepare('UPDATE libraries SET last_scanned = CURRENT_TIMESTAMP WHERE id = ?').run(lib.id);
    grandTotal.added += added;
    grandTotal.skipped += skipped;
    grandTotal.errors += errors;
    grandTotal.files += files.length;

    onProgress({ type: 'library_done', library: lib.name, added, skipped, errors, total: files.length });
  }

  // One show per series folder: merge any shows older scans split up.
  try {
    const { moved, merged } = library.regroupShows();
    if (moved || merged) onProgress({ type: 'cleanup', library: '', removed: 0, message: `Merged ${merged} duplicate show(s), regrouped ${moved} episode(s)` });
  } catch (err) {
    console.error('[scan] Regrouping shows failed:', err.message);
  }

  onProgress({ type: 'complete', ...grandTotal });
  // Newly added animated titles: find out which are anime (in the background).
  require('./languages').fillMissingLanguages()
    .catch(err => console.error('[languages] Failed:', err.message))
    .then(() => require('./english').fillMissingEnglish()) // English titles for foreign-language ones
    .catch(err => console.error('[english] Failed:', err.message))
    .then(() => require('./ratings').refreshRatings()) // age ratings for the country chosen in Settings
    .catch(err => console.error('[ratings] Failed:', err.message))
    .then(() => require('./streaming').afterScan()) // new titles' streaming services, if the admin asked
    .catch(err => console.error('[services] Failed:', err.message));
  // Read runtimes of newly added files in the background ("Ends at" times).
  require('./durations').fillMissingDurations().catch(() => {});
}

async function scanAll() {
  const events = [];
  await scanAllWithProgress(e => events.push(e));
  const libraries = db.prepare('SELECT * FROM libraries').all();
  return libraries.map(lib => {
    const done = events.find(e => e.type === 'library_done' && e.library === lib.name);
    return done ? { library: lib.name, added: done.added, skipped: done.skipped, total: done.total } : null;
  }).filter(Boolean);
}

async function validatePath(dirPath) {
  let exists = false;
  try { exists = (await fs.promises.stat(dirPath)).isDirectory(); } catch {}
  const files = exists ? await getVideoFiles(dirPath) : [];
  return { exists, fileCount: files.length };
}

module.exports = { scanAll, scanAllWithProgress, getVideoFiles, validatePath };
