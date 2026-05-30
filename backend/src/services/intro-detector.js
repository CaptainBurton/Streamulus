const { spawn } = require('child_process');
const db = require('../database/db');

const ANALYSIS_SECS = 300;        // fingerprint first 5 minutes per episode
const MIN_INTRO_SECS = 15;        // intros must be at least 15 s
const MAX_INTRO_SECS = 180;       // intros can't exceed 3 min
const MAX_SEARCH_SECS = 240;      // search for intro in first 4 min
const MAX_BIT_ERROR = 0.30;       // accept match if ≤ 30% bits differ
const QUICK_REJECT_BITS = 11;     // fast-path reject for first item (>34% error)
const MAX_EPISODES_PER_SHOW = 8;  // compare at most 8 episodes per show

// Brian Kernighan popcount for a 32-bit uint
function popcount32(n) {
  n = n >>> 0;
  n -= (n >> 1) & 0x55555555;
  n = (n & 0x33333333) + ((n >> 2) & 0x33333333);
  n = (n + (n >> 4)) & 0x0f0f0f0f;
  return ((n * 0x01010101) >>> 24);
}

// Call fpcalc to generate a raw chromaprint fingerprint for the first ANALYSIS_SECS
// of a media file. Returns { items: Uint32Array, duration, rate } or null on failure.
function getFingerprint(filePath) {
  return new Promise((resolve) => {
    const proc = spawn('fpcalc', [
      '-raw', '-length', String(ANALYSIS_SECS), filePath,
    ], { stdio: ['ignore', 'pipe', 'ignore'] });

    let out = '';
    proc.stdout.on('data', d => { out += d; });
    proc.on('error', () => resolve(null));

    const timer = setTimeout(() => {
      try { proc.kill(); } catch {}
      resolve(null);
    }, 150_000);

    proc.on('exit', () => {
      clearTimeout(timer);
      const durMatch = out.match(/DURATION=([0-9.]+)/);
      const fpMatch  = out.match(/FINGERPRINT=([0-9,-]+)/);
      if (!durMatch || !fpMatch) return resolve(null);
      const duration = parseFloat(durMatch[1]);
      if (duration < MIN_INTRO_SECS) return resolve(null);
      const items = new Uint32Array(fpMatch[1].split(',').map(n => n >>> 0));
      resolve({ items, duration, rate: items.length / duration });
    });
  });
}

// Find the longest common audio segment between two fingerprints.
// Returns { startA, endA, startB, endB, score } or null.
function findCommonSegment(fpA, rateA, fpB, rateB) {
  const searchA = Math.min(fpA.length, Math.round(MAX_SEARCH_SECS * rateA));
  const searchB = Math.min(fpB.length, Math.round(MAX_SEARCH_SECS * rateB));
  const minLen  = Math.round(MIN_INTRO_SECS * rateA);
  const maxLen  = Math.round(MAX_INTRO_SECS * rateA);

  let bestErr = Infinity, bestA = -1, bestB = -1, bestLen = 0;

  for (let a = 0; a < searchA - minLen; a++) {
    const fa0 = fpA[a];
    for (let b = 0; b < searchB - minLen; b++) {
      // Quick reject: if the very first items differ by too many bits, skip.
      if (popcount32(fa0 ^ fpB[b]) > QUICK_REJECT_BITS) continue;

      // Extend the match forward
      let bits = 0;
      let len  = 0;
      const limit = Math.min(maxLen, fpA.length - a, fpB.length - b);
      while (len < limit) {
        bits += popcount32(fpA[a + len] ^ fpB[b + len]);
        len++;
        // Stop extending once error rate exceeds threshold (but not before minLen)
        if (len > minLen && bits / len / 32 > MAX_BIT_ERROR) break;
      }

      if (len >= minLen) {
        const errRate = bits / len / 32;
        if (errRate < bestErr) {
          bestErr = errRate; bestA = a; bestB = b; bestLen = len;
        }
      }
    }
  }

  if (bestA < 0 || bestErr > MAX_BIT_ERROR) return null;
  return {
    startA: bestA / rateA,
    endA: (bestA + bestLen) / rateA,
    startB: bestB / rateB,
    endB: (bestB + bestLen) / rateB,
    score: 1 - bestErr,
  };
}

// Detect the intro end time (seconds from start) for a single show.
// Returns an integer (seconds) or null if no intro was found.
async function detectShowIntro(showId, log) {
  const episodes = db.prepare(`
    SELECT id, file_path, season, episode_number
    FROM episodes WHERE show_id = ?
    ORDER BY season, episode_number
    LIMIT ?
  `).all(showId, MAX_EPISODES_PER_SHOW);

  if (episodes.length < 2) return null;

  log?.(`fingerprinting ${episodes.length} episodes`);

  const fps = [];
  for (const ep of episodes) {
    log?.(`  fingerprinting S${ep.season}E${ep.episode_number}`);
    const fp = await getFingerprint(ep.file_path);
    if (fp) fps.push({ ep, ...fp });
  }

  if (fps.length < 2) {
    log?.('  fewer than 2 fingerprints succeeded — skipping');
    return null;
  }

  log?.('  comparing fingerprints');

  const introEnds = [];
  for (let i = 0; i < fps.length - 1; i++) {
    for (let j = i + 1; j < fps.length; j++) {
      const A = fps[i], B = fps[j];
      const m = findCommonSegment(A.items, A.rate, B.items, B.rate);
      if (m) {
        log?.(`  E${A.ep.episode_number}↔E${B.ep.episode_number}: intro ends ~${m.endA.toFixed(0)}s / ${m.endB.toFixed(0)}s (score ${(m.score * 100).toFixed(0)}%)`);
        introEnds.push(m.endA, m.endB);
      }
    }
  }

  if (introEnds.length === 0) return null;

  introEnds.sort((a, b) => a - b);
  return Math.round(introEnds[Math.floor(introEnds.length / 2)]);
}

// Detect intros for all shows (or a single show if showId given).
// Calls onProgress({ show, index, total, msg?, done? }) as work progresses.
async function detectAllIntros(onProgress, { showId = null, force = false } = {}) {
  let shows;
  if (showId) {
    shows = db.prepare('SELECT id, title FROM tv_shows WHERE id = ?').all(showId);
  } else if (force) {
    shows = db.prepare('SELECT id, title FROM tv_shows').all();
  } else {
    shows = db.prepare('SELECT id, title FROM tv_shows WHERE intro_end_time IS NULL').all();
  }

  let done = 0;
  const total = shows.length;

  for (const show of shows) {
    onProgress?.({ type: 'show_start', show: show.title, index: done, total });
    try {
      const introEnd = await detectShowIntro(show.id, (msg) => {
        onProgress?.({ type: 'msg', show: show.title, msg, index: done, total });
      });
      if (introEnd !== null) {
        db.prepare('UPDATE tv_shows SET intro_end_time = ? WHERE id = ?').run(introEnd, show.id);
        onProgress?.({ type: 'show_done', show: show.title, introEnd, index: done, total });
      } else {
        onProgress?.({ type: 'show_done', show: show.title, introEnd: null, index: done, total });
      }
    } catch (e) {
      console.error(`[intro] "${show.title}": ${e.message}`);
      onProgress?.({ type: 'show_error', show: show.title, message: e.message, index: done, total });
    }
    done++;
  }

  onProgress?.({ type: 'complete', total });
}

module.exports = { detectAllIntros, detectShowIntro };
