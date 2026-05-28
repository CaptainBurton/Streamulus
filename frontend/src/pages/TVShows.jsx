import React, { useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import Navbar from '../components/Navbar';

const PLACEHOLDER = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="200" height="300" viewBox="0 0 200 300"%3E%3Crect width="200" height="300" fill="%231e1e1e"/%3E%3Ctext x="100" y="155" text-anchor="middle" fill="%23444" font-size="14" font-family="Inter,sans-serif"%3ENo Image%3C/text%3E%3C/svg%3E';

function ShowDetail({ show, onClose }) {
  const navigate = useNavigate();
  const [seasons, setSeasons] = useState([]);
  const [selectedSeason, setSelectedSeason] = useState(null);
  const [episodes, setEpisodes] = useState([]);
  const [loadingEps, setLoadingEps] = useState(false);

  useEffect(() => {
    axios.get(`/api/tv/${show.id}`).then(res => {
      setSeasons(res.data.seasons || []);
      if (res.data.seasons?.length > 0) {
        setSelectedSeason(res.data.seasons[0].season);
      }
    });
  }, [show.id]);

  useEffect(() => {
    if (selectedSeason == null) return;
    setLoadingEps(true);
    axios.get(`/api/tv/${show.id}/season/${selectedSeason}`)
      .then(res => setEpisodes(res.data.episodes || []))
      .finally(() => setLoadingEps(false));
  }, [show.id, selectedSeason]);

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 2000,
      background: 'rgba(0,0,0,0.85)',
      backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '24px',
    }} onClick={onClose}>
      <div
        style={{
          background: '#1a1a1a',
          borderRadius: '16px',
          width: '100%', maxWidth: '800px',
          maxHeight: '90vh', overflow: 'auto',
          border: '1px solid rgba(255,255,255,0.08)',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Backdrop */}
        {show.backdrop_url && (
          <div style={{ position: 'relative', height: '240px', overflow: 'hidden', borderRadius: '16px 16px 0 0' }}>
            <img src={show.backdrop_url} alt={show.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, #1a1a1a, transparent)' }} />
          </div>
        )}

        <div style={{ padding: '24px' }}>
          <div style={{ display: 'flex', gap: '20px', marginBottom: '24px' }}>
            <img
              src={show.poster_url || PLACEHOLDER}
              alt={show.title}
              style={{ width: '100px', height: '150px', objectFit: 'cover', borderRadius: '8px', flexShrink: 0, marginTop: show.backdrop_url ? '-70px' : 0, boxShadow: '0 8px 24px rgba(0,0,0,0.5)' }}
            />
            <div>
              <h2 style={{ fontSize: '24px', fontWeight: '800', marginBottom: '8px' }}>{show.title}</h2>
              <div style={{ display: 'flex', gap: '12px', marginBottom: '12px', flexWrap: 'wrap' }}>
                {show.first_air_date && <span style={{ color: '#888', fontSize: '13px' }}>{show.first_air_date.split('-')[0]}</span>}
                {show.rating && <span style={{ color: '#00c2ff', fontSize: '13px', fontWeight: '600' }}>★ {show.rating.toFixed(1)}</span>}
                {show.status && <span style={{ color: '#555', fontSize: '13px' }}>{show.status}</span>}
              </div>
              {show.overview && <p style={{ color: '#888', fontSize: '14px', lineHeight: '1.6' }}>{show.overview}</p>}
            </div>
          </div>

          {seasons.length > 0 && (
            <>
              <div style={{ display: 'flex', gap: '8px', marginBottom: '20px', flexWrap: 'wrap' }}>
                {seasons.map(s => (
                  <button
                    key={s.season}
                    onClick={() => setSelectedSeason(s.season)}
                    style={{
                      padding: '8px 16px',
                      borderRadius: '6px',
                      border: '1px solid',
                      borderColor: selectedSeason === s.season ? '#00c2ff' : 'rgba(255,255,255,0.1)',
                      background: selectedSeason === s.season ? 'rgba(0,194,255,0.15)' : 'transparent',
                      color: selectedSeason === s.season ? '#00c2ff' : '#888',
                      fontSize: '13px',
                      fontWeight: '600',
                      cursor: 'pointer',
                    }}
                  >
                    Season {s.season}
                    <span style={{ color: '#555', marginLeft: '4px', fontSize: '11px' }}>({s.episode_count})</span>
                  </button>
                ))}
              </div>

              {loadingEps ? (
                <div style={{ textAlign: 'center', padding: '20px' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {episodes.map(ep => (
                    <div
                      key={ep.id}
                      onClick={() => navigate(`/watch/episode/${ep.id}`)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: '16px',
                        padding: '12px 14px',
                        background: 'rgba(255,255,255,0.04)',
                        borderRadius: '8px',
                        cursor: 'pointer',
                        border: '1px solid rgba(255,255,255,0.04)',
                        transition: 'all 0.15s',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.background = 'rgba(0,194,255,0.08)'; e.currentTarget.style.borderColor = 'rgba(0,194,255,0.2)'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.04)'; }}
                    >
                      <div style={{ fontSize: '14px', color: '#555', width: '30px', textAlign: 'center', flexShrink: 0 }}>
                        {ep.episode_number}
                      </div>
                      {ep.still_url && (
                        <img src={ep.still_url} alt="" style={{ width: '80px', height: '45px', objectFit: 'cover', borderRadius: '4px', flexShrink: 0 }} />
                      )}
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '14px', fontWeight: '600', color: '#fff' }}>{ep.title || `Episode ${ep.episode_number}`}</div>
                        {ep.overview && <div style={{ fontSize: '12px', color: '#666', marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ep.overview}</div>}
                      </div>
                      <div style={{ color: '#00c2ff', fontSize: '18px', flexShrink: 0 }}>▶</div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function TVShows() {
  const [shows, setShows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);

  const fetchShows = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get('/api/tv', {
        params: { search: search || undefined }
      });
      setShows(res.data.shows || []);
      setTotal(res.data.total || 0);
    } catch { }
    finally { setLoading(false); }
  }, [search]);

  useEffect(() => { fetchShows(); }, [fetchShows]);

  const controlStyle = {
    padding: '10px 16px',
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '8px',
    color: '#fff',
    fontSize: '14px',
    outline: 'none',
  };

  return (
    <div style={{ minHeight: '100vh', background: '#0f0f0f' }}>
      <Navbar />
      <div style={{ padding: '90px 32px 60px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '28px', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <h1 style={{ fontSize: '28px', fontWeight: '800' }}>TV Shows</h1>
            <div style={{ color: '#555', fontSize: '14px', marginTop: '4px' }}>{total} series</div>
          </div>
          <input
            type="text"
            placeholder="Search shows..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ ...controlStyle, width: '220px', cursor: 'text' }}
            onFocus={e => { e.target.style.borderColor = '#00c2ff'; }}
            onBlur={e => { e.target.style.borderColor = 'rgba(255,255,255,0.1)'; }}
          />
        </div>

        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '80px 0' }}>
            <div className="spinner" />
          </div>
        ) : shows.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '80px 0', color: '#444' }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>📺</div>
            <div style={{ fontSize: '18px', color: '#666' }}>{search ? 'No shows match your search' : 'No TV shows found. Add a TV library in the Admin panel.'}</div>
          </div>
        ) : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
            gap: '16px',
          }}>
            {shows.map(show => (
              <div
                key={show.id}
                onClick={() => setSelected(show)}
                style={{ cursor: 'pointer', position: 'relative', borderRadius: '8px', overflow: 'hidden', transition: 'transform 0.2s, box-shadow 0.2s' }}
                onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.05)'; e.currentTarget.style.boxShadow = '0 12px 32px rgba(0,0,0,0.7)'; }}
                onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.boxShadow = 'none'; }}
              >
                <img
                  src={show.poster_url || PLACEHOLDER}
                  alt={show.title}
                  onError={e => { e.target.src = PLACEHOLDER; }}
                  style={{ width: '100%', aspectRatio: '2/3', objectFit: 'cover', display: 'block' }}
                />
                <div style={{
                  position: 'absolute', bottom: 0, left: 0, right: 0,
                  padding: '12px 10px 10px',
                  background: 'linear-gradient(to top, rgba(0,0,0,0.9), transparent)',
                }}>
                  <div style={{ fontSize: '12px', fontWeight: '600', color: '#fff', lineHeight: 1.3 }}>{show.title}</div>
                  <div style={{ display: 'flex', gap: '6px', marginTop: '3px', alignItems: 'center' }}>
                    {show.first_air_date && <span style={{ fontSize: '10px', color: '#888' }}>{show.first_air_date.split('-')[0]}</span>}
                    {show.rating && <span style={{ fontSize: '10px', color: '#00c2ff', fontWeight: '600' }}>★ {show.rating.toFixed(1)}</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {selected && <ShowDetail show={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
