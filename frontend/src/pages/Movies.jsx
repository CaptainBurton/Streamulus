import React, { useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import Navbar from '../components/Navbar';

const PLACEHOLDER = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="200" height="300" viewBox="0 0 200 300"%3E%3Crect width="200" height="300" fill="%231e1e1e"/%3E%3Ctext x="100" y="155" text-anchor="middle" fill="%23444" font-size="14" font-family="Inter,sans-serif"%3ENo Image%3C/text%3E%3C/svg%3E';

function MovieGrid({ movies }) {
  const navigate = useNavigate();
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
      gap: '16px',
    }}>
      {movies.map(movie => {
        const watched = !!movie.watch_completed;
        const hasProgress = !watched && movie.watch_position > 0;
        const progressRatio = hasProgress
          ? (movie.runtime > 0 ? Math.min(movie.watch_position / (movie.runtime * 60), 1) : 0.15)
          : 0;
        return (
          <div
            key={movie.id}
            onClick={() => navigate(`/movie/${movie.id}`)}
            style={{ cursor: 'pointer', position: 'relative', borderRadius: '8px', transition: 'transform 0.2s, box-shadow 0.2s' }}
            onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.05)'; e.currentTarget.style.boxShadow = '0 12px 32px rgba(0,0,0,0.7)'; }}
            onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.boxShadow = 'none'; }}
          >
            <div style={{ borderRadius: '8px', overflow: 'hidden', position: 'relative' }}>
            <img
              src={movie.poster_url || PLACEHOLDER}
              alt={movie.title}
              onError={e => { e.target.src = PLACEHOLDER; }}
              style={{ width: '100%', aspectRatio: '2/3', objectFit: 'cover', display: 'block' }}
            />

            {/* Watched checkmark badge */}
            {watched && (
              <div style={{
                position: 'absolute', top: '8px', right: '8px',
                width: '22px', height: '22px', borderRadius: '50%',
                background: '#00c864', display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: '0 2px 8px rgba(0,0,0,0.6)',
              }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" width="12" height="12">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
            )}

            <div style={{
              position: 'absolute',
              bottom: hasProgress ? '4px' : 0,
              left: 0,
              right: 0,
              padding: '12px 10px 10px',
              background: 'linear-gradient(to top, rgba(0,0,0,0.9), transparent)',
            }}>
              <div style={{ fontSize: '12px', fontWeight: '600', color: '#fff', lineHeight: 1.3 }}>{movie.title}</div>
              <div style={{ display: 'flex', gap: '6px', marginTop: '3px', alignItems: 'center' }}>
                {movie.year && <span style={{ fontSize: '10px', color: '#888' }}>{movie.year}</span>}
                {movie.rating && <span style={{ fontSize: '10px', color: '#00c2ff', fontWeight: '600' }}>★ {movie.rating.toFixed(1)}</span>}
              </div>
            </div>

            {/* In-progress bar */}
            {hasProgress && (
              <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '4px', background: 'rgba(0,0,0,0.5)' }}>
                <div style={{ width: `${progressRatio * 100}%`, height: '100%', background: '#00c2ff', minWidth: '6px' }} />
              </div>
            )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function Movies() {
  const [movies, setMovies] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('added');
  const [order, setOrder] = useState('DESC');
  const [page, setPage] = useState(0);
  const LIMIT = 50;

  const fetchMovies = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get('/api/movies', {
        params: { search: search || undefined, sort, order, limit: LIMIT, offset: page * LIMIT }
      });
      setMovies(res.data.movies || []);
      setTotal(res.data.total || 0);
    } catch { }
    finally { setLoading(false); }
  }, [search, sort, order, page]);

  useEffect(() => { fetchMovies(); }, [fetchMovies]);

  const controlStyle = {
    padding: '10px 16px',
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '8px',
    color: '#fff',
    fontSize: '14px',
    outline: 'none',
    cursor: 'pointer',
  };

  return (
    <div style={{ minHeight: '100vh', background: '#0f0f0f' }}>
      <Navbar />
      <div style={{ padding: '90px 32px 60px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '28px', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <h1 style={{ fontSize: '28px', fontWeight: '800' }}>Movies</h1>
            <div style={{ color: '#555', fontSize: '14px', marginTop: '4px' }}>{total} titles</div>
          </div>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              type="text"
              placeholder="Search movies..."
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(0); }}
              style={{ ...controlStyle, width: '220px' }}
              onFocus={e => { e.target.style.borderColor = '#00c2ff'; }}
              onBlur={e => { e.target.style.borderColor = 'rgba(255,255,255,0.1)'; }}
            />
            <select value={sort} onChange={e => setSort(e.target.value)} style={controlStyle}>
              <option value="added">Date Added</option>
              <option value="title">Title</option>
              <option value="year">Year</option>
              <option value="rating">Rating</option>
            </select>
            <select value={order} onChange={e => setOrder(e.target.value)} style={controlStyle}>
              <option value="DESC">Descending</option>
              <option value="ASC">Ascending</option>
            </select>
          </div>
        </div>

        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '80px 0' }}>
            <div className="spinner" />
          </div>
        ) : movies.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '80px 0', color: '#444' }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>🎬</div>
            <div style={{ fontSize: '18px', color: '#666' }}>{search ? 'No movies match your search' : 'No movies found. Add a library in the Admin panel.'}</div>
          </div>
        ) : (
          <MovieGrid movies={movies} />
        )}

        {total > LIMIT && (
          <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', marginTop: '40px' }}>
            <button
              disabled={page === 0}
              onClick={() => setPage(p => p - 1)}
              style={{ ...controlStyle, opacity: page === 0 ? 0.4 : 1, cursor: page === 0 ? 'not-allowed' : 'pointer' }}
            >
              ← Previous
            </button>
            <span style={{ padding: '10px 16px', color: '#666', fontSize: '14px' }}>
              Page {page + 1} of {Math.ceil(total / LIMIT)}
            </span>
            <button
              disabled={(page + 1) * LIMIT >= total}
              onClick={() => setPage(p => p + 1)}
              style={{ ...controlStyle, opacity: (page + 1) * LIMIT >= total ? 0.4 : 1, cursor: (page + 1) * LIMIT >= total ? 'not-allowed' : 'pointer' }}
            >
              Next →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
