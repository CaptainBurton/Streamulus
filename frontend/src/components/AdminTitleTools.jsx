import React, { useState } from 'react';
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
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

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
            <label style={LABEL} htmlFor="ed-rating">Age rating</label>
            <input id="ed-rating" style={INPUT} value={form.contentRating} maxLength={20} placeholder="e.g. PG-13, TV-14" onChange={set('contentRating')} />
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
          <span>Lock these details — <span style={{ color: '#777' }}>Refresh Metadata and new matches won't overwrite them.</span></span>
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
