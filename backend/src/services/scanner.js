const fs = require('fs');
const path = require('path');
const db = require('../database/db');
const tmdb = require('./tmdb');

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

async function processMovieFile(filePath, libraryId) {
  const existing = db.prepare('SELECT id FROM movies WHERE file_path = ?').get(filePath);
  if (existing) return 'skipped';

  const { title, year } = parseMovieFilename(filePath);
  const tmdbData = await tmdb.searchMovie(title, year);

  const insertResult = db.prepare(`
    INSERT OR IGNORE INTO movies (library_id, file_path, title, year, tmdb_id, overview, poster_path, backdrop_path, rating, genres)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    libraryId, filePath,
    tmdbData?.title || title,
    tmdbData?.release_date?.split('-')[0] || year,
    tmdbData?.id || null,
    tmdbData?.overview || null,
    tmdbData?.poster_path || null,
    tmdbData?.backdrop_path || null,
    tmdbData?.vote_average || null,
    tmdbData?.genre_ids ? JSON.stringify(tmdbData.genre_ids) : null
  );
  return insertResult.changes > 0 ? 'added' : 'skipped';
}

async function processTVFile(filePath, libraryId) {
  const existing = db.prepare('SELECT id FROM episodes WHERE file_path = ?').get(filePath);
  if (existing) return 'skipped';

  const parsed = parseTVFilename(filePath);
  if (!parsed) return 'skipped';

  const { showTitle, season, episode } = parsed;

  let show = db.prepare('SELECT id, tmdb_id FROM tv_shows WHERE title = ? AND library_id = ?').get(showTitle, libraryId);
  if (!show) {
    const tmdbData = await tmdb.searchTV(showTitle);
    const result = db.prepare(`
      INSERT INTO tv_shows (library_id, title, tmdb_id, overview, poster_path, backdrop_path, rating, genres, status, first_air_date)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      libraryId,
      tmdbData?.name || showTitle,
      tmdbData?.id || null,
      tmdbData?.overview || null,
      tmdbData?.poster_path || null,
      tmdbData?.backdrop_path || null,
      tmdbData?.vote_average || null,
      tmdbData?.genre_ids ? JSON.stringify(tmdbData.genre_ids) : null,
      tmdbData?.status || null,
      tmdbData?.first_air_date || null
    );
    show = { id: result.lastInsertRowid, tmdb_id: tmdbData?.id || null };
  }

  let epData = null;
  if (show.tmdb_id) {
    epData = await tmdb.getEpisodeDetails(show.tmdb_id, season, episode);
  }

  const epInsert = db.prepare(`
    INSERT OR IGNORE INTO episodes (show_id, file_path, season, episode_number, title, overview, still_path)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    show.id, filePath, season, episode,
    epData?.name || `Episode ${episode}`,
    epData?.overview || null,
    epData?.still_path || null
  );
  return epInsert.changes > 0 ? 'added' : 'skipped';
}

// Scan with per-file progress events via callback
async function scanAllWithProgress(onProgress) {
  const libraries = db.prepare('SELECT * FROM libraries').all();

  if (libraries.length === 0) {
    onProgress({ type: 'error', message: 'No libraries configured. Add a library first.' });
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

      onProgress({ type: 'scanning', library: lib.name, file: fileName, index: i + 1, total: files.length, percent });

      try {
        let result;
        if (lib.type === 'movies') {
          result = await processMovieFile(filePath, lib.id);
        } else {
          result = await processTVFile(filePath, lib.id);
        }
        if (result === 'added') added++;
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

// Non-streaming scan (used during initial setup)
async function scanAll() {
  const results = [];
  const events = [];
  await scanAllWithProgress(e => events.push(e));
  const libraries = db.prepare('SELECT * FROM libraries').all();
  for (const lib of libraries) {
    const libEvents = events.filter(e => e.library === lib.name);
    const done = libEvents.find(e => e.type === 'library_done');
    if (done) results.push({ library: lib.name, added: done.added, skipped: done.skipped, total: done.total });
  }
  return results;
}

function validatePath(dirPath) {
  const exists = fs.existsSync(dirPath);
  const files = exists ? getVideoFiles(dirPath) : [];
  return { exists, fileCount: files.length };
}

module.exports = { scanAll, scanAllWithProgress, getVideoFiles, validatePath };
