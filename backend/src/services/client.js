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

module.exports = { describe };
