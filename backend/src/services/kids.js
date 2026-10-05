// Streamlings (kids profiles): which movies and shows they may see.
//
// A title is allowed when the admin ticked it in Admin > Streamlings, or — if
// it has no manual choice — when "use age ratings" is on and its content
// rating suits the configured maximum age. Unrated titles are blocked unless
// "allow unrated" is on. Episodes follow their show.
const db = require('../database/db');

// Ratings that contain no age number. Ambiguous ones lean strict, because a
// wrongly blocked title is safer for kids than a wrongly allowed one.
const LETTER_RATINGS = {
  // All ages
  G: 0, U: 0, UC: 0, 'TV-Y': 0, 'TV-G': 0, L: 0, AL: 0, ALL: 0, TP: 0, BTL: 0, S: 0, P: 0, AA: 0,
  // Parental guidance
  PG: 8, 'TV-PG': 8,
  // Teens / adults
  M: 15, MA: 15, B: 12,
  R: 17, 'TV-MA': 17,
  A: 18, C: 18, D: 18, X: 18, XXX: 18, 'NC-17': 18, R18: 18,
};
const UNRATED = new Set(['NR', 'UNRATED', 'NOT RATED', 'N/A', 'NA', 'APPROVED', 'PASSED', 'E', 'EXEMPT', '']);

// Minimum suitable age for a rating string, or null if unknown/unrated.
// Covers US (G, PG-13, TV-Y7…), UK (U, 12A, 15…), AU (MA15+…), DE (FSK 12),
// NZ (R13), CA (14A), FR, NL, Nordics, BR, JP and similar systems.
function ratingAge(rating) {
  if (rating == null) return null;
  const r = String(rating).trim().toUpperCase().replace(/^FSK\s*/, '');
  if (UNRATED.has(r)) return null;
  if (r in LETTER_RATINGS) return LETTER_RATINGS[r];
  const n = r.match(/(\d{1,2})/); // TV-14 → 14, 12A → 12, MA15+ → 15, K-7 → 7
  return n ? parseInt(n[1], 10) : null;
}

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
