import React, { useRef, useState } from 'react';
import MediaCard from './MediaCard';

export default function MediaRow({ title, items = [], type = 'movie' }) {
  const rowRef = useRef(null);
  const [showLeft, setShowLeft] = useState(false);
  const [showRight, setShowRight] = useState(true);

  const scroll = (dir) => {
    const el = rowRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * 600, behavior: 'smooth' });
  };

  const onScroll = () => {
    const el = rowRef.current;
    if (!el) return;
    setShowLeft(el.scrollLeft > 0);
    setShowRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 10);
  };

  if (!items.length) return null;

  const btnStyle = (visible) => ({
    position: 'absolute',
    top: '50%',
    transform: 'translateY(-50%)',
    zIndex: 5,
    background: 'rgba(15,15,15,0.9)',
    border: '1px solid rgba(255,255,255,0.12)',
    color: '#fff',
    borderRadius: '50%',
    width: '42px',
    height: '42px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    fontSize: '18px',
    transition: 'all 0.2s',
    opacity: visible ? 1 : 0,
    pointerEvents: visible ? 'auto' : 'none',
    backdropFilter: 'blur(8px)',
  });

  return (
    <div style={{ marginBottom: '40px' }}>
      <h2 style={{
        fontSize: '18px',
        fontWeight: '700',
        marginBottom: '16px',
        paddingLeft: '32px',
        color: '#fff',
      }}>
        {title}
      </h2>
      <div style={{ position: 'relative', paddingLeft: '32px' }}>
        <button
          style={{ ...btnStyle(showLeft), left: '4px' }}
          onClick={() => scroll(-1)}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(0,194,255,0.2)'; e.currentTarget.style.borderColor = '#00c2ff'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'rgba(15,15,15,0.9)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)'; }}
        >
          ‹
        </button>

        <div
          ref={rowRef}
          onScroll={onScroll}
          style={{
            display: 'flex',
            gap: '12px',
            overflowX: 'auto',
            paddingBottom: '8px',
            paddingRight: '32px',
            scrollbarWidth: 'none',
            msOverflowStyle: 'none',
          }}
        >
          {items.map(item => (
            <MediaCard key={item.id} item={item} type={type} />
          ))}
        </div>

        <button
          style={{ ...btnStyle(showRight && items.length > 5), right: '4px' }}
          onClick={() => scroll(1)}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(0,194,255,0.2)'; e.currentTarget.style.borderColor = '#00c2ff'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'rgba(15,15,15,0.9)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)'; }}
        >
          ›
        </button>
      </div>
    </div>
  );
}
