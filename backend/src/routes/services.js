// Streaming services (services/streaming.js).
//   /api/services            — the Home row and each service's library page
//   /api/admin/services      — Admin › Streaming Services
const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const db = require('../database/db');
const { authenticate, requireAdmin } = require('../middleware/auth');
const streaming = require('../services/streaming');
const { library, cardImage, byTitle } = require('./genres');
const { imageExt } = require('./profiles');
const { posterUrl } = require('../services/tmdb');

const bannersDir = path.join(process.env.DATA_DIR || '/data', 'uploads', 'services');
fs.mkdirSync(bannersDir, { recursive: true });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// ── For everyone ─────────────────────────────────────────────────────────────

const user = express.Router();

// Logos: plain files, no sign-in needed (like the app's own logo).
user.get('/logos/:file', (req, res) => {
  const m = String(req.params.file).match(/^([a-z0-9]+)\.(svg|png)$/);
  if (!m || !streaming.BUILTIN.some(s => s.id === m[1])) return res.status(404).end();
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.sendFile(path.join(streaming.LOGO_DIR, `${m[1]}.${m[2]}`));
});

// The titles on each service that this profile can see (Streamlings only see theirs).
function groups(req) {
  const { movies, shows } = library(req);
  const assigned = streaming.assignments();
  const out = new Map(streaming.all().filter(s => s.enabled).map(s => [s.id, { service: s, movies: [], shows: [] }]));
  for (const m of movies) for (const id of assigned.movie.get(m.id) || []) out.get(id)?.movies.push(m);
  for (const s of shows) for (const id of assigned.show.get(s.id) || []) out.get(id)?.shows.push(s);
  return out;
}

// The Home row: services with at least one title, in the admin's order.
user.get('/', authenticate, (req, res) => {
  const services = [...groups(req).values()]
    .filter(g => g.movies.length || g.shows.length)
    .map(g => ({
      ...streaming.publicService(g.service, cardImage(g, null)),
      custom_banner: !!g.service.banner_path,
      movie_count: g.movies.length,
      show_count: g.shows.length,
    }));
  // A custom banner wins over a random title's backdrop.
  for (const s of services) {
    const row = streaming.all().find(x => x.id === s.id);
    if (row?.banner_path) s.banner_url = streaming.customBanner(row);
  }
  res.json({ services });
});

// One service's library page.
user.get('/:id', authenticate, (req, res) => {
  const group = groups(req).get(req.params.id);
  if (!group) return res.status(404).json({ error: 'Service not found' });
  const type = ['movies', 'shows'].includes(req.query.type) ? req.query.type : 'all';
  res.json({
    service: streaming.publicService(group.service, streaming.customBanner(group.service) || cardImage(group, null)),
    movie_count: group.movies.length,
    show_count: group.shows.length,
    movies: type === 'shows' ? [] : group.movies.sort(byTitle),
    shows: type === 'movies' ? [] : group.shows.sort(byTitle),
  });
});

// ── Admin ────────────────────────────────────────────────────────────────────

const admin = express.Router();

const isFullUrl = (p) => p && (p.startsWith('http://') || p.startsWith('https://') || p.startsWith('/uploads/'));
const img = (p) => (isFullUrl(p) ? p : posterUrl(p, 'w185'));

function adminState() {
  const counts = new Map();
  for (const r of db.prepare(`
    SELECT ts.service_id, ts.media_type, COUNT(*) AS n FROM title_services ts
    WHERE (ts.media_type = 'movie' AND ts.media_id IN (SELECT id FROM movies))
       OR (ts.media_type = 'show' AND ts.media_id IN (SELECT id FROM tv_shows))
    GROUP BY ts.service_id, ts.media_type`).all()) {
    const c = counts.get(r.service_id) || { movie_count: 0, show_count: 0 };
    c[r.media_type === 'movie' ? 'movie_count' : 'show_count'] = r.n;
    counts.set(r.service_id, c);
  }
  const ratings = require('../services/ratings');
  return {
    services: streaming.all().map(s => ({
      ...streaming.publicService(s, streaming.customBanner(s)),
      enabled: !!s.enabled,
      custom_banner: !!s.banner_path,
      movie_count: counts.get(s.id)?.movie_count || 0,
      show_count: counts.get(s.id)?.show_count || 0,
    })),
    autofillNew: streaming.autofillAfterScans(),
    autofill: streaming.autofillStatus(),
    country: ratings.systemFor().name,
    tmdb: !!require('../services/tmdb').getApiKey(),
  };
}

admin.get('/', requireAdmin, (req, res) => res.json(adminState()));

// { autofillNew } — also fill in new titles after every scan.
admin.put('/settings', requireAdmin, (req, res) => {
  if (req.body?.autofillNew !== undefined) {
    db.prepare("INSERT OR REPLACE INTO config (key, value) VALUES ('services_autofill_new', ?)").run(req.body.autofillNew ? 'true' : 'false');
  }
  res.json(adminState());
});

// { enabled } for one service.
admin.put('/:id', requireAdmin, (req, res) => {
  if (!streaming.all().some(s => s.id === req.params.id)) return res.status(404).json({ error: 'Service not found' });
  if (req.body?.enabled !== undefined) {
    db.prepare('UPDATE streaming_services SET enabled = ? WHERE id = ?').run(req.body.enabled ? 1 : 0, req.params.id);
  }
  res.json(adminState());
});

// { ids: [...] } — the order on Home.
admin.post('/order', requireAdmin, (req, res) => {
  const known = streaming.all().map(s => s.id);
  const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).filter(id => known.includes(id));
  const order = [...ids, ...known.filter(id => !ids.includes(id))];
  const set = db.prepare('UPDATE streaming_services SET sort = ? WHERE id = ?');
  db.transaction(() => order.forEach((id, i) => set.run(i, id)))();
  res.json(adminState());
});

admin.post('/:id/banner', requireAdmin, (req, res) => {
  const service = streaming.all().find(s => s.id === req.params.id);
  if (!service) return res.status(404).json({ error: 'Service not found' });
  upload.single('image')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Image must be 10 MB or smaller' : 'Upload failed' });
    if (!req.file) return res.status(400).json({ error: 'No image uploaded' });
    const ext = imageExt(req.file.buffer);
    if (!ext) return res.status(400).json({ error: 'Use a PNG, JPG, WebP or GIF image' });
    const filename = `${service.id}-${Date.now()}.${ext}`;
    fs.writeFileSync(path.join(bannersDir, filename), req.file.buffer);
    if (service.banner_path) fs.rm(path.join(bannersDir, service.banner_path), { force: true }, () => {});
    db.prepare('UPDATE streaming_services SET banner_path = ? WHERE id = ?').run(filename, service.id);
    res.json(adminState());
  });
});

admin.delete('/:id/banner', requireAdmin, (req, res) => {
  const service = streaming.all().find(s => s.id === req.params.id);
  if (!service) return res.status(404).json({ error: 'Service not found' });
  if (service.banner_path) fs.rm(path.join(bannersDir, service.banner_path), { force: true }, () => {});
  db.prepare('UPDATE streaming_services SET banner_path = NULL WHERE id = ?').run(service.id);
  res.json(adminState());
});

// Every movie and show with the services it's on (the page filters and pages it).
admin.get('/titles', requireAdmin, (req, res) => {
  const assigned = streaming.assignments();
  const list = (kind, table, yearExpr) => db.prepare(`SELECT id, title, ${yearExpr} AS year, poster_path FROM ${table} ORDER BY title COLLATE NOCASE`).all()
    .map(r => ({ id: r.id, title: r.title, year: r.year, poster_url: img(r.poster_path), services: assigned[kind].get(r.id) || [] }));
  res.json({
    movies: list('movie', 'movies', 'year'),
    shows: list('show', 'tv_shows', 'substr(first_air_date, 1, 4)'),
  });
});

// { services: [ids] } — replaces the title's services.
admin.put('/titles/:type/:id', requireAdmin, (req, res) => {
  const kind = req.params.type === 'movie' ? 'movie' : req.params.type === 'show' ? 'show' : null;
  if (!kind) return res.status(400).json({ error: 'type must be movie or show' });
  const exists = db.prepare(`SELECT id FROM ${kind === 'movie' ? 'movies' : 'tv_shows'} WHERE id = ?`).get(req.params.id);
  if (!exists) return res.status(404).json({ error: 'Not found' });
  const services = streaming.setTitleServices(kind, exists.id, req.body?.services);
  res.json({ success: true, services });
});

// Fill in titles that have no services yet from TMDB (runs in the background).
admin.post('/autofill', requireAdmin, (req, res) => {
  res.json({ autofill: streaming.autofill() });
});

admin.get('/autofill', requireAdmin, (req, res) => res.json({ autofill: streaming.autofillStatus() }));

module.exports = { user, admin };
