// English titles and descriptions for "Show titles in English" (per profile).
// Looked up in the background for rows whose stored text is likely not English:
// shows matched through TVDB (which stores the original-language name and
// overview), and anything written in a non-Latin script (Japanese, Korean,
// Chinese, Cyrillic, Greek, Arabic, Hebrew, Thai, Hindi…) or whose original
// language isn't English. NULL = not checked yet; '' = nothing different.
const db = require('../database/db');
const tmdb = require('./tmdb');
const tvdb = require('./tvdb');

const NON_LATIN = /[Ͱ-ϿЀ-ӿ֐-׿؀-ۿऀ-ॿ฀-๿ᄀ-ᇿ぀-ヿ㐀-鿿가-힯豈-﫿]/;
const looksForeign = (text) => !!text && NON_LATIN.test(text);
const foreignLanguage = (lang) => !!lang && !String(lang).startsWith('en');

// What to store: the English text if it's there and different, else ''.
const differs = (en, current) => (en && en.trim() && en.trim() !== String(current || '').trim() ? en.trim() : '');

let running = false;

async function inBatches(jobs) {
  for (let i = 0; i < jobs.length; i += 4) {
    await Promise.all(jobs.slice(i, i + 4).map(job => job().catch(() => {})));
    await new Promise(r => setTimeout(r, 250)); // stay well inside the APIs' rate limits
  }
}

async function fillMissingEnglish() {
  if (running) return;
  running = true;
  try {
    const hasTmdb = !!tmdb.getApiKey();
    const hasTvdb = tvdb.isConfigured();
    const setMovie = db.prepare('UPDATE movies SET title_en = ?, overview_en = ? WHERE id = ?');
    const setShow = db.prepare('UPDATE tv_shows SET title_en = ?, overview_en = ? WHERE id = ?');
    const setEpisode = db.prepare('UPDATE episodes SET title_en = ?, overview_en = ? WHERE id = ?');

    const movies = db.prepare('SELECT id, tmdb_id, title, overview, original_language FROM movies WHERE title_en IS NULL').all()
      .filter(m => looksForeign(m.title) || looksForeign(m.overview) || foreignLanguage(m.original_language));
    const shows = db.prepare('SELECT id, tmdb_id, tvdb_id, title, overview, original_language FROM tv_shows WHERE title_en IS NULL').all()
      .filter(s => (s.tvdb_id && !s.tmdb_id) || looksForeign(s.title) || looksForeign(s.overview) || foreignLanguage(s.original_language));
    const episodes = db.prepare(`
      SELECT e.id, e.season, e.episode_number, e.title, e.overview, s.tmdb_id, s.tvdb_id
      FROM episodes e JOIN tv_shows s ON s.id = e.show_id WHERE e.title_en IS NULL
    `).all().filter(e => looksForeign(e.title) || looksForeign(e.overview));

    const jobs = [];
    for (const m of movies) {
      jobs.push(async () => {
        if (!m.tmdb_id || !hasTmdb) { setMovie.run('', '', m.id); return; }
        const d = await tmdb.getEnglish(`/movie/${m.tmdb_id}`);
        if (d) setMovie.run(differs(d.title, m.title), differs(d.overview, m.overview), m.id);
      });
    }
    for (const s of shows) {
      jobs.push(async () => {
        if (s.tmdb_id && hasTmdb) {
          const d = await tmdb.getEnglish(`/tv/${s.tmdb_id}`);
          if (d) setShow.run(differs(d.name, s.title), differs(d.overview, s.overview), s.id);
        } else if (s.tvdb_id && hasTvdb) {
          const info = await tvdb.getSeriesInfo(s.tvdb_id).catch(() => null);
          if (info) setShow.run(differs(info.name, s.title), differs(info.overview, s.overview), s.id);
        } else {
          setShow.run('', '', s.id);
        }
      });
    }
    // Episodes: TMDB one request per season, TVDB one per show (cached).
    const seasons = new Map();
    for (const e of episodes) {
      const key = e.tmdb_id ? `tmdb:${e.tmdb_id}:${e.season}` : e.tvdb_id ? `tvdb:${e.tvdb_id}` : 'none';
      if (!seasons.has(key)) seasons.set(key, []);
      seasons.get(key).push(e);
    }
    for (const [key, list] of seasons) {
      jobs.push(async () => {
        const [source, id, season] = key.split(':');
        if (source === 'tmdb' && hasTmdb) {
          const d = await tmdb.getEnglish(`/tv/${id}/season/${season}`);
          if (!d) return;
          const byNumber = new Map((d.episodes || []).map(ep => [ep.episode_number, ep]));
          for (const e of list) {
            const ep = byNumber.get(e.episode_number);
            setEpisode.run(differs(ep?.name, e.title), differs(ep?.overview, e.overview), e.id);
          }
        } else if (source === 'tvdb' && hasTvdb) {
          for (const e of list) {
            const ep = await tvdb.getEpisodeDetails(Number(id), e.season, e.episode_number).catch(() => null);
            setEpisode.run(differs(ep?.name, e.title), differs(ep?.overview, e.overview), e.id);
          }
        } else {
          for (const e of list) setEpisode.run('', '', e.id);
        }
      });
    }
    if (!jobs.length) return;
    console.log(`[english] Looking up English titles for ${movies.length} movie(s), ${shows.length} show(s), ${episodes.length} episode(s)`);
    await inBatches(jobs);
    console.log('[english] Done');
  } finally {
    running = false;
  }
}

module.exports = { fillMissingEnglish, looksForeign };
