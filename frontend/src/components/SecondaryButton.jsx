import React from 'react';

// Frosted secondary action button — same look and hover as the homepage
// "More Info" button. Used next to the main Play button on detail pages.
export default function SecondaryButton({ onClick, disabled, title, children }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        display: 'flex', alignItems: 'center', gap: '8px',
        padding: '14px 24px',
        background: 'rgba(255,255,255,0.15)', color: '#fff',
        border: '1px solid rgba(255,255,255,0.2)', borderRadius: '8px',
        fontSize: '16px', fontWeight: '600',
        cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.6 : 1,
        backdropFilter: 'blur(8px)', transition: 'all 0.2s',
      }}
      onMouseEnter={e => { if (!disabled) e.currentTarget.style.background = 'rgba(255,255,255,0.25)'; }}
      onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.15)'; }}
    >
      {children}
    </button>
  );
}
