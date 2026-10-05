// Subtitles: text subtitle streams inside the video file plus sidecar files next
// to it (Movie.en.srt, Movie.English.forced.srt, Movie.vtt, Movie.ass…), served
// to the players as WebVTT. Image subtitles (Blu-ray PGS, DVD VobSub) can't be
// turned into text, so they aren't listed.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const CACHE_DIR = path.join(process.env.DATA_DIR || '/data', 'cache', 'subtitles');
fs.mkdirSync(CACHE_DIR, { recursive: true });

const TEXT_CODECS = new Set(['subrip', 'srt', 'ass', 'ssa', 'webvtt', 'mov_text', 'text', 'microdvd', 'subviewer', 'subviewer1', 'sami', 'realtext', 'stl', 'jacosub', 'mpl2', 'pjs', 'vplayer']);
const SIDECAR_EXTS = new Set(['.srt', '.vtt', '.ass', '.ssa']);

// ISO 639-2 (three-letter, as in MKV tags) → 639-1 for display names.
const ISO3 = {
  eng: 'en', spa: 'es', fre: 'fr', fra: 'fr', ger: 'de', deu: 'de', ita: 'it', por: 'pt', jpn: 'ja', kor: 'ko',
  chi: 'zh', zho: 'zh', rus: 'ru', ara: 'ar', hin: 'hi', dut: 'nl', nld: 'nl', swe: 'sv', nor: 'no', nob: 'nb',
  dan: 'da', fin: 'fi', pol: 'pl', tur: 'tr', gre: 'el', ell: 'el', heb: 'he', cze: 'cs', ces: 'cs', hun: 'hu',
  rum: 'ro', ron: 'ro', tha: 'th', vie: 'vi', ind: 'id', ukr: 'uk', may: 'ms', msa: 'ms', bul: 'bg', hrv: 'hr',
  srp: 'sr', slv: 'sl', slo: 'sk', slk: 'sk', ice: 'is', isl: 'is', est: 'et', lav: 'lv', lit: 'lt', per: 'fa',
  fas: 'fa', cat: 'ca', glg: 'gl', baq: 'eu', eus: 'eu', fil: 'fil', tgl: 'tl', tam: 'ta', tel: 'te', ben: 'bn',
};
const displayNames = (() => { try { return new Intl.DisplayNames(['en'], { type: 'language' }); } catch { return null; } })();

// "en", "eng", "English", "pt-BR" → { code: 'en', name: 'English' } (or null if it isn't a language).
function language(token) {
  if (!token) return null;
  const t = String(token).trim();
  const lower = t.toLowerCase();
  if (lower === 'und' || lower === 'unknown') return null;
  let code = ISO3[lower] || (/^[a-z]{2}(-[a-z]{2,4})?$/i.test(t) ? t : null);
  if (code) {
    const name = displayNames?.of(code);
    if (name && name.toLowerCase() !== code.toLowerCase()) return { code: code.toLowerCase(), name };
  }
  // A full name in the file name, e.g. "Movie.English.srt".
  if (displayNames && /^[a-z]{4,}$/i.test(t)) {
    for (const c of new Set(Object.values(ISO3))) {
      if (displayNames.of(c)?.toLowerCase() === lower) return { code: c, name: displayNames.of(c) };
    }
  }
  return null;
}

function probeSubtitleStreams(filePath) {
  return new Promise((resolve) => {
    const proc = spawn('ffprobe', ['-v', 'quiet', '-print_format', 'json', '-show_streams', '-select_streams', 's', filePath],
      { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    proc.stdout.on('data', d => { out += d; });
    proc.on('error', () => resolve([]));
    proc.on('exit', () => { try { resolve(JSON.parse(out).streams || []); } catch { resolve([]); } });
  });
}

function sidecarFiles(filePath) {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath, path.extname(filePath));
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return []; }
  return names
    .filter(n => SIDECAR_EXTS.has(path.extname(n).toLowerCase()))
    .filter(n => {
      const stem = n.slice(0, -path.extname(n).length);
      return stem === base || stem.startsWith(base + '.');
    })
    .sort();
}

const trackId = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 12);

// [{ id, label, language, forced, default, source: 'embedded'|'external', codec }]
async function listTracks(filePath) {
  const tracks = [];
  for (const s of await probeSubtitleStreams(filePath)) {
    if (!TEXT_CODECS.has(s.codec_name)) continue;
    const lang = language(s.tags?.language);
    const title = s.tags?.title || '';
    const forced = !!s.disposition?.forced || /forced/i.test(title);
    const sdh = !!s.disposition?.hearing_impaired || /\b(sdh|cc|hearing)\b/i.test(title);
    // A title that only says "SDH" / "Forced" is covered by the suffixes below.
    const extra = title && !/^\s*(forced|sdh|cc)\s*$/i.test(title) ? title : null;
    tracks.push({
      id: `e${s.index}`,
      language: lang?.code || null,
      label: [lang?.name || extra || `Track ${tracks.length + 1}`, lang ? extra : null].filter(Boolean).join(' · ')
        + (forced ? ' (Forced)' : '') + (sdh ? ' SDH' : ''),
      forced, default: !!s.disposition?.default, source: 'embedded', codec: s.codec_name,
    });
  }
  const base = path.basename(filePath, path.extname(filePath));
  for (const name of sidecarFiles(filePath)) {
    const stem = name.slice(0, -path.extname(name).length);
    const tokens = stem.slice(base.length).split('.').filter(Boolean);
    const lang = tokens.map(language).find(Boolean) || null;
    const forced = tokens.some(t => /^forced$/i.test(t));
    const sdh = tokens.some(t => /^(sdh|cc|hi)$/i.test(t));
    tracks.push({
      id: `x${trackId(name)}`,
      language: lang?.code || null,
      label: `${lang?.name || 'Unknown'}${forced ? ' (Forced)' : ''}${sdh ? ' SDH' : ''} · ${path.extname(name).slice(1).toUpperCase()} file`,
      forced, default: false, source: 'external', codec: path.extname(name).slice(1).toLowerCase(), file: name,
    });
  }
  return tracks;
}

// Sidecar files as text: UTF-8 (with or without BOM / UTF-16 BOM), or — for
// older SRTs — Windows-1252. Decoded here rather than with FFmpeg's
// -sub_charenc, which some FFmpeg builds lack or crash on.
function decodeText(buf) {
  if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf.subarray(2));
  if (buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder('utf-16be').decode(buf.subarray(2));
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^\uFEFF/, ''); } catch {}
  return new TextDecoder('windows-1252').decode(buf);
}

// SRT → WebVTT: drop the cue numbers, use "." in times, remove {\an8}-style tags.
function srtToVtt(text) {
  const blocks = text.replace(/\r\n?/g, '\n').trim().split(/\n{2,}/);
  const cues = [];
  for (const block of blocks) {
    const lines = block.split('\n');
    const timeAt = lines.findIndex(l => l.includes('-->'));
    if (timeAt < 0) continue;
    const time = lines[timeAt].replace(/(\d+:\d{2}:\d{2}),(\d{1,3})/g, '$1.$2').replace(/(\d{2}:\d{2}),(\d{1,3})/g, '$1.$2');
    const body = lines.slice(timeAt + 1).map(l => l.replace(/\{\\[^}]*\}/g, '')).join('\n').trim();
    if (body) cues.push(`${time}\n${body}`);
  }
  return `WEBVTT\n\n${cues.join('\n\n')}\n`;
}

function ffmpegToVtt(args, input) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args, { stdio: [input == null ? 'ignore' : 'pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    const timer = setTimeout(() => { proc.kill('SIGKILL'); reject(new Error('Timed out reading subtitles')); }, 10 * 60 * 1000);
    proc.stdout.on('data', d => { out += d; });
    proc.stderr.on('data', d => { err += d; });
    proc.on('error', e => { clearTimeout(timer); reject(e); });
    proc.on('exit', (code, signal) => {
      clearTimeout(timer);
      if (code === 0 && out.startsWith('WEBVTT')) resolve(out);
      else reject(new Error(`Could not convert subtitles: ${err.trim().split('\n').pop() || (signal ? `ffmpeg ${signal}` : `ffmpeg exit ${code}`)}`));
    });
    if (input != null) { proc.stdin.on('error', () => {}); proc.stdin.end(input); }
  });
}

const inFlight = new Map();

// WebVTT text for a track, converted once and cached (extracting from inside a
// big file means reading all of it, so the first time can take a while).
async function getVtt(filePath, track) {
  const stat = fs.statSync(filePath);
  const source = track.source === 'external' ? path.join(path.dirname(filePath), track.file) : filePath;
  const sourceStat = track.source === 'external' ? fs.statSync(source) : stat;
  const key = crypto.createHash('sha1').update(`${source}:${track.id}:${sourceStat.size}:${sourceStat.mtimeMs}`).digest('hex');
  const cachePath = path.join(CACHE_DIR, `${key}.vtt`);
  if (fs.existsSync(cachePath)) return fs.readFileSync(cachePath, 'utf8');
  if (inFlight.has(key)) return inFlight.get(key);

  const job = (async () => {
    let vtt;
    if (track.source === 'external') {
      const text = decodeText(fs.readFileSync(source));
      if (track.codec === 'vtt') vtt = text.startsWith('WEBVTT') ? text : `WEBVTT\n\n${text}`;
      else if (track.codec === 'srt') vtt = srtToVtt(text);
      else vtt = await ffmpegToVtt(['-v', 'error', '-f', track.codec, '-i', 'pipe:0', '-f', 'webvtt', '-'], text); // ASS/SSA
    } else {
      vtt = await ffmpegToVtt(['-v', 'error', '-i', source, '-map', `0:${track.id.slice(1)}`, '-f', 'webvtt', '-'], null);
    }
    fs.writeFileSync(cachePath, vtt);
    return vtt;
  })();
  inFlight.set(key, job);
  try { return await job; } finally { inFlight.delete(key); }
}

module.exports = { listTracks, getVtt, language };
