// "Fix Match": search the metadata sources the admin has set up for the right
// movie / show, then re-point a library item at the chosen result (title, year,
// overview, artwork, genres; episode titles and stills for shows).
const db = require('../database/db');
const tmdb = require('./tmdb');
const tvdb = require('./tvdb');
const imdb = require('./imdb');
const omdb = require('./omdb');

const IMG = 'https://image.tmdb.org/t/p';
const yearOf = (date) => (date ? parseInt(String(date).slice(0, 4), 10) || null : null);

function sourceOrder(type) {
  const key = type === 'movie' ? 'movie_source_order' : 'tv_source_order';
  const fallback = type === 'movie' ? ['tmdb', 'imdb'] : ['tvdb', 'tmdb', 'imdb'];
  let order;
  try { order = JSON.parse(db.prepare('SELECT value FROM config WHERE key = ?').get(key)?.value || 'null') || fallback; } catch { order = fallback; }
  const configured = { tmdb: !!tmdb.getApiKey(), tvdb: tvdb.isConfigured(), imdb: imdb.isConfigured() };
  return order.filter(src => configured[src] && (type === 'show' || src !== 'tvdb'));
}

const SOURCE_NAMES = { tmdb: 'TMDB', tvdb: 'TVDB', imdb: 'IMDb' };

async function searchSource(src, type, query, year) {
  if (src === 'tmdb') {
    const list = type === 'movie' ? await tmdb.searchMovieList(query, year) : await tmdb.searchTVList(query, year);
    return list.map(r => ({
      source: 'tmdb', id: String(r.id),
      title: type === 'movie' ? r.title : r.name,
      year: yearOf(type === 'movie' ? r.release_date : r.first_air_date),
      overview: r.overview || '',
      poster_url: r.poster_path ? `${IMG}/w185${r.poster_path}` : null,
    }));
  }
  if (src === 'tvdb') {
    const list = await tvdb.searchSeriesList(query, year);
    return list.map(r => ({
      source: 'tvdb', id: String(r.tvdb_id), title: r.name, year: parseInt(r.year, 10) || null,
      overview: r.overview || '', poster_url: r.poster,
    }));
  }
  if (src === 'imdb') {
    const list = await imdb.searchList(type, query, year);
    return list.map(r => ({
      source: 'imdb', id: r.id, title: r.title,
      year: parseInt(String(r.description || '').match(/\d{4}/)?.[0], 10) || null,
      overview: '', poster_url: r.image || null,
    }));
  }
  return [];
}

// Results from each configured source, in the admin's priority order.
async function search(type, query, year) {
  const sources = sourceOrder(type);
  const results = [];
  const warnings = [];
  for (const src of sources) {
    try {
      results.push(...await searchSource(src, type, query, year));
    } catch (e) {
      warnings.push(`${SOURCE_NAMES[src]}: ${e.response?.data?.status_message || e.response?.data?.message || e.message}`);
    }
  }
  return { sources: sources.map(s => SOURCE_NAMES[s]), results, warnings };
}

// ── Apply ─────────────────────────────────────────────────────────────────────

async function applyMovie(movie, source, id) {
  let row;
  if (source === 'tmdb') {
    const d = await tmdb.getMovieDetails(id);
    if (!d) throw new Error('TMDB has no movie with that id');
    row = {
      title: d.title, year: yearOf(d.release_date), tmdb_id: d.id, imdb_id: d.imdb_id || null,
      overview: d.overview || null, poster_path: d.poster_path || null, backdrop_path: d.backdrop_path || null,
      rating: d.vote_average || null, genres: JSON.stringify((d.genres || []).map(g => g.id)),
      imdb_rating: null, content_rating: null, original_language: d.original_language || '',
    };
  } else if (source === 'imdb') {
    const d = await imdb.getTitle(id);
    if (!d) throw new Error('IMDb has no title with that id');
    row = {
      original_language: null,
      title: d.title, year: d.year, tmdb_id: null, imdb_id: d.imdb_id,
      overview: d.overview, poster_path: d.poster_path, backdrop_path: null,
      rating: d.rating, genres: d.genres, imdb_rating: d.imdb_rating, content_rating: d.content_rating,
    };
  } else {
    throw new Error('Unknown source');
  }
  // OMDb fills in the IMDb rating / certificate when it's set up.
  if (omdb.isConfigured() && !row.content_rating) {
    const od = await omdb.searchMovie(row.title, row.year).catch(() => null);
    if (od) Object.assign(row, { imdb_id: row.imdb_id || od.imdb_id, imdb_rating: od.imdb_rating, content_rating: od.content_rating });
  }
  // logo_path NULL: fetch the new title's logo next time it's shown.
  db.prepare(`UPDATE movies SET title=?, year=?, tmdb_id=?, imdb_id=?, overview=?, poster_path=?, backdrop_path=?,
              rating=?, genres=?, imdb_rating=?, content_rating=?, original_language=?, logo_path=NULL,
              title_en=NULL, overview_en=NULL WHERE id=?`)
    .run(row.title || movie.title, row.year || null, row.tmdb_id, row.imdb_id, row.overview, row.poster_path,
         row.backdrop_path, row.rating, row.genres, row.imdb_rating, row.content_rating, row.original_language, movie.id);
}

// Episode titles/overviews/stills for the newly matched show — in the
// background, since a long show can be hundreds of lookups.
function refreshEpisodes(showId, lookup) {
  const episodes = db.prepare('SELECT * FROM episodes WHERE show_id = ?').all(showId);
  (async () => {
    let updated = 0;
    for (let i = 0; i < episodes.length; i += 4) {
      await Promise.all(episodes.slice(i, i + 4).map(async ep => {
        const d = await lookup(ep.season, ep.episode_number).catch(() => null);
        if (!d) return;
        db.prepare('UPDATE episodes SET title=?, overview=?, still_path=?, title_en=NULL, overview_en=NULL WHERE id=?')
          .run(d.name || ep.title, d.overview || ep.overview, d.still_path || ep.still_path, ep.id);
        updated++;
      }));
    }
    console.log(`[match] show ${showId}: updated ${updated}/${episodes.length} episode(s)`);
  })().catch(e => console.error(`[match] episode refresh for show ${showId}: ${e.message}`));
  return episodes.length;
}

function replaceSeasonPosters(showId, posters) {
  db.prepare('DELETE FROM seasons WHERE show_id = ?').run(showId);
  const insert = db.prepare('INSERT OR REPLACE INTO seasons (show_id, season_number, poster_path) VALUES (?, ?, ?)');
  for (const [season, url] of posters) if (url) insert.run(showId, season, url);
}

async function applyShow(show, source, id) {
  let row;
  let episodeLookup = null;
  if (source === 'tmdb') {
    const d = await tmdb.getTVDetails(id);
    if (!d) throw new Error('TMDB has no show with that id');
    row = {
      title: d.name, tmdb_id: d.id, tvdb_id: null, imdb_id: null,
      overview: d.overview || null, poster_path: d.poster_path || null, backdrop_path: d.backdrop_path || null,
      rating: d.vote_average || null, genres: JSON.stringify((d.genres || []).map(g => g.id)),
      status: d.status || null, first_air_date: d.first_air_date || null, imdb_rating: null, content_rating: null,
      original_language: d.original_language || '',
    };
    replaceSeasonPosters(show.id, (d.seasons || []).map(s => [s.season_number, s.poster_path ? `${IMG}/w500${s.poster_path}` : null]));
    episodeLookup = async (season, episode) => {
      const ep = await tmdb.getEpisodeDetails(d.id, season, episode);
      return ep ? { name: ep.name, overview: ep.overview, still_path: ep.still_path } : null;
    };
  } else if (source === 'tvdb') {
    const info = await tvdb.getSeriesInfo(id);
    if (!info) throw new Error('TVDB has no series with that id');
    const art = await tvdb.getSeriesArtwork(info.tvdb_id);
    row = {
      title: info.name, tmdb_id: null, tvdb_id: info.tvdb_id, imdb_id: null,
      overview: info.overview, poster_path: art.poster || info.image, backdrop_path: art.backdrop,
      rating: null, genres: info.genres.length ? JSON.stringify(info.genres) : null,
      status: info.status, first_air_date: info.first_air_date, imdb_rating: null, content_rating: null,
      original_language: info.original_language || '',
    };
    let seasonPosters = art.seasonPosters;
    if (!seasonPosters.size) seasonPosters = await tvdb.getSeasonPosters(info.tvdb_id);
    replaceSeasonPosters(show.id, [...seasonPosters]);
    episodeLookup = (season, episode) => tvdb.getEpisodeDetails(info.tvdb_id, season, episode);
  } else if (source === 'imdb') {
    const d = await imdb.getTitle(id);
    if (!d) throw new Error('IMDb has no title with that id');
    row = {
      title: d.name || d.title, tmdb_id: null, tvdb_id: null, imdb_id: d.imdb_id,
      overview: d.overview, poster_path: d.poster_path, backdrop_path: null,
      rating: d.rating, genres: d.genres, status: null, first_air_date: d.first_air_date,
      imdb_rating: d.imdb_rating, content_rating: d.content_rating, original_language: null,
    };
  } else {
    throw new Error('Unknown source');
  }
  if (omdb.isConfigured() && !row.content_rating) {
    const od = await omdb.searchSeries(row.title).catch(() => null);
    if (od) Object.assign(row, { imdb_id: row.imdb_id || od.imdb_id, imdb_rating: od.imdb_rating, content_rating: od.content_rating });
  }
  db.prepare(`UPDATE tv_shows SET title=?, tmdb_id=?, tvdb_id=?, imdb_id=?, overview=?, poster_path=?, backdrop_path=?,
              rating=?, genres=?, status=?, first_air_date=?, imdb_rating=?, content_rating=?, original_language=?, logo_path=NULL,
              title_en=NULL, overview_en=NULL WHERE id=?`)
    .run(row.title || show.title, row.tmdb_id, row.tvdb_id, row.imdb_id, row.overview, row.poster_path, row.backdrop_path,
         row.rating, row.genres, row.status, row.first_air_date, row.imdb_rating, row.content_rating, row.original_language, show.id);
  return episodeLookup ? refreshEpisodes(show.id, episodeLookup) : 0;
}

async function apply(type, mediaId, source, id) {
  if (type === 'movie') {
    const movie = db.prepare('SELECT * FROM movies WHERE id = ?').get(mediaId);
    if (!movie) throw Object.assign(new Error('Movie not found'), { status: 404 });
    await applyMovie(movie, source, id);
    return { episodes: 0 };
  }
  const show = db.prepare('SELECT * FROM tv_shows WHERE id = ?').get(mediaId);
  if (!show) throw Object.assign(new Error('Show not found'), { status: 404 });
  return { episodes: await applyShow(show, source, id) };
}

module.exports = { search, apply };
