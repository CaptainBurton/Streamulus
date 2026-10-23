import React, { useEffect, useState } from 'react';
import axios from 'axios';

// Admin tools for a movie, show, season or episode: edit its details, and
// remove it — from Streamulus only (the files stay, and scans leave them out
// until restored in Admin › Libraries) or together with its files on the server.

export const TrashIcon = ({ size = 16 }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true" style={{ display: 'block', flexShrink: 0 }}>
    <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM8 9h8v10H8V9zm7.5-5-1-1h-5l-1 1H5v2h14V4z" />
  </svg>
);

const OVERLAY = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px', backdropFilter: 'blur(4px)' };
const PANEL = { background: '#1a1a1a', borderRadius: '16px', border: '1px solid rgba(255,255,255,0.1)', width: '100%', maxHeight: '88vh', overflowY: 'auto', color: '#fff' };
const INPUT = { width: '100%', padding: '10px 12px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '8px', color: '#fff', fontSize: '14px', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' };
const LABEL = { display: 'block', fontSize: '12px', fontWeight: 700, color: '#888', marginBottom: '6px', letterSpacing: '0.3px' };
const BTN = { padding: '10px 22px', borderRadius: '8px', fontSize: '14px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' };
const CANCEL = { ...BTN, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.07)', color: '#ccc' };

function Modal({ title, subtitle, width = 560, onClose, children }) {
  return (
    <div style={OVERLAY} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} role="dialog" aria-modal="true" aria-label={title}>
      <div style={{ ...PANEL, maxWidth: `${width}px` }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px', padding: '20px 24px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <div>
            <h2 style={{ fontSize: '18px', fontWeight: 700, margin: 0 }}>{title}</h2>
            {subtitle && <p style={{ fontSize: '13px', color: '#777', margin: '4px 0 0' }}>{subtitle}</p>}
          </div>
          <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', color: '#666', fontSize: '26px', cursor: 'pointer', lineHeight: 1, padding: '0 4px' }}>×</button>
        </div>
        <div style={{ padding: '20px 24px 24px' }}>{children}</div>
      </div>
    </div>
  );
}

// ── Edit details ─────────────────────────────────────────────────────────────
// kind: 'movie' | 'show'. Saving locks the details so a metadata refresh keeps them.
export function EditDetailsModal({ kind, item, onClose, onSaved }) {
  const initialYear = kind === 'movie' ? (item.year || '') : (item.first_air_date || '').slice(0, 4);
  const [form, setForm] = useState({
    title: item.title || '',
    year: String(initialYear || ''),
    contentRating: item.content_rating || '',
    genres: (item.genres || []).join(', '),
    overview: item.overview || '',
    locked: true, // edited by hand, so keep it unless the admin says otherwise
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [ratings, setRatings] = useState(null); // the country's rating system (Admin › Settings › Regional)
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  useEffect(() => {
    axios.get('/api/admin/library/ratings').then(r => setRatings(r.data)).catch(() => setRatings({ movie: [], tv: [] }));
  }, []);
  const ratingOptions = ratings ? (kind === 'movie' ? ratings.movie : ratings.tv) : [];
  const current = form.contentRating;
  const currentListed = !current || ratingOptions.some(o => o.code === current);

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await axios.put(`/api/admin/library/${kind}/${item.id}`, {
        title: form.title,
        year: form.year.trim() || null,
        contentRating: form.contentRating,
        genres: form.genres.split(',').map(g => g.trim()).filter(Boolean),
        overview: form.overview,
        locked: form.locked,
      });
      onSaved();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save the details');
      setSaving(false);
    }
  };

  return (
    <Modal title="Edit Details" subtitle={`Change how this ${kind === 'movie' ? 'movie' : 'show'} appears in Streamulus.`} onClose={onClose}>
      <form onSubmit={save} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <div>
          <label style={LABEL} htmlFor="ed-title">Title</label>
          <input id="ed-title" style={INPUT} value={form.title} maxLength={200} onChange={set('title')} required />
        </div>
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 120px' }}>
            <label style={LABEL} htmlFor="ed-year">{kind === 'movie' ? 'Year' : 'First aired (year)'}</label>
            <input id="ed-year" style={INPUT} value={form.year} inputMode="numeric" maxLength={4} onChange={set('year')} />
          </div>
          <div style={{ flex: '1 1 120px' }}>
            <label style={LABEL} htmlFor="ed-rating">Age rating{ratings?.name ? <span style={{ fontWeight: 500, color: '#555' }}> ({ratings.name})</span> : null}</label>
            <select id="ed-rating" style={{ ...INPUT, cursor: 'pointer', colorScheme: 'dark' }} value={current} onChange={set('contentRating')} disabled={!ratings}>
              <option value="">Not rated</option>
              {ratingOptions.map(o => <option key={o.code} value={o.code}>{o.label}</option>)}
              {!currentListed && <option value={current}>{current} — from another country</option>}
            </select>
          </div>
        </div>
        <div>
          <label style={LABEL} htmlFor="ed-genres">Genres <span style={{ fontWeight: 500, color: '#555' }}>(comma separated)</span></label>
          <input id="ed-genres" style={INPUT} value={form.genres} placeholder="Animation, Action & Adventure" onChange={set('genres')} />
        </div>
        <div>
          <label style={LABEL} htmlFor="ed-overview">Description</label>
          <textarea id="ed-overview" style={{ ...INPUT, minHeight: '120px', resize: 'vertical', lineHeight: 1.5 }} value={form.overview} maxLength={5000} onChange={set('overview')} />
        </div>
        <label style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', fontSize: '13px', color: '#bbb', cursor: 'pointer' }}>
          <input type="checkbox" checked={form.locked} onChange={set('locked')} style={{ marginTop: '2px', accentColor: '#00c2ff' }} />
          <span>Lock these details — <span style={{ color: '#777' }}>Refresh Metadata and age-rating updates won't overwrite them (Fix Match still replaces them).</span></span>
        </label>
        {error && <div style={{ color: '#ff6b6b', fontSize: '13px' }}>⚠ {error}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '4px' }}>
          <button type="button" onClick={onClose} style={CANCEL}>Cancel</button>
          <button type="submit" disabled={saving || !form.title.trim()} style={{ ...BTN, border: 'none', background: '#00c2ff', color: '#000', fontWeight: 700, opacity: saving ? 0.6 : 1 }}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ── Remove ───────────────────────────────────────────────────────────────────
// target: { kind: 'movie'|'show'|'season'|'episode', id, season?, title }
const PATHS = {
  movie: (t) => `/api/admin/library/movie/${t.id}`,
  show: (t) => `/api/admin/library/show/${t.id}`,
  season: (t) => `/api/admin/library/show/${t.id}/season/${t.season}`,
  episode: (t) => `/api/admin/library/episode/${t.id}`,
};
const NOUN = { movie: 'movie', show: 'show and all its episodes', season: 'season and its episodes', episode: 'episode' };

export function RemoveModal({ target, onClose, onRemoved }) {
  const [mode, setMode] = useState('library'); // 'library' | 'files'
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const remove = async () => {
    if (mode === 'files' && !confirming) { setConfirming(true); return; }
    setBusy(true);
    setError('');
    try {
      const r = await axios.delete(PATHS[target.kind](target), { params: mode === 'files' ? { files: 1 } : {} });
      onRemoved(r.data, mode);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not remove it');
      setBusy(false);
      setConfirming(false);
    }
  };

  const option = (value, title, hint, danger) => {
    const active = mode === value;
    const color = danger ? '#ff4d4d' : '#00c2ff';
    return (
      <label style={{ display: 'flex', gap: '12px', alignItems: 'flex-start', padding: '14px', borderRadius: '10px', cursor: 'pointer',
        background: active ? (danger ? 'rgba(255,77,77,0.08)' : 'rgba(0,194,255,0.08)') : 'rgba(255,255,255,0.03)',
        border: `1px solid ${active ? `${color}66` : 'rgba(255,255,255,0.08)'}` }}>
        <input type="radio" name="remove-mode" checked={active} onChange={() => { setMode(value); setConfirming(false); }} style={{ marginTop: '3px', accentColor: color }} />
        <span>
          <span style={{ display: 'block', fontSize: '14px', fontWeight: 700, color: active && danger ? '#ff8080' : '#ddd' }}>{title}</span>
          <span style={{ display: 'block', fontSize: '12px', color: '#777', marginTop: '3px', lineHeight: 1.5 }}>{hint}</span>
        </span>
      </label>
    );
  };

  return (
    <Modal title={`Remove ${target.title}`} subtitle={`What should happen to this ${NOUN[target.kind]}?`} width={520} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {option('library', 'Remove from Streamulus only',
          'The files stay on the server. Scans won’t add it back — restore it any time from Admin › Libraries › Hidden from the library.')}
        {option('files', 'Also delete the files from the server',
          'Deletes the video files (and subtitles and artwork next to them) from the disk. This can’t be undone.', true)}
      </div>
      {confirming && (
        <div style={{ marginTop: '14px', padding: '12px 14px', borderRadius: '8px', background: 'rgba(255,77,77,0.1)', border: '1px solid rgba(255,77,77,0.3)', color: '#ff9b9b', fontSize: '13px' }}>
          Are you sure? The files for {target.title} will be permanently deleted from the server.
        </div>
      )}
      {error && <div style={{ marginTop: '14px', color: '#ff6b6b', fontSize: '13px' }}>⚠ {error}</div>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' }}>
        <button onClick={onClose} style={CANCEL}>Cancel</button>
        <button onClick={remove} disabled={busy}
          style={{ ...BTN, border: 'none', fontWeight: 700, background: mode === 'files' ? '#ff4d4d' : '#00c2ff', color: mode === 'files' ? '#fff' : '#000', opacity: busy ? 0.6 : 1 }}>
          {busy ? 'Removing…' : mode === 'files' ? (confirming ? 'Delete files permanently' : 'Delete files…') : 'Remove'}
        </button>
      </div>
    </Modal>
  );
}

// The message to show after a removal.
export function removedMessage(result, mode) {
  const files = result.filesDeleted || 0;
  let text = `Removed ${result.title || 'it'}`;
  if (mode === 'files') text += files ? ` and deleted ${files} file${files === 1 ? '' : 's'}` : ' (no files were deleted)';
  if (result.errors?.length) text += ` — ${result.errors.length} problem${result.errors.length === 1 ? '' : 's'}: ${result.errors[0]}`;
  return text;
}

// Small round icon button for season cards and episode rows (doesn't open the card).
export function IconButton({ label, onClick, danger, children, style }) {
  return (
    <button
      type="button" title={label} aria-label={label}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      style={{ width: '30px', height: '30px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0,
        background: 'rgba(0,0,0,0.65)', border: '1px solid rgba(255,255,255,0.15)', color: '#ccc', backdropFilter: 'blur(6px)', ...style }}
      onMouseEnter={e => { e.currentTarget.style.color = danger ? '#ff6b6b' : '#00c2ff'; e.currentTarget.style.borderColor = danger ? 'rgba(255,77,77,0.5)' : 'rgba(0,194,255,0.5)'; }}
      onMouseLeave={e => { e.currentTarget.style.color = '#ccc'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.15)'; }}
    >
      {children}
    </button>
  );
}

export const MoveIcon = ({ size = 16 }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true" style={{ display: 'block', flexShrink: 0 }}>
    <path d="M6.99 11 3 15l3.99 4v-3H14v-2H6.99v-3zM21 9l-3.99-4v3H10v2h7.01v3L21 9z" />
  </svg>
);

// ── Move a season / merge a show ─────────────────────────────────────────────
// mode 'season': one season of fromShow → another show (optionally renumbered).
// mode 'show': every season of fromShow → another show (it's the same show).
// Streamulus remembers the move, so scans keep the files with the chosen show.
export function MoveModal({ mode, fromShow, season, onClose, onMoved }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [target, setTarget] = useState(null);
  const [asNew, setAsNew] = useState(false);
  const [newTitle, setNewTitle] = useState(fromShow.title);
  const [targetSeason, setTargetSeason] = useState(season ?? 1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      axios.get('/api/admin/library/shows', { params: { search: query } })
        .then(r => { if (!cancelled) setResults(r.data.shows.filter(s => s.id !== fromShow.id)); })
        .catch(() => { if (!cancelled) setResults([]); });
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query, fromShow.id]);

  const existing = target && mode === 'season' ? target.seasons.find(s => s.season === Number(targetSeason)) : null;
  const ready = asNew ? newTitle.trim().length > 0 : !!target;

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      const body = asNew ? { newShowTitle: newTitle.trim() } : { toShowId: target.id };
      const url = mode === 'season'
        ? `/api/admin/library/show/${fromShow.id}/season/${season}/move`
        : `/api/admin/library/show/${fromShow.id}/merge`;
      if (mode === 'season') body.targetSeason = Number(targetSeason);
      const r = await axios.post(url, body);
      onMoved(r.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not move it');
      setBusy(false);
    }
  };

  const heading = mode === 'season' ? `Move Season ${season}` : `Merge ${fromShow.title}`;
  const sub = mode === 'season'
    ? `From ${fromShow.title}. Pick the show it belongs to.`
    : 'All of its seasons go into the show you pick, and this one disappears.';

  return (
    <Modal title={heading} subtitle={sub} width={600} onClose={onClose}>
      <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
        <button type="button" onClick={() => setAsNew(false)} style={{ ...BTN, padding: '7px 14px', fontSize: '13px', border: '1px solid rgba(255,255,255,0.12)', background: !asNew ? '#00c2ff' : 'transparent', color: !asNew ? '#000' : '#bbb' }}>Existing show</button>
        <button type="button" onClick={() => setAsNew(true)} style={{ ...BTN, padding: '7px 14px', fontSize: '13px', border: '1px solid rgba(255,255,255,0.12)', background: asNew ? '#00c2ff' : 'transparent', color: asNew ? '#000' : '#bbb' }}>New show</button>
      </div>

      {asNew ? (
        <div>
          <label style={LABEL} htmlFor="move-new-title">New show's title</label>
          <input id="move-new-title" style={INPUT} value={newTitle} maxLength={200} onChange={e => setNewTitle(e.target.value)} />
          <div style={{ fontSize: '12px', color: '#666', marginTop: '6px' }}>Use Fix Match on the new show afterwards to get its artwork and details.</div>
        </div>
      ) : (
        <>
          <input style={INPUT} placeholder="Search your shows…" value={query} onChange={e => setQuery(e.target.value)} aria-label="Search shows" autoFocus />
          <div style={{ marginTop: '10px', maxHeight: '300px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {results === null ? <div style={{ color: '#666', fontSize: '13px', padding: '8px' }}>Loading…</div>
              : results.length === 0 ? <div style={{ color: '#666', fontSize: '13px', padding: '8px' }}>No shows match.</div>
              : results.map(s => {
                const on = target?.id === s.id;
                return (
                  <button key={s.id} type="button" onClick={() => setTarget(s)} aria-pressed={on} data-show={s.title}
                    style={{ display: 'flex', alignItems: 'center', gap: '12px', textAlign: 'left', padding: '8px 10px', borderRadius: '8px', cursor: 'pointer', fontFamily: 'inherit',
                      background: on ? 'rgba(0,194,255,0.12)' : 'rgba(255,255,255,0.03)', border: `1px solid ${on ? 'rgba(0,194,255,0.55)' : 'rgba(255,255,255,0.06)'}`, color: '#ddd' }}>
                    <div style={{ width: '30px', height: '44px', borderRadius: '4px', overflow: 'hidden', background: '#222', flexShrink: 0 }}>
                      {s.poster_url && <img src={s.poster_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                    </div>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: 'block', fontSize: '14px', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.title}{s.year ? ` (${s.year})` : ''}</span>
                      <span style={{ display: 'block', fontSize: '12px', color: '#777' }}>
                        {s.seasons.length ? `Season${s.seasons.length === 1 ? '' : 's'} ${s.seasons.map(x => x.season).join(', ')}` : 'No episodes'}
                      </span>
                    </span>
                  </button>
                );
              })}
          </div>
        </>
      )}

      {mode === 'season' && (
        <div style={{ marginTop: '16px' }}>
          <label style={LABEL} htmlFor="move-season">As season</label>
          <input id="move-season" type="number" min="0" max="999" style={{ ...INPUT, width: '120px' }} value={targetSeason} onChange={e => setTargetSeason(e.target.value)} />
          {existing && (
            <div style={{ fontSize: '12px', color: '#ffb703', marginTop: '6px' }}>
              {target.title} already has Season {existing.season} ({existing.episodes} episode{existing.episodes === 1 ? '' : 's'}) — these join it.
            </div>
          )}
        </div>
      )}

      <div style={{ marginTop: '16px', fontSize: '12px', color: '#666', lineHeight: 1.5 }}>
        Streamulus remembers this: later scans keep these files with the show you pick, and new episodes that arrive in the same folder join it too.
      </div>
      {error && <div style={{ marginTop: '12px', color: '#ff6b6b', fontSize: '13px' }}>⚠ {error}</div>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '18px' }}>
        <button onClick={onClose} style={CANCEL}>Cancel</button>
        <button onClick={submit} disabled={busy || !ready}
          style={{ ...BTN, border: 'none', fontWeight: 700, background: '#00c2ff', color: '#000', opacity: busy || !ready ? 0.5 : 1 }}>
          {busy ? 'Moving…' : mode === 'season' ? 'Move Season' : 'Merge'}
        </button>
      </div>
    </Modal>
  );
}
