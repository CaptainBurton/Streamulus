// Title logos (the stylised movie/show name artwork) from TMDB, cached in the
// logo_path column: a URL, or '' when TMDB has none (so we don't ask again).
const db = require('../database/db');
const { getMovieImages, getTVImages } = require('./tmdb');

// Prefer the configured language, then English, then textless; PNG only
// (TMDB also has SVG logos, which the Apple TV app can't display).
function pickLogo(logos) {
  const lang = db.prepare("SELECT value FROM config WHERE key = 'preferred_language'").get()?.value || 'en';
  const score = (l) => (l.iso_639_1 === lang ? 20 : l.iso_639_1 === 'en' ? 10 : l.iso_639_1 == null ? 5 : 0) + (l.vote_average || 0);
  return (logos || [])
    .filter(l => typeof l.file_path === 'string' && l.file_path.toLowerCase().endsWith('.png'))
    .sort((a, b) => score(b) - score(a))[0] || null;
}

// kind: 'movie' | 'show'. row needs id, tmdb_id and logo_path.
async function ensureLogo(kind, row) {
  if (typeof row.logo_path === 'string') return row.logo_path || null;
  if (!row.tmdb_id) return null;
  const images = kind === 'movie' ? await getMovieImages(row.tmdb_id) : await getTVImages(row.tmdb_id);
  if (!images) return null; // no API key or TMDB unreachable — try again next time
  const best = pickLogo(images.logos);
  const url = best ? `https://image.tmdb.org/t/p/w500${best.file_path}` : '';
  db.prepare(`UPDATE ${kind === 'movie' ? 'movies' : 'tv_shows'} SET logo_path = ? WHERE id = ?`).run(url, row.id);
  return url || null;
}

module.exports = { ensureLogo };
