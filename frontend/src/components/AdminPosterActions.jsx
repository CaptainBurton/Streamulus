import React from 'react';

// Pencil (edit) and magnifying glass (search), from the supplied SVGs; they
// take the button's text colour.
export const PencilIcon = ({ size = 18 }) => (
  <svg viewBox="0 0 23.6475 23.3041" width={size} height={size} fill="currentColor" aria-hidden="true" style={{ display: 'block', flexShrink: 0 }}>
    <path d="M17.0714 3.37706L15.5591 4.88935L7.07275 4.88935C5.47119 4.88935 4.56299 5.79755 4.56299 7.39912L4.56299 16.5397C4.56299 18.1511 5.47119 19.0495 7.07275 19.0495L16.2134 19.0495C17.8247 19.0495 18.7231 18.1511 18.7231 16.5397L18.7231 8.12957L20.2422 6.60772C20.2787 6.85929 20.2954 7.12741 20.2954 7.40888L20.2954 16.5397C20.2954 19.1667 18.8403 20.6218 16.2134 20.6218L7.07275 20.6218C4.45557 20.6218 2.99072 19.1667 2.99072 16.5397L2.99072 7.40888C2.99072 4.78193 4.45557 3.31708 7.07275 3.31708L16.2134 3.31708C16.5157 3.31708 16.8024 3.33648 17.0714 3.37706Z" />
    <path d="M9.61182 14.2936L11.5161 13.4636L20.6372 4.35224L19.2993 3.03388L10.188 12.1452L9.30908 13.9811C9.23096 14.1472 9.42627 14.3718 9.61182 14.2936ZM21.3599 3.63935L22.063 2.91669C22.395 2.56513 22.395 2.09638 22.063 1.77412L21.8384 1.53974C21.5356 1.23701 21.0571 1.27607 20.7349 1.58857L20.022 2.29169Z" />
  </svg>
);

export const SearchIcon = ({ size = 16 }) => (
  <svg viewBox="0 0 19.4434 19.2676" width={size} height={size} fill="currentColor" aria-hidden="true" style={{ display: 'block', flexShrink: 0 }}>
    <path d="M0 7.79297C0 12.0898 3.49609 15.5859 7.79297 15.5859C9.49219 15.5859 11.0449 15.0391 12.3242 14.1211L17.1289 18.9355C17.3535 19.1602 17.6465 19.2676 17.959 19.2676C18.623 19.2676 19.082 18.7695 19.082 18.1152C19.082 17.8027 18.9648 17.5195 18.7598 17.3145L13.9844 12.5098C14.9902 11.2012 15.5859 9.57031 15.5859 7.79297C15.5859 3.49609 12.0898 0 7.79297 0C3.49609 0 0 3.49609 0 7.79297ZM1.66992 7.79297C1.66992 4.41406 4.41406 1.66992 7.79297 1.66992C11.1719 1.66992 13.916 4.41406 13.916 7.79297C13.916 11.1719 11.1719 13.916 7.79297 13.916C4.41406 13.916 1.66992 11.1719 1.66992 7.79297Z" />
  </svg>
);

const base = {
  width: '100%', padding: '9px 0', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
  background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)', color: '#999',
  borderRadius: '8px', fontSize: '13px', fontWeight: '600', cursor: 'pointer', transition: 'all 0.15s',
};
const hoverOn = e => { e.currentTarget.style.background = 'rgba(0,194,255,0.1)'; e.currentTarget.style.borderColor = 'rgba(0,194,255,0.3)'; e.currentTarget.style.color = '#00c2ff'; };
const hoverOff = e => { e.currentTarget.style.background = 'rgba(255,255,255,0.07)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)'; e.currentTarget.style.color = '#999'; };

// Admin buttons under a movie/show poster: Edit Artwork, then Fix Match below it.
export default function AdminPosterActions({ onEditArtwork, onFixMatch, width = 220 }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: `${width}px`, marginTop: '10px' }}>
      <button onClick={onEditArtwork} style={base} onMouseEnter={hoverOn} onMouseLeave={hoverOff}>
        <PencilIcon /> Edit Artwork
      </button>
      <button onClick={onFixMatch} style={base} onMouseEnter={hoverOn} onMouseLeave={hoverOff}>
        <SearchIcon /> Fix Match
      </button>
    </div>
  );
}
