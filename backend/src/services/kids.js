// Streamlings (kids profiles): which movies and shows they may see.
//
// A title is allowed when the admin ticked it in Admin > Streamlings, or — if
// it has no manual choice — when "use age ratings" is on and its content
// rating suits the configured maximum age. Unrated titles are blocked unless
// "allow unrated" is on. Episodes follow their show.
const db = require('../database/db');

// How old a viewer should be for a rating, read with the rating system of the
// country chosen in Admin › Settings (services/ratings.js).
const { ratingAge } = require('./ratings');

function getKidsConfig() {
  const get = (k, d) => db.prepare('SELECT value FROM config WHERE key = ?').get(k)?.value ?? d;
  return {
    useRatings: get('kids_use_ratings', 'true') === 'true',
    maxAge: parseInt(get('kids_max_age', '7'), 10),
    allowUnrated: get('kids_allow_unrated', 'false') === 'true',
  };
}

function getOverrides(mediaType) {
  const map = new Map();
  for (const r of db.prepare('SELECT media_id, allowed FROM kids_overrides WHERE media_type = ?').all(mediaType)) {
    map.set(r.media_id, !!r.allowed);
  }
  return map;
}

// { allowed, byRating, override } for one title row ({ id, content_rating }).
function decide(row, cfg, overrides) {
  const age = ratingAge(row.content_rating);
  const byRating = cfg.useRatings && (age == null ? cfg.allowUnrated : age <= cfg.maxAge);
  const override = overrides.has(row.id) ? overrides.get(row.id) : null;
  return { allowed: override ?? byRating, byRating, override, age };
}

// Set of allowed ids for 'movie' or 'show'.
function allowedIds(mediaType) {
  const cfg = getKidsConfig();
  const overrides = getOverrides(mediaType);
  const table = mediaType === 'movie' ? 'movies' : 'tv_shows';
  const ids = new Set();
  for (const row of db.prepare(`SELECT id, content_rating FROM ${table}`).all()) {
    if (decide(row, cfg, overrides).allowed) ids.add(row.id);
  }
  return ids;
}

// The allowed lists are reused for a few seconds: a Streamling playing video
// makes a request every few seconds, and admin changes still apply quickly.
const CACHE_MS = 5000;
let cache = null; // { at, movies, shows }
function allowedSets() {
  if (!cache || Date.now() - cache.at > CACHE_MS) {
    cache = { at: Date.now(), movies: allowedIds('movie'), shows: allowedIds('show') };
  }
  return cache;
}
function clearKidsCache() { cache = null; }

// Per-request view of what the current profile may see. null = no limits.
function kidsScope(req) {
  if (!req.profile?.is_kids) return null;
  if (!req._kidsScope) {
    const { movies, shows } = allowedSets();
    req._kidsScope = {
      movies, shows,
      // JSON arrays for SQL: `id IN (SELECT value FROM json_each(?))`
      moviesJson: JSON.stringify([...movies]),
      showsJson: JSON.stringify([...shows]),
    };
  }
  return req._kidsScope;
}

// Can the current profile open this movie / show / episode?
function canAccess(req, type, id) {
  const scope = kidsScope(req);
  if (!scope) return true;
  const n = parseInt(id, 10);
  if (type === 'movie') return scope.movies.has(n);
  if (type === 'show') return scope.shows.has(n);
  if (type === 'episode') {
    const ep = db.prepare('SELECT show_id FROM episodes WHERE id = ?').get(n);
    return !!ep && scope.shows.has(ep.show_id);
  }
  return false;
}

module.exports = { ratingAge, getKidsConfig, getOverrides, decide, allowedIds, kidsScope, canAccess, clearKidsCache };
