import React from 'react';

// Envelope used on the email buttons. Drawn rather than the ✉ character,
// which some systems show tiny or as a broken box. Sized in em so it scales
// with the button text; colour follows the text.
export default function MailIcon({ size = '1.3em', style }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ height: size, width: size, flexShrink: 0, display: 'inline-block', verticalAlign: 'middle', ...style }}
    >
      <rect x="2.5" y="4.5" width="19" height="15" rx="2.5" />
      <path d="M3.5 6.5l8.5 6.5 8.5-6.5" />
    </svg>
  );
}
