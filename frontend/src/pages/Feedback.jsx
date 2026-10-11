import React, { useEffect, useState } from 'react';
import axios from 'axios';
import Navbar, { noteFeedbackRead } from '../components/Navbar';
import FeedbackThread, { KIND_LABELS, StatusPill, when } from '../components/FeedbackThread';

// Profile & Account › Feedback: send feedback or an app suggestion to the admin,
// and read (and answer) their replies. Each profile has its own.
export default function Feedback() {
  const [items, setItems] = useState(null);
  const [kind, setKind] = useState('feedback');
  const [message, setMessage] = useState('');
  const [openId, setOpenId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState(null);

  const say = (text, error = false) => { setFlash({ text, error }); setTimeout(() => setFlash(null), 4000); };

  const load = () => axios.get('/api/feedback')
    .then(r => { setItems(r.data.items); noteFeedbackRead(r.data.unreadCount); return r.data.items; })
    .catch(() => { setItems([]); say("Couldn't load your feedback", true); return []; });

  useEffect(() => { load(); }, []);

  const send = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await axios.post('/api/feedback', { kind, message, platform: 'web' });
      setMessage('');
      setOpenId(r.data.item.id);
      say(kind === 'suggestion' ? 'Suggestion sent — thank you!' : 'Feedback sent — thank you!');
      await load();
    } catch (err) { say(err.response?.data?.error || "Couldn't send it", true); }
    setBusy(false);
  };

  const open = async (item) => {
    const next = openId === item.id ? null : item.id;
    setOpenId(next);
    if (next && item.unread) {
      await axios.post(`/api/feedback/${item.id}/read`).catch(() => {});
      load();
    }
  };

  return (
    <div style={{ minHeight: '100vh', background: '#0f0f0f', color: '#fff' }}>
      <Navbar />
      <div style={{ maxWidth: '760px', margin: '0 auto', padding: '96px 16px 64px' }}>
        <h1 style={{ fontSize: '32px', fontWeight: 800, marginBottom: '6px' }}>Feedback</h1>
        <p style={{ color: '#777', fontSize: '14px', marginBottom: '26px' }}>
          Tell your Streamulus admin what you think, report something that isn't working, or suggest something for the apps. Their replies show up here.
        </p>

        {flash && (
          <div style={{ marginBottom: '18px', padding: '12px 16px', borderRadius: '8px', fontSize: '14px',
            background: flash.error ? 'rgba(255,68,68,0.1)' : 'rgba(0,200,100,0.1)',
            border: `1px solid ${flash.error ? 'rgba(255,68,68,0.25)' : 'rgba(0,200,100,0.25)'}`,
            color: flash.error ? '#ff6b6b' : '#00c864' }}>
            {flash.error ? '⚠ ' : '✓ '}{flash.text}
          </div>
        )}

        <form onSubmit={send} style={S.card}>
          <div style={{ display: 'flex', gap: '6px', marginBottom: '14px', flexWrap: 'wrap' }}>
            {Object.entries(KIND_LABELS).map(([value, label]) => (
              <button type="button" key={value} onClick={() => setKind(value)}
                style={{ ...S.chip, ...(kind === value ? S.chipOn : {}) }}>{label}</button>
            ))}
          </div>
          <textarea value={message} onChange={e => setMessage(e.target.value)} maxLength={4000} rows={5}
            placeholder={kind === 'suggestion' ? 'What would make Streamulus better?' : "What's on your mind? If something isn't working, say what you were doing."}
            aria-label="Your message" style={S.textarea} />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', marginTop: '12px' }}>
            <span style={{ fontSize: '12px', color: '#555' }}>{message.length}/4000</span>
            <button type="submit" disabled={busy || !message.trim()} style={{ ...S.primary, opacity: busy || !message.trim() ? 0.5 : 1 }}>
              {busy ? 'Sending…' : kind === 'suggestion' ? 'Send Suggestion' : 'Send Feedback'}
            </button>
          </div>
        </form>

        <h2 style={{ fontSize: '17px', fontWeight: 700, margin: '30px 0 12px' }}>Your messages</h2>
        {items === null && <div style={{ color: '#666' }}>Loading…</div>}
        {items?.length === 0 && <div style={{ color: '#666', fontSize: '14px' }}>Nothing yet — anything you send appears here, with the admin's replies.</div>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {(items || []).map(item => (
            <div key={item.id} style={{ ...S.card, padding: 0, overflow: 'hidden' }} data-feedback={item.id}>
              <button onClick={() => open(item)} style={S.row} aria-expanded={openId === item.id}>
                <span style={{ ...S.dot, visibility: item.unread ? 'visible' : 'hidden' }} title="New reply" />
                <span style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                  <span style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '4px' }}>
                    <strong style={{ fontSize: '14px' }}>{KIND_LABELS[item.kind]}</strong>
                    <StatusPill status={item.status} />
                    {item.unread && <span style={{ fontSize: '11px', color: '#00c2ff', fontWeight: 700 }}>New reply</span>}
                  </span>
                  <span style={{ display: 'block', color: '#999', fontSize: '13px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.preview}</span>
                </span>
                <span style={{ color: '#555', fontSize: '12px', whiteSpace: 'nowrap' }}>{when(item.updatedAt)}</span>
              </button>
              {openId === item.id && <Conversation item={item} onChanged={load} say={say} />}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Conversation({ item, onChanged, say }) {
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await axios.post(`/api/feedback/${item.id}/messages`, { message: reply });
      setReply('');
      await onChanged();
    } catch (err) { say(err.response?.data?.error || "Couldn't send your reply", true); }
    setBusy(false);
  };
  return (
    <div style={{ padding: '4px 18px 18px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
      <div style={{ padding: '14px 0' }}><FeedbackThread item={item} mine="user" /></div>
      <form onSubmit={send} style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
        <textarea value={reply} onChange={e => setReply(e.target.value)} rows={2} maxLength={4000}
          placeholder={item.status === 'closed' ? 'Reply to open this again…' : 'Reply…'} aria-label="Reply" style={{ ...S.textarea, flex: 1 }} />
        <button type="submit" disabled={busy || !reply.trim()} style={{ ...S.primary, opacity: busy || !reply.trim() ? 0.5 : 1 }}>Send</button>
      </form>
    </div>
  );
}

const S = {
  card: { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', padding: '20px' },
  chip: { padding: '7px 16px', borderRadius: '20px', border: '1px solid rgba(255,255,255,0.15)', background: 'transparent', color: '#bbb', fontSize: '13px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
  chipOn: { background: '#fff', color: '#000', borderColor: '#fff' },
  textarea: { width: '100%', boxSizing: 'border-box', padding: '12px 14px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '10px', color: '#fff', fontSize: '14px', lineHeight: 1.5, outline: 'none', resize: 'vertical', fontFamily: 'inherit' },
  primary: { padding: '10px 18px', background: '#00c2ff', color: '#000', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' },
  row: { width: '100%', display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 18px', background: 'transparent', border: 'none', color: '#fff', cursor: 'pointer', fontFamily: 'inherit' },
  dot: { width: '9px', height: '9px', borderRadius: '50%', background: '#00c2ff', flexShrink: 0 },
};
