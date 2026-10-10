import React, { useEffect, useState } from 'react';
import axios from 'axios';

// Pick one of the admin's provided profile pictures (Admin › Profile Pictures)
// for a profile. The server only offers pictures meant for that profile —
// Streamers (grown-ups), Streamlings, or both.
export default function AvatarPicker({ profile, onClose, onPicked }) {
  const [categories, setCategories] = useState(null);
  const [currentId, setCurrentId] = useState(null);
  const [filter, setFilter] = useState('all'); // 'all' or a category id
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    axios.get(`/api/profiles/${profile.id}/avatar/library`)
      .then(r => { setCategories(r.data.categories); setCurrentId(r.data.currentImageId); })
      .catch(err => { setCategories([]); setError(err.response?.data?.error || "Couldn't load the pictures"); });
  }, [profile.id]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const pick = async (image) => {
    setBusy(image.id);
    setError('');
    try {
      const r = await axios.put(`/api/profiles/${profile.id}/avatar/library`, { imageId: image.id });
      setCurrentId(image.id);
      await onPicked(r.data.profile);
    } catch (err) {
      setError(err.response?.data?.error || "Couldn't change the picture");
    }
    setBusy(null);
  };

  const shown = (categories || []).filter(c => filter === 'all' || c.id === filter);

  return (
    <div style={S.backdrop} onClick={onClose} role="dialog" aria-modal="true" aria-label={`Choose a picture for ${profile.name}`}>
      <div style={S.panel} onClick={e => e.stopPropagation()}>
        <div style={S.header}>
          <div>
            <h2 style={{ fontSize: '20px', fontWeight: 800, margin: 0 }}>Choose a picture</h2>
            <div style={{ color: '#777', fontSize: '13px', marginTop: '2px' }}>For {profile.name}{profile.is_kids ? ' · Streamling' : ''}</div>
          </div>
          <button onClick={onClose} style={S.close} aria-label="Close">✕</button>
        </div>

        {categories && categories.length > 1 && (
          <div style={S.chips}>
            {[{ id: 'all', name: 'All' }, ...categories].map(c => (
              <button key={c.id} onClick={() => setFilter(c.id)} style={{ ...S.chip, ...(filter === c.id ? S.chipOn : {}) }}>{c.name}</button>
            ))}
          </div>
        )}

        {error && <div style={S.error}>{error}</div>}

        <div style={S.body}>
          {!categories && <div style={S.empty}>Loading…</div>}
          {categories && categories.length === 0 && !error && (
            <div style={S.empty}>
              No pictures to choose from yet.<br />
              <span style={{ fontSize: '13px', color: '#666' }}>Your Streamulus admin can add them in Admin › Profile Pictures.</span>
            </div>
          )}
          {shown.map(c => (
            <section key={c.id} style={{ marginBottom: '22px' }}>
              <h3 style={S.catTitle}>{c.name}</h3>
              <div style={S.grid}>
                {c.images.map(image => {
                  const current = image.id === currentId;
                  return (
                    <button key={image.id} onClick={() => pick(image)} disabled={busy !== null} className="avatar-choice"
                      aria-label={`${c.name} picture${current ? ' (current)' : ''}`}
                      style={{ ...S.choice, boxShadow: current ? '0 0 0 3px #00c2ff' : 'none', opacity: busy !== null && busy !== image.id ? 0.5 : 1 }}>
                      <img src={image.url} alt="" style={S.img} loading="lazy" />
                      {current && <span style={S.tick}>✓</span>}
                      {busy === image.id && <span style={S.spin}>…</span>}
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </div>
      <style>{`.avatar-choice:hover:not(:disabled) { transform: scale(1.07); }`}</style>
    </div>
  );
}

const S = {
  backdrop: { position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' },
  panel: { width: '100%', maxWidth: '720px', maxHeight: 'min(86vh, 760px)', display: 'flex', flexDirection: 'column', background: '#161616', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '16px', boxShadow: '0 24px 80px rgba(0,0,0,0.6)', color: '#fff', overflow: 'hidden' },
  header: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px', padding: '20px 22px 12px' },
  close: { width: '34px', height: '34px', borderRadius: '50%', border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.06)', color: '#ccc', cursor: 'pointer', fontSize: '14px', flexShrink: 0 },
  chips: { display: 'flex', gap: '8px', padding: '0 22px 12px', overflowX: 'auto', scrollbarWidth: 'none', flexShrink: 0 },
  chip: { padding: '6px 14px', borderRadius: '20px', border: '1px solid rgba(255,255,255,0.15)', background: 'transparent', color: '#bbb', fontSize: '13px', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: 'inherit' },
  chipOn: { background: '#fff', color: '#000', borderColor: '#fff' },
  body: { padding: '6px 22px 22px', overflowY: 'auto' },
  catTitle: { fontSize: '13px', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', color: '#999', margin: '0 0 12px' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(84px, 1fr))', gap: '14px' },
  choice: { position: 'relative', width: '100%', aspectRatio: '1', padding: 0, border: 'none', borderRadius: '50%', background: 'rgba(255,255,255,0.06)', cursor: 'pointer', transition: 'transform 0.15s', overflow: 'visible' },
  img: { width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%', display: 'block' },
  tick: { position: 'absolute', right: '-2px', bottom: '-2px', width: '24px', height: '24px', borderRadius: '50%', background: '#00c2ff', color: '#000', fontSize: '13px', fontWeight: 900, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid #161616' },
  spin: { position: 'absolute', inset: 0, borderRadius: '50%', background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '22px', fontWeight: 800 },
  empty: { textAlign: 'center', color: '#999', padding: '40px 10px', lineHeight: 1.7 },
  error: { margin: '0 22px 10px', padding: '10px 14px', borderRadius: '8px', background: 'rgba(255,68,68,0.1)', border: '1px solid rgba(255,68,68,0.25)', color: '#ff6b6b', fontSize: '13px' },
};
