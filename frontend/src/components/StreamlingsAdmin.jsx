import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';

// Admin > Streamlings: what kids profiles can see.
// A title is shown to Streamlings if it's ticked. Ticks follow the age-rating
// rule until the admin changes one by hand; manual choices are marked and can
// be reset.
const AGE_OPTIONS = [
  { value: 0, label: 'All ages only (G, U, TV-Y, TV-G)' },
  { value: 7, label: 'Up to 7 (adds TV-Y7, FSK 6)' },
  { value: 8, label: 'Up to 8 (adds PG, TV-PG)' },
  { value: 10, label: 'Up to 10' },
  { value: 12, label: 'Up to 12 (adds 12A, PG-12)' },
  { value: 13, label: 'Up to 13 (adds PG-13)' },
  { value: 14, label: 'Up to 14 (adds TV-14)' },
  { value: 16, label: 'Up to 16' },
];

export default function StreamlingsAdmin({ flash }) {
  const [data, setData] = useState(null);
  const [cfg, setCfg] = useState(null);
  const [kind, setKind] = useState('movies'); // 'movies' | 'shows'
  const [filter, setFilter] = useState('all'); // all | allowed | blocked | manual
  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [confirmReset, setConfirmReset] = useState(false);

  const load = () => axios.get('/api/admin/kids').then(r => { setData(r.data); setCfg(r.data.config); })
    .catch(() => flash('Failed to load Streamlings settings', true));
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const saveConfig = async (next) => {
    setCfg(next);
    try {
      await axios.put('/api/admin/kids/config', next);
      await load();
    } catch (err) { flash(err.response?.data?.error || 'Failed to save', true); }
  };

  const setAllowed = async (item, allowed) => {
    const mediaType = kind === 'movies' ? 'movie' : 'show';
    // Ticking it back to what the rating rule says clears the manual choice.
    const override = allowed === item.byRating ? null : allowed;
    const listKey = kind;
    const patch = (fields) => setData(d => ({ ...d, [listKey]: d[listKey].map(x => (x.id === item.id ? { ...x, ...fields } : x)) }));
    patch({ allowed, override }); // show the change straight away
    setBusyId(item.id);
    try {
      await axios.put('/api/admin/kids/override', { mediaType, mediaId: item.id, allowed: override });
    } catch (err) {
      patch({ allowed: item.allowed, override: item.override }); // undo
      flash(err.response?.data?.error || 'Failed to update', true);
    }
    setBusyId(null);
  };

  const resetManual = async () => {
    if (!confirmReset) { setConfirmReset(true); setTimeout(() => setConfirmReset(false), 4000); return; }
    setConfirmReset(false);
    try {
      const r = await axios.post('/api/admin/kids/override/reset', {});
      flash(`Cleared ${r.data.cleared} manual choice${r.data.cleared === 1 ? '' : 's'}`);
      await load();
    } catch { flash('Failed to reset', true); }
  };

  const items = useMemo(() => {
    const list = data?.[kind] || [];
    const q = search.trim().toLowerCase();
    return list.filter(i =>
      (!q || i.title.toLowerCase().includes(q)) &&
      (filter === 'all' || (filter === 'allowed' && i.allowed) || (filter === 'blocked' && !i.allowed) || (filter === 'manual' && i.override !== null)));
  }, [data, kind, filter, search]);

  if (!data || !cfg) return <div style={{ color: '#555', padding: '40px', textAlign: 'center' }}>Loading…</div>;

  const count = (list) => `${list.filter(i => i.allowed).length} of ${list.length}`;
  const manualCount = [...data.movies, ...data.shows].filter(i => i.override !== null).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={CARD}>
        <h3 style={{ fontSize: '16px', fontWeight: '700', marginBottom: '6px' }}>
          <span style={{ color: '#ffb703' }}>Streamlings</span> — kids profiles
        </h3>
        <p style={{ color: '#666', fontSize: '13px', marginBottom: '20px', lineHeight: 1.6 }}>
          Streamling profiles only see the titles ticked below — in lists, search, Continue Watching and playback.
          Ticks follow your age-rating rule; change any title by hand and it stays that way.
        </p>

        <Row label="Use age ratings" hint="Tick titles automatically by their content rating">
          <Toggle on={cfg.useRatings} onChange={v => saveConfig({ ...cfg, useRatings: v })} />
        </Row>
        <Row label="Maximum age rating" hint="Highest rating a Streamling can watch" dim={!cfg.useRatings}>
          <select value={cfg.maxAge} disabled={!cfg.useRatings} onChange={e => saveConfig({ ...cfg, maxAge: Number(e.target.value) })} style={SELECT}>
            {AGE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            {!AGE_OPTIONS.some(o => o.value === cfg.maxAge) && <option value={cfg.maxAge}>Up to {cfg.maxAge}</option>}
          </select>
        </Row>
        <Row label="Allow unrated titles" hint="Titles with no rating (home videos, some imports)" dim={!cfg.useRatings} last>
          <Toggle on={cfg.allowUnrated} disabled={!cfg.useRatings} onChange={v => saveConfig({ ...cfg, allowUnrated: v })} />
        </Row>
        {!cfg.useRatings && (
          <div style={{ marginTop: '12px', fontSize: '13px', color: '#ffb703' }}>
            Age ratings are off — Streamlings only see titles you tick by hand.
          </div>
        )}
      </div>

      <div style={CARD}>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '16px' }}>
          {[['movies', `Movies · ${count(data.movies)}`], ['shows', `TV Shows · ${count(data.shows)}`]].map(([k, label]) => (
            <button key={k} onClick={() => setKind(k)} style={{ ...PILL, ...(kind === k ? PILL_ON : {}) }}>{label}</button>
          ))}
          <div style={{ flex: 1 }} />
          {manualCount > 0 && (
            <button onClick={resetManual} style={{ ...PILL, color: confirmReset ? '#fff' : '#ff6b6b', background: confirmReset ? '#ff4444' : 'transparent', borderColor: 'rgba(255,68,68,0.35)' }}>
              {confirmReset ? 'Click again to reset' : `Reset ${manualCount} manual choice${manualCount === 1 ? '' : 's'}`}
            </button>
          )}
        </div>

        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '14px' }}>
          <input placeholder={`Search ${kind === 'movies' ? 'movies' : 'shows'}…`} value={search} onChange={e => setSearch(e.target.value)}
            style={{ flex: '1 1 200px', padding: '9px 14px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#fff', fontSize: '14px', outline: 'none' }} />
          <select value={filter} onChange={e => setFilter(e.target.value)} style={SELECT}>
            <option value="all">All titles</option>
            <option value="allowed">Shown to Streamlings</option>
            <option value="blocked">Hidden from Streamlings</option>
            <option value="manual">Changed by hand</option>
          </select>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {items.map(i => (
            <label key={i.id} style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '8px 12px', borderRadius: '8px', cursor: 'pointer',
              background: i.allowed ? 'rgba(255,183,3,0.06)' : 'rgba(255,255,255,0.02)', border: `1px solid ${i.allowed ? 'rgba(255,183,3,0.2)' : 'rgba(255,255,255,0.05)'}`,
              opacity: busyId === i.id ? 0.5 : 1 }}>
              <input type="checkbox" checked={i.allowed} disabled={busyId === i.id} onChange={e => setAllowed(i, e.target.checked)}
                style={{ width: '18px', height: '18px', accentColor: '#ffb703', flexShrink: 0 }} aria-label={`Show ${i.title} to Streamlings`} />
              <div style={{ width: '34px', height: '50px', borderRadius: '4px', overflow: 'hidden', background: '#1e1e1e', flexShrink: 0 }}>
                {i.poster_url && <img src={i.poster_url} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '14px', fontWeight: 600, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {i.title} {i.year && <span style={{ color: '#555', fontWeight: 400 }}>({i.year})</span>}
                </div>
                <div style={{ fontSize: '12px', color: '#666', marginTop: '2px' }}>
                  {i.override !== null
                    ? <span style={{ color: '#ffb703' }}>Set by hand · rating rule would {i.byRating ? 'show' : 'hide'} it</span>
                    : (i.allowed ? 'Shown by rating rule' : (i.content_rating ? 'Hidden by rating rule' : 'Unrated'))}
                </div>
              </div>
              <span style={{ padding: '2px 8px', border: '1px solid #444', borderRadius: '4px', color: '#888', fontSize: '12px', fontWeight: 600, flexShrink: 0, minWidth: '44px', textAlign: 'center' }}>
                {i.content_rating || 'NR'}
              </span>
            </label>
          ))}
          {items.length === 0 && <div style={{ color: '#555', padding: '24px', textAlign: 'center', fontSize: '14px' }}>No titles match.</div>}
        </div>
      </div>
    </div>
  );
}

function Row({ label, hint, children, dim, last }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', padding: '12px 0', opacity: dim ? 0.45 : 1,
      borderBottom: last ? 'none' : '1px solid rgba(255,255,255,0.05)', flexWrap: 'wrap' }}>
      <div>
        <div style={{ fontSize: '14px', fontWeight: 600, color: '#ccc' }}>{label}</div>
        <div style={{ fontSize: '12px', color: '#555', marginTop: '3px' }}>{hint}</div>
      </div>
      {children}
    </div>
  );
}

function Toggle({ on, onChange, disabled }) {
  return (
    <button role="switch" aria-checked={on} disabled={disabled} onClick={() => onChange(!on)}
      style={{ width: '46px', height: '26px', borderRadius: '13px', border: 'none', cursor: disabled ? 'default' : 'pointer', position: 'relative', flexShrink: 0,
        background: on ? '#ffb703' : 'rgba(255,255,255,0.15)', transition: 'background 0.2s' }}>
      <span style={{ position: 'absolute', top: '3px', left: on ? '23px' : '3px', width: '20px', height: '20px', borderRadius: '50%', background: '#fff', transition: 'left 0.2s' }} />
    </button>
  );
}

const CARD = { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', padding: '24px' };
const SELECT = { background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#fff', fontSize: '13px', padding: '8px 12px', cursor: 'pointer', outline: 'none', minWidth: '200px' };
const PILL = { padding: '7px 14px', borderRadius: '20px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', background: 'transparent', color: '#888', border: '1px solid rgba(255,255,255,0.12)' };
const PILL_ON = { color: '#000', background: '#ffb703', borderColor: '#ffb703' };
