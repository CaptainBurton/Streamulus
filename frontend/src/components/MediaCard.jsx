import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';

const PLACEHOLDER = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="200" height="300" viewBox="0 0 200 300"%3E%3Crect width="200" height="300" fill="%231e1e1e"/%3E%3Ctext x="100" y="155" text-anchor="middle" fill="%23444" font-size="14" font-family="Inter,sans-serif"%3ENo Image%3C/text%3E%3C/svg%3E';

export default function MediaCard({ item, type = 'movie' }) {
  const navigate = useNavigate();
  const [hovered, setHovered] = useState(false);
  const [imgError, setImgError] = useState(false);

  // Movies open the detail page; TV shows open the TV browse page
  const handleClick = () => type === 'movie' ? navigate(`/movie/${item.id}`) : navigate('/tv');

  const poster = imgError || !item.poster_url ? PLACEHOLDER : item.poster_url;
  const rating = item.rating ? item.rating.toFixed(1) : null;
  const year = type === 'movie' ? item.year : item.first_air_date?.split('-')[0];

  return (
    <div
      onClick={type === 'tv' ? () => navigate(`/tv`) : handleClick}
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
        alt={item.title || item.name}
        onError={() => setImgError(true)}
        style={{ width: '100%', aspectRatio: '2/3', objectFit: 'cover', display: 'block' }}
      />

      {/* Hover overlay */}
      <div style={{
        position: 'absolute',
        inset: 0,
        background: 'linear-gradient(to top, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.2) 60%, transparent 100%)',
        opacity: hovered ? 1 : 0,
        transition: 'opacity 0.25s',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-end',
        padding: '12px',
      }}>
        <div style={{ fontSize: '13px', fontWeight: '600', color: '#fff', marginBottom: '4px', lineHeight: 1.3 }}>
          {item.title || item.name}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {year && <span style={{ fontSize: '11px', color: '#aaa' }}>{year}</span>}
          {rating && (
            <span style={{ fontSize: '11px', color: '#00c2ff', fontWeight: '600' }}>
              ★ {rating}
            </span>
          )}
        </div>
        {type === 'movie' && (
          <div style={{ marginTop: '8px', background: '#00c2ff', color: '#000', borderRadius: '4px', padding: '5px 0', textAlign: 'center', fontSize: '12px', fontWeight: '700' }}>
            More Info
          </div>
        )}
      </div>

      {/* Rating badge always visible */}
      {rating && (
        <div style={{
          position: 'absolute',
          top: '8px',
          right: '8px',
          background: 'rgba(0,0,0,0.75)',
          borderRadius: '4px',
          padding: '2px 6px',
          fontSize: '11px',
          fontWeight: '600',
          color: '#00c2ff',
          opacity: hovered ? 0 : 1,
          transition: 'opacity 0.2s',
        }}>
          ★ {rating}
        </div>
      )}
    </div>
  );
}
