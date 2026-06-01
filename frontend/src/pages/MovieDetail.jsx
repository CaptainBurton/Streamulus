import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import Navbar from '../components/Navbar';
import ArtworkPicker from '../components/ArtworkPicker';
import { useAuth } from '../context/AuthContext';

const PLACEHOLDER_POSTER = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="200" height="300" viewBox="0 0 200 300"%3E%3Crect width="200" height="300" fill="%231e1e1e"/%3E%3Ctext x="100" y="155" text-anchor="middle" fill="%23444" font-size="14" font-family="Inter,sans-serif"%3ENo Image%3C/text%3E%3C/svg%3E';
const PLACEHOLDER_PERSON = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100"%3E%3Crect width="100" height="100" fill="%231e1e1e"/%3E%3Ccircle cx="50" cy="38" r="20" fill="%23333"/%3E%3Cellipse cx="50" cy="80" rx="30" ry="22" fill="%23333"/%3E%3C/svg%3E';

export default function MovieDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [showArtwork, setShowArtwork] = useState(false);

  useEffect(() => {
    setLoading(true);
    axios.get(`/api/movies/${id}/details`)
      .then(res => setData(res.data))
      .catch(() => setError('Movie not found'))
      .finally(() => setLoading(false));
  }, [id, refreshKey]);

  if (loading) return <div className="loading-screen"><div className="spinner" /></div>;

  if (error) return (
    <div style={{ minHeight: '100vh', background: '#0f0f0f', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '16px' }}>
      <div style={{ fontSize: '48px' }}>🎬</div>
      <div style={{ color: '#ff4444', fontSize: '18px' }}>{error}</div>
      <button onClick={() => navigate(-1)} style={{ padding: '14px 24px', background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.2)', color: '#fff', borderRadius: '8px', cursor: 'pointer', fontSize: '16px', fontWeight: '600', backdropFilter: 'blur(8px)', transition: 'all 0.2s' }} onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.25)'; }} onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.15)'; }}>← Go Back</button>
    </div>
  );

  const { movie, cast, director, similarLocal } = data;

  return (
    <>
    <div style={{ minHeight: '100vh', background: '#0f0f0f', color: '#fff' }}>
      <Navbar />

      {/* Hero backdrop */}
      <div style={{ position: 'relative', height: '70vh', minHeight: '480px', overflow: 'hidden' }}>
        {movie.backdrop_url ? (
          <img src={movie.backdrop_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center 20%' }} />
        ) : (
          <div style={{ width: '100%', height: '100%', background: 'linear-gradient(135deg, #1a1a2e, #0f0f0f)' }} />
        )}
        {/* Gradients */}
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to right, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.5) 50%, rgba(0,0,0,0.2) 100%)' }} />
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '280px', background: 'linear-gradient(to top, #0f0f0f, transparent)' }} />

        {/* Back button */}
        <button
          onClick={() => navigate(-1)}
          style={{ position: 'absolute', top: '90px', left: '32px', background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.2)', color: '#fff', borderRadius: '8px', padding: '14px 24px', fontSize: '16px', fontWeight: '600', cursor: 'pointer', backdropFilter: 'blur(8px)', transition: 'all 0.2s' }}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.25)'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.15)'; }}
        >
          ← Back
        </button>
      </div>

      {/* Main content */}
      <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '0 32px 60px', marginTop: '-200px', position: 'relative', zIndex: 10 }}>
        <div style={{ display: 'flex', gap: '40px', alignItems: 'flex-start', flexWrap: 'wrap' }}>

          {/* Poster */}
          <div style={{ flexShrink: 0 }}>
            <img
              src={movie.poster_url || PLACEHOLDER_POSTER}
              alt={movie.title}
              onError={e => { e.target.src = PLACEHOLDER_POSTER; }}
              style={{ width: '220px', borderRadius: '12px', boxShadow: '0 20px 60px rgba(0,0,0,0.8)', display: 'block' }}
            />
            {user?.role === 'admin' && (
              <button
                onClick={() => setShowArtwork(true)}
                style={{ marginTop: '10px', width: '220px', padding: '8px 0', background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)', color: '#888', borderRadius: '8px', fontSize: '12px', fontWeight: '600', cursor: 'pointer', transition: 'all 0.15s' }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(0,194,255,0.1)'; e.currentTarget.style.borderColor = 'rgba(0,194,255,0.3)'; e.currentTarget.style.color = '#00c2ff'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.07)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)'; e.currentTarget.style.color = '#888'; }}
              >
                ✎ Edit Artwork
              </button>
            )}
          </div>

          {/* Info */}
          <div style={{ flex: 1, minWidth: '280px', paddingTop: '120px' }}>
            <h1 style={{ fontSize: '42px', fontWeight: '800', lineHeight: 1.1, marginBottom: '16px', letterSpacing: '-0.5px' }}>
              {movie.title}
            </h1>

            {/* Meta row */}
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap' }}>
              {movie.year && <span style={{ color: '#aaa', fontSize: '15px' }}>{movie.year}</span>}
              {movie.content_rating && (
                <span style={{ padding: '2px 8px', border: '1px solid #555', borderRadius: '4px', color: '#888', fontSize: '12px', fontWeight: '600' }}>{movie.content_rating}</span>
              )}
              {movie.rating && (
                <span style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#f5c518', fontSize: '15px', fontWeight: '700' }}>
                  ★ {movie.rating.toFixed(1)}
                </span>
              )}
              {movie.imdb_rating && (
                <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '13px', fontWeight: '700', color: '#f5c518', background: 'rgba(245,197,24,0.1)', padding: '2px 8px', borderRadius: '4px' }}>
                  IMDb {movie.imdb_rating.toFixed(1)}
                </span>
              )}
              {movie.imdb_id && (
                <a href={`https://www.imdb.com/title/${movie.imdb_id}/`} target="_blank" rel="noopener noreferrer"
                   style={{ fontSize: '12px', color: '#555', textDecoration: 'none' }}
                   onMouseEnter={e => { e.currentTarget.style.color = '#aaa'; }}
                   onMouseLeave={e => { e.currentTarget.style.color = '#555'; }}>
                  ↗ IMDb
                </a>
              )}
              {director && <span style={{ color: '#888', fontSize: '14px' }}>Dir. {director}</span>}
            </div>

            {/* Genres */}
            {movie.genres?.length > 0 && (
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '20px' }}>
                {movie.genres.map(g => (
                  <span key={g} style={{ padding: '4px 12px', borderRadius: '20px', background: 'rgba(0,194,255,0.1)', border: '1px solid rgba(0,194,255,0.2)', color: '#00c2ff', fontSize: '12px', fontWeight: '600' }}>
                    {g}
                  </span>
                ))}
              </div>
            )}

            {/* Overview */}
            {movie.overview && (
              <p style={{ color: '#ccc', fontSize: '16px', lineHeight: '1.7', marginBottom: '32px', maxWidth: '640px' }}>
                {movie.overview}
              </p>
            )}

            {/* Actions */}
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
              <button
                onClick={() => navigate(`/watch/movie/${movie.id}`)}
                style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '14px 36px', background: '#00c2ff', color: '#000', border: 'none', borderRadius: '8px', fontSize: '16px', fontWeight: '800', cursor: 'pointer', transition: 'all 0.2s' }}
                onMouseEnter={e => { e.currentTarget.style.background = '#33cfff'; e.currentTarget.style.transform = 'scale(1.03)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = '#00c2ff'; e.currentTarget.style.transform = 'scale(1)'; }}
              >
                ▶ Play Now
              </button>
            </div>
          </div>
        </div>

        {/* Cast */}
        {cast?.length > 0 && (
          <div style={{ marginTop: '56px' }}>
            <h2 style={{ fontSize: '20px', fontWeight: '700', marginBottom: '20px', color: '#fff' }}>Cast</h2>
            <div style={{ display: 'flex', gap: '16px', overflowX: 'auto', paddingBottom: '8px' }}>
              {cast.map(person => (
                <div key={person.id} style={{ flexShrink: 0, width: '100px', textAlign: 'center' }}>
                  <img
                    src={person.profile_url || PLACEHOLDER_PERSON}
                    alt={person.name}
                    onError={e => { e.target.src = PLACEHOLDER_PERSON; }}
                    style={{ width: '80px', height: '80px', borderRadius: '50%', objectFit: 'cover', display: 'block', margin: '0 auto 8px', border: '2px solid rgba(255,255,255,0.08)' }}
                  />
                  <div style={{ fontSize: '12px', fontWeight: '600', color: '#fff', lineHeight: 1.3 }}>{person.name}</div>
                  {person.character && <div style={{ fontSize: '11px', color: '#555', marginTop: '2px', lineHeight: 1.3 }}>{person.character}</div>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* More from your library */}
        {similarLocal?.length > 0 && (
          <div style={{ marginTop: '56px' }}>
            <h2 style={{ fontSize: '20px', fontWeight: '700', marginBottom: '20px', color: '#fff' }}>More in Your Library</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '14px' }}>
              {similarLocal.map(m => (
                <div
                  key={m.id}
                  onClick={() => navigate(`/movie/${m.id}`)}
                  style={{ cursor: 'pointer', borderRadius: '8px', overflow: 'hidden', transition: 'transform 0.2s, box-shadow 0.2s', position: 'relative' }}
                  onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.05)'; e.currentTarget.style.boxShadow = '0 8px 24px rgba(0,0,0,0.6)'; }}
                  onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.boxShadow = 'none'; }}
                >
                  <img
                    src={m.poster_url || PLACEHOLDER_POSTER}
                    alt={m.title}
                    onError={e => { e.target.src = PLACEHOLDER_POSTER; }}
                    style={{ width: '100%', aspectRatio: '2/3', objectFit: 'cover', display: 'block' }}
                  />
                  <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '10px 8px 8px', background: 'linear-gradient(to top, rgba(0,0,0,0.9), transparent)' }}>
                    <div style={{ fontSize: '11px', fontWeight: '600', color: '#fff' }}>{m.title}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>

    {showArtwork && (
      <ArtworkPicker
        mediaType="movie"
        itemId={id}
        onClose={() => setShowArtwork(false)}
        onSaved={() => { setShowArtwork(false); setRefreshKey(k => k + 1); }}
      />
    )}
    </>
  );
}
