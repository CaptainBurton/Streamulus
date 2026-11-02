import React, { useState } from 'react';

// A series request's progress: how many episodes are ready, then each season
// (ready / total, a bar, what's going on) — open one to see its episodes, each
// ticked off, downloading (with its %), moving in, not found or not aired yet.
// Used on the Requests page (My Requests) and in Admin › Requests.
//
// tv: the request's checklist from the server — { total, ready, downloading,
// seasons: [{ season, total, ready, active, missing, unaired, progress,
// episodes: [{ episode, title, airDate, state, progress }] }] }

const STATES = {
  ready: { color: '#00c864', label: 'Ready' },
  downloading: { color: '#00c2ff', label: 'Downloading' },
  importing: { color: '#b48cff', label: 'Moving in' },
  adding: { color: '#b48cff', label: 'Moving in' },
  searching: { color: '#ffd166', label: 'Searching' },
  missing: { color: '#ff8c42', label: 'Not found yet' },
  failed: { color: '#ff6b6b', label: 'Problem' },
  unaired: { color: '#6b6b76', label: 'Not aired yet' },
  // Download when: the whole season — aired, but held until the season's last episode is out.
  waiting: { color: '#8fa8ff', label: 'After the finale' },
};

const day = (d) => (d ? new Date(d).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const pct = (p) => `${Math.round((p || 0) * 100)}%`;

function Bar({ value, color = '#00c2ff', height = 5 }) {
  return (
    <div style={{ height, borderRadius: height, background: 'rgba(255,255,255,0.08)', overflow: 'hidden', flex: 1, minWidth: '40px' }}>
      <div style={{ width: pct(Math.min(1, Math.max(0, value))), height: '100%', borderRadius: height, background: color, transition: 'width 0.8s ease' }} />
    </div>
  );
}

function Mark({ state, progress }) {
  const s = STATES[state] || STATES.missing;
  const box = { width: '20px', height: '20px', borderRadius: '50%', flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' };
  if (state === 'ready') {
    return (
      <span style={{ ...box, background: s.color }} aria-hidden="true">
        <svg viewBox="0 0 16 16" width="12" height="12"><path d="M3.5 8.5 6.5 11.5 12.5 4.5" fill="none" stroke="#000" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </span>
    );
  }
  if (state === 'downloading') {
    // A ring that fills as it downloads.
    const r = 8;
    const c = 2 * Math.PI * r;
    return (
      <span style={box} aria-hidden="true">
        <svg viewBox="0 0 20 20" width="20" height="20">
          <circle cx="10" cy="10" r={r} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="2.5" />
          <circle cx="10" cy="10" r={r} fill="none" stroke={s.color} strokeWidth="2.5" strokeDasharray={c} strokeDashoffset={c * (1 - (progress || 0))} strokeLinecap="round" transform="rotate(-90 10 10)" style={{ transition: 'stroke-dashoffset 0.8s ease' }} />
        </svg>
      </span>
    );
  }
  return <span style={{ ...box, border: `2px solid ${s.color}`, opacity: state === 'unaired' ? 0.7 : 1, ...(['importing', 'adding', 'searching'].includes(state) ? { animation: 'reqPulse 1.6s ease-in-out infinite' } : {}) }} aria-hidden="true" />;
}

function seasonSummary(s) {
  if (s.total && s.ready === s.total) return { text: s.unaired ? `All aired ready · ${s.unaired} to come` : 'All ready', color: STATES.ready.color };
  if (s.active) return { text: `${s.active} downloading`, color: STATES.downloading.color };
  if (s.missing) return { text: `${s.missing} not found yet`, color: STATES.missing.color };
  if (s.waiting) return { text: 'Waiting for the finale', color: STATES.waiting.color };
  if (!s.total && s.unaired) return { text: 'Not aired yet', color: STATES.unaired.color };
  return { text: `${s.ready} of ${s.total}`, color: '#aaa' };
}

export default function TVChecklist({ tv, scope, compact = false }) {
  const seasons = tv?.seasons || [];
  const single = scope === 'season' || seasons.length === 1;
  // Open: the season being asked for, or the ones with something going on right
  // now — until you open or close one yourself, which then stays as you left it.
  const [chosen, setChosen] = useState({}); // season → open?
  if (!tv) return null;
  const isOpenFor = (x) => (x.season in chosen ? chosen[x.season] : single || x.active > 0);
  const toggle = (x) => setChosen(c => ({ ...c, [x.season]: !isOpenFor(x) }));

  return (
    <div data-checklist style={{ display: 'flex', flexDirection: 'column', gap: compact ? '6px' : '8px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <Bar value={tv.progress} height={6} />
        <span style={{ fontSize: '13px', fontWeight: 700, color: tv.ready === tv.total && tv.total ? STATES.ready.color : '#ddd', whiteSpace: 'nowrap' }} data-count>
          {tv.ready} of {tv.total} episode{tv.total === 1 ? '' : 's'} ready
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.07)', overflow: 'hidden' }}>
        {seasons.map((s, i) => {
          const sum = seasonSummary(s);
          const isOpen = isOpenFor(s);
          return (
            <div key={s.season} data-season-row={s.season} style={{ borderTop: i ? '1px solid rgba(255,255,255,0.06)' : 'none' }}>
              <button type="button" onClick={() => toggle(s)} aria-expanded={isOpen} className="tvc-row"
                style={{ display: 'flex', alignItems: 'center', gap: '12px', width: '100%', padding: compact ? '8px 12px' : '10px 14px', background: isOpen ? 'rgba(255,255,255,0.04)' : 'transparent', border: 'none', color: '#fff', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>
                <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true" style={{ transition: 'transform 0.2s', transform: isOpen ? 'rotate(90deg)' : 'none', opacity: 0.6, flexShrink: 0 }}>
                  <path d="M4.2 2 8 6l-3.8 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span style={{ fontWeight: 700, fontSize: '14px', minWidth: '74px' }}>Season {s.season}</span>
                <span style={{ fontSize: '12px', color: '#999', minWidth: '44px' }}>{s.ready}/{s.total}</span>
                <Bar value={s.progress} color={s.total && s.ready === s.total ? STATES.ready.color : '#00c2ff'} height={4} />
                <span style={{ fontSize: '12px', fontWeight: 700, color: sum.color, whiteSpace: 'nowrap', minWidth: compact ? 0 : '110px', textAlign: 'right' }}>{sum.text}</span>
              </button>
              {isOpen && (
                <div style={{ padding: '2px 14px 10px 36px', display: 'flex', flexDirection: 'column' }}>
                  {s.episodes.map(e => {
                    const st = STATES[e.state] || STATES.missing;
                    return (
                      <div key={e.episode} data-episode={`${s.season}x${e.episode}`} data-state={e.state} title={e.detail || ''}
                        style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                        <Mark state={e.state} progress={e.progress} />
                        <span style={{ fontSize: '12px', color: '#777', width: '34px', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>E{String(e.episode).padStart(2, '0')}</span>
                        <span style={{ fontSize: '13px', color: e.state === 'unaired' ? '#777' : '#e6e6ea', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.title || `Episode ${e.episode}`}</span>
                        {e.state === 'downloading' && !compact && <div style={{ width: '90px' }}><Bar value={e.progress} height={4} /></div>}
                        <span style={{ fontSize: '12px', fontWeight: 700, color: st.color, whiteSpace: 'nowrap', minWidth: '62px', textAlign: 'right' }}>
                          {e.state === 'downloading' ? pct(e.progress) : e.state === 'unaired' && e.airDate ? `Airs ${day(e.airDate)}` : st.label}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <style>{'.tvc-row:hover { background: rgba(255,255,255,0.05) !important; filter: none !important; box-shadow: none !important; } .tvc-row:active { transform: none !important; }'}</style>
    </div>
  );
}
