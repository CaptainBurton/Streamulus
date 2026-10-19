// Age ratings by country. The admin picks a country (Admin › Settings › Region)
// and Streamulus uses its rating system everywhere: the certification fetched
// for each title, the choices in Edit Details, and how Streamlings' maximum age
// reads a rating ("A" is all ages in Spain but adults only in India).
const db = require('../database/db');

// [code, minimum age] — null age = not rated. Codes are as TMDB gives them.
// Entries marked { alias: true } are only for reading other spellings.
const SYSTEMS = {
  US: { name: 'United States',
    movie: [['G', 0], ['PG', 8], ['PG-13', 13], ['R', 17], ['NC-17', 18], ['NR', null]],
    tv: [['TV-Y', 0], ['TV-Y7', 7], ['TV-G', 0], ['TV-PG', 8], ['TV-14', 14], ['TV-MA', 17]] },
  GB: { name: 'United Kingdom',
    movie: [['U', 0], ['PG', 8], ['12A', 12], ['12', 12], ['15', 15], ['18', 18], ['R18', 18]],
    tv: [['U', 0], ['PG', 8], ['12', 12], ['15', 15], ['18', 18]] },
  AU: { name: 'Australia',
    movie: [['G', 0], ['PG', 8], ['M', 15], ['MA15+', 15], ['R18+', 18], ['X18+', 18]],
    tv: [['P', 0], ['C', 0], ['G', 0], ['PG', 8], ['M', 15], ['MA15+', 15], ['AV15+', 15], ['R18+', 18]] },
  CA: { name: 'Canada',
    movie: [['G', 0], ['PG', 8], ['14A', 14], ['18A', 18], ['R', 18], ['A', 18], ['13+', 13, { alias: true }], ['16+', 16, { alias: true }], ['18+', 18, { alias: true }]],
    tv: [['C', 0], ['C8', 8], ['G', 0], ['PG', 8], ['14+', 14], ['18+', 18]] },
  IE: { name: 'Ireland',
    movie: [['G', 0], ['PG', 8], ['12A', 12], ['15A', 15], ['16', 16], ['18', 18]],
    tv: [['GA', 0], ['Ch', 0], ['PG', 8], ['12', 12], ['15', 15], ['MA', 18], ['18', 18]] },
  NZ: { name: 'New Zealand',
    movie: [['G', 0], ['PG', 8], ['M', 16], ['R13', 13], ['RP13', 13], ['R15', 15], ['R16', 16], ['RP16', 16], ['R18', 18], ['RP18', 18], ['R', 18]],
    tv: [['G', 0], ['PGR', 8], ['AO', 16], ['16', 16], ['18', 18]] },
  DE: { name: 'Germany',
    movie: [['0', 0], ['6', 6], ['12', 12], ['16', 16], ['18', 18]],
    tv: [['0', 0], ['6', 6], ['12', 12], ['16', 16], ['18', 18]] },
  FR: { name: 'France',
    movie: [['TP', 0], ['U', 0, { alias: true }], ['10', 10], ['12', 12], ['16', 16], ['18', 18]],
    tv: [['TP', 0], ['10', 10], ['12', 12], ['16', 16], ['18', 18]] },
  ES: { name: 'Spain',
    movie: [['A', 0], ['Ai', 0], ['7', 7], ['12', 12], ['16', 16], ['18', 18], ['X', 18]],
    tv: [['TP', 0], ['7', 7], ['10', 10], ['12', 12], ['13', 13], ['16', 16], ['18', 18]] },
  IT: { name: 'Italy',
    movie: [['T', 0], ['6+', 6], ['14+', 14], ['18+', 18], ['VM14', 14], ['VM18', 18]],
    tv: [['T', 0], ['BA', 8], ['VM12', 12], ['VM14', 14], ['VM18', 18]] },
  NL: { name: 'Netherlands',
    movie: [['AL', 0], ['6', 6], ['9', 9], ['12', 12], ['14', 14], ['16', 16], ['18', 18]],
    tv: [['AL', 0], ['6', 6], ['9', 9], ['12', 12], ['14', 14], ['16', 16], ['18', 18]] },
  SE: { name: 'Sweden',
    movie: [['Btl', 0], ['7', 7], ['11', 11], ['15', 15]],
    tv: [['Btl', 0], ['7', 7], ['11', 11], ['15', 15]] },
  NO: { name: 'Norway',
    movie: [['A', 0], ['6', 6], ['9', 9], ['12', 12], ['15', 15], ['18', 18]],
    tv: [['A', 0], ['6', 6], ['9', 9], ['12', 12], ['15', 15], ['18', 18]] },
  DK: { name: 'Denmark',
    movie: [['A', 0], ['7', 7], ['11', 11], ['15', 15], ['F', 15]],
    tv: [['A', 0], ['7', 7], ['11', 11], ['15', 15]] },
  FI: { name: 'Finland',
    movie: [['S', 0], ['K-7', 7], ['K-12', 12], ['K-16', 16], ['K-18', 18], ['7', 7, { alias: true }], ['12', 12, { alias: true }], ['16', 16, { alias: true }], ['18', 18, { alias: true }]],
    tv: [['S', 0], ['K-7', 7], ['K-12', 12], ['K-16', 16], ['K-18', 18]] },
  JP: { name: 'Japan',
    movie: [['G', 0], ['PG12', 12], ['R15+', 15], ['R18+', 18]],
    tv: [['G', 0], ['PG12', 12], ['R15+', 15], ['R18+', 18]] },
  KR: { name: 'South Korea',
    movie: [['All', 0], ['12', 12], ['15', 15], ['18', 18], ['Restricted Screening', 18]],
    tv: [['All', 0], ['7', 7], ['12', 12], ['15', 15], ['19', 19]] },
  IN: { name: 'India',
    movie: [['U', 0], ['UA 7+', 7], ['UA', 12], ['UA 13+', 13], ['UA 16+', 16], ['A', 18], ['S', 18], ['U/A', 12, { alias: true }]],
    tv: [['U', 0], ['UA 7+', 7], ['UA', 12], ['UA 13+', 13], ['UA 16+', 16], ['A', 18]] },
  BR: { name: 'Brazil',
    movie: [['L', 0], ['10', 10], ['12', 12], ['14', 14], ['16', 16], ['18', 18]],
    tv: [['L', 0], ['10', 10], ['12', 12], ['14', 14], ['16', 16], ['18', 18]] },
  MX: { name: 'Mexico',
    movie: [['AA', 0], ['A', 0], ['B', 12], ['B15', 15], ['C', 18], ['D', 18]],
    tv: [['AA', 0], ['A', 0], ['B', 12], ['B15', 15], ['C', 18], ['D', 18]] },
  ZA: { name: 'South Africa',
    movie: [['A', 0], ['PG', 8], ['7-9PG', 9], ['10-12PG', 12], ['13', 13], ['16', 16], ['18', 18], ['X18', 18]],
    tv: [['A', 0], ['PG', 8], ['7-9PG', 9], ['10-12PG', 12], ['13', 13], ['16', 16], ['18', 18]] },
};

// Ratings with no number in them, for ones outside the country's system (e.g.
// a US rating used because the title has none for the chosen country). Ambiguous
// ones lean strict: a wrongly blocked title is safer for kids than a wrongly allowed one.
const LETTER_RATINGS = {
  G: 0, U: 0, UC: 0, 'TV-Y': 0, 'TV-G': 0, L: 0, AL: 0, ALL: 0, TP: 0, BTL: 0, S: 0, P: 0, AA: 0,
  PG: 8, 'TV-PG': 8,
  M: 15, MA: 15, B: 12,
  R: 17, 'TV-MA': 17,
  A: 18, C: 18, D: 18, X: 18, XXX: 18, 'NC-17': 18, R18: 18,
};
const UNRATED = new Set(['NR', 'UNRATED', 'NOT RATED', 'N/A', 'NA', 'APPROVED', 'PASSED', 'E', 'EXEMPT', '']);

// "MA 15+", "ma15+", "K–12" → one comparable form.
const key = (code) => String(code ?? '').toUpperCase().replace(/^FSK\s*/, '').replace(/[\s–—-]+/g, '');

const getConf = (k, d) => db.prepare('SELECT value FROM config WHERE key = ?').get(k)?.value ?? d;

function country() {
  const c = String(getConf('preferred_country', 'US')).toUpperCase();
  return SYSTEMS[c] ? c : 'US';
}

function lookup(system, rating) {
  const k = key(rating);
  for (const [code, age] of [...system.movie, ...system.tv]) {
    if (key(code) === k) return { age };
  }
  return null;
}

// Minimum suitable age for a rating, or null if unrated / unknown: read with the
// chosen country's system first, then the US one, then by its number or letters.
function ratingAge(rating, countryCode = country()) {
  if (rating == null) return null;
  const r = String(rating).trim();
  if (UNRATED.has(r.toUpperCase())) return null;
  const found = lookup(SYSTEMS[countryCode] || SYSTEMS.US, r) || lookup(SYSTEMS.US, r);
  if (found) return found.age;
  const upper = r.toUpperCase().replace(/^FSK\s*/, '');
  if (upper in LETTER_RATINGS) return LETTER_RATINGS[upper];
  const n = upper.match(/(\d{1,2})/); // TV-14 → 14, 12A → 12, MA15+ → 15, K-7 → 7
  return n ? parseInt(n[1], 10) : null;
}

const option = ([code, age]) => ({ code, age, label: age == null ? `${code} — not rated` : `${code} — ${age === 0 ? 'all ages' : `${age}+`}` });
const visible = (list) => list.filter(e => !e[2]?.alias).map(option);

// For Edit Details and the Settings page.
function systemFor(countryCode = country()) {
  const s = SYSTEMS[countryCode] || SYSTEMS.US;
  return { country: countryCode, name: s.name, movie: visible(s.movie), tv: visible(s.tv) };
}

const countries = () => Object.entries(SYSTEMS).map(([code, s]) => ({ code, name: s.name }))
  .sort((a, b) => a.name.localeCompare(b.name));

// Admin › Streamlings "Maximum age rating": each age with the country's ratings it adds.
function ageOptions(countryCode = country()) {
  const s = SYSTEMS[countryCode] || SYSTEMS.US;
  const entries = [...s.movie, ...s.tv].filter(e => !e[2]?.alias && e[1] != null && e[1] <= 16);
  const ages = [...new Set([0, 7, 8, 10, 12, 13, 14, 16, ...entries.map(e => e[1])])].filter(a => a <= 16).sort((a, b) => a - b);
  let previous = -1;
  return ages.map(age => {
    const adds = [...new Set(entries.filter(e => e[1] > previous && e[1] <= age).map(e => e[0]))];
    previous = age;
    const head = age === 0 ? 'All ages only' : `Up to ${age}`;
    return { value: age, label: adds.length ? `${head} (${age === 0 ? '' : 'adds '}${adds.join(', ')})` : head };
  });
}

// ── Keeping titles' ratings in the chosen country ────────────────────────────
// Each title remembers which country its rating was looked up for
// (rating_checked); titles not checked for the current one are looked up on TMDB
// in the background — after a scan, at start-up, and when the country changes.
// Details the admin edited (metadata_locked) are left alone.

let running = null;

async function refreshRatings({ all = false } = {}) {
  if (running) return running;
  running = (async () => {
    const tmdb = require('./tmdb');
    if (!tmdb.getApiKey()) return { checked: 0, changed: 0 };
    const c = country();
    const where = `metadata_locked = 0 AND tmdb_id IS NOT NULL${all ? '' : ' AND (rating_checked IS NULL OR rating_checked != ?)'}`;
    const args = all ? [] : [c];
    const jobs = [
      ...db.prepare(`SELECT id, tmdb_id, content_rating FROM movies WHERE ${where}`).all(...args).map(r => ({ ...r, table: 'movies', fetch: tmdb.getMovieCertification })),
      ...db.prepare(`SELECT id, tmdb_id, content_rating FROM tv_shows WHERE ${where}`).all(...args).map(r => ({ ...r, table: 'tv_shows', fetch: tmdb.getTVCertification })),
    ];
    if (!jobs.length) return { checked: 0, changed: 0 };
    console.log(`[ratings] Looking up ${c} age ratings for ${jobs.length} title(s)`);
    let changed = 0;
    for (let i = 0; i < jobs.length; i += 4) {
      if (country() !== c) break; // changed again — the next run takes over
      await Promise.all(jobs.slice(i, i + 4).map(async (job) => {
        const rating = await job.fetch(job.tmdb_id).catch(() => undefined);
        if (rating === undefined) return; // couldn't reach TMDB: try again next time
        // No certification anywhere: keep what we have (e.g. from OMDb).
        if (rating && rating !== job.content_rating) {
          db.prepare(`UPDATE ${job.table} SET content_rating = ?, rating_checked = ? WHERE id = ? AND metadata_locked = 0`).run(rating, c, job.id);
          changed++;
        } else {
          db.prepare(`UPDATE ${job.table} SET rating_checked = ? WHERE id = ?`).run(c, job.id);
        }
      }));
      await new Promise(r => setTimeout(r, 250)); // well inside TMDB's rate limit
    }
    console.log(`[ratings] Done — ${changed} rating(s) changed`);
    return { checked: jobs.length, changed };
  })().finally(() => { running = null; });
  return running;
}

// How many titles the next refresh would look up (for the Settings message).
function pendingCount() {
  const c = country();
  const q = (t) => db.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE metadata_locked = 0 AND tmdb_id IS NOT NULL AND (rating_checked IS NULL OR rating_checked != ?)`).get(c).n;
  return q('movies') + q('tv_shows');
}

module.exports = { SYSTEMS, country, ratingAge, systemFor, countries, ageOptions, refreshRatings, pendingCount };
