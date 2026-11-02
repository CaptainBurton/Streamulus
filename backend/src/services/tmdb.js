const axios = require('axios');
const db = require('../database/db');

const TMDB_BASE = process.env.TMDB_API_BASE || 'https://api.themoviedb.org/3';
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

// Fix Match: several candidates rather than the best guess.
async function searchMovieList(title, year) {
  const apiKey = getApiKey();
  if (!apiKey) return [];
  const params = { api_key: apiKey, query: title };
  if (year) params.year = year;
  const res = await axios.get(`${TMDB_BASE}/search/movie`, { params, timeout: 10000 });
  return (res.data.results || []).slice(0, 12);
}

async function searchTVList(title, year) {
  const apiKey = getApiKey();
  if (!apiKey) return [];
  const params = { api_key: apiKey, query: title };
  if (year) params.first_air_date_year = year;
  const res = await axios.get(`${TMDB_BASE}/search/tv`, { params, timeout: 10000 });
  return (res.data.results || []).slice(0, 12);
}

// Any TMDB path in US English (e.g. '/movie/603'), or null.
async function getEnglish(path) {
  const apiKey = getApiKey();
  if (!apiKey) return null;
  try {
    const res = await axios.get(`${TMDB_BASE}${path}`, { params: { api_key: apiKey, language: 'en-US' }, timeout: 10000 });
    return res.data;
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

// This week's most popular films — what the Requests page shows before a search.
async function trendingMovies() {
  const apiKey = getApiKey();
  if (!apiKey) return [];
  const res = await axios.get(`${TMDB_BASE}/trending/movie/week`, { params: { api_key: apiKey }, timeout: 10000 });
  return (res.data.results || []).slice(0, 20);
}

// ── Requests: browsing films that aren't on the server ───────────────────────

// A film's page in one call: details, cast and crew, trailers, age ratings.
async function getMovieFull(tmdbId) {
  const apiKey = getApiKey();
  if (!apiKey) return null;
  const res = await axios.get(`${TMDB_BASE}/movie/${tmdbId}`, {
    params: { api_key: apiKey, append_to_response: 'credits,videos,release_dates' }, timeout: 10000,
  });
  return res.data;
}

// People by name (actors first), most popular first.
async function searchPeople(query) {
  const apiKey = getApiKey();
  if (!apiKey) return [];
  const res = await axios.get(`${TMDB_BASE}/search/person`, { params: { api_key: apiKey, query, include_adult: false }, timeout: 10000 });
  return (res.data.results || []).slice(0, 20);
}

// A person and every film they've been in (or directed).
async function getPersonWithMovies(personId) {
  const apiKey = getApiKey();
  if (!apiKey) return null;
  const res = await axios.get(`${TMDB_BASE}/person/${personId}`, {
    params: { api_key: apiKey, append_to_response: 'movie_credits' }, timeout: 10000,
  });
  return res.data;
}

// Popular films from a year and/or in a genre (no search words).
async function discoverMovies({ year, genre, page = 1 } = {}) {
  const apiKey = getApiKey();
  if (!apiKey) return [];
  const params = { api_key: apiKey, sort_by: 'popularity.desc', include_adult: false, page, 'vote_count.gte': 20 };
  if (year) params.primary_release_year = year;
  if (genre) params.with_genres = genre;
  const res = await axios.get(`${TMDB_BASE}/discover/movie`, { params, timeout: 10000 });
  return res.data.results || [];
}

const movieGenres = () => Object.entries(MOVIE_GENRES).map(([id, name]) => ({ id: Number(id), name }));
const tvGenres = () => Object.entries(TV_GENRES).map(([id, name]) => ({ id: Number(id), name }));

// ── Requests: browsing series ────────────────────────────────────────────────

// This week's most popular series.
async function trendingTV() {
  const apiKey = getApiKey();
  if (!apiKey) return [];
  const res = await axios.get(`${TMDB_BASE}/trending/tv/week`, { params: { api_key: apiKey }, timeout: 10000 });
  return (res.data.results || []).slice(0, 20);
}

// Popular series first aired in a year and/or in a genre.
async function discoverTV({ year, genre, page = 1 } = {}) {
  const apiKey = getApiKey();
  if (!apiKey) return [];
  const params = { api_key: apiKey, sort_by: 'popularity.desc', include_adult: false, page, 'vote_count.gte': 20 };
  if (year) params.first_air_date_year = year;
  if (genre) params.with_genres = genre;
  const res = await axios.get(`${TMDB_BASE}/discover/tv`, { params, timeout: 10000 });
  return res.data.results || [];
}

// A series' page in one call: details (with its seasons), cast, trailers, age
// ratings and its TVDB id (what Sonarr goes by).
async function getTVFull(tmdbId) {
  const apiKey = getApiKey();
  if (!apiKey) return null;
  const res = await axios.get(`${TMDB_BASE}/tv/${tmdbId}`, {
    params: { api_key: apiKey, append_to_response: 'credits,videos,content_ratings,external_ids' }, timeout: 10000,
  });
  return res.data;
}

// One season's episodes (cached for a few hours — episode lists rarely change
// and series requests look at them often).
const seasonCache = new Map();
async function getSeason(tmdbId, season) {
  const key = `${tmdbId}:${season}`;
  const hit = seasonCache.get(key);
  if (hit && Date.now() - hit.at < 3 * 3600 * 1000) return hit.data;
  const apiKey = getApiKey();
  if (!apiKey) return null;
  const res = await axios.get(`${TMDB_BASE}/tv/${tmdbId}/season/${season}`, { params: { api_key: apiKey }, timeout: 10000 });
  seasonCache.set(key, { at: Date.now(), data: res.data });
  return res.data;
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

// Age rating for the country chosen in Admin › Settings (then the US one, then
// any). The *Certification versions throw when TMDB can't be reached, so a
// background refresh can tell "no rating" from "try again later".
const ratingCountry = () => require('./ratings').country();

async function getMovieCertification(tmdbId) {
  const apiKey = getApiKey();
  if (!apiKey) return null;
  const country = ratingCountry();
  const res = await axios.get(`${TMDB_BASE}/movie/${tmdbId}/release_dates`, { params: { api_key: apiKey } });
  const results = res.data.results || [];
  const preferred = results.find(r => r.iso_3166_1 === country);
  const us = results.find(r => r.iso_3166_1 === 'US');
  const getCert = (entry) => {
    if (!entry) return null;
    const theatrical = entry.release_dates?.find(d => d.type === 3 && d.certification);
    return theatrical?.certification || entry.release_dates?.find(d => d.certification)?.certification || null;
  };
  return getCert(preferred) || getCert(us) || results.map(getCert).find(Boolean) || null;
}

async function getTVCertification(tmdbId) {
  const apiKey = getApiKey();
  if (!apiKey) return null;
  const country = ratingCountry();
  const res = await axios.get(`${TMDB_BASE}/tv/${tmdbId}/content_ratings`, { params: { api_key: apiKey } });
  const results = (res.data.results || []).filter(r => r.rating);
  const preferred = results.find(r => r.iso_3166_1 === country);
  const us = results.find(r => r.iso_3166_1 === 'US');
  return preferred?.rating || us?.rating || results[0]?.rating || null;
}

async function getMovieContentRating(tmdbId) {
  try { return await getMovieCertification(tmdbId); } catch { return null; }
}

async function getTVContentRating(tmdbId) {
  try { return await getTVCertification(tmdbId); } catch { return null; }
}

// Where a movie or show streams, per country: { AU: { flatrate: [{ provider_id, provider_name }], … } }.
// Throws when TMDB can't be reached.
async function getWatchProviders(kind, tmdbId) {
  const apiKey = getApiKey();
  if (!apiKey) return null;
  const res = await axios.get(`${TMDB_BASE}/${kind === 'movie' ? 'movie' : 'tv'}/${tmdbId}/watch/providers`, { params: { api_key: apiKey } });
  return res.data?.results || {};
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

// Posters for one season (Admin › Edit Season Poster).
async function getSeasonImages(tmdbId, season) {
  const apiKey = getApiKey();
  if (!apiKey) return null;
  try {
    const res = await axios.get(`${TMDB_BASE}/tv/${tmdbId}/season/${season}/images`, {
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
  getApiKey, searchMovieList, searchTVList, getEnglish, trendingMovies,
  getMovieFull, searchPeople, getPersonWithMovies, discoverMovies, movieGenres,
  tvGenres, trendingTV, discoverTV, getTVFull, getSeason,
  searchMovie, searchTV, getMovieDetails, getMovieCredits, getSimilarMovies, getMovieContentRating, getMovieCertification, getTVCertification, getWatchProviders,
  getTVDetails, getTVCredits, getTVContentRating, getSimilarTV, getEpisodeDetails,
  getMovieImages, getTVImages, getSeasonImages,
  posterUrl, backdropUrl, resolveGenreNames
};
