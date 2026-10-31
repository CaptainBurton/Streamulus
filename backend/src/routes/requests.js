// Movie requests.
//   /api/requests        — people: search films, ask for one, follow their requests
//   /api/admin/requests  — admins: approve / decline, search again, Radarr settings
const express = require('express');
const db = require('../database/db');
const { authenticate, requireAdmin } = require('../middleware/auth');
const requests = require('../services/requests');
const radarr = require('../services/radarr');
const deluge = require('../services/deluge');
const tmdb = require('../services/tmdb');
const activity = require('../services/activity');

const fail = (res, err) => res.status(err.status || 500).json({ error: err.message, ...(err.movieId ? { movieId: err.movieId } : {}) });

// ── People ───────────────────────────────────────────────────────────────────

const user = express.Router();

// Streamlings (kids' profiles) can't ask for films.
function noKids(req, res, next) {
  if (req.profile?.is_kids) return res.status(403).json({ error: 'Requests aren\'t available on Streamling profiles' });
  next();
}

user.get('/config', authenticate, (req, res) => {
  const s = requests.settings();
  res.json({ open: requests.isOpen() && !req.profile?.is_kids, limit: s.limit, refreshSeconds: s.refreshSeconds });
});

// Films to choose from: a search, or this week's popular ones — leaving out the
// ones already on the server. Each says whether it's already been asked for.
user.get('/search', authenticate, noKids, async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 100);
  let results;
  try {
    results = q ? await tmdb.searchMovieList(q) : await tmdb.trendingMovies();
  } catch (err) {
    return res.status(502).json({ error: "Couldn't search TMDB right now — try again in a moment" });
  }
  res.json({
    query: q,
    results: results.filter(m => m.id && m.title && !requests.inLibrary(m.id)).map(m => {
      const open = requests.openFor(m.id);
      const mine = open ? !!db.prepare('SELECT 1 FROM media_request_users WHERE request_id = ? AND user_id = ?').get(open.id, req.user.id) : false;
      return {
        tmdbId: m.id,
        title: m.title,
        year: m.release_date ? parseInt(m.release_date, 10) : null,
        overview: m.overview || '',
        posterUrl: requests.posterUrl(m.poster_path),
        rating: m.vote_average || null,
        movieId: requests.inLibrary(m.id),
        request: open ? { id: open.id, status: open.status, label: requests.LABELS[open.status], mine } : null,
      };
    }),
  });
});

// Your requests (and ones you added your name to), newest first.
user.get('/', authenticate, noKids, (req, res) => {
  const rows = db.prepare(`
    SELECT r.* FROM media_requests r JOIN media_request_users ru ON ru.request_id = r.id
    WHERE ru.user_id = ? ORDER BY r.created_at DESC
  `).all(req.user.id);
  res.json({ requests: rows.map(r => requests.shape(r, { forUser: req.user.id })) });
});

// { tmdbId, note? }
user.post('/', authenticate, noKids, async (req, res) => {
  try {
    const { request, joined, already } = await requests.create({ user: req.user, tmdbId: req.body?.tmdbId, note: req.body?.note, req });
    if (!already) {
      activity.log(req, { category: 'account', action: joined ? 'request_joined' : 'request_created', detail: `${request.title}${request.year ? ` (${request.year})` : ''}` });
    }
    res.status(joined || already ? 200 : 201).json({ request: requests.shape(request, { forUser: req.user.id }), joined, already });
  } catch (err) {
    fail(res, err);
  }
});

user.delete('/:id', authenticate, noKids, (req, res) => {
  try {
    const r = requests.get(Number(req.params.id));
    const result = requests.cancel({ id: Number(req.params.id), user: req.user });
    if (r) activity.log(req, { category: 'account', action: 'request_cancelled', detail: `${r.title}${r.year ? ` (${r.year})` : ''}` });
    res.json(result);
  } catch (err) {
    fail(res, err);
  }
});

// ── Admins ───────────────────────────────────────────────────────────────────

const admin = express.Router();

const FILTERS = {
  pending: "status = 'pending'",
  attention: 'needs_admin = 1',
  active: `status IN (${requests.ACTIVE.map(s => `'${s}'`).join(',')})`,
  available: "status = 'available'",
  declined: "status = 'declined'",
  all: '1 = 1',
};

admin.get('/counts', requireAdmin, (req, res) => {
  const c = db.prepare(`SELECT
    SUM(status = 'pending') AS pending,
    SUM(needs_admin = 1 AND status != 'available') AS attention,
    SUM(status IN (${requests.ACTIVE.map(s => `'${s}'`).join(',')})) AS active
    FROM media_requests`).get();
  res.json({ pending: c.pending || 0, attention: c.attention || 0, active: c.active || 0 });
});

// Radarr and request settings. Must come before /:id.
admin.get('/settings', requireAdmin, (req, res) => res.json(requests.settingsView()));

admin.put('/settings', requireAdmin, (req, res) => {
  const b = req.body || {};
  if (b.url !== undefined && b.url && !/^https?:\/\//i.test(String(b.url).trim())) {
    return res.status(400).json({ error: 'The Radarr address should start with http:// or https://' });
  }
  if (b.delugeUrl !== undefined && b.delugeUrl && !/^https?:\/\//i.test(String(b.delugeUrl).trim())) {
    return res.status(400).json({ error: 'The Deluge address should start with http:// or https://' });
  }
  if (b.refreshSeconds !== undefined && !(Number(b.refreshSeconds) >= 1 && Number(b.refreshSeconds) <= 60)) {
    return res.status(400).json({ error: 'Refresh every 1 to 60 seconds' });
  }
  requests.saveSettings(b);
  activity.log(req, { category: 'admin', action: 'settings_changed', detail: 'Requests / Radarr settings' });
  res.json(requests.settingsView());
});

// { url?, password? } — the saved ones when left out. → { torrents }
admin.post('/settings/deluge-test', requireAdmin, async (req, res) => {
  try {
    res.json(await deluge.test({ url: req.body?.url, password: req.body?.password }));
  } catch (err) {
    res.status(502).json({ error: deluge.errorText(err, req.body?.url) });
  }
});

// { url?, apiKey? } — the saved ones when left out.
admin.post('/settings/test', requireAdmin, async (req, res) => {
  try {
    res.json(await radarr.test({ url: req.body?.url, apiKey: req.body?.apiKey }));
  } catch (err) {
    res.status(err.response || err.code ? 502 : 400).json({ error: err.response || err.code ? radarr.errorText(err, req.body?.url) : err.message });
  }
});

admin.get('/', requireAdmin, (req, res) => {
  const where = FILTERS[req.query.filter] || FILTERS.all;
  const rows = db.prepare(`SELECT * FROM media_requests WHERE ${where} ORDER BY (status = 'pending') DESC, needs_admin DESC, updated_at DESC LIMIT 500`).all();
  res.json({ requests: rows.map(r => requests.shape(r, { withRequesters: true })) });
});

const act = (fn) => async (req, res) => {
  try {
    const r = await fn(req);
    res.json({ request: r ? requests.shape(r, { withRequesters: true }) : null });
  } catch (err) {
    fail(res, err);
  }
};

// { qualityProfileId?, rootFolder? } — the saved ones when left out.
admin.post('/:id/approve', requireAdmin, act(req => requests.approve({
  id: Number(req.params.id), admin: req.user, req, qualityProfileId: req.body?.qualityProfileId, rootFolder: req.body?.rootFolder,
})));

// { reason? }
admin.post('/:id/decline', requireAdmin, act(req => requests.decline({ id: Number(req.params.id), admin: req.user, reason: req.body?.reason, req })));

admin.post('/:id/search', requireAdmin, act(req => requests.searchAgain({ id: Number(req.params.id), admin: req.user, req })));

// Check on it in Radarr now rather than at the next regular look.
admin.post('/:id/refresh', requireAdmin, act(async req => {
  const r = requests.get(Number(req.params.id));
  if (!r) throw Object.assign(new Error('Request not found'), { status: 404 });
  await requests.refresh(r);
  return requests.get(r.id);
}));

// Removes the request from Streamulus only (Radarr keeps the film).
admin.delete('/:id', requireAdmin, (req, res) => {
  const r = requests.get(Number(req.params.id));
  if (!r || !requests.remove(r.id)) return res.status(404).json({ error: 'Request not found' });
  activity.log(req, { category: 'admin', action: 'request_removed', detail: `${r.title}${r.year ? ` (${r.year})` : ''}` });
  res.json({ success: true });
});

module.exports = { user, admin };
