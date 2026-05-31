import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import Navbar from '../components/Navbar';
import Hero from '../components/Hero';
import MediaRow from '../components/MediaRow';
import ContinueWatchingCard from '../components/ContinueWatchingCard';

function ContinueWatchingRow({ items }) {
  const rowRef = useRef(null);
  const [showLeft, setShowLeft] = useState(false);
  const [showRight, setShowRight] = useState(true);

  if (!items.length) return null;

  const scroll = (dir) => {
    rowRef.current?.scrollBy({ left: dir * 600, behavior: 'smooth' });
  };

  const onScroll = () => {
    const el = rowRef.current;
    if (!el) return;
    setShowLeft(el.scrollLeft > 0);
    setShowRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 10);
  };

  const btnStyle = (visible) => ({
    position: 'absolute', top: '50%', transform: 'translateY(-50%)', zIndex: 20,
    background: 'rgba(15,15,15,0.9)', border: '1px solid rgba(255,255,255,0.12)',
    color: '#fff', borderRadius: '50%', width: '42px', height: '42px',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    cursor: 'pointer', fontSize: '18px', transition: 'all 0.2s',
    opacity: visible ? 1 : 0, pointerEvents: visible ? 'auto' : 'none',
    backdropFilter: 'blur(8px)',
  });

  return (
    <div style={{ marginBottom: '40px' }}>
      <h2 style={{ fontSize: '18px', fontWeight: '700', marginBottom: '16px', paddingLeft: '32px', color: '#fff' }}>
        Continue Watching
      </h2>
      <div style={{ position: 'relative', paddingLeft: '32px' }}>
        <button style={{ ...btnStyle(showLeft), left: '4px' }} onClick={() => scroll(-1)}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(0,194,255,0.2)'; e.currentTarget.style.borderColor = '#00c2ff'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'rgba(15,15,15,0.9)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)'; }}>
          ‹
        </button>
        <div ref={rowRef} onScroll={onScroll} style={{
          display: 'flex', gap: '12px', overflowX: 'auto', paddingBottom: '8px',
          paddingRight: '32px', scrollbarWidth: 'none', msOverflowStyle: 'none',
        }}>
          {items.map(item => <ContinueWatchingCard key={`${item.type}-${item.id}`} item={item} />)}
        </div>
        <button style={{ ...btnStyle(showRight && items.length > 5), right: '4px' }} onClick={() => scroll(1)}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(0,194,255,0.2)'; e.currentTarget.style.borderColor = '#00c2ff'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'rgba(15,15,15,0.9)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)'; }}>
          ›
        </button>
      </div>
    </div>
  );
}

export default function Home() {
  const [featured, setFeatured] = useState(null);
  const [recentMovies, setRecentMovies] = useState([]);
  const [recentShows, setRecentShows] = useState([]);
  const [continueWatching, setContinueWatching] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      axios.get('/api/movies/featured').catch(() => ({ data: { movie: null } })),
      axios.get('/api/movies/recent').catch(() => ({ data: { movies: [] } })),
      axios.get('/api/tv/recent').catch(() => ({ data: { shows: [] } })),
      axios.get('/api/stream/continue-watching').catch(() => ({ data: { items: [] } })),
    ]).then(([featuredRes, moviesRes, showsRes, continueRes]) => {
      setFeatured(featuredRes.data.movie);
      setRecentMovies(moviesRes.data.movies || []);
      setRecentShows(showsRes.data.shows || []);
      setContinueWatching(continueRes.data.items || []);
    }).finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="spinner" />
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0f0f0f' }}>
      <Navbar />
      <Hero item={featured} type="movie" />
      <div style={{ paddingTop: '32px', paddingBottom: '60px' }}>
        <ContinueWatchingRow items={continueWatching} />
        <MediaRow title="Recently Added Movies" items={recentMovies} type="movie" />
        <MediaRow title="Recently Added TV Shows" items={recentShows} type="tv" />
      </div>
    </div>
  );
}
