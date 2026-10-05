import { useEffect, useState } from 'react';

// Current time, refreshed every `ms` so "Ends at" stays right while a page is open.
export function useNow(ms = 30000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

// 7500 → "2h 5m", 2520 → "42m"
export function formatRuntime(secs) {
  const mins = Math.max(1, Math.round(secs / 60));
  const h = Math.floor(mins / 60);
  return h ? `${h}h ${mins % 60}m` : `${mins}m`;
}

// When something `remainingSecs` long finishes if started now, e.g. "8:00 PM".
export function endsAt(remainingSecs, now = Date.now()) {
  const d = new Date(now + remainingSecs * 1000);
  const h = d.getHours();
  return `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}
