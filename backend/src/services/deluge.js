// Deluge (its Web UI's JSON API), for film requests:
//  • live download progress — Radarr only asks the download client how things
//    are going about once a minute, so its percentage and time left lag behind;
//    Deluge's are current;
//  • the admin's backup when Radarr can't find a film: a pasted magnet link is
//    added here, followed, and the finished film moved into the library
//    (requests.js). Deluge may see its download folder at a different path from
//    Streamulus (Docker, another machine with a shared drive), so the admin can
//    map one to the other.
// Admin › Requests › Deluge holds the Web UI address, password and folder mapping.
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const db = require('../database/db');

const getConf = (key, fallback = '') => db.prepare('SELECT value FROM config WHERE key = ?').get(key)?.value ?? fallback;

const trimSlash = (p) => String(p || '').trim().replace(/[\\/]+$/, '');

function settings() {
  return {
    url: String(getConf('deluge_url')).trim().replace(/\/+$/, '').replace(/\/json$/, ''),
    password: String(getConf('deluge_password')),
    // Deluge's download folder as Deluge sees it → the same folder as Streamulus sees it.
    remotePath: trimSlash(getConf('deluge_remote_path')),
    localPath: trimSlash(getConf('deluge_local_path')),
  };
}

// A path Deluge reported → where Streamulus finds it (the mapping, if one fits).
function toLocal(p, s = settings()) {
  const raw = String(p || '');
  if (!s.remotePath || !s.localPath) return raw;
  const windows = /^[a-z]:[\\/]/i.test(s.remotePath) || s.remotePath.includes('\\');
  const norm = (x) => (windows ? x.replace(/\\/g, '/').toLowerCase() : x);
  const from = norm(s.remotePath);
  const given = norm(raw);
  if (given !== from && !given.startsWith(`${from}/`)) return raw;
  const rest = raw.slice(s.remotePath.length).replace(/\\/g, '/').replace(/^\/+/, '');
  return rest ? path.join(s.localPath, ...rest.split('/')) : s.localPath;
}

const configured = (s = settings()) => !!s.url;

// One logged-in Web UI session per address + password (its cookie).
const sessions = new Map();
let nextId = 1;

async function rpc(s, method, params = []) {
  const key = `${s.url}\n${s.password}`;
  const session = sessions.get(key) || {};
  const res = await axios.post(`${s.url}/json`, { method, params, id: nextId++ }, {
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(session.cookie ? { Cookie: session.cookie } : {}) },
    timeout: 8000,
  });
  const set = res.headers['set-cookie'];
  if (set) sessions.set(key, { cookie: (Array.isArray(set) ? set : [set]).map(c => c.split(';')[0]).join('; ') });
  if (res.data?.error) throw Object.assign(new Error(res.data.error.message || 'Deluge error'), { rpcCode: res.data.error.code });
  return res.data?.result;
}

// Logged in, and the Web UI connected to a Deluge daemon.
async function ready(s) {
  const key = `${s.url}\n${s.password}`;
  let ok = false;
  if (sessions.get(key)?.cookie) ok = await rpc(s, 'auth.check_session').catch(() => false);
  if (!ok) {
    sessions.delete(key);
    if (!await rpc(s, 'auth.login', [s.password])) throw Object.assign(new Error("Deluge didn't accept the password (the Web UI password)"), { code: 'DELUGE_AUTH' });
  }
  if (!await rpc(s, 'web.connected')) {
    const hosts = await rpc(s, 'web.get_hosts');
    if (!hosts?.length) throw new Error("Deluge's Web UI isn't connected to a Deluge daemon (Connection Manager)");
    await rpc(s, 'web.connect', [hosts[0][0]]);
  }
}

const FIELDS = ['name', 'progress', 'eta', 'download_payload_rate', 'state', 'total_wanted', 'total_done'];

function shape(t) {
  return {
    name: t.name,
    progress: Math.min(1, Math.max(0, (Number(t.progress) || 0) / 100)),
    eta: Number(t.eta) > 0 ? Number(t.eta) : null, // seconds
    speed: Number(t.download_payload_rate) || 0, // bytes per second
    state: t.state || null, // Downloading, Seeding, Paused, Queued, Checking, Error, Moving…
    size: Number(t.total_wanted) || null,
    done: Number(t.total_done) || null,
  };
}

// { [hash]: { progress, eta, speed, state, … } } for these torrents (Radarr's downloadId).
async function torrents(hashes, s = settings()) {
  const ids = [...new Set(hashes.filter(Boolean).map(h => String(h).toLowerCase()))];
  if (!ids.length || !configured(s)) return {};
  const ask = async () => {
    await ready(s);
    return rpc(s, 'core.get_torrents_status', [{ id: ids }, FIELDS]);
  };
  let result;
  try {
    result = await ask();
  } catch (err) {
    // Session expired or the daemon reconnected: log in again once.
    sessions.delete(`${s.url}\n${s.password}`);
    result = await ask();
  }
  const out = {};
  for (const [hash, t] of Object.entries(result || {})) out[hash.toLowerCase()] = shape(t);
  return out;
}

// Logged in and connected, then one call (logging in again once if the session lapsed).
async function call(method, params, s = settings()) {
  if (!configured(s)) throw Object.assign(new Error('Connect Deluge in Admin › Requests first'), { code: 'DELUGE_OFF' });
  try {
    await ready(s);
    return await rpc(s, method, params);
  } catch (err) {
    if (err.code === 'DELUGE_AUTH' || err.rpcCode === undefined) throw err;
    sessions.delete(`${s.url}\n${s.password}`);
    await ready(s);
    return rpc(s, method, params);
  }
}

// The info hash in a magnet link (hex, lower case), or null if it isn't one.
function magnetHash(uri) {
  const m = String(uri || '').trim().match(/^magnet:\?.*?\bxt=urn:btih:([a-z0-9]+)/i);
  if (!m) return null;
  const h = m[1];
  if (/^[a-f0-9]{40}$/i.test(h)) return h.toLowerCase();
  if (/^[a-z2-7]{32}$/i.test(h)) { // base32 → hex
    let bits = '';
    for (const c of h.toUpperCase()) bits += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(c).toString(2).padStart(5, '0');
    return bits.match(/.{4}/g).map(b => parseInt(b, 2).toString(16)).join('');
  }
  return null;
}

// The name a magnet link gives its download (dn=…), if any.
function magnetName(uri) {
  const m = String(uri || '').match(/[?&]dn=([^&]+)/i);
  if (!m) return null;
  try { return decodeURIComponent(m[1].replace(/\+/g, ' ')).trim() || null; } catch { return m[1]; }
}

// Add a magnet link. Files stay in Deluge's download folder when done (no
// "move completed"), where Streamulus picks them up. → hash
async function addMagnet(uri) {
  const hash = magnetHash(uri);
  if (!hash) throw Object.assign(new Error("That isn't a magnet link — it should start with magnet:?xt=urn:btih:"), { code: 'BAD_MAGNET' });
  try {
    const id = await call('core.add_torrent_magnet', [String(uri).trim(), { add_paused: false, move_completed: false }]);
    return String(id || hash).toLowerCase();
  } catch (err) {
    // Deluge refuses a torrent it already has — carry on with that one.
    if (/already/i.test(err.message || '')) return hash;
    throw err;
  }
}

// One torrent with its files: { name, progress (0–1), state, savePath, files: [{ path, size }], … } or null.
async function torrent(hash) {
  const t = await call('core.get_torrent_status', [String(hash).toLowerCase(), [...FIELDS, 'save_path', 'files', 'is_finished']]);
  if (!t || !Object.keys(t).length) return null;
  return {
    ...shape(t),
    finished: !!t.is_finished || Number(t.progress) >= 100,
    savePath: t.save_path || '',
    files: (t.files || []).map(f => ({ path: String(f.path || ''), size: Number(f.size) || 0 })),
  };
}

// Remove a torrent from Deluge, with or without its downloaded files.
const remove = (hash, withData = false) => call('core.remove_torrent', [String(hash).toLowerCase(), !!withData]);

// Check an address and password (the saved ones unless given), and whether
// Streamulus can see the download folder (through the mapping, if given).
// → { torrents, downloadFolder, localFolder, visible }
async function test({ url, password, remotePath, localPath } = {}) {
  const saved = settings();
  const s = {
    url: String(url ?? saved.url).trim().replace(/\/+$/, '').replace(/\/json$/, ''),
    password: password !== undefined && password !== '' ? String(password) : saved.password,
    remotePath: remotePath !== undefined ? trimSlash(remotePath) : saved.remotePath,
    localPath: localPath !== undefined ? trimSlash(localPath) : saved.localPath,
  };
  if (!s.url) throw new Error('Enter the Deluge Web UI address');
  if (!/^https?:\/\//i.test(s.url)) throw new Error('The Deluge address should start with http:// or https://');
  await ready(s);
  const all = await rpc(s, 'core.get_torrents_status', [{}, ['name']]);
  const downloadFolder = await rpc(s, 'core.get_config_value', ['download_location']).catch(() => null);
  const localFolder = downloadFolder ? toLocal(downloadFolder, s) : null;
  let visible = false;
  try { visible = !!localFolder && fs.statSync(localFolder).isDirectory(); } catch {}
  return { torrents: Object.keys(all || {}).length, downloadFolder: downloadFolder || null, localFolder, visible };
}

function errorText(err, url = settings().url) {
  if (['DELUGE_AUTH', 'DELUGE_OFF', 'BAD_MAGNET'].includes(err?.code)) return err.message;
  if (err?.response?.status === 404) return `Deluge's Web UI wasn't found at ${url} — use the address you open Deluge in (port 8112 by default).`;
  if (['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'ECONNABORTED', 'EHOSTUNREACH'].includes(err?.code)) {
    return `Couldn't reach Deluge at ${url} (${err.code}). If both run in Docker, use the Deluge container's name or the server's IP, not localhost.`;
  }
  return err?.message || String(err);
}

module.exports = { settings, configured, torrents, test, errorText, toLocal, magnetHash, magnetName, addMagnet, torrent, remove };
