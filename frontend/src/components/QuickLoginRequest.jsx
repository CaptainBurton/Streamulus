import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';

// "Sign in with a code" on the sign-in page: shows a Quick Login code and waits
// until someone approves it from a device where they're already signed in.
export const formatCode = (c) => (c && c.length === 6 ? `${c.slice(0, 3)}-${c.slice(3)}` : c || '');

export default function QuickLoginRequest({ onCancel }) {
  const { completeLogin } = useAuth();
  const [req, setReq] = useState(null); // { requestId, code, expiresIn, interval }
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [status, setStatus] = useState('loading'); // loading | waiting | expired | error
  const [error, setError] = useState('');
  const pollTimer = useRef(null);
  const tick = useRef(null);

  const start = async () => {
    clearTimeout(pollTimer.current);
    setStatus('loading'); setError('');
    try {
      const r = await axios.post('/api/auth/quick/start', { deviceName: browserName() });
      setReq(r.data);
      setSecondsLeft(r.data.expiresIn);
      setStatus('waiting');
    } catch (err) {
      setError(err.response?.data?.error || "Couldn't get a code");
      setStatus('error');
    }
  };

  useEffect(() => { start(); return () => { clearTimeout(pollTimer.current); clearInterval(tick.current); }; }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Countdown
  useEffect(() => {
    clearInterval(tick.current);
    if (status !== 'waiting') return;
    tick.current = setInterval(() => setSecondsLeft(s => Math.max(0, s - 1)), 1000);
    return () => clearInterval(tick.current);
  }, [status, req]);

  // Poll until approved or expired
  useEffect(() => {
    if (status !== 'waiting' || !req) return;
    let stopped = false;
    const poll = async () => {
      try {
        const r = await axios.post('/api/auth/quick/poll', { requestId: req.requestId });
        if (stopped) return;
        if (r.data.status === 'approved') { completeLogin(r.data); return; }
        pollTimer.current = setTimeout(poll, (req.interval || 3) * 1000);
      } catch (err) {
        if (stopped) return;
        if (err.response?.status === 410) { setStatus('expired'); return; }
        pollTimer.current = setTimeout(poll, 5000); // network blip — keep trying
      }
    };
    pollTimer.current = setTimeout(poll, (req.interval || 3) * 1000);
    return () => { stopped = true; clearTimeout(pollTimer.current); };
  }, [status, req]); // eslint-disable-line react-hooks/exhaustive-deps

  const approveUrl = `${window.location.origin}/quick-login`;

  return (
    <div style={{ textAlign: 'center' }}>
      {status === 'loading' && <div style={{ color: '#777', padding: '24px 0' }}>Getting a code…</div>}

      {status === 'waiting' && req && (
        <>
          <div style={{ color: '#aaa', fontSize: '14px', lineHeight: 1.6, marginBottom: '18px' }}>
            On a phone or computer where you're signed in, open the profile menu → <strong style={{ color: '#fff' }}>Quick Login</strong> and enter:
          </div>
          <div aria-label="Quick Login code" style={{ fontSize: '44px', fontWeight: 800, letterSpacing: '6px', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', color: '#fff', padding: '14px 0', borderRadius: '12px', background: 'rgba(0,194,255,0.08)', border: '1px solid rgba(0,194,255,0.25)', marginBottom: '14px' }}>
            {formatCode(req.code)}
          </div>
          <div style={{ color: '#555', fontSize: '13px', marginBottom: '6px', wordBreak: 'break-all' }}>or go to {approveUrl}</div>
          <div style={{ color: '#555', fontSize: '13px', marginBottom: '22px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
            <span className="spinner" style={{ width: '14px', height: '14px', borderWidth: '2px' }} />
            Waiting for approval · code expires in {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, '0')}
          </div>
        </>
      )}

      {status === 'expired' && (
        <div style={{ marginBottom: '22px' }}>
          <div style={{ color: '#ffb703', marginBottom: '14px' }}>That code expired.</div>
          <button type="button" onClick={start} style={BTN_PRIMARY}>Get a new code</button>
        </div>
      )}

      {status === 'error' && (
        <div style={{ marginBottom: '22px' }}>
          <div style={{ color: '#ff6b6b', marginBottom: '14px' }}>{error}</div>
          <button type="button" onClick={start} style={BTN_PRIMARY}>Try again</button>
        </div>
      )}

      <button type="button" onClick={onCancel} style={{ background: 'none', border: 'none', color: '#00c2ff', fontSize: '14px', fontWeight: 600, cursor: 'pointer' }}>
        ← Sign in with a password instead
      </button>
    </div>
  );
}

function browserName() {
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : '';
  return `${browser}${os ? ` on ${os}` : ''}`;
}

const BTN_PRIMARY = { padding: '10px 22px', background: 'linear-gradient(135deg, #00c2ff, #7b2fff)', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: 700, cursor: 'pointer' };
