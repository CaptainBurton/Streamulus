import React, { useEffect, useState, useCallback, useRef } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import Navbar from '../components/Navbar';

const PLACEHOLDER = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="200" height="300" viewBox="0 0 200 300"%3E%3Crect width="200" height="300" fill="%231e1e1e"/%3E%3Ctext x="100" y="155" text-anchor="middle" fill="%23444" font-size="14" font-family="Inter,sans-serif"%3ENo Image%3C/text%3E%3C/svg%3E';
const PAGE_SIZE = 32;

function Pagination({ page, total, pageSize, onChange }) {
  const totalPages = Math.ceil(total / pageSize);
  if (totalPages <= 1) return null;

  const getPages = () => {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
    const s = new Set([1, totalPages]);
    for (let i = Math.max(1, page - 2); i <= Math.min(totalPages, page + 2); i++) s.add(i);
    return [...s].sort((a, b) => a - b);
  };

  const nums = getPages();
  const items = [];
  let prev = 0;
  for (const p of nums) {
    if (p - prev > 1) items.push('…');
    items.push(p);
    prev = p;
  }

  const btn = (disabled, color, click, children, key) => (
    <button key={key} onClick={click} disabled={disabled} style={{
      border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', fontSize: '14px', fontWeight: '600',
      minWidth: '38px', height: '38px', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(255,255,255,0.06)', color, cursor: disabled ? 'not-allowed' : 'pointer',
    }}>{children}</button>
  );

  return (
    <div style={{ display: 'flex', gap: '6px', justifyContent: 'center', marginTop: '40px', alignItems: 'center' }}>
      {btn(page === 1, page === 1 ? '#333' : '#888', () => onChange(page - 1), '←', 'prev')}
      {items.map((item, i) =>
        item === '…'
          ? <span key={`e${i}`} style={{ color: '#444', padding: '0 4px', fontSize: '14px' }}>…</span>
          : <button key={item} onClick={() => onChange(item)} style={{
              border: `1px solid ${item === page ? '#00c2ff' : 'rgba(255,255,255,0.1)'}`,
              borderRadius: '6px', fontSize: '14px', fontWeight: '600',
              minWidth: '38px', height: '38px', display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: item === page ? '#00c2ff' : 'rgba(255,255,255,0.06)',
              color: item === page ? '#000' : '#888', cursor: 'pointer',
            }}>{item}</button>
      )}
      {btn(page === totalPages, page === totalPages ? '#333' : '#888', () => onChange(page + 1), '→', 'next')}
    </div>
  );
}

function ShowDetail({ show, onClose }) {
  const navigate = useNavigate();
  const scrollRef = useRef(null);
  const [seasons, setSeasons] = useState([]);
  const [selectedSeason, setSelectedSeason] = useState(null);
  const [episodes, setEpisodes] = useState([]);
  const [loadingSeasons, setLoadingSeasons] = useState(true);
  const [loadingEps, setLoadingEps] = useState(false);

  useEffect(() => {
    setLoadingSeasons(true);
    axios.get(`/api/tv/${show.id}`)
      .then(res => setSeasons(res.data.seasons || []))
      .finally(() => setLoadingSeasons(false));
  }, [show.id]);

  useEffect(() => {
    if (selectedSeason == null) return;
    setLoadingEps(true);
    scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    axios.get(`/api/tv/${show.id}/season/${selectedSeason}`)
      .then(res => setEpisodes(res.data.episodes || []))
      .finally(() => setLoadingEps(false));
  }, [show.id, selectedSeason]);

  const currentSeasonData = seasons.find(s => s.season === selectedSeason);

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}
      onClick={onClose}
    >
      <div
        ref={scrollRef}
        style={{ background: '#1a1a1a', borderRadius: '16px', width: '100%', maxWidth: '860px', maxHeight: '90vh', overflow: 'auto', border: '1px solid rgba(255,255,255,0.08)', position: 'relative' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Backdrop */}
        {show.backdrop_url ? (
          <div style={{ position: 'relative', height: '200px', overflow: 'hidden', borderRadius: '16px 16px 0 0' }}>
            <img src={show.backdrop_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, #1a1a1a, transparent)' }} />
            <button onClick={onClose} style={{ position: 'absolute', top: '12px', right: '12px', background: 'rgba(0,0,0,0.6)', border: '1px solid rgba(255,255,255,0.2)', color: '#fff', borderRadius: '50%', width: '32px', height: '32px', cursor: 'pointer', fontSize: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
          </div>
        ) : (
          <button onClick={onClose} style={{ position: 'absolute', top: '14px', right: '14px', zIndex: 10, background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)', color: '#aaa', borderRadius: '50%', width: '30px', height: '30px', cursor: 'pointer', fontSize: '15px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
        )}

        <div style={{ padding: '24px' }}>
          {/* Show info */}
          <div style={{ display: 'flex', gap: '20px', marginBottom: '28px' }}>
            <img
              src={show.poster_url || PLACEHOLDER}
              alt={show.title}
              onError={e => { e.target.src = PLACEHOLDER; }}
              style={{ width: '90px', height: '135px', objectFit: 'cover', borderRadius: '8px', flexShrink: 0, marginTop: show.backdrop_url ? '-55px' : 0, boxShadow: '0 8px 24px rgba(0,0,0,0.5)' }}
            />
            <div>
              <h2 style={{ fontSize: '22px', fontWeight: '800', marginBottom: '8px' }}>{show.title}</h2>
              <div style={{ display: 'flex', gap: '12px', marginBottom: '10px', flexWrap: 'wrap' }}>
                {show.first_air_date && <span style={{ color: '#888', fontSize: '13px' }}>{show.first_air_date.split('-')[0]}</span>}
                {show.rating && <span style={{ color: '#00c2ff', fontSize: '13px', fontWeight: '600' }}>★ {show.rating.toFixed(1)}</span>}
                {show.status && <span style={{ color: '#555', fontSize: '13px' }}>{show.status}</span>}
                {!loadingSeasons && <span style={{ color: '#555', fontSize: '13px' }}>{seasons.length} season{seasons.length !== 1 ? 's' : ''}</span>}
              </div>
              {show.overview && <p style={{ color: '#888', fontSize: '13px', lineHeight: '1.6', margin: 0, maxWidth: '520px' }}>{show.overview}</p>}
            </div>
          </div>

          {/* Seasons / Episodes */}
          {loadingSeasons ? (
            <div style={{ textAlign: 'center', padding: '24px' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
          ) : selectedSeason === null ? (
            /* ── Season grid ── */
            <div>
              <div style={{ fontSize: '11px', color: '#444', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '14px' }}>Seasons</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: '12px' }}>
                {seasons.map(s => (
                  <div
                    key={s.season}
                    onClick={() => setSelectedSeason(s.season)}
                    style={{ cursor: 'pointer', borderRadius: '10px', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.04)', transition: 'all 0.15s' }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(0,194,255,0.4)'; e.currentTarget.style.background = 'rgba(0,194,255,0.07)'; e.currentTarget.style.transform = 'translateY(-2px)'; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'; e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; e.currentTarget.style.transform = 'none'; }}
                  >
                    <div style={{ aspectRatio: '2/3', background: 'linear-gradient(135deg, rgba(0,194,255,0.08), rgba(123,47,255,0.08))', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
                      <div style={{ fontSize: '36px', fontWeight: '800', color: '#00c2ff', lineHeight: 1 }}>{s.season}</div>
                      <div style={{ fontSize: '10px', color: '#555', textTransform: 'uppercase', letterSpacing: '1px' }}>Season</div>
                    </div>
                    <div style={{ padding: '10px 12px', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                      <div style={{ fontSize: '13px', fontWeight: '700', color: '#ccc' }}>Season {s.season}</div>
                      <div style={{ fontSize: '11px', color: '#555', marginTop: '3px' }}>{s.episode_count} episode{s.episode_count !== 1 ? 's' : ''}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            /* ── Episode list ── */
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '18px' }}>
                <button
                  onClick={() => setSelectedSeason(null)}
                  style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: '#aaa', borderRadius: '8px', padding: '7px 14px', fontSize: '13px', cursor: 'pointer', fontWeight: '600' }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; e.currentTarget.style.color = '#fff'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; e.currentTarget.style.color = '#aaa'; }}
                >← Seasons</button>
                <div style={{ fontSize: '16px', fontWeight: '700', color: '#fff' }}>
                  Season {selectedSeason}
                  {currentSeasonData && <span style={{ color: '#555', fontWeight: '400', fontSize: '13px', marginLeft: '8px' }}>{currentSeasonData.episode_count} episode{currentSeasonData.episode_count !== 1 ? 's' : ''}</span>}
                </div>
              </div>

              {loadingEps ? (
                <div style={{ textAlign: 'center', padding: '24px' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {episodes.map(ep => (
                    <div
                      key={ep.id}
                      onClick={() => navigate(`/watch/episode/${ep.id}`)}
                      style={{ display: 'flex', alignItems: 'center', gap: '16px', padding: '12px 14px', background: 'rgba(255,255,255,0.04)', borderRadius: '8px', cursor: 'pointer', border: '1px solid rgba(255,255,255,0.04)', transition: 'all 0.15s' }}
                      onMouseEnter={e => { e.currentTarget.style.background = 'rgba(0,194,255,0.08)'; e.currentTarget.style.borderColor = 'rgba(0,194,255,0.2)'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.04)'; }}
                    >
                      <div style={{ fontSize: '13px', color: '#555', width: '28px', textAlign: 'center', flexShrink: 0, fontWeight: '600' }}>
                        {ep.episode_number}
                      </div>
                      {ep.still_url && (
                        <img src={ep.still_url} alt="" style={{ width: '80px', height: '45px', objectFit: 'cover', borderRadius: '4px', flexShrink: 0 }} />
                      )}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '14px', fontWeight: '600', color: '#fff' }}>{ep.title || `Episode ${ep.episode_number}`}</div>
                        {ep.overview && <div style={{ fontSize: '12px', color: '#666', marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ep.overview}</div>}
                      </div>
                      <div style={{ color: '#00c2ff', fontSize: '18px', flexShrink: 0 }}>▶</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
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
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(null);
  const topRef = useRef(null);

  // Debounce search input
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Reset to page 1 when search changes
  useEffect(() => { setPage(1); }, [debouncedSearch]);

  const fetchShows = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get('/api/tv', {
        params: { search: debouncedSearch || undefined, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE },
      });
      setShows(res.data.shows || []);
      setTotal(res.data.total || 0);
    } catch { }
    finally { setLoading(false); }
  }, [debouncedSearch, page]);

  useEffect(() => { fetchShows(); }, [fetchShows]);

  const handlePageChange = (newPage) => {
    setPage(newPage);
    topRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const controlStyle = {
    padding: '10px 16px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '8px', color: '#fff', fontSize: '14px', outline: 'none',
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div style={{ minHeight: '100vh', background: '#0f0f0f' }}>
      <Navbar />
      <div ref={topRef} style={{ padding: '90px 32px 60px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '28px', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <h1 style={{ fontSize: '28px', fontWeight: '800' }}>TV Shows</h1>
            <div style={{ color: '#555', fontSize: '14px', marginTop: '4px' }}>
              {total} series
              {totalPages > 1 && <span style={{ color: '#444' }}> · page {page} of {totalPages}</span>}
            </div>
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
            <div style={{ fontSize: '18px', color: '#666' }}>
              {debouncedSearch ? 'No shows match your search' : 'No TV shows found. Add a TV library in the Admin panel.'}
            </div>
          </div>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '16px' }}>
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
                  <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '12px 10px 10px', background: 'linear-gradient(to top, rgba(0,0,0,0.9), transparent)' }}>
                    <div style={{ fontSize: '12px', fontWeight: '600', color: '#fff', lineHeight: 1.3 }}>{show.title}</div>
                    <div style={{ display: 'flex', gap: '6px', marginTop: '3px', alignItems: 'center' }}>
                      {show.first_air_date && <span style={{ fontSize: '10px', color: '#888' }}>{show.first_air_date.split('-')[0]}</span>}
                      {show.rating && <span style={{ fontSize: '10px', color: '#00c2ff', fontWeight: '600' }}>★ {show.rating.toFixed(1)}</span>}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <Pagination page={page} total={total} pageSize={PAGE_SIZE} onChange={handlePageChange} />
          </>
        )}
      </div>

      {selected && <ShowDetail show={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
