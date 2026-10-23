import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { noteAdminCounts } from './Navbar';
import ProfileAvatar from './ProfileAvatar';
import FeedbackThread, { KIND_LABELS, PLATFORM_LABELS, STATUS_LABELS, StatusPill, when } from './FeedbackThread';

// Admin › Feedback: feedback and app suggestions from Profile & Settings in the
// apps and on the web. Reply, close, reopen or delete. A blue dot means the person
// wrote something you haven't opened yet.
const FILTERS = ['all', 'open', 'answered', 'closed'];

export default function FeedbackAdmin({ flash, onCountsChanged }) {
  const [data, setData] = useState(null); // { items, counts, unreadCount }
  const [filter, setFilter] = useState('open');
  const [openId, setOpenId] = useState(null);

  const load = (f = filter) => axios.get('/api/admin/feedback', { params: f === 'all' ? {} : { status: f } })
    .then(r => {
      setData(r.data);
      noteAdminCounts({ feedback: r.data.unreadCount });
      onCountsChanged?.(r.data.unreadCount);
    })
    .catch(() => { setData({ items: [], counts: {}, unreadCount: 0 }); flash('Failed to load feedback', true); });

  useEffect(() => { load(filter); }, [filter]);

  const open = async (item) => {
    const next = openId === item.id ? null : item.id;
    setOpenId(next);
    if (next && item.unread) {
      await axios.post(`/api/admin/feedback/${item.id}/read`).catch(() => {});
      load();
    }
  };

  const counts = data?.counts || {};
  const total = (counts.open || 0) + (counts.answered || 0) + (counts.closed || 0);
  const countFor = (f) => (f === 'all' ? total : counts[f] || 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={S.card}>
        <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '6px' }}>Feedback &amp; Suggestions</h3>
        <p style={{ color: '#777', fontSize: '13px', lineHeight: 1.6, marginBottom: '16px' }}>
          Sent from Profile &amp; Settings in the iPhone, iPad and Android apps, and from Profile &amp; Account on the web.
          Your replies appear in the app or page they use, marked as new.
        </p>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {FILTERS.map(f => (
            <button key={f} onClick={() => { setFilter(f); setOpenId(null); }} style={{ ...S.chip, ...(filter === f ? S.chipOn : {}) }}>
              {f === 'all' ? 'All' : STATUS_LABELS[f]} ({countFor(f)})
            </button>
          ))}
        </div>
      </div>

      {data === null && <div style={{ color: '#666', fontSize: '14px' }}>Loading…</div>}
      {data?.items.length === 0 && (
        <div style={{ ...S.card, textAlign: 'center', color: '#777', fontSize: '14px' }}>
          {filter === 'open' ? 'Nothing waiting for a reply.' : 'Nothing here.'}
        </div>
      )}
      {(data?.items || []).map(item => (
        <div key={item.id} style={{ ...S.card, padding: 0, overflow: 'hidden' }} data-feedback={item.id}>
          <button onClick={() => open(item)} style={S.row} aria-expanded={openId === item.id}>
            <span style={{ ...S.dot, visibility: item.unread ? 'visible' : 'hidden' }} title="New from them" />
            <ProfileAvatar profile={{ name: item.profileName || item.username, avatar_url: item.profileAvatarUrl, is_kids: item.profileIsKids }} size={34} />
            <span style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
              <span style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '3px' }}>
                <strong style={{ fontSize: '14px' }}>{item.profileName || item.username}</strong>
                {item.profileName && item.profileName !== item.username && <span style={{ color: '#666', fontSize: '12px' }}>({item.username})</span>}
                {item.profileIsKids && <span style={S.kid}>Streamling</span>}
                <span style={{ color: '#888', fontSize: '12px' }}>· {KIND_LABELS[item.kind]}</span>
                <StatusPill status={item.status} />
              </span>
              <span style={{ display: 'block', color: '#999', fontSize: '13px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.preview}</span>
            </span>
            <span style={{ color: '#555', fontSize: '12px', whiteSpace: 'nowrap' }}>{when(item.updatedAt)}</span>
          </button>
          {openId === item.id && <AdminConversation item={item} reload={load} flash={flash} onRemoved={() => setOpenId(null)} />}
        </div>
      ))}
    </div>
  );
}

function AdminConversation({ item, reload, flash, onRemoved }) {
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const run = async (fn, ok) => {
    setBusy(true);
    try { await fn(); if (ok) flash(ok); await reload(); } catch (err) { flash(err.response?.data?.error || 'Something went wrong', true); }
    setBusy(false);
  };

  const send = (e) => {
    e.preventDefault();
    run(async () => { await axios.post(`/api/admin/feedback/${item.id}/messages`, { message: reply }); setReply(''); }, 'Reply sent');
  };

  return (
    <div style={{ padding: '4px 18px 18px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
      <div style={{ color: '#666', fontSize: '12px', padding: '10px 0 0' }}>
        {PLATFORM_LABELS[item.platform] || item.platform || 'Unknown device'}{item.appVersion ? ` · app ${item.appVersion}` : ''} · sent {when(item.createdAt)}
      </div>
      <div style={{ padding: '14px 0' }}><FeedbackThread item={item} mine="admin" /></div>
      <form onSubmit={send} style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
        <textarea value={reply} onChange={e => setReply(e.target.value)} rows={3} maxLength={4000}
          placeholder={`Reply to ${item.profileName || item.username}…`} aria-label="Reply" style={S.textarea} />
        <button type="submit" disabled={busy || !reply.trim()} style={{ ...S.primary, opacity: busy || !reply.trim() ? 0.5 : 1 }}>Send Reply</button>
      </form>
      <div style={{ display: 'flex', gap: '8px', marginTop: '12px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        {item.status === 'closed'
          ? <button style={S.secondary} disabled={busy} onClick={() => run(() => axios.put(`/api/admin/feedback/${item.id}`, { status: 'open' }), 'Reopened')}>Reopen</button>
          : <button style={S.secondary} disabled={busy} onClick={() => run(() => axios.put(`/api/admin/feedback/${item.id}`, { status: 'closed' }), 'Closed')}>Close</button>}
        <button style={S.danger} disabled={busy} onClick={() => {
          if (!confirmDelete) { setConfirmDelete(true); setTimeout(() => setConfirmDelete(false), 4000); return; }
          run(async () => { await axios.delete(`/api/admin/feedback/${item.id}`); onRemoved(); }, 'Deleted');
        }}>{confirmDelete ? 'Click again to delete' : 'Delete'}</button>
      </div>
    </div>
  );
}

const S = {
  card: { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', padding: '22px' },
  chip: { padding: '7px 14px', borderRadius: '20px', border: '1px solid rgba(255,255,255,0.15)', background: 'transparent', color: '#bbb', fontSize: '13px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
  chipOn: { background: '#fff', color: '#000', border: '1px solid #fff' },
  row: { width: '100%', display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 18px', background: 'transparent', border: 'none', color: '#fff', cursor: 'pointer', fontFamily: 'inherit' },
  dot: { width: '9px', height: '9px', borderRadius: '50%', background: '#00c2ff', flexShrink: 0 },
  kid: { padding: '1px 8px', borderRadius: '20px', fontSize: '10px', fontWeight: 800, textTransform: 'uppercase', color: '#ffb703', border: '1px solid #ffb70355' },
  textarea: { flex: 1, minWidth: 0, padding: '12px 14px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '10px', color: '#fff', fontSize: '14px', lineHeight: 1.5, outline: 'none', resize: 'vertical', fontFamily: 'inherit' },
  primary: { padding: '10px 16px', background: '#00c2ff', color: '#000', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' },
  secondary: { padding: '7px 14px', background: 'rgba(255,255,255,0.08)', color: '#ddd', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
  danger: { padding: '7px 14px', background: 'transparent', border: '1px solid rgba(255,68,68,0.3)', color: '#ff6b6b', borderRadius: '6px', fontSize: '12px', cursor: 'pointer', fontFamily: 'inherit' },
};
