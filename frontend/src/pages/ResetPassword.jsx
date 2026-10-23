import React, { useEffect, useState } from 'react';
import axios from 'axios';
import BrandMark from '../components/BrandMark';

// Opened from the "Reset Password" button in a password reset email
// (/reset-password?token=…): choose a new password, typed twice.
export default function ResetPassword() {
  const token = new URLSearchParams(window.location.search).get('token') || '';
  const [state, setState] = useState('checking'); // checking | ready | expired | done
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) { setState('expired'); return; }
    axios.get(`/api/auth/password-reset/${encodeURIComponent(token)}`)
      .then(r => { setUsername(r.data.username); setState('ready'); })
      .catch(() => setState('expired'));
  }, [token]);

  const tooShort = password.length > 0 && password.length < 6;
  const mismatch = confirm.length > 0 && confirm !== password;
  const ready = password.length >= 6 && confirm === password;

  const submit = async (e) => {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError('');
    try {
      await axios.post('/api/auth/password-reset', { token, password, confirm });
      setState('done');
    } catch (err) {
      if (err.response?.status === 410) setState('expired');
      else setError(err.response?.data?.error || "Couldn't change your password — try again");
    }
    setBusy(false);
  };

  const input = {
    width: '100%', padding: '14px 16px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '8px', color: '#fff', fontSize: '15px', outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit',
  };
  const label = { display: 'block', fontSize: '12px', fontWeight: '600', color: '#777', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' };
  const hint = (text, bad) => <div style={{ fontSize: '12px', marginTop: '6px', color: bad ? '#ff8080' : '#666' }}>{text}</div>;
  const primary = (disabled) => ({
    width: '100%', padding: '14px', border: 'none', borderRadius: '8px', fontSize: '16px', fontWeight: 700, cursor: disabled ? 'not-allowed' : 'pointer',
    background: disabled ? '#333' : 'linear-gradient(135deg, #00c2ff, #7b2fff)', color: disabled ? '#666' : '#fff',
  });
  const goTo = (path) => { window.location.href = path; };

  return (
    <div style={{ minHeight: '100vh', background: 'radial-gradient(ellipse at top, #1a1a2e 0%, #0f0f0f 60%)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
      <div style={{ width: '100%', maxWidth: '420px' }}>
        <div style={{ textAlign: 'center', marginBottom: '36px' }}>
          <div style={{ marginBottom: '8px', display: 'flex', justifyContent: 'center' }}><BrandMark size={40} /></div>
          <div style={{ color: '#555', fontSize: '14px' }}>Reset your password</div>
        </div>
        <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '16px', padding: '36px' }}>
          {state === 'checking' && <div className="spinner" style={{ margin: '20px auto' }} />}

          {state === 'expired' && (
            <div style={{ textAlign: 'center' }} data-reset="expired">
              <div style={{ fontSize: '18px', fontWeight: 700, color: '#fff', marginBottom: '10px' }}>This link has expired</div>
              <p style={{ color: '#aaa', fontSize: '14px', lineHeight: 1.6, margin: '0 0 22px' }}>
                Reset links work once, for an hour. Ask for a new one and use the newest email.
              </p>
              <button style={primary(false)} onClick={() => goTo('/forgot-password')}>Send a New Link</button>
              <div style={{ marginTop: '14px' }}>
                <button style={{ background: 'none', border: 'none', color: '#00c2ff', fontSize: '14px', fontWeight: 600, cursor: 'pointer' }} onClick={() => goTo('/')}>Back to sign in</button>
              </div>
            </div>
          )}

          {state === 'ready' && (
            <form onSubmit={submit}>
              <p style={{ color: '#aaa', fontSize: '14px', lineHeight: 1.6, margin: '0 0 22px' }}>
                Choose a new password for <strong style={{ color: '#fff' }}>{username}</strong>.
              </p>
              <div style={{ marginBottom: '18px' }}>
                <label style={label} htmlFor="new-password">New password</label>
                <input id="new-password" style={input} type={show ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} autoComplete="new-password" autoFocus placeholder="At least 6 characters" />
                {tooShort && hint('At least 6 characters', true)}
              </div>
              <div style={{ marginBottom: '14px' }}>
                <label style={label} htmlFor="confirm-password">Confirm password</label>
                <input id="confirm-password" style={input} type={show ? 'text' : 'password'} value={confirm} onChange={e => setConfirm(e.target.value)} autoComplete="new-password" placeholder="Type it again" />
                {mismatch && hint("The passwords don't match", true)}
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: '#888', marginBottom: '20px', cursor: 'pointer' }}>
                <input type="checkbox" checked={show} onChange={e => setShow(e.target.checked)} style={{ accentColor: '#00c2ff' }} /> Show passwords
              </label>
              {error && <div style={{ marginBottom: '18px', padding: '12px 16px', background: 'rgba(255,68,68,0.1)', border: '1px solid rgba(255,68,68,0.2)', borderRadius: '8px', color: '#ff4444', fontSize: '14px' }}>{error}</div>}
              <button type="submit" style={primary(busy || !ready)} disabled={busy || !ready}>{busy ? 'Saving…' : 'Reset Password'}</button>
              <p style={{ color: '#666', fontSize: '12px', lineHeight: 1.5, margin: '14px 0 0', textAlign: 'center' }}>
                You'll be signed out on your other devices — sign in again with the new password.
              </p>
            </form>
          )}

          {state === 'done' && (
            <div style={{ textAlign: 'center' }} data-reset="done">
              <div style={{ width: '56px', height: '56px', margin: '0 auto 16px', borderRadius: '50%', background: 'rgba(0,200,100,0.15)', border: '1px solid rgba(0,200,100,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '26px', color: '#00c864' }}>✓</div>
              <div style={{ fontSize: '18px', fontWeight: 700, color: '#fff', marginBottom: '10px' }}>Password changed</div>
              <p style={{ color: '#aaa', fontSize: '14px', lineHeight: 1.6, margin: '0 0 22px' }}>
                Sign in as <strong style={{ color: '#fff' }}>{username}</strong> with your new password.
              </p>
              <button style={primary(false)} onClick={() => goTo('/')}>Sign In</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
