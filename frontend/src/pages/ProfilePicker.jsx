import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import ProfileAvatar from '../components/ProfileAvatar';

// "Who's watching?" — shown after login when an account has several profiles,
// and from the menu via "Switch Profile". Each profile says what switching to
// it needs (requires: 'pin' | 'password' | null): a PIN-locked profile, or the
// parental lock when leaving a Streamling.
export default function ProfilePicker() {
  const { profile: current, selectProfile, logout, needsProfilePick, cancelProfilePick } = useAuth();
  const navigate = useNavigate();
  const [profiles, setProfiles] = useState(null);
  const [prompt, setPrompt] = useState(null); // { profile, kind: 'pin' | 'password' }
  const [secret, setSecret] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    axios.get('/api/profiles').then(r => setProfiles(r.data.profiles)).catch(() => setProfiles([]));
  }, []);

  useEffect(() => { if (prompt) inputRef.current?.focus(); }, [prompt]);

  const choose = async (p, credentials) => {
    setError('');
    if (p.requires && !credentials) {
      setPrompt({ profile: p, kind: p.requires }); setSecret('');
      return;
    }
    setBusy(true);
    try {
      const wasGate = needsProfilePick;
      await selectProfile(p.id, credentials || {});
      setPrompt(null);
      if (!wasGate) navigate('/');
    } catch (err) {
      const code = err.response?.data?.code;
      // The server knows best — switch prompt if it asks for something else.
      if (code === 'PIN_REQUIRED' || code === 'PASSWORD_REQUIRED') {
        setPrompt({ profile: p, kind: code === 'PIN_REQUIRED' ? 'pin' : 'password' });
      }
      setError(err.response?.data?.error || "Couldn't switch profile");
      setSecret('');
    }
    setBusy(false);
  };

  const onPinChange = (v) => {
    const digits = v.replace(/\D/g, '').slice(0, 4);
    setSecret(digits);
    if (digits.length === 4) choose(prompt.profile, { pin: digits });
  };

  return (
    <div style={S.page}>
      <div style={S.logo}>STREAMULUS</div>

      {!prompt ? (
        <>
          <h1 style={S.title}>Who's watching?</h1>
          {error && <div style={S.error}>{error}</div>}
          <div style={S.grid}>
            {(profiles || []).map(p => (
              <button key={p.id} className="profile-tile" style={S.tile} onClick={() => choose(p)} disabled={busy}>
                <div style={{ position: 'relative' }}>
                  <ProfileAvatar profile={p} size={128}
                    style={{ border: p.id === current?.id ? '3px solid #fff' : '3px solid transparent', transition: 'border-color 0.2s' }} />
                  {/* Inside the circle, so Streamling tiles line up with the others */}
                  {p.is_kids && <div style={S.streamling}>Streamling</div>}
                  {p.requires && <div style={S.lock} title={p.requires === 'pin' ? 'PIN locked' : 'Needs the account password'}>🔒</div>}
                </div>
                <div style={S.name}>{p.name}</div>
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: '12px', marginTop: '48px', flexWrap: 'wrap', justifyContent: 'center' }}>
            {current?.is_main && !needsProfilePick && (
              <button style={S.outline} onClick={() => navigate('/profile')}>Manage Profiles</button>
            )}
            {!needsProfilePick && <button style={S.outline} onClick={() => navigate(-1)}>Cancel</button>}
            {needsProfilePick && <button style={S.outline} onClick={() => { cancelProfilePick(); logout(); }}>Sign Out</button>}
          </div>
        </>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '18px', width: '100%', maxWidth: '360px' }}>
          <ProfileAvatar profile={prompt.profile} size={96} />
          <h1 style={{ ...S.title, fontSize: '26px', marginBottom: 0 }}>
            {prompt.kind === 'pin' ? `Enter PIN for ${prompt.profile.name}` : `Enter your password to switch to ${prompt.profile.name}`}
          </h1>
          {prompt.kind === 'pin' ? (
            <input
              ref={inputRef}
              value={secret}
              onChange={e => onPinChange(e.target.value)}
              inputMode="numeric"
              autoComplete="off"
              type="password"
              maxLength={4}
              disabled={busy}
              aria-label="4-digit PIN"
              style={S.pin}
            />
          ) : (
            <form style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '12px' }}
              onSubmit={e => { e.preventDefault(); if (secret) choose(prompt.profile, { password: secret }); }}>
              <input
                ref={inputRef}
                type="password"
                value={secret}
                onChange={e => setSecret(e.target.value)}
                autoComplete="current-password"
                placeholder="Account password"
                aria-label="Account password"
                disabled={busy}
                style={S.password}
              />
              <button type="submit" disabled={busy || !secret} style={{ ...S.primary, opacity: busy || !secret ? 0.5 : 1 }}>
                {busy ? 'Checking…' : 'Continue'}
              </button>
            </form>
          )}
          {error && <div style={S.error}>{error}</div>}
          <button style={S.outline} onClick={() => { setPrompt(null); setError(''); }}>Back</button>
        </div>
      )}

      <style>{`
        .profile-tile:hover > div:first-child > div:first-child { border-color: rgba(255,255,255,0.85) !important; }
        .profile-tile:hover { transform: translateY(-4px); }
        .profile-tile:hover > div:nth-child(2) { color: #fff !important; }
      `}</style>
    </div>
  );
}

const S = {
  page: { minHeight: '100vh', background: '#0f0f0f', color: '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '80px 16px 48px' },
  logo: { position: 'fixed', top: 18, left: 24, fontSize: '26px', fontWeight: 800, letterSpacing: '-0.5px', background: 'linear-gradient(135deg, #00c2ff, #7b2fff)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' },
  title: { fontSize: 'clamp(26px, 5vw, 44px)', fontWeight: 700, marginBottom: '36px', textAlign: 'center' },
  grid: { display: 'flex', flexWrap: 'wrap', gap: '28px', justifyContent: 'center', alignItems: 'flex-start', maxWidth: '900px' },
  tile: { background: 'none', border: 'none', color: '#fff', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', width: '140px', transition: 'transform 0.2s', fontFamily: 'inherit' },
  name: { fontSize: '16px', color: '#aaa', fontWeight: 500, textAlign: 'center', wordBreak: 'break-word', transition: 'color 0.2s' },
  streamling: { position: 'absolute', left: '50%', bottom: '12px', transform: 'translateX(-50%)', padding: '3px 9px', borderRadius: '20px', fontSize: '10px', fontWeight: 800, letterSpacing: '0.8px', textTransform: 'uppercase', color: '#1a1200', background: '#ffb703', whiteSpace: 'nowrap', boxShadow: '0 2px 8px rgba(0,0,0,0.4)' },
  lock: { position: 'absolute', right: 0, top: 0, width: 30, height: 30, borderRadius: '50%', background: '#1e1e1e', border: '1px solid rgba(255,255,255,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px' },
  outline: { padding: '10px 26px', background: 'transparent', color: '#aaa', border: '1px solid #555', borderRadius: '6px', fontSize: '14px', fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase', cursor: 'pointer', fontFamily: 'inherit' },
  pin: { width: '180px', textAlign: 'center', fontSize: '32px', letterSpacing: '18px', padding: '12px 0 12px 18px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '10px', color: '#fff', outline: 'none' },
  password: { width: '100%', padding: '14px 16px', fontSize: '16px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '10px', color: '#fff', outline: 'none' },
  primary: { padding: '13px', background: '#00c2ff', color: '#000', border: 'none', borderRadius: '10px', fontSize: '15px', fontWeight: 800, cursor: 'pointer' },
  error: { color: '#ff6b6b', fontSize: '14px', marginBottom: '16px', textAlign: 'center' },
};
