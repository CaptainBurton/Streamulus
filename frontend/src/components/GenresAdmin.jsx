import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';

// Admin › Genres: pick the artwork for each genre card. Without a custom image
// a genre shows the artwork of a random movie in it (changes on each visit).
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

export default function GenresAdmin({ flash }) {
  const [genres, setGenres] = useState(null);
  const [busy, setBusy] = useState(null); // genre name being updated
  const fileInput = useRef(null);
  const target = useRef(null);

  const load = () => axios.get('/api/genres')
    .then(r => setGenres(r.data.genres || []))
    .catch(() => { setGenres([]); flash('Failed to load genres', true); });

  useEffect(() => { load(); }, []);

  const pick = (name) => {
    target.current = name;
    fileInput.current.value = '';
    fileInput.current.click();
  };

  const upload = async (e) => {
    const file = e.target.files?.[0];
    const name = target.current;
    if (!file || !name) return;
    const form = new FormData();
    form.append('image', file);
    setBusy(name);
    try {
      await axios.post(`/api/genres/${encodeURIComponent(name)}/image`, form);
      flash(`Image set for ${name}`);
      await load();
    } catch (err) {
      flash(err.response?.data?.error || 'Upload failed', true);
    } finally { setBusy(null); }
  };

  const remove = async (name) => {
    setBusy(name);
    try {
      await axios.delete(`/api/genres/${encodeURIComponent(name)}/image`);
      flash(`${name} now uses a random movie's artwork`);
      await load();
    } catch { flash('Failed to remove image', true); } finally { setBusy(null); }
  };

  const button = (primary) => ({
    padding: '7px 14px', borderRadius: '8px', fontSize: '12px', fontWeight: '700', cursor: 'pointer',
    border: primary ? 'none' : '1px solid rgba(255,255,255,0.15)',
    background: primary ? '#00c2ff' : 'transparent', color: primary ? '#000' : '#ccc',
  });

  return (
    <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', padding: '28px' }}>
      <h3 style={{ fontSize: '16px', fontWeight: '700', marginBottom: '6px' }}>Genre Images</h3>
      <p style={{ color: '#666', fontSize: '14px', marginBottom: '24px' }}>
        The picture on each genre's card under Genres, on the web and the Apple TV app. Genres without one show
        the artwork of a random movie in that genre. PNG, JPG, WebP or GIF, up to 10 MB — a wide (16:9) image works best.
      </p>
      <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif" style={{ display: 'none' }} onChange={upload} />

      {genres === null ? (
        <div className="spinner" style={{ margin: '40px auto' }} />
      ) : genres.length === 0 ? (
        <div style={{ color: '#666', fontSize: '14px' }}>No genres yet — scan a library with metadata first.</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '16px' }}>
          {genres.map(g => (
            <div key={g.name} style={{ borderRadius: '10px', overflow: 'hidden', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', opacity: busy === g.name ? 0.5 : 1 }}>
              <div style={{ position: 'relative', aspectRatio: '16 / 9', background: 'linear-gradient(135deg, #1a2a3a, #2a1a3a)' }}>
                {g.image_url && <img src={g.image_url} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} onError={e => { e.target.style.display = 'none'; }} />}
                <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(0,0,0,0.8), transparent 60%)' }} />
                <div style={{ position: 'absolute', left: '12px', bottom: '10px', fontSize: '17px', fontWeight: '800', color: '#fff' }}>{g.name}</div>
                <div style={{ position: 'absolute', top: '8px', right: '8px', fontSize: '10px', fontWeight: '800', letterSpacing: '0.5px', padding: '3px 7px', borderRadius: '4px', background: 'rgba(0,0,0,0.65)', color: g.custom_image ? '#00c2ff' : '#999' }}>
                  {g.custom_image ? 'CUSTOM' : 'RANDOM'}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', padding: '10px 12px' }}>
                <span style={{ fontSize: '12px', color: '#777' }}>{plural(g.movie_count, 'movie')} · {plural(g.show_count, 'show')}</span>
                <div style={{ display: 'flex', gap: '6px' }}>
                  {g.custom_image && <button disabled={!!busy} onClick={() => remove(g.name)} style={button(false)}>Remove</button>}
                  <button disabled={!!busy} onClick={() => pick(g.name)} style={button(true)}>{g.custom_image ? 'Change' : 'Upload'}</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
