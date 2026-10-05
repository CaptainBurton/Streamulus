import React, { useEffect, useMemo, useRef, useState } from 'react';
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
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(() => {
    try { const n = Number(localStorage.getItem('streamulus_streamlings_per_page')); return PER_PAGE_OPTIONS.includes(n) ? n : 30; } catch { return 30; }
  });
  const listTopRef = useRef(null);

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

  // Back to page 1 whenever what's listed changes.
  useEffect(() => { setPage(1); }, [kind, filter, search, perPage]);

  const pageCount = Math.max(1, Math.ceil(items.length / perPage));
  const curPage = Math.min(page, pageCount);
  const pageItems = items.slice((curPage - 1) * perPage, curPage * perPage);
  const goToPage = (n) => {
    setPage(n);
    listTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const changePerPage = (n) => {
    setPerPage(n);
    try { localStorage.setItem('streamulus_streamlings_per_page', String(n)); } catch {}
  };

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

      <div style={CARD} ref={listTopRef}>
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
          <select value={perPage} onChange={e => changePerPage(Number(e.target.value))} style={{ ...SELECT, minWidth: 0 }} aria-label="Titles per page">
            {PER_PAGE_OPTIONS.map(n => <option key={n} value={n}>{n} per page</option>)}
          </select>
        </div>

        <Pager page={curPage} pageCount={pageCount} total={items.length} perPage={perPage} onPage={goToPage} />

        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {pageItems.map(i => (
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

        {pageCount > 1 && <div style={{ marginTop: '14px' }}><Pager page={curPage} pageCount={pageCount} total={items.length} perPage={perPage} onPage={goToPage} /></div>}
      </div>
    </div>
  );
}

const PER_PAGE_OPTIONS = [20, 30, 40, 50, 60];

// "Showing 31–60 of 142   ‹ Prev  1 2 3 … 5  Next ›"
function Pager({ page, pageCount, total, perPage, onPage }) {
  if (total === 0) return null;
  const from = (page - 1) * perPage + 1;
  const to = Math.min(total, page * perPage);
  // Page numbers: first, last, and up to 2 either side of the current page.
  const nums = [];
  for (let n = 1; n <= pageCount; n++) {
    if (n === 1 || n === pageCount || Math.abs(n - page) <= 2) nums.push(n);
    else if (nums[nums.length - 1] !== '…') nums.push('…');
  }
  const btn = (active, disabled) => ({
    minWidth: '34px', height: '32px', padding: '0 10px', borderRadius: '6px', fontSize: '13px', fontWeight: 600,
    cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.35 : 1,
    background: active ? '#ffb703' : 'transparent', color: active ? '#000' : '#bbb',
    border: `1px solid ${active ? '#ffb703' : 'rgba(255,255,255,0.12)'}`,
  });
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap', marginBottom: '12px' }}>
      <span style={{ fontSize: '13px', color: '#777' }}>Showing {from}–{to} of {total}</span>
      {pageCount > 1 && (
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          <button style={btn(false, page === 1)} disabled={page === 1} onClick={() => onPage(page - 1)}>‹ Prev</button>
          {nums.map((n, i) => n === '…'
            ? <span key={`gap${i}`} style={{ color: '#555', alignSelf: 'center', padding: '0 2px' }}>…</span>
            : <button key={n} style={btn(n === page, false)} onClick={() => onPage(n)} aria-current={n === page ? 'page' : undefined}>{n}</button>)}
          <button style={btn(false, page === pageCount)} disabled={page === pageCount} onClick={() => onPage(page + 1)}>Next ›</button>
        </div>
      )}
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
