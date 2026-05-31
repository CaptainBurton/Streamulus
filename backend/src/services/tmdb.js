const axios = require('axios');
const db = require('../database/db');

const TMDB_BASE = 'https://api.themoviedb.org/3';
const IMAGE_BASE = 'https://image.tmdb.org/t/p';

const MOVIE_GENRES = {
  28: 'Action', 12: 'Adventure', 16: 'Animation', 35: 'Comedy',
  80: 'Crime', 99: 'Documentary', 18: 'Drama', 10751: 'Family',
  14: 'Fantasy', 36: 'History', 27: 'Horror', 10402: 'Music',
  9648: 'Mystery', 10749: 'Romance', 878: 'Sci-Fi', 53: 'Thriller',
  10752: 'War', 37: 'Western', 10770: 'TV Movie'
};

const TV_GENRES = {
  10759: 'Action & Adventure', 16: 'Animation', 35: 'Comedy', 80: 'Crime',
  99: 'Documentary', 18: 'Drama', 10751: 'Family', 10762: 'Kids',
  9648: 'Mystery', 10763: 'News', 10764: 'Reality', 10765: 'Sci-Fi & Fantasy',
  10766: 'Soap', 10767: 'Talk', 10768: 'War & Politics', 37: 'Western'
};

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
  } catch { return null; }
}

async function searchTV(title) {
  const apiKey = getApiKey();
  if (!apiKey) return null;
  try {
    const res = await axios.get(`${TMDB_BASE}/search/tv`, { params: { api_key: apiKey, query: title } });
    return res.data.results[0] || null;
  } catch { return null; }
}

async function getMovieDetails(tmdbId) {
  const apiKey = getApiKey();
  if (!apiKey) return null;
  try {
    const res = await axios.get(`${TMDB_BASE}/movie/${tmdbId}`, { params: { api_key: apiKey } });
    return res.data;
  } catch { return null; }
}

async function getMovieCredits(tmdbId) {
  const apiKey = getApiKey();
  if (!apiKey) return null;
  try {
    const res = await axios.get(`${TMDB_BASE}/movie/${tmdbId}/credits`, { params: { api_key: apiKey } });
    return res.data;
  } catch { return null; }
}

async function getSimilarMovies(tmdbId) {
  const apiKey = getApiKey();
  if (!apiKey) return null;
  try {
    const res = await axios.get(`${TMDB_BASE}/movie/${tmdbId}/similar`, { params: { api_key: apiKey } });
    return res.data.results?.slice(0, 8) || [];
  } catch { return null; }
}

async function getTVContentRating(tmdbId) {
  const apiKey = getApiKey();
  if (!apiKey) return null;
  try {
    const country = db.prepare('SELECT value FROM config WHERE key = ?').get('preferred_country')?.value || 'US';
    const res = await axios.get(`${TMDB_BASE}/tv/${tmdbId}/content_ratings`, { params: { api_key: apiKey } });
    const results = res.data.results || [];
    const preferred = results.find(r => r.iso_3166_1 === country);
    const us = results.find(r => r.iso_3166_1 === 'US');
    return preferred?.rating || us?.rating || results[0]?.rating || null;
  } catch { return null; }
}

async function getTVCredits(tmdbId) {
  const apiKey = getApiKey();
  if (!apiKey) return null;
  try {
    const res = await axios.get(`${TMDB_BASE}/tv/${tmdbId}/credits`, { params: { api_key: apiKey } });
    return res.data;
  } catch { return null; }
}

async function getSimilarTV(tmdbId) {
  const apiKey = getApiKey();
  if (!apiKey) return null;
  try {
    const res = await axios.get(`${TMDB_BASE}/tv/${tmdbId}/similar`, { params: { api_key: apiKey } });
    return res.data.results?.slice(0, 8) || [];
  } catch { return null; }
}

async function getTVDetails(tmdbId) {
  const apiKey = getApiKey();
  if (!apiKey) return null;
  try {
    const res = await axios.get(`${TMDB_BASE}/tv/${tmdbId}`, { params: { api_key: apiKey } });
    return res.data;
  } catch { return null; }
}

async function getEpisodeDetails(tmdbId, season, episode) {
  const apiKey = getApiKey();
  if (!apiKey) return null;
  try {
    const res = await axios.get(`${TMDB_BASE}/tv/${tmdbId}/season/${season}/episode/${episode}`, { params: { api_key: apiKey } });
    return res.data;
  } catch { return null; }
}

async function getMovieImages(tmdbId) {
  const apiKey = getApiKey();
  if (!apiKey) return null;
  try {
    const res = await axios.get(`${TMDB_BASE}/movie/${tmdbId}/images`, {
      params: { api_key: apiKey, include_image_language: 'en,null' },
    });
    return res.data;
  } catch { return null; }
}

async function getTVImages(tmdbId) {
  const apiKey = getApiKey();
  if (!apiKey) return null;
  try {
    const res = await axios.get(`${TMDB_BASE}/tv/${tmdbId}/images`, {
      params: { api_key: apiKey, include_image_language: 'en,null' },
    });
    return res.data;
  } catch { return null; }
}

function posterUrl(path, size = 'w500') {
  if (!path) return null;
  return `${IMAGE_BASE}/${size}${path}`;
}

function backdropUrl(path, size = 'w1280') {
  if (!path) return null;
  return `${IMAGE_BASE}/${size}${path}`;
}

function resolveGenreNames(genreIds, isTV = false) {
  if (!genreIds) return [];
  const map = isTV ? TV_GENRES : MOVIE_GENRES;
  const ids = Array.isArray(genreIds) ? genreIds : JSON.parse(genreIds);
  return ids.map(id => map[id]).filter(Boolean);
}

module.exports = {
  searchMovie, searchTV, getMovieDetails, getMovieCredits, getSimilarMovies,
  getTVDetails, getTVCredits, getTVContentRating, getSimilarTV, getEpisodeDetails,
  getMovieImages, getTVImages,
  posterUrl, backdropUrl, resolveGenreNames
};
