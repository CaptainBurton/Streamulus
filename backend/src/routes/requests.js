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
  res.json({
    open: requests.isOpen() && !req.profile?.is_kids, limit: s.limit, refreshSeconds: s.refreshSeconds,
    genres: tmdb.movieGenres().sort((a, b) => a.name.localeCompare(b.name)), // for the Genre filter
  });
});

const yearOf = (date) => (date ? parseInt(date, 10) || null : null);
const img = (p, size) => (p ? `https://image.tmdb.org/t/p/${size}${p}` : null);

// Who has already asked for a film (and whether it's you).
function requestState(tmdbId, userId) {
  const open = requests.openFor(tmdbId);
  if (!open) return null;
  const mine = !!db.prepare('SELECT 1 FROM media_request_users WHERE request_id = ? AND user_id = ?').get(open.id, userId);
  return { id: open.id, status: open.status, label: requests.LABELS[open.status], mine };
}

// A TMDB film as the Requests pages list it.
const filmResult = (m, userId) => ({
  tmdbId: m.id,
  title: m.title,
  year: yearOf(m.release_date),
  overview: m.overview || '',
  posterUrl: requests.posterUrl(m.poster_path),
  rating: m.vote_average || null,
  movieId: requests.inLibrary(m.id),
  request: requestState(m.id, userId),
});

const tmdbDown = (res) => res.status(502).json({ error: "Couldn't reach TMDB right now — try again in a moment" });

// Films to choose from, leaving out the ones already on the server. Each says
// whether it's already been asked for.
//   ?q=        search by title (optionally ?year= to narrow it, ?genre= to filter)
//   ?year= / ?genre= with no q: that year's / genre's most popular films
//   nothing:   this week's popular films
user.get('/search', authenticate, noKids, async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 100);
  const year = /^\d{4}$/.test(String(req.query.year || '')) ? Number(req.query.year) : null;
  const genre = parseInt(req.query.genre, 10) || null;
  let results;
  let mode;
  try {
    if (q) {
      mode = 'search';
      results = await tmdb.searchMovieList(q, year);
      if (genre) results = results.filter(m => (m.genre_ids || []).includes(genre));
    } else if (year || genre) {
      mode = 'discover';
      const [one, two] = await Promise.all([tmdb.discoverMovies({ year, genre }), tmdb.discoverMovies({ year, genre, page: 2 })]);
      results = [...one, ...two];
    } else {
      mode = 'popular';
      results = await tmdb.trendingMovies();
    }
  } catch (err) {
    return tmdbDown(res);
  }
  const seen = new Set();
  res.json({
    query: q, year, genre, mode,
    results: results
      .filter(m => m.id && m.title && !seen.has(m.id) && seen.add(m.id) && !requests.inLibrary(m.id))
      .map(m => filmResult(m, req.user.id)),
  });
});

// People by name — to see everything an actor (or director) has made.
user.get('/people', authenticate, noKids, async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 100);
  if (!q) return res.json({ query: q, people: [] });
  let people;
  try { people = await tmdb.searchPeople(q); } catch { return tmdbDown(res); }
  res.json({
    query: q,
    people: people.filter(p => p.id && p.name).map(p => ({
      id: p.id,
      name: p.name,
      department: p.known_for_department || null,
      profileUrl: img(p.profile_path, 'w185'),
      knownFor: (p.known_for || []).map(k => k.title || k.name).filter(Boolean).slice(0, 3),
    })),
  });
});

// A person's page: who they are, and their films that aren't on the server yet
// (most popular first), with how many of theirs already are.
user.get('/person/:id', authenticate, noKids, async (req, res) => {
  let p;
  try { p = await tmdb.getPersonWithMovies(parseInt(req.params.id, 10)); } catch (err) {
    return err.response?.status === 404 ? res.status(404).json({ error: 'Person not found' }) : tmdbDown(res);
  }
  if (!p) return tmdbDown(res);
  const credits = p.movie_credits || {};
  // Directors etc.: their crew credits; everyone else: the films they're in.
  const acting = (p.known_for_department || 'Acting') === 'Acting';
  const pool = acting ? (credits.cast || []) : (credits.crew || []).filter(c => ['Director', 'Screenplay', 'Writer', 'Producer'].includes(c.job));
  const byId = new Map();
  for (const m of pool) if (m.id && m.title && !byId.has(m.id)) byId.set(m.id, m);
  const all = [...byId.values()].sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
  const here = all.filter(m => requests.inLibrary(m.id));
  res.json({
    person: {
      id: p.id,
      name: p.name,
      department: p.known_for_department || null,
      profileUrl: img(p.profile_path, 'w342'),
      biography: p.biography || '',
      birthday: p.birthday || null,
      deathday: p.deathday || null,
      placeOfBirth: p.place_of_birth || null,
    },
    films: all.filter(m => !requests.inLibrary(m.id)).map(m => ({ ...filmResult(m, req.user.id), role: m.character || m.job || null })),
    onServer: here.length,
  });
});

// A film's page: synopsis, cast, trailer, and whether it's here or asked for.
user.get('/film/:tmdbId', authenticate, noKids, async (req, res) => {
  const tmdbId = parseInt(req.params.tmdbId, 10);
  let m;
  try { m = await tmdb.getMovieFull(tmdbId); } catch (err) {
    return err.response?.status === 404 ? res.status(404).json({ error: 'Film not found' }) : tmdbDown(res);
  }
  if (!m) return tmdbDown(res);
  const country = require('../services/ratings').country();
  const dates = m.release_dates?.results || [];
  const certFor = (c) => (dates.find(d => d.iso_3166_1 === c)?.release_dates || []).map(d => d.certification).find(Boolean) || null;
  const videos = (m.videos?.results || []).filter(v => v.site === 'YouTube' && v.key);
  const trailer = videos.find(v => v.type === 'Trailer' && v.official) || videos.find(v => v.type === 'Trailer') || videos.find(v => v.type === 'Teaser') || null;
  res.json({
    film: {
      ...filmResult(m, req.user.id),
      originalTitle: m.original_title && m.original_title !== m.title ? m.original_title : null,
      tagline: m.tagline || null,
      releaseDate: m.release_date || null,
      runtime: m.runtime || null,
      voteCount: m.vote_count || 0,
      genres: (m.genres || []).map(g => g.name),
      certification: certFor(country) || certFor('US'),
      backdropUrl: img(m.backdrop_path, 'w1280'),
      directors: (m.credits?.crew || []).filter(c => c.job === 'Director').map(c => ({ id: c.id, name: c.name })),
      cast: (m.credits?.cast || []).slice(0, 16).map(c => ({ id: c.id, name: c.name, character: c.character || null, profileUrl: img(c.profile_path, 'w185') })),
      trailer: trailer ? { name: trailer.name, url: `https://www.youtube.com/watch?v=${trailer.key}` } : null,
    },
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
