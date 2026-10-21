import React from 'react';

// A streaming service's logo in the Streamulus colours: the SVG is a mask over
// the cyan → purple gradient, so every service's logo matches the app.
export const SERVICE_GRADIENT = 'linear-gradient(90deg, #00c2ff, #7b2fff)';

// Width and height for a logo inside a box, by area rather than by fitting: a
// tall logo (HBO Max) and a long one (Crunchyroll) then look about the same size.
export function logoSize(aspect, boxWidth, boxHeight, fill = 0.17, maxWidth = 0.78, maxHeight = 0.5) {
  const a = aspect > 0 ? aspect : 3;
  const area = fill * boxWidth * boxHeight;
  let width = Math.sqrt(area * a);
  let height = width / a;
  const shrink = Math.min(1, (maxWidth * boxWidth) / width, (maxHeight * boxHeight) / height);
  width *= shrink; height *= shrink;
  return { width: Math.round(width), height: Math.round(height) };
}

export default function ServiceLogo({ service, width, height, color = SERVICE_GRADIENT, style }) {
  const mask = `url(${service.logo_svg}) center / contain no-repeat`;
  return (
    <div role="img" aria-label={service.name}
      style={{ width, height, flexShrink: 0, background: color, WebkitMask: mask, mask, ...style }} />
  );
}
