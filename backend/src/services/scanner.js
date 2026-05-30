const fs = require('fs');
const path = require('path');
const db = require('../database/db');
const tmdb = require('./tmdb');
const tvdb = require('./tvdb');
const imdb = require('./imdb');

function getSource(key, fallback) {
  return db.prepare('SELECT value FROM config WHERE key = ?').get(key)?.value || fallback;
}

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.ts', '.m2ts']);

function getVideoFiles(dirPath) {
  const files = [];
  if (!fs.existsSync(dirPath)) return files;
  function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && VIDEO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        files.push(full);
      }
    }
  }
  walk(dirPath);
  return files;
}

function parseMovieFilename(filename) {
  const base = path.basename(filename, path.extname(filename));
  const yearMatch = base.match(/^(.+?)[\s._\-[(]+((?:19|20)\d{2})[\s._\-\])]?/);
  if (yearMatch) {
    return { title: yearMatch[1].replace(/[._]/g, ' ').trim(), year: parseInt(yearMatch[2]) };
  }
  return { title: base.replace(/[._]/g, ' ').trim(), year: null };
}

function parseTVFilename(filename) {
  const base = path.basename(filename, path.extname(filename));
  const match = base.match(/^(.+?)[.\s_-]+[Ss](\d{1,2})[Ee](\d{1,2})/);
  if (match) {
    return { showTitle: match[1].replace(/[._]/g, ' ').trim(), season: parseInt(match[2]), episode: parseInt(match[3]) };
  }
  const altMatch = base.match(/^(.+?)[.\s_-]+(\d{1,2})x(\d{1,2})/i);
  if (altMatch) {
    return { showTitle: altMatch[1].replace(/[._]/g, ' ').trim(), season: parseInt(altMatch[2]), episode: parseInt(altMatch[3]) };
  }
  return null;
}

// Returns { status: 'added'|'skipped', title }
async function processMovieFile(filePath, libraryId) {
  const existing = db.prepare('SELECT id, title FROM movies WHERE file_path = ?').get(filePath);
  if (existing) return { status: 'skipped', title: existing.title };

  const { title, year } = parseMovieFilename(filePath);
  const sourceOrder = JSON.parse(getSource('movie_source_order', '["tmdb","imdb"]'));

  let meta = null;
  for (const src of sourceOrder) {
    if (meta) break;
    if (src === 'imdb' && imdb.isConfigured()) {
      const d = await imdb.searchMovie(title, year);
      if (d) meta = {
        resolvedTitle: d.title || title, year: d.year || year,
        tmdb_id: null, overview: d.overview,
        poster_path: d.poster_path, backdrop_path: d.backdrop_path,
        rating: d.rating, genres: d.genres,
        imdb_id: d.imdb_id, imdb_rating: d.imdb_rating, content_rating: d.content_rating,
      };
    } else if (src === 'tmdb') {
      const d = await tmdb.searchMovie(title, year);
      if (d) meta = {
        resolvedTitle: d.title || title, year: d.release_date?.split('-')[0] || year,
        tmdb_id: d.id, overview: d.overview,
        poster_path: d.poster_path, backdrop_path: d.backdrop_path,
        rating: d.vote_average, genres: d.genre_ids ? JSON.stringify(d.genre_ids) : null,
        imdb_id: null, imdb_rating: null, content_rating: null,
      };
    }
  }

  const resolvedTitle = meta?.resolvedTitle || title;
  const r = db.prepare(`
    INSERT OR IGNORE INTO movies
      (library_id, file_path, title, year, tmdb_id, overview, poster_path, backdrop_path,
       rating, genres, imdb_id, imdb_rating, content_rating)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    libraryId, filePath, resolvedTitle, meta?.year || year,
    meta?.tmdb_id || null, meta?.overview || null,
    meta?.poster_path || null, meta?.backdrop_path || null,
    meta?.rating || null, meta?.genres || null,
    meta?.imdb_id || null, meta?.imdb_rating || null, meta?.content_rating || null,
  );
  return { status: r.changes > 0 ? 'added' : 'skipped', title: resolvedTitle };
}

// Returns { status: 'added'|'skipped', title }
async function processTVFile(filePath, libraryId) {
  const existing = db.prepare('SELECT id FROM episodes WHERE file_path = ?').get(filePath);
  if (existing) return { status: 'skipped', title: path.basename(filePath) };

  const parsed = parseTVFilename(filePath);
  if (!parsed) return { status: 'skipped', title: path.basename(filePath) };

  const { showTitle, season, episode } = parsed;

  // Fetch show metadata using the configured source.
  // Fetching metadata BEFORE the DB lookup is critical: it gives us the
  // canonical show ID so we can find existing rows even when filenames parse
  // to slightly different title strings (e.g. "American Dad" vs "American Dad!").
  let showMeta = null;
  const tvSourceOrder = JSON.parse(getSource('tv_source_order', '["tvdb","tmdb","imdb"]'));

  for (const src of tvSourceOrder) {
    if (showMeta) break;
    if (src === 'tvdb' && tvdb.isConfigured()) {
      const d = await tvdb.searchSeries(showTitle);
      if (d) showMeta = { ...d, source: 'tvdb' };
    } else if (src === 'tmdb') {
      const tmdbData = await tmdb.searchTV(showTitle);
      if (tmdbData) showMeta = {
        source: 'tmdb', tvdb_id: null, tmdb_id: tmdbData.id, name: tmdbData.name,
        overview: tmdbData.overview, poster_path: tmdbData.poster_path,
        backdrop_path: tmdbData.backdrop_path, rating: tmdbData.vote_average,
        genres: tmdbData.genre_ids ? JSON.stringify(tmdbData.genre_ids) : null,
        status: tmdbData.status, first_air_date: tmdbData.first_air_date,
      };
    } else if (src === 'imdb' && imdb.isConfigured()) {
      const d = await imdb.searchSeries(showTitle);
      if (d) showMeta = { ...d, source: 'imdb' };
    }
  }

  // Deduplicate: find existing show by metadata ID first, then fall back to canonical title.
  // This prevents a second row being created when a different file parses to a
  // slightly different title string than the one already stored.
  let show = null;
  if (showMeta?.tvdb_id) {
    show = db.prepare('SELECT id, tmdb_id, tvdb_id FROM tv_shows WHERE tvdb_id = ? AND library_id = ?')
      .get(showMeta.tvdb_id, libraryId);
  }
  if (!show && showMeta?.tmdb_id) {
    show = db.prepare('SELECT id, tmdb_id, tvdb_id FROM tv_shows WHERE tmdb_id = ? AND library_id = ?')
      .get(showMeta.tmdb_id, libraryId);
  }
  if (!show) {
    const canonicalTitle = showMeta?.name || showTitle;
    show = db.prepare('SELECT id, tmdb_id, tvdb_id FROM tv_shows WHERE title = ? AND library_id = ?')
      .get(canonicalTitle, libraryId);
  }

  if (!show) {
    try {
      const result = db.prepare(`
        INSERT INTO tv_shows
          (library_id, title, tmdb_id, tvdb_id, overview, poster_path, backdrop_path, rating, genres, status, first_air_date)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        libraryId,
        showMeta?.name || showTitle,
        showMeta?.tmdb_id || null,
        showMeta?.tvdb_id || null,
        showMeta?.overview || null,
        showMeta?.poster_path || null,
        showMeta?.backdrop_path || null,
        showMeta?.rating || null,
        showMeta?.genres || null,
        showMeta?.status || null,
        showMeta?.first_air_date || null,
      );
      show = { id: result.lastInsertRowid, tmdb_id: showMeta?.tmdb_id || null, tvdb_id: showMeta?.tvdb_id || null };
    } catch {
      // Concurrent scan inserted the same show — re-fetch
      const canonicalTitle = showMeta?.name || showTitle;
      show = db.prepare('SELECT id, tmdb_id, tvdb_id FROM tv_shows WHERE title = ? AND library_id = ?')
        .get(canonicalTitle, libraryId);
      if (!show) throw new Error(`Could not insert or find show: ${showTitle}`);
    }
  }

  // Fetch episode metadata from whichever service has a match
  let epData = null;
  if (show.tvdb_id && tvdb.isConfigured()) {
    epData = await tvdb.getEpisodeDetails(show.tvdb_id, season, episode);
  }
  if (!epData && show.tmdb_id) {
    const tmdbEp = await tmdb.getEpisodeDetails(show.tmdb_id, season, episode);
    if (tmdbEp) epData = { name: tmdbEp.name, overview: tmdbEp.overview, still_path: tmdbEp.still_path };
  }

  const epTitle = epData?.name || `S${String(season).padStart(2,'0')}E${String(episode).padStart(2,'0')}`;

  const r = db.prepare(`
    INSERT OR IGNORE INTO episodes
      (show_id, file_path, season, episode_number, title, overview, still_path)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(show.id, filePath, season, episode, epTitle, epData?.overview || null, epData?.still_path || null);

  return { status: r.changes > 0 ? 'added' : 'skipped', title: `${showMeta?.name || showTitle} — ${epTitle}` };
}

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

    const files = getVideoFiles(lib.path);
    onProgress({ type: 'found', library: lib.name, count: files.length });

    if (files.length === 0) {
      onProgress({ type: 'library_done', library: lib.name, added: 0, skipped: 0, errors: 0, total: 0 });
      continue;
    }

    let added = 0, skipped = 0, errors = 0;

    for (let i = 0; i < files.length; i++) {
      const filePath = files[i];
      const fileName = path.basename(filePath);
      const percent = Math.round(((i + 1) / files.length) * 100);

      // Announce which file is about to be processed
      onProgress({ type: 'file_start', library: lib.name, file: fileName, index: i + 1, total: files.length, percent });

      try {
        const res = lib.type === 'movies'
          ? await processMovieFile(filePath, lib.id)
          : await processTVFile(filePath, lib.id);

        // Report result for this file
        onProgress({ type: 'file_done', file: fileName, title: res.title, result: res.status, index: i + 1, total: files.length, percent });

        if (res.status === 'added') added++;
        else skipped++;
      } catch (err) {
        errors++;
        onProgress({ type: 'file_error', file: fileName, message: err.message });
      }
    }

    db.prepare('UPDATE libraries SET last_scanned = CURRENT_TIMESTAMP WHERE id = ?').run(lib.id);
    grandTotal.added += added;
    grandTotal.skipped += skipped;
    grandTotal.errors += errors;
    grandTotal.files += files.length;

    onProgress({ type: 'library_done', library: lib.name, added, skipped, errors, total: files.length });
  }

  onProgress({ type: 'complete', ...grandTotal });
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

function validatePath(dirPath) {
  const exists = fs.existsSync(dirPath);
  const files = exists ? getVideoFiles(dirPath) : [];
  return { exists, fileCount: files.length };
}

module.exports = { scanAll, scanAllWithProgress, getVideoFiles, validatePath };
