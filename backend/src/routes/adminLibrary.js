// Admin library tools (mounted at /api/admin/library): naming formats, deleting
// titles (from Streamulus only, or their files too), the list of things removed
// but kept on disk, editing a title's details, and tidying the library.
const express = require('express');
const fs = require('fs');
const db = require('../database/db');
const { requireAdmin } = require('../middleware/auth');
const naming = require('../services/naming');
const library = require('../services/library');

const router = express.Router();

const getConf = (key, fallback) => db.prepare('SELECT value FROM config WHERE key = ?').get(key)?.value ?? fallback;
const setConf = (key, value) => db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run(key, value);

// ── Naming formats (Sonarr / Radarr style) ──────────────────────────────────

const NAMING_FIELDS = {
  seriesFolder: 'naming_series_folder',
  seasonFolder: 'naming_season_folder',
  specialsFolders: 'naming_specials_folders',
  episodeFile: 'naming_episode_file',
  movieFolder: 'naming_movie_folder',
  movieFile: 'naming_movie_file',
};

function namingResponse() {
  const cfg = naming.getConfig();
  const out = { removeMissing: getConf('library_remove_missing', 'true') === 'true', formats: {}, defaults: {} };
  for (const [field, key] of Object.entries(NAMING_FIELDS)) {
    out.formats[field] = cfg[key];
    out.defaults[field] = naming.DEFAULTS[key];
  }
  return out;
}

router.get('/naming', requireAdmin, (req, res) => res.json(namingResponse()));

router.put('/naming', requireAdmin, (req, res) => {
  const formats = req.body?.formats || {};
  for (const [field, key] of Object.entries(NAMING_FIELDS)) {
    if (formats[field] === undefined) continue;
    const value = String(formats[field] || '').trim().slice(0, 300);
    if (value && field !== 'specialsFolders' && !naming.compileFormat(value)) {
      return res.status(400).json({ error: `That ${field} format isn't valid` });
    }
    setConf(key, value); // empty = back to the default
  }
  if (req.body?.removeMissing !== undefined) setConf('library_remove_missing', req.body.removeMissing ? 'true' : 'false');
  res.json(namingResponse());
});

// How a path would be read with the given (or saved) formats — the "Test" box.
router.post('/naming/test', requireAdmin, (req, res) => {
  const kind = req.body?.kind === 'movies' ? 'movies' : 'tv';
  const input = String(req.body?.path || '').trim();
  if (!input) return res.status(400).json({ error: 'Enter a file path to test' });
  const cfg = naming.getConfig();
  for (const [field, key] of Object.entries(NAMING_FIELDS)) {
    const v = req.body?.formats?.[field];
    if (typeof v === 'string' && v.trim()) cfg[key] = v.trim();
  }
  // Paths can be full ("/tv/Show/Season 1/x.mkv") or relative to the library folder.
  const libs = db.prepare('SELECT path FROM libraries WHERE type = ?').all(kind).map(r => r.path);
  const root = libs.find(p => input.startsWith(p.replace(/\/+$/, '') + '/')) || (kind === 'movies' ? '/movies' : '/tv');
  const full = input.startsWith('/') ? input : `${root.replace(/\/+$/, '')}/${input}`;
  const parsed = kind === 'movies' ? naming.parseMovie(root, full, cfg) : naming.parseEpisode(root, full, cfg);
  res.json({ root, parsed });
});

// ── Remove a title ───────────────────────────────────────────────────────────

function remove(req, res, args) {
  try {
    const result = library.removeMedia({ ...args, deleteFiles: req.query.files === '1' || req.body?.deleteFiles === true });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
}

router.delete('/movie/:id', requireAdmin, (req, res) => remove(req, res, { kind: 'movie', id: Number(req.params.id) }));
router.delete('/show/:id', requireAdmin, (req, res) => remove(req, res, { kind: 'show', id: Number(req.params.id) }));
router.delete('/show/:id/season/:season', requireAdmin, (req, res) =>
  remove(req, res, { kind: 'season', id: Number(req.params.id), season: Number(req.params.season) }));
router.delete('/episode/:id', requireAdmin, (req, res) => remove(req, res, { kind: 'episode', id: Number(req.params.id) }));

// Removed from Streamulus but kept on disk; restoring lets the next scan add it back.
router.get('/excluded', requireAdmin, (req, res) => {
  res.json({ items: library.listExclusions().map(r => ({ ...r, exists: fs.existsSync(r.path) })) });
});

router.post('/excluded/restore', requireAdmin, (req, res) => {
  if (!library.removeExclusion(String(req.body?.path || ''))) return res.status(404).json({ error: 'Not in the list' });
  res.json({ success: true });
});

// ── Edit details ─────────────────────────────────────────────────────────────

function cleanGenres(genres) {
  if (!Array.isArray(genres)) return undefined;
  const list = [...new Set(genres.map(g => String(g).trim()).filter(Boolean))].slice(0, 12);
  return JSON.stringify(list);
}

function editDetails(table, req, res) {
  const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  const b = req.body || {};
  const updates = {};
  if (b.title !== undefined) {
    const title = String(b.title).trim();
    if (!title || title.length > 200) return res.status(400).json({ error: 'Title must be 1–200 characters' });
    updates.title = title;
    updates.title_en = ''; // the admin's title is the one to show
  }
  if (b.overview !== undefined) {
    updates.overview = String(b.overview).trim().slice(0, 5000) || null;
    updates.overview_en = '';
  }
  if (b.contentRating !== undefined) updates.content_rating = String(b.contentRating).trim().slice(0, 20) || null;
  if (b.genres !== undefined) updates.genres = cleanGenres(b.genres);
  if (b.year !== undefined) {
    const year = b.year === null || b.year === '' ? null : parseInt(b.year, 10);
    if (year !== null && (Number.isNaN(year) || year < 1870 || year > 2200)) return res.status(400).json({ error: 'Year looks wrong' });
    if (table === 'movies') updates.year = year;
    else updates.first_air_date = year ? `${year}-01-01` : null;
  }
  if (b.locked !== undefined) updates.metadata_locked = b.locked ? 1 : 0;
  else if (Object.keys(updates).length) updates.metadata_locked = 1; // edited by hand: keep it
  const cols = Object.keys(updates).filter(c => updates[c] !== undefined);
  if (cols.length) {
    db.prepare(`UPDATE ${table} SET ${cols.map(c => `${c} = ?`).join(', ')} WHERE id = ?`).run(...cols.map(c => updates[c]), row.id);
  }
  res.json({ success: true, locked: !!(updates.metadata_locked ?? row.metadata_locked) });
}

router.put('/movie/:id', requireAdmin, (req, res) => editDetails('movies', req, res));
router.put('/show/:id', requireAdmin, (req, res) => editDetails('tv_shows', req, res));

// ── Tidy ─────────────────────────────────────────────────────────────────────

router.post('/regroup', requireAdmin, (req, res) => {
  try {
    res.json({ success: true, ...library.regroupShows() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/remove-missing', requireAdmin, async (req, res) => {
  const { getVideoFiles } = require('../services/scanner');
  const results = [];
  for (const lib of db.prepare('SELECT * FROM libraries').all()) {
    if (!fs.existsSync(lib.path)) {
      results.push({ library: lib.name, removed: 0, skipped: 'library folder not found' });
      continue;
    }
    const files = await getVideoFiles(lib.path);
    results.push({ library: lib.name, ...library.removeMissing(lib, new Set(files)) });
  }
  res.json({ success: true, results });
});

module.exports = router;
