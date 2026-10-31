import React from 'react';

// Shared by the Requests page and Admin › Requests: a request's status pill and
// its download progress bar.

export const STATUS_COLORS = {
  pending: '#ffb703',
  declined: '#ff6b6b',
  searching: '#00c2ff',
  waiting_release: '#9aa7ff',
  not_found: '#ff8c42',
  downloading: '#00c2ff',
  importing: '#b48cff',
  failed: '#ff6b6b',
  adding: '#b48cff',
  available: '#00c864',
  missing: '#ff8c42',
};

// Which step of the journey each status is at (for the step dots).
export const STEPS = ['Requested', 'Approved', 'Downloading', 'Moving in', 'Ready'];
export const stepOf = (status) => ({
  pending: 0, declined: 0, searching: 1, waiting_release: 1, not_found: 1, missing: 1,
  downloading: 2, failed: 2, importing: 3, adding: 3, available: 4,
}[status] ?? 0);

export function StatusPill({ status, label }) {
  const color = STATUS_COLORS[status] || '#888';
  return (
    <span data-status={status} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '3px 10px', borderRadius: '999px', fontSize: '11px', fontWeight: 700, letterSpacing: '0.4px', textTransform: 'uppercase', color, border: `1px solid ${color}55`, background: `${color}14`, whiteSpace: 'nowrap' }}>
      {['searching', 'downloading', 'importing', 'adding'].includes(status) && (
        <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: color, animation: 'reqPulse 1.4s ease-in-out infinite' }} />
      )}
      {label}
    </span>
  );
}

// Downloading: the real percentage. Moving into the library / adding: a full bar
// that gently pulses, since there's no percentage for those steps. Searching: a
// short bar sliding across, from fully off the left edge to fully off the right,
// so the loop starting again can't be seen.
export function ProgressBar({ status, progress }) {
  const busy = ['importing', 'adding'].includes(status);
  const searching = status === 'searching';
  if (!busy && !searching && status !== 'downloading') return null;
  const color = STATUS_COLORS[status] || '#00c2ff';
  const pct = busy ? 100 : Math.round((progress || 0) * 100);
  return (
    <div data-progress={busy || searching ? status : pct} style={{ height: '8px', borderRadius: '4px', background: 'rgba(255,255,255,0.08)', overflow: 'hidden', position: 'relative' }}>
      {searching ? (
        <div style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: '30%', borderRadius: '4px', background: `linear-gradient(90deg, transparent, ${color}, transparent)`, animation: 'reqSlide 1.6s ease-in-out infinite', willChange: 'transform' }} />
      ) : (
        <div style={{
          width: `${pct}%`, height: '100%', borderRadius: '4px', transition: 'width 0.8s ease',
          background: `linear-gradient(90deg, ${color}, #7b2fff)`,
          animation: busy ? 'reqShimmer 1.6s ease-in-out infinite' : undefined,
        }} />
      )}
    </div>
  );
}

// The keyframes the pill and bar use (rendered once per page). The sliding bar is
// 30% wide: -100% puts it just off the left edge, 340% just off the right.
export const RequestStyles = () => (
  <style>{`
    @keyframes reqPulse { 0%, 100% { opacity: 1 } 50% { opacity: 0.3 } }
    @keyframes reqShimmer { 0%, 100% { opacity: 1 } 50% { opacity: 0.55 } }
    @keyframes reqSlide { from { transform: translateX(-100%) } to { transform: translateX(340%) } }
  `}</style>
);

export function Steps({ status }) {
  const at = stepOf(status);
  const bad = ['declined', 'not_found', 'failed', 'missing'].includes(status);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap' }} aria-label={`Step ${at + 1} of ${STEPS.length}: ${STEPS[at]}`}>
      {STEPS.map((s, i) => {
        const done = i < at || (i === at && status === 'available');
        const here = i === at && status !== 'available';
        const color = here && bad ? STATUS_COLORS[status] : done || here ? '#00c2ff' : 'rgba(255,255,255,0.18)';
        return (
          <React.Fragment key={s}>
            {i > 0 && <span style={{ width: '14px', height: '2px', background: i <= at ? '#00c2ff88' : 'rgba(255,255,255,0.1)' }} />}
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '11px', color: done || here ? '#ddd' : '#555', fontWeight: here ? 700 : 500 }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: done ? '#00c2ff' : here ? color : 'transparent', border: `2px solid ${color}` }} />
              {s}
            </span>
          </React.Fragment>
        );
      })}
    </div>
  );
}

export function eta(ms) {
  if (!ms) return null;
  const left = ms - Date.now();
  if (left <= 0) return 'any moment now';
  const m = Math.max(1, Math.round(left / 60000));
  if (m < 60) return `about ${m} min left`;
  const h = Math.floor(m / 60);
  return `about ${h} h ${m % 60} min left`;
}
