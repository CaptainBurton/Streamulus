// Radarr (v3 API — Radarr 3, 4 and 5): adds approved movie requests to Radarr and
// starts a search, then reads back how each one is getting on (searching,
// downloading, importing, done). Radarr does the rest with its download client.
// Admin › Requests holds the address, API key, root folder and quality profile.
const axios = require('axios');
const db = require('../database/db');

const getConf = (key, fallback = '') => db.prepare('SELECT value FROM config WHERE key = ?').get(key)?.value ?? fallback;

function settings() {
  return {
    url: String(getConf('radarr_url')).trim().replace(/\/+$/, ''),
    apiKey: String(getConf('radarr_api_key')).trim(),
    rootFolder: String(getConf('radarr_root_folder')).trim(),
    qualityProfileId: parseInt(getConf('radarr_quality_profile'), 10) || null,
    minimumAvailability: getConf('radarr_minimum_availability', 'released') || 'released',
  };
}

const configured = (s = settings()) => !!(s.url && s.apiKey);

function client(s = settings()) {
  return axios.create({
    baseURL: `${s.url}/api/v3`,
    headers: { 'X-Api-Key': s.apiKey },
    timeout: 20000,
  });
}

// Plain-English reasons for the usual failures.
function errorText(err, url = settings().url) {
  const status = err?.response?.status;
  if (status === 401 || status === 403) return "Radarr didn't accept the API key (Radarr › Settings › General › API Key).";
  if (status === 404) return `Radarr wasn't found at ${url} — check the address (and any URL base, e.g. /radarr).`;
  const data = err?.response?.data;
  const message = Array.isArray(data) ? data.map(d => d.errorMessage).filter(Boolean).join(' ') : (data?.message || data?.error);
  if (message) return `Radarr: ${message}`;
  if (['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'ECONNABORTED', 'EHOSTUNREACH'].includes(err?.code)) {
    return `Couldn't reach Radarr at ${url} (${err.code}). If both run in Docker, use the Radarr container's name or the server's IP, not localhost.`;
  }
  return err?.message || String(err);
}

// Check an address and key (the saved ones unless given) and list what the
// admin can choose: { version, rootFolders: [{ path, freeSpace }], qualityProfiles: [{ id, name }] }
async function test({ url, apiKey } = {}) {
  const saved = settings();
  const s = { ...saved, url: (url ?? saved.url).trim().replace(/\/+$/, ''), apiKey: (apiKey || saved.apiKey).trim() };
  if (!s.url || !s.apiKey) throw new Error('Enter the Radarr address and API key');
  if (!/^https?:\/\//i.test(s.url)) throw new Error('The Radarr address should start with http:// or https://');
  const api = client(s);
  const [status, roots, profiles] = await Promise.all([
    api.get('/system/status'), api.get('/rootfolder'), api.get('/qualityprofile'),
  ]);
  return {
    version: status.data?.version || null,
    rootFolders: (roots.data || []).map(r => ({ path: r.path, freeSpace: r.freeSpace ?? null, accessible: r.accessible !== false })),
    qualityProfiles: (profiles.data || []).map(p => ({ id: p.id, name: p.name })),
  };
}

async function findByTmdb(tmdbId) {
  const res = await client().get('/movie', { params: { tmdbId } });
  return (Array.isArray(res.data) ? res.data : []).find(m => m.tmdbId === Number(tmdbId)) || null;
}

const getMovie = async (id) => (await client().get(`/movie/${id}`)).data;

// Start a search for a movie; the command's id tells when it has finished.
const search = async (movieId) => (await client().post('/command', { name: 'MoviesSearch', movieIds: [movieId] })).data;

const command = async (id) => (await client().get(`/command/${id}`)).data;

// Add a movie (or, if it's already in Radarr, make sure it's monitored) and search
// for it. Options default to the saved ones. → { movie, command, existed }
async function addAndSearch(tmdbId, { qualityProfileId, rootFolder, minimumAvailability } = {}) {
  const s = settings();
  const api = client(s);
  let movie = await findByTmdb(tmdbId);
  let existed = !!movie;
  if (movie) {
    if (!movie.monitored) {
      movie = (await api.put(`/movie/${movie.id}`, { ...movie, monitored: true })).data;
    }
  } else {
    const profileId = Number(qualityProfileId || s.qualityProfileId);
    const root = rootFolder || s.rootFolder;
    if (!profileId || !root) throw new Error('Choose a root folder and quality profile in Requests › Radarr first');
    const lookup = (await api.get('/movie/lookup/tmdb', { params: { tmdbId } })).data;
    if (!lookup?.tmdbId) throw new Error(`Radarr couldn't find TMDB movie ${tmdbId}`);
    try {
      movie = (await api.post('/movie', {
        ...lookup,
        qualityProfileId: profileId,
        rootFolderPath: root,
        monitored: true,
        minimumAvailability: minimumAvailability || s.minimumAvailability,
        addOptions: { searchForMovie: false }, // searched below, so the search can be followed
      })).data;
    } catch (err) {
      // Added by someone else in the meantime.
      movie = await findByTmdb(tmdbId);
      if (!movie) throw err;
      existed = true;
    }
  }
  const cmd = movie.hasFile ? null : await search(movie.id);
  return { movie, command: cmd, existed };
}

// Everything Radarr is downloading or importing, by Radarr movie id.
async function queueByMovie() {
  const res = await client().get('/queue', { params: { page: 1, pageSize: 1000, includeUnknownMovieItems: false, includeMovie: false } });
  const records = Array.isArray(res.data) ? res.data : (res.data?.records || []);
  const map = new Map();
  for (const r of records) {
    if (!r.movieId) continue;
    if (!map.has(r.movieId)) map.set(r.movieId, []);
    map.get(r.movieId).push(r);
  }
  return map;
}

async function history(movieId) {
  const res = await client().get('/history/movie', { params: { movieId } });
  return Array.isArray(res.data) ? res.data : (res.data?.records || []);
}

// The admin is getting a film by hand (a magnet link in Deluge): cancel Radarr's
// own downloads of it (blocklisting those releases) and stop it looking, so it
// doesn't fetch a second copy. → how many downloads were cancelled
async function standDown(movieId) {
  const api = client();
  const items = (await queueByMovie()).get(movieId) || [];
  for (const item of items) {
    await api.delete(`/queue/${item.id}`, { params: { removeFromClient: true, blocklist: true } }).catch(() => {});
  }
  const movie = await getMovie(movieId);
  if (movie?.monitored) await api.put(`/movie/${movieId}`, { ...movie, monitored: false });
  return items.length;
}

// Ask Radarr to look at a film's folder again (after Streamulus put a file there).
const rescan = async (movieId) => (await client().post('/command', { name: 'RescanMovie', movieId })).data;

module.exports = { settings, configured, test, errorText, findByTmdb, getMovie, search, command, addAndSearch, queueByMovie, history, standDown, rescan };
