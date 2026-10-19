// Works out what a media file is from where it sits and what it's called, the
// way Plex, Sonarr and Radarr lay libraries out:
//
//   TV:     <library>/<Series folder>/<Season folder>/<episode file>
//   Movies: <library>/<Movie folder>/<movie file>   (or loose files in <library>)
//
// The admin can give the naming formats their files use (Admin › Settings ›
// Library Naming) in Sonarr / Radarr token syntax, e.g.
//   "{Series Title} - S{season:00}E{episode:00} - {Episode Title} {Quality Full}"
// Each format becomes a pattern that's tried first; common naming styles are
// tried after it, so most libraries work without changing anything.
//
// The series is the top-level folder: every file under it belongs to the same
// show, whatever its file is called or which season / Specials / Extras folder
// it's in — that's what keeps a show from splitting into duplicates.
const path = require('path');
const db = require('../database/db');

const DEFAULTS = {
  naming_series_folder: '{Series Title} ({Year})',
  naming_season_folder: 'Season {season}',
  naming_specials_folders: 'Specials, Season 0, Season 00, Extras',
  naming_episode_file: '{Series Title} - S{season:00}E{episode:00} - {Episode Title}',
  naming_movie_folder: '{Movie Title} ({Release Year})',
  naming_movie_file: '{Movie Title} ({Release Year})',
};

// Folders Plex treats as extras for a movie or show, never as their own titles.
const EXTRAS_FOLDERS = new Set([
  'extras', 'featurettes', 'behind the scenes', 'deleted scenes', 'interviews',
  'scenes', 'shorts', 'trailers', 'other', 'others', 'bonus', 'samples', 'sample',
]);

function getConfig() {
  const rows = db.prepare(`SELECT key, value FROM config WHERE key LIKE 'naming_%'`).all();
  const saved = Object.fromEntries(rows.map(r => [r.key, r.value]));
  const out = {};
  for (const [key, def] of Object.entries(DEFAULTS)) out[key] = (saved[key] ?? '').trim() || def;
  return out;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// One Sonarr / Radarr token → a regular-expression piece.
function tokenPattern(token) {
  const t = token.toLowerCase().replace(/[\s_.-]+/g, '');
  if (/^(series|movie)(clean|original)?title(the)?year$/.test(t)) {
    return '(?<title>.+?)(?:[\\s._]*\\(?(?<year>(?:19|20)\\d{2})\\)?)?';
  }
  if (/^(series|movie)(clean|original)?title(the)?$/.test(t)) return '(?<title>.+?)';
  if (/^(release)?year$/.test(t)) return '(?<year>(?:19|20)\\d{2})';
  if (/^season(:0+)?$/.test(t)) return '(?<season>\\d{1,4})';
  if (/^episode(:0+)?$/.test(t)) return '(?<episode>\\d{1,4})(?:-?[ex](?<episode2>\\d{1,4}))*';
  if (/^absolute(episodenumber)?(:0+)?$/.test(t)) return '(?<absolute>\\d{1,4})';
  if (t === 'tvdbid') return '(?<tvdb>\\d+)';
  if (t === 'tmdbid') return '(?<tmdb>\\d+)';
  if (t === 'imdbid') return '(?<imdb>tt\\d+)';
  return '.*?'; // quality, release group, edition, episode title… — not needed
}

// Literal text from a format: spaces may be dots or underscores, and " - " any run of separators.
function literalPattern(text) {
  return text
    .replace(/\s*-\s*/g, '\u0001')
    .split(/(\s+)/)
    .map(part => (/^\s+$/.test(part) ? '[\\s._]+' : escapeRe(part)))
    .join('')
    .replace(/\u0001/g, '[\\s._]*-[\\s._]*');
}

// "{Series Title} - S{season:00}E{episode:00}" → /^(?<title>.+?)[\s._]*-[\s._]*S(?<season>\d{1,4})E(?<episode>…)/i
function compileFormat(format, { whole = false } = {}) {
  let out = '^';
  let lastWasToken = false;
  const re = /\{([^{}]+)\}|([^{}]+)/g;
  let m;
  while ((m = re.exec(String(format || '')))) {
    if (m[1] !== undefined) {
      out += tokenPattern(m[1]);
      lastWasToken = true;
    } else {
      out += literalPattern(m[2]);
      lastWasToken = false;
    }
  }
  if (out === '^') return null;
  if (whole) out += lastWasToken ? '$' : '[\\s._]*$';
  try { return new RegExp(out, 'i'); } catch { return null; }
}

const clean = (s) => String(s || '')
  .replace(/[._]+/g, ' ')
  .replace(/\s*[[{](?:tvdb|tmdb|imdb)(?:id)?[-=][^\]}]+[\]}]\s*/gi, ' ')
  .replace(/\s+/g, ' ')
  .trim();

// Strip a trailing "(2019)" or " 2019" from a title, returning both.
function splitYear(title) {
  const m = String(title).match(/^(.*?)[\s._]*[([]?((?:19|20)\d{2})[)\]]?$/);
  if (m && m[1].trim()) return { title: m[1].trim(), year: parseInt(m[2], 10) };
  return { title: String(title).trim(), year: null };
}

// Metadata IDs written into folder or file names: {tvdb-123}, [tvdbid-123], {tmdb-456}, {imdb-tt789}.
function idsFrom(text) {
  const ids = {};
  const s = String(text || '');
  const tvdb = s.match(/[[{]tvdb(?:id)?[-=](\d+)[\]}]/i);
  const tmdb = s.match(/[[{]tmdb(?:id)?[-=](\d+)[\]}]/i);
  const imdb = s.match(/[[{]imdb(?:id)?[-=](tt\d+)[\]}]/i) || s.match(/\b(tt\d{7,9})\b/);
  if (tvdb) ids.tvdb = parseInt(tvdb[1], 10);
  if (tmdb) ids.tmdb = parseInt(tmdb[1], 10);
  if (imdb) ids.imdb = imdb[1];
  return ids;
}

const isExtrasFolder = (name) => EXTRAS_FOLDERS.has(String(name || '').toLowerCase().trim());

// Path parts relative to the library root.
function relParts(libraryRoot, filePath) {
  const rel = path.relative(libraryRoot, filePath);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return [path.basename(filePath)];
  return rel.split(path.sep).filter(Boolean);
}

// ── TV ───────────────────────────────────────────────────────────────────────

function episodeFromName(base, cfg) {
  const custom = compileFormat(cfg.naming_episode_file);
  const tries = [];
  if (custom) tries.push(custom);
  tries.push(
    /^(?<title>.*?)[\s._-]*\bS(?<season>\d{1,4})[\s._-]*E(?<episode>\d{1,4})(?:-?E?(?<episode2>\d{1,4}))?/i,
    /^(?<title>.*?)[\s._-]*\b(?<season>\d{1,2})x(?<episode>\d{1,3})\b/i,
    /^(?<title>.*?)[\s._-]*\bSeason[\s._-]*(?<season>\d{1,4})[\s._-]*Episode[\s._-]*(?<episode>\d{1,4})/i,
  );
  for (const re of tries) {
    const m = base.match(re);
    if (m?.groups && (m.groups.episode || m.groups.absolute)) {
      return {
        title: m.groups.title ? clean(m.groups.title) : null,
        season: m.groups.season != null ? parseInt(m.groups.season, 10) : null,
        episode: m.groups.episode != null ? parseInt(m.groups.episode, 10) : parseInt(m.groups.absolute, 10),
        absolute: m.groups.absolute != null ? parseInt(m.groups.absolute, 10) : null,
      };
    }
  }
  // No season in the name: "Episode 12", "Ep12", "E12", or anime-style "Show - 12 [1080p]".
  const loose = base.match(/\b(?:Episode|Ep)[\s._-]*(?<episode>\d{1,4})\b/i)
    || base.match(/(?:^|[\s._-])E(?<episode>\d{1,4})(?:[\s._-]|$)/i)
    || base.match(/^(?<title>.*?)[\s._]+-[\s._]+(?<episode>\d{1,4})(?:v\d)?(?:[\s._]|\[|\(|$)/i)
    || base.match(/^(?:\[[^\]]*\][\s._]*)?(?<title>.*?)[\s._]+(?<episode>\d{1,3})(?:v\d)?[\s._]*(?:\[|\(|$)/i)
    || base.match(/^(?<episode>\d{1,4})(?:[\s._-]|$)/);
  if (loose?.groups) {
    return {
      title: loose.groups.title ? clean(loose.groups.title.replace(/^\[[^\]]*\]\s*/, '')) : null,
      season: null,
      episode: parseInt(loose.groups.episode, 10),
      absolute: null,
    };
  }
  return null;
}

function seasonFromFolder(name, cfg) {
  const lower = String(name).toLowerCase().trim();
  const specials = cfg.naming_specials_folders.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  if (specials.includes(lower) || isExtrasFolder(lower)) return 0;
  const custom = compileFormat(cfg.naming_season_folder, { whole: true });
  const m = (custom && name.match(custom)) || name.match(/^(?:Season|Series|Saison|Staffel|Temporada|S)[\s._-]*(?<season>\d{1,4})\b/i);
  if (m?.groups?.season != null) return parseInt(m.groups.season, 10);
  return null;
}

function seriesFromFolder(name, cfg) {
  const ids = idsFrom(name);
  const custom = compileFormat(cfg.naming_series_folder, { whole: true });
  const m = custom && name.match(custom);
  if (m?.groups?.title) {
    const year = m.groups.year ? parseInt(m.groups.year, 10) : null;
    const split = splitYear(clean(m.groups.title));
    return { title: split.title, year: year || split.year, ids };
  }
  const split = splitYear(clean(name));
  return { title: split.title, year: split.year, ids };
}

const isSeasonLike = (name, cfg) => seasonFromFolder(name, cfg) != null || isExtrasFolder(name);

/**
 * What a TV file is. Returns null when it can't be an episode.
 * { showKey, showTitle, year, ids, season, episode, episodeTitle, extra }
 * `showKey` is the series folder (or, for loose files, the parsed title): every
 * file under one series folder belongs to one show.
 */
function parseEpisode(libraryRoot, filePath, cfg = getConfig()) {
  const parts = relParts(libraryRoot, filePath);
  const file = parts[parts.length - 1];
  const base = path.basename(file, path.extname(file));
  if (/(^|[\s._-])sample$/i.test(base) || /-trailer$/i.test(base)) return null;

  const folders = parts.slice(0, -1);
  const fromName = episodeFromName(base, cfg);

  // The series folder is the one above the first Season / Specials / Extras folder,
  // or the folder the file is in (so "TV/Anime/Show/Season 1" works too).
  const firstSeason = folders.findIndex(f => isSeasonLike(f, cfg));
  const seriesIndex = firstSeason > 0 ? firstSeason - 1 : (firstSeason === 0 ? -1 : folders.length - 1);

  let series;
  let showKey;
  if (seriesIndex >= 0) {
    series = seriesFromFolder(folders[seriesIndex], cfg);
    showKey = path.join(libraryRoot, ...folders.slice(0, seriesIndex + 1));
  } else {
    const fallback = fromName?.title ? splitYear(fromName.title) : null;
    if (!fallback?.title) return null;
    series = { title: fallback.title, year: fallback.year, ids: idsFrom(base) };
    showKey = `title:${fallback.title.toLowerCase()}`;
  }
  if (!series.title) return null;

  // Season: from the filename, else the nearest season / Specials / Extras folder.
  const below = folders.slice(seriesIndex + 1);
  let season = fromName?.season ?? null;
  let extra = below.some(isExtrasFolder);
  // (an Extras folder inside "Season 2" belongs to season 2)
  for (let i = below.length - 1; i >= 0 && season == null; i--) {
    if (isExtrasFolder(below[i])) continue;
    const s = seasonFromFolder(below[i], cfg);
    if (s != null) season = s;
  }
  if (season == null) season = extra ? 0 : 1; // episodes straight inside the show folder

  const episode = fromName?.episode ?? null;
  if (episode == null && !extra) return null;

  return {
    showKey,
    showTitle: series.title,
    year: series.year,
    ids: { ...series.ids, ...idsFrom(base) },
    season,
    episode, // null for an unnumbered extra — numbered when it's added
    episodeTitle: extra && episode == null ? clean(base) : null,
    extra,
  };
}

// ── Movies ───────────────────────────────────────────────────────────────────

function movieFromText(text, format) {
  const ids = idsFrom(text);
  const custom = format && compileFormat(format);
  const m = custom && text.match(custom);
  if (m?.groups?.title) {
    const split = splitYear(clean(m.groups.title));
    return { title: split.title, year: m.groups.year ? parseInt(m.groups.year, 10) : split.year, ids };
  }
  // Scene style "Movie.Title.2019.1080p.BluRay…" or "Movie Title (2019) [1080p]".
  const scene = text.match(/^(.+?)[\s._\-[(]+((?:19|20)\d{2})(?:[\s._\-\])]|$)/);
  if (scene) return { title: clean(scene[1]), year: parseInt(scene[2], 10), ids };
  return { title: clean(text.replace(/[[(].*$/, '')) || clean(text), year: null, ids };
}

/**
 * What a movie file is. Returns null for samples, trailers and extras.
 * { title, year, ids }
 */
function parseMovie(libraryRoot, filePath, cfg = getConfig()) {
  const parts = relParts(libraryRoot, filePath);
  const file = parts[parts.length - 1];
  const base = path.basename(file, path.extname(file));
  const folders = parts.slice(0, -1);
  if (/(^|[\s._-])sample$/i.test(base) || /-(trailer|featurette|behindthescenes|deleted|interview|scene|short|other)$/i.test(base)) return null;
  if (folders.some(isExtrasFolder)) return null;

  const fromFile = movieFromText(base, cfg.naming_movie_file);
  if (folders.length > 0) {
    // In its own folder (Radarr / Plex style): the folder names the movie best.
    const fromFolder = movieFromText(folders[folders.length - 1], cfg.naming_movie_folder);
    if (fromFolder.title) {
      return {
        title: fromFolder.title,
        year: fromFolder.year || fromFile.year,
        ids: { ...fromFile.ids, ...fromFolder.ids },
      };
    }
  }
  return fromFile.title ? fromFile : null;
}

module.exports = { DEFAULTS, getConfig, compileFormat, parseEpisode, parseMovie, isExtrasFolder, idsFrom };
