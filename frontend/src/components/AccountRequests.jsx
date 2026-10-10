import React, { useEffect, useState } from 'react';
import axios from 'axios';

// Accounts people created themselves (web or app) wait here until the admin
// makes them an Admin Passphrase: random, single use, valid for an hour. The
// admin passes it on and the person enters it at their first sign-in.
const parseSqlDate = (s) => (s ? new Date(String(s).replace(' ', 'T') + (String(s).endsWith('Z') ? '' : 'Z')) : null);

function ago(date) {
  if (!date) return '';
  const mins = Math.max(0, Math.round((Date.now() - date.getTime()) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

const clock = (ms) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

export default function AccountRequests({ users, onChange, flash }) {
  const [shown, setShown] = useState({}); // userId -> { passphrase, expiresAt } (only this session)
  const [busy, setBusy] = useState(null);
  const [copied, setCopied] = useState(null);
  const [, setNow] = useState(Date.now());

  // Keep "expires in …" and "… ago" current.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  if (!users.length) return null;

  const generate = async (u) => {
    setBusy(u.id);
    try {
      const r = await axios.post(`/api/admin/users/${u.id}/passphrase`);
      setShown(s => ({ ...s, [u.id]: { passphrase: r.data.passphrase, expiresAt: r.data.expiresAt } }));
      onChange();
    } catch (err) {
      flash(err.response?.data?.error || "Couldn't make a passphrase", true);
    }
    setBusy(null);
  };

  const decline = async (u) => {
    if (!confirm(`Decline ${u.username}'s account request? The account will be removed.`)) return;
    setBusy(u.id);
    try {
      await axios.delete(`/api/admin/users/${u.id}`);
      setShown(s => { const n = { ...s }; delete n[u.id]; return n; });
      flash(`Declined ${u.username}`);
      onChange();
    } catch (err) {
      flash(err.response?.data?.error || 'Failed', true);
    }
    setBusy(null);
  };

  const copy = async (id, text) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      setTimeout(() => setCopied(c => (c === id ? null : c)), 2000);
    } catch {}
  };

  return (
    <div style={S.card}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
        <h3 style={{ fontSize: '16px', fontWeight: 700, margin: 0 }}>Account Requests</h3>
        <span style={S.count}>{users.length}</span>
      </div>
      <p style={{ color: '#777', fontSize: '13px', margin: '0 0 16px', lineHeight: 1.5 }}>
        People who created an account on the web or in the app. Make them an Admin Passphrase and pass it on —
        they enter it once, at their first sign-in. Each passphrase works once and only for 1 hour; making a new one
        replaces the old.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {users.map(u => {
          const fresh = shown[u.id] && shown[u.id].expiresAt > Date.now() ? shown[u.id] : null;
          const out = u.passphraseExpiresAt && u.passphraseExpiresAt > Date.now();
          const mins = out ? Math.max(1, Math.round((u.passphraseExpiresAt - Date.now()) / 60000)) : 0;
          const status = out ? `Passphrase given · expires in ${mins} min`
            : u.passphraseExpiresAt ? 'Passphrase expired — make a new one'
            : 'Waiting for a passphrase';
          return (
            <div key={u.id} style={S.row}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '14px', minWidth: 0 }}>
                  <div style={S.avatar}>{u.username[0]?.toUpperCase()}</div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: '15px', wordBreak: 'break-word' }}>{u.username}</div>
                    <div style={{ fontSize: '12px', color: out ? '#00c864' : '#777' }}>
                      Asked {ago(parseSqlDate(u.created_at))} · {status}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button onClick={() => generate(u)} disabled={busy === u.id} style={S.primary}>
                    {u.passphraseExpiresAt ? 'New Passphrase' : 'Generate Passphrase'}
                  </button>
                  <button onClick={() => decline(u)} disabled={busy === u.id} style={S.decline}>Decline</button>
                </div>
              </div>
              {fresh && (
                <div style={S.passBox}>
                  <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', color: '#00c2ff', marginBottom: '8px' }}>
                    Admin Passphrase for {u.username}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                    <code style={S.pass} data-testid="passphrase">{fresh.passphrase}</code>
                    <button onClick={() => copy(u.id, fresh.passphrase)} style={S.copy}>{copied === u.id ? 'Copied ✓' : 'Copy'}</button>
                  </div>
                  <div style={{ fontSize: '12px', color: '#888', marginTop: '10px', lineHeight: 1.5 }}>
                    Works once, until {clock(fresh.expiresAt)}. It's only shown here — if it's lost or runs out, make a new one.
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const S = {
  card: { background: 'rgba(0,194,255,0.05)', border: '1px solid rgba(0,194,255,0.2)', borderRadius: '12px', padding: '24px', marginBottom: '24px' },
  count: { minWidth: '22px', height: '22px', padding: '0 7px', borderRadius: '11px', background: '#00c2ff', color: '#000', fontSize: '12px', fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' },
  row: { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '10px', padding: '14px 18px' },
  avatar: { width: '36px', height: '36px', flexShrink: 0, borderRadius: '50%', background: 'rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px', fontWeight: 700 },
  primary: { padding: '8px 14px', background: '#00c2ff', color: '#000', border: 'none', borderRadius: '6px', fontSize: '13px', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' },
  decline: { padding: '8px 14px', background: 'transparent', border: '1px solid rgba(255,68,68,0.3)', color: '#ff4444', borderRadius: '6px', fontSize: '13px', cursor: 'pointer' },
  passBox: { marginTop: '14px', padding: '14px 16px', background: 'rgba(0,0,0,0.35)', border: '1px dashed rgba(0,194,255,0.4)', borderRadius: '8px' },
  pass: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '20px', fontWeight: 700, color: '#fff', letterSpacing: '0.5px', wordBreak: 'break-all' },
  copy: { padding: '6px 12px', background: 'rgba(255,255,255,0.08)', color: '#ddd', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' },
};
