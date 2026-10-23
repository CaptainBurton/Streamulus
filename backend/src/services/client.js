// Which app and device a request comes from, for the activity log and the list
// of signed-in devices. The Streamulus apps say so in an X-Streamulus-Client
// header ("iOS 1.6 (8) · iPhone"); browsers are read from their User-Agent.

function browserName(ua) {
  if (/Edg\//.test(ua)) return 'Edge';
  if (/OPR\/|Opera/.test(ua)) return 'Opera';
  if (/Firefox\//.test(ua)) return 'Firefox';
  if (/Chrome\/|CriOS\//.test(ua)) return 'Chrome';
  if (/Safari\//.test(ua) && /Version\//.test(ua)) return 'Safari';
  return null;
}

function systemName(ua) {
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return 'Android';
  if (/CrOS/.test(ua)) return 'ChromeOS';
  if (/Windows NT/.test(ua)) return 'Windows';
  if (/Mac OS X|Macintosh/.test(ua)) return 'macOS';
  if (/AppleTV|tvOS/.test(ua)) return 'Apple TV';
  if (/Linux/.test(ua)) return 'Linux';
  return null;
}

// { app: 'Web' | 'iOS 1.6 (8)' | …, device: 'Chrome on Windows' | 'iPhone' | … }
function describe(req) {
  const header = String(req.get?.('x-streamulus-client') || '').trim().slice(0, 80);
  const ua = String(req.get?.('user-agent') || '');
  if (header) {
    const [app, device] = header.split(' · ');
    return { app: app || header, device: device || systemName(ua) || null };
  }
  // Older app versions without the header.
  if (/CFNetwork|Darwin/.test(ua)) return { app: 'Apple app', device: /AppleTV/.test(ua) ? 'Apple TV' : null };
  if (/okhttp/i.test(ua)) return { app: 'Android app', device: null };
  const browser = browserName(ua);
  const system = systemName(ua);
  return { app: 'Web', device: browser && system ? `${browser} on ${system}` : (browser || system || null) };
}

// Home network addresses (and this machine). Tailscale's 100.64.0.0/10 is not
// here on purpose: a phone on mobile data reaching the server over Tailscale is
// away from home, and its connection may be relayed.
function isPrivateIp(ip) {
  const v4 = ip.replace(/^::ffff:/i, '');
  const m = v4.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
  }
  const v6 = ip.toLowerCase();
  return v6 === '::1' || /^f[cd][0-9a-f]{2}:/.test(v6) || /^fe[89ab][0-9a-f]:/.test(v6);
}

// Whether a request comes from away from home: through the public address
// (e.g. a Tailscale Funnel *.ts.net name, or the Remote Access address in
// Settings), or from an address outside the home network. Remote viewers get
// streams kept under Settings › Transcoding & Streaming › Remote Streaming.
function isRemote(req) {
  const host = String(req.get?.('x-forwarded-host') || req.get?.('host') || '').split(',')[0].trim().replace(/:\d+$/, '').toLowerCase();
  if (host.endsWith('.ts.net')) return true;
  try {
    const db = require('../database/db');
    const saved = db.prepare("SELECT value FROM config WHERE key = 'public_url'").get()?.value;
    if (saved && host && new URL(saved).hostname.toLowerCase() === host) return true;
  } catch {}
  const ip = String(req.ip || '');
  return !!ip && !isPrivateIp(ip);
}

module.exports = { describe, isRemote, isPrivateIp };
