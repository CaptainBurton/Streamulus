// Repairs stored file paths that no longer exist because the media folders were
// mounted differently (e.g. an old setup stored "/tv/Series/Show/S01/x.mp4" but
// the file is now at "/tv/Show/S01/x.mp4"). For a missing file we try the end of
// its old path under each library folder of the same type — longest match
// first — and point the row at the first file that exists. Watch history is
// kept because the row (and its id) stays the same.
const fs = require('fs');
const path = require('path');
const db = require('../database/db');

const TABLES = {
  episodes: { libType: 'tv',     mediaType: 'episode', fallbackRoot: '/tv' },
  movies:   { libType: 'movies', mediaType: 'movie',   fallbackRoot: '/movies' },
};

function rootsFor(table) {
  const { libType, fallbackRoot } = TABLES[table];
  const roots = db.prepare('SELECT path FROM libraries WHERE type = ?').all(libType).map(r => r.path);
  if (!roots.includes(fallbackRoot)) roots.push(fallbackRoot);
  return roots;
}

// "/tv/Series/Show/S01/x.mp4" under root "/tv" →
// "/tv/Series/Show/S01/x.mp4", "/tv/Show/S01/x.mp4", "/tv/S01/x.mp4", "/tv/x.mp4"
function candidates(storedPath, roots) {
  const segs = storedPath.split('/').filter(Boolean);
  const out = [];
  for (let i = 1; i < segs.length; i++) {
    for (const root of roots) {
      const c = path.join(root, ...segs.slice(i));
      if (c !== storedPath && !out.includes(c)) out.push(c);
    }
  }
  return out;
}

// Point row `id` at `newPath`. If a scan already added a second row for the
// file at its new location, fold that duplicate into the original row (moving
// over any watch progress the original doesn't have) and remove it.
const applyRepair = db.transaction((table, id, newPath) => {
  const { mediaType } = TABLES[table];
  const dup = db.prepare(`SELECT * FROM ${table} WHERE file_path = ?`).get(newPath);
  if (dup && dup.id !== id) {
    db.prepare(`
      UPDATE watch_history SET media_id = ?
      WHERE media_type = ? AND media_id = ?
        AND profile_id NOT IN (SELECT profile_id FROM watch_history WHERE media_type = ? AND media_id = ? AND profile_id IS NOT NULL)
    `).run(id, mediaType, dup.id, mediaType, id);
    db.prepare('DELETE FROM watch_history WHERE media_type = ? AND media_id = ?').run(mediaType, dup.id);
    db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(dup.id);
    // A duplicate show created by that scan is left empty — remove it too.
    if (table === 'episodes' && dup.show_id) {
      const left = db.prepare('SELECT COUNT(*) AS n FROM episodes WHERE show_id = ?').get(dup.show_id).n;
      if (left === 0) {
        db.prepare('DELETE FROM seasons WHERE show_id = ?').run(dup.show_id);
        db.prepare('DELETE FROM tv_shows WHERE id = ?').run(dup.show_id);
      }
    }
  }
  db.prepare(`UPDATE ${table} SET file_path = ? WHERE id = ?`).run(newPath, id);
});

// Synchronous, for request handlers: returns a path that exists, or null.
function resolveFilePath(table, id) {
  const row = db.prepare(`SELECT id, file_path FROM ${table} WHERE id = ?`).get(id);
  if (!row?.file_path) return null;
  if (fs.existsSync(row.file_path)) return row.file_path;
  const found = candidates(row.file_path, rootsFor(table)).find(c => fs.existsSync(c));
  if (!found) return row.file_path; // still missing — caller reports it
  applyRepair(table, row.id, found);
  console.log(`[paths] Repaired ${table} #${row.id}: ${row.file_path} → ${found}`);
  return found;
}

const exists = (p) => fs.promises.access(p).then(() => true, () => false);

// Background pass over the whole library (async so the server stays responsive).
async function repairAllPaths() {
  let repaired = 0, missing = 0;
  for (const table of Object.keys(TABLES)) {
    const roots = rootsFor(table);
    const rows = db.prepare(`SELECT id, file_path FROM ${table}`).all();
    for (const row of rows) {
      if (await exists(row.file_path)) continue;
      let found = null;
      for (const c of candidates(row.file_path, roots)) {
        if (await exists(c)) { found = c; break; }
      }
      // Re-check the row: it may have been repaired or removed meanwhile.
      const cur = db.prepare(`SELECT file_path FROM ${table} WHERE id = ?`).get(row.id);
      if (!cur || cur.file_path !== row.file_path) continue;
      if (found) { applyRepair(table, row.id, found); repaired++; } else missing++;
    }
  }
  if (repaired || missing) {
    console.log(`[paths] Repaired ${repaired} moved file path(s); ${missing} file(s) still not found.`);
  }
  return { repaired, missing };
}

module.exports = { resolveFilePath, repairAllPaths };
