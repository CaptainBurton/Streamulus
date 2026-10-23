// Moving seasons between shows, for when a season (or a whole show) was scanned
// as its own show — e.g. "Show Season 2" in a folder of its own.
//
// A move is remembered in show_overrides: the moved files' folder (or the files
// themselves, when the folder holds other things too) now belongs to the chosen
// show, so scans and Fix Duplicate Shows keep it there, and new episodes that
// arrive in that folder join it as well.
const path = require('path');
const db = require('../database/db');

function overrides() {
  return db.prepare('SELECT path, show_id, season FROM show_overrides').all();
}

// The override covering a file (the deepest one wins), or null.
function overrideFor(filePath, list = overrides()) {
  let best = null;
  for (const o of list) {
    if (filePath === o.path || filePath.startsWith(o.path + path.sep)) {
      if (!best || o.path.length > best.path.length) best = o;
    }
  }
  return best;
}

// The deepest folder holding every one of these files.
function commonFolder(files) {
  if (!files.length) return null;
  let parts = path.dirname(files[0]).split(path.sep);
  for (const f of files.slice(1)) {
    const other = path.dirname(f).split(path.sep);
    let i = 0;
    while (i < parts.length && i < other.length && parts[i] === other[i]) i++;
    parts = parts.slice(0, i);
  }
  return parts.join(path.sep) || null;
}

// Where to pin these episodes: their shared folder when nothing else lives in it
// (and it's not a library's own folder), otherwise each file on its own.
function pinPaths(episodes) {
  const files = episodes.map(e => e.file_path);
  const folder = commonFolder(files);
  const libraries = db.prepare('SELECT path FROM libraries').all().map(l => l.path.replace(/\/+$/, ''));
  const insideLibrary = folder && libraries.some(lib => folder.startsWith(lib + path.sep));
  if (folder && insideLibrary) {
    const ids = new Set(episodes.map(e => e.id));
    const others = db.prepare('SELECT id FROM episodes WHERE file_path LIKE ? ESCAPE \'\\\'')
      .all(folder.replace(/[\\%_]/g, '\\$&') + path.sep + '%')
      .filter(r => !ids.has(r.id));
    if (!others.length) return [folder];
  }
  return files;
}

function pin(paths, showId, season) {
  const upsert = db.prepare(`INSERT INTO show_overrides (path, show_id, season, created_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(path) DO UPDATE SET show_id = excluded.show_id, season = excluded.season, created_at = excluded.created_at`);
  for (const p of paths) {
    // Narrower pins inside it that say the same thing aren't needed any more
    // (ones sending files somewhere else stay — the deepest pin wins).
    db.prepare('DELETE FROM show_overrides WHERE path LIKE ? ESCAPE \'\\\' AND show_id = ? AND season IS NULL')
      .run(p.replace(/[\\%_]/g, '\\$&') + path.sep + '%', showId);
    upsert.run(p, showId, season ?? null, Date.now());
  }
}

// The show to move into: an existing one, or a new one with this title (in the
// same library as the episodes).
function targetShow({ toShowId, newShowTitle }, fromShow) {
  if (toShowId) {
    const show = db.prepare('SELECT * FROM tv_shows WHERE id = ?').get(toShowId);
    if (!show) throw Object.assign(new Error('That show no longer exists'), { status: 404 });
    if (show.id === fromShow.id) throw Object.assign(new Error('Pick a different show'), { status: 400 });
    return show;
  }
  const title = String(newShowTitle || '').trim().slice(0, 200);
  if (!title) throw Object.assign(new Error('Choose a show to move to, or name a new one'), { status: 400 });
  const r = db.prepare('INSERT INTO tv_shows (library_id, title) VALUES (?, ?)').run(fromShow.library_id, title);
  return db.prepare('SELECT * FROM tv_shows WHERE id = ?').get(r.lastInsertRowid);
}

// Episode titles, descriptions and stills from the target show's match.
function refreshMovedEpisodes(show, ids) {
  const match = require('./match');
  const lookup = match.episodeLookupFor(show);
  if (lookup && ids.length) match.refreshEpisodes(show.id, lookup, ids);
}

/**
 * Move one season of a show (fromShowId, season) to another show, optionally as
 * a different season number. Returns { moved, show, season }.
 */
function moveSeason({ fromShowId, season, toShowId, newShowTitle, targetSeason }) {
  const from = db.prepare('SELECT * FROM tv_shows WHERE id = ?').get(fromShowId);
  if (!from) throw Object.assign(new Error('Show not found'), { status: 404 });
  const episodes = db.prepare('SELECT id, file_path FROM episodes WHERE show_id = ? AND season = ?').all(from.id, season);
  if (!episodes.length) throw Object.assign(new Error(`${from.title} has no Season ${season}`), { status: 404 });
  const newSeason = targetSeason === undefined || targetSeason === null || targetSeason === '' ? season : parseInt(targetSeason, 10);
  if (!Number.isInteger(newSeason) || newSeason < 0 || newSeason > 999) throw Object.assign(new Error('Season number must be 0–999'), { status: 400 });

  let to;
  db.transaction(() => {
    to = targetShow({ toShowId, newShowTitle }, from);
    const ids = episodes.map(e => e.id);
    const marks = ids.map(() => '?').join(',');
    db.prepare(`UPDATE episodes SET show_id = ?, season = ? WHERE id IN (${marks})`).run(to.id, newSeason, ...ids);
    // The season's poster comes along unless the target already has one.
    db.prepare('UPDATE OR IGNORE seasons SET show_id = ?, season_number = ? WHERE show_id = ? AND season_number = ?')
      .run(to.id, newSeason, from.id, season);
    pin(pinPaths(episodes), to.id, newSeason !== season ? newSeason : null);
    require('./library').deleteEmptyShows();
  })();
  refreshMovedEpisodes(to, episodes.map(e => e.id));
  return { moved: episodes.length, show: { id: to.id, title: to.title }, season: newSeason };
}

/** Every season of fromShowId into another show (it's the same show). */
function mergeShow({ fromShowId, toShowId, newShowTitle }) {
  const from = db.prepare('SELECT * FROM tv_shows WHERE id = ?').get(fromShowId);
  if (!from) throw Object.assign(new Error('Show not found'), { status: 404 });
  const episodes = db.prepare('SELECT id, file_path FROM episodes WHERE show_id = ?').all(from.id);
  let to;
  db.transaction(() => {
    to = targetShow({ toShowId, newShowTitle }, from);
    db.prepare('UPDATE episodes SET show_id = ? WHERE show_id = ?').run(to.id, from.id);
    db.prepare('UPDATE OR IGNORE seasons SET show_id = ? WHERE show_id = ?').run(to.id, from.id);
    db.prepare(`UPDATE OR IGNORE title_services SET media_id = ? WHERE media_type = 'show' AND media_id = ?`).run(to.id, from.id);
    db.prepare('UPDATE show_overrides SET show_id = ? WHERE show_id = ?').run(to.id, from.id);
    const libraries = db.prepare('SELECT path FROM libraries').all().map(l => l.path.replace(/\/+$/, ''));
    const folder = from.folder_path && !from.folder_path.startsWith('title:') && !libraries.includes(from.folder_path) ? from.folder_path : null;
    if (episodes.length) pin(folder ? [folder] : pinPaths(episodes), to.id, null);
    require('./library').deleteEmptyShows();
  })();
  refreshMovedEpisodes(to, episodes.map(e => e.id));
  return { moved: episodes.length, show: { id: to.id, title: to.title } };
}

// For Admin › Libraries: what's been moved, so a pin can be forgotten.
function listOverrides() {
  return db.prepare(`SELECT o.path, o.show_id, o.season, o.created_at, s.title AS show_title
                     FROM show_overrides o LEFT JOIN tv_shows s ON s.id = o.show_id ORDER BY o.created_at DESC`).all();
}

function removeOverride(p) {
  return db.prepare('DELETE FROM show_overrides WHERE path = ?').run(p).changes > 0;
}

// Pins for shows that no longer exist are dropped.
function cleanupOverrides() {
  db.prepare('DELETE FROM show_overrides WHERE show_id NOT IN (SELECT id FROM tv_shows)').run();
}

module.exports = { overrides, overrideFor, moveSeason, mergeShow, listOverrides, removeOverride, cleanupOverrides, commonFolder };
