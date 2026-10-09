// "Show titles in English" (per profile). Rows keep their original title /
// overview; English versions live in title_en / overview_en (filled in by
// services/english.js). authenticate() runs each request inside a context that
// knows the profile's choice, and every JSON response is passed through
// localize(): for any `X_en` key with a value, `X` is replaced when the
// profile wants English, and the `_en` keys are dropped either way.
const { AsyncLocalStorage } = require('async_hooks');

const context = new AsyncLocalStorage();

const wantsEnglish = () => !!context.getStore()?.english;

// row[key], or its English version for profiles that want English.
function pick(row, key) {
  const en = row?.[`${key}_en`];
  return wantsEnglish() && en ? en : row?.[key];
}

function localize(value, english, depth = 0) {
  if (depth > 12 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(v => localize(v, english, depth + 1));
  if (Object.getPrototypeOf(value) !== Object.prototype) return value; // Dates, Buffers…
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (k.endsWith('_en') && k.length > 3 && (typeof v === 'string' || v === null)) continue;
    out[k] = localize(v, english, depth + 1);
  }
  if (english) {
    for (const [k, v] of Object.entries(value)) {
      if (k.endsWith('_en') && typeof v === 'string' && v && k.slice(0, -3) in value) out[k.slice(0, -3)] = v;
    }
  }
  return out;
}

// Called by authenticate(): remember the choice and localize res.json bodies.
function run(req, res, next) {
  const english = !!req.profile?.english_titles;
  if (!res._localized) {
    res._localized = true;
    const json = res.json.bind(res);
    res.json = (body) => json(localize(body, english));
  }
  context.run({ english }, next);
}

module.exports = { run, pick, wantsEnglish, localize };
