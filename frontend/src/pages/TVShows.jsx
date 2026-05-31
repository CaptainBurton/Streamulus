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

  const navBtn = (disabled, onClick, children, key) => (
    <button key={key} onClick={onClick} disabled={disabled} style={{
      border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', fontSize: '14px', fontWeight: '600',
      minWidth: '38px', height: '38px', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(255,255,255,0.06)', color: disabled ? '#333' : '#888',
      cursor: disabled ? 'not-allowed' : 'pointer',
    }}>{children}</button>
  );

  return (
    <div style={{ display: 'flex', gap: '6px', justifyContent: 'center', marginTop: '40px', alignItems: 'center' }}>
      {navBtn(page === 1, () => onChange(page - 1), '←', 'prev')}
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
      {navBtn(page === totalPages, () => onChange(page + 1), '→', 'next')}
    </div>
  );
}

export default function TVShows() {
  const navigate = useNavigate();
  const [shows, setShows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [sort, setSort] = useState('added');
  const [order, setOrder] = useState('DESC');
  const [page, setPage] = useState(1);
  const topRef = useRef(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => { setPage(1); }, [debouncedSearch, sort, order]);

  const fetchShows = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get('/api/tv', {
        params: { search: debouncedSearch || undefined, sort, order, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE },
      });
      setShows(res.data.shows || []);
      setTotal(res.data.total || 0);
    } catch { }
    finally { setLoading(false); }
  }, [debouncedSearch, sort, order, page]);

  useEffect(() => { fetchShows(); }, [fetchShows]);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div style={{ minHeight: '100vh', background: '#0f0f0f' }}>
      <Navbar />
      <div ref={topRef} className="content-page" style={{ padding: '90px 32px 60px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '28px', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <h1 style={{ fontSize: '28px', fontWeight: '800' }}>TV Shows</h1>
            <div style={{ color: '#555', fontSize: '14px', marginTop: '4px' }}>
              {total} series{totalPages > 1 && <span style={{ color: '#444' }}> · page {page} of {totalPages}</span>}
            </div>
          </div>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              type="text"
              placeholder="Search shows..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ padding: '10px 16px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#fff', fontSize: '14px', outline: 'none', width: '220px' }}
              onFocus={e => { e.target.style.borderColor = '#00c2ff'; }}
              onBlur={e => { e.target.style.borderColor = 'rgba(255,255,255,0.1)'; }}
            />
            <select value={sort} onChange={e => setSort(e.target.value)} style={{ padding: '10px 16px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#fff', fontSize: '14px', outline: 'none', cursor: 'pointer' }}>
              <option value="added">Date Added</option>
              <option value="title">Title</option>
              <option value="rating">Rating</option>
            </select>
            <select value={order} onChange={e => setOrder(e.target.value)} style={{ padding: '10px 16px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#fff', fontSize: '14px', outline: 'none', cursor: 'pointer' }}>
              <option value="DESC">Descending</option>
              <option value="ASC">Ascending</option>
            </select>
          </div>
        </div>

        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '80px 0' }}>
            <div className="spinner" />
          </div>
        ) : shows.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '80px 0' }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>📺</div>
            <div style={{ fontSize: '18px', color: '#666' }}>
              {debouncedSearch ? 'No shows match your search' : 'No TV shows found. Add a TV library in the Admin panel.'}
            </div>
          </div>
        ) : (
          <>
            <div className="media-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '16px' }}>
              {shows.map(show => {
                const showDone = show.total_episodes > 0 && show.watched_episodes >= show.total_episodes;
                return (
                <div
                  key={show.id}
                  onClick={() => navigate(`/tv/${show.id}`)}
                  style={{ cursor: 'pointer', position: 'relative', borderRadius: '8px', transition: 'transform 0.2s, box-shadow 0.2s' }}
                  onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.05)'; e.currentTarget.style.boxShadow = '0 12px 32px rgba(0,0,0,0.7)'; }}
                  onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.boxShadow = 'none'; }}
                >
                  <div style={{ borderRadius: '8px', overflow: 'hidden', position: 'relative' }}>
                  <img
                    src={show.poster_url || PLACEHOLDER}
                    alt={show.title}
                    onError={e => { e.target.src = PLACEHOLDER; }}
                    style={{ width: '100%', aspectRatio: '2/3', objectFit: 'cover', display: 'block', opacity: showDone ? 0.65 : 1 }}
                  />
                  {showDone && (
                    <div style={{ position: 'absolute', top: '8px', right: '8px', width: '26px', height: '26px', borderRadius: '50%', background: '#22c55e', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(0,0,0,0.6)', zIndex: 2 }}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" width="13" height="13">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    </div>
                  )}
                  <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '12px 10px 10px', background: 'linear-gradient(to top, rgba(0,0,0,0.9), transparent)' }}>
                    <div style={{ fontSize: '12px', fontWeight: '600', color: showDone ? '#aaa' : '#fff', lineHeight: 1.3 }}>{show.title}</div>
                    <div style={{ display: 'flex', gap: '6px', marginTop: '3px', alignItems: 'center' }}>
                      {show.first_air_date && <span style={{ fontSize: '10px', color: '#888' }}>{show.first_air_date.split('-')[0]}</span>}
                      {show.rating && <span style={{ fontSize: '10px', color: '#00c2ff', fontWeight: '600' }}>★ {show.rating.toFixed(1)}</span>}
                    </div>
                  </div>
                  </div>
                </div>
                );
              })}
            </div>
            <Pagination page={page} total={total} pageSize={PAGE_SIZE} onChange={(p) => { setPage(p); topRef.current?.scrollIntoView({ behavior: 'smooth' }); }} />
          </>
        )}
      </div>
    </div>
  );
}
