// Live download progress straight from Deluge (its Web UI's JSON API), for film
// requests. Radarr only asks the download client how things are going about once
// a minute, so its percentage and time left lag behind; Deluge's are current.
// Optional — without it, request progress comes from Radarr.
// Admin › Requests › Deluge holds the Web UI address and password.
const axios = require('axios');
const db = require('../database/db');

const getConf = (key, fallback = '') => db.prepare('SELECT value FROM config WHERE key = ?').get(key)?.value ?? fallback;

function settings() {
  return {
    url: String(getConf('deluge_url')).trim().replace(/\/+$/, '').replace(/\/json$/, ''),
    password: String(getConf('deluge_password')),
  };
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

// Check an address and password (the saved ones unless given). → { torrents }
async function test({ url, password } = {}) {
  const saved = settings();
  const s = {
    url: String(url ?? saved.url).trim().replace(/\/+$/, '').replace(/\/json$/, ''),
    password: password !== undefined && password !== '' ? String(password) : saved.password,
  };
  if (!s.url) throw new Error('Enter the Deluge Web UI address');
  if (!/^https?:\/\//i.test(s.url)) throw new Error('The Deluge address should start with http:// or https://');
  await ready(s);
  const all = await rpc(s, 'core.get_torrents_status', [{}, ['name']]);
  return { torrents: Object.keys(all || {}).length };
}

function errorText(err, url = settings().url) {
  if (err?.code === 'DELUGE_AUTH') return err.message;
  if (err?.response?.status === 404) return `Deluge's Web UI wasn't found at ${url} — use the address you open Deluge in (port 8112 by default).`;
  if (['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'ECONNABORTED', 'EHOSTUNREACH'].includes(err?.code)) {
    return `Couldn't reach Deluge at ${url} (${err.code}). If both run in Docker, use the Deluge container's name or the server's IP, not localhost.`;
  }
  return err?.message || String(err);
}

module.exports = { settings, configured, torrents, test, errorText };
