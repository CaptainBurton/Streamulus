import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import Navbar from '../components/Navbar';
import { CrossfadeHero } from '../components/Hero';
import MediaRow from '../components/MediaRow';
import ContinueWatchingCard from '../components/ContinueWatchingCard';
import ServiceLogo, { logoSize } from '../components/ServiceLogo';

// A titled row that scrolls sideways, with arrow buttons on wide screens.
function ScrollRow({ title, count, children }) {
  const rowRef = useRef(null);
  const [showLeft, setShowLeft] = useState(false);
  const [showRight, setShowRight] = useState(true);

  if (!count) return null;

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
        {title}
      </h2>
      <div style={{ position: 'relative', paddingLeft: '32px' }}>
        <button style={{ ...btnStyle(showLeft), left: '4px' }} onClick={() => scroll(-1)} aria-label="Scroll left"
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(0,194,255,0.2)'; e.currentTarget.style.borderColor = '#00c2ff'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'rgba(15,15,15,0.9)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)'; }}>
          ‹
        </button>
        <div ref={rowRef} onScroll={onScroll} style={{
          display: 'flex', gap: '12px', overflowX: 'auto',
          // Room for the hover zoom and shadow: a scrolling box clips whatever
          // sticks out of it (that's what squared off the cards' corners).
          padding: '16px 32px 24px 12px', margin: '-16px 0 -16px -12px',
          scrollbarWidth: 'none', msOverflowStyle: 'none',
        }}>
          {children}
        </div>
        <button style={{ ...btnStyle(showRight && count > 5), right: '4px' }} onClick={() => scroll(1)} aria-label="Scroll right"
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(0,194,255,0.2)'; e.currentTarget.style.borderColor = '#00c2ff'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'rgba(15,15,15,0.9)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)'; }}>
          ›
        </button>
      </div>
    </div>
  );
}

function ContinueWatchingRow({ items }) {
  return (
    <ScrollRow title="Continue Watching" count={items.length}>
      {items.map(item => <ContinueWatchingCard key={`${item.type}-${item.id}`} item={item} />)}
    </ScrollRow>
  );
}

// Netflix, Disney+… — services that have titles here (Admin › Streaming Services).
function ServicesRow({ services }) {
  return (
    <ScrollRow title="Streaming Services" count={services.length}>
      {services.map(s => <ServiceTile key={s.id} service={s} />)}
    </ScrollRow>
  );
}

function ServiceTile({ service }) {
  const navigate = useNavigate();
  const width = window.innerWidth < 600 ? 200 : 260;
  const height = Math.round(width * 9 / 16);
  const titles = service.movie_count + service.show_count;
  return (
    <button
      className="service-tile"
      onClick={() => navigate(`/service/${service.id}`)}
      aria-label={`${service.name} — ${titles} title${titles === 1 ? '' : 's'}`}
      style={{
        width: `${width}px`, height: `${height}px`, flexShrink: 0, borderRadius: '12px', cursor: 'pointer', padding: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'radial-gradient(120% 90% at 50% 0%, #1f2730 0%, #141418 62%)',
        border: '1px solid rgba(255,255,255,0.08)', transition: 'transform 0.2s, border-color 0.2s, box-shadow 0.2s',
      }}
      onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.05)'; e.currentTarget.style.borderColor = 'rgba(0,194,255,0.5)'; e.currentTarget.style.boxShadow = '0 10px 34px rgba(0,194,255,0.16)'; }}
      onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'; e.currentTarget.style.boxShadow = 'none'; }}
    >
      <ServiceLogo service={service} {...logoSize(service.logo_aspect, width, height)} />
    </button>
  );
}

export default function Home() {
  const [featured, setFeatured] = useState(null);
  const [recentMovies, setRecentMovies] = useState([]);
  const [recentShows, setRecentShows] = useState([]);
  const [continueWatching, setContinueWatching] = useState([]);
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [rotateSeconds, setRotateSeconds] = useState(120);
  const featuredId = featured?.id;

  // Switch the banner to another movie every `rotateSeconds` (admin setting).
  // The new backdrop and logo are downloaded first so the crossfade is smooth.
  useEffect(() => {
    if (!featuredId) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const res = await axios.get('/api/movies/featured', { params: { exclude: featuredId } });
        const next = res.data.movie;
        if (res.data.rotateSeconds > 0) setRotateSeconds(res.data.rotateSeconds);
        if (!next || cancelled) return;
        const preload = src => (src ? new Promise(resolve => {
          const img = new Image();
          img.onload = img.onerror = resolve;
          img.src = src;
        }) : null);
        await Promise.all([preload(next.backdrop_url || next.poster_url), preload(next.logo_url)]);
        if (!cancelled) setFeatured(next);
      } catch { /* keep the current one */ }
    }, rotateSeconds * 1000);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [featuredId, rotateSeconds]);

  useEffect(() => {
    Promise.all([
      axios.get('/api/movies/featured').catch(() => ({ data: { movie: null } })),
      axios.get('/api/movies/recent').catch(() => ({ data: { movies: [] } })),
      axios.get('/api/tv/recent').catch(() => ({ data: { shows: [] } })),
      axios.get('/api/stream/continue-watching').catch(() => ({ data: { items: [] } })),
      axios.get('/api/services').catch(() => ({ data: { services: [] } })),
    ]).then(([featuredRes, moviesRes, showsRes, continueRes, servicesRes]) => {
      setFeatured(featuredRes.data.movie);
      if (featuredRes.data.rotateSeconds > 0) setRotateSeconds(featuredRes.data.rotateSeconds);
      setRecentMovies(moviesRes.data.movies || []);
      setRecentShows(showsRes.data.shows || []);
      setContinueWatching(continueRes.data.items || []);
      setServices(servicesRes.data.services || []);
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
      <CrossfadeHero item={featured} type="movie" />
      <div style={{ paddingTop: '32px', paddingBottom: '60px' }}>
        <ContinueWatchingRow items={continueWatching} />
        <ServicesRow services={services} />
        <MediaRow title="Recently Added Movies" items={recentMovies} type="movie" />
        <MediaRow title="Recently Added TV Shows" items={recentShows} type="tv" />
      </div>
    </div>
  );
}
