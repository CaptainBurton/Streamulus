const axios = require('axios');
const db = require('../database/db');

const TMDB_BASE = 'https://api.themoviedb.org/3';
const IMAGE_BASE = 'https://image.tmdb.org/t/p';

function getApiKey() {
  const row = db.prepare('SELECT value FROM config WHERE key = ?').get('tmdb_api_key');
  return row?.value || null;
}

async function searchMovie(title, year) {
  const apiKey = getApiKey();
  if (!apiKey) return null;
  try {
    const params = { api_key: apiKey, query: title };
    if (year) params.year = year;
    const res = await axios.get(`${TMDB_BASE}/search/movie`, { params });
    return res.data.results[0] || null;
  } catch {
    return null;
  }
}

async function searchTV(title) {
  const apiKey = getApiKey();
  if (!apiKey) return null;
  try {
    const res = await axios.get(`${TMDB_BASE}/search/tv`, {
      params: { api_key: apiKey, query: title }
    });
    return res.data.results[0] || null;
  } catch {
    return null;
  }
}

async function getMovieDetails(tmdbId) {
  const apiKey = getApiKey();
  if (!apiKey) return null;
  try {
    const res = await axios.get(`${TMDB_BASE}/movie/${tmdbId}`, {
      params: { api_key: apiKey }
    });
    return res.data;
  } catch {
    return null;
  }
}

async function getTVDetails(tmdbId) {
  const apiKey = getApiKey();
  if (!apiKey) return null;
  try {
    const res = await axios.get(`${TMDB_BASE}/tv/${tmdbId}`, {
      params: { api_key: apiKey }
    });
    return res.data;
  } catch {
    return null;
  }
}

async function getEpisodeDetails(tmdbId, season, episode) {
  const apiKey = getApiKey();
  if (!apiKey) return null;
  try {
    const res = await axios.get(`${TMDB_BASE}/tv/${tmdbId}/season/${season}/episode/${episode}`, {
      params: { api_key: apiKey }
    });
    return res.data;
  } catch {
    return null;
  }
}

function posterUrl(path, size = 'w500') {
  if (!path) return null;
  return `${IMAGE_BASE}/${size}${path}`;
}

function backdropUrl(path, size = 'w1280') {
  if (!path) return null;
  return `${IMAGE_BASE}/${size}${path}`;
}

module.exports = { searchMovie, searchTV, getMovieDetails, getTVDetails, getEpisodeDetails, posterUrl, backdropUrl };
