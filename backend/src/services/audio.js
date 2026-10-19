// Audio tracks: files with more than one (anime with Japanese and English, films
// with a commentary…) let the viewer choose which to hear. A choice is remembered
// per title for each profile (for a show, every episode), and each profile can
// set the language it prefers: "Original language" plays anime in Japanese,
// "English" plays the dub wherever there is one.
const fs = require('fs');
const db = require('../database/db');
const { probeFile } = require('./transcoder');
const { language } = require('./subtitles');

// Choices for a profile's Audio language setting.
const LANGUAGE_CHOICES = ['default', 'original', 'en', 'ja', 'es', 'fr', 'de', 'it', 'pt', 'ko', 'zh', 'hi', 'ru'];
const VALID_LANGUAGE = /^(default|original|[a-z]{2,3}(-[a-z0-9]{2,8})?)$/i;

const CHANNELS = { 1: 'Mono', 2: 'Stereo', 3: '2.1', 6: '5.1', 7: '6.1', 8: '7.1' };
const CODECS = { aac: 'AAC', ac3: 'Dolby Digital', eac3: 'Dolby Digital Plus', truehd: 'Dolby TrueHD', dts: 'DTS', flac: 'FLAC', opus: 'Opus', mp3: 'MP3', vorbis: 'Vorbis' };

const base = (code) => String(code || '').toLowerCase().split('-')[0];

// Probing is quick but runs whenever a player opens, so keep the answer per file.
const cache = new Map(); // filePath → { mtimeMs, tracks }

// [{ index, language, languageName, title, label, channels, codec, default, commentary }]
// index is the track's position among the file's audio tracks (what the stream's
// ?audio= takes), not FFmpeg's stream number.
async function listAudioTracks(filePath) {
  let mtimeMs = 0;
  try { mtimeMs = fs.statSync(filePath).mtimeMs; } catch { return []; }
  const cached = cache.get(filePath);
  if (cached && cached.mtimeMs === mtimeMs) return cached.tracks;

  const { audios } = await probeFile(filePath);
  const tracks = audios.map((s, i) => {
    const lang = language(s.tags?.language);
    const title = String(s.tags?.title || s.tags?.handler_name || '').trim();
    const usefulTitle = title && !/^(sound|audio)handler$/i.test(title) && title.toLowerCase() !== lang?.name.toLowerCase() ? title : '';
    const commentary = !!s.disposition?.comment || /commentary/i.test(title);
    const name = lang?.name || usefulTitle || `Track ${i + 1}`;
    const details = [
      name !== usefulTitle ? usefulTitle : '',
      CHANNELS[s.channels] || (s.channels ? `${s.channels} ch` : ''),
    ].filter(Boolean);
    return {
      index: i,
      language: lang?.code || null,
      languageName: lang?.name || null,
      title: usefulTitle || null,
      label: [name, ...details].join(' · '),
      channels: s.channels || 0,
      codec: CODECS[s.codec_name] || (s.codec_name || '').toUpperCase(),
      default: !!s.disposition?.default,
      commentary,
    };
  });
  cache.set(filePath, { mtimeMs, tracks });
  if (cache.size > 500) cache.delete(cache.keys().next().value);
  return tracks;
}

// The title a choice is remembered under: a movie, or the whole show for an episode.
function titleOf(type, id) {
  if (type === 'movie') {
    const m = db.prepare('SELECT id, original_language FROM movies WHERE id = ?').get(id);
    return m ? { mediaType: 'movie', mediaId: m.id, originalLanguage: m.original_language } : null;
  }
  const s = db.prepare(`SELECT s.id, s.original_language FROM episodes e JOIN tv_shows s ON s.id = e.show_id WHERE e.id = ?`).get(id);
  return s ? { mediaType: 'show', mediaId: s.id, originalLanguage: s.original_language } : null;
}

function savedChoice(profileId, title) {
  if (!profileId || !title) return null;
  return db.prepare('SELECT language, track FROM audio_preferences WHERE profile_id = ? AND media_type = ? AND media_id = ?')
    .get(profileId, title.mediaType, title.mediaId) || null;
}

function rememberChoice(profileId, title, track) {
  if (!profileId || !title || !track) return;
  db.prepare(`INSERT INTO audio_preferences (profile_id, media_type, media_id, language, track, updated_at)
              VALUES (?, ?, ?, ?, ?, ?)
              ON CONFLICT(profile_id, media_type, media_id) DO UPDATE SET language = excluded.language, track = excluded.track, updated_at = excluded.updated_at`)
    .run(profileId, title.mediaType, title.mediaId, track.language || '', track.index, Date.now());
}

function findLanguage(tracks, code) {
  if (!code) return null;
  const want = base(code);
  const matches = tracks.filter(t => base(t.language) === want);
  return matches.find(t => !t.commentary && t.default) || matches.find(t => !t.commentary) || null;
}

// Which track to play when the player didn't ask for one:
//   1. what this profile last picked for this title (same language, or same track
//      when the tracks have no language tags),
//   2. the profile's Audio language ("original" = the title's original language),
//   3. the track the file marks as default, then the first that isn't a commentary.
function chooseTrack(tracks, { saved, profileLanguage, originalLanguage } = {}) {
  if (!tracks.length) return null;
  if (tracks.length === 1) return tracks[0];
  if (saved) {
    const byLanguage = saved.language ? findLanguage(tracks, saved.language) : null;
    if (byLanguage) return byLanguage;
    if (!saved.language && tracks[saved.track]) return tracks[saved.track];
  }
  const pref = profileLanguage === 'original' ? originalLanguage : profileLanguage;
  if (pref && pref !== 'default') {
    const byPref = findLanguage(tracks, pref);
    if (byPref) return byPref;
  }
  return tracks.find(t => t.default && !t.commentary) || tracks.find(t => !t.commentary) || tracks[0];
}

// Subtitles to turn on with this audio: English ones when the audio is in
// another language, if the profile asked for that ("Subtitles for other languages").
function subtitleSuggestion(profile, track) {
  if (!profile?.auto_subtitles || !track?.language) return null;
  return base(track.language) === 'en' ? null : 'en';
}

// Everything a player needs: the tracks, the one to play, and subtitles to turn on.
// requested: the track the viewer picked in the player (remembered for the title).
async function resolve(req, type, id, filePath, requested) {
  const tracks = await listAudioTracks(filePath);
  const title = titleOf(type, id);
  const profile = req.profile;
  let selected = null;
  const asked = requested === undefined || requested === null || requested === '' ? NaN : Number(requested);
  if (Number.isInteger(asked) && tracks[asked]) {
    selected = tracks[asked];
    if (tracks.length > 1) rememberChoice(profile?.id, title, selected);
  } else {
    selected = chooseTrack(tracks, {
      saved: savedChoice(profile?.id, title),
      profileLanguage: profile?.audio_language || 'default',
      originalLanguage: title?.originalLanguage,
    });
  }
  return { tracks, selected, subtitles: subtitleSuggestion(profile, selected) };
}

module.exports = { LANGUAGE_CHOICES, VALID_LANGUAGE, listAudioTracks, chooseTrack, resolve };
