const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const db = require('../database/db');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { kidsScope } = require('../services/kids');
const { formatMovie } = require('./movies');
const { formatShow } = require('./tv');
const { imageExt } = require('./profiles');

const router = express.Router();

const genresDir = path.join(process.env.DATA_DIR || '/data', 'uploads', 'genres');
fs.mkdirSync(genresDir, { recursive: true });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// TMDB gives shows combined genres; split them so movies and shows share
// genres (a show tagged "Action & Adventure" appears under Action and Adventure).
const TV_SPLIT = {
  'Action & Adventure': ['Action', 'Adventure'],
  'Sci-Fi & Fantasy': ['Sci-Fi', 'Fantasy'],
  'War & Politics': ['War', 'Politics'],
};
const expand = (names) => [...new Set((names || []).flatMap(n => TV_SPLIT[n] || [n]))];

// TMDB has no Anime genre: animation made in Japanese, Korean or Chinese counts
// as Anime (as does anything a source tags "Anime", like TVDB).
const ANIME_LANGUAGES = new Set(['ja', 'ko', 'zh', 'cn']);
function genresOf(item) {
  const genres = expand(item.genres);
  if (!genres.includes('Anime') && genres.includes('Animation') && ANIME_LANGUAGES.has(String(item.original_language || '').slice(0, 2))) {
    genres.push('Anime');
  }
  return genres;
}

const byTitle = (a, b) => sortKey(a.title).localeCompare(sortKey(b.title), undefined, { sensitivity: 'base' });
const sortKey = (t = '') => t.replace(/^(the|a|an)\s+/i, '');

// Every movie and show this profile can see, with expanded genre names.
function library(req) {
  const scope = kidsScope(req);
  const movies = (scope
    ? db.prepare('SELECT * FROM movies WHERE id IN (SELECT value FROM json_each(?))').all(scope.moviesJson)
    : db.prepare('SELECT * FROM movies').all()
  ).map(formatMovie).map(m => ({ ...m, genres: genresOf(m) }));
  const shows = (scope
    ? db.prepare('SELECT * FROM tv_shows WHERE id IN (SELECT value FROM json_each(?))').all(scope.showsJson)
    : db.prepare('SELECT * FROM tv_shows').all()
  ).map(formatShow).map(s => ({ ...s, genres: genresOf(s) }));
  return { movies, shows };
}

function groupByGenre({ movies, shows }) {
  const groups = new Map();
  const add = (kind, item) => {
    for (const name of item.genres) {
      if (!groups.has(name)) groups.set(name, { name, movies: [], shows: [] });
      groups.get(name)[kind].push(item);
    }
  };
  movies.forEach(m => add('movies', m));
  shows.forEach(s => add('shows', s));
  return groups;
}

const customImages = () => new Map(db.prepare('SELECT name, image_path FROM genre_images').all().map(r => [r.name, r.image_path]));
const pickRandom = (list) => list[Math.floor(Math.random() * list.length)];

// The admin's image, or the wide banner art (backdrop) of a random movie or show
// in the genre — wide art suits the 16:9 / 5:3 cards. Posters only as a last resort.
function genreImage(group, custom) {
  if (custom) return `/uploads/genres/${custom}`;
  const all = [...group.movies, ...group.shows];
  const withBackdrop = all.filter(i => i.backdrop_url);
  const candidates = withBackdrop.length ? withBackdrop : all.filter(i => i.poster_url);
  const pick = candidates.length ? pickRandom(candidates) : null;
  return pick ? (pick.backdrop_url || pick.poster_url) : null;
}

router.get('/', authenticate, (req, res) => {
  const groups = groupByGenre(library(req));
  const custom = customImages();
  const genres = [...groups.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(g => ({
      name: g.name,
      movie_count: g.movies.length,
      show_count: g.shows.length,
      image_url: genreImage(g, custom.get(g.name)),
      custom_image: custom.has(g.name),
    }));
  res.json({ genres });
});

// ?type=all (default) | movies | shows
router.get('/:name', authenticate, (req, res) => {
  const groups = groupByGenre(library(req));
  const wanted = String(req.params.name).toLowerCase();
  const group = [...groups.values()].find(g => g.name.toLowerCase() === wanted);
  if (!group) return res.status(404).json({ error: 'Genre not found' });
  const type = ['movies', 'shows'].includes(req.query.type) ? req.query.type : 'all';
  res.json({
    genre: group.name,
    movie_count: group.movies.length,
    show_count: group.shows.length,
    movies: type === 'shows' ? [] : group.movies.sort(byTitle),
    shows: type === 'movies' ? [] : group.shows.sort(byTitle),
  });
});

// ── Admin: custom genre artwork ───────────────────────────────────────────────

function knownGenre(name) {
  const groups = groupByGenre({
    movies: db.prepare('SELECT genres, original_language FROM movies').all().map(formatMovie).map(m => ({ genres: genresOf(m) })),
    shows: db.prepare('SELECT genres, original_language FROM tv_shows').all().map(formatShow).map(s => ({ genres: genresOf(s) })),
  });
  return [...groups.keys()].find(g => g.toLowerCase() === String(name).toLowerCase()) || null;
}

function removeCustom(name) {
  const row = db.prepare('SELECT image_path FROM genre_images WHERE name = ?').get(name);
  if (row) fs.rm(path.join(genresDir, row.image_path), { force: true }, () => {});
  db.prepare('DELETE FROM genre_images WHERE name = ?').run(name);
}

router.post('/:name/image', requireAdmin, (req, res) => {
  const name = knownGenre(req.params.name);
  if (!name) return res.status(404).json({ error: 'Genre not found' });
  upload.single('image')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Image must be 10 MB or smaller' : 'Upload failed' });
    if (!req.file) return res.status(400).json({ error: 'No image uploaded' });
    const ext = imageExt(req.file.buffer);
    if (!ext) return res.status(400).json({ error: 'Use a PNG, JPG, WebP or GIF image' });
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'genre';
    const filename = `${slug}-${Date.now()}.${ext}`;
    fs.writeFileSync(path.join(genresDir, filename), req.file.buffer);
    removeCustom(name);
    db.prepare('INSERT INTO genre_images (name, image_path) VALUES (?, ?)').run(name, filename);
    res.json({ name, image_url: `/uploads/genres/${filename}` });
  });
});

router.delete('/:name/image', requireAdmin, (req, res) => {
  const name = knownGenre(req.params.name) || req.params.name;
  removeCustom(name);
  res.json({ success: true });
});

module.exports = router;
