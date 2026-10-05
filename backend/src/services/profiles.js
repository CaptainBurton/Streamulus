// Profiles: "who's watching" inside an account. See database/db.js for the schema.
const db = require('../database/db');

const MAX_PROFILES = 6; // main profile + 5 more, like Netflix

// Every account has exactly one main profile; create it if it's missing
// (accounts made before profiles existed are migrated in db.js).
function ensureMainProfile(userId, username) {
  const main = db.prepare('SELECT * FROM profiles WHERE user_id = ? AND is_main = 1').get(userId);
  if (main) return main;
  const r = db.prepare('INSERT INTO profiles (user_id, name, is_main) VALUES (?, ?, 1)').run(userId, username || 'Main');
  return db.prepare('SELECT * FROM profiles WHERE id = ?').get(r.lastInsertRowid);
}

// Shape sent to the browser — never includes the PIN hash.
function publicProfile(p) {
  return {
    id: p.id,
    name: p.name,
    avatar_url: p.avatar_path ? `/uploads/avatars/${p.avatar_path}` : null,
    is_main: !!p.is_main,
    is_kids: !!p.is_kids,
    has_pin: !!p.pin_hash,
  };
}

// Remove a profile and everything that belongs to it (not the main profile).
function deleteProfileData(profileId) {
  db.prepare('DELETE FROM watch_history WHERE profile_id = ?').run(profileId);
  db.prepare('DELETE FROM profiles WHERE id = ?').run(profileId);
}

module.exports = { MAX_PROFILES, ensureMainProfile, publicProfile, deleteProfileData };
