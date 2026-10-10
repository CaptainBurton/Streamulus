// Profile pictures the admin provides (Admin › Profile Pictures), grouped in named
// categories such as "The Simpsons". Profiles pick from them on the web and the
// iPhone / iPad app — Streamlings too, who can't upload their own photo.
//
// Who sees what: categories and pictures each have an audience — 'all', 'adults'
// (Streamers, the grown-up profiles) or 'kids' (Streamlings). A picture is offered
// to a profile when both its category and the picture itself allow that profile.
const fs = require('fs');
const path = require('path');
const db = require('../database/db');

const AUDIENCES = ['all', 'adults', 'kids'];
const libraryDir = path.join(process.env.DATA_DIR || '/data', 'uploads', 'avatar-library');
fs.mkdirSync(libraryDir, { recursive: true });

const imageUrl = (file) => `/uploads/avatar-library/${file}`;
const allows = (audience, isKids) => audience === 'all' || (audience === 'kids') === !!isKids;

// The pictures `profile` may pick, by category (alphabetical); empty categories left out.
function choicesFor(profile) {
  const categories = db.prepare('SELECT * FROM avatar_categories ORDER BY name COLLATE NOCASE, id').all();
  const images = db.prepare('SELECT * FROM avatar_images ORDER BY id').all();
  return categories
    .filter(c => allows(c.audience, profile.is_kids))
    .map(c => ({
      id: c.id,
      name: c.name,
      images: images
        .filter(i => i.category_id === c.id && allows(i.audience, profile.is_kids))
        .map(i => ({ id: i.id, url: imageUrl(i.file) })),
    }))
    .filter(c => c.images.length > 0);
}

// One picture, if `profile` may pick it.
function findChoice(profile, imageId) {
  const row = db.prepare(`
    SELECT i.*, c.audience AS category_audience FROM avatar_images i
    JOIN avatar_categories c ON c.id = i.category_id WHERE i.id = ?
  `).get(imageId);
  if (!row || !allows(row.category_audience, profile.is_kids) || !allows(row.audience, profile.is_kids)) return null;
  return row;
}

function removeFile(file) {
  if (file) fs.rm(path.join(libraryDir, file), { force: true }, () => {});
}

module.exports = { AUDIENCES, libraryDir, imageUrl, allows, choicesFor, findChoice, removeFile };
