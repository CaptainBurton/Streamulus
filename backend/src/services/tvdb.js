const axios = require('axios');
const db = require('../database/db');

const BASE = 'https://api4.thetvdb.com/v4';

let _token = null;
let _tokenExp = 0;
const _epCache = new Map(); // tvdbId → Map<'season:ep', epObj>

function getKey() {
  return db.prepare('SELECT value FROM config WHERE key = ?').get('tvdb_api_key')?.value || null;
}

async function getToken() {
  if (_token && Date.now() < _tokenExp) return _token;
  const key = getKey();
  if (!key) return null;
  try {
    const r = await axios.post(`${BASE}/login`, { apikey: key }, { timeout: 10000 });
    _token = r.data.data.token;
    _tokenExp = Date.now() + 23 * 3600 * 1000;
    console.log('[tvdb] Authenticated successfully');
    return _token;
  } catch (e) {
    console.error(`[tvdb] Login failed: ${e.response?.data?.message || e.message}`);
    return null;
  }
}

async function searchSeries(title) {
  const token = await getToken();
  if (!token) return null;
  try {
    const r = await axios.get(`${BASE}/search`, {
      headers: { Authorization: `Bearer ${token}` },
      params: { query: title, type: 'series', limit: 5 },
      timeout: 10000,
    });
    const hit = r.data.data?.[0];
    if (!hit) return null;
    const tvdb_id = hit.tvdb_id ||
      (hit.objectID?.startsWith('series/') ? parseInt(hit.objectID.split('/')[1]) : null);
    return {
      tvdb_id,
      name: hit.name,
      overview: hit.overview || hit.overviews?.eng || null,
      poster_path: hit.image_url || null,
      backdrop_path: null,
      rating: null,
      genres: null,
      status: hit.status || null,
      first_air_date: hit.year ? `${hit.year}-01-01` : null,
    };
  } catch (e) {
    console.error(`[tvdb] searchSeries "${title}": ${e.response?.data?.message || e.message}`);
    return null;
  }
}

async function _fetchEpisodes(tvdbId) {
  const token = await getToken();
  if (!token) return new Map();
  const map = new Map();
  for (let page = 0; page <= 50; page++) {
    let eps = [];
    try {
      const r = await axios.get(`${BASE}/series/${tvdbId}/episodes/default/eng`, {
        headers: { Authorization: `Bearer ${token}` },
        params: { page },
        timeout: 15000,
      });
      eps = r.data.data?.episodes || [];
    } catch {
      try {
        const r = await axios.get(`${BASE}/series/${tvdbId}/episodes/default`, {
          headers: { Authorization: `Bearer ${token}` },
          params: { page },
          timeout: 15000,
        });
        eps = r.data.data?.episodes || [];
      } catch { break; }
    }
    for (const ep of eps) {
      map.set(`${ep.seasonNumber}:${ep.number}`, ep);
    }
    if (eps.length < 100) break;
  }
  return map;
}

async function getEpisodeDetails(tvdbId, season, episodeNumber) {
  if (!_epCache.has(tvdbId)) {
    _epCache.set(tvdbId, await _fetchEpisodes(tvdbId));
  }
  const ep = _epCache.get(tvdbId)?.get(`${season}:${episodeNumber}`);
  if (!ep) return null;
  return {
    name: ep.name || null,
    overview: ep.overview || null,
    still_path: ep.image || null,
  };
}

function invalidateCache() {
  _token = null;
  _tokenExp = 0;
  _epCache.clear();
}

function isConfigured() {
  return !!getKey();
}

module.exports = { searchSeries, getEpisodeDetails, invalidateCache, isConfigured };
