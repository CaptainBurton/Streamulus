import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import Navbar from '../components/Navbar';
import { StatusPill, ProgressBar, Steps, RequestStyles, STATUS_COLORS } from '../components/RequestStatus';
import { FilmsIcon, ActorsIcon, SeriesIcon } from '../components/RequestIcons';
import TVChecklist from '../components/TVChecklist';
import Dropdown from '../components/Dropdown';

// Requests: find a film or series that isn't in the library — by title, actor or
// director, year or genre — open it to read about it, and ask for it (a series
// whole, or a single season once the show is on Streamulus). An admin approves or
// declines it (you're emailed either way); approved ones download by themselves
// and you can follow them here — series episode by episode — until they're ready.
const ACTIVE = ['pending', 'searching', 'waiting_release', 'not_found', 'downloading', 'importing', 'failed', 'adding', 'missing'];
const BTN = { padding: '9px 16px', borderRadius: '8px', fontSize: '13px', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', border: '1px solid rgba(255,255,255,0.15)', background: 'transparent', color: '#ddd', whiteSpace: 'nowrap' };
const PRIMARY = { ...BTN, background: '#00c2ff', border: '1px solid #00c2ff', color: '#000' };
const CHIP = { ...BTN, borderRadius: '999px', padding: '7px 14px', fontSize: '13px' };
const CHIP_ON = { background: '#fff', color: '#000', border: '1px solid #fff' };
const ICON_CHIP = { display: 'inline-flex', alignItems: 'center', gap: '7px' };

export default function Requests() {
  const [config, setConfig] = useState(null);
  const [tab, setTab] = useState('find');
  const [mine, setMine] = useState(null);
  const [flash, setFlash] = useState(null);
  const [openItem, setOpenItem] = useState(null); // the pop-up: { kind: 'movie' | 'tv', id }
  const [asking, setAsking] = useState(null); // the request dialog: { item, scope, season }
  const [stamp, setStamp] = useState(0); // bumped after a request, so lists refresh
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

  // Ask for a film, a series or one season (from a card, a pop-up or an actor's page).
  const send = async (item, note, scope = null, season = null) => {
    const tv = item.mediaType === 'tv';
    const what = tv && scope === 'season' ? `${item.title} — Season ${season}` : item.title;
    try {
      const r = await axios.post('/api/requests', tv
        ? { mediaType: 'tv', tmdbId: item.tmdbId, scope: scope || 'series', season, note }
        : { tmdbId: item.tmdbId, note });
      setAsking(null);
      say(r.data.joined ? `Someone had already asked for ${what} — you'll hear when it's ready too`
        : r.data.already ? `You've already asked for ${what}` : `Requested ${what} — you'll get an email when an admin decides`);
      loadMine();
      setStamp(s => s + 1);
      return true;
    } catch (err) {
      say(err.response?.data?.error || "Couldn't send the request", true);
      return false;
    }
  };
  // The button under a title: Request (asks for a note), See Progress, or Me Too.
  // A series already on Streamulus opens its page instead, to choose seasons.
  const act = (item, scope = null, season = null) => {
    const tv = item.mediaType === 'tv';
    if (tv && !scope && !item.request && item.showId) { setOpenItem({ kind: 'tv', id: item.tmdbId }); return; }
    const req = item.request;
    if (!req) setAsking({ item, scope: tv ? (scope || 'series') : null, season });
    else if (req.mine) { setOpenItem(null); setTab('mine'); loadMine(); } else send(item, '', req.scope || scope, req.season ?? season);
  };
  const open = (id, kind = 'movie') => setOpenItem({ kind, id });
  const findLabel = config?.films && config?.tv ? 'Request a Film or Series' : config?.tv ? 'Request a Series' : 'Request a Film';

  return (
    <div style={{ minHeight: '100vh', background: '#0f0f0f', color: '#fff' }}>
      <Navbar />
      <RequestStyles />
      <div style={{ maxWidth: '1100px', margin: '0 auto', padding: '96px 16px 64px' }}>
        <h1 style={{ fontSize: '32px', fontWeight: 800, marginBottom: '6px' }}>Requests</h1>
        <p style={{ color: '#777', fontSize: '14px', marginBottom: '22px', lineHeight: 1.6, maxWidth: '720px' }}>
          Ask for a film or series that isn't on Streamulus yet — search by title, actor or director, or browse by year and genre, and open one to read about it.
          Once an admin approves it, it downloads by itself; follow it here (series episode by episode), and you'll get an email when it's ready to watch.
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
              {[['find', findLabel], ['mine', `My Requests${counts.total ? ` · ${counts.total}` : ''}`]].map(([key, label]) => (
                <button key={key} role="tab" aria-selected={tab === key} onClick={() => { setTab(key); if (key === 'mine') loadMine(); }}
                  style={{ ...BTN, borderRadius: '999px', padding: '8px 18px', fontSize: '14px', ...(tab === key ? CHIP_ON : {}) }}>
                  {label}
                  {key === 'mine' && counts.active > 0 && tab !== 'mine' && (
                    <span style={{ marginLeft: '8px', padding: '1px 7px', borderRadius: '10px', background: '#00c2ff', color: '#000', fontSize: '11px' }}>{counts.active} on the go</span>
                  )}
                </button>
              ))}
            </div>
            {tab === 'find'
              ? <FindFilm config={config} say={say} stamp={stamp} onOpen={open} onAct={act} />
              : <MyRequests list={mine} say={say} reload={loadMine} goFind={() => setTab('find')} onOpen={open} findLabel={findLabel} />}
          </>
        )}
      </div>
      {openItem?.kind === 'movie' && <FilmModal tmdbId={openItem.id} stamp={stamp} onClose={() => setOpenItem(null)} onAct={act} onOpen={(id) => open(id, 'movie')} say={say} />}
      {openItem?.kind === 'tv' && <ShowModal tmdbId={openItem.id} stamp={stamp} onClose={() => setOpenItem(null)} onAct={act} say={say} />}
      {asking && <AskDialog asking={asking} onCancel={() => setAsking(null)} onSend={(note) => send(asking.item, note, asking.scope, asking.season)} />}
    </div>
  );
}

// ── Find a film ──────────────────────────────────────────────────────────────

function FindFilm({ config, say, stamp, onOpen, onAct }) {
  const [mode, setMode] = useState(config.films ? 'films' : 'series'); // films | series | people
  const [query, setQuery] = useState('');
  const [year, setYear] = useState('');
  const [genre, setGenre] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [person, setPerson] = useState(null); // an actor's page
  const latest = useRef(0);
  const text = query.trim();
  const years = useMemo(() => { const now = new Date().getFullYear(); return Array.from({ length: now + 2 - 1920 }, (_, i) => now + 1 - i); }, []);
  const genres = (mode === 'series' ? config.tvGenres : config.genres) || [];
  const genreName = genres.find(g => String(g.id) === String(genre))?.name;
  const pick = (m) => { if (m !== mode) { setMode(m); setGenre(''); setData(null); } };
  const noun = mode === 'series' ? 'series' : 'films';

  const run = () => {
    const ask = ++latest.current;
    if (mode === 'people' && !text) { setData({ people: [] }); return; }
    setLoading(true);
    const req = mode === 'people'
      ? axios.get('/api/requests/people', { params: { q: text } })
      : axios.get('/api/requests/search', { params: { q: text, year: year || undefined, genre: genre || undefined, type: mode === 'series' ? 'tv' : undefined } });
    req.then(r => { if (ask === latest.current) setData(r.data); })
      .catch(err => { if (ask === latest.current) say(err.response?.data?.error || "Couldn't search right now", true); })
      .finally(() => { if (ask === latest.current) setLoading(false); });
  };
  useEffect(() => {
    const t = setTimeout(run, text ? 400 : 0);
    return () => clearTimeout(t);
  }, [text, mode, year, genre, stamp]); // eslint-disable-line react-hooks/exhaustive-deps

  if (person) return <PersonPanel personId={person} stamp={stamp} onBack={() => setPerson(null)} onOpen={onOpen} onAct={onAct} say={say} />;

  const heading = mode === 'people'
    ? (text ? `People matching “${text}”` : 'Actors & Directors')
    : text ? `Results for “${text}”${year ? ` · ${year}` : ''}${genreName ? ` · ${genreName}` : ''}`
      : year && genreName ? `${genreName} ${noun} from ${year}` : year ? `${mode === 'series' ? 'Series' : 'Films'} from ${year}` : genreName ? `${genreName} ${noun}` : mode === 'series' ? 'Popular series this week' : 'Popular this week';

  return (
    <div>
      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '14px' }}>
        <div style={{ position: 'relative', flex: '1 1 320px', maxWidth: '560px' }}>
          <input value={query} onChange={e => setQuery(e.target.value)} aria-label="Search" autoFocus
            placeholder={mode === 'people' ? 'Search actors and directors…' : mode === 'series' ? 'Search for a series…' : 'Search for a film…'}
            style={{ width: '100%', padding: '13px 16px 13px 44px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '10px', color: '#fff', fontSize: '16px', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }} />
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#888" strokeWidth="2" strokeLinecap="round" style={{ position: 'absolute', left: '15px', top: '50%', transform: 'translateY(-50%)' }} aria-hidden="true">
            <circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" />
          </svg>
        </div>
      </div>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '20px' }} data-section="filters">
        {config.films && <button style={{ ...CHIP, ...ICON_CHIP, ...(mode === 'films' ? CHIP_ON : {}) }} onClick={() => pick('films')} data-mode="films"><FilmsIcon /> Films</button>}
        {config.tv && <button style={{ ...CHIP, ...ICON_CHIP, ...(mode === 'series' ? CHIP_ON : {}) }} onClick={() => pick('series')} data-mode="series"><SeriesIcon /> Series</button>}
        {config.films && <button style={{ ...CHIP, ...ICON_CHIP, ...(mode === 'people' ? CHIP_ON : {}) }} onClick={() => pick('people')} data-mode="people"><ActorsIcon /> Actors & Directors</button>}
        {mode !== 'people' && (
          <>
            <span style={{ width: '1px', height: '22px', background: 'rgba(255,255,255,0.15)', margin: '0 4px' }} />
            <Dropdown name="year" ariaLabel="Year" label="Any year" value={year} onChange={setYear} menuWidth={160}
              options={[{ value: '', label: 'Any year' }, ...years.map(y => ({ value: String(y), label: String(y) }))]} />
            <Dropdown name="genre" ariaLabel="Genre" label="Any genre" value={genre} onChange={setGenre} menuWidth={220}
              options={[{ value: '', label: 'Any genre' }, ...genres.map(g => ({ value: String(g.id), label: g.name }))]} />
            {(year || genre) && <button style={{ ...CHIP, color: '#999' }} onClick={() => { setYear(''); setGenre(''); }}>Clear</button>}
          </>
        )}
      </div>
      <div style={{ fontSize: '18px', fontWeight: 800, marginBottom: '14px' }}>
        {heading}{loading && <span style={{ fontSize: '13px', color: '#777', fontWeight: 600 }}> · searching…</span>}
      </div>

      {mode === 'people' ? (
        <>
          {!text && <div style={{ color: '#777' }}>Search for an actor or director to see all of their films.</div>}
          {text && data?.people?.length === 0 && !loading && <div style={{ color: '#777' }}>Nobody found — check the spelling.</div>}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(300px, 100%), 1fr))', gap: '10px' }}>
            {(data?.people || []).map(p => (
              <button key={p.id} onClick={() => setPerson(p.id)} data-person={p.name}
                style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '12px', borderRadius: '14px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', color: '#fff', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit' }}>
                <Avatar url={p.profileUrl} size={56} />
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', fontWeight: 700, fontSize: '15px' }}>{p.name}</span>
                  <span style={{ display: 'block', fontSize: '13px', color: '#888', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {[p.department === 'Acting' ? 'Actor' : p.department, p.knownFor.join(', ')].filter(Boolean).join(' · ')}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          {data?.results?.length === 0 && !loading && <div style={{ color: '#777', padding: '20px 0' }}>No {noun} found — try another spelling, or change the year or genre.</div>}
          <FilmGrid films={data?.results || []} onOpen={onOpen} onAct={onAct} />
        </>
      )}
    </div>
  );
}

function FilmGrid({ films, onOpen, onAct }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(160px, 45%), 1fr))', gap: '18px 16px' }}>
      {films.map(film => {
        const rating = film.rating > 0 ? film.rating.toFixed(1) : null;
        return (
          <div key={`${film.mediaType || 'movie'}-${film.tmdbId}`} {...(film.mediaType === 'tv' ? { 'data-show': film.title } : { 'data-film': film.title })} style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <button className="req-poster" onClick={() => onOpen(film.tmdbId, film.mediaType === 'tv' ? 'tv' : 'movie')} aria-label={`About ${film.title}`} data-action={film.mediaType === 'tv' ? 'open-show' : 'open-film'}>
              <div className="req-art">
                <div className="req-art-clip">
                  {film.posterUrl
                    ? <img src={film.posterUrl} alt="" loading="lazy" onError={e => { e.currentTarget.style.display = 'none'; }} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                    : <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#555', fontSize: '13px', padding: '10px', textAlign: 'center' }}>{film.title}</div>}
                  {rating && (
                    <div className="req-badge" style={{ position: 'absolute', top: '8px', right: '8px', background: 'rgba(0,0,0,0.75)', borderRadius: '4px', padding: '2px 6px', fontSize: '11px', fontWeight: 600, color: '#00c2ff' }}>★ {rating}</div>
                  )}
                  <div className="req-hover" aria-hidden="true">
                    <div style={{ fontSize: '13px', fontWeight: 600, color: '#fff', marginBottom: '4px', lineHeight: 1.3 }}>{film.title}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      {film.year && <span style={{ fontSize: '11px', color: '#aaa' }}>{film.year}</span>}
                      {rating && <span style={{ fontSize: '11px', color: '#00c2ff', fontWeight: 600 }}>★ {rating}</span>}
                    </div>
                  </div>
                </div>
              </div>
              {film.request && <div style={{ marginTop: '10px', display: 'flex' }}><StatusPill status={film.request.status} label={film.request.label} /></div>}
              {!film.request && film.showId && <div style={{ marginTop: '10px', display: 'flex' }}><OnServerPill /></div>}
              <div style={{ fontWeight: 700, fontSize: '14px', marginTop: film.request || film.showId ? '6px' : '10px', lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{film.title}</div>
              <div style={{ fontSize: '12px', color: '#888', marginBottom: '8px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{[film.year, film.role].filter(Boolean).join(' · ') || '—'}</div>
            </button>
            <div style={{ marginTop: 'auto' }}>
              {film.request
                ? <button style={{ ...BTN, width: '100%' }} onClick={() => onAct(film)} data-action={film.request.mine ? 'progress' : 'join'}>{film.request.mine ? 'See Progress' : 'Me Too'}</button>
                : film.mediaType === 'tv' && film.showId
                  ? <button style={{ ...BTN, width: '100%' }} onClick={() => onAct(film)} data-action="seasons">Request Seasons</button>
                  : <button style={{ ...PRIMARY, width: '100%' }} onClick={() => onAct(film)} data-action="request">{film.mediaType === 'tv' ? 'Request Series' : 'Request'}</button>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// "On Streamulus" — a series that's already here (some seasons, at least).
const OnServerPill = () => (
  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '3px 10px', borderRadius: '999px', fontSize: '11px', fontWeight: 700, letterSpacing: '0.4px', textTransform: 'uppercase', color: '#00c864', border: '1px solid #00c86455', background: '#00c86414', whiteSpace: 'nowrap' }} data-on-server>
    ✓ On Streamulus
  </span>
);

const Avatar = ({ url, size }) => (
  <span style={{ width: size, height: size, borderRadius: '50%', overflow: 'hidden', flexShrink: 0, background: 'rgba(255,255,255,0.08)', display: 'inline-flex', verticalAlign: 'top', alignItems: 'center', justifyContent: 'center', color: '#555', fontSize: size / 2.6 }}>
    {url ? <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : '👤'}
  </span>
);

// An actor's (or director's) page: who they are, and their films not on the server yet.
function PersonPanel({ personId, stamp, onBack, onOpen, onAct, say }) {
  const [data, setData] = useState(null);
  const [whole, setWhole] = useState(false);
  useEffect(() => {
    axios.get(`/api/requests/person/${personId}`).then(r => setData(r.data)).catch(err => { say(err.response?.data?.error || "Couldn't load", true); onBack(); });
  }, [personId, stamp]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!data) return <div className="spinner" style={{ margin: '60px auto' }} />;
  const p = data.person;
  const role = p.department === 'Acting' ? 'Actor' : p.department === 'Directing' ? 'Director' : p.department;
  return (
    <div data-section="person">
      <button style={{ ...CHIP, marginBottom: '18px' }} onClick={onBack}>← Back to search</button>
      <div style={{ display: 'flex', gap: '20px', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap' }}>
        <Avatar url={p.profileUrl} size={120} />
        <div>
          <div style={{ fontSize: '28px', fontWeight: 800 }}>{p.name}</div>
          {role && <div style={{ color: '#00c2ff', fontWeight: 700, marginTop: '2px' }}>{role}</div>}
          {(p.birthday || p.placeOfBirth) && (
            <div style={{ color: '#888', fontSize: '13px', marginTop: '4px' }}>
              {[p.birthday && `Born ${new Date(p.birthday).toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' })}`, p.placeOfBirth].filter(Boolean).join(' · ')}
            </div>
          )}
        </div>
      </div>
      {p.biography && (
        <p style={{ color: '#bbb', fontSize: '14px', lineHeight: 1.7, maxWidth: '860px', margin: '0 0 22px' }}>
          {whole || p.biography.length < 400 ? p.biography : `${p.biography.slice(0, 400)}…`}
          {p.biography.length >= 400 && <button onClick={() => setWhole(w => !w)} style={{ background: 'none', border: 'none', color: '#00c2ff', cursor: 'pointer', fontWeight: 700, fontFamily: 'inherit' }}>{whole ? 'Less' : 'More'}</button>}
        </p>
      )}
      <div style={{ fontSize: '18px', fontWeight: 800, marginBottom: '4px' }}>Films to request</div>
      {data.onServer > 0 && <div style={{ color: '#00c864', fontSize: '13px', marginBottom: '14px' }}>✓ {data.onServer} of their films {data.onServer === 1 ? 'is' : 'are'} already on Streamulus</div>}
      {data.films.length === 0 ? <div style={{ color: '#777' }}>Everything of theirs is already on Streamulus.</div>
        : <FilmGrid films={data.films} onOpen={onOpen} onAct={onAct} />}
    </div>
  );
}

// A film's page: backdrop, poster, facts, synopsis, director, cast, trailer, Request.
function FilmModal({ tmdbId, stamp, onClose, onAct, onOpen, say }) {
  const [film, setFilm] = useState(null);
  const [personFilms, setPersonFilms] = useState(null); // tapping a person shows their films here
  useEffect(() => {
    setFilm(null); setPersonFilms(null);
    axios.get(`/api/requests/film/${tmdbId}`).then(r => setFilm(r.data.film)).catch(err => { say(err.response?.data?.error || "Couldn't load this film", true); onClose(); });
  }, [tmdbId, stamp]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = overflow; };
  }, [onClose]);
  const facts = film ? [film.year, film.runtime ? (film.runtime >= 60 ? `${Math.floor(film.runtime / 60)}h ${film.runtime % 60}m` : `${film.runtime}m`) : null, film.certification].filter(Boolean).join(' · ') : '';

  return (
    // Above the menu bar (1000), with room above and below so it never touches the top of the window.
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', overflowY: 'auto', padding: 'max(72px, 9vh) 16px 56px' }}>
      <div onClick={e => e.stopPropagation()} role="dialog" aria-label={film?.title || 'Film'} data-dialog="film"
        style={{ width: '100%', maxWidth: '880px', background: '#141418', borderRadius: '18px', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 30px 80px rgba(0,0,0,0.6)' }}>
        {!film ? <div className="spinner" style={{ margin: '80px auto' }} /> : personFilms ? (
          <div style={{ padding: '22px' }}>
            <PersonPanel personId={personFilms} stamp={stamp} onBack={() => setPersonFilms(null)} onOpen={(id) => { setPersonFilms(null); onOpen(id); }} onAct={onAct} say={say} />
          </div>
        ) : (
          <>
            <div style={{ position: 'relative', height: 'min(320px, 45vw)', background: '#000' }}>
              {(film.backdropUrl || film.posterUrl) && <img src={film.backdropUrl || film.posterUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', opacity: 0.85 }} />}
              <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(0,0,0,0.35) 0%, transparent 35%, rgba(20,20,24,0.9) 85%, #141418 100%)' }} />
              <button onClick={onClose} aria-label="Close" style={{ position: 'absolute', top: '14px', right: '14px', width: '36px', height: '36px', borderRadius: '50%', border: 'none', background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: '18px', cursor: 'pointer' }}>✕</button>
            </div>
            <div style={{ padding: '0 26px 28px', marginTop: '-90px', position: 'relative' }}>
              <div style={{ display: 'flex', gap: '20px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                {film.posterUrl && <img src={film.posterUrl} alt="" style={{ width: '130px', height: '195px', objectFit: 'cover', borderRadius: '12px', boxShadow: '0 12px 30px rgba(0,0,0,0.6)', border: '1px solid rgba(255,255,255,0.12)' }} />}
                <div style={{ flex: '1 1 260px', minWidth: 0 }}>
                  <div style={{ fontSize: '30px', fontWeight: 900, lineHeight: 1.15 }}>{film.title}</div>
                  <div style={{ color: '#bbb', fontSize: '14px', marginTop: '6px', fontWeight: 600 }}>{facts}</div>
                  {film.rating > 0 && <div style={{ fontSize: '14px', marginTop: '4px' }}><span style={{ color: '#ffd166' }}>★</span> <strong>{film.rating.toFixed(1)}</strong> <span style={{ color: '#888' }}>· {film.voteCount?.toLocaleString()} ratings</span></div>}
                </div>
              </div>

              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center', margin: '22px 0' }}>
                {film.movieId ? <Link to={`/movie/${film.movieId}`} style={{ ...PRIMARY, padding: '12px 22px', fontSize: '15px', textDecoration: 'none' }}>▶ On Streamulus — Watch</Link>
                  : film.request ? (
                    <>
                      <StatusPill status={film.request.status} label={film.request.label} />
                      <span style={{ color: '#aaa', fontSize: '14px' }}>{film.request.mine ? "You've asked for this film" : 'Someone has already asked for this film'}</span>
                      <button style={{ ...(film.request.mine ? BTN : PRIMARY), padding: '12px 22px', fontSize: '15px' }} onClick={() => onAct(film)} data-action={film.request.mine ? 'progress' : 'join'}>
                        {film.request.mine ? 'See Progress' : 'Me Too — Tell Me When It\'s Ready'}
                      </button>
                    </>
                  ) : <button style={{ ...PRIMARY, padding: '12px 22px', fontSize: '15px' }} onClick={() => onAct(film)} data-action="request-film">＋ Request This Film</button>}
                {film.trailer && <a href={film.trailer.url} target="_blank" rel="noreferrer" style={{ ...BTN, padding: '12px 22px', fontSize: '15px', textDecoration: 'none' }} data-action="trailer">▶ Watch Trailer</a>}
              </div>

              {film.tagline && <div style={{ fontStyle: 'italic', color: '#ddd', fontSize: '17px', marginBottom: '14px' }}>“{film.tagline}”</div>}
              {film.genres.length > 0 && (
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '18px' }}>
                  {film.genres.map(g => <span key={g} style={{ padding: '5px 12px', borderRadius: '999px', background: 'rgba(255,255,255,0.08)', fontSize: '13px', fontWeight: 600 }}>{g}</span>)}
                </div>
              )}
              {film.overview && (
                <>
                  <div style={{ fontSize: '17px', fontWeight: 800, marginBottom: '6px' }}>Synopsis</div>
                  <p style={{ color: '#ccc', fontSize: '15px', lineHeight: 1.7, margin: '0 0 20px' }} data-synopsis>{film.overview}</p>
                </>
              )}
              {film.directors.length > 0 && (
                <div style={{ marginBottom: '20px', fontSize: '15px' }}>
                  <span style={{ fontWeight: 800 }}>{film.directors.length === 1 ? 'Director' : 'Directors'}: </span>
                  {film.directors.map((d, i) => (
                    <React.Fragment key={d.id}>
                      {i > 0 && ', '}
                      <button onClick={() => setPersonFilms(d.id)} style={{ background: 'none', border: 'none', color: '#00c2ff', fontWeight: 700, cursor: 'pointer', fontSize: '15px', padding: 0, fontFamily: 'inherit' }}>{d.name}</button>
                    </React.Fragment>
                  ))}
                </div>
              )}
              {film.cast.length > 0 && (
                <>
                  <div style={{ fontSize: '17px', fontWeight: 800, marginBottom: '10px' }}>Cast</div>
                  <div style={{ display: 'flex', gap: '14px', overflowX: 'auto', paddingBottom: '6px' }}>
                    {film.cast.map(c => (
                      <button key={c.id} className="req-face" onClick={() => setPersonFilms(c.id)} data-cast={c.name}
                        style={{ width: '92px', flexShrink: 0, background: 'none', border: 'none', color: '#fff', cursor: 'pointer', textAlign: 'center', fontFamily: 'inherit', padding: '6px 0 0', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                        <Avatar url={c.profileUrl} size={76} />
                        <div style={{ fontSize: '12px', fontWeight: 700, marginTop: '6px', lineHeight: 1.3 }}>{c.name}</div>
                        {c.character && <div style={{ fontSize: '11px', color: '#888', lineHeight: 1.3 }}>{c.character}</div>}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// A series' page: backdrop, poster, facts, synopsis, cast, trailer — and its
// seasons: how much of each is on Streamulus, and asking for the whole series
// or (once the show is here) a single season. Open a season to see its episodes.
function ShowModal({ tmdbId, stamp, onClose, onAct, say }) {
  const [show, setShow] = useState(null);
  const [opened, setOpened] = useState(null); // a season number
  const [episodes, setEpisodes] = useState({}); // season → episodes
  useEffect(() => {
    setShow(null);
    axios.get(`/api/requests/show/${tmdbId}`).then(r => setShow(r.data.show)).catch(err => { say(err.response?.data?.error || "Couldn't load this series", true); onClose(); });
  }, [tmdbId, stamp]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = overflow; };
  }, [onClose]);
  const toggleSeason = (n) => {
    setOpened(o => (o === n ? null : n));
    if (!episodes[n]) axios.get(`/api/requests/show/${tmdbId}/season/${n}`).then(r => setEpisodes(e => ({ ...e, [n]: r.data.episodes }))).catch(() => {});
  };
  const yearOf = (d) => (d ? new Date(d).getFullYear() : null);
  const years = show ? (() => {
    const a = yearOf(show.firstAirDate); const b = yearOf(show.lastAirDate);
    if (!a) return null;
    return show.status === 'Returning Series' ? `${a}–` : b && b !== a ? `${a}–${b}` : String(a);
  })() : null;
  const facts = show ? [years, `${show.numberOfSeasons} season${show.numberOfSeasons === 1 ? '' : 's'}`, show.certification,
    show.status === 'Returning Series' ? 'Still running' : show.status === 'Ended' ? 'Ended' : show.status === 'Canceled' ? 'Cancelled' : null].filter(Boolean).join(' · ') : '';
  const item = show ? { ...show, mediaType: 'tv' } : null;

  return (
    // Above the menu bar (1000), with room above and below.
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', overflowY: 'auto', padding: 'max(72px, 9vh) 16px 56px' }}>
      <div onClick={e => e.stopPropagation()} role="dialog" aria-label={show?.title || 'Series'} data-dialog="show"
        style={{ width: '100%', maxWidth: '880px', background: '#141418', borderRadius: '18px', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 30px 80px rgba(0,0,0,0.6)' }}>
        {!show ? <div className="spinner" style={{ margin: '80px auto' }} /> : (
          <>
            <div style={{ position: 'relative', height: 'min(320px, 45vw)', background: '#000' }}>
              {(show.backdropUrl || show.posterUrl) && <img src={show.backdropUrl || show.posterUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', opacity: 0.85 }} />}
              <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(0,0,0,0.35) 0%, transparent 35%, rgba(20,20,24,0.9) 85%, #141418 100%)' }} />
              <button onClick={onClose} aria-label="Close" style={{ position: 'absolute', top: '14px', right: '14px', width: '36px', height: '36px', borderRadius: '50%', border: 'none', background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: '18px', cursor: 'pointer' }}>✕</button>
            </div>
            <div style={{ padding: '0 26px 28px', marginTop: '-90px', position: 'relative' }}>
              <div style={{ display: 'flex', gap: '20px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                {show.posterUrl && <img src={show.posterUrl} alt="" style={{ width: '130px', height: '195px', objectFit: 'cover', borderRadius: '12px', boxShadow: '0 12px 30px rgba(0,0,0,0.6)', border: '1px solid rgba(255,255,255,0.12)' }} />}
                <div style={{ flex: '1 1 260px', minWidth: 0 }}>
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '11px', fontWeight: 800, letterSpacing: '1.2px', color: '#00c2ff', marginBottom: '4px' }}><SeriesIcon size={11} /> SERIES</div>
                  <div style={{ fontSize: '30px', fontWeight: 900, lineHeight: 1.15 }}>{show.title}</div>
                  <div style={{ color: '#bbb', fontSize: '14px', marginTop: '6px', fontWeight: 600 }} data-facts>{facts}</div>
                  {(show.rating > 0 || show.networks.length > 0) && (
                    <div style={{ fontSize: '14px', marginTop: '4px' }}>
                      {show.rating > 0 && <><span style={{ color: '#ffd166' }}>★</span> <strong>{show.rating.toFixed(1)}</strong> <span style={{ color: '#888' }}>· {show.voteCount?.toLocaleString()} ratings</span></>}
                      {show.networks.length > 0 && <span style={{ color: '#888' }}>{show.rating > 0 ? ' · ' : ''}{show.networks.join(', ')}</span>}
                    </div>
                  )}
                </div>
              </div>

              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center', margin: '22px 0' }}>
                {show.onServer && <Link to={`/tv/${show.onServer.showId}`} style={{ ...BTN, padding: '12px 22px', fontSize: '15px', textDecoration: 'none' }} data-action="watch-show">▶ On Streamulus — Watch</Link>}
                {show.request ? (
                  <>
                    <StatusPill status={show.request.status} label={show.request.label} />
                    <span style={{ color: '#aaa', fontSize: '14px' }}>{show.request.mine ? "You've asked for the whole series" : 'Someone has asked for the whole series'}</span>
                    <button style={{ ...(show.request.mine ? BTN : PRIMARY), padding: '12px 22px', fontSize: '15px' }} onClick={() => onAct(item)} data-action={show.request.mine ? 'progress' : 'join'}>
                      {show.request.mine ? 'See Progress' : 'Me Too — Tell Me When It\'s Ready'}
                    </button>
                  </>
                ) : show.canRequestSeries && (
                  <button style={{ ...PRIMARY, padding: '12px 22px', fontSize: '15px' }} onClick={() => onAct({ ...item, request: null }, 'series')} data-action="request-series">
                    ＋ {show.onServer ? 'Request All Missing Seasons' : 'Request Entire Series'}
                  </button>
                )}
                {show.trailer && <a href={show.trailer.url} target="_blank" rel="noreferrer" style={{ ...BTN, padding: '12px 22px', fontSize: '15px', textDecoration: 'none' }} data-action="trailer">▶ Watch Trailer</a>}
              </div>

              {show.tagline && <div style={{ fontStyle: 'italic', color: '#ddd', fontSize: '17px', marginBottom: '14px' }}>“{show.tagline}”</div>}
              {show.genres.length > 0 && (
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '18px' }}>
                  {show.genres.map(g => <span key={g} style={{ padding: '5px 12px', borderRadius: '999px', background: 'rgba(255,255,255,0.08)', fontSize: '13px', fontWeight: 600 }}>{g}</span>)}
                </div>
              )}
              {show.overview && (
                <>
                  <div style={{ fontSize: '17px', fontWeight: 800, marginBottom: '6px' }}>Synopsis</div>
                  <p style={{ color: '#ccc', fontSize: '15px', lineHeight: 1.7, margin: '0 0 20px' }} data-synopsis>{show.overview}</p>
                </>
              )}

              <div style={{ fontSize: '17px', fontWeight: 800, marginBottom: '6px' }}>Seasons</div>
              {!show.onServer && (
                <div style={{ fontSize: '13px', color: '#999', marginBottom: '10px', lineHeight: 1.5 }} data-season-note>
                  Single seasons can be asked for once the show is on Streamulus — request the whole series to get started.
                </div>
              )}
              <div data-section="seasons" style={{ display: 'flex', flexDirection: 'column', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.08)', overflow: 'hidden', marginBottom: '22px' }}>
                {show.seasons.map((x, i) => {
                  const isOpen = opened === x.season;
                  return (
                    <div key={x.season} data-season={x.season} style={{ borderTop: i ? '1px solid rgba(255,255,255,0.06)' : 'none' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '12px 14px', background: isOpen ? 'rgba(255,255,255,0.03)' : 'transparent', flexWrap: 'wrap' }}>
                        <button type="button" onClick={() => toggleSeason(x.season)} aria-expanded={isOpen} className="tvc-row" data-action="open-season"
                          style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: '1 1 260px', minWidth: 0, background: 'none', border: 'none', padding: 0, color: '#fff', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit' }}>
                          {x.posterUrl ? <img src={x.posterUrl} alt="" style={{ width: '40px', height: '60px', objectFit: 'cover', borderRadius: '6px', flexShrink: 0, background: '#1c1c1e' }} />
                            : <div style={{ width: '40px', height: '60px', borderRadius: '6px', background: '#1c1c1e', flexShrink: 0 }} />}
                          <span style={{ minWidth: 0 }}>
                            <span style={{ display: 'block', fontWeight: 700, fontSize: '15px' }}>{x.name}</span>
                            <span style={{ display: 'block', fontSize: '12px', color: '#888', marginTop: '2px' }}>
                              {[x.year, `${x.episodeCount} episode${x.episodeCount === 1 ? '' : 's'}`, x.aired < x.episodeCount ? (x.aired ? `${x.aired} aired so far` : 'not aired yet') : null].filter(Boolean).join(' · ')}
                            </span>
                            {show.onServer && x.aired > 0 && (
                              <span style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '6px', maxWidth: '260px' }}>
                                <span style={{ flex: 1, height: '4px', borderRadius: '4px', background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                                  <span style={{ display: 'block', width: `${Math.round((x.onServer / x.aired) * 100)}%`, height: '100%', background: x.complete ? '#00c864' : '#00c2ff' }} />
                                </span>
                                <span style={{ fontSize: '11px', color: '#999', whiteSpace: 'nowrap' }}>{x.onServer} of {x.aired} on Streamulus</span>
                              </span>
                            )}
                          </span>
                          <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true" style={{ marginLeft: 'auto', transition: 'transform 0.2s', transform: isOpen ? 'rotate(90deg)' : 'none', opacity: 0.6, flexShrink: 0 }}>
                            <path d="M4.2 2 8 6l-3.8 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </button>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                          {x.complete ? <OnServerPill />
                            : x.request ? (
                              <>
                                <StatusPill status={x.request.status} label={x.request.scope === 'series' ? 'Whole series asked for' : x.request.label} />
                                <button style={BTN} onClick={() => onAct({ ...item, request: x.request }, x.request.scope, x.request.season)} data-action={x.request.mine ? 'progress' : 'join'}>{x.request.mine ? 'See Progress' : 'Me Too'}</button>
                              </>
                            ) : x.canRequest ? (
                              <button style={PRIMARY} onClick={() => onAct({ ...item, request: null }, 'season', x.season)} data-action="request-season">Request Season</button>
                            ) : null}
                        </div>
                      </div>
                      {isOpen && (
                        <div style={{ padding: '0 14px 12px 68px' }} data-episodes>
                          {!episodes[x.season] ? <div style={{ color: '#777', fontSize: '13px', padding: '6px 0' }}>Loading episodes…</div>
                            : episodes[x.season].map(e => (
                              <div key={e.episode} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.04)', fontSize: '13px' }}>
                                <span style={{ color: '#777', width: '34px', flexShrink: 0 }}>E{String(e.episode).padStart(2, '0')}</span>
                                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: e.aired ? '#e6e6ea' : '#777' }}>{e.title || `Episode ${e.episode}`}</span>
                                <span style={{ fontSize: '12px', fontWeight: 700, whiteSpace: 'nowrap', color: e.onServer ? '#00c864' : e.aired ? '#888' : '#6b6b76' }}>
                                  {e.onServer ? '✓ On Streamulus' : e.aired ? (e.airDate ? new Date(e.airDate).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' }) : '') : `Airs ${e.airDate ? new Date(e.airDate).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' }) : 'later'}`}
                                </span>
                              </div>
                            ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {show.creators.length > 0 && (
                <div style={{ marginBottom: '20px', fontSize: '15px' }}>
                  <span style={{ fontWeight: 800 }}>Created by: </span><span style={{ color: '#ddd' }}>{show.creators.map(c => c.name).join(', ')}</span>
                </div>
              )}
              {show.cast.length > 0 && (
                <>
                  <div style={{ fontSize: '17px', fontWeight: 800, marginBottom: '10px' }}>Cast</div>
                  <div style={{ display: 'flex', gap: '14px', overflowX: 'auto', paddingBottom: '6px' }}>
                    {show.cast.map(c => (
                      <div key={c.id} data-cast={c.name} style={{ width: '92px', flexShrink: 0, textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: '6px' }}>
                        <Avatar url={c.profileUrl} size={76} />
                        <div style={{ fontSize: '12px', fontWeight: 700, marginTop: '6px', lineHeight: 1.3 }}>{c.name}</div>
                        {c.character && <div style={{ fontSize: '11px', color: '#888', lineHeight: 1.3 }}>{c.character}</div>}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </div>
      <style>{'.tvc-row:hover { filter: none !important; box-shadow: none !important; } .tvc-row:active { transform: none !important; }'}</style>
    </div>
  );
}

function AskDialog({ asking, onCancel, onSend }) {
  const { item: film, scope, season } = asking;
  const tv = film.mediaType === 'tv';
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);
  return (
    <div onClick={onCancel} style={{ position: 'fixed', inset: 0, zIndex: 1200, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
      <div onClick={e => e.stopPropagation()} role="dialog" aria-label={`Request ${film.title}`} data-dialog="request"
        style={{ width: '100%', maxWidth: '540px', background: '#17171b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '16px', padding: '24px', display: 'flex', gap: '18px', boxShadow: '0 30px 80px rgba(0,0,0,0.6)' }}>
        {film.posterUrl && <img src={film.posterUrl} alt="" style={{ width: '100px', height: '150px', objectFit: 'cover', borderRadius: '10px', flexShrink: 0 }} />}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '11px', fontWeight: 800, letterSpacing: '1.5px', color: '#00c2ff' }}>{tv ? (scope === 'season' ? 'REQUEST A SEASON' : 'REQUEST A SERIES') : 'REQUEST'}</div>
          <div style={{ fontSize: '20px', fontWeight: 800, marginTop: '2px' }}>{film.title} <span style={{ color: '#888', fontWeight: 500 }}>{film.year || ''}</span></div>
          {tv && (
            <div data-scope style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', marginTop: '6px', padding: '3px 10px', borderRadius: '999px', background: 'rgba(0,194,255,0.12)', border: '1px solid rgba(0,194,255,0.35)', color: '#7fdcff', fontSize: '12px', fontWeight: 700 }}>
              <SeriesIcon size={11} /> {scope === 'season' ? `Season ${season}` : film.showId ? 'Every missing season' : 'The whole series'}
            </div>
          )}
          <p style={{ color: '#bbb', fontSize: '13px', lineHeight: 1.55, margin: '8px 0 12px', maxHeight: '62px', overflow: 'hidden' }}>{film.overview}</p>
          <label style={{ fontSize: '13px', color: '#ddd', fontWeight: 700, display: 'block', marginBottom: '6px' }} htmlFor="request-note">Note for the admin · optional</label>
          <textarea id="request-note" value={note} onChange={e => setNote(e.target.value)} maxLength={500} rows={2} placeholder={tv ? 'e.g. the original, not the remake' : 'e.g. the 2021 version, please'}
            style={{ width: '100%', padding: '10px 12px', background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.14)', borderRadius: '10px', color: '#fff', fontSize: '14px', fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box' }} />
          <div style={{ fontSize: '12px', color: '#999', marginTop: '8px' }}>You'll get an email when it's approved or declined, and again when it's ready to watch.</div>
          <div style={{ display: 'flex', gap: '10px', marginTop: '14px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            <button style={BTN} onClick={onCancel}>Cancel</button>
            <button style={PRIMARY} disabled={busy} onClick={async () => { setBusy(true); if (!(await onSend(note.trim()))) setBusy(false); }} data-action="send-request">
              {busy ? 'Sending…' : 'Send Request'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── My requests ──────────────────────────────────────────────────────────────

function MyRequests({ list, say, reload, goFind, onOpen, findLabel }) {
  if (!list) return <div className="spinner" style={{ margin: '60px auto' }} />;
  if (!list.length) {
    return (
      <div style={{ padding: '36px', textAlign: 'center', borderRadius: '12px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
        <div style={{ color: '#aaa', marginBottom: '14px' }}>You haven't asked for anything yet.</div>
        <button style={PRIMARY} onClick={goFind}>{findLabel}</button>
      </div>
    );
  }
  const cancel = async (r) => {
    const name = r.displayTitle || r.title;
    if (!window.confirm(`Cancel your request for ${name}?`)) return;
    try {
      await axios.delete(`/api/requests/${r.id}`);
      say(`Cancelled your request for ${name}`);
      reload();
    } catch (err) { say(err.response?.data?.error || "Couldn't cancel it", true); }
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      {list.map(r => <RequestCard key={r.id} r={r} onCancel={() => cancel(r)} onOpen={() => onOpen(r.tmdbId, r.mediaType === 'tv' ? 'tv' : 'movie')} />)}
    </div>
  );
}

function RequestCard({ r, onCancel, onOpen }) {
  const color = STATUS_COLORS[r.status] || '#888';
  const tv = r.mediaType === 'tv';
  return (
    <div data-request={r.displayTitle || r.title} style={{ display: 'flex', gap: '16px', padding: '16px', borderRadius: '14px', background: 'rgba(255,255,255,0.04)', border: `1px solid ${r.status === 'available' ? 'rgba(0,200,100,0.25)' : 'rgba(255,255,255,0.08)'}` }}>
      <button onClick={onOpen} aria-label={`About ${r.title}`} style={{ width: '72px', flexShrink: 0, padding: 0, border: 'none', background: 'none', cursor: 'pointer', alignSelf: 'flex-start' }}>
        {r.posterUrl ? <img src={r.posterUrl} alt="" style={{ width: '72px', height: '108px', objectFit: 'cover', borderRadius: '8px', display: 'block' }} />
          : <div style={{ width: '72px', height: '108px', borderRadius: '8px', background: '#1c1c1e' }} />}
      </button>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <button onClick={onOpen} style={{ background: 'none', border: 'none', padding: 0, color: '#fff', fontSize: '17px', fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }}>{r.title}</button>
          <span style={{ color: '#777', fontSize: '14px' }}>{r.year || ''}</span>
          {tv && (
            <span data-scope style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '3px 10px', borderRadius: '999px', background: 'rgba(255,255,255,0.07)', color: '#ccc', fontSize: '11px', fontWeight: 700, letterSpacing: '0.4px', textTransform: 'uppercase' }}>
              <SeriesIcon size={10} /> {r.scope === 'season' ? `Season ${r.season}` : 'Entire series'}
            </span>
          )}
          <StatusPill status={r.status} label={r.label} />
        </div>
        <Steps status={r.status} />
        {tv && r.tv && r.tv.seasons?.length > 0 && <TVChecklist tv={r.tv} scope={r.scope} />}
        {!tv && r.status === 'downloading' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ flex: 1 }}><ProgressBar status={r.status} progress={r.progress} /></div>
            <span style={{ fontSize: '13px', fontWeight: 700, color, minWidth: '40px', textAlign: 'right' }}>{Math.round((r.progress || 0) * 100)}%</span>
          </div>
        )}
        {!tv && ['importing', 'adding', 'searching'].includes(r.status) && <ProgressBar status={r.status} progress={r.progress} />}
        {r.detail && <div style={{ fontSize: '13px', color: ['not_found', 'failed', 'missing'].includes(r.status) ? '#ffb38a' : '#aaa', lineHeight: 1.5 }} data-detail>{r.detail}</div>}
        {r.status === 'pending' && <div style={{ fontSize: '13px', color: '#aaa' }}>Waiting for an admin to approve it — you'll get an email either way.</div>}
        {r.status === 'declined' && (
          <div data-decline-note style={{ padding: '10px 14px', borderRadius: '10px', background: 'rgba(255,68,68,0.1)', border: '1px solid rgba(255,68,68,0.3)' }}>
            <div style={{ fontSize: '12px', fontWeight: 800, color: '#ff8a8a', marginBottom: r.declineReason ? '3px' : 0 }}>
              {r.declineReason ? `Note from ${r.decidedBy || 'the admin'}` : `Not approved${r.decidedBy ? ` by ${r.decidedBy}` : ''}`}
            </div>
            {r.declineReason && <div style={{ fontSize: '14px', color: '#fff' }}>{r.declineReason}</div>}
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginTop: '2px' }}>
          <span style={{ fontSize: '12px', color: '#666' }}>
            {r.mine ? 'You asked' : `Asked for by ${r.requestedBy}`}{r.others ? ` · and ${r.others} other${r.others === 1 ? '' : 's'}` : ''} · {new Date(r.createdAt).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })}
          </span>
          <div style={{ flex: 1 }} />
          {r.status === 'available' && r.movieId && <Link to={`/movie/${r.movieId}`} style={{ ...PRIMARY, textDecoration: 'none' }} data-action="watch">Watch Now</Link>}
          {tv && r.showId && (r.status === 'available' || r.tv?.ready > 0) && (
            <Link to={`/tv/${r.showId}`} style={{ ...(r.status === 'available' ? PRIMARY : BTN), textDecoration: 'none' }} data-action="watch">{r.status === 'available' ? 'Watch Now' : "Watch What's Ready"}</Link>
          )}
          {r.status === 'pending' && <button style={{ ...BTN, color: '#ff8080', border: '1px solid rgba(255,77,77,0.35)' }} onClick={onCancel} data-action="cancel">Cancel Request</button>}
        </div>
      </div>
    </div>
  );
}
