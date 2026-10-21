// Streaming services: the Netflix / Disney+ / … row on Home and a library page
// for each. The admin decides which movies and shows each service has (a title
// can be on several) in Admin › Streaming Services — by hand, or filled in from
// TMDB's "where to watch" for the country chosen in Admin › Settings.
//
// Logos live in assets/services (<id>.svg for the website, <id>.png already
// coloured with the Streamulus gradient for the apps).
const fs = require('fs');
const path = require('path');
const db = require('../database/db');

const LOGO_DIR = path.join(__dirname, '../assets/services');

// providers: TMDB provider ids and (lower-case) names that count as this service,
// including ad tiers and channels such as "Paramount Plus Apple TV Channel".
const BUILTIN = [
  { id: 'netflix', name: 'Netflix', providerIds: [8, 175, 1796], providerNames: ['netflix'] },
  { id: 'disneyplus', name: 'Disney+', providerIds: [337], providerNames: ['disney plus'] },
  { id: 'primevideo', name: 'Prime Video', providerIds: [9, 119, 2100], providerNames: ['amazon prime video', 'prime video'] },
  { id: 'appletvplus', name: 'Apple TV+', providerIds: [350], providerNames: ['apple tv plus'] },
  { id: 'hbomax', name: 'HBO Max', providerIds: [384, 1899], providerNames: ['hbo max', 'max'] },
  { id: 'paramountplus', name: 'Paramount+', providerIds: [531, 582, 1853, 2303, 2616], providerNames: ['paramount plus'] },
  { id: 'hulu', name: 'Hulu', providerIds: [15], providerNames: ['hulu'] },
  { id: 'crunchyroll', name: 'Crunchyroll', providerIds: [283, 1968], providerNames: ['crunchyroll'] },
  { id: 'stan', name: 'Stan', providerIds: [21], providerNames: ['stan'] },
  { id: 'binge', name: 'Binge', providerIds: [385], providerNames: ['binge'] },
];

// Width ÷ height of each logo (the SVGs are cropped to what they draw), so the
// row can give wide and tall logos the same visual weight.
const aspectCache = new Map();
function logoAspect(id) {
  if (!aspectCache.has(id)) {
    let aspect = 3;
    try {
      const m = fs.readFileSync(path.join(LOGO_DIR, `${id}.svg`), 'utf8').match(/viewBox="([^"]+)"/);
      const [, , w, h] = m[1].trim().split(/[\s,]+/).map(Number);
      if (w > 0 && h > 0) aspect = +(w / h).toFixed(3);
    } catch {}
    aspectCache.set(id, aspect);
  }
  return aspectCache.get(id);
}

// Add any built-in service the database doesn't have yet (keeps the admin's order).
function seed() {
  const max = db.prepare('SELECT COALESCE(MAX(sort), -1) AS m FROM streaming_services').get().m;
  const insert = db.prepare('INSERT OR IGNORE INTO streaming_services (id, name, sort, enabled) VALUES (?, ?, ?, 1)');
  BUILTIN.forEach((s, i) => insert.run(s.id, s.name, max + 1 + i));
}
seed();

const all = () => db.prepare('SELECT * FROM streaming_services ORDER BY sort, name').all()
  .filter(s => BUILTIN.some(b => b.id === s.id));

function publicService(s, banner) {
  return {
    id: s.id,
    name: s.name,
    logo_svg: `/api/services/logos/${s.id}.svg`,
    logo_png: `/api/services/logos/${s.id}.png`,
    logo_aspect: logoAspect(s.id),
    banner_url: banner ?? null,
  };
}

const customBanner = (s) => (s.banner_path ? `/uploads/services/${s.banner_path}` : null);

// { movie: Map(id → [serviceIds]), show: Map(id → [serviceIds]) }
function assignments() {
  const out = { movie: new Map(), show: new Map() };
  for (const r of db.prepare('SELECT media_type, media_id, service_id FROM title_services').all()) {
    const map = out[r.media_type];
    if (!map) continue;
    if (!map.has(r.media_id)) map.set(r.media_id, []);
    map.get(r.media_id).push(r.service_id);
  }
  return out;
}

function setTitleServices(mediaType, mediaId, serviceIds, source = 'admin') {
  const valid = new Set(all().map(s => s.id));
  const wanted = [...new Set((serviceIds || []).filter(id => valid.has(id)))];
  db.transaction(() => {
    db.prepare('DELETE FROM title_services WHERE media_type = ? AND media_id = ?').run(mediaType, mediaId);
    const insert = db.prepare('INSERT INTO title_services (media_type, media_id, service_id, source) VALUES (?, ?, ?, ?)');
    for (const id of wanted) insert.run(mediaType, mediaId, id, source);
  })();
  return wanted;
}

// ── Filling in from TMDB ─────────────────────────────────────────────────────

const normal = (name) => String(name || '').toLowerCase().replace(/\+/g, ' plus').replace(/[^a-z0-9]+/g, ' ').trim();

function servicesFromProviders(entry) {
  const offers = [...(entry?.flatrate || []), ...(entry?.ads || [])];
  const found = new Set();
  for (const offer of offers) {
    const name = normal(offer.provider_name);
    for (const s of BUILTIN) {
      if (s.providerIds.includes(offer.provider_id)
        || s.providerNames.some(n => name === n || name.startsWith(`${n} `))) found.add(s.id);
    }
  }
  return [...found];
}

let job = null; // { running, done, total, titles, assigned, country, error }

// Titles that have no services yet get them from TMDB's streaming availability
// in the admin's country. Titles the admin already set are never changed.
// onlyNew: skip titles already looked up for this country (used after scans).
function autofill({ onlyNew = false } = {}) {
  if (job?.running) return job;
  const tmdb = require('./tmdb');
  const country = require('./ratings').country();
  if (!tmdb.getApiKey()) {
    job = { running: false, done: 0, total: 0, titles: 0, assigned: 0, country, error: 'Add a TMDB API key in Settings first' };
    return job;
  }
  const where = `tmdb_id IS NOT NULL AND id NOT IN (SELECT media_id FROM title_services WHERE media_type = ?)${onlyNew ? ' AND (services_checked IS NULL OR services_checked != ?)' : ''}`;
  const rows = (table, kind) => db.prepare(`SELECT id, tmdb_id FROM ${table} WHERE ${where}`).all(kind, ...(onlyNew ? [country] : [])).map(r => ({ ...r, table, kind }));
  const jobs = [...rows('movies', 'movie'), ...rows('tv_shows', 'show')];
  job = { running: jobs.length > 0, done: 0, total: jobs.length, titles: 0, assigned: 0, country, error: null };
  if (!jobs.length) return job;
  const current = job;
  console.log(`[services] Looking up where ${jobs.length} title(s) stream in ${country}`);
  (async () => {
    for (let i = 0; i < jobs.length; i += 4) {
      await Promise.all(jobs.slice(i, i + 4).map(async (t) => {
        try {
          const results = await tmdb.getWatchProviders(t.kind, t.tmdb_id);
          const services = servicesFromProviders(results?.[country]);
          // Only if the admin hasn't set this title's services in the meantime.
          const unset = !db.prepare('SELECT 1 FROM title_services WHERE media_type = ? AND media_id = ?').get(t.kind, t.id);
          if (services.length && unset) {
            setTitleServices(t.kind, t.id, services, 'tmdb');
            current.titles++;
            current.assigned += services.length;
          }
          db.prepare(`UPDATE ${t.table} SET services_checked = ? WHERE id = ?`).run(country, t.id);
        } catch { /* TMDB unreachable for this one: it's tried again next time */ }
        current.done++;
      }));
      await new Promise(r => setTimeout(r, 250)); // well inside TMDB's rate limit
    }
    current.running = false;
    console.log(`[services] Done — ${current.titles} title(s) put on streaming services`);
  })().catch(err => { current.running = false; current.error = err.message; });
  return job;
}

const autofillStatus = () => job || { running: false, done: 0, total: 0, titles: 0, assigned: 0, country: require('./ratings').country(), error: null };

const autofillAfterScans = () => db.prepare("SELECT value FROM config WHERE key = 'services_autofill_new'").get()?.value === 'true';

// After a scan: new titles' services, if the admin asked for that.
function afterScan() {
  if (autofillAfterScans()) autofill({ onlyNew: true });
}

module.exports = {
  BUILTIN, LOGO_DIR, all, publicService, customBanner, assignments, setTitleServices,
  servicesFromProviders, autofill, autofillStatus, autofillAfterScans, afterScan, logoAspect,
};
