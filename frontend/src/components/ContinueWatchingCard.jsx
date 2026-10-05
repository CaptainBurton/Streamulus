import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';

function fmtTime(secs) {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// Wide card showing a frame from where you stopped (falls back to the banner,
// then the poster). Title and progress are always visible, like Netflix.
export default function ContinueWatchingCard({ item }) {
  const navigate = useNavigate();
  const [hovered, setHovered] = useState(false);
  const token = localStorage.getItem('streamulus_token');
  const sources = [
    `/api/stream/still/${item.type}/${item.id}?t=${Math.floor(item.position || 0)}&token=${encodeURIComponent(token || '')}`,
    item.backdrop_url,
    item.poster_url,
  ].filter(Boolean);
  const [sourceIndex, setSourceIndex] = useState(0);
  const src = sources[sourceIndex];

  const pct = item.duration > 0 ? Math.min(98, Math.round((item.position / item.duration) * 100)) : null;

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
        width: '300px',
        aspectRatio: '16 / 9',
        background: '#1e1e1e',
        transition: 'transform 0.25s, box-shadow 0.25s',
        transform: hovered ? 'scale(1.05) translateY(-4px)' : 'scale(1)',
        boxShadow: hovered ? '0 16px 40px rgba(0,0,0,0.8)' : '0 2px 8px rgba(0,0,0,0.4)',
        zIndex: hovered ? 10 : 1,
      }}
    >
      {src && (
        <img
          src={src}
          alt=""
          loading="lazy"
          onError={() => setSourceIndex(i => i + 1)}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
      )}

      <div style={{
        position: 'absolute', inset: 0,
        background: 'linear-gradient(to top, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.35) 45%, transparent 75%)',
        display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
        padding: '10px 12px 14px',
      }}>
        <div style={{ fontSize: '14px', fontWeight: 700, color: '#fff', lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {item.title}
        </div>
        <div style={{ fontSize: '12px', color: '#bbb', marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {hovered ? `▶ Resume · ${fmtTime(item.position)}` : (item.subtitle || `${fmtTime(item.position)} watched`)}
        </div>
      </div>

      {/* Progress bar */}
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '4px', background: 'rgba(255,255,255,0.18)' }}>
        <div style={{ height: '100%', width: pct !== null ? `${pct}%` : '40%', background: '#00c2ff' }} />
      </div>

      {/* Play button on hover */}
      <div style={{
        position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -60%)',
        width: '48px', height: '48px', borderRadius: '50%', background: 'rgba(0,0,0,0.55)', border: '2px solid rgba(255,255,255,0.85)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: '18px',
        opacity: hovered ? 1 : 0, transition: 'opacity 0.2s', pointerEvents: 'none',
      }}>▶</div>
    </div>
  );
}
