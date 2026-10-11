import React, { useEffect, useRef } from 'react';

// One feedback conversation as chat bubbles: the person's messages on one side,
// the admin's on the other. `mine` says which side is "us" ('user' or 'admin').
export const KIND_LABELS = { feedback: 'Feedback', suggestion: 'App Suggestion' };
export const STATUS_LABELS = { open: 'Waiting for reply', answered: 'Answered', closed: 'Closed' };
export const STATUS_COLORS = { open: '#ffb703', answered: '#00c864', closed: '#777' };
export const PLATFORM_LABELS = { web: 'Web', iphone: 'iPhone', ipad: 'iPad', android: 'Android', 'android-tablet': 'Android tablet', appletv: 'Apple TV' };

export function when(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString([], { day: 'numeric', month: 'short', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' })
      + ', ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function StatusPill({ status }) {
  const color = STATUS_COLORS[status] || '#777';
  return (
    <span style={{ padding: '2px 9px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, color, border: `1px solid ${color}55`, whiteSpace: 'nowrap' }}>
      {STATUS_LABELS[status] || status}
    </span>
  );
}

export default function FeedbackThread({ item, mine }) {
  const end = useRef(null);
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest' }); }, [item.messages.length]);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      {item.messages.map(m => {
        const ours = mine === 'admin' ? m.fromAdmin : !m.fromAdmin;
        return (
          <div key={m.id} style={{ display: 'flex', flexDirection: 'column', alignItems: ours ? 'flex-end' : 'flex-start' }}>
            <div style={{
              maxWidth: '85%', padding: '10px 14px', borderRadius: '14px', fontSize: '14px', lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              background: ours ? 'rgba(0,194,255,0.16)' : 'rgba(255,255,255,0.07)',
              border: `1px solid ${ours ? 'rgba(0,194,255,0.3)' : 'rgba(255,255,255,0.1)'}`,
              borderBottomRightRadius: ours ? '4px' : '14px', borderBottomLeftRadius: ours ? '14px' : '4px',
            }}>
              {m.body}
            </div>
            <div style={{ fontSize: '11px', color: '#666', marginTop: '4px' }}>
              {m.fromAdmin ? `${m.author || 'Admin'} (admin)` : m.author} · {when(m.createdAt)}
            </div>
          </div>
        );
      })}
      <div ref={end} />
    </div>
  );
}
