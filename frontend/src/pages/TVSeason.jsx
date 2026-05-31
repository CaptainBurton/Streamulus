import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import Navbar from '../components/Navbar';

export default function TVSeason() {
  const { id, season } = useParams();
  const navigate = useNavigate();
  const [show, setShow] = useState(null);
  const [episodes, setEpisodes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([
      axios.get(`/api/tv/${id}`),
      axios.get(`/api/tv/${id}/season/${season}`),
    ])
      .then(([showRes, epsRes]) => {
        setShow(showRes.data.show);
        setEpisodes(epsRes.data.episodes || []);
      })
      .catch(() => setError('Season not found'))
      .finally(() => setLoading(false));
  }, [id, season]);

  if (loading) return <div className="loading-screen"><div className="spinner" /></div>;

  if (error) return (
    <div style={{ minHeight: '100vh', background: '#0f0f0f', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '16px' }}>
      <div style={{ fontSize: '48px' }}>📺</div>
      <div style={{ color: '#ff4444', fontSize: '18px' }}>{error}</div>
      <button onClick={() => navigate(`/tv/${id}`)} style={{ padding: '10px 24px', background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.15)', color: '#fff', borderRadius: '8px', cursor: 'pointer', fontSize: '14px' }}>← Back</button>
    </div>
  );

  return (
    <div style={{ minHeight: '100vh', background: '#0f0f0f', color: '#fff' }}>
      <Navbar />

      {/* Header band */}
      <div style={{ position: 'relative', overflow: 'hidden' }}>
        {show.backdrop_url && (
          <>
            <img src={show.backdrop_url} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center 30%', opacity: 0.25 }} />
            <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to bottom, rgba(15,15,15,0.3), #0f0f0f)' }} />
          </>
        )}
        <div style={{ position: 'relative', zIndex: 1, maxWidth: '1000px', margin: '0 auto', padding: '110px 32px 36px' }}>
          {/* Breadcrumb */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '20px', fontSize: '14px' }}>
            <button
              onClick={() => navigate('/tv')}
              style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', padding: 0, fontSize: '14px', fontWeight: '500' }}
              onMouseEnter={e => { e.currentTarget.style.color = '#aaa'; }}
              onMouseLeave={e => { e.currentTarget.style.color = '#555'; }}
            >TV Shows</button>
            <span style={{ color: '#333' }}>›</span>
            <button
              onClick={() => navigate(`/tv/${id}`)}
              style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', padding: 0, fontSize: '14px', fontWeight: '500' }}
              onMouseEnter={e => { e.currentTarget.style.color = '#aaa'; }}
              onMouseLeave={e => { e.currentTarget.style.color = '#555'; }}
            >{show.title}</button>
            <span style={{ color: '#333' }}>›</span>
            <span style={{ color: '#ccc', fontWeight: '600' }}>Season {season}</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '20px', flexWrap: 'wrap' }}>
            {show.poster_url && (
              <img
                src={show.poster_url}
                alt={show.title}
                onError={e => { e.target.style.display = 'none'; }}
                style={{ width: '64px', height: '96px', objectFit: 'cover', borderRadius: '6px', flexShrink: 0, boxShadow: '0 4px 16px rgba(0,0,0,0.6)' }}
              />
            )}
            <div>
              <div style={{ fontSize: '13px', color: '#555', marginBottom: '4px' }}>{show.title}</div>
              <h1 style={{ fontSize: '32px', fontWeight: '800', letterSpacing: '-0.3px', margin: 0 }}>Season {season}</h1>
              <div style={{ color: '#555', fontSize: '13px', marginTop: '6px' }}>{episodes.length} episode{episodes.length !== 1 ? 's' : ''}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Episode list */}
      <div style={{ maxWidth: '1000px', margin: '0 auto', padding: '24px 32px 60px' }}>
        {episodes.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 0', color: '#444' }}>No episodes found for this season.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {episodes.map(ep => {
              const completed = ep.watch_completed === 1;
              const inProgress = !completed && ep.watch_position > 0;
              return (
              <div
                key={ep.id}
                onClick={() => navigate(`/watch/episode/${ep.id}`)}
                style={{ display: 'flex', alignItems: 'center', gap: '20px', padding: '14px 18px', background: 'rgba(255,255,255,0.04)', borderRadius: '10px', cursor: 'pointer', border: `1px solid ${completed ? 'rgba(34,197,94,0.2)' : 'rgba(255,255,255,0.05)'}`, transition: 'all 0.15s' }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(0,194,255,0.07)'; e.currentTarget.style.borderColor = 'rgba(0,194,255,0.25)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; e.currentTarget.style.borderColor = completed ? 'rgba(34,197,94,0.2)' : 'rgba(255,255,255,0.05)'; }}
              >
                {/* Episode number / check */}
                <div style={{ fontSize: completed ? '18px' : '16px', color: completed ? '#22c55e' : '#444', width: '34px', textAlign: 'center', flexShrink: 0, fontWeight: '700' }}>
                  {completed ? '✓' : ep.episode_number}
                </div>

                {/* Still image */}
                <div style={{ position: 'relative', width: '112px', height: '63px', borderRadius: '6px', overflow: 'hidden', flexShrink: 0 }}>
                  {ep.still_url ? (
                    <img src={ep.still_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', opacity: completed ? 0.6 : 1 }} />
                  ) : (
                    <div style={{ width: '100%', height: '100%', background: 'rgba(255,255,255,0.04)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <span style={{ fontSize: '20px', opacity: 0.3 }}>▶</span>
                    </div>
                  )}
                  {completed && (
                    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.3)' }}>
                      <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: '#22c55e', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      </div>
                    </div>
                  )}
                  {inProgress && ep.runtime && (
                    <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '3px', background: 'rgba(255,255,255,0.2)' }}>
                      <div style={{ height: '100%', background: '#00c2ff', width: `${Math.min(100, (ep.watch_position / (ep.runtime * 60)) * 100)}%` }} />
                    </div>
                  )}
                </div>

                {/* Info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '15px', fontWeight: '600', color: completed ? '#888' : '#fff', marginBottom: '4px' }}>
                    {ep.title || `Episode ${ep.episode_number}`}
                  </div>
                  {ep.overview && (
                    <div style={{ fontSize: '13px', color: '#666', overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', lineHeight: '1.5' }}>
                      {ep.overview}
                    </div>
                  )}
                </div>

                {/* Play / check indicator */}
                <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: completed ? 'rgba(34,197,94,0.15)' : 'rgba(0,194,255,0.15)', border: `1px solid ${completed ? 'rgba(34,197,94,0.4)' : 'rgba(0,194,255,0.3)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: completed ? '#22c55e' : '#00c2ff', fontSize: '14px' }}>
                  {completed ? '✓' : '▶'}
                </div>
              </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
