const { spawn } = require('child_process');
const db = require('../database/db');

// ── Constants ────────────────────────────────────────────────────────────────
const ANALYSIS_SECS     = 360;   // fingerprint first 6 minutes per episode
const MIN_INTRO_SECS    = 20;    // intro must be at least 20 s
const MAX_INTRO_SECS    = 150;   // intro can't exceed 2.5 min
const MAX_SEARCH_SECS   = 240;   // search within first 4 minutes
const PROBE_SECS        = 10;    // Phase-1 probe window length
const CHUNK_SECS        = 3;     // Phase-2 chunk size for end detection
const ALIGN_THRESHOLD   = 0.15;  // Phase-1: ≤15% bit error = good alignment
const END_THRESHOLD     = 0.35;  // Phase-2: >35% bit error in a chunk = past intro
const QUICK_REJECT_BITS = 9;     // fast reject if first item has >9 differing bits (~28%)
const MAX_EPISODES      = 8;

// ── Helpers ──────────────────────────────────────────────────────────────────
function popcount32(n) {
  n = n >>> 0;
  n -= (n >> 1) & 0x55555555;
  n = (n & 0x33333333) + ((n >> 2) & 0x33333333);
  n = (n + (n >> 4)) & 0x0f0f0f0f;
  return ((n * 0x01010101) >>> 24);
}

// ── Fingerprinting ───────────────────────────────────────────────────────────
function getFingerprint(filePath) {
  return new Promise((resolve) => {
    const proc = spawn('fpcalc', ['-raw', '-length', String(ANALYSIS_SECS), filePath],
      { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    proc.stdout.on('data', d => { out += d; });
    proc.on('error', () => resolve(null));
    const timer = setTimeout(() => { try { proc.kill(); } catch {} resolve(null); }, 150_000);
    proc.on('exit', () => {
      clearTimeout(timer);
      const durMatch = out.match(/DURATION=([0-9.]+)/);
      const fpMatch  = out.match(/FINGERPRINT=(-?[0-9]+(?:,-?[0-9]+)*)/);
      if (!durMatch || !fpMatch) return resolve(null);
      const duration = parseFloat(durMatch[1]);
      if (duration < MIN_INTRO_SECS) return resolve(null);
      const items = new Uint32Array(fpMatch[1].split(',').map(n => parseInt(n, 10) >>> 0));
      if (items.length < 50) return resolve(null);
      resolve({ items, duration, rate: items.length / duration });
    });
  });
}

// ── Chapter-based detection ──────────────────────────────────────────────────
// Many MKV/MP4 files embed chapter markers. If a chapter is named "Intro",
// "Opening", etc., or if the first chapter ends in the 20-150 s range and
// all queried episodes agree, we can use that directly — no fingerprinting.
function getChapterIntroEnd(filePath) {
  return new Promise((resolve) => {
    const proc = spawn('ffprobe', [
      '-v', 'quiet', '-print_format', 'json', '-show_chapters', filePath,
    ], { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    proc.stdout.on('data', d => { out += d; });
    proc.on('error', () => resolve(null));
    const timer = setTimeout(() => { try { proc.kill(); } catch {} resolve(null); }, 30_000);
    proc.on('exit', () => {
      clearTimeout(timer);
      try {
        const chapters = JSON.parse(out).chapters || [];
        // Explicitly named intro chapter
        const named = chapters.find(c =>
          /^(intro|opening|op|prologue|cold\s?open|pre[\s-]?credits)/i.test(c.tags?.title || '')
        );
        if (named) return resolve(Math.round(parseFloat(named.end_time)));
        // First chapter in intro-length range, with a second chapter following it
        if (chapters.length >= 2) {
          const t = parseFloat(chapters[0].end_time);
          if (t >= MIN_INTRO_SECS && t <= MAX_INTRO_SECS) return resolve(Math.round(t));
        }
      } catch {}
      resolve(null);
    });
  });
}

// ── Two-phase fingerprint comparison ─────────────────────────────────────────
//
// Phase 1 — alignment: slide a short (PROBE_SECS) probe window across both
//   fingerprints to find the position where the two best agree. The quick-reject
//   check on the first item skips >90 % of pairs in O(1).
//
// Phase 2 — end detection: from the aligned position walk forward in CHUNK_SECS
//   increments, stopping the MOMENT a chunk's error rate exceeds END_THRESHOLD.
//   This gives the precise intro boundary rather than a blurry average.
function findCommonSegment(fpA, rateA, fpB, rateB) {
  const searchA  = Math.min(fpA.length, Math.round(MAX_SEARCH_SECS * rateA));
  const searchB  = Math.min(fpB.length, Math.round(MAX_SEARCH_SECS * rateB));
  const probeLen = Math.round(PROBE_SECS  * rateA);
  const chunkLen = Math.round(CHUNK_SECS  * rateA);
  const minTotalLen = Math.round(MIN_INTRO_SECS * rateA);
  const maxWalkLen  = Math.round(MAX_INTRO_SECS * rateA);

  if (probeLen < 2 || chunkLen < 1) return null;

  // ── Phase 1 ──────────────────────────────────────────────────────────────
  let bestErr = Infinity, bestA = -1, bestB = -1;

  for (let a = 0; a < searchA - probeLen; a++) {
    const fa0 = fpA[a];
    for (let b = 0; b < searchB - probeLen; b++) {
      // O(1) quick reject
      if (popcount32(fa0 ^ fpB[b]) > QUICK_REJECT_BITS) continue;
      let bits = 0;
      for (let k = 0; k < probeLen; k++) bits += popcount32(fpA[a + k] ^ fpB[b + k]);
      const err = bits / probeLen / 32;
      if (err < bestErr) { bestErr = err; bestA = a; bestB = b; }
    }
  }

  if (bestA < 0 || bestErr > ALIGN_THRESHOLD) return null;

  // ── Phase 2 ──────────────────────────────────────────────────────────────
  // Start walking from just after the probe window.
  // Require 2 consecutive bad chunks before declaring the intro over.
  // A single bad chunk can be a momentary variation (sound effect, compression
  // difference) that still belongs to the intro — two in a row means we're
  // definitely into the unique main content.
  let a = bestA + probeLen, b = bestB + probeLen;
  let endA = a, endB = b;
  let consecutiveMisses = 0;

  while (
    a + chunkLen <= fpA.length &&
    b + chunkLen <= fpB.length &&
    a - bestA < maxWalkLen
  ) {
    let bits = 0;
    for (let k = 0; k < chunkLen; k++) bits += popcount32(fpA[a + k] ^ fpB[b + k]);
    const chunkErr = bits / chunkLen / 32;

    if (chunkErr > END_THRESHOLD) {
      consecutiveMisses++;
      if (consecutiveMisses >= 3) break; // three bad chunks in a row = past intro
    } else {
      consecutiveMisses = 0;
      endA = a + chunkLen;
      endB = b + chunkLen;
    }
    a += chunkLen;
    b += chunkLen;
  }

  if (endA - bestA < minTotalLen) return null;

  return {
    startA: bestA / rateA,
    endA:   endA  / rateA,
    startB: bestB / rateB,
    endB:   endB  / rateB,
    score:  1 - bestErr,
  };
}

// ── Per-show detection ────────────────────────────────────────────────────────
async function detectShowIntro(showId, log) {
  const episodes = db.prepare(`
    SELECT id, file_path, season, episode_number
    FROM episodes WHERE show_id = ?
    ORDER BY season, episode_number LIMIT ?
  `).all(showId, MAX_EPISODES);

  if (episodes.length < 2) return null;

  // Fast path: chapter markers
  log?.('checking chapter markers');
  const chapterTimes = [];
  for (const ep of episodes.slice(0, Math.min(3, episodes.length))) {
    const t = await getChapterIntroEnd(ep.file_path);
    if (t != null) chapterTimes.push(t);
  }
  if (chapterTimes.length >= 2) {
    const min = Math.min(...chapterTimes), max = Math.max(...chapterTimes);
    if (max - min <= 5) {
      const t = Math.round((min + max) / 2);
      log?.(`chapters agree: intro ends at ${t}s`);
      return t;
    }
  }

  // Slow path: audio fingerprinting
  log?.(`fingerprinting ${episodes.length} episodes`);
  const fps = [];
  for (const ep of episodes) {
    log?.(`  S${ep.season}E${String(ep.episode_number).padStart(2,'0')} — fingerprinting`);
    const fp = await getFingerprint(ep.file_path);
    if (fp) fps.push({ ep, ...fp });
    else log?.(`  S${ep.season}E${String(ep.episode_number).padStart(2,'0')} — failed (fpcalc missing or unreadable file)`);
  }

  if (fps.length < 2) { log?.('  not enough fingerprints'); return null; }

  log?.('  comparing pairs');
  const introEnds = [];
  for (let i = 0; i < fps.length - 1; i++) {
    for (let j = i + 1; j < fps.length; j++) {
      const A = fps[i], B = fps[j];
      const m = findCommonSegment(A.items, A.rate, B.items, B.rate);
      if (m) {
        log?.(`  E${A.ep.episode_number}↔E${B.ep.episode_number}: ${m.startA.toFixed(0)}–${m.endA.toFixed(0)}s (score ${(m.score*100).toFixed(0)}%)`);
        introEnds.push(m.endA, m.endB);
      } else {
        log?.(`  E${A.ep.episode_number}↔E${B.ep.episode_number}: no match`);
      }
      // Yield after each pair so SSE keepalive can flush and the show loop continues
      await new Promise(r => setImmediate(r));
    }
  }

  if (introEnds.length === 0) { log?.('  no common segment found'); return null; }

  introEnds.sort((a, b) => a - b);
  const result = Math.round(introEnds[Math.floor(introEnds.length / 2)]);
  log?.(`  → intro ends at ${result}s`);
  return result;
}

// ── Entry point ───────────────────────────────────────────────────────────────
async function detectAllIntros(onProgress, { showId = null, force = false } = {}) {
  let shows;
  if (showId) {
    shows = db.prepare('SELECT id, title FROM tv_shows WHERE id = ?').all(showId);
  } else if (force) {
    shows = db.prepare('SELECT id, title FROM tv_shows ORDER BY title').all();
  } else {
    shows = db.prepare('SELECT id, title FROM tv_shows WHERE intro_end_time IS NULL ORDER BY title').all();
  }

  let done = 0;
  const total = shows.length;

  for (const show of shows) {
    onProgress?.({ type: 'show_start', show: show.title, index: done, total });
    let introEnd = null;
    let errMsg = null;
    try {
      introEnd = await detectShowIntro(show.id, (msg) =>
        onProgress?.({ type: 'msg', show: show.title, msg, index: done, total })
      );
      if (introEnd !== null) {
        db.prepare('UPDATE tv_shows SET intro_end_time = ? WHERE id = ?').run(introEnd, show.id);
      }
    } catch (e) {
      errMsg = e.message;
      console.error(`[intro] "${show.title}": ${e.stack || e.message}`);
    }
    done++;
    onProgress?.({
      type: errMsg ? 'show_error' : 'show_done',
      show: show.title, introEnd, message: errMsg, index: done, total,
    });
    // Yield between shows so the event loop can flush pending SSE writes
    await new Promise(r => setImmediate(r));
  }

  onProgress?.({ type: 'complete', total });
}

module.exports = { detectAllIntros, detectShowIntro };
