import React, { useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import ServiceLogo, { logoSize } from './ServiceLogo';

// Admin › Streaming Services: which services show on Home (and in what order),
// their banners, and which movies and shows each one has — a title can be on
// several. TMDB can fill in titles that have none yet, for the admin's country.

const CARD = { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', padding: '24px' };
const H3 = { fontSize: '16px', fontWeight: '700', marginBottom: '6px' };
const HINT = { color: '#666', fontSize: '13px', lineHeight: 1.6, marginBottom: '18px' };
const SMALL = { padding: '6px 12px', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer', background: 'transparent', border: '1px solid rgba(255,255,255,0.15)', color: '#ccc', fontFamily: 'inherit' };
const PILL = { padding: '7px 16px', borderRadius: '999px', fontSize: '13px', fontWeight: 700, cursor: 'pointer', background: 'transparent', border: '1px solid rgba(255,255,255,0.12)', color: '#bbb', fontFamily: 'inherit' };
const PILL_ON = { background: '#00c2ff', color: '#000', border: '1px solid #00c2ff' };
const SELECT = { padding: '9px 12px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#fff', fontSize: '14px', colorScheme: 'dark', cursor: 'pointer' };
const PER_PAGE = 30;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

export default function StreamingServicesAdmin({ flash }) {
  const [state, setState] = useState(null);
  const [titles, setTitles] = useState(null);
  const [busy, setBusy] = useState('');
  const fileInput = useRef(null);
  const bannerFor = useRef(null);

  const loadState = () => axios.get('/api/admin/services').then(r => setState(r.data)).catch(() => flash('Failed to load streaming services', true));
  const loadTitles = () => axios.get('/api/admin/services/titles').then(r => setTitles(r.data)).catch(() => {});
  useEffect(() => { loadState(); loadTitles(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // While TMDB is filling titles in, keep the progress (and then the lists) current.
  const running = state?.autofill?.running;
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(async () => {
      const { data } = await axios.get('/api/admin/services/autofill').catch(() => ({ data: null }));
      if (!data) return;
      setState(s => ({ ...s, autofill: data.autofill }));
      if (!data.autofill.running) {
        const a = data.autofill;
        flash(a.titles ? `Put ${plural(a.titles, 'title')} on their streaming services` : 'TMDB had nothing to add');
        loadState(); loadTitles();
      }
    }, 1500);
    return () => clearInterval(timer);
  }, [running]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (name, fn) => {
    setBusy(name);
    try { await fn(); } catch (err) { flash(err.response?.data?.error || 'Something went wrong', true); }
    setBusy('');
  };

  if (!state) return <div style={{ color: '#555', padding: '40px', textAlign: 'center' }}>Loading…</div>;
  const services = state.services;

  const move = (index, dir) => run(`move:${index}`, async () => {
    const ids = services.map(s => s.id);
    const [id] = ids.splice(index, 1);
    ids.splice(index + dir, 0, id);
    setState((await axios.post('/api/admin/services/order', { ids })).data);
  });
  const toggle = (s) => run(`toggle:${s.id}`, async () => {
    setState((await axios.put(`/api/admin/services/${s.id}`, { enabled: !s.enabled })).data);
  });
  const pickBanner = (s) => { bannerFor.current = s; fileInput.current.value = ''; fileInput.current.click(); };
  const uploadBanner = (e) => {
    const file = e.target.files?.[0];
    const s = bannerFor.current;
    if (!file || !s) return;
    const form = new FormData();
    form.append('image', file);
    run(`banner:${s.id}`, async () => {
      setState((await axios.post(`/api/admin/services/${s.id}/banner`, form)).data);
      flash(`Banner set for ${s.name}`);
    });
  };
  const removeBanner = (s) => run(`banner:${s.id}`, async () => {
    setState((await axios.delete(`/api/admin/services/${s.id}/banner`)).data);
    flash(`${s.name} now uses a random title's banner art`);
  });
  const autofill = () => run('autofill', async () => {
    const { data } = await axios.post('/api/admin/services/autofill');
    if (data.autofill.error) flash(data.autofill.error, true);
    else if (!data.autofill.total) flash('Every title with a TMDB match already has its services');
    setState(s => ({ ...s, autofill: data.autofill }));
  });
  const setAutofillNew = (on) => run('settings', async () => {
    setState((await axios.put('/api/admin/services/settings', { autofillNew: on })).data);
  });

  const a = state.autofill;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={CARD}>
        <h3 style={H3}>Streaming Services</h3>
        <p style={HINT}>
          The row of services on Home, just under Continue Watching. A service only appears once it has a title — tick titles
          below, or fill them in from TMDB. Each service's page shows its banner: upload one, or it uses a random title's art.
        </p>
        <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif" style={{ display: 'none' }} onChange={uploadBanner} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '14px' }}>
          {services.map((s, index) => {
            const size = logoSize(s.logo_aspect, 250, 120, 0.2);
            return (
              <div key={s.id} data-service={s.id} style={{ borderRadius: '10px', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.07)', background: 'rgba(255,255,255,0.03)', opacity: s.enabled ? 1 : 0.5 }}>
                <div style={{ position: 'relative', height: '120px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'radial-gradient(120% 90% at 50% 0%, #1f2730 0%, #141418 62%)' }}>
                  {s.banner_url && <img src={s.banner_url} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: 0.35 }} />}
                  <ServiceLogo service={s} {...size} style={{ position: 'relative' }} />
                  <div style={{ position: 'absolute', top: '8px', left: '8px', display: 'flex', gap: '4px' }}>
                    <button style={{ ...SMALL, padding: '2px 8px', background: 'rgba(0,0,0,0.6)' }} disabled={index === 0 || !!busy} onClick={() => move(index, -1)} aria-label={`Move ${s.name} earlier`}>‹</button>
                    <button style={{ ...SMALL, padding: '2px 8px', background: 'rgba(0,0,0,0.6)' }} disabled={index === services.length - 1 || !!busy} onClick={() => move(index, 1)} aria-label={`Move ${s.name} later`}>›</button>
                  </div>
                </div>
                <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                    <div>
                      <div style={{ fontSize: '14px', fontWeight: 700, color: '#ddd' }}>{s.name}</div>
                      <div style={{ fontSize: '12px', color: '#666' }}>{plural(s.movie_count, 'movie')} · {plural(s.show_count, 'show')}</div>
                    </div>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#aaa', cursor: 'pointer' }}>
                      <input type="checkbox" checked={s.enabled} disabled={!!busy} onChange={() => toggle(s)} style={{ accentColor: '#00c2ff' }} />
                      On Home
                    </label>
                  </div>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button style={SMALL} disabled={!!busy} onClick={() => pickBanner(s)}>{s.custom_banner ? 'Change banner' : 'Upload banner'}</button>
                    {s.custom_banner && <button style={SMALL} disabled={!!busy} onClick={() => removeBanner(s)}>Remove</button>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div style={CARD}>
        <h3 style={H3}>Fill in from TMDB</h3>
        <p style={HINT}>
          Looks up where each movie and show streams in <strong style={{ color: '#aaa' }}>{state.country}</strong> (your
          country in Settings › Regional) and ticks the matching services. Only titles with no services yet are changed —
          anything you've set stays as it is.
        </p>
        {a.running ? (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: '#888', marginBottom: '6px' }}>
              <span>Checking {a.done} of {a.total}…</span><span>{plural(a.titles, 'title')} added</span>
            </div>
            <div style={{ height: '6px', borderRadius: '3px', background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
              <div style={{ width: `${a.total ? (a.done / a.total) * 100 : 0}%`, height: '100%', background: 'linear-gradient(90deg, #00c2ff, #7b2fff)', transition: 'width 0.4s' }} />
            </div>
          </div>
        ) : (
          <button onClick={autofill} disabled={!!busy || !state.tmdb}
            style={{ padding: '10px 22px', borderRadius: '8px', border: 'none', background: state.tmdb ? '#00c2ff' : '#333', color: state.tmdb ? '#000' : '#666', fontSize: '14px', fontWeight: 700, cursor: state.tmdb ? 'pointer' : 'not-allowed' }}>
            Fill in from TMDB
          </button>
        )}
        {!state.tmdb && <div style={{ marginTop: '8px', fontSize: '12px', color: '#ffb703' }}>Add a TMDB API key in Settings first.</div>}
        <label style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '16px', fontSize: '14px', color: '#ccc', cursor: 'pointer' }}>
          <input type="checkbox" checked={state.autofillNew} disabled={!!busy} onChange={e => setAutofillNew(e.target.checked)} style={{ accentColor: '#00c2ff' }} />
          Also do this for new titles after every scan
        </label>
      </div>

      <TitleServices titles={titles} services={services} onChanged={(kind, id, list) => {
        setTitles(t => ({ ...t, [kind]: t[kind].map(x => (x.id === id ? { ...x, services: list } : x)) }));
        loadState();
      }} flash={flash} />
    </div>
  );
}

// Every movie / show with a chip per service — click to put it on, or take it off.
function TitleServices({ titles, services, onChanged, flash }) {
  const [kind, setKind] = useState('movies');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all'); // all | none | <service id>
  const [page, setPage] = useState(1);
  const [busyId, setBusyId] = useState(null);
  const topRef = useRef(null);

  const list = titles?.[kind] || [];
  const items = useMemo(() => {
    const q = search.trim().toLowerCase();
    return list.filter(t => (!q || t.title.toLowerCase().includes(q))
      && (filter === 'all' || (filter === 'none' ? t.services.length === 0 : t.services.includes(filter))));
  }, [list, search, filter]);
  useEffect(() => setPage(1), [kind, search, filter]);
  const pageCount = Math.max(1, Math.ceil(items.length / PER_PAGE));
  const current = Math.min(page, pageCount);
  const pageItems = items.slice((current - 1) * PER_PAGE, current * PER_PAGE);

  const toggle = async (t, serviceId) => {
    const next = t.services.includes(serviceId) ? t.services.filter(id => id !== serviceId) : [...t.services, serviceId];
    const type = kind === 'movies' ? 'movie' : 'show';
    setBusyId(`${t.id}`);
    try {
      const { data } = await axios.put(`/api/admin/services/titles/${type}/${t.id}`, { services: next });
      onChanged(kind, t.id, data.services);
    } catch (err) { flash(err.response?.data?.error || 'Failed to update', true); }
    setBusyId(null);
  };

  const onCount = (k) => (titles?.[k] || []).filter(t => t.services.length).length;

  return (
    <div style={CARD} ref={topRef}>
      <h3 style={H3}>Titles</h3>
      <p style={HINT}>Click a service to put a title on it (or take it off). A title can be on as many services as it streams on.</p>
      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '14px' }}>
        {[['movies', 'Movies'], ['shows', 'TV Shows']].map(([k, label]) => (
          <button key={k} onClick={() => setKind(k)} style={{ ...PILL, ...(kind === k ? PILL_ON : {}) }}>
            {label} · {onCount(k)} of {(titles?.[k] || []).length}
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '14px' }}>
        <input placeholder={`Search ${kind === 'movies' ? 'movies' : 'shows'}…`} value={search} onChange={e => setSearch(e.target.value)} aria-label="Search titles"
          style={{ flex: '1 1 200px', padding: '9px 14px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#fff', fontSize: '14px', outline: 'none' }} />
        <select value={filter} onChange={e => setFilter(e.target.value)} style={SELECT} aria-label="Filter by service">
          <option value="all">All titles</option>
          <option value="none">Not on any service</option>
          {services.map(s => <option key={s.id} value={s.id}>On {s.name}</option>)}
        </select>
      </div>

      {titles === null ? <div className="spinner" style={{ margin: '30px auto' }} /> : (
        <>
          <div style={{ fontSize: '13px', color: '#777', marginBottom: '10px' }}>
            {items.length ? `Showing ${(current - 1) * PER_PAGE + 1}–${Math.min(items.length, current * PER_PAGE)} of ${items.length}` : 'No titles match.'}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {pageItems.map(t => (
              <div key={t.id} data-title={t.title} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '8px 12px', borderRadius: '8px', flexWrap: 'wrap',
                background: t.services.length ? 'rgba(0,194,255,0.04)' : 'rgba(255,255,255,0.02)', border: `1px solid ${t.services.length ? 'rgba(0,194,255,0.15)' : 'rgba(255,255,255,0.05)'}`,
                opacity: busyId === `${t.id}` ? 0.6 : 1 }}>
                <div style={{ width: '34px', height: '50px', borderRadius: '4px', overflow: 'hidden', background: '#1e1e1e', flexShrink: 0 }}>
                  {t.poster_url && <img src={t.poster_url} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />}
                </div>
                <div style={{ flex: '1 1 160px', minWidth: 0 }}>
                  <div style={{ fontSize: '14px', fontWeight: 600, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</div>
                  <div style={{ fontSize: '12px', color: '#555' }}>{t.year || ''}</div>
                </div>
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  {services.map(s => {
                    const on = t.services.includes(s.id);
                    const size = logoSize(s.logo_aspect, 74, 30, 0.3, 0.86, 0.62);
                    return (
                      <button key={s.id} onClick={() => toggle(t, s.id)} disabled={busyId === `${t.id}`}
                        title={`${on ? 'On' : 'Not on'} ${s.name}`} aria-label={`${s.name} — ${t.title}`} aria-pressed={on}
                        style={{ width: '74px', height: '30px', borderRadius: '8px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
                          background: on ? 'rgba(0,194,255,0.12)' : 'transparent', border: `1px solid ${on ? 'rgba(0,194,255,0.55)' : 'rgba(255,255,255,0.08)'}` }}>
                        <ServiceLogo service={s} {...size} color={on ? undefined : '#4a4a50'} />
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          {pageCount > 1 && (
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', alignItems: 'center', marginTop: '14px' }}>
              <button style={SMALL} disabled={current === 1} onClick={() => { setPage(current - 1); topRef.current?.scrollIntoView({ behavior: 'smooth' }); }}>‹ Prev</button>
              <span style={{ fontSize: '13px', color: '#888' }}>Page {current} of {pageCount}</span>
              <button style={SMALL} disabled={current === pageCount} onClick={() => { setPage(current + 1); topRef.current?.scrollIntoView({ behavior: 'smooth' }); }}>Next ›</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
