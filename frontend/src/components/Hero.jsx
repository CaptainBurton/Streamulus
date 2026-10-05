import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import TitleLogo from './TitleLogo';

const FADE_MS = 1000;

// The Home banner, crossfading when the featured movie changes (Netflix-style):
// the new banner fades in over the old one, while the old title/text fades out
// and the new title/text fades in just after. Home preloads the new artwork and
// logo before switching, so nothing pops in partway through.
export function CrossfadeHero({ item, type = 'movie' }) {
  const [layers, setLayers] = useState(() => (item ? [{ key: item.id, item }] : []));

  useEffect(() => {
    if (!item) { setLayers([]); return; }
    setLayers(prev => (prev.length && prev[prev.length - 1].key === item.id
      ? prev
      : [...prev.slice(-1), { key: item.id, item }]));
  }, [item]);

  // Drop the old banner once the new one has fully faded in.
  useEffect(() => {
    if (layers.length < 2) return;
    const timer = setTimeout(() => setLayers(l => l.slice(-1)), FADE_MS + 100);
    return () => clearTimeout(timer);
  }, [layers]);

  if (!layers.length) return <Hero item={null} type={type} />;
  const fading = layers.length > 1;
  return (
    <div style={{ position: 'relative' }}>
      {layers.map((layer, i) => {
        const incoming = fading && i === layers.length - 1;
        const outgoing = fading && i < layers.length - 1;
        return (
          <div
            key={layer.key}
            aria-hidden={outgoing || undefined}
            style={incoming
              ? { position: 'absolute', inset: 0, zIndex: 1, animation: `heroFade ${FADE_MS}ms ease-in-out both` }
              : { pointerEvents: outgoing ? 'none' : undefined }}
          >
            <Hero item={layer.item} type={type} contentFade={incoming ? 'in' : outgoing ? 'out' : null} />
          </div>
        );
      })}
    </div>
  );
}

export default function Hero({ item, type = 'movie', contentFade = null }) {
  const navigate = useNavigate();
  const [showOverview, setShowOverview] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  useEffect(() => {
    const h = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', h);
    return () => window.removeEventListener('resize', h);
  }, []);

  if (!item) {
    return (
      <div style={{
        height: '70vh',
        background: 'linear-gradient(135deg, #0f0f0f 0%, #1a1a2e 50%, #0f0f0f 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '64px', marginBottom: '16px' }}>🎬</div>
          <div style={{ fontSize: '22px', fontWeight: '700', color: '#fff', marginBottom: '8px' }}>
            Welcome to Streamulus
          </div>
          <div style={{ color: '#666', fontSize: '15px' }}>
            Add media libraries to start browsing
          </div>
        </div>
      </div>
    );
  }

  const backdrop = item.backdrop_url || item.poster_url;
  const title = item.title || item.name;
  const overview = item.overview || '';

  return (
    <div style={{
      position: 'relative',
      // Taller on desktop so the title and buttons sit low, Netflix-style.
      height: isMobile ? '80vh' : '90vh',
      minHeight: '500px',
      overflow: 'hidden',
    }}>
      {backdrop && (
        <img
          src={backdrop}
          alt={title}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            objectPosition: 'center top',
          }}
        />
      )}

      {/* Gradients */}
      <div style={{
        position: 'absolute',
        inset: 0,
        background: 'linear-gradient(to right, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.4) 50%, transparent 100%)',
      }} />
      <div style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        height: '200px',
        background: 'linear-gradient(to top, #0f0f0f, transparent)',
      }} />

      {/* Content */}
      <div style={{
        position: 'absolute',
        bottom: isMobile ? '20px' : '16px',
        left: isMobile ? '16px' : '48px',
        right: isMobile ? '16px' : 'auto',
        maxWidth: isMobile ? 'none' : '550px',
        animation: contentFade === 'in' ? 'heroFade 600ms ease-in-out 450ms both'
          : contentFade === 'out' ? 'heroFadeOut 350ms ease-out both' : undefined,
      }}>
        <div style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          background: 'rgba(0,194,255,0.15)',
          border: '1px solid rgba(0,194,255,0.3)',
          borderRadius: '20px',
          padding: '4px 12px',
          fontSize: '11px',
          fontWeight: '700',
          color: '#00c2ff',
          textTransform: 'uppercase',
          letterSpacing: '1px',
          marginBottom: '16px',
        }}>
          {item.rating && `★ ${item.rating.toFixed(1)} · `}{type === 'movie' ? 'Movie' : 'TV Show'}
        </div>

        <TitleLogo
          logoUrl={item.logo_url}
          title={title}
          maxWidth={isMobile ? 260 : 520}
          maxHeight={isMobile ? 90 : 170}
          style={{ marginBottom: '16px' }}
          textStyle={{
            fontSize: isMobile ? '28px' : '52px',
            fontWeight: '800',
            lineHeight: 1.05,
            marginBottom: '12px',
            textShadow: '0 2px 8px rgba(0,0,0,0.5)',
            letterSpacing: isMobile ? '-0.5px' : '-1px',
          }}
        />

        {item.year && (
          <div style={{ fontSize: '15px', color: '#aaa', marginBottom: '16px' }}>
            {item.year}
          </div>
        )}

        {overview && !isMobile && (
          <p style={{
            fontSize: '15px',
            color: '#ccc',
            lineHeight: '1.6',
            marginBottom: '28px',
            display: '-webkit-box',
            WebkitLineClamp: showOverview ? 'none' : 3,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            cursor: 'pointer',
          }}
            onClick={() => setShowOverview(v => !v)}
          >
            {overview}
          </p>
        )}

        <div style={{ display: 'flex', gap: '10px' }}>
          <button
            onClick={() => navigate(type === 'movie' ? `/movie/${item.id}` : `/watch/${type}/${item.id}`)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: isMobile ? '11px 20px' : '14px 32px',
              background: '#00c2ff',
              color: '#000',
              border: 'none',
              borderRadius: '8px',
              fontSize: isMobile ? '14px' : '16px',
              fontWeight: '700',
              cursor: 'pointer',
              transition: 'all 0.2s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = '#33cfff'; e.currentTarget.style.transform = 'scale(1.03)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = '#00c2ff'; e.currentTarget.style.transform = 'scale(1)'; }}
          >
            ▶ Play Now
          </button>
          <button
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: isMobile ? '11px 16px' : '14px 24px',
              background: 'rgba(255,255,255,0.15)',
              color: '#fff',
              border: '1px solid rgba(255,255,255,0.2)',
              borderRadius: '8px',
              fontSize: isMobile ? '14px' : '16px',
              fontWeight: '600',
              cursor: 'pointer',
              backdropFilter: 'blur(8px)',
              transition: 'all 0.2s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.25)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.15)'; }}
          >
            ⓘ More Info
          </button>
        </div>
      </div>
    </div>
  );
}
