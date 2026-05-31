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
const LOOKAHEAD_CHUNKS  = 3;     // after 3 bad chunks, peek 9s ahead before stopping
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
// Returns { start, end } seconds if a reliable chapter marker is found, else null.
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
        const named = chapters.find(c =>
          /^(intro|opening|op|prologue|cold\s?open|pre[\s-]?credits)/i.test(c.tags?.title || '')
        );
        if (named) return resolve({
          start: Math.round(parseFloat(named.start_time)),
          end:   Math.round(parseFloat(named.end_time)),
        });
        if (chapters.length >= 2) {
          const start = Math.round(parseFloat(chapters[0].start_time));
          const end   = Math.round(parseFloat(chapters[0].end_time));
          if (end >= MIN_INTRO_SECS && end <= MAX_INTRO_SECS) return resolve({ start, end });
        }
      } catch {}
      resolve(null);
    });
  });
}

// ── AV boundary refinement ───────────────────────────────────────────────────
// Scans a ±WINDOW_SEC window around the fingerprint estimate for black frames
// and audio silences using FFmpeg filters. Snaps the intro end to the nearest
// real AV transition, which is more accurate than the fingerprint boundary alone.
//
// Uses output seeking (-i file, then -ss) so timestamps are absolute file time.
function refineIntroEnd(filePath, estimatedEnd, log) {
  const WINDOW_SEC = 20;
  const seekTo  = Math.max(0, estimatedEnd - WINDOW_SEC);
  const scanSec = WINDOW_SEC * 2 + 5;

  return new Promise((resolve) => {
    const proc = spawn('ffmpeg', [
      '-i', filePath,
      '-ss', String(seekTo), '-t', String(scanSec),
      '-vf', 'blackdetect=d=0.05:pix_th=0.10',
      '-af', 'silencedetect=n=-40dB:d=0.25',
      '-f', 'null', '-',
    ], { stdio: ['ignore', 'ignore', 'pipe'] });

    let stderr = '';
    proc.stderr.on('data', d => { stderr += d; });
    proc.on('error', () => resolve(null));
    const timer = setTimeout(() => { try { proc.kill(); } catch {} resolve(null); }, 60_000);

    proc.on('exit', () => {
      clearTimeout(timer);
      const transitions = [];

      // black_end = screen clears → new content begins
      for (const m of stderr.matchAll(/black_end:([0-9.]+)/g))
        transitions.push(parseFloat(m[1]));
      // silence_end = audio resumes → new content begins
      for (const m of stderr.matchAll(/silence_end:\s*([0-9.]+)/g))
        transitions.push(parseFloat(m[1]));

      if (transitions.length === 0) return resolve(null);

      // Pick the transition closest to the fingerprint estimate
      let best = null, bestDist = Infinity;
      for (const t of transitions) {
        const d = Math.abs(t - estimatedEnd);
        if (d < bestDist) { bestDist = d; best = t; }
      }

      if (best !== null && bestDist <= WINDOW_SEC) {
        const delta = (best - estimatedEnd).toFixed(1);
        log?.(`  AV boundary snap: ${estimatedEnd}s → ${Math.round(best)}s (${best > estimatedEnd ? '+' : ''}${delta}s)`);
        resolve(Math.round(best));
      } else {
        resolve(null);
      }
    });
  });
}

// ── Two-phase fingerprint comparison ─────────────────────────────────────────
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
      if (popcount32(fa0 ^ fpB[b]) > QUICK_REJECT_BITS) continue;
      let bits = 0;
      for (let k = 0; k < probeLen; k++) bits += popcount32(fpA[a + k] ^ fpB[b + k]);
      const err = bits / probeLen / 32;
      if (err < bestErr) { bestErr = err; bestA = a; bestB = b; }
    }
  }

  if (bestA < 0 || bestErr > ALIGN_THRESHOLD) return null;

  // ── Phase 2 ──────────────────────────────────────────────────────────────
  // Walk forward in CHUNK_SECS increments. After 3 consecutive bad chunks,
  // peek LOOKAHEAD_CHUNKS ahead — a short dialogue burst won't end detection
  // prematurely. AV boundary refinement (above) handles remaining fine-tuning.
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
    const err = bits / chunkLen / 32;

    if (err > END_THRESHOLD) {
      consecutiveMisses++;
      if (consecutiveMisses >= 3) {
        // Look ahead briefly before stopping (handles short talking sections)
        let recovers = false;
        let la = a + chunkLen, lb = b + chunkLen;
        for (let p = 0; p < LOOKAHEAD_CHUNKS; p++) {
          if (la + chunkLen > fpA.length || lb + chunkLen > fpB.length || la - bestA >= maxWalkLen) break;
          let lBits = 0;
          for (let k = 0; k < chunkLen; k++) lBits += popcount32(fpA[la + k] ^ fpB[lb + k]);
          if (lBits / chunkLen / 32 <= END_THRESHOLD) { recovers = true; break; }
          la += chunkLen; lb += chunkLen;
        }
        if (!recovers) break;
      }
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
// Returns { introStart, introEnd } in seconds, or null if no intro found.
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
    const ends = chapterTimes.map(t => t.end);
    const minEnd = Math.min(...ends), maxEnd = Math.max(...ends);
    if (maxEnd - minEnd <= 5) {
      const introEnd   = Math.round((minEnd + maxEnd) / 2);
      const introStart = Math.round(chapterTimes.reduce((s, t) => s + t.start, 0) / chapterTimes.length);
      log?.(`chapters agree: intro ${introStart}s–${introEnd}s`);
      return { introStart, introEnd };
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
  const introEnds   = [];
  const introStarts = [];
  for (let i = 0; i < fps.length - 1; i++) {
    for (let j = i + 1; j < fps.length; j++) {
      const A = fps[i], B = fps[j];
      const m = findCommonSegment(A.items, A.rate, B.items, B.rate);
      if (m) {
        log?.(`  E${A.ep.episode_number}↔E${B.ep.episode_number}: ${m.startA.toFixed(0)}–${m.endA.toFixed(0)}s (score ${(m.score*100).toFixed(0)}%)`);
        introEnds.push(m.endA, m.endB);
        introStarts.push(m.startA, m.startB);
      } else {
        log?.(`  E${A.ep.episode_number}↔E${B.ep.episode_number}: no match`);
      }
      await new Promise(r => setImmediate(r));
    }
  }

  if (introEnds.length === 0) { log?.('  no common segment found'); return null; }

  introEnds.sort((a, b) => a - b);
  introStarts.sort((a, b) => a - b);
  let introEnd     = Math.round(introEnds[Math.floor(introEnds.length / 2)]);
  const introStart = Math.round(introStarts[Math.floor(introStarts.length / 2)]);

  // Refine end time using black-frame and audio-silence boundary detection.
  // Fingerprinting gives a good ballpark; AV detection snaps to the exact cut point.
  log?.(`  fingerprint estimate: ${introStart}s–${introEnd}s — refining with AV boundary detection`);
  const refined = await refineIntroEnd(fps[0].ep.file_path, introEnd, log);
  if (refined !== null) introEnd = refined;

  log?.(`  → intro ${introStart}s–${introEnd}s`);
  return { introStart, introEnd };
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
    let result = null;
    let errMsg = null;
    try {
      result = await detectShowIntro(show.id, (msg) =>
        onProgress?.({ type: 'msg', show: show.title, msg, index: done, total })
      );
      if (result !== null) {
        db.prepare('UPDATE tv_shows SET intro_start_time = ?, intro_end_time = ? WHERE id = ?')
          .run(result.introStart, result.introEnd, show.id);
      }
    } catch (e) {
      errMsg = e.message;
      console.error(`[intro] "${show.title}": ${e.stack || e.message}`);
    }
    done++;
    onProgress?.({
      type: errMsg ? 'show_error' : 'show_done',
      show: show.title, introEnd: result?.introEnd ?? null, message: errMsg, index: done, total,
    });
    await new Promise(r => setImmediate(r));
  }

  onProgress?.({ type: 'complete', total });
}

module.exports = { detectAllIntros, detectShowIntro };
