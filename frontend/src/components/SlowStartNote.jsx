import React, { useEffect, useState } from 'react';

// The note under the player's spinner when a video is slow to start — usually
// the server's drives waking up after a quiet spell (Admin › Settings ›
// Streaming › Slow Start Message: on/off and the wording). It appears once the
// spinner has been showing for a few seconds (afterSeconds, from the server).
//
// since: when the spinner started showing (ms), or null when it isn't.

let cache = null; // { at, promise }
function message() {
  if (!cache || Date.now() - cache.at > 60 * 1000) {
    cache = {
      at: Date.now(),
      promise: fetch('/api/branding').then(r => r.json()).then(b => b.bufferingMessage || null).catch(() => null),
    };
  }
  return cache.promise;
}

export default function SlowStartNote({ since }) {
  const [msg, setMsg] = useState(null);
  const [show, setShow] = useState(false);

  useEffect(() => {
    let alive = true;
    message().then(m => { if (alive) setMsg(m); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!since || !msg?.enabled || !msg.text) { setShow(false); return undefined; }
    const wait = Math.max(0, (msg.afterSeconds || 5) * 1000 - (Date.now() - since));
    const t = setTimeout(() => setShow(true), wait);
    return () => clearTimeout(t);
  }, [since, msg]);

  if (!show) return null;
  return (
    <div role="status" data-slow-start
      style={{ maxWidth: '440px', padding: '0 24px', textAlign: 'center', color: 'rgba(255,255,255,0.82)', fontSize: '14px', lineHeight: 1.6, fontWeight: 500, textShadow: '0 1px 8px rgba(0,0,0,0.6)', animation: 'slowStartIn 0.6s ease' }}>
      {msg.text}
      <style>{'@keyframes slowStartIn { from { opacity: 0; transform: translateY(6px) } to { opacity: 1; transform: none } }'}</style>
    </div>
  );
}
