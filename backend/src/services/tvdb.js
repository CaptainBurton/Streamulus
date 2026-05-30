const axios = require('axios');
const db = require('../database/db');

const BASE = 'https://api4.thetvdb.com/v4';
const TVDB_CDN = 'https://artworks.thetvdb.com';

let _token = null;
let _tokenExp = 0;
const _epCache = new Map(); // tvdbId → Map<'season:ep', epObj>

// Ensure image paths are returned as full URLs — TVDB sometimes returns relative paths
function toFullUrl(path) {
  if (!path) return null;
  if (path.startsWith('http')) return path;
  if (path.startsWith('/')) return `${TVDB_CDN}${path}`;
  return `${TVDB_CDN}/${path}`;
}

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
    const rawId = hit.tvdb_id ||
      (hit.objectID?.startsWith('series/') ? hit.objectID.split('/')[1] : null);
    const tvdb_id = rawId ? parseInt(rawId, 10) : null;
    const poster_path = toFullUrl(hit.image_url || hit.thumbnail || hit.poster || null);
    return {
      tvdb_id,
      name: hit.name,
      overview: hit.overview || hit.overviews?.eng || null,
      poster_path,
      backdrop_path: null,
      rating: null,
      genres: null,
      status: hit.status?.name || hit.status || null,
      first_air_date: hit.year ? `${hit.year}-01-01` : null,
    };
  } catch (e) {
    console.error(`[tvdb] searchSeries "${title}": ${e.response?.data?.message || e.message}`);
    return null;
  }
}

async function getSeriesArtwork(tvdbId) {
  const token = await getToken();
  if (!token) return { poster: null, backdrop: null, seasonPosters: new Map() };
  try {
    const r = await axios.get(`${BASE}/series/${tvdbId}/artworks`, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 10000,
    });
    // TVDB v4: { data: { id, name, artworks: [...] } }
    const raw = r.data.data;
    const artworks = Array.isArray(raw) ? raw : (raw?.artworks || []);
    const byScore = (a, b) => (b.score || 0) - (a.score || 0);
    const banners   = artworks.filter(a => a.type === 1).sort(byScore);
    const posters   = artworks.filter(a => a.type === 2).sort(byScore);
    const backdrops = artworks.filter(a => a.type === 3).sort(byScore);
    // Type 7 = season poster — each has a `season` field (the season number)
    const seasonPosters = new Map();
    for (const art of artworks.filter(a => a.type === 7 && a.season > 0).sort(byScore)) {
      if (!seasonPosters.has(art.season)) seasonPosters.set(art.season, toFullUrl(art.image));
    }
    console.log(`[tvdb] artwork ${tvdbId}: ${artworks.length} total — ${posters.length} poster, ${backdrops.length} fanart, ${banners.length} banner, ${seasonPosters.size} season`);
    return {
      poster:   toFullUrl(posters[0]?.image) || null,
      backdrop: toFullUrl(backdrops[0]?.image || banners[0]?.image) || null,
      seasonPosters,
    };
  } catch (e) {
    console.error(`[tvdb] getSeriesArtwork ${tvdbId}: ${e.response?.data?.message || e.message}`);
    return { poster: null, backdrop: null, seasonPosters: new Map() };
  }
}

async function getSeasonPosters(tvdbId) {
  const token = await getToken();
  if (!token) return new Map();

  // Strategy 1: artworks endpoint filtered to type=7 (season poster)
  // Each artwork has a `season` field with the season number
  try {
    const r = await axios.get(`${BASE}/series/${tvdbId}/artworks`, {
      headers: { Authorization: `Bearer ${token}` },
      params: { type: 7 },
      timeout: 10000,
    });
    const raw = r.data.data;
    const artworks = Array.isArray(raw) ? raw : (raw?.artworks || []);
    const byScore = (a, b) => (b.score || 0) - (a.score || 0);
    const map = new Map();
    for (const art of artworks.filter(a => a.season > 0).sort(byScore)) {
      if (!map.has(art.season)) map.set(art.season, toFullUrl(art.image));
    }
    if (map.size > 0) {
      console.log(`[tvdb] seasonPosters ${tvdbId}: ${map.size} via artworks?type=7`);
      return map;
    }
  } catch (e) {
    console.error(`[tvdb] getSeasonPosters artworks ${tvdbId}: ${e.message}`);
  }

  // Strategy 2: seasons/official — each season object has an `image` field when a poster exists
  try {
    const r = await axios.get(`${BASE}/series/${tvdbId}/seasons/official`, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 10000,
    });
    const seasons = r.data.data || [];
    const map = new Map();
    for (const s of seasons) {
      if (s.number > 0 && s.image) map.set(s.number, toFullUrl(s.image));
    }
    console.log(`[tvdb] seasonPosters ${tvdbId}: ${map.size}/${seasons.length} via seasons/official`);
    return map;
  } catch (e) {
    console.error(`[tvdb] getSeasonPosters seasons/official ${tvdbId}: ${e.message}`);
    return new Map();
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
    if (page === 0) {
      const withImage = eps.filter(e => e.image).length;
      console.log(`[tvdb] episodes ${tvdbId}: page 0 → ${eps.length} eps, ${withImage} with stills`);
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
    // Normalize to full URL — TVDB sometimes returns relative paths like /banners/...
    still_path: toFullUrl(ep.image),
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

module.exports = { searchSeries, getSeriesArtwork, getSeasonPosters, getEpisodeDetails, invalidateCache, isConfigured };
