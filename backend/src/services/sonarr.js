// Sonarr (v3 API — Sonarr 3 and 4): series requests, as Radarr does films. An
// approved request adds the series to Sonarr (or monitors the requested season
// of one it already has) and starts a search; then Streamulus reads back how
// each episode is getting on (searching, downloading, importing, done).
// Admin › Requests › Sonarr holds the address, API key, root folder and profiles.
const axios = require('axios');
const db = require('../database/db');

const getConf = (key, fallback = '') => db.prepare('SELECT value FROM config WHERE key = ?').get(key)?.value ?? fallback;

function settings() {
  return {
    url: String(getConf('sonarr_url')).trim().replace(/\/+$/, ''),
    apiKey: String(getConf('sonarr_api_key')).trim(),
    rootFolder: String(getConf('sonarr_root_folder')).trim(),
    qualityProfileId: parseInt(getConf('sonarr_quality_profile'), 10) || null,
    // Sonarr 3 only (Sonarr 4 dropped language profiles).
    languageProfileId: parseInt(getConf('sonarr_language_profile'), 10) || null,
    // "Download when": 'aired' — each episode as soon as it's out; 'season' — a
    // season only once its last episode has aired (Streamulus holds it back
    // until then, then searches for the whole season).
    downloadWhen: getConf('sonarr_download_when', 'aired') === 'season' ? 'season' : 'aired',
  };
}

const configured = (s = settings()) => !!(s.url && s.apiKey);

function client(s = settings()) {
  return axios.create({ baseURL: `${s.url}/api/v3`, headers: { 'X-Api-Key': s.apiKey }, timeout: 20000 });
}

// Plain-English reasons for the usual failures.
function errorText(err, url = settings().url) {
  const status = err?.response?.status;
  if (status === 401 || status === 403) return "Sonarr didn't accept the API key (Sonarr › Settings › General › API Key).";
  if (status === 404 && !err?.response?.data?.message) return `Sonarr wasn't found at ${url} — check the address (and any URL base, e.g. /sonarr).`;
  const data = err?.response?.data;
  const message = Array.isArray(data) ? data.map(d => d.errorMessage).filter(Boolean).join(' ') : (data?.message || data?.error);
  if (message) return `Sonarr: ${message}`;
  if (['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'ECONNABORTED', 'EHOSTUNREACH'].includes(err?.code)) {
    return `Couldn't reach Sonarr at ${url} (${err.code}). If both run in Docker, use the Sonarr container's name or the server's IP, not localhost.`;
  }
  return err?.message || String(err);
}

// Check an address and key (the saved ones unless given) and list what the admin
// can choose: { version, rootFolders, qualityProfiles, languageProfiles (Sonarr 3) }
async function test({ url, apiKey } = {}) {
  const saved = settings();
  const s = { ...saved, url: String(url ?? saved.url).trim().replace(/\/+$/, ''), apiKey: String(apiKey || saved.apiKey).trim() };
  if (!s.url || !s.apiKey) throw new Error('Enter the Sonarr address and API key');
  if (!/^https?:\/\//i.test(s.url)) throw new Error('The Sonarr address should start with http:// or https://');
  const api = client(s);
  const [status, roots, profiles] = await Promise.all([api.get('/system/status'), api.get('/rootfolder'), api.get('/qualityprofile')]);
  const version = status.data?.version || null;
  const languages = /^3\./.test(version || '') ? await api.get('/languageprofile').then(r => r.data || []).catch(() => []) : [];
  return {
    version,
    rootFolders: (roots.data || []).map(r => ({ path: r.path, freeSpace: r.freeSpace ?? null, accessible: r.accessible !== false })),
    qualityProfiles: (profiles.data || []).map(p => ({ id: p.id, name: p.name })),
    languageProfiles: languages.map(p => ({ id: p.id, name: p.name })),
  };
}

// A series in Sonarr by its TVDB id, or null.
async function findByTvdb(tvdbId) {
  const res = await client().get('/series');
  return (Array.isArray(res.data) ? res.data : []).find(x => Number(x.tvdbId) === Number(tvdbId)) || null;
}

const getSeries = async (id) => (await client().get(`/series/${id}`)).data;
const episodes = async (seriesId) => (await client().get('/episode', { params: { seriesId } })).data || [];
const command = async (id) => (await client().get(`/command/${id}`)).data;

// Search: the whole series (its monitored episodes) or one season.
const search = async (seriesId, season = null) => (await client().post('/command', season == null
  ? { name: 'SeriesSearch', seriesId }
  : { name: 'SeasonSearch', seriesId, seasonNumber: season })).data;

/**
 * Add a series (or, if Sonarr already has it, monitor what's asked for) and
 * search. season = null: every season (not specials); a number: that season.
 * hold: leave seasons that are still airing unmonitored (Download when: the
 * whole season has aired) — they're released later by tvRequests.
 * Options default to the saved ones. → { series, command, existed, held: [season numbers] }
 */
async function addAndSearch(tvdbId, { season = null, qualityProfileId, languageProfileId, rootFolder, hold = false } = {}) {
  const s = settings();
  const api = client(s);
  const wanted = (n) => (season == null ? n > 0 : n === Number(season));
  let series = await findByTvdb(tvdbId);
  let existed = !!series;
  // Seasons someone was already getting stay as they were.
  const alreadyMonitored = new Set((series?.seasons || []).filter(x => x.monitored && series.monitored).map(x => x.seasonNumber));
  if (series) {
    const seasons = (series.seasons || []).map(x => ({ ...x, monitored: x.monitored || wanted(x.seasonNumber) }));
    if (!series.monitored || seasons.some((x, i) => x.monitored !== series.seasons[i].monitored)) {
      series = (await api.put(`/series/${series.id}`, { ...series, monitored: true, seasons })).data;
    }
  } else {
    const profileId = Number(qualityProfileId || s.qualityProfileId);
    const root = rootFolder || s.rootFolder;
    if (!profileId || !root) throw new Error('Choose a root folder and quality profile in Requests › Sonarr first');
    const found = (await api.get('/series/lookup', { params: { term: `tvdb:${tvdbId}` } })).data;
    const lookup = (Array.isArray(found) ? found : [])[0];
    if (!lookup?.tvdbId) throw new Error(`Sonarr couldn't find this series (TVDB ${tvdbId})`);
    const body = {
      ...lookup,
      qualityProfileId: profileId,
      rootFolderPath: root,
      monitored: true,
      seasonFolder: true,
      seriesType: lookup.seriesType || 'standard',
      seasons: (lookup.seasons || []).map(x => ({ seasonNumber: x.seasonNumber, monitored: wanted(x.seasonNumber) })),
      addOptions: { searchForMissingEpisodes: false, ignoreEpisodesWithFiles: false, ignoreEpisodesWithoutFiles: false }, // searched below, so it can be followed
    };
    const lang = Number(languageProfileId || s.languageProfileId);
    if (lang) body.languageProfileId = lang;
    try {
      series = (await api.post('/series', body)).data;
    } catch (err) {
      series = await findByTvdb(tvdbId); // added by someone else in the meantime
      if (!series) throw err;
      existed = true;
    }
  }
  let held = [];
  if (hold) {
    const now = Date.now();
    const eps = await episodes(series.id);
    const airing = new Set(eps
      .filter(e => wanted(e.seasonNumber) && !alreadyMonitored.has(e.seasonNumber) && !(e.airDateUtc && Date.parse(e.airDateUtc) <= now))
      .map(e => e.seasonNumber));
    held = [...airing].sort((a, b) => a - b);
    if (held.length) {
      const seasons = (series.seasons || []).map(x => (airing.has(x.seasonNumber) ? { ...x, monitored: false } : x));
      series = (await api.put(`/series/${series.id}`, { ...series, seasons })).data;
    }
  }
  const searchable = season == null ? (series.seasons || []).some(x => x.monitored && x.seasonNumber > 0) : !held.includes(Number(season));
  const cmd = searchable ? await search(series.id, season) : null;
  return { series, command: cmd, existed, held };
}

// A held season has finished airing: monitor it and search for the whole season.
async function releaseSeason(seriesId, season) {
  const api = client();
  const series = await getSeries(seriesId);
  const seasons = (series.seasons || []).map(x => (x.seasonNumber === Number(season) ? { ...x, monitored: true } : x));
  await api.put(`/series/${seriesId}`, { ...series, monitored: true, seasons });
  return search(seriesId, season);
}

// Everything Sonarr is downloading or importing, by Sonarr series id.
async function queueBySeries() {
  const res = await client().get('/queue', { params: { page: 1, pageSize: 2000, includeUnknownSeriesItems: false, includeEpisode: false, includeSeries: false } });
  const records = Array.isArray(res.data) ? res.data : (res.data?.records || []);
  const map = new Map();
  for (const r of records) {
    if (!r.seriesId) continue;
    if (!map.has(r.seriesId)) map.set(r.seriesId, []);
    map.get(r.seriesId).push(r);
  }
  return map;
}

async function history(seriesId) {
  const res = await client().get('/history/series', { params: { seriesId } });
  return Array.isArray(res.data) ? res.data : (res.data?.records || []);
}

/**
 * The admin is getting some of a series by hand (a magnet link): cancel Sonarr's
 * downloads of that part (blocklisting those releases) and stop it looking for
 * it. scope: 'series' | 'season' (season) | 'episode' (season + episode).
 * → how many downloads were cancelled
 */
async function standDown(seriesId, { scope, season = null, episode = null }) {
  const api = client();
  const eps = await episodes(seriesId);
  const inScope = (e) => scope === 'series' || (e.seasonNumber === Number(season) && (scope === 'season' || e.episodeNumber === Number(episode)));
  const ids = new Set(eps.filter(inScope).map(e => e.id));
  const items = ((await queueBySeries()).get(seriesId) || []).filter(q => ids.has(q.episodeId) || (scope === 'series'));
  const done = new Set();
  for (const item of items) {
    if (done.has(item.id)) continue;
    done.add(item.id);
    await api.delete(`/queue/${item.id}`, { params: { removeFromClient: true, blocklist: true } }).catch(() => {});
  }
  if (scope === 'series') {
    const series = await getSeries(seriesId);
    if (series?.monitored) await api.put(`/series/${seriesId}`, { ...series, monitored: false });
  } else if (scope === 'season') {
    const series = await getSeries(seriesId);
    const seasons = (series.seasons || []).map(x => (x.seasonNumber === Number(season) ? { ...x, monitored: false } : x));
    await api.put(`/series/${seriesId}`, { ...series, seasons });
  } else if (ids.size) {
    await api.put('/episode/monitor', { episodeIds: [...ids], monitored: false });
  }
  return done.size;
}

// Ask Sonarr to look at a series' folder again (after Streamulus put files there).
const rescan = async (seriesId) => (await client().post('/command', { name: 'RescanSeries', seriesId })).data;

module.exports = {
  settings, configured, client, errorText, test, findByTvdb, getSeries, episodes, command, search, addAndSearch,
  queueBySeries, history, standDown, rescan, releaseSeason,
};
