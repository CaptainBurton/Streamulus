// WebVTT → cues, for the player's own subtitle overlay. Cue times are the
// video file's own times, so the player looks them up by the absolute position
// (stream start + currentTime), which stays right after seeks restart the stream.

const toSeconds = (stamp) => {
  const parts = stamp.trim().split(':').map(Number);
  return parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts[0] * 60 + parts[1];
};

// Formatting tags become plain text; <i> is kept as an italic flag per line.
const clean = (line) => line
  .replace(/<\/?(?!i>)[^>]+>/g, '')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ');

export function parseVtt(text) {
  const cues = [];
  const blocks = String(text || '').replace(/\r\n?/g, '\n').split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.split('\n');
    const at = lines.findIndex(l => l.includes('-->'));
    if (at < 0) continue;
    const [from, rest] = lines[at].split('-->');
    const to = rest.trim().split(/\s+/)[0];
    const start = toSeconds(from), end = toSeconds(to);
    const body = lines.slice(at + 1).map(clean).filter(l => l.trim());
    if (!body.length || !(end > start)) continue;
    cues.push({ start, end, lines: body });
  }
  return cues.sort((a, b) => a.start - b.start);
}

// Lines of every cue showing at `time` (overlapping cues are stacked).
export function linesAt(cues, time) {
  if (!cues.length) return [];
  let lo = 0, hi = cues.length - 1, first = cues.length;
  while (lo <= hi) { // first cue that starts after `time`
    const mid = (lo + hi) >> 1;
    if (cues[mid].start > time) { first = mid; hi = mid - 1; } else lo = mid + 1;
  }
  const out = [];
  for (let i = first - 1; i >= 0 && i >= first - 8; i--) {
    if (cues[i].end > time) out.unshift(...cues[i].lines);
  }
  return out;
}
