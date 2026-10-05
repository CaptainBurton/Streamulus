import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import axios from 'axios';
import Navbar from '../components/Navbar';
import { useAuth } from '../context/AuthContext';
import { formatCode } from '../components/QuickLoginRequest';

// Quick Login (approve): sign in a TV or another device by entering the code it
// shows. Opening the TV's QR code lands here with ?code= already filled in.
export default function QuickLogin() {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [code, setCode] = useState(() => cleanCode(params.get('code') || ''));
  const [pending, setPending] = useState(null); // { deviceName } once the code is found
  const [done, setDone] = useState(null);       // deviceName after approving
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);
  const lookedUpFromLink = useRef(false);

  const lookUp = async (c = code) => {
    setError(''); setBusy(true);
    try {
      const r = await axios.get(`/api/auth/quick/${encodeURIComponent(c)}`);
      setPending({ deviceName: r.data.deviceName });
    } catch (err) {
      setError(err.response?.data?.error || "Couldn't check that code");
    }
    setBusy(false);
  };

  // Came from the TV's QR code: look the code up straight away.
  useEffect(() => {
    if (!lookedUpFromLink.current && code.length === 6 && !profile?.is_kids) { lookedUpFromLink.current = true; lookUp(code); }
    else inputRef.current?.focus();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const approve = async () => {
    setError(''); setBusy(true);
    try {
      const r = await axios.post(`/api/auth/quick/${encodeURIComponent(code)}/approve`);
      setDone(r.data.deviceName);
      setPending(null);
    } catch (err) {
      setError(err.response?.data?.error || "Couldn't approve the sign-in");
    }
    setBusy(false);
  };

  const reset = () => { setPending(null); setDone(null); setError(''); setCode(''); setTimeout(() => inputRef.current?.focus(), 0); };

  return (
    <div style={{ minHeight: '100vh', background: '#0f0f0f', color: '#fff' }}>
      <Navbar />
      <div style={{ maxWidth: '520px', margin: '0 auto', padding: '110px 16px 64px' }}>
        <h1 style={{ fontSize: '30px', fontWeight: 800, marginBottom: '8px' }}>Quick Login</h1>
        <p style={{ color: '#777', fontSize: '15px', lineHeight: 1.6, marginBottom: '28px' }}>
          Signing in on your Apple TV or another device? Choose <strong style={{ color: '#ccc' }}>Quick Login</strong> there, then enter the code it shows.
        </p>

        <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '14px', padding: '28px' }}>
          {profile?.is_kids ? (
            <div style={{ color: '#ffb703', fontSize: '15px', lineHeight: 1.6 }}>
              Streamlings can't approve sign-ins — ask a grown-up to do it from their profile.
            </div>
          ) : done ? (
            <div style={{ textAlign: 'center' }}>
              <div style={{ width: '64px', height: '64px', borderRadius: '50%', background: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.4)', color: '#22c55e', fontSize: '30px', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>✓</div>
              <div style={{ fontSize: '18px', fontWeight: 700, marginBottom: '6px' }}>{done} is signed in</div>
              <div style={{ color: '#777', fontSize: '14px', marginBottom: '22px' }}>It will continue on its own in a few seconds.</div>
              <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap' }}>
                <button onClick={reset} style={BTN}>Sign in another device</button>
                <button onClick={() => navigate('/')} style={BTN_PRIMARY}>Done</button>
              </div>
            </div>
          ) : pending ? (
            <div style={{ textAlign: 'center' }}>
              <div style={{ color: '#777', fontSize: '13px', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '8px' }}>Code {formatCode(code)}</div>
              <div style={{ fontSize: '19px', fontWeight: 700, lineHeight: 1.5, marginBottom: '6px' }}>
                Sign in <span style={{ color: '#00c2ff' }}>{pending.deviceName}</span> as {user?.username}?
              </div>
              <div style={{ color: '#777', fontSize: '14px', marginBottom: '24px' }}>Only approve a device you're using right now.</div>
              {error && <div style={ERR}>{error}</div>}
              <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap' }}>
                <button onClick={reset} style={BTN} disabled={busy}>Cancel</button>
                <button onClick={approve} style={BTN_PRIMARY} disabled={busy}>{busy ? 'Approving…' : 'Approve Sign-in'}</button>
              </div>
            </div>
          ) : (
            <form onSubmit={e => { e.preventDefault(); if (code.length === 6) lookUp(); }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#777', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px' }}>Code from your TV</label>
              <input
                ref={inputRef}
                value={formatCode(code)}
                onChange={e => { setCode(cleanCode(e.target.value)); setError(''); }}
                placeholder="ABC-123"
                autoCapitalize="characters"
                autoComplete="one-time-code"
                spellCheck={false}
                aria-label="Quick Login code"
                style={{ width: '100%', padding: '16px', fontSize: '30px', fontWeight: 800, letterSpacing: '6px', textAlign: 'center', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '10px', color: '#fff', outline: 'none', marginBottom: '16px', textTransform: 'uppercase' }}
              />
              {error && <div style={ERR}>{error}</div>}
              <button type="submit" disabled={busy || code.length !== 6} style={{ ...BTN_PRIMARY, width: '100%', opacity: busy || code.length !== 6 ? 0.5 : 1 }}>
                {busy ? 'Checking…' : 'Continue'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

// Keep letters/digits only, upper-case, max 6 (dashes and spaces are just for reading).
function cleanCode(v) {
  return String(v).toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 6);
}

const BTN = { padding: '11px 20px', background: 'rgba(255,255,255,0.1)', color: '#fff', border: '1px solid rgba(255,255,255,0.18)', borderRadius: '8px', fontSize: '15px', fontWeight: 600, cursor: 'pointer' };
const BTN_PRIMARY = { padding: '12px 22px', background: '#00c2ff', color: '#000', border: 'none', borderRadius: '8px', fontSize: '15px', fontWeight: 800, cursor: 'pointer' };
const ERR = { marginBottom: '16px', padding: '10px 14px', background: 'rgba(255,68,68,0.1)', border: '1px solid rgba(255,68,68,0.25)', borderRadius: '8px', color: '#ff6b6b', fontSize: '14px', textAlign: 'left' };
