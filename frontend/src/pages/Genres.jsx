import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import Navbar from '../components/Navbar';

// All genres as artwork cards (the admin's image, or a random title's artwork).
export default function Genres() {
  const navigate = useNavigate();
  const [genres, setGenres] = useState(null);

  useEffect(() => {
    axios.get('/api/genres').then(r => setGenres(r.data.genres || [])).catch(() => setGenres([]));
  }, []);

  return (
    <div style={{ minHeight: '100vh', background: '#0f0f0f' }}>
      <Navbar />
      <div className="content-page" style={{ padding: '90px 32px 60px' }}>
        <h1 style={{ fontSize: '28px', fontWeight: '800', marginBottom: '28px' }}>Genres</h1>
        {genres === null ? (
          <div className="spinner" style={{ margin: '80px auto' }} />
        ) : genres.length === 0 ? (
          <div style={{ color: '#666', fontSize: '15px' }}>No genres yet — they appear once your library has metadata.</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '18px' }}>
            {genres.map(g => <GenreCard key={g.name} genre={g} onClick={() => navigate(`/genre/${encodeURIComponent(g.name)}`)} />)}
          </div>
        )}
      </div>
    </div>
  );
}

export function GenreCard({ genre, onClick }) {
  const [hovered, setHovered] = useState(false);
  const [imgError, setImgError] = useState(false);
  const counts = [
    genre.movie_count ? `${genre.movie_count} movie${genre.movie_count === 1 ? '' : 's'}` : null,
    genre.show_count ? `${genre.show_count} show${genre.show_count === 1 ? '' : 's'}` : null,
  ].filter(Boolean).join(' · ');
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: 'relative', aspectRatio: '16 / 9', borderRadius: '10px', overflow: 'hidden', border: 'none', padding: 0,
        cursor: 'pointer', background: 'linear-gradient(135deg, #1a2a3a, #2a1a3a)', textAlign: 'left',
        transform: hovered ? 'scale(1.04)' : 'scale(1)', transition: 'transform 0.25s, box-shadow 0.25s',
        boxShadow: hovered ? '0 16px 40px rgba(0,0,0,0.8)' : '0 2px 8px rgba(0,0,0,0.4)',
        outline: hovered ? '2px solid rgba(0,194,255,0.8)' : 'none',
      }}
    >
      {genre.image_url && !imgError && (
        <img src={genre.image_url} alt="" onError={() => setImgError(true)}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
      )}
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.25) 55%, rgba(0,0,0,0.1) 100%)' }} />
      <div style={{ position: 'absolute', left: '16px', right: '16px', bottom: '14px' }}>
        <div style={{ fontSize: '22px', fontWeight: '800', color: '#fff', textShadow: '0 2px 10px rgba(0,0,0,0.6)' }}>{genre.name}</div>
        {counts && <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.7)', marginTop: '2px' }}>{counts}</div>}
      </div>
    </button>
  );
}
