// Original language of each animated movie/show, so Japanese, Korean and
// Chinese animation can be grouped as "Anime" (TMDB has no Anime genre).
// Only titles tagged Animation are looked up. NULL = not looked up yet,
// '' = the source doesn't say.
const db = require('../database/db');
const tmdb = require('./tmdb');
const tvdb = require('./tvdb');
const { language } = require('./subtitles');

const isAnimated = (genres) => {
  try { return (JSON.parse(genres || '[]') || []).some(g => String(g) === '16' || /^animation$/i.test(String(g))); } catch { return false; }
};
const code = (raw) => (raw ? (language(raw)?.code || String(raw).toLowerCase()) : '');

let running = false;

async function fillMissingLanguages() {
  if (running) return;
  running = true;
  try {
    const hasTmdb = !!tmdb.getApiKey();
    const movies = hasTmdb
      ? db.prepare('SELECT id, tmdb_id, genres FROM movies WHERE original_language IS NULL AND tmdb_id IS NOT NULL').all().filter(m => isAnimated(m.genres))
      : [];
    const shows = db.prepare('SELECT id, tmdb_id, tvdb_id, genres FROM tv_shows WHERE original_language IS NULL AND (tmdb_id IS NOT NULL OR tvdb_id IS NOT NULL)').all()
      .filter(s => isAnimated(s.genres) || (s.tvdb_id && !s.tmdb_id)); // TVDB genres are names; check them all
    const jobs = [
      ...movies.map(m => async () => {
        const d = await tmdb.getMovieDetails(m.tmdb_id);
        if (d) db.prepare('UPDATE movies SET original_language = ? WHERE id = ?').run(code(d.original_language), m.id);
      }),
      ...shows.map(s => async () => {
        let lang = null;
        if (s.tmdb_id && hasTmdb) {
          const d = await tmdb.getTVDetails(s.tmdb_id);
          if (d) lang = code(d.original_language);
        } else if (s.tvdb_id && tvdb.isConfigured()) {
          const info = await tvdb.getSeriesInfo(s.tvdb_id).catch(() => null);
          if (info) lang = info.original_language || '';
        }
        if (lang !== null) db.prepare('UPDATE tv_shows SET original_language = ? WHERE id = ?').run(lang, s.id);
      }),
    ];
    if (!jobs.length) return;
    console.log(`[languages] Looking up the original language of ${jobs.length} animated title(s)`);
    for (let i = 0; i < jobs.length; i += 4) {
      await Promise.all(jobs.slice(i, i + 4).map(job => job().catch(() => {})));
      await new Promise(r => setTimeout(r, 250)); // stay well inside TMDB's rate limit
    }
    console.log('[languages] Done');
  } finally {
    running = false;
  }
}

module.exports = { fillMissingLanguages };
