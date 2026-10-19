// Library upkeep: removing titles (from Streamulus, or from disk too), the list of
// things removed but kept on disk, clearing out entries whose files are gone, and
// merging shows that were split into duplicates.
const fs = require('fs');
const path = require('path');
const db = require('../database/db');
const naming = require('./naming');

const VIDEO_EXT = new Set(['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.ts', '.m2ts']);
const SIDECAR_EXT = new Set(['.srt', '.vtt', '.ass', '.ssa', '.sub', '.idx', '.sup', '.nfo', '.jpg', '.jpeg', '.png', '.txt']);

// ── Exclusions ───────────────────────────────────────────────────────────────

/** A function telling whether a file is inside something the admin removed (kept on disk). */
function excludedMatcher() {
  const list = db.prepare('SELECT path FROM excluded_media').all().map(r => r.path);
  if (!list.length) return () => false;
  return (filePath) => list.some(p => filePath === p || filePath.startsWith(p + path.sep));
}

function addExclusion(p, libraryId, kind, title) {
  db.prepare(`INSERT OR REPLACE INTO excluded_media (path, library_id, kind, title, created_at) VALUES (?, ?, ?, ?, ?)`)
    .run(p, libraryId ?? null, kind, title ?? null, Date.now());
}

function listExclusions() {
  return db.prepare('SELECT * FROM excluded_media ORDER BY created_at DESC').all();
}

function removeExclusion(p) {
  return db.prepare('DELETE FROM excluded_media WHERE path = ?').run(p).changes > 0;
}

// ── Removing rows ────────────────────────────────────────────────────────────

const inList = (ids) => ids.map(() => '?').join(',');

function deleteMovieRows(ids) {
  if (!ids.length) return;
  db.prepare(`DELETE FROM watch_history WHERE media_type = 'movie' AND media_id IN (${inList(ids)})`).run(...ids);
  db.prepare(`DELETE FROM kids_overrides WHERE media_type = 'movie' AND media_id IN (${inList(ids)})`).run(...ids);
  db.prepare(`DELETE FROM movies WHERE id IN (${inList(ids)})`).run(...ids);
}

function deleteEpisodeRows(ids) {
  if (!ids.length) return;
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    db.prepare(`DELETE FROM watch_history WHERE media_type = 'episode' AND media_id IN (${inList(chunk)})`).run(...chunk);
    db.prepare(`DELETE FROM episodes WHERE id IN (${inList(chunk)})`).run(...chunk);
  }
}

/** Shows (and season artwork) left without any episodes. */
function deleteEmptyShows() {
  const empty = db.prepare('SELECT id FROM tv_shows WHERE id NOT IN (SELECT DISTINCT show_id FROM episodes WHERE show_id IS NOT NULL)').all().map(r => r.id);
  for (const id of empty) {
    db.prepare('DELETE FROM seasons WHERE show_id = ?').run(id);
    db.prepare(`DELETE FROM kids_overrides WHERE media_type = 'show' AND media_id = ?`).run(id);
    db.prepare('DELETE FROM tv_shows WHERE id = ?').run(id);
  }
  // Season artwork for seasons that no longer have episodes.
  db.prepare(`DELETE FROM seasons WHERE NOT EXISTS (
    SELECT 1 FROM episodes e WHERE e.show_id = seasons.show_id AND e.season = seasons.season_number)`).run();
  return empty.length;
}

// ── Deleting files ───────────────────────────────────────────────────────────

function libraryRootFor(filePath) {
  const roots = db.prepare('SELECT path FROM libraries').all().map(r => path.resolve(r.path));
  const resolved = path.resolve(filePath);
  return roots.filter(r => resolved.startsWith(r + path.sep)).sort((a, b) => b.length - a.length)[0] || null;
}

const hasVideos = (dir) => {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).some(e =>
      (e.isFile() && VIDEO_EXT.has(path.extname(e.name).toLowerCase())) || (e.isDirectory() && hasVideos(path.join(dir, e.name))));
  } catch { return false; }
};

/**
 * Delete a video file, its sidecars (subtitles, .nfo, thumbnails with the same
 * name), then any folders above it — up to, never including, the library folder —
 * that no longer hold any videos. Only inside a library folder.
 */
function deleteVideoFile(filePath, errors) {
  const root = libraryRootFor(filePath);
  if (!root) {
    errors.push(`${filePath}: not inside a library folder`);
    return false;
  }
  try {
    fs.rmSync(filePath, { force: true });
  } catch (err) {
    errors.push(`${path.basename(filePath)}: ${err.code === 'EROFS' || err.code === 'EACCES' || err.code === 'EPERM' ? "can't delete — the media folder may be read-only" : err.message}`);
    return false;
  }
  const dir = path.dirname(filePath);
  const stem = path.basename(filePath, path.extname(filePath));
  try {
    for (const name of fs.readdirSync(dir)) {
      if (name.startsWith(stem) && SIDECAR_EXT.has(path.extname(name).toLowerCase())) fs.rmSync(path.join(dir, name), { force: true });
    }
  } catch {}
  removeEmptyParents(dir);
  return true;
}

// Remove folders, from `dir` upward, that hold no videos any more (e.g. "Season 01",
// then the show folder) — never the library folder itself.
function removeEmptyParents(dir) {
  const root = libraryRootFor(path.join(dir, 'x'));
  if (!root) return;
  let current = dir;
  while (path.resolve(current).startsWith(root + path.sep) && !hasVideos(current)) {
    try { fs.rmSync(current, { recursive: true, force: true }); } catch { break; }
    current = path.dirname(current);
  }
}

// The folder that holds exactly these files, if it holds nothing else that's a video.
function commonFolder(paths) {
  if (!paths.length) return null;
  let dir = path.dirname(paths[0]);
  while (!paths.every(p => p.startsWith(dir + path.sep))) dir = path.dirname(dir);
  return dir;
}

// ── Remove a title ───────────────────────────────────────────────────────────

/**
 * Remove a movie, a show, one season of a show, or one episode.
 * deleteFiles: also delete its files from the server. Otherwise the files stay and
 * are remembered (excluded_media) so scans don't add them back.
 * Returns { title, removed, filesDeleted, errors }.
 */
function removeMedia({ kind, id, season = null, deleteFiles = false }) {
  const errors = [];
  let title = '';
  let files = [];
  let libraryId = null;
  let excludePaths = [];
  let ownedFolder = null; // a folder that belongs to this title alone (deleted whole)

  if (kind === 'movie') {
    const movie = db.prepare('SELECT * FROM movies WHERE id = ?').get(id);
    if (!movie) throw Object.assign(new Error('Movie not found'), { status: 404 });
    title = movie.year ? `${movie.title} (${movie.year})` : movie.title;
    libraryId = movie.library_id;
    files = [movie.file_path];
    // In its own folder (no other movie there): that folder is the movie's.
    const dir = path.dirname(movie.file_path);
    const root = libraryRootFor(movie.file_path);
    const ownFolder = root && dir !== root && path.resolve(dir).startsWith(root + path.sep)
      && db.prepare(`SELECT COUNT(*) AS n FROM movies WHERE file_path LIKE ? ESCAPE '\\' AND id != ?`)
        .get(dir.replace(/[\\%_]/g, '\\$&') + path.sep + '%', movie.id).n === 0;
    excludePaths = [ownFolder ? dir : movie.file_path];
    ownedFolder = ownFolder ? dir : null;
  } else if (kind === 'show' || kind === 'season' || kind === 'episode') {
    let episodes;
    let show;
    if (kind === 'episode') {
      const ep = db.prepare('SELECT * FROM episodes WHERE id = ?').get(id);
      if (!ep) throw Object.assign(new Error('Episode not found'), { status: 404 });
      show = db.prepare('SELECT * FROM tv_shows WHERE id = ?').get(ep.show_id);
      episodes = [ep];
      title = `${show?.title || 'Episode'} S${String(ep.season).padStart(2, '0')}E${String(ep.episode_number).padStart(2, '0')}`;
    } else {
      show = db.prepare('SELECT * FROM tv_shows WHERE id = ?').get(id);
      if (!show) throw Object.assign(new Error('Show not found'), { status: 404 });
      episodes = kind === 'show'
        ? db.prepare('SELECT * FROM episodes WHERE show_id = ?').all(show.id)
        : db.prepare('SELECT * FROM episodes WHERE show_id = ? AND season = ?').all(show.id, season);
      if (kind === 'season' && !episodes.length) throw Object.assign(new Error('Season not found'), { status: 404 });
      title = kind === 'show' ? show.title : `${show.title} — ${season === 0 ? 'Specials' : `Season ${season}`}`;
    }
    libraryId = show?.library_id ?? null;
    files = episodes.map(e => e.file_path);
    if (kind === 'show' && show.folder_path && !show.folder_path.startsWith('title:')) {
      excludePaths = [show.folder_path];
      ownedFolder = show.folder_path;
    } else if (kind === 'season') {
      // A season folder holding only this season's files: hide the folder.
      const dir = commonFolder(files);
      const root = libraryRootFor(files[0]);
      const onlyThese = dir && root && path.resolve(dir).startsWith(root + path.sep) && dir !== show.folder_path
        && db.prepare(`SELECT COUNT(*) AS n FROM episodes WHERE file_path LIKE ? ESCAPE '\\' AND NOT (show_id = ? AND season = ?)`)
          .get(dir.replace(/[\\%_]/g, '\\$&') + path.sep + '%', show.id, season).n === 0;
      excludePaths = onlyThese ? [dir] : files;
      ownedFolder = onlyThese ? dir : null;
    } else {
      excludePaths = files;
    }
    db.transaction(() => {
      deleteEpisodeRows(episodes.map(e => e.id));
      if (kind === 'season') db.prepare('DELETE FROM seasons WHERE show_id = ? AND season_number = ?').run(show.id, season);
      deleteEmptyShows();
    })();
  } else {
    throw Object.assign(new Error('Unknown kind'), { status: 400 });
  }

  if (kind === 'movie') {
    db.transaction(() => deleteMovieRows([id]))();
  }

  let filesDeleted = 0;
  if (deleteFiles) {
    if (ownedFolder && libraryRootFor(path.join(ownedFolder, 'x'))) {
      // The whole folder is this title's (with its samples, extras, artwork…), as Radarr / Sonarr do.
      try {
        fs.rmSync(ownedFolder, { recursive: true, force: true });
        filesDeleted = files.length;
        removeEmptyParents(path.dirname(ownedFolder));
      } catch (err) {
        errors.push(err.code === 'EROFS' || err.code === 'EACCES' || err.code === 'EPERM'
          ? "Couldn't delete the files — the media folder may be read-only" : err.message);
      }
    } else {
      for (const f of files) if (deleteVideoFile(f, errors)) filesDeleted++;
    }
  } else {
    for (const p of excludePaths) addExclusion(p, libraryId, kind, title);
  }
  return { title, removed: files.length, filesDeleted, errors };
}

// ── Tidying after scans ──────────────────────────────────────────────────────

/**
 * Remove entries in a library whose files are gone (renamed, upgraded or deleted
 * outside Streamulus). Skipped when the library looks unavailable — no files
 * found, or most of it missing — so an unmounted drive doesn't empty it.
 */
function removeMissing(lib, foundFiles) {
  if (!foundFiles || foundFiles.size === 0) return { removed: 0, skipped: 'no files found in the library folder' };
  const rows = lib.type === 'movies'
    ? db.prepare('SELECT id, file_path FROM movies WHERE library_id = ?').all(lib.id)
    : db.prepare('SELECT e.id, e.file_path FROM episodes e JOIN tv_shows s ON s.id = e.show_id WHERE s.library_id = ?').all(lib.id);
  const missing = rows.filter(r => !foundFiles.has(r.file_path) && !fs.existsSync(r.file_path));
  if (!missing.length) return { removed: 0 };
  if (missing.length > Math.max(5, rows.length * 0.5)) {
    return { removed: 0, skipped: `${missing.length} of ${rows.length} files are missing — not removing anything in case the drive isn't mounted` };
  }
  db.transaction(() => {
    if (lib.type === 'movies') deleteMovieRows(missing.map(r => r.id));
    else {
      deleteEpisodeRows(missing.map(r => r.id));
      deleteEmptyShows();
    }
  })();
  return { removed: missing.length };
}

/**
 * One show per series folder: move episodes that ended up under other show rows
 * (from older scans) into the show for their folder, and remove the emptied rows.
 * Then merge rows that share a TVDB / TMDB id. No network needed.
 */
function regroupShows() {
  const cfg = naming.getConfig();
  const libraries = db.prepare(`SELECT * FROM libraries WHERE type = 'tv'`).all();
  let moved = 0;
  let merged = 0;
  db.transaction(() => {
    for (const lib of libraries) {
      const episodes = db.prepare(`
        SELECT e.id, e.file_path, e.show_id FROM episodes e JOIN tv_shows s ON s.id = e.show_id WHERE s.library_id = ?
      `).all(lib.id);
      const groups = new Map(); // showKey -> episodes
      for (const ep of episodes) {
        const parsed = naming.parseEpisode(lib.path, ep.file_path, cfg);
        if (!parsed) continue;
        if (!groups.has(parsed.showKey)) groups.set(parsed.showKey, []);
        groups.get(parsed.showKey).push(ep);
      }
      for (const [key, eps] of groups) {
        const showIds = [...new Set(eps.map(e => e.show_id))];
        const rows = db.prepare(`SELECT * FROM tv_shows WHERE id IN (${inList(showIds)})`).all(...showIds);
        // Keep the row for this folder, else the one with metadata and the most episodes.
        const count = (id) => eps.filter(e => e.show_id === id).length;
        const target = rows.find(r => r.folder_path === key)
          || rows.sort((a, b) => ((b.tvdb_id || b.tmdb_id) ? 1 : 0) - ((a.tvdb_id || a.tmdb_id) ? 1 : 0) || count(b.id) - count(a.id))[0];
        if (!target) continue;
        for (const ep of eps) {
          if (ep.show_id !== target.id) {
            db.prepare('UPDATE episodes SET show_id = ? WHERE id = ?').run(target.id, ep.id);
            moved++;
          }
        }
        if (!key.startsWith('title:') && target.folder_path !== key) {
          db.prepare('UPDATE tv_shows SET folder_path = ? WHERE id = ?').run(key, target.id);
        }
      }
    }
    // Rows sharing a metadata id in the same library are the same show.
    for (const col of ['tvdb_id', 'tmdb_id']) {
      const dupes = db.prepare(`
        SELECT ${col} AS match_id, library_id, MIN(id) AS keep_id FROM tv_shows
        WHERE ${col} IS NOT NULL GROUP BY ${col}, library_id HAVING COUNT(*) > 1
      `).all();
      for (const { match_id, library_id, keep_id } of dupes) {
        const others = db.prepare(`SELECT id FROM tv_shows WHERE ${col} = ? AND library_id IS ? AND id != ?`).all(match_id, library_id, keep_id);
        for (const { id } of others) {
          db.prepare('UPDATE episodes SET show_id = ? WHERE show_id = ?').run(keep_id, id);
          db.prepare('UPDATE OR IGNORE seasons SET show_id = ? WHERE show_id = ?').run(keep_id, id);
          merged++;
        }
      }
    }
    merged += deleteEmptyShows();
  })();
  return { moved, merged };
}

module.exports = {
  excludedMatcher, addExclusion, listExclusions, removeExclusion,
  removeMedia, removeMissing, regroupShows, deleteEmptyShows,
};
