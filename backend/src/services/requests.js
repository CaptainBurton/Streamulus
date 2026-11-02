// Requests. People ask for a film or a series (Requests page); an admin approves or
// declines it (Admin › Requests), and everyone who asked gets an email either
// way. Approved films are added to Radarr and searched for, and a poller follows
// them through Radarr — searching, downloading (with progress), moving into the
// library — until Streamulus has the film, then emails them that it's ready.
// Series (and single seasons of shows already here) go through Sonarr the same
// way, episode by episode — see tvRequests.js.
//
// One request per film: anyone else who asks for the same film is added to it
// (media_request_users) and hears about it too.
//
// The admin's backup, when Radarr can't find a film (or its download fails or
// stalls): paste a magnet link. It's added to Deluge (Radarr's own download of
// the film is cancelled and Radarr stops looking), followed like any download,
// and when it's finished the film — and any subtitles with it — is moved into
// the movie library under the naming format, the leftover download folder is
// cleared away, and it's added to Streamulus.
const fs = require('fs');
const path = require('path');
const db = require('../database/db');
const radarr = require('./radarr');
const deluge = require('./deluge');
const mailer = require('./mailer');
const templates = require('./emailTemplates');
const tmdb = require('./tmdb');
const naming = require('./naming');

// What people see for each status (detail adds specifics, e.g. "45% · 12 min left").
const LABELS = {
  pending: 'Waiting for approval',
  declined: 'Declined',
  searching: 'Looking for a download',
  waiting_release: 'Not released yet',
  not_found: 'No download found yet',
  downloading: 'Downloading',
  importing: 'Moving into the library',
  failed: 'Download problem',
  adding: 'Almost ready',
  available: 'Ready to watch',
  missing: 'Needs an admin',
};
// Approved and not finished: followed in Radarr.
const ACTIVE = ['searching', 'waiting_release', 'not_found', 'downloading', 'importing', 'failed', 'adding', 'missing'];
// How often each status is re-checked (ms). Radarr keeps looking for releases of
// monitored films by itself, so "not found" and "not released" still turn into
// downloads later — they're just checked less often.
const RECHECK = { not_found: 5 * 60 * 1000, waiting_release: 30 * 60 * 1000, missing: 10 * 60 * 1000 };
// Radarr itself only hears from the download client about once a minute, so it
// isn't asked more often than this; Deluge (when set up) is asked every refresh.
const RADARR_MIN_MS = Number(process.env.REQUESTS_RADARR_MIN_MS) || 4000;

const now = () => Date.now();
const getConf = (key, fallback) => db.prepare('SELECT value FROM config WHERE key = ?').get(key)?.value ?? fallback;
const setConf = (key, value) => db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run(key, String(value));

function settings() {
  return {
    enabled: getConf('requests_enabled', 'true') === 'true',
    limit: Math.max(1, parseInt(getConf('requests_limit', '10'), 10) || 10),
    notifyAdmins: getConf('requests_notify_admins', 'true') === 'true',
    // How often progress is checked, and how often the pages refresh (seconds).
    refreshSeconds: Math.min(60, Math.max(1, parseFloat(getConf('requests_refresh_seconds', '2')) || 2)),
    // Series requests on the go per person, and single-season requests.
    seriesLimit: Math.max(1, parseInt(getConf('requests_series_limit', '3'), 10) || 3),
    seasonLimit: Math.max(1, parseInt(getConf('requests_season_limit', '5'), 10) || 5),
  };
}
const tv = () => require('./tvRequests');
const refreshMs = () => Number(process.env.REQUESTS_POLL_MS) || settings().refreshSeconds * 1000;

// Film requests are open when they're turned on and Radarr is set up; series
// requests when Sonarr is (tvRequests.isOpen).
const isOpen = () => settings().enabled && radarr.configured();
const isTvOpen = () => tv().isOpen();
const titleOf = (r) => (r.media_type === 'tv' ? tv().displayTitle(r) : r.title);

const posterUrl = (p, size = 'w342') => (p ? (/^https?:/.test(p) ? p : `https://image.tmdb.org/t/p/${size}${p}`) : null);

function requesters(requestId) {
  return db.prepare(`
    SELECT u.id, u.username, u.email, u.role, u.status FROM media_request_users ru
    JOIN users u ON u.id = ru.user_id WHERE ru.request_id = ? ORDER BY ru.created_at
  `).all(requestId);
}

// A request as the pages show it. `forUser`: mark whether they asked for it.
function shape(r, { forUser = null, withRequesters = false } = {}) {
  const people = withRequesters || forUser ? requesters(r.id) : null;
  return {
    id: r.id,
    mediaType: r.media_type,
    tmdbId: r.tmdb_id,
    title: r.title,
    year: r.year,
    posterUrl: posterUrl(r.poster_path),
    backdropUrl: posterUrl(r.backdrop_path, 'w780'),
    overview: r.overview,
    note: r.note,
    status: r.status,
    label: LABELS[r.status] || r.status,
    detail: r.detail,
    progress: r.progress,
    eta: r.eta,
    size: r.size,
    speed: r.speed || null, // bytes per second, when Deluge reports it
    live: !!(r.live_at && now() - r.live_at < 60 * 1000), // progress straight from Deluge
    needsAdmin: !!r.needs_admin,
    declineReason: r.decline_reason,
    decidedBy: r.decided_by,
    decidedAt: r.decided_at,
    movieId: r.movie_id,
    radarrId: r.radarr_id,
    ...(r.media_type === 'tv' ? {
      scope: r.scope, season: r.season_number, showId: r.show_id, sonarrId: r.sonarr_id, displayTitle: titleOf(r),
      tv: r.tv_progress ? JSON.parse(r.tv_progress) : null,
      ...(withRequesters ? { downloads: tv().downloads(r.id) } : {}),
    } : {}),
    createdAt: r.created_at,
    ...(withRequesters ? { manual: r.manual_hash ? { name: r.manual_name, by: r.manual_by, at: r.manual_at } : null } : {}),
    updatedAt: r.updated_at,
    ...(withRequesters ? { requesters: people.map(p => ({ id: p.id, username: p.username })) } : {}),
    ...(forUser ? {
      mine: r.user_id === forUser,
      requestedBy: people[0]?.username || null,
      others: Math.max(0, people.length - 1),
    } : {}),
  };
}

function update(id, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  db.prepare(`UPDATE media_requests SET ${keys.map(k => `${k} = @${k}`).join(', ')}, updated_at = @updated_at WHERE id = @id`)
    .run({ ...fields, updated_at: now(), id });
}

const get = (id) => db.prepare('SELECT * FROM media_requests WHERE id = ?').get(id);

// The open request for a film (not declined), if any.
const openFor = (tmdbId) => db.prepare(`SELECT * FROM media_requests WHERE media_type = 'movie' AND tmdb_id = ? AND status != 'declined' ORDER BY id DESC`).get(tmdbId);

// A film Streamulus already has.
const inLibrary = (tmdbId) => db.prepare('SELECT id FROM movies WHERE tmdb_id = ?').get(tmdbId)?.id || null;

// ── Emails ───────────────────────────────────────────────────────────────────

async function emailPeople(r, templateId, extra = {}, req = null) {
  if (!mailer.configured()) return 0;
  const s = mailer.settings();
  const site = mailer.siteUrl(req);
  let sent = 0;
  for (const person of requesters(r.id)) {
    if (!person.email || person.status === 'disabled') continue;
    const values = {
      name: person.username, title: titleOf(r), year: r.year || '', site, contact: s.support_contact,
      link: `${site}/requests`, ...extra,
    };
    try {
      await mailer.send({ to: person.email, ...templates.render(templateId, values) });
      sent++;
    } catch (err) {
      console.error(`[requests] Email to ${person.username} failed: ${err.message}`);
    }
  }
  return sent;
}

async function emailAdmins(r, requester, req) {
  if (!settings().notifyAdmins || !mailer.configured()) return;
  const site = mailer.siteUrl(req);
  const admins = db.prepare("SELECT id, username, email FROM users WHERE role = 'admin' AND email IS NOT NULL AND email != '' AND (status IS NULL OR status = 'active') AND id != ?").all(requester.id);
  for (const admin of admins) {
    try {
      await mailer.send({
        to: admin.email,
        ...templates.render('request_new', {
          name: requester.username, title: titleOf(r), year: r.year || '', site,
          note: r.note ? `“${r.note}”` : '', link: `${site}/admin?tab=requests`,
        }),
      });
    } catch (err) {
      console.error(`[requests] New-request email to ${admin.username} failed: ${err.message}`);
    }
  }
}

// ── Asking ───────────────────────────────────────────────────────────────────

function openCount(userId) {
  return db.prepare(`
    SELECT COUNT(*) AS n FROM media_requests r JOIN media_request_users ru ON ru.request_id = r.id
    WHERE ru.user_id = ? AND r.media_type = 'movie' AND r.status NOT IN ('declined', 'available')
  `).get(userId).n;
}

/**
 * Ask for a film. → { request, joined } or throws { status, message, movieId }.
 * Every request — admins' too — waits for approval in Admin › Requests.
 */
async function create({ user, tmdbId, note, req, mediaType, scope, season }) {
  if (mediaType === 'tv') return tv().create({ user, tmdbId, scope, season, note, req });
  if (!isOpen()) throw Object.assign(new Error('Requests are turned off'), { status: 403 });
  tmdbId = parseInt(tmdbId, 10);
  if (!tmdbId) throw Object.assign(new Error('Choose a film to request'), { status: 400 });
  const have = inLibrary(tmdbId);
  if (have) throw Object.assign(new Error("It's already in the library"), { status: 409, movieId: have });

  const existing = openFor(tmdbId);
  if (existing) {
    const already = db.prepare('SELECT 1 FROM media_request_users WHERE request_id = ? AND user_id = ?').get(existing.id, user.id);
    if (!already) db.prepare('INSERT INTO media_request_users (request_id, user_id, created_at) VALUES (?, ?, ?)').run(existing.id, user.id, now());
    return { request: get(existing.id), joined: !already, already: !!already };
  }

  if (user.role !== 'admin' && openCount(user.id) >= settings().limit) {
    throw Object.assign(new Error(`You have ${settings().limit} requests waiting — wait for some to finish (or cancel one) before asking for more`), { status: 429 });
  }

  const details = await tmdb.getMovieDetails(tmdbId).catch(() => null);
  if (!details?.title) throw Object.assign(new Error("Couldn't find that film on TMDB"), { status: 404 });
  const t = now();
  const id = db.prepare(`
    INSERT INTO media_requests (media_type, tmdb_id, title, year, poster_path, backdrop_path, overview, user_id, note, status, created_at, updated_at)
    VALUES ('movie', ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
  `).run(
    tmdbId, details.title, details.release_date ? parseInt(details.release_date, 10) : null,
    details.poster_path || null, details.backdrop_path || null, (details.overview || '').slice(0, 2000),
    user.id, String(note || '').trim().slice(0, 500) || null, t, t,
  ).lastInsertRowid;
  db.prepare('INSERT INTO media_request_users (request_id, user_id, created_at) VALUES (?, ?, ?)').run(id, user.id, t);

  const r = get(id);
  emailAdmins(r, user, req).catch(() => {});
  return { request: r, joined: false };
}

// Someone takes their name off a request; a pending request nobody else wants is removed.
function cancel({ id, user }) {
  const r = get(id);
  if (!r) throw Object.assign(new Error('Request not found'), { status: 404 });
  const mine = db.prepare('SELECT 1 FROM media_request_users WHERE request_id = ? AND user_id = ?').get(id, user.id);
  if (!mine) throw Object.assign(new Error('Request not found'), { status: 404 });
  db.prepare('DELETE FROM media_request_users WHERE request_id = ? AND user_id = ?').run(id, user.id);
  const left = db.prepare('SELECT COUNT(*) AS n FROM media_request_users WHERE request_id = ?').get(id).n;
  if (!left && ['pending', 'declined'].includes(r.status)) {
    db.prepare('DELETE FROM media_requests WHERE id = ?').run(id);
    return { removed: true };
  }
  if (!left) update(id, {}); // approved: keeps going in Radarr; the admin can remove it
  return { removed: false };
}

// ── Deciding ─────────────────────────────────────────────────────────────────

async function approve({ id, admin, req, qualityProfileId, rootFolder, languageProfileId, notify = true }) {
  const r = get(id);
  if (!r) throw Object.assign(new Error('Request not found'), { status: 404 });
  if (r.media_type === 'tv') return tv().approve({ id, admin, req, qualityProfileId, rootFolder, languageProfileId, notify });
  if (!['pending', 'declined'].includes(r.status)) throw Object.assign(new Error('That request was already approved'), { status: 400 });
  if (!radarr.configured()) throw Object.assign(new Error('Set up Radarr in Admin › Requests first'), { status: 400 });
  let result;
  try {
    result = await radarr.addAndSearch(r.tmdb_id, { qualityProfileId, rootFolder });
  } catch (err) {
    throw Object.assign(new Error(radarr.errorText(err)), { status: 502 });
  }
  const t = now();
  update(id, {
    status: result.movie.hasFile ? 'adding' : 'searching',
    detail: result.movie.hasFile ? 'Radarr already has it — adding it to Streamulus' : 'Searching for a download…',
    progress: null, eta: null, needs_admin: 0, decline_reason: null,
    decided_by: admin.username, decided_at: t,
    radarr_id: result.movie.id, search_command_id: result.command?.id || null, searched_at: t,
  });
  require('./activity').log(req, { category: 'admin', action: 'request_approved', detail: `${r.title}${r.year ? ` (${r.year})` : ''}` });
  if (notify) await emailPeople(get(id), 'request_approved', { admin: admin.username }, req);
  refresh(get(id)).catch(() => {}); // first look straight away
  return get(id);
}

async function decline({ id, admin, reason, req }) {
  const r = get(id);
  if (!r) throw Object.assign(new Error('Request not found'), { status: 404 });
  if (r.status !== 'pending') throw Object.assign(new Error('Only requests waiting for approval can be declined'), { status: 400 });
  const why = String(reason || '').trim().slice(0, 500);
  update(id, { status: 'declined', detail: null, decline_reason: why || null, decided_by: admin.username, decided_at: now() });
  require('./activity').log(req, { category: 'admin', action: 'request_declined', detail: `${titleOf(r)}${r.year ? ` (${r.year})` : ''}${why ? ` — ${why}` : ''}` });
  await emailPeople(get(id), 'request_declined', { admin: admin.username, reason: why ? `Reason: ${why}` : '' }, req);
  return get(id);
}

// Search again (after "not found" or a failed download).
async function searchAgain({ id, admin, req }) {
  const r = get(id);
  if (!r) throw Object.assign(new Error('Request not found'), { status: 404 });
  if (r.media_type === 'tv') return tv().searchAgain({ id, admin, req });
  if (!r.radarr_id && !r.manual_hash) throw Object.assign(new Error('That request isn\'t in Radarr'), { status: 400 });
  let cmd;
  try {
    if (r.manual_hash || !r.radarr_id) {
      // Was being fetched by hand (Radarr was told to stop): back to Radarr, monitored again.
      const result = await radarr.addAndSearch(r.tmdb_id);
      update(id, { radarr_id: result.movie.id });
      cmd = result.command;
    } else {
      cmd = await radarr.search(r.radarr_id);
    }
  } catch (err) {
    // Gone from Radarr: add it again.
    if (err?.response?.status === 404) {
      const result = await radarr.addAndSearch(r.tmdb_id);
      update(id, { radarr_id: result.movie.id });
      cmd = result.command;
    } else {
      throw Object.assign(new Error(radarr.errorText(err)), { status: 502 });
    }
  }
  update(id, {
    status: 'searching', detail: 'Searching for a download…', needs_admin: 0, search_command_id: cmd?.id || null, searched_at: now(), checked_at: null,
    manual_hash: null, manual_name: null, import_plan: null, download_id: null,
  });
  require('./activity').log(req, { category: 'admin', action: 'request_searched', detail: `${r.title}${r.year ? ` (${r.year})` : ''}` });
  refresh(get(id)).catch(() => {});
  return get(id);
}

function remove(id) {
  // A hand-added download that hasn't finished goes too (with what it downloaded).
  const r = get(id);
  if (r?.manual_hash && ['downloading', 'failed'].includes(r.status) && !r.import_plan && deluge.configured()) {
    deluge.remove(r.manual_hash, true).catch(() => {});
  }
  if (r?.media_type === 'tv') tv().removeDownloads(id);
  db.prepare('DELETE FROM media_request_users WHERE request_id = ?').run(id);
  return db.prepare('DELETE FROM media_requests WHERE id = ?').run(id).changes > 0;
}

// ── Following approved requests in Radarr ────────────────────────────────────

const minutes = (ms) => Math.max(1, Math.round(ms / 60000));
function timeLeft(ms) {
  if (!(ms > 0)) return null;
  const m = minutes(ms);
  if (m < 60) return `${m} min left`;
  const h = Math.floor(m / 60);
  return `${h} h ${m % 60} min left`;
}
// "00:12:34" / "1.02:03:04" → ms
function parseTimeleft(s) {
  const m = String(s || '').match(/^(?:(\d+)\.)?(\d+):(\d+):(\d+)/);
  if (!m) return null;
  return ((Number(m[1] || 0) * 24 + Number(m[2])) * 3600 + Number(m[3]) * 60 + Number(m[4])) * 1000;
}

// The film in Streamulus, by TMDB id or by the folder Radarr put it in.
function findLocal(r, movie) {
  const byId = inLibrary(r.tmdb_id);
  if (byId) return byId;
  const folder = movie?.path ? path.basename(movie.path) : null;
  if (!folder) return null;
  const like = `%${path.sep}${folder.replace(/[\\%_]/g, '\\$&')}${path.sep}%`;
  return db.prepare("SELECT id FROM movies WHERE file_path LIKE ? ESCAPE '\\'").get(like)?.id || null;
}

// Radarr has the file: scan the film's folder in Streamulus's movie libraries
// (found by its folder name — Radarr may see the drive at a different path).
function scanForFilm(movie) {
  const scanner = require('./scanner');
  const folder = movie?.path ? path.basename(movie.path) : null;
  const libs = db.prepare("SELECT * FROM libraries WHERE type = 'movies'").all();
  let found = false;
  for (const lib of libs) {
    const candidate = folder ? path.join(lib.path, folder) : null;
    if (candidate && fs.existsSync(candidate)) {
      found = true;
      scanner.scanPaths(lib, [candidate]).catch(err => console.error(`[requests] Scan failed: ${err.message}`));
    }
  }
  // Not where we expected: scan the movie libraries.
  if (!found) for (const lib of libs) scanner.scanAllWithProgress(() => {}, lib.id).catch(() => {});
}

function queueDetail(item) {
  const size = Number(item.size) || 0;
  const left = Number(item.sizeleft) || 0;
  const progress = size > 0 ? Math.min(1, Math.max(0, (size - left) / size)) : 0;
  const etaMs = item.estimatedCompletionTime ? Date.parse(item.estimatedCompletionTime) - now() : parseTimeleft(item.timeleft);
  const state = item.trackedDownloadState;
  const messages = (item.statusMessages || []).flatMap(m => m.messages || [m.title]).filter(Boolean);
  if (['importPending', 'importing', 'imported'].includes(state)) {
    const blocked = item.trackedDownloadStatus === 'warning' && state === 'importPending';
    return {
      status: 'importing', progress: 1, eta: null, size,
      detail: blocked ? `Downloaded, but Radarr can't move it into the library: ${messages[0] || 'needs a look'}` : 'Downloaded — moving the files into the library',
      needs_admin: blocked ? 1 : 0,
    };
  }
  if (['failedPending', 'failed'].includes(state) || item.trackedDownloadStatus === 'error') {
    return { status: 'failed', progress, eta: null, size, needs_admin: 1, detail: `The download failed${messages[0] || item.errorMessage ? `: ${messages[0] || item.errorMessage}` : ''} — an admin will look into it` };
  }
  const clientStatus = String(item.status || '').toLowerCase();
  const pct = `${Math.round(progress * 100)}%`;
  let detail;
  if (['queued', 'delay', 'paused'].includes(clientStatus)) detail = clientStatus === 'paused' ? `Paused at ${pct}` : 'Waiting to start downloading';
  else if (item.trackedDownloadStatus === 'warning') detail = `${pct} · slow or stalled${messages[0] ? ` (${messages[0]})` : ''}`;
  else detail = [pct, timeLeft(etaMs)].filter(Boolean).join(' · ');
  return { status: 'downloading', progress, eta: etaMs > 0 ? now() + etaMs : null, size, detail, needs_admin: 0 };
}

const speedText = (bps) => (bps >= 1e6 ? `${(bps / 1e6).toFixed(1)} MB/s` : bps >= 1e3 ? `${Math.round(bps / 1e3)} KB/s` : null);

// Live numbers from Deluge for a downloading request → fields to save.
function delugeDetail(t) {
  const pct = `${Math.round(t.progress * 100)}%`;
  const state = String(t.state || '').toLowerCase();
  let detail;
  if (t.progress >= 1 || state === 'seeding') detail = 'Downloaded — Radarr is about to move it into the library';
  else if (state === 'paused') detail = `Paused at ${pct}`;
  else if (state === 'queued') detail = `Waiting to start in Deluge (${pct})`;
  else if (state === 'checking' || state === 'allocating') detail = `Checking the files… ${pct}`;
  else if (state === 'error') detail = `${pct} · Deluge reports an error with this download`;
  else detail = [pct, speedText(t.speed), t.speed > 0 && t.eta ? timeLeft(t.eta * 1000) : t.speed === 0 ? 'waiting for peers' : null].filter(Boolean).join(' · ');
  return {
    progress: t.progress,
    eta: t.eta && t.progress < 1 ? now() + t.eta * 1000 : null,
    speed: t.speed || 0,
    size: t.size || null,
    detail,
    needs_admin: state === 'error' ? 1 : 0,
    live_at: now(),
  };
}

// The film is in Streamulus: tell everyone who asked.
async function markAvailable(r, movieId) {
  update(r.id, { status: 'available', detail: null, progress: 1, eta: null, speed: null, needs_admin: 0, movie_id: movieId, checked_at: now() });
  require('./activity').log(null, { category: 'admin', action: 'request_available', username: 'Streamulus', detail: `${r.title}${r.year ? ` (${r.year})` : ''}` });
  await emailPeople(get(r.id), 'request_available', { link: `${mailer.siteUrl(null)}/movie/${movieId}` });
}

// Check on one approved request and record how it's getting on.
async function refresh(r, queue = null) {
  if (r?.media_type === 'tv') return tv().refresh(r);
  if (r?.manual_hash) return refreshManual(r);
  return refreshRadarr(r, queue);
}

// …one Radarr is fetching.
async function refreshRadarr(r, queue = null) {
  if (!r || !ACTIVE.includes(r.status) || !r.radarr_id) return;
  let movie;
  try {
    movie = await radarr.getMovie(r.radarr_id);
  } catch (err) {
    if (err?.response?.status === 404) {
      return update(r.id, { status: 'missing', detail: 'Removed from Radarr — an admin needs to add it again (Search Again)', needs_admin: 1, checked_at: now() });
    }
    return update(r.id, { detail: `Can't reach Radarr right now (${radarr.errorText(err)})`, checked_at: now() });
  }

  const local = findLocal(r, movie);
  if (local) return markAvailable(r, local);

  if (movie.hasFile) {
    // Downloaded and imported by Radarr; Streamulus picks it up from the folder.
    const stale = !r.scan_requested_at || now() - r.scan_requested_at > 10 * 60 * 1000;
    if (stale) scanForFilm(movie);
    return update(r.id, {
      status: 'adding', progress: 1, eta: null, needs_admin: 0, checked_at: now(),
      detail: 'Downloaded — adding it to Streamulus',
      ...(stale ? { scan_requested_at: now() } : {}),
    });
  }

  const items = (queue || await radarr.queueByMovie().catch(() => new Map())).get(r.radarr_id) || [];
  if (items.length) {
    // The furthest-along download if there's more than one.
    const order = { imported: 4, importing: 3, importPending: 2, downloading: 1 };
    const item = [...items].sort((a, b) => (order[b.trackedDownloadState] || 0) - (order[a.trackedDownloadState] || 0))[0];
    const fields = { ...queueDetail(item), download_id: item.downloadId ? String(item.downloadId).toLowerCase() : null, checked_at: now() };
    // Deluge's numbers (fresh) win over Radarr's (up to a minute old) while downloading.
    const liveFresh = r.live_at && now() - r.live_at < 30 * 1000 && r.download_id === fields.download_id;
    if (fields.status === 'downloading' && liveFresh) {
      delete fields.progress; delete fields.eta; delete fields.detail; delete fields.size; delete fields.needs_admin;
    }
    return update(r.id, fields);
  }

  // Nothing downloading: still searching, grabbed a moment ago, not out yet, or nothing found.
  let searching = false;
  if (r.search_command_id) {
    try {
      const cmd = await radarr.command(r.search_command_id);
      searching = ['queued', 'started'].includes(cmd?.status);
    } catch { /* old commands are forgotten by Radarr: treat as finished */ }
  }
  if (searching) return update(r.id, { status: 'searching', detail: 'Searching for a download…', progress: null, eta: null, checked_at: now() });

  const grabbed = await radarr.history(r.radarr_id)
    .then(events => events.some(e => e.eventType === 'grabbed' && Date.parse(e.date) >= (r.searched_at || 0) - 60 * 1000))
    .catch(() => false);
  if (grabbed) return update(r.id, { status: 'downloading', progress: 0, eta: null, detail: 'Starting the download…', needs_admin: 0, checked_at: now() });

  if (movie.isAvailable === false) {
    const when = movie.digitalRelease || movie.physicalRelease || movie.inCinemas;
    const date = when ? new Date(when).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : null;
    return update(r.id, {
      status: 'waiting_release', progress: null, eta: null, needs_admin: 0, checked_at: now(),
      detail: `Not released yet — it'll download automatically once it is${date ? ` (expected ${date})` : ''}`,
    });
  }
  return update(r.id, {
    status: 'not_found', progress: null, eta: null, needs_admin: 1, checked_at: now(),
    detail: "Couldn't find a download yet — an admin will look into it. Radarr keeps checking for new releases.",
  });
}

let polling = false;
async function poll() {
  if (polling || (!radarr.configured() && !deluge.configured() && !require('./sonarr').configured())) return;
  const active = db.prepare(`SELECT * FROM media_requests WHERE status IN (${ACTIVE.map(() => '?').join(',')})`).all(...ACTIVE);
  if (!active.length) return;
  polling = true;
  try {
    // Hand-added downloads: straight from Deluge, every refresh (a failed one
    // is retried every minute — e.g. once the folder mapping is fixed).
    for (const r of active.filter(x => x.manual_hash && x.media_type !== 'tv')) {
      const every = r.status === 'failed' ? MANUAL_RETRY_MS : refreshMs();
      if (r.checked_at && now() - r.checked_at < every) continue;
      try { await refreshManual(r); } catch (err) { console.error(`[requests] ${r.title}: ${err.message}`); }
    }
    const radarrEvery = Math.max(refreshMs(), RADARR_MIN_MS);
    const due = radarr.configured()
      ? active.filter(r => r.media_type !== 'tv' && !r.manual_hash && (!r.checked_at || now() - r.checked_at >= Math.max(radarrEvery, RECHECK[r.status] || 0)))
      : [];
    if (due.length) {
      const queue = await radarr.queueByMovie().catch(() => null);
      for (const r of due) {
        try { await refreshRadarr(r, queue); } catch (err) { console.error(`[requests] ${r.title}: ${err.message}`); }
      }
    }
    // Series: Sonarr (as often as Radarr), or every refresh while a magnet link downloads.
    const shows = active.filter(r => r.media_type === 'tv' && (
      !r.checked_at || now() - r.checked_at >= (tv().hasDownloads(r.id) ? refreshMs() : Math.max(radarrEvery, RECHECK[r.status] || 0))));
    if (shows.length) {
      const sonarr = require('./sonarr');
      const queue = sonarr.configured() ? await sonarr.queueBySeries().catch(() => null) : null;
      for (const r of shows) {
        try { await tv().refresh(r, { queue }); } catch (err) { console.error(`[requests] ${r.title}: ${err.message}`); }
      }
    }
    await liveProgress();
  } finally {
    polling = false;
  }
}

// Every refresh: percentages, speed and time left for downloads, from Deluge.
let delugeError = null;
async function liveProgress() {
  if (!deluge.configured()) return;
  const rows = db.prepare("SELECT * FROM media_requests WHERE status = 'downloading' AND download_id IS NOT NULL AND manual_hash IS NULL AND media_type = 'movie'").all();
  if (!rows.length) return;
  let stats;
  try {
    stats = await deluge.torrents(rows.map(r => r.download_id));
    delugeError = null;
  } catch (err) {
    const msg = deluge.errorText(err);
    if (msg !== delugeError) console.error(`[requests] Deluge: ${msg}`);
    delugeError = msg;
    return;
  }
  for (const r of rows) {
    const t = stats[r.download_id];
    if (t) update(r.id, delugeDetail(t));
  }
}

// ── The admin's backup: a magnet link ────────────────────────────────────────

const MANUAL_RETRY_MS = Number(process.env.REQUESTS_MANUAL_RETRY_MS) || 60 * 1000;
const SUB_EXTS = new Set(['.srt', '.vtt', '.ass', '.ssa', '.sub', '.idx']);
const needs = (message) => Object.assign(new Error(message), { needsAdmin: true });
const movieLibrary = () => db.prepare("SELECT * FROM libraries WHERE type = 'movies' ORDER BY id").get();

/**
 * Download a film from a magnet link the admin pasted (when Radarr can't find
 * it, or its download failed or stalled). Counts as approving it if it was
 * waiting or declined (they're emailed, as with Approve).
 */
async function startMagnet({ id, admin, magnet, req, scope, season, episode }) {
  const r = get(id);
  if (!r) throw Object.assign(new Error('Request not found'), { status: 404 });
  if (r.media_type === 'tv') return tv().startMagnet({ id, admin, magnet, scope, season, episode, req });
  const allowed = ['pending', 'declined', 'searching', 'waiting_release', 'not_found', 'failed', 'missing', 'downloading'];
  if (!allowed.includes(r.status)) {
    throw Object.assign(new Error(r.status === 'available' ? "It's already in the library" : "It's already being added to the library"), { status: 400 });
  }
  if (!deluge.configured()) throw Object.assign(new Error('Connect Deluge first (Admin › Requests › Deluge) — the magnet link is added there'), { status: 400 });
  const uri = String(magnet || '').trim();
  if (!deluge.magnetHash(uri)) throw Object.assign(new Error("That isn't a magnet link — it should start with magnet:?xt=urn:btih:"), { status: 400 });
  if (!movieLibrary()) throw Object.assign(new Error('Add a Movies library first (Admin › Libraries) — the film is moved into it'), { status: 400 });

  let hash;
  try {
    hash = await deluge.addMagnet(uri);
  } catch (err) {
    throw Object.assign(new Error(deluge.errorText(err)), { status: 502 });
  }
  // A different magnet for the same film replaces the earlier one.
  if (r.manual_hash && r.manual_hash !== hash && !r.import_plan) deluge.remove(r.manual_hash, true).catch(() => {});
  // Radarr: cancel its download of the film (if any) and stop it looking.
  let cancelled = 0;
  if (r.radarr_id && radarr.configured()) {
    cancelled = await radarr.standDown(r.radarr_id).catch((err) => { console.error(`[requests] Radarr: ${radarr.errorText(err)}`); return 0; });
  }
  const undecided = ['pending', 'declined'].includes(r.status);
  const t = now();
  update(id, {
    status: 'downloading', detail: 'Starting the download…', progress: 0, eta: null, speed: null, size: null, needs_admin: 0,
    download_id: hash, manual_hash: hash, manual_name: deluge.magnetName(uri), manual_by: admin.username, manual_at: t,
    import_plan: null, live_at: null, checked_at: null,
    ...(undecided ? { decided_by: admin.username, decided_at: t, decline_reason: null } : {}),
  });
  require('./activity').log(req, {
    category: 'admin', action: 'request_magnet',
    detail: `${r.title}${r.year ? ` (${r.year})` : ''} — magnet link added to Deluge${cancelled ? ` (cancelled Radarr's download)` : ''}`,
  });
  if (undecided) await emailPeople(get(id), 'request_approved', { admin: admin.username }, req);
  await refreshManual(get(id)).catch(() => {});
  return get(id);
}

// Where everything in a finished download goes: the video (the biggest file,
// not a sample) as "<naming format>.ext" in the film's folder in the movie
// library, subtitles beside it or in a Subs folder as "<name>.<language>.srt".
function planImport(r, t) {
  const save = deluge.toLocal(t.savePath);
  const files = t.files.map(f => ({ rel: f.path.replace(/\\/g, '/'), size: f.size }));
  const { VIDEO_EXTENSIONS } = require('./scanner');
  const videos = files
    .filter(f => VIDEO_EXTENSIONS.has(path.extname(f.rel).toLowerCase()) && !/(^|[/._ -])sample([/._ -]|$)/i.test(f.rel))
    .sort((a, b) => b.size - a.size);
  if (!videos.length) {
    throw needs(`There's no video file in this download (${files.slice(0, 3).map(f => path.posix.basename(f.rel)).join(', ') || 'no files'}) — try another magnet link`);
  }
  const video = videos[0];
  const lib = movieLibrary();
  if (!lib) throw needs('Add a Movies library first (Admin › Libraries) — the film is moved into it');
  const cfg = naming.getConfig();
  const values = { title: r.title, year: r.year, tmdbId: r.tmdb_id };
  const folder = path.join(lib.path, naming.renderMovieName(cfg.naming_movie_folder, values));
  const base = naming.renderMovieName(cfg.naming_movie_file, values);
  const ext = path.extname(video.rel).toLowerCase();
  let name = base;
  for (let n = 2; fs.existsSync(path.join(folder, name + ext)); n++) name = `${base} (${n})`;
  const from = (rel) => path.join(save, ...rel.split('/'));
  const moves = [{ from: from(video.rel), to: path.join(folder, name + ext), video: true }];

  const videoDir = path.posix.dirname(video.rel);
  const videoBase = path.posix.basename(video.rel, path.extname(video.rel)).toLowerCase();
  const used = new Set();
  for (const f of files) {
    const e = path.extname(f.rel).toLowerCase();
    if (!SUB_EXTS.has(e)) continue;
    const dir = path.posix.dirname(f.rel);
    const below = videoDir === '.' ? (dir === '.' ? '' : dir) : dir === videoDir ? '' : dir.startsWith(`${videoDir}/`) ? dir.slice(videoDir.length + 1) : null;
    if (below === null || (below && !/^(subs?|subtitles?)(\/|$)/i.test(below))) continue;
    let tag = path.posix.basename(f.rel, path.extname(f.rel));
    if (tag.toLowerCase().startsWith(videoBase)) tag = tag.slice(videoBase.length);
    tag = tag.replace(/^[\s._-]*\d*[\s._-]*/, '').replace(/[^\p{L}\p{N}._-]+/gu, '.').replace(/^[.-]+|[.-]+$/g, '');
    let target = tag ? `${name}.${tag}` : name;
    for (let k = 2; used.has(target + e); k++) target = `${name}.${tag || 'sub'}${k}`;
    used.add(target + e);
    moves.push({ from: from(f.rel), to: path.join(folder, target + e) });
  }
  // The download's own folder, cleared away afterwards (only ever inside the download folder).
  const top = video.rel.includes('/') ? video.rel.split('/')[0] : null;
  const cleanup = top && !['.', '..'].includes(top) ? path.join(save, top) : null;
  return { libId: lib.id, folder, video: moves[0].to, moves, cleanup, save, savedAt: t.savePath };
}

// Move one file (copying across drives), picking up where an interrupted move left off.
async function moveInto(from, to) {
  const there = fs.existsSync(to);
  if (!fs.existsSync(from)) return there; // already moved, or gone
  if (there) { await fs.promises.unlink(from); return true; } // copied before a restart; the original stayed
  await fs.promises.mkdir(path.dirname(to), { recursive: true });
  try {
    await fs.promises.rename(from, to);
  } catch (err) {
    if (err.code !== 'EXDEV') throw err;
    const partial = `${to}.partial`;
    await fs.promises.copyFile(from, partial);
    await fs.promises.rename(partial, to);
    await fs.promises.unlink(from);
  }
  return true;
}

// The download is finished: take it out of Deluge, move it into the library and add it.
const importing = new Set();
async function importManual(r, t = null) {
  if (importing.has(r.id)) return;
  importing.add(r.id);
  try {
    let plan = r.import_plan ? JSON.parse(r.import_plan) : null;
    if (!plan) {
      t = t || await deluge.torrent(r.manual_hash);
      if (!t) throw needs('The download was removed from Deluge before it could be moved — paste the magnet link again');
      plan = planImport(r, t);
      if (!fs.existsSync(plan.moves[0].from)) {
        throw needs(`Downloaded, but Streamulus can't see the file at ${plan.moves[0].from}. ${deluge.inDocker()
          ? `Streamulus runs in Docker: mount Deluge's download folder into it at ${t.savePath} (DOWNLOADS_PATH in docker-compose / Portainer), redeploy, and it's picked up by itself — see Admin › Requests › Deluge › Test Deluge.`
          : deluge.settings().remotePath
            ? `Check the folder mapping in Admin › Requests › Deluge (Deluge saved it in ${t.savePath}).`
            : `If Deluge runs on another computer, say where its download folder (${t.savePath}) is on this server in Admin › Requests › Deluge.`}`);
      }
      update(r.id, {
        status: 'importing', import_plan: JSON.stringify(plan), progress: 1, eta: null, speed: null, needs_admin: 0,
        detail: 'Downloaded — moving it into the library', checked_at: now(),
      });
      // Out of Deluge first, so it isn't seeding from files that are about to move.
      await deluge.remove(r.manual_hash, false).catch(err => console.error(`[requests] Removing ${r.title} from Deluge: ${deluge.errorText(err)}`));
    }
    for (const m of plan.moves) {
      const ok = await moveInto(m.from, m.to);
      if (!ok && m.video) throw needs(`The downloaded file has gone missing (${m.from}) — paste the magnet link again`);
    }
    if (plan.cleanup) {
      const inside = path.resolve(plan.cleanup).startsWith(path.resolve(plan.save) + path.sep);
      if (inside) await fs.promises.rm(plan.cleanup, { recursive: true, force: true }).catch(() => {});
    }
    update(r.id, { status: 'adding', detail: 'Moved into the library — adding it to Streamulus', needs_admin: 0, checked_at: now(), scan_requested_at: now() });
    require('./activity').log(null, { category: 'admin', action: 'request_imported', username: 'Streamulus', detail: `${r.title}${r.year ? ` (${r.year})` : ''} → ${plan.video}` });
    const lib = db.prepare('SELECT * FROM libraries WHERE id = ?').get(plan.libId);
    if (lib) await require('./scanner').scanPaths(lib, [plan.folder]);
    if (r.radarr_id && radarr.configured()) radarr.rescan(r.radarr_id).catch(() => {});
    const local = inLibrary(r.tmdb_id) || db.prepare('SELECT id FROM movies WHERE file_path = ?').get(plan.video)?.id;
    if (local) await markAvailable(get(r.id), local);
  } catch (err) {
    console.error(`[requests] ${r.title}: ${err.message}`);
    update(r.id, {
      status: 'failed', needs_admin: 1, checked_at: now(),
      detail: err.needsAdmin ? err.message : `Couldn't move the download into the library: ${err.message}`,
    });
  } finally {
    importing.delete(r.id);
  }
}

// Check on a hand-added download in Deluge.
async function refreshManual(r) {
  if (!r?.manual_hash || !ACTIVE.includes(r.status) || importing.has(r.id)) return;
  if (r.import_plan) { importManual(r).catch(() => {}); return; } // moving (or resuming after a restart / a fix)
  if (r.status === 'adding') {
    const local = inLibrary(r.tmdb_id);
    if (local) return markAvailable(r, local);
    return update(r.id, { checked_at: now() });
  }
  let t;
  try {
    t = await deluge.torrent(r.manual_hash);
  } catch (err) {
    return update(r.id, { detail: `Can't reach Deluge right now (${deluge.errorText(err)})`, checked_at: now() });
  }
  if (!t) {
    return update(r.id, { status: 'failed', needs_admin: 1, progress: null, eta: null, speed: null, checked_at: now(), detail: 'The download was removed from Deluge — paste the magnet link again' });
  }
  if (t.finished) { importManual(r, t).catch(() => {}); return; }
  const fields = delugeDetail(t);
  if (!t.files.length && !(t.progress > 0)) fields.detail = 'Getting the download details from peers…';
  const named = t.name && t.name.toLowerCase() !== r.manual_hash ? { manual_name: t.name } : {};
  return update(r.id, { ...fields, ...named, status: 'downloading', checked_at: now() });
}

let timer = null;
function start() {
  if (timer) return;
  const tick = () => {
    poll().catch(err => console.error(`[requests] Poll failed: ${err.message}`))
      .finally(() => { timer = setTimeout(tick, refreshMs()); timer.unref?.(); });
  };
  timer = setTimeout(tick, refreshMs());
  timer.unref?.();
}

// Admin › Requests settings (Radarr's are in radarr.js).
function saveSettings(input = {}) {
  const map = { url: 'radarr_url', rootFolder: 'radarr_root_folder', qualityProfileId: 'radarr_quality_profile', minimumAvailability: 'radarr_minimum_availability' };
  for (const [k, key] of Object.entries(map)) if (input[k] !== undefined) setConf(key, String(input[k] ?? '').trim());
  if (typeof input.apiKey === 'string' && input.apiKey.trim()) setConf('radarr_api_key', input.apiKey.trim());
  if (input.enabled !== undefined) setConf('requests_enabled', input.enabled ? 'true' : 'false');
  if (input.limit !== undefined) setConf('requests_limit', String(Math.max(1, Math.min(100, parseInt(input.limit, 10) || 10))));
  if (input.notifyAdmins !== undefined) setConf('requests_notify_admins', input.notifyAdmins ? 'true' : 'false');
  if (input.refreshSeconds !== undefined) setConf('requests_refresh_seconds', String(Math.min(60, Math.max(1, Number(input.refreshSeconds) || 2))));
  if (input.delugeUrl !== undefined) setConf('deluge_url', String(input.delugeUrl || '').trim());
  if (typeof input.delugePassword === 'string' && input.delugePassword !== '') setConf('deluge_password', input.delugePassword);
  if (input.clearDelugePassword) setConf('deluge_password', '');
  const sonarrMap = { sonarrUrl: 'sonarr_url', sonarrRootFolder: 'sonarr_root_folder', sonarrQualityProfileId: 'sonarr_quality_profile', sonarrLanguageProfileId: 'sonarr_language_profile' };
  if (input.sonarrDownloadWhen !== undefined) setConf('sonarr_download_when', input.sonarrDownloadWhen === 'season' ? 'season' : 'aired');
  for (const [k, key] of Object.entries(sonarrMap)) if (input[k] !== undefined) setConf(key, String(input[k] ?? '').trim());
  if (typeof input.sonarrApiKey === 'string' && input.sonarrApiKey.trim()) setConf('sonarr_api_key', input.sonarrApiKey.trim());
  if (input.seriesLimit !== undefined) setConf('requests_series_limit', String(Math.max(1, Math.min(100, parseInt(input.seriesLimit, 10) || 3))));
  if (input.seasonLimit !== undefined) setConf('requests_season_limit', String(Math.max(1, Math.min(100, parseInt(input.seasonLimit, 10) || 5))));
  if (input.delugeRemotePath !== undefined) setConf('deluge_remote_path', String(input.delugeRemotePath || '').trim());
  if (input.delugeLocalPath !== undefined) setConf('deluge_local_path', String(input.delugeLocalPath || '').trim());
}

function settingsView() {
  const r = radarr.settings();
  return {
    ...settings(),
    open: isOpen(),
    radarr: {
      url: r.url, apiKeySet: !!r.apiKey, rootFolder: r.rootFolder, qualityProfileId: r.qualityProfileId,
      minimumAvailability: r.minimumAvailability, configured: radarr.configured(),
    },
    tvOpen: isTvOpen(),
    sonarr: (() => {
      const so = require('./sonarr');
      const x = so.settings();
      return { url: x.url, apiKeySet: !!x.apiKey, rootFolder: x.rootFolder, qualityProfileId: x.qualityProfileId, languageProfileId: x.languageProfileId, downloadWhen: x.downloadWhen, configured: so.configured() };
    })(),
    deluge: {
      url: deluge.settings().url, passwordSet: !!deluge.settings().password, configured: deluge.configured(),
      remotePath: deluge.settings().remotePath, localPath: deluge.settings().localPath,
      error: delugeError,
    },
  };
}

module.exports = {
  LABELS, ACTIVE, settings, settingsView, saveSettings, isOpen, shape, get, openFor, inLibrary, posterUrl,
  create, cancel, approve, decline, searchAgain, remove, refresh, poll, start, requesters, startMagnet,
  isTvOpen, titleOf, update, emailPeople, emailAdmins, moveInto,
};
