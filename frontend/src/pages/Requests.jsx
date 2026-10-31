import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import Navbar from '../components/Navbar';
import { StatusPill, ProgressBar, Steps, RequestStyles, STATUS_COLORS } from '../components/RequestStatus';

// Requests: find a film that isn't in the library and ask for it. An admin
// approves or declines it (you're emailed either way); approved films download
// by themselves and you can follow them here until they're ready to watch.
const ACTIVE = ['pending', 'searching', 'waiting_release', 'not_found', 'downloading', 'importing', 'failed', 'adding', 'missing'];
const BTN = { padding: '9px 16px', borderRadius: '8px', fontSize: '13px', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', border: '1px solid rgba(255,255,255,0.15)', background: 'transparent', color: '#ddd', whiteSpace: 'nowrap' };
const PRIMARY = { ...BTN, background: '#00c2ff', border: '1px solid #00c2ff', color: '#000' };

export default function Requests() {
  const [config, setConfig] = useState(null);
  const [tab, setTab] = useState('find');
  const [mine, setMine] = useState(null);
  const [flash, setFlash] = useState(null);
  const say = (text, error = false) => { setFlash({ text, error }); setTimeout(() => setFlash(null), 4500); };

  const loadMine = () => axios.get('/api/requests').then(r => { setMine(r.data.requests); return r.data.requests; }).catch(() => setMine([]));

  useEffect(() => {
    axios.get('/api/requests/config').then(r => {
      setConfig(r.data);
      // Something on the go (e.g. arriving from an email): show its progress first.
      if (r.data.open) loadMine().then(list => { if (list?.some(x => ACTIVE.includes(x.status) || x.status === 'available')) setTab('mine'); });
    }).catch(() => setConfig({ open: false }));
  }, []);

  // Keep an eye on downloads while any are on the go, as often as the admin set
  // (Admin › Requests › Refresh every).
  const anyActive = (mine || []).some(r => ACTIVE.includes(r.status));
  const everyMs = Math.max(1, config?.refreshSeconds || 2) * 1000;
  useEffect(() => {
    if (!anyActive) return undefined;
    const t = setInterval(() => { if (!document.hidden) loadMine(); }, everyMs);
    return () => clearInterval(t);
  }, [anyActive, everyMs]);

  const counts = useMemo(() => ({ total: mine?.length || 0, active: (mine || []).filter(r => ACTIVE.includes(r.status)).length }), [mine]);

  return (
    <div style={{ minHeight: '100vh', background: '#0f0f0f', color: '#fff' }}>
      <Navbar />
      <RequestStyles />
      <div style={{ maxWidth: '1100px', margin: '0 auto', padding: '96px 16px 64px' }}>
        <h1 style={{ fontSize: '32px', fontWeight: 800, marginBottom: '6px' }}>Requests</h1>
        <p style={{ color: '#777', fontSize: '14px', marginBottom: '22px', lineHeight: 1.6, maxWidth: '720px' }}>
          Ask for a film that isn't on Streamulus yet. Once an admin approves it, it downloads by itself — follow it here, and you'll get an email when it's ready to watch.
        </p>

        {flash && (
          <div style={{ marginBottom: '18px', padding: '12px 16px', borderRadius: '8px', fontSize: '14px',
            background: flash.error ? 'rgba(255,68,68,0.1)' : 'rgba(0,200,100,0.1)',
            border: `1px solid ${flash.error ? 'rgba(255,68,68,0.25)' : 'rgba(0,200,100,0.25)'}`,
            color: flash.error ? '#ff6b6b' : '#00c864' }} data-flash>
            {flash.error ? '⚠ ' : '✓ '}{flash.text}
          </div>
        )}

        {!config ? <div className="spinner" style={{ margin: '60px auto' }} /> : !config.open ? (
          <div style={{ padding: '28px', borderRadius: '12px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: '#aaa', fontSize: '15px' }}>
            Requests aren't available right now.
          </div>
        ) : (
          <>
            <div role="tablist" style={{ display: 'flex', gap: '8px', marginBottom: '22px', flexWrap: 'wrap' }}>
              {[['find', 'Request a Film'], ['mine', `My Requests${counts.total ? ` · ${counts.total}` : ''}`]].map(([key, label]) => (
                <button key={key} role="tab" aria-selected={tab === key} onClick={() => { setTab(key); if (key === 'mine') loadMine(); }}
                  style={{ ...BTN, borderRadius: '999px', padding: '8px 18px', fontSize: '14px', ...(tab === key ? { background: '#fff', color: '#000', border: '1px solid #fff' } : {}) }}>
                  {label}
                  {key === 'mine' && counts.active > 0 && tab !== 'mine' && (
                    <span style={{ marginLeft: '8px', padding: '1px 7px', borderRadius: '10px', background: '#00c2ff', color: '#000', fontSize: '11px' }}>{counts.active} on the go</span>
                  )}
                </button>
              ))}
            </div>
            {tab === 'find'
              ? <FindFilm say={say} onRequested={() => loadMine()} showMine={() => setTab('mine')} limit={config.limit} />
              : <MyRequests list={mine} say={say} reload={loadMine} goFind={() => setTab('find')} />}
          </>
        )}
      </div>
    </div>
  );
}

// ── Find a film ──────────────────────────────────────────────────────────────

function FindFilm({ say, onRequested, showMine }) {
  const [query, setQuery] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [asking, setAsking] = useState(null); // film being requested
  const latest = useRef(0);

  const search = (q) => {
    const ask = ++latest.current;
    setLoading(true);
    axios.get('/api/requests/search', { params: { q } })
      .then(r => { if (ask === latest.current) setData(r.data); })
      .catch(err => { if (ask === latest.current) say(err.response?.data?.error || "Couldn't search right now", true); })
      .finally(() => { if (ask === latest.current) setLoading(false); });
  };
  useEffect(() => { search(''); }, []); // popular films to start with
  useEffect(() => {
    const t = setTimeout(() => search(query.trim()), 400);
    return () => clearTimeout(t);
  }, [query]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = async (film, note) => {
    try {
      const r = await axios.post('/api/requests', { tmdbId: film.tmdbId, note });
      setAsking(null);
      say(r.data.joined ? `Someone had already asked for ${film.title} — you'll hear when it's ready too`
        : r.data.request.status === 'pending' ? `Requested ${film.title} — you'll get an email when an admin decides`
          : `${film.title} is approved and on its way`);
      onRequested();
      search(query.trim());
    } catch (err) {
      say(err.response?.data?.error || "Couldn't send the request", true);
    }
  };

  return (
    <div>
      <div style={{ position: 'relative', marginBottom: '20px', maxWidth: '560px' }}>
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search for a film…" aria-label="Search for a film" autoFocus
          style={{ width: '100%', padding: '14px 16px 14px 44px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '10px', color: '#fff', fontSize: '16px', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }} />
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#888" strokeWidth="2" strokeLinecap="round" style={{ position: 'absolute', left: '15px', top: '50%', transform: 'translateY(-50%)' }} aria-hidden="true">
          <circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" />
        </svg>
      </div>
      <div style={{ fontSize: '13px', color: '#777', marginBottom: '14px', fontWeight: 600 }}>
        {data?.query ? `Results for “${data.query}”` : 'Popular this week'}{loading && ' · searching…'}
      </div>
      {data && data.results.length === 0 && !loading && <div style={{ color: '#777', padding: '30px 0' }}>No films found — try another spelling or the year.</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(170px, 45%), 1fr))', gap: '18px' }}>
        {(data?.results || []).map(film => (
          <div key={film.tmdbId} data-film={film.title} style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <div style={{ position: 'relative', aspectRatio: '2 / 3', borderRadius: '10px', overflow: 'hidden', background: '#1c1c1e' }}>
              {film.posterUrl
                ? <img src={film.posterUrl} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                : <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#555', fontSize: '13px', padding: '10px', textAlign: 'center' }}>{film.title}</div>}
              {(film.movieId || film.request) && (
                <div style={{ position: 'absolute', top: '8px', left: '8px' }}>
                  {film.movieId ? <StatusPill status="available" label="In the library" /> : <StatusPill status={film.request.status} label={film.request.label} />}
                </div>
              )}
            </div>
            <div style={{ fontWeight: 700, fontSize: '14px', marginTop: '8px', lineHeight: 1.3 }}>{film.title}</div>
            <div style={{ fontSize: '12px', color: '#777', marginBottom: '8px' }}>{film.year || '—'}{film.rating ? ` · ★ ${film.rating.toFixed(1)}` : ''}</div>
            <div style={{ marginTop: 'auto' }}>
              {film.movieId ? (
                <Link to={`/movie/${film.movieId}`} style={{ ...BTN, display: 'block', textAlign: 'center', textDecoration: 'none' }}>Watch</Link>
              ) : film.request ? (
                film.request.mine
                  ? <button style={{ ...BTN, width: '100%' }} onClick={showMine}>See Progress</button>
                  : <button style={{ ...BTN, width: '100%' }} onClick={() => send(film, '')} data-action="join">Me Too</button>
              ) : (
                <button style={{ ...PRIMARY, width: '100%' }} onClick={() => setAsking(film)} data-action="request">Request</button>
              )}
            </div>
          </div>
        ))}
      </div>
      {asking && <AskDialog film={asking} onCancel={() => setAsking(null)} onSend={(note) => send(asking, note)} />}
    </div>
  );
}

function AskDialog({ film, onCancel, onSend }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);
  return (
    <div onClick={onCancel} style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
      <div onClick={e => e.stopPropagation()} role="dialog" aria-label={`Request ${film.title}`} data-dialog="request"
        style={{ width: '100%', maxWidth: '520px', background: '#17171b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '14px', padding: '22px', display: 'flex', gap: '18px' }}>
        {film.posterUrl && <img src={film.posterUrl} alt="" style={{ width: '96px', height: '144px', objectFit: 'cover', borderRadius: '8px', flexShrink: 0 }} />}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '19px', fontWeight: 800 }}>{film.title} <span style={{ color: '#777', fontWeight: 500 }}>{film.year || ''}</span></div>
          <p style={{ color: '#999', fontSize: '13px', lineHeight: 1.5, margin: '8px 0 12px', maxHeight: '58px', overflow: 'hidden' }}>{film.overview}</p>
          <label style={{ fontSize: '12px', color: '#888', fontWeight: 600, display: 'block', marginBottom: '6px' }} htmlFor="request-note">A note for the admin · optional</label>
          <textarea id="request-note" value={note} onChange={e => setNote(e.target.value)} maxLength={500} rows={2} placeholder="e.g. the 2021 version, please"
            style={{ width: '100%', padding: '10px 12px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#fff', fontSize: '14px', fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box' }} />
          <div style={{ display: 'flex', gap: '10px', marginTop: '14px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            <button style={BTN} onClick={onCancel}>Cancel</button>
            <button style={PRIMARY} disabled={busy} onClick={async () => { setBusy(true); await onSend(note.trim()); setBusy(false); }} data-action="send-request">
              {busy ? 'Sending…' : 'Send Request'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── My requests ──────────────────────────────────────────────────────────────

function MyRequests({ list, say, reload, goFind }) {
  if (!list) return <div className="spinner" style={{ margin: '60px auto' }} />;
  if (!list.length) {
    return (
      <div style={{ padding: '36px', textAlign: 'center', borderRadius: '12px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
        <div style={{ color: '#aaa', marginBottom: '14px' }}>You haven't asked for any films yet.</div>
        <button style={PRIMARY} onClick={goFind}>Request a Film</button>
      </div>
    );
  }
  const cancel = async (r) => {
    if (!window.confirm(`Cancel your request for ${r.title}?`)) return;
    try {
      await axios.delete(`/api/requests/${r.id}`);
      say(`Cancelled your request for ${r.title}`);
      reload();
    } catch (err) { say(err.response?.data?.error || "Couldn't cancel it", true); }
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      {list.map(r => <RequestCard key={r.id} r={r} onCancel={() => cancel(r)} />)}
    </div>
  );
}

function RequestCard({ r, onCancel }) {
  const color = STATUS_COLORS[r.status] || '#888';
  return (
    <div data-request={r.title} style={{ display: 'flex', gap: '16px', padding: '16px', borderRadius: '12px', background: 'rgba(255,255,255,0.04)', border: `1px solid ${r.status === 'available' ? 'rgba(0,200,100,0.25)' : 'rgba(255,255,255,0.08)'}` }}>
      <div style={{ width: '72px', flexShrink: 0 }}>
        {r.posterUrl ? <img src={r.posterUrl} alt="" style={{ width: '72px', height: '108px', objectFit: 'cover', borderRadius: '8px', display: 'block' }} />
          : <div style={{ width: '72px', height: '108px', borderRadius: '8px', background: '#1c1c1e' }} />}
      </div>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '17px', fontWeight: 800 }}>{r.title}</span>
          <span style={{ color: '#777', fontSize: '14px' }}>{r.year || ''}</span>
          <StatusPill status={r.status} label={r.label} />
        </div>
        <Steps status={r.status} />
        {r.status === 'downloading' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ flex: 1 }}><ProgressBar status={r.status} progress={r.progress} /></div>
            <span style={{ fontSize: '13px', fontWeight: 700, color, minWidth: '40px', textAlign: 'right' }}>{Math.round((r.progress || 0) * 100)}%</span>
          </div>
        )}
        {['importing', 'adding', 'searching'].includes(r.status) && <ProgressBar status={r.status} progress={r.progress} />}
        {r.detail && <div style={{ fontSize: '13px', color: ['not_found', 'failed', 'missing'].includes(r.status) ? '#ffb38a' : '#aaa', lineHeight: 1.5 }} data-detail>{r.detail}</div>}
        {r.status === 'pending' && <div style={{ fontSize: '13px', color: '#aaa' }}>Waiting for an admin to approve it — you'll get an email either way.</div>}
        {r.status === 'declined' && (
          <div style={{ fontSize: '13px', color: '#ff9a9a', lineHeight: 1.5 }}>
            Not approved{r.decidedBy ? ` by ${r.decidedBy}` : ''}.{r.declineReason ? ` “${r.declineReason}”` : ''}
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginTop: '2px' }}>
          <span style={{ fontSize: '12px', color: '#666' }}>
            {r.mine ? 'You asked' : `Asked for by ${r.requestedBy}`}{r.others ? ` · and ${r.others} other${r.others === 1 ? '' : 's'}` : ''} · {new Date(r.createdAt).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })}
          </span>
          <div style={{ flex: 1 }} />
          {r.status === 'available' && r.movieId && <Link to={`/movie/${r.movieId}`} style={{ ...PRIMARY, textDecoration: 'none' }} data-action="watch">Watch Now</Link>}
          {r.status === 'pending' && <button style={{ ...BTN, color: '#ff8080', border: '1px solid rgba(255,77,77,0.35)' }} onClick={onCancel} data-action="cancel">Cancel Request</button>}
        </div>
      </div>
    </div>
  );
}
