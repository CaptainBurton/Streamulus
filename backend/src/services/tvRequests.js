// Series requests: the whole series, or — for a show already on Streamulus — a
// single season. Approved ones go to Sonarr (as films go to Radarr), which
// downloads them episode by episode; Streamulus follows every episode in the
// request and keeps a per-season / per-episode checklist (tv_progress) for the
// Requests pages: ready, downloading (with progress), moving in, not found,
// not aired yet.
//
// The admin's backup is the same as for films: magnet links, here for the
// whole series, one season, or one episode — several per request if need be
// (request_downloads). Each is followed in Deluge; when it's done, every
// episode in it is moved into the show's season folder under the naming
// formats, and Sonarr is told to stop looking for that part.
const fs = require('fs');
const path = require('path');
const db = require('../database/db');
const sonarr = require('./sonarr');
const deluge = require('./deluge');
const tmdb = require('./tmdb');
const naming = require('./naming');

const R = () => require('./requests'); // (requests.js requires this file too)
const now = () => Date.now();
const SUB_EXTS = new Set(['.srt', '.vtt', '.ass', '.ssa', '.sub', '.idx']);
const needs = (message) => Object.assign(new Error(message), { needsAdmin: true });
const key = (s, e) => `${s}:${e}`;
const tvLibrary = () => db.prepare("SELECT * FROM libraries WHERE type = 'tv' ORDER BY id").get();
const isOpen = () => R().settings().enabled && sonarr.configured();

// "Arcane — Season 2" for a season request, else the show's name.
const displayTitle = (r) => (r.media_type === 'tv' && r.scope === 'season' && r.season_number != null ? `${r.title} — Season ${r.season_number}` : r.title);

// ── The show in Streamulus ───────────────────────────────────────────────────

const localShow = (tmdbId) => db.prepare('SELECT * FROM tv_shows WHERE tmdb_id = ? ORDER BY id').get(tmdbId) || null;

// "season:episode" for every episode of the show Streamulus has.
function localEpisodes(tmdbId) {
  const rows = db.prepare('SELECT e.season, e.episode_number FROM episodes e JOIN tv_shows s ON s.id = e.show_id WHERE s.tmdb_id = ? AND e.episode_number IS NOT NULL').all(tmdbId);
  return new Set(rows.map(r => key(r.season, r.episode_number)));
}

// ── TMDB, cached ─────────────────────────────────────────────────────────────

const showCache = new Map();
async function showDetails(tmdbId) {
  const hit = showCache.get(tmdbId);
  if (hit && now() - hit.at < 60 * 60 * 1000) return hit.data;
  const data = await tmdb.getTVFull(tmdbId);
  showCache.set(tmdbId, { at: now(), data });
  return data;
}

const aired = (date) => !!date && Date.parse(date) <= now();

// Every episode of these seasons from TMDB: [{ season, episode, title, airDate }]
async function tmdbEpisodes(tmdbId, seasons) {
  const lists = await Promise.all(seasons.map(n => tmdb.getSeason(tmdbId, n).catch(() => null)));
  return lists.flatMap((s, i) => (s?.episodes || []).map(e => ({
    season: seasons[i], episode: e.episode_number, title: e.name || null, airDate: e.air_date || null,
  })));
}

// The seasons a request covers (no specials for a whole series).
async function requestSeasons(r, details = null) {
  if (r.scope === 'season') return [r.season_number];
  const d = details || await showDetails(r.tmdb_id);
  return (d?.seasons || []).map(s => s.season_number).filter(n => n > 0);
}

// ── Asking ───────────────────────────────────────────────────────────────────

// The open (not declined, not finished) series request for a show, or season request for one season.
const openSeries = (tmdbId) => db.prepare("SELECT * FROM media_requests WHERE media_type = 'tv' AND tmdb_id = ? AND scope = 'series' AND status NOT IN ('declined', 'available') ORDER BY id DESC").get(tmdbId);
const openSeason = (tmdbId, season) => db.prepare("SELECT * FROM media_requests WHERE media_type = 'tv' AND tmdb_id = ? AND scope = 'season' AND season_number = ? AND status NOT IN ('declined', 'available') ORDER BY id DESC").get(tmdbId, season);

function openCount(userId, scope) {
  return db.prepare(`
    SELECT COUNT(*) AS n FROM media_requests r JOIN media_request_users ru ON ru.request_id = r.id
    WHERE ru.user_id = ? AND r.media_type = 'tv' AND r.scope = ? AND r.status NOT IN ('declined', 'available')
  `).get(userId, scope).n;
}

/**
 * Ask for a series (scope 'series') or one season of a show that's already on
 * Streamulus (scope 'season'). → { request, joined, already } or throws.
 */
async function create({ user, tmdbId, scope, season, note, req }) {
  const S = R().settings();
  if (!isOpen()) throw Object.assign(new Error('Series requests are turned off'), { status: 403 });
  tmdbId = parseInt(tmdbId, 10);
  scope = scope === 'season' ? 'season' : 'series';
  season = scope === 'season' ? parseInt(season, 10) : null;
  if (!tmdbId) throw Object.assign(new Error('Choose a series to request'), { status: 400 });
  if (scope === 'season' && !(season >= 0)) throw Object.assign(new Error('Choose a season'), { status: 400 });

  let details;
  try { details = await showDetails(tmdbId); } catch { details = null; }
  if (!details?.name) throw Object.assign(new Error("Couldn't find that series on TMDB"), { status: 404 });
  const local = localShow(tmdbId);
  const have = localEpisodes(tmdbId);

  if (scope === 'season') {
    if (!local) throw Object.assign(new Error("This show isn't on Streamulus yet — request the whole series"), { status: 400 });
    if (!(details.seasons || []).some(s => s.season_number === season)) throw Object.assign(new Error(`${details.name} has no season ${season}`), { status: 404 });
    const eps = (await tmdbEpisodes(tmdbId, [season])).filter(e => aired(e.airDate));
    if (eps.length && eps.every(e => have.has(key(e.season, e.episode)))) {
      throw Object.assign(new Error(`Season ${season} is already on Streamulus`), { status: 409, showId: local.id });
    }
  } else if (local) {
    const eps = (await tmdbEpisodes(tmdbId, (details.seasons || []).map(s => s.season_number).filter(n => n > 0))).filter(e => aired(e.airDate));
    if (eps.length && eps.every(e => have.has(key(e.season, e.episode)))) {
      throw Object.assign(new Error("It's already on Streamulus — every episode that has aired"), { status: 409, showId: local.id });
    }
  }

  // Someone already asked for the whole series (covers any season), or this season.
  const existing = openSeries(tmdbId) || (scope === 'season' ? openSeason(tmdbId, season) : null);
  if (existing) {
    const already = db.prepare('SELECT 1 FROM media_request_users WHERE request_id = ? AND user_id = ?').get(existing.id, user.id);
    if (!already) db.prepare('INSERT INTO media_request_users (request_id, user_id, created_at) VALUES (?, ?, ?)').run(existing.id, user.id, now());
    return { request: R().get(existing.id), joined: !already, already: !!already };
  }

  if (user.role !== 'admin') {
    const limit = scope === 'series' ? S.seriesLimit : S.seasonLimit;
    if (openCount(user.id, scope) >= limit) {
      throw Object.assign(new Error(`You have ${limit} ${scope === 'series' ? 'series' : 'season'} request${limit === 1 ? '' : 's'} on the go — wait for some to finish (or cancel one) before asking for more`), { status: 429 });
    }
  }

  const t = now();
  const id = db.prepare(`
    INSERT INTO media_requests (media_type, tmdb_id, title, year, poster_path, backdrop_path, overview, user_id, note, status,
      scope, season_number, tvdb_id, show_id, created_at, updated_at)
    VALUES ('tv', ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)
  `).run(
    tmdbId, details.name, details.first_air_date ? parseInt(details.first_air_date, 10) : null,
    details.poster_path || null, details.backdrop_path || null, (details.overview || '').slice(0, 2000),
    user.id, String(note || '').trim().slice(0, 500) || null,
    scope, season, details.external_ids?.tvdb_id || null, local?.id || null, t, t,
  ).lastInsertRowid;
  db.prepare('INSERT INTO media_request_users (request_id, user_id, created_at) VALUES (?, ?, ?)').run(id, user.id, t);
  const r = R().get(id);
  R().emailAdmins(r, user, req).catch(() => {});
  return { request: r, joined: false };
}

// ── Deciding ─────────────────────────────────────────────────────────────────

async function tvdbOf(r) {
  if (r.tvdb_id) return r.tvdb_id;
  const d = await showDetails(r.tmdb_id).catch(() => null);
  const id = d?.external_ids?.tvdb_id || null;
  if (id) R().update(r.id, { tvdb_id: id });
  return id;
}

async function approve({ id, admin, req, qualityProfileId, rootFolder, languageProfileId, notify = true }) {
  const r = R().get(id);
  if (!r) throw Object.assign(new Error('Request not found'), { status: 404 });
  if (!['pending', 'declined'].includes(r.status)) throw Object.assign(new Error('That request was already approved'), { status: 400 });
  if (!sonarr.configured()) throw Object.assign(new Error('Set up Sonarr in Admin › Requests first'), { status: 400 });
  const tvdb = await tvdbOf(r);
  if (!tvdb) throw Object.assign(new Error("This series has no TVDB id on TMDB, so Sonarr can't add it — use a magnet link instead"), { status: 400 });
  let result;
  try {
    result = await sonarr.addAndSearch(tvdb, {
      season: r.scope === 'season' ? r.season_number : null, qualityProfileId, rootFolder, languageProfileId, hold: sonarr.settings().downloadWhen === 'season',
    });
  } catch (err) {
    throw Object.assign(new Error(sonarr.errorText(err)), { status: 502 });
  }
  const t = now();
  R().update(id, {
    status: result.command ? 'searching' : 'waiting_release', detail: result.command ? 'Searching for downloads…' : 'Waiting for the season to finish airing',
    progress: null, eta: null, needs_admin: 0, decline_reason: null,
    decided_by: admin.username, decided_at: t, sonarr_id: result.series.id, search_command_id: result.command?.id || null, searched_at: t, checked_at: null,
    held_seasons: result.held?.length ? JSON.stringify(result.held) : null,
  });
  require('./activity').log(req, { category: 'admin', action: 'request_approved', detail: displayTitle(r) });
  if (notify) await R().emailPeople(R().get(id), 'request_approved', { admin: admin.username }, req);
  refresh(R().get(id)).catch(() => {});
  return R().get(id);
}

// Search again (after "not found" or a failed download) — and monitor it again
// if a magnet link had told Sonarr to stop.
async function searchAgain({ id, req }) {
  const r = R().get(id);
  if (!r) throw Object.assign(new Error('Request not found'), { status: 404 });
  if (!sonarr.configured()) throw Object.assign(new Error('Set up Sonarr in Admin › Requests first'), { status: 400 });
  const tvdb = await tvdbOf(r);
  if (!tvdb) throw Object.assign(new Error("This series has no TVDB id, so Sonarr can't search for it — use a magnet link"), { status: 400 });
  let result;
  try {
    result = await sonarr.addAndSearch(tvdb, { season: r.scope === 'season' ? r.season_number : null, hold: sonarr.settings().downloadWhen === 'season' });
  } catch (err) {
    throw Object.assign(new Error(sonarr.errorText(err)), { status: 502 });
  }
  R().update(id, {
    status: 'searching', detail: 'Searching for downloads…', needs_admin: 0, sonarr_id: result.series.id, search_command_id: result.command?.id || null, searched_at: now(), checked_at: null,
    held_seasons: result.held?.length ? JSON.stringify(result.held) : null,
  });
  require('./activity').log(req, { category: 'admin', action: 'request_searched', detail: displayTitle(r) });
  refresh(R().get(id)).catch(() => {});
  return R().get(id);
}

// ── Following a request ──────────────────────────────────────────────────────

// A Sonarr queue record → { state, progress, eta, dl (download id) }.
function queueState(item) {
  const size = Number(item.size) || 0;
  const left = Number(item.sizeleft) || 0;
  const progress = size > 0 ? Math.min(1, Math.max(0, (size - left) / size)) : 0;
  const tracked = item.trackedDownloadState;
  if (['importPending', 'importing', 'imported'].includes(tracked)) {
    const blocked = item.trackedDownloadStatus === 'warning' && tracked === 'importPending';
    const why = (item.statusMessages || []).flatMap(m => m.messages || [m.title]).filter(Boolean)[0];
    return { state: blocked ? 'failed' : 'importing', progress: 1, detail: blocked ? `Sonarr can't move it into the library: ${why || 'needs a look'}` : null };
  }
  if (['failedPending', 'failed'].includes(tracked) || item.trackedDownloadStatus === 'error') {
    return { state: 'failed', progress, detail: `The download failed${item.errorMessage ? `: ${item.errorMessage}` : ''}` };
  }
  const eta = item.estimatedCompletionTime ? Date.parse(item.estimatedCompletionTime) : null;
  return { state: 'downloading', progress, eta: eta && eta > now() ? eta : null, dl: item.downloadId ? String(item.downloadId).toLowerCase() : null };
}

// Totals and the overall status from the per-episode states.
function summarise(seasons) {
  const all = seasons.flatMap(s => s.episodes);
  const count = (st) => all.filter(e => e.state === st).length;
  const airedEps = all.filter(e => e.state !== 'unaired');
  const partial = airedEps.reduce((n, e) => n + (e.state === 'ready' ? 1 : ['importing', 'adding'].includes(e.state) ? 1 : e.state === 'downloading' ? (e.progress || 0) : 0), 0);
  for (const s of seasons) {
    const eps = s.episodes.filter(e => e.state !== 'unaired');
    s.total = eps.length;
    s.ready = eps.filter(e => e.state === 'ready').length;
    s.active = eps.filter(e => ['downloading', 'importing', 'adding'].includes(e.state)).length;
    s.missing = eps.filter(e => ['missing', 'failed'].includes(e.state)).length;
    s.waiting = eps.filter(e => e.state === 'waiting').length;
    s.unaired = s.episodes.length - eps.length;
    s.progress = s.total ? eps.reduce((n, e) => n + (e.state === 'ready' || ['importing', 'adding'].includes(e.state) ? 1 : e.state === 'downloading' ? (e.progress || 0) : 0), 0) / s.total : 0;
  }
  return {
    total: airedEps.length,
    ready: count('ready'),
    downloading: count('downloading'),
    importing: count('importing') + count('adding'),
    searching: count('searching'),
    missing: count('missing'),
    failed: count('failed'),
    waiting: count('waiting'),
    unaired: count('unaired'),
    progress: airedEps.length ? partial / airedEps.length : 0,
    seasons,
  };
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// The request's status and one-line detail from its checklist.
function overall(r, p, { searching }) {
  const where = r.scope === 'season' ? `Season ${r.season_number}: ` : '';
  const parts = [`${p.ready} of ${plural(p.total, 'episode')} ready`];
  if (p.downloading) parts.push(`${p.downloading} downloading`);
  if (p.importing) parts.push(`${p.importing} moving in`);
  if (p.missing) parts.push(`${p.missing} not found yet`);
  if (p.failed) parts.push(`${p.failed} with a problem`);
  if (p.waiting) parts.push(`${p.waiting} waiting for the season to finish`);
  const text = where + parts.join(' · ');
  const next = p.seasons.flatMap(s => s.episodes).filter(e => e.state === 'unaired' && e.airDate).sort((a, b) => Date.parse(a.airDate) - Date.parse(b.airDate))[0];
  const nextText = next ? ` (next: ${new Date(next.airDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })})` : '';
  if (p.total === 0) return { status: 'waiting_release', needs_admin: 0, detail: `${where}Not aired yet — episodes download as they air${nextText}` };
  if (p.ready === p.total) return { status: 'available', needs_admin: 0, detail: p.unaired ? `${where}All ${p.total} aired episodes ready · ${p.unaired} more to come${nextText}` : null };
  if (p.downloading) return { status: 'downloading', needs_admin: 0, detail: text };
  if (p.importing) return { status: 'importing', needs_admin: 0, detail: text };
  if (searching || p.searching) return { status: 'searching', needs_admin: 0, detail: `${where}Searching for downloads… · ${p.ready} of ${plural(p.total, 'episode')} ready` };
  if (p.waiting && !p.missing && !p.failed) {
    // Held back until the season's last episode is out (Download when: the whole season).
    const held = p.seasons.filter(s => s.waiting);
    const finale = held.flatMap(s => s.episodes).map(e => e.airDate).filter(Boolean).sort().pop();
    const when = finale && !aired(finale) ? ` (last episode: ${new Date(finale).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })})` : '';
    return {
      status: 'waiting_release', needs_admin: 0,
      detail: `${p.ready} of ${plural(p.total, 'episode')} ready · ${held.map(s => `Season ${s.season}`).join(', ')} download${held.length === 1 ? 's' : ''} in one go once ${held.length === 1 ? 'it has' : 'they have'} finished airing${when}`,
    };
  }
  if (p.failed) return { status: 'failed', needs_admin: 1, detail: `${text} — an admin will look into it` };
  return { status: 'not_found', needs_admin: 1, detail: `${text} — an admin will look into it. Sonarr keeps checking for new releases.` };
}

// Magnet downloads that are still going, by episode: { "s:e": { state, progress, dl } }
function manualByEpisode(requestId) {
  const out = {};
  for (const d of db.prepare("SELECT * FROM request_downloads WHERE request_id = ? AND status IN ('downloading', 'importing')").all(requestId)) {
    const files = JSON.parse(d.files || '[]');
    for (const f of files) {
      if (f.season == null || f.episode == null) continue;
      out[key(f.season, f.episode)] = { state: d.status === 'importing' ? 'importing' : 'downloading', progress: d.status === 'importing' ? 1 : (f.progress ?? d.progress ?? 0), manual: d.id };
    }
    // Episodes it should cover but whose files aren't known yet (metadata still coming).
    if (!files.length && d.scope === 'episode') out[key(d.season, d.episode)] = { state: 'downloading', progress: d.progress || 0, manual: d.id };
    if (!files.length && d.scope !== 'episode') (out.pending = out.pending || []).push(d);
  }
  return out;
}
// A season / series magnet whose file list isn't known yet covers these episodes for now.
const pendingCovers = (manual, season) => (manual.pending || []).find(d => d.scope === 'series' || d.season === season);

// Scan the show's folder in Streamulus (found by Sonarr's folder name).
function scanForShow(seriesPath) {
  const scanner = require('./scanner');
  const folder = seriesPath ? path.basename(seriesPath) : null;
  const libs = db.prepare("SELECT * FROM libraries WHERE type = 'tv'").all();
  let found = false;
  for (const lib of libs) {
    const candidate = folder ? path.join(lib.path, folder) : null;
    if (candidate && fs.existsSync(candidate)) {
      found = true;
      scanner.scanPaths(lib, [candidate]).catch(err => console.error(`[requests] Scan failed: ${err.message}`));
    }
  }
  if (!found) for (const lib of libs) scanner.scanAllWithProgress(() => {}, lib.id).catch(() => {});
}

/**
 * Look a series request up (Sonarr, Streamulus's library, magnet downloads),
 * rebuild its checklist and record its status. ctx.queue: Sonarr's queue by
 * series, shared across one round of checks.
 */
async function refresh(r, ctx = {}) {
  const ACTIVE = R().ACTIVE;
  if (!r || r.media_type !== 'tv' || !(ACTIVE.includes(r.status) || r.status === 'pending' && hasDownloads(r.id))) return;
  await refreshDownloads(r);
  r = R().get(r.id);

  let series = null;
  let eps = null;
  if (r.sonarr_id && sonarr.configured()) {
    try {
      series = await sonarr.getSeries(r.sonarr_id);
      eps = await sonarr.episodes(r.sonarr_id);
    } catch (err) {
      if (err?.response?.status === 404 && !hasDownloads(r.id)) {
        return R().update(r.id, { status: 'missing', detail: 'Removed from Sonarr — Search Again adds it back', needs_admin: 1, checked_at: now() });
      }
      if (err?.response?.status !== 404) {
        return R().update(r.id, { detail: `Can't reach Sonarr right now (${sonarr.errorText(err)})`, checked_at: now() });
      }
    }
  }

  // The episodes this request covers.
  let list;
  if (eps) {
    list = eps.filter(e => (r.scope === 'season' ? e.seasonNumber === r.season_number : e.seasonNumber > 0))
      .map(e => ({ season: e.seasonNumber, episode: e.episodeNumber, title: e.title || null, airDate: e.airDateUtc || e.airDate || null, sonarrId: e.id, hasFile: !!e.hasFile }));
  } else {
    list = await tmdbEpisodes(r.tmdb_id, await requestSeasons(r).catch(() => (r.season_number ? [r.season_number] : [])));
  }

  const have = localEpisodes(r.tmdb_id);
  const manual = manualByEpisode(r.id);
  let queueByEp = new Map();
  if (series) {
    const queue = (ctx.queue || await sonarr.queueBySeries().catch(() => new Map())).get(r.sonarr_id) || [];
    queueByEp = new Map(queue.map(q => [q.episodeId, queueState(q)]));
  }
  // Fresh numbers from Deluge for Sonarr's downloads.
  const ids = [...new Set([...queueByEp.values()].map(q => q.dl).filter(Boolean))];
  if (ids.length && deluge.configured()) {
    const live = await deluge.torrents(ids).catch(() => ({}));
    for (const q of queueByEp.values()) {
      const t = q.dl && live[q.dl];
      if (t && q.state === 'downloading') { q.progress = t.progress; q.eta = t.eta && t.progress < 1 ? now() + t.eta * 1000 : null; q.speed = t.speed; }
    }
  }

  // Held seasons whose last episode is out: monitor them and search for the whole season.
  let held = r.held_seasons ? JSON.parse(r.held_seasons) : [];
  if (series && eps && held.length) {
    for (const n of [...held]) {
      const seasonEps = eps.filter(e => e.seasonNumber === n);
      if (!seasonEps.length || !seasonEps.every(e => aired(e.airDateUtc || e.airDate))) continue;
      try {
        const cmd = await sonarr.releaseSeason(r.sonarr_id, n);
        held = held.filter(x => x !== n);
        R().update(r.id, { held_seasons: held.length ? JSON.stringify(held) : null, search_command_id: cmd?.id || null, searched_at: now() });
        r = R().get(r.id);
        require('./activity').log(null, { category: 'admin', action: 'request_searched', username: 'Streamulus', detail: `${displayTitle(r)} — season ${n} has finished airing, searching for it` });
      } catch (err) {
        console.error(`[requests] ${r.title}: couldn't release season ${n}: ${sonarr.errorText(err)}`);
      }
    }
  }

  let searching = false;
  if (series && r.search_command_id && ['searching', 'pending', 'waiting_release', 'not_found'].includes(r.status) && now() - (r.searched_at || 0) < 30 * 60 * 1000) {
    try { searching = ['queued', 'started'].includes((await sonarr.command(r.search_command_id))?.status); } catch { /* forgotten: finished */ }
  }

  const bySeason = new Map();
  let adding = false;
  for (const e of list.sort((a, b) => a.season - b.season || a.episode - b.episode)) {
    const k = key(e.season, e.episode);
    const q = e.sonarrId != null ? queueByEp.get(e.sonarrId) : null;
    let ep = { episode: e.episode, title: e.title, airDate: e.airDate };
    if (have.has(k)) ep.state = 'ready';
    else if (manual[k]) Object.assign(ep, { state: manual[k].state, progress: manual[k].progress, manual: true });
    else if (aired(e.airDate) && pendingCovers(manual, e.season)) Object.assign(ep, { state: 'downloading', progress: 0, manual: true });
    else if (q) Object.assign(ep, { state: q.state, progress: q.progress, eta: q.eta || null, ...(q.detail ? { detail: q.detail } : {}), ...(q.dl ? { dl: q.dl } : {}) });
    else if (e.hasFile) { ep.state = 'adding'; adding = true; }
    else if (!aired(e.airDate)) ep.state = 'unaired';
    else if (held.includes(e.season)) ep.state = 'waiting';
    else ep.state = searching ? 'searching' : 'missing';
    if (!bySeason.has(e.season)) bySeason.set(e.season, []);
    bySeason.get(e.season).push(ep);
  }
  const p = summarise([...bySeason.entries()].map(([season, episodes]) => ({ season, episodes })));

  // Sonarr has files Streamulus hasn't picked up yet: scan the show's folder.
  const fields = { tv_progress: JSON.stringify(p), progress: p.progress, checked_at: now() };
  if (adding && series && (!r.scan_requested_at || now() - r.scan_requested_at > 2 * 60 * 1000)) {
    scanForShow(series.path);
    fields.scan_requested_at = now();
  }
  const local = localShow(r.tmdb_id);
  if (local) fields.show_id = local.id;

  // Downloads that went wrong need the admin too.
  const broken = db.prepare("SELECT detail FROM request_downloads WHERE request_id = ? AND status = 'failed' ORDER BY id DESC").get(r.id);
  let state = overall(r, p, { searching });
  if (broken && state.status !== 'available') state = { status: state.status === 'downloading' ? 'downloading' : 'failed', needs_admin: 1, detail: `${state.detail || ''}${state.detail ? ' · ' : ''}Magnet download: ${broken.detail}` };
  if (state.status === 'available' && r.status !== 'available') {
    R().update(r.id, { ...fields, ...state, speed: null, eta: null });
    const showId = local?.id || r.show_id;
    require('./activity').log(null, { category: 'admin', action: 'request_available', username: 'Streamulus', detail: displayTitle(r) });
    await R().emailPeople(R().get(r.id), 'request_available', { link: `${require('./mailer').siteUrl(null)}/${showId ? `tv/${showId}` : 'requests'}` });
    return;
  }
  const soonest = p.seasons.flatMap(s => s.episodes).filter(e => e.state === 'downloading' && e.eta).map(e => e.eta).sort((a, b) => b - a)[0] || null;
  R().update(r.id, { ...fields, ...state, eta: soonest });
}

const hasDownloads = (requestId) => !!db.prepare("SELECT 1 FROM request_downloads WHERE request_id = ? AND status IN ('downloading', 'importing', 'failed')").get(requestId);

// ── Magnet links (the admin's backup) ────────────────────────────────────────

const MAGNET_OK = ['pending', 'declined', 'searching', 'waiting_release', 'not_found', 'failed', 'missing', 'downloading', 'importing'];

/**
 * Download part of a series from a magnet link: scope 'series' (everything in
 * it), 'season' (season) or 'episode' (season + episode). Counts as approving
 * it if it was waiting or declined.
 */
async function startMagnet({ id, admin, magnet, scope, season, episode, req }) {
  const r = R().get(id);
  if (!r) throw Object.assign(new Error('Request not found'), { status: 404 });
  if (!MAGNET_OK.includes(r.status)) throw Object.assign(new Error("It's already on Streamulus"), { status: 400 });
  scope = ['series', 'season', 'episode'].includes(scope) ? scope : (r.scope === 'season' ? 'season' : 'series');
  season = scope === 'series' ? null : parseInt(season ?? r.season_number, 10);
  episode = scope === 'episode' ? parseInt(episode, 10) : null;
  if (r.scope === 'season' && (scope === 'series' || season !== r.season_number)) {
    throw Object.assign(new Error(`This request is for season ${r.season_number} — add a magnet link for that season or one of its episodes`), { status: 400 });
  }
  if (scope !== 'series' && !(season >= 0)) throw Object.assign(new Error('Choose the season'), { status: 400 });
  if (scope === 'episode' && !(episode >= 1)) throw Object.assign(new Error('Choose the episode'), { status: 400 });
  if (!deluge.configured()) throw Object.assign(new Error('Connect Deluge first (Admin › Requests › Deluge) — the magnet link is added there'), { status: 400 });
  const uri = String(magnet || '').trim();
  if (!deluge.magnetHash(uri)) throw Object.assign(new Error("That isn't a magnet link — it should start with magnet:?xt=urn:btih:"), { status: 400 });
  if (!tvLibrary()) throw Object.assign(new Error('Add a TV library first (Admin › Libraries) — the episodes are moved into it'), { status: 400 });

  let hash;
  try { hash = await deluge.addMagnet(uri); } catch (err) { throw Object.assign(new Error(deluge.errorText(err)), { status: 502 }); }
  if (db.prepare("SELECT 1 FROM request_downloads WHERE request_id = ? AND hash = ? AND status IN ('downloading', 'importing')").get(r.id, hash)) {
    throw Object.assign(new Error('That magnet link is already downloading for this request'), { status: 409 });
  }
  let cancelled = 0;
  if (r.sonarr_id && sonarr.configured()) {
    cancelled = await sonarr.standDown(r.sonarr_id, { scope, season, episode }).catch((err) => { console.error(`[requests] Sonarr: ${sonarr.errorText(err)}`); return 0; });
  }
  // A magnet for the whole series or a season replaces any hold on it.
  if (r.held_seasons && scope !== 'episode') {
    const held = JSON.parse(r.held_seasons).filter(n => scope === 'season' && n !== season);
    R().update(r.id, { held_seasons: held.length ? JSON.stringify(held) : null });
  }
  const t = now();
  db.prepare(`INSERT INTO request_downloads (request_id, hash, name, scope, season, episode, status, progress, detail, added_by, added_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'downloading', 0, 'Starting the download…', ?, ?, ?)`)
    .run(r.id, hash, deluge.magnetName(uri), scope, season, episode, admin.username, t, t);
  const undecided = ['pending', 'declined'].includes(r.status);
  R().update(id, {
    status: 'downloading', needs_admin: 0, checked_at: null,
    ...(undecided ? { decided_by: admin.username, decided_at: t, decline_reason: null, detail: 'Starting the download…' } : {}),
  });
  const what = scope === 'series' ? 'the whole series' : scope === 'season' ? `season ${season}` : `S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`;
  require('./activity').log(req, { category: 'admin', action: 'request_magnet', detail: `${displayTitle(r)} — magnet link for ${what} added to Deluge${cancelled ? ` (cancelled ${cancelled} Sonarr download${cancelled === 1 ? '' : 's'})` : ''}` });
  if (undecided) await R().emailPeople(R().get(id), 'request_approved', { admin: admin.username }, req);
  await refresh(R().get(id)).catch((err) => console.error(`[requests] ${r.title}: ${err.message}`));
  return R().get(id);
}

// Which episode each video in a download is — by its name, falling back to the
// season (and episode) the admin chose — keeping only the ones it was added for.
function mapFiles(files, d) {
  const { VIDEO_EXTENSIONS } = require('./scanner');
  const cfg = naming.getConfig();
  const videos = files.filter(f => VIDEO_EXTENSIONS.has(path.extname(f.path).toLowerCase()) && !/(^|[/._ -])sample([/._ -]|$)/i.test(f.path));
  const out = [];
  const unmatched = [];
  for (const f of videos) {
    const got = naming.episodeFromFile(path.posix.basename(f.path.replace(/\\/g, '/')), cfg);
    let season = got?.season ?? null;
    let episode = got?.episode ?? null;
    if (season == null && episode != null && d.scope !== 'series') season = d.season;
    if (season == null && episode != null && d.scope === 'series') {
      const folder = f.path.replace(/\\/g, '/').split('/').slice(0, -1).reverse().map(x => naming.seasonFromFolder(x, cfg)).find(x => x != null);
      season = folder ?? 1;
    }
    out.push({ ...f, season, episode });
  }
  if (d.scope === 'episode') {
    const exact = out.find(f => f.season === d.season && f.episode === d.episode);
    const pick = exact || (out.length === 1 ? out[0] : [...out].sort((a, b) => b.size - a.size)[0]);
    return { files: pick ? [{ ...pick, season: d.season, episode: d.episode }] : [], unmatched: [] };
  }
  const kept = out.filter(f => f.episode != null && f.season != null && (d.scope === 'series' || f.season === d.season));
  for (const f of out) if (!kept.includes(f)) unmatched.push(f.path);
  return { files: kept, unmatched };
}

const speedText = (bps) => (bps >= 1e6 ? `${(bps / 1e6).toFixed(1)} MB/s` : bps >= 1e3 ? `${Math.round(bps / 1e3)} KB/s` : null);
function minutesLeft(sec) {
  if (!(sec > 0)) return null;
  const m = Math.max(1, Math.round(sec / 60));
  return m < 60 ? `${m} min left` : `${Math.floor(m / 60)} h ${m % 60} min left`;
}

// Check one magnet download in Deluge; move it in when it's done.
async function refreshDownload(d, r) {
  if (d.import_plan) return importDownload(d, r);
  let t;
  try { t = await deluge.torrent(d.hash); } catch (err) {
    return db.prepare('UPDATE request_downloads SET detail = ?, checked_at = ? WHERE id = ?').run(`Can't reach Deluge right now (${deluge.errorText(err)})`, now(), d.id);
  }
  if (!t) {
    return db.prepare("UPDATE request_downloads SET status = 'failed', needs_admin = 1, detail = ?, updated_at = ?, checked_at = ? WHERE id = ?")
      .run('The download was removed from Deluge — paste the magnet link again', now(), now(), d.id);
  }
  const { files } = mapFiles(t.files, d);
  const state = String(t.state || '').toLowerCase();
  const pct = `${Math.round(t.progress * 100)}%`;
  const detail = !t.files.length ? 'Getting the download details from peers…'
    : state === 'paused' ? `Paused at ${pct}` : state === 'queued' ? `Waiting to start in Deluge (${pct})` : state === 'error' ? `${pct} · Deluge reports an error with this download`
      : [pct, speedText(t.speed), t.speed > 0 ? minutesLeft(t.eta) : 'waiting for peers'].filter(Boolean).join(' · ');
  db.prepare('UPDATE request_downloads SET name = ?, progress = ?, eta = ?, speed = ?, detail = ?, files = ?, needs_admin = ?, updated_at = ?, checked_at = ? WHERE id = ?').run(
    t.name && t.name.toLowerCase() !== d.hash ? t.name : d.name, t.progress, t.eta && t.progress < 1 ? now() + t.eta * 1000 : null, t.speed || 0, detail,
    JSON.stringify(files.map(f => ({ path: f.path, size: f.size, season: f.season, episode: f.episode, progress: f.progress }))), state === 'error' ? 1 : 0, now(), now(), d.id,
  );
  if (t.finished) return importDownload(db.prepare('SELECT * FROM request_downloads WHERE id = ?').get(d.id), r, t);
  return null;
}

async function refreshDownloads(r) {
  const rows = db.prepare("SELECT * FROM request_downloads WHERE request_id = ? AND (status IN ('downloading', 'importing') OR (status = 'failed' AND (checked_at IS NULL OR checked_at < ?)))")
    .all(r.id, now() - (Number(process.env.REQUESTS_MANUAL_RETRY_MS) || 60 * 1000));
  for (const d of rows) {
    try { await refreshDownload(d, r); } catch (err) { console.error(`[requests] ${r.title} download: ${err.message}`); }
  }
}

// The show's folder in the TV library: the one Streamulus already has, else
// Sonarr's folder name, else one named by the series folder format.
async function showFolder(r) {
  const local = db.prepare('SELECT folder_path FROM tv_shows WHERE tmdb_id = ? AND folder_path IS NOT NULL ORDER BY id').all(r.tmdb_id)
    .map(x => x.folder_path).find(p => !p.startsWith('title:') && fs.existsSync(p));
  if (local) return local;
  const lib = tvLibrary();
  if (!lib) throw needs('Add a TV library first (Admin › Libraries) — the episodes are moved into it');
  if (r.sonarr_id && sonarr.configured()) {
    const series = await sonarr.getSeries(r.sonarr_id).catch(() => null);
    if (series?.path) return path.join(lib.path, path.basename(series.path.replace(/\\/g, '/')));
  }
  const cfg = naming.getConfig();
  return path.join(lib.path, naming.renderName(cfg.naming_series_folder, { title: r.title, year: r.year, tmdbId: r.tmdb_id, tvdbId: r.tvdb_id }));
}

// Episode titles for file names: Sonarr's (same numbering as the files), else TMDB's.
async function episodeTitles(r, seasons) {
  const titles = new Map();
  if (r.sonarr_id && sonarr.configured()) {
    for (const e of await sonarr.episodes(r.sonarr_id).catch(() => [])) titles.set(key(e.seasonNumber, e.episodeNumber), e.title);
  }
  if (!titles.size) for (const e of await tmdbEpisodes(r.tmdb_id, seasons)) titles.set(key(e.season, e.episode), e.title);
  return titles;
}

async function planImport(d, r, t) {
  const save = deluge.toLocal(t.savePath);
  const { files, unmatched } = mapFiles(t.files, d);
  if (!files.length) {
    throw needs(d.scope === 'episode' ? "There's no video file in this download — try another magnet link"
      : `None of the files in this download could be matched to ${d.scope === 'season' ? `season ${d.season}` : 'the series'}'s episodes — try another magnet link`);
  }
  const folder = await showFolder(r);
  const cfg = naming.getConfig();
  const titles = await episodeTitles(r, [...new Set(files.map(f => f.season))]);
  const seasonDirs = new Map();
  const existing = fs.existsSync(folder) ? fs.readdirSync(folder, { withFileTypes: true }).filter(x => x.isDirectory()).map(x => x.name) : [];
  // A new season folder follows the show's own style: "Season 02" beside an existing "Season 01".
  const padded = existing.some(x => /^Season 0\d\b/i.test(x)) && cfg.naming_season_folder === naming.DEFAULTS.naming_season_folder;
  const seasonDir = (n) => {
    if (!seasonDirs.has(n)) {
      const found = existing.find(x => naming.seasonFromFolder(x, cfg) === n);
      seasonDirs.set(n, path.join(folder, found || naming.renderName(padded ? 'Season {season:00}' : cfg.naming_season_folder, { season: n })));
    }
    return seasonDirs.get(n);
  };
  const from = (rel) => path.join(save, ...rel.replace(/\\/g, '/').split('/'));
  const moves = [];
  const taken = new Set();
  for (const f of files) {
    const ext = path.extname(f.path).toLowerCase();
    const dir = seasonDir(f.season);
    const base = naming.renderName(cfg.naming_episode_file, {
      title: r.title, year: r.year, tvdbId: r.tvdb_id, tmdbId: r.tmdb_id, season: f.season, episode: f.episode, episodeTitle: titles.get(key(f.season, f.episode)) || null,
    });
    let name = base;
    for (let n = 2; taken.has(path.join(dir, name + ext)) || fs.existsSync(path.join(dir, name + ext)); n++) name = `${base} (${n})`;
    taken.add(path.join(dir, name + ext));
    moves.push({ from: from(f.path), to: path.join(dir, name + ext), video: true, season: f.season, episode: f.episode });
    // Subtitles named like the video, beside it: "<video>.en.srt" → "<new name>.en.srt".
    const rel = f.path.replace(/\\/g, '/');
    const vdir = path.posix.dirname(rel);
    const vbase = path.posix.basename(rel, path.extname(rel)).toLowerCase();
    for (const s of t.files) {
      const srel = s.path.replace(/\\/g, '/');
      const e = path.extname(srel).toLowerCase();
      if (!SUB_EXTS.has(e) || path.posix.dirname(srel) !== vdir) continue;
      const sbase = path.posix.basename(srel, path.extname(srel));
      if (!sbase.toLowerCase().startsWith(vbase)) continue;
      const tag = sbase.slice(vbase.length).replace(/^[\s._-]+/, '').replace(/[^\p{L}\p{N}._-]+/gu, '.').replace(/^[.-]+|[.-]+$/g, '');
      moves.push({ from: from(srel), to: path.join(dir, `${name}${tag ? `.${tag}` : ''}${e}`) });
    }
  }
  const tops = [...new Set(t.files.map(f => f.path.replace(/\\/g, '/')).filter(p => p.includes('/')).map(p => p.split('/')[0]))];
  // Only clear the download's folder when everything in it worth keeping was moved.
  const cleanup = tops.length === 1 && !['.', '..'].includes(tops[0]) && !unmatched.length ? path.join(save, tops[0]) : null;
  return { folder, moves, cleanup, save, unmatched, savedAt: t.savePath };
}

const importing = new Set();
async function importDownload(d, r, t = null) {
  if (importing.has(d.id)) return;
  importing.add(d.id);
  const setRow = (fields) => {
    const keys = Object.keys(fields);
    db.prepare(`UPDATE request_downloads SET ${keys.map(k => `${k} = @${k}`).join(', ')}, updated_at = @updated_at WHERE id = @id`).run({ ...fields, updated_at: now(), id: d.id });
  };
  try {
    let plan = d.import_plan ? JSON.parse(d.import_plan) : null;
    if (!plan) {
      t = t || await deluge.torrent(d.hash);
      if (!t) throw needs('The download was removed from Deluge before it could be moved — paste the magnet link again');
      plan = await planImport(d, r, t);
      if (!fs.existsSync(plan.moves[0].from)) {
        throw needs(`Downloaded, but Streamulus can't see the files at ${path.dirname(plan.moves[0].from)}. ${deluge.inDocker()
          ? `Streamulus runs in Docker: mount Deluge's download folder into it at ${t.savePath} (DOWNLOADS_PATH in docker-compose / Portainer), redeploy, and it's picked up by itself.`
          : `If Deluge runs on another computer, say where its download folder (${t.savePath}) is on this server in Admin › Requests › Deluge.`}`);
      }
      setRow({ status: 'importing', import_plan: JSON.stringify(plan), progress: 1, needs_admin: 0, detail: 'Downloaded — moving the episodes into the library', checked_at: now() });
      await deluge.remove(d.hash, false).catch(err => console.error(`[requests] Removing ${r.title} from Deluge: ${deluge.errorText(err)}`));
    }
    let moved = 0;
    for (const m of plan.moves) {
      const ok = await R().moveInto(m.from, m.to);
      if (ok && m.video) moved++;
      if (!ok && m.video) console.error(`[requests] ${r.title}: ${m.from} has gone missing`);
    }
    if (!moved) throw needs('The downloaded files have gone missing — paste the magnet link again');
    if (plan.cleanup && path.resolve(plan.cleanup).startsWith(path.resolve(plan.save) + path.sep)) {
      await fs.promises.rm(plan.cleanup, { recursive: true, force: true }).catch(() => {});
    }
    const lib = db.prepare("SELECT * FROM libraries WHERE type = 'tv'").all().find(l => path.resolve(plan.folder).startsWith(path.resolve(l.path) + path.sep)) || tvLibrary();
    if (lib) await require('./scanner').scanPaths(lib, [plan.folder]);
    if (r.sonarr_id && sonarr.configured()) sonarr.rescan(r.sonarr_id).catch(() => {});
    setRow({
      status: 'done', needs_admin: 0, checked_at: now(),
      detail: `Moved ${plural(moved, 'episode')} into the library${plan.unmatched.length ? ` · ${plural(plan.unmatched.length, 'file')} couldn't be matched to an episode and were left in Deluge's folder` : ''}`,
    });
    require('./activity').log(null, { category: 'admin', action: 'request_imported', username: 'Streamulus', detail: `${displayTitle(r)} — ${plural(moved, 'episode')} → ${plan.folder}` });
  } catch (err) {
    console.error(`[requests] ${r.title}: ${err.message}`);
    setRow({ status: 'failed', needs_admin: 1, checked_at: now(), detail: err.needsAdmin ? err.message : `Couldn't move the download into the library: ${err.message}` });
  } finally {
    importing.delete(d.id);
  }
}

// Downloads for a request, for the admin's list.
const downloads = (requestId) => db.prepare('SELECT * FROM request_downloads WHERE request_id = ? ORDER BY id').all(requestId).map(d => ({
  id: d.id, name: d.name, scope: d.scope, season: d.season, episode: d.episode, status: d.status, progress: d.progress,
  detail: d.detail, needsAdmin: !!d.needs_admin, by: d.added_by, at: d.added_at,
  episodes: JSON.parse(d.files || '[]').filter(f => f.episode != null).map(f => ({ season: f.season, episode: f.episode })),
}));

// Removing a request: unfinished magnet downloads go too (with their data).
function removeDownloads(requestId) {
  for (const d of db.prepare("SELECT * FROM request_downloads WHERE request_id = ? AND status IN ('downloading', 'failed') AND import_plan IS NULL").all(requestId)) {
    if (deluge.configured()) deluge.remove(d.hash, true).catch(() => {});
  }
  db.prepare('DELETE FROM request_downloads WHERE request_id = ?').run(requestId);
}

module.exports = {
  isOpen, displayTitle, localShow, localEpisodes, showDetails, tmdbEpisodes, aired, openSeries, openSeason,
  create, approve, searchAgain, refresh, startMagnet, downloads, removeDownloads, hasDownloads, MAGNET_OK,
};
