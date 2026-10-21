import React from 'react';
import { useNavigate } from 'react-router-dom';

// The poster grid and All / Movies / TV Shows switch shared by the Genre and
// streaming service pages.

const PLACEHOLDER = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="200" height="300" viewBox="0 0 200 300"%3E%3Crect width="200" height="300" fill="%231e1e1e"/%3E%3Ctext x="100" y="155" text-anchor="middle" fill="%23444" font-size="14" font-family="Inter,sans-serif"%3ENo Image%3C/text%3E%3C/svg%3E';

export const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'movies', label: 'Movies' },
  { key: 'shows', label: 'TV Shows' },
];

const sortKey = (t = '') => t.replace(/^(the|a|an)\s+/i, '');

// { movies, shows } from the server → one A–Z list for the chosen filter.
export function sortTitles(data, type) {
  if (!data) return [];
  return [
    ...(type !== 'shows' ? data.movies.map(m => ({ ...m, kind: 'movie' })) : []),
    ...(type !== 'movies' ? data.shows.map(s => ({ ...s, kind: 'show' })) : []),
  ].sort((a, b) => sortKey(a.title).localeCompare(sortKey(b.title), undefined, { sensitivity: 'base' }));
}

export function FilterTabs({ type, onChange, countFor }) {
  return (
    <div role="tablist" aria-label="Show" style={{ display: 'flex', gap: '8px', background: 'rgba(255,255,255,0.05)', padding: '4px', borderRadius: '999px' }}>
      {FILTERS.map(f => {
        const active = f.key === type;
        return (
          <button
            key={f.key}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(f.key)}
            style={{
              padding: '8px 18px', borderRadius: '999px', border: 'none', cursor: 'pointer', fontSize: '13px', fontWeight: '700',
              background: active ? '#00c2ff' : 'transparent', color: active ? '#000' : '#bbb', transition: 'background 0.2s, color 0.2s',
            }}
          >
            {f.label} <span style={{ opacity: 0.6, fontWeight: '600' }}>{countFor(f.key)}</span>
          </button>
        );
      })}
    </div>
  );
}

// showKind: label each poster MOVIE / TV (when both are listed).
export default function TitleGrid({ items, showKind }) {
  const navigate = useNavigate();
  return (
    <div className="media-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '16px' }}>
      {items.map(item => (
        <div
          key={`${item.kind}-${item.id}`}
          onClick={() => navigate(item.kind === 'movie' ? `/movie/${item.id}` : `/tv/${item.id}`)}
          style={{ cursor: 'pointer', borderRadius: '8px', transition: 'transform 0.2s, box-shadow 0.2s' }}
          onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.05)'; e.currentTarget.style.boxShadow = '0 12px 32px rgba(0,0,0,0.7)'; }}
          onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.boxShadow = 'none'; }}
        >
          <div style={{ borderRadius: '8px', overflow: 'hidden', position: 'relative' }}>
            <img src={item.poster_url || PLACEHOLDER} alt={item.title} onError={e => { e.target.src = PLACEHOLDER; }}
              style={{ width: '100%', aspectRatio: '2/3', objectFit: 'cover', display: 'block' }} />
            {showKind && (
              <div style={{ position: 'absolute', top: '8px', left: '8px', fontSize: '10px', fontWeight: '800', letterSpacing: '0.5px', padding: '3px 7px', borderRadius: '4px', background: 'rgba(0,0,0,0.7)', color: item.kind === 'movie' ? '#00c2ff' : '#b48cff' }}>
                {item.kind === 'movie' ? 'MOVIE' : 'TV'}
              </div>
            )}
            <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '12px 10px 10px', background: 'linear-gradient(to top, rgba(0,0,0,0.9), transparent)' }}>
              <div style={{ fontSize: '12px', fontWeight: '600', color: '#fff', lineHeight: 1.3 }}>{item.title}</div>
              <div style={{ fontSize: '11px', color: '#888', marginTop: '2px' }}>{item.year || item.first_air_date?.split('-')[0] || ''}</div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
