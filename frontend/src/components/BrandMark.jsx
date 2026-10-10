import React, { useEffect, useState } from 'react';

// Site branding from the server (Admin › Settings › Branding): logo on/off,
// custom logo, "STREAMULUS" text on/off. Loaded once and shared; the admin
// page pushes changes here so every BrandMark updates straight away.
const DEFAULT = { showLogo: true, showText: true, logoUrl: null, publicUrl: null };
let cache = null;
let pending = null;
const listeners = new Set();

export function setBranding(branding) {
  cache = { ...DEFAULT, ...branding };
  listeners.forEach(fn => fn(cache));
}

export function loadBranding() {
  if (!pending) {
    pending = fetch('/api/branding')
      .then(r => (r.ok ? r.json() : DEFAULT))
      .then(setBranding)
      .catch(() => setBranding(DEFAULT))
      .finally(() => { pending = null; });
  }
  return pending;
}

export function useBranding() {
  const [branding, set] = useState(cache || DEFAULT);
  useEffect(() => {
    listeners.add(set);
    if (!cache) loadBranding();
    return () => listeners.delete(set);
  }, []);
  return branding;
}

export const DEFAULT_LOGO = '/streamulus-logo.png';

// Logo and/or wordmark. `size` is the text size in px; the logo is a bit taller.
export default function BrandMark({ size = 26, style }) {
  const { showLogo, showText, logoUrl } = useBranding();
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: `${Math.round(size * 0.35)}px`, ...style }}>
      {showLogo && (
        <img
          src={logoUrl || DEFAULT_LOGO}
          alt={showText ? '' : 'Streamulus'}
          style={{ height: `${Math.round(size * 1.35)}px`, width: 'auto', display: 'block', flexShrink: 0 }}
        />
      )}
      {showText && (
        <span style={{
          fontSize: `${size}px`, fontWeight: 800, letterSpacing: size >= 36 ? '-1px' : '-0.5px', lineHeight: 1,
          background: 'linear-gradient(135deg, #00c2ff, #7b2fff)',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
        }}>
          STREAMULUS
        </span>
      )}
    </span>
  );
}
