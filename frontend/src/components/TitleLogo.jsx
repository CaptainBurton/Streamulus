import React, { useState } from 'react';

// The title's logo artwork (from TMDB), or the plain title if there isn't one
// or it fails to load. Rendered as the page's <h1> either way.
export default function TitleLogo({ logoUrl, title, maxWidth = 480, maxHeight = 160, textStyle, style }) {
  const [failed, setFailed] = useState(false);
  if (!logoUrl || failed) return <h1 style={textStyle}>{title}</h1>;
  return (
    <h1 style={{ margin: 0, lineHeight: 0, ...style }}>
      <img
        src={logoUrl}
        alt={title}
        onError={() => setFailed(true)}
        style={{ display: 'block', maxWidth: `min(${maxWidth}px, 100%)`, maxHeight: `${maxHeight}px`, width: 'auto', height: 'auto', objectFit: 'contain', filter: 'drop-shadow(0 4px 18px rgba(0,0,0,0.6))' }}
      />
    </h1>
  );
}
