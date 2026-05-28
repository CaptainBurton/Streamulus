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
  // Match "Title (Year)" or "Title.Year" or "Title Year"
  const yearMatch = base.match(/^(.+?)[\s._\-\[(\s]+((?:19|20)\d{2})[\s._\-\])]?/);
  if (yearMatch) {
    return {
      title: yearMatch[1].replace(/[._]/g, ' ').trim(),
      year: parseInt(yearMatch[2])
    };
  }
  return { title: base.replace(/[._]/g, ' ').trim(), year: null };
}

function parseTVFilename(filename) {
  const base = path.basename(filename, path.extname(filename));
  // Match S01E01 or 1x01 patterns
  const match = base.match(/^(.+?)[.\s_\-]+[Ss](\d{1,2})[Ee](\d{1,2})/);
  if (match) {
    return {
      showTitle: match[1].replace(/[._]/g, ' ').trim(),
      season: parseInt(match[2]),
      episode: parseInt(match[3])
    };
  }
  // Match 1x01 pattern
  const altMatch = base.match(/^(.+?)[.\s_\-]+(\d{1,2})x(\d{1,2})/i);
  if (altMatch) {
    return {
      showTitle: altMatch[1].replace(/[._]/g, ' ').trim(),
      season: parseInt(altMatch[2]),
      episode: parseInt(altMatch[3])
    };
  }
  return null;
}

async function scanMovieLibrary(library) {
  const files = getVideoFiles(library.path);
  let added = 0;
  for (const filePath of files) {
    const existing = db.prepare('SELECT id FROM movies WHERE file_path = ?').get(filePath);
    if (existing) continue;

    const { title, year } = parseMovieFilename(filePath);
    let tmdbData = await tmdb.searchMovie(title, year);

    db.prepare(`
      INSERT INTO movies (library_id, file_path, title, year, tmdb_id, overview, poster_path, backdrop_path, rating, genres)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      library.id,
      filePath,
      tmdbData?.title || title,
      tmdbData?.release_date?.split('-')[0] || year,
      tmdbData?.id || null,
      tmdbData?.overview || null,
      tmdbData?.poster_path || null,
      tmdbData?.backdrop_path || null,
      tmdbData?.vote_average || null,
      tmdbData?.genre_ids ? JSON.stringify(tmdbData.genre_ids) : null
    );
    added++;
  }
  db.prepare('UPDATE libraries SET last_scanned = CURRENT_TIMESTAMP WHERE id = ?').run(library.id);
  return { scanned: files.length, added };
}

async function scanTVLibrary(library) {
  const files = getVideoFiles(library.path);
  let added = 0;

  for (const filePath of files) {
    const existing = db.prepare('SELECT id FROM episodes WHERE file_path = ?').get(filePath);
    if (existing) continue;

    const parsed = parseTVFilename(filePath);
    if (!parsed) continue;

    const { showTitle, season, episode } = parsed;

    // Find or create show
    let show = db.prepare('SELECT id FROM tv_shows WHERE title = ? AND library_id = ?').get(showTitle, library.id);
    if (!show) {
      const tmdbData = await tmdb.searchTV(showTitle);
      const insertResult = db.prepare(`
        INSERT INTO tv_shows (library_id, title, tmdb_id, overview, poster_path, backdrop_path, rating, genres, status, first_air_date)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        library.id,
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
      show = { id: insertResult.lastInsertRowid };
    }

    // Get episode metadata if show has tmdb_id
    const showRow = db.prepare('SELECT tmdb_id FROM tv_shows WHERE id = ?').get(show.id);
    let epData = null;
    if (showRow?.tmdb_id) {
      epData = await tmdb.getEpisodeDetails(showRow.tmdb_id, season, episode);
    }

    db.prepare(`
      INSERT INTO episodes (show_id, file_path, season, episode_number, title, overview, still_path)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      show.id,
      filePath,
      season,
      episode,
      epData?.name || `Episode ${episode}`,
      epData?.overview || null,
      epData?.still_path || null
    );
    added++;
  }

  db.prepare('UPDATE libraries SET last_scanned = CURRENT_TIMESTAMP WHERE id = ?').run(library.id);
  return { scanned: files.length, added };
}

async function scanAll() {
  const libraries = db.prepare('SELECT * FROM libraries').all();
  const results = [];
  for (const lib of libraries) {
    if (lib.type === 'movies') {
      results.push({ library: lib.name, ...(await scanMovieLibrary(lib)) });
    } else if (lib.type === 'tv') {
      results.push({ library: lib.name, ...(await scanTVLibrary(lib)) });
    }
  }
  return results;
}

module.exports = { scanAll, scanMovieLibrary, scanTVLibrary, getVideoFiles };
