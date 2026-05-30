// IMDb metadata service via imdb-api.com
// API docs: https://imdb-api.com/api
// Get a free key (100 req/day) or paid key at imdb-api.com
//
// All poster/backdrop paths returned here are FULL URLs (Amazon CDN).
// The movies/tv formatters must use isFullUrl() before prepending TMDB prefix.

const axios = require('axios');
const db = require('../database/db');

const BASE = 'https://imdb-api.com/en/API';

function getKey() {
  return db.prepare('SELECT value FROM config WHERE key = ?').get('imdb_api_key')?.value || null;
}

function isConfigured() { return !!getKey(); }

async function fetchTitle(key, imdbId) {
  try {
    const r = await axios.get(`${BASE}/Title/${key}/${imdbId}`, { timeout: 12000 });
    if (r.data?.errorMessage || !r.data?.id) return null;
    return r.data;
  } catch (e) {
    console.error(`[imdb] fetchTitle ${imdbId}: ${e.message}`);
    return null;
  }
}

function normalizeFromTitle(details, fallback) {
  if (!details) return fallback;
  return {
    imdb_id:       details.id,
    title:         details.title  || fallback?.title  || null,
    name:          details.title  || fallback?.name   || null,
    year:          parseInt(details.year) || fallback?.year || null,
    overview:      details.plot   || fallback?.overview || null,
    poster_path:   details.image  || fallback?.poster_path || null, // full Amazon CDN URL
    backdrop_path: null,  // imdb-api.com does not expose fanart/backdrop in Title endpoint
    rating:        details.imDbRating  ? parseFloat(details.imDbRating)  : null,
    imdb_rating:   details.imDbRating  ? parseFloat(details.imDbRating)  : null,
    content_rating: details.contentRating || null,
    genres: details.genres
      ? JSON.stringify(details.genres.split(', ').map(g => g.trim()).filter(Boolean))
      : null,
    status: null,
    first_air_date: details.releaseDate || null,
  };
}

async function searchMovie(title, year) {
  const key = getKey();
  if (!key) return null;
  try {
    const q = encodeURIComponent(year ? `${title} ${year}` : title);
    const r = await axios.get(`${BASE}/SearchMovie/${key}/${q}`, { timeout: 12000 });
    if (r.data?.errorMessage || !r.data?.results?.length) return null;
    const hit = r.data.results[0];
    const details = await fetchTitle(key, hit.id);
    return normalizeFromTitle(details, { title: hit.title, year, poster_path: hit.image, imdb_id: hit.id });
  } catch (e) {
    console.error(`[imdb] searchMovie "${title}": ${e.message}`);
    return null;
  }
}

async function searchSeries(title) {
  const key = getKey();
  if (!key) return null;
  try {
    const r = await axios.get(`${BASE}/SearchSeries/${key}/${encodeURIComponent(title)}`, { timeout: 12000 });
    if (r.data?.errorMessage || !r.data?.results?.length) return null;
    const hit = r.data.results[0];
    const details = await fetchTitle(key, hit.id);
    return normalizeFromTitle(details, { name: hit.title, poster_path: hit.image, imdb_id: hit.id });
  } catch (e) {
    console.error(`[imdb] searchSeries "${title}": ${e.message}`);
    return null;
  }
}

module.exports = { searchMovie, searchSeries, isConfigured };
