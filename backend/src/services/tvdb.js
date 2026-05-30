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
    const rawId = hit.tvdb_id ||
      (hit.objectID?.startsWith('series/') ? hit.objectID.split('/')[1] : null);
    const tvdb_id = rawId ? parseInt(rawId, 10) : null;
    const poster_path = hit.image_url || hit.thumbnail || hit.poster || null;
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
    // TVDB v4 returns { data: { id, name, artworks: [...] } }
    const raw = r.data.data;
    const artworks = Array.isArray(raw) ? raw : (raw?.artworks || []);
    const byScore = (a, b) => (b.score || 0) - (a.score || 0);
    const banners   = artworks.filter(a => a.type === 1).sort(byScore);
    const posters   = artworks.filter(a => a.type === 2).sort(byScore);
    const backdrops = artworks.filter(a => a.type === 3).sort(byScore);
    // Type 7 = season poster (has a `season` field with the season number)
    const seasonPosters = new Map();
    for (const art of artworks.filter(a => a.type === 7 && a.season > 0).sort(byScore)) {
      if (!seasonPosters.has(art.season)) seasonPosters.set(art.season, art.image);
    }
    console.log(`[tvdb] getSeriesArtwork ${tvdbId}: ${artworks.length} artworks, ${posters.length} posters, ${backdrops.length} fanart, ${banners.length} banners, ${seasonPosters.size} season posters`);
    return {
      poster:   posters[0]?.image   || null,
      backdrop: backdrops[0]?.image || banners[0]?.image || null,
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
  try {
    const r = await axios.get(`${BASE}/series/${tvdbId}/seasons/official`, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 10000,
    });
    const seasons = r.data.data || [];
    const map = new Map();
    for (const s of seasons) {
      if (s.number > 0 && s.image) map.set(s.number, s.image);
    }
    console.log(`[tvdb] getSeasonPosters ${tvdbId}: ${seasons.length} seasons, ${map.size} with posters`);
    return map;
  } catch (e) {
    console.error(`[tvdb] getSeasonPosters ${tvdbId}: ${e.response?.data?.message || e.message}`);
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
    if (page === 0) console.log(`[tvdb] _fetchEpisodes ${tvdbId}: page 0 → ${eps.length} episodes`);
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

module.exports = { searchSeries, getSeriesArtwork, getSeasonPosters, getEpisodeDetails, invalidateCache, isConfigured };
