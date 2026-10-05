import React from 'react';

// Round profile picture: the uploaded image (GIFs animate) or the first letter
// on a gradient. Streamlings (kids profiles) get a warmer gradient.
export const STREAMLING_GRADIENT = 'linear-gradient(135deg, #ffb703, #fb5607)';
const DEFAULT_GRADIENT = 'linear-gradient(135deg, #00c2ff, #7b2fff)';

export default function ProfileAvatar({ profile, size = 34, radius = '50%', style }) {
  const base = {
    width: size, height: size, borderRadius: radius, flexShrink: 0, overflow: 'hidden',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: profile?.is_kids ? STREAMLING_GRADIENT : DEFAULT_GRADIENT,
    color: '#fff', fontWeight: 700, fontSize: Math.round(size * 0.4), userSelect: 'none',
    ...style,
  };
  return (
    <div style={base}>
      {profile?.avatar_url
        ? <img src={profile.avatar_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        : (profile?.name?.[0] || '?').toUpperCase()}
    </div>
  );
}
