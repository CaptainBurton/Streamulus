const axios = require('axios');
const db = require('../database/db');

const BASE = 'https://www.omdbapi.com/';

function getKey() {
  return db.prepare('SELECT value FROM config WHERE key = ?').get('omdb_api_key')?.value || null;
}

function isConfigured() {
  return !!getKey();
}

function parse(data) {
  if (!data || data.Response === 'False') return null;
  return {
    imdb_id: data.imdbID || null,
    imdb_rating: data.imdbRating && data.imdbRating !== 'N/A' ? parseFloat(data.imdbRating) : null,
    content_rating: data.Rated && data.Rated !== 'N/A' ? data.Rated : null,
  };
}

async function searchMovie(title, year) {
  const key = getKey();
  if (!key) return null;
  try {
    const params = { t: title, type: 'movie', apikey: key };
    if (year) params.y = year;
    const r = await axios.get(BASE, { params, timeout: 8000 });
    return parse(r.data);
  } catch (e) {
    console.error(`[omdb] searchMovie "${title}": ${e.message}`);
    return null;
  }
}

async function searchSeries(title) {
  const key = getKey();
  if (!key) return null;
  try {
    const r = await axios.get(BASE, { params: { t: title, type: 'series', apikey: key }, timeout: 8000 });
    return parse(r.data);
  } catch (e) {
    console.error(`[omdb] searchSeries "${title}": ${e.message}`);
    return null;
  }
}

module.exports = { searchMovie, searchSeries, isConfigured };
