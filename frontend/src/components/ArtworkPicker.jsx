import React, { useEffect, useState, useRef } from 'react';
import axios from 'axios';

export default function ArtworkPicker({ mediaType, itemId, onClose, onSaved }) {
  const [tab, setTab] = useState('poster');
  const [images, setImages] = useState({ posters: [], backdrops: [] });
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef();

  useEffect(() => {
    setLoading(true);
    setError('');
    axios.get(`/api/admin/artwork/${mediaType}/${itemId}`)
      .then(res => setImages(res.data))
      .catch(() => setError('Failed to load artwork. Check your TMDB API key.'))
      .finally(() => setLoading(false));
  }, [mediaType, itemId]);

  const currentList = tab === 'poster' ? images.posters : images.backdrops;
  const artworkType = tab === 'poster' ? 'poster' : 'backdrop';
  const isPortrait = tab === 'poster';

  const handleTabChange = (newTab) => { setTab(newTab); setSelected(null); };

  const handleSave = async () => {
    if (!selected) return;
    setSaving(true);
    setError('');
    try {
      await axios.post(`/api/admin/artwork/${mediaType}/${itemId}`, { type: artworkType, url: selected });
      onSaved();
    } catch {
      setError('Failed to save artwork.');
      setSaving(false);
    }
  };

  const handleUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setSaving(true);
    setError('');
    const form = new FormData();
    form.append('file', file);
    form.append('type', artworkType);
    try {
      await axios.post(`/api/admin/artwork/${mediaType}/${itemId}/upload`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      onSaved();
    } catch {
      setError('Failed to upload image.');
      setSaving(false);
    }
    e.target.value = '';
  };

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px', backdropFilter: 'blur(4px)' }}
    >
      <div style={{ background: '#1a1a1a', borderRadius: '16px', border: '1px solid rgba(255,255,255,0.1)', width: '100%', maxWidth: '980px', maxHeight: '88vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 24px', borderBottom: '1px solid rgba(255,255,255,0.08)', flexShrink: 0 }}>
          <div>
            <h2 style={{ fontSize: '18px', fontWeight: '700', color: '#fff', margin: 0 }}>Edit Artwork</h2>
            <p style={{ fontSize: '12px', color: '#555', margin: '4px 0 0' }}>Select from TMDB or upload your own image</p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#666', fontSize: '26px', cursor: 'pointer', lineHeight: 1, padding: '4px 8px' }}>×</button>
        </div>

        {/* Tab bar + upload button */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 24px', borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 }}>
          <div style={{ display: 'flex', gap: '8px' }}>
            {['poster', 'backdrop'].map(t => (
              <button key={t} onClick={() => handleTabChange(t)} style={{ padding: '8px 20px', borderRadius: '8px', fontSize: '14px', fontWeight: '600', cursor: 'pointer', border: 'none', background: tab === t ? '#00c2ff' : 'rgba(255,255,255,0.07)', color: tab === t ? '#000' : '#888', transition: 'all 0.15s' }}>
                {t === 'poster' ? 'Poster' : 'Backdrop / Banner'}
              </button>
            ))}
          </div>
          <div>
            <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleUpload} />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={saving}
              style={{ padding: '8px 18px', borderRadius: '8px', fontSize: '13px', fontWeight: '600', cursor: 'pointer', border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.07)', color: '#ccc', display: 'flex', alignItems: 'center', gap: '6px' }}
            >
              ↑ Upload Custom
            </button>
          </div>
        </div>

        {/* Image grid */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
          {loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '200px' }}>
              <div className="spinner" />
            </div>
          ) : error && currentList.length === 0 ? (
            <div style={{ textAlign: 'center', color: '#ff6666', padding: '60px 0', fontSize: '14px' }}>{error}</div>
          ) : currentList.length === 0 ? (
            <div style={{ textAlign: 'center', color: '#555', padding: '60px 0', fontSize: '14px' }}>
              No artwork found on TMDB. Upload a custom image above.
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: isPortrait ? 'repeat(auto-fill, minmax(140px, 1fr))' : 'repeat(auto-fill, minmax(260px, 1fr))', gap: '12px' }}>
              {currentList.map((img, i) => (
                <div
                  key={i}
                  onClick={() => setSelected(selected === img.url ? null : img.url)}
                  style={{ position: 'relative', borderRadius: '8px', overflow: 'hidden', cursor: 'pointer', aspectRatio: isPortrait ? '2/3' : '16/9', border: `2px solid ${selected === img.url ? '#00c2ff' : 'transparent'}`, transition: 'border-color 0.15s, transform 0.15s', transform: selected === img.url ? 'scale(1.02)' : 'scale(1)' }}
                  onMouseEnter={e => { if (selected !== img.url) e.currentTarget.style.borderColor = 'rgba(0,194,255,0.35)'; }}
                  onMouseLeave={e => { if (selected !== img.url) e.currentTarget.style.borderColor = 'transparent'; }}
                >
                  <img src={img.thumb} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />

                  {/* Selected overlay */}
                  {selected === img.url && (
                    <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,194,255,0.18)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: '#00c2ff', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 12px rgba(0,0,0,0.5)' }}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      </div>
                    </div>
                  )}

                  {/* Language badge */}
                  {img.language && (
                    <div style={{ position: 'absolute', top: '6px', left: '6px', background: 'rgba(0,0,0,0.75)', borderRadius: '4px', padding: '2px 6px', fontSize: '10px', fontWeight: '700', color: '#ccc', textTransform: 'uppercase', backdropFilter: 'blur(4px)' }}>
                      {img.language}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 24px', borderTop: '1px solid rgba(255,255,255,0.08)', flexShrink: 0 }}>
          <span style={{ fontSize: '13px', color: error ? '#ff6666' : '#555' }}>
            {error || (selected ? '1 image selected — click Save to apply' : `${currentList.length} images available`)}
          </span>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button onClick={onClose} style={{ padding: '10px 24px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.07)', color: '#ccc', fontSize: '14px', fontWeight: '600', cursor: 'pointer' }}>
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={!selected || saving}
              style={{ padding: '10px 24px', borderRadius: '8px', border: 'none', background: selected ? '#00c2ff' : 'rgba(0,194,255,0.25)', color: selected ? '#000' : 'rgba(0,0,0,0.4)', fontSize: '14px', fontWeight: '700', cursor: selected ? 'pointer' : 'not-allowed', transition: 'all 0.15s' }}
            >
              {saving ? 'Saving…' : 'Save Selected'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
