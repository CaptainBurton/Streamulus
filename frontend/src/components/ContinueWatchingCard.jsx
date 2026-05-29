import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';

const PLACEHOLDER = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="200" height="300" viewBox="0 0 200 300"%3E%3Crect width="200" height="300" fill="%231e1e1e"/%3E%3Ctext x="100" y="155" text-anchor="middle" fill="%23444" font-size="14" font-family="Inter,sans-serif"%3ENo Image%3C/text%3E%3C/svg%3E';

function fmtTime(secs) {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export default function ContinueWatchingCard({ item }) {
  const navigate = useNavigate();
  const [hovered, setHovered] = useState(false);
  const [imgError, setImgError] = useState(false);

  const pct = item.duration > 0 ? Math.min(98, Math.round((item.position / item.duration) * 100)) : null;
  const poster = imgError || !item.poster_url ? PLACEHOLDER : item.poster_url;

  return (
    <div
      onClick={() => navigate(`/watch/${item.type}/${item.id}`)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: 'relative',
        borderRadius: '8px',
        overflow: 'hidden',
        cursor: 'pointer',
        flexShrink: 0,
        width: '160px',
        transition: 'transform 0.25s, box-shadow 0.25s',
        transform: hovered ? 'scale(1.06) translateY(-4px)' : 'scale(1)',
        boxShadow: hovered ? '0 16px 40px rgba(0,0,0,0.8)' : '0 2px 8px rgba(0,0,0,0.4)',
        zIndex: hovered ? 10 : 1,
      }}
    >
      <img
        src={poster}
        alt={item.title}
        onError={() => setImgError(true)}
        style={{ width: '100%', aspectRatio: '2/3', objectFit: 'cover', display: 'block' }}
      />

      {/* Progress bar */}
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '3px', background: 'rgba(255,255,255,0.15)' }}>
        <div style={{
          height: '100%',
          width: pct !== null ? `${pct}%` : '40%',
          background: '#00c2ff',
        }} />
      </div>

      {/* Hover overlay */}
      <div style={{
        position: 'absolute',
        inset: 0,
        background: 'linear-gradient(to top, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.15) 60%, transparent 100%)',
        opacity: hovered ? 1 : 0,
        transition: 'opacity 0.25s',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-end',
        padding: '10px',
        paddingBottom: '14px',
      }}>
        <div style={{ fontSize: '12px', fontWeight: '600', color: '#fff', marginBottom: '2px', lineHeight: 1.3 }}>
          {item.title}
        </div>
        {item.subtitle && (
          <div style={{ fontSize: '10px', color: '#aaa', marginBottom: '4px' }}>{item.subtitle}</div>
        )}
        <div style={{ background: '#00c2ff', color: '#000', borderRadius: '4px', padding: '4px 0', textAlign: 'center', fontSize: '11px', fontWeight: '700' }}>
          ▶ Resume · {fmtTime(item.position)}
        </div>
      </div>
    </div>
  );
}
