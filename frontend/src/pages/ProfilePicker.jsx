import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import ProfileAvatar from '../components/ProfileAvatar';

// "Who's watching?" — shown after login when an account has several profiles,
// and from the menu via "Switch Profile".
export default function ProfilePicker() {
  const { profile: current, selectProfile, logout, needsProfilePick, cancelProfilePick } = useAuth();
  const navigate = useNavigate();
  const [profiles, setProfiles] = useState(null);
  const [pinFor, setPinFor] = useState(null); // profile waiting for its PIN
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pinRef = useRef(null);

  useEffect(() => {
    axios.get('/api/profiles').then(r => setProfiles(r.data.profiles)).catch(() => setProfiles([]));
  }, []);

  useEffect(() => { if (pinFor) pinRef.current?.focus(); }, [pinFor]);

  const choose = async (p, pinValue) => {
    setError('');
    if (p.has_pin && p.id !== current?.id && pinValue === undefined) {
      setPinFor(p); setPin('');
      return;
    }
    setBusy(true);
    try {
      await selectProfile(p.id, pinValue);
      setPinFor(null);
      navigate('/');
    } catch (err) {
      setError(err.response?.data?.error || "Couldn't switch profile");
      setPin('');
    }
    setBusy(false);
  };

  const onPinChange = (v) => {
    const digits = v.replace(/\D/g, '').slice(0, 4);
    setPin(digits);
    if (digits.length === 4) choose(pinFor, digits);
  };

  return (
    <div style={S.page}>
      <div style={S.logo}>STREAMULUS</div>

      {!pinFor ? (
        <>
          <h1 style={S.title}>Who's watching?</h1>
          {error && <div style={S.error}>{error}</div>}
          <div style={S.grid}>
            {(profiles || []).map(p => (
              <button key={p.id} className="profile-tile" style={S.tile} onClick={() => choose(p)} disabled={busy}>
                <div style={{ position: 'relative' }}>
                  <ProfileAvatar profile={p} size={128} radius="16px"
                    style={{ border: p.id === current?.id ? '3px solid #fff' : '3px solid transparent', transition: 'border-color 0.2s' }} />
                  {p.has_pin && <div style={S.lock} title="PIN locked">🔒</div>}
                </div>
                <div style={S.name}>{p.name}</div>
                {p.is_kids && <div style={S.streamling}>Streamling</div>}
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
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '18px' }}>
          <ProfileAvatar profile={pinFor} size={96} radius="14px" />
          <h1 style={{ ...S.title, fontSize: '26px', marginBottom: 0 }}>Enter PIN for {pinFor.name}</h1>
          <input
            ref={pinRef}
            value={pin}
            onChange={e => onPinChange(e.target.value)}
            inputMode="numeric"
            autoComplete="off"
            type="password"
            maxLength={4}
            disabled={busy}
            aria-label="4-digit PIN"
            style={S.pin}
          />
          {error && <div style={S.error}>{error}</div>}
          <button style={S.outline} onClick={() => { setPinFor(null); setError(''); }}>Back</button>
        </div>
      )}

      <style>{`
        .profile-tile:hover > div:first-child > div { border-color: rgba(255,255,255,0.85) !important; }
        .profile-tile:hover { transform: translateY(-4px); }
        .profile-tile:hover > div:nth-child(2) { color: #fff !important; }
      `}</style>
    </div>
  );
}

const S = {
  page: { minHeight: '100vh', background: '#0f0f0f', color: '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '80px 16px 48px' },
  logo: { position: 'fixed', top: 18, left: 24, fontSize: '26px', fontWeight: 800, letterSpacing: '-0.5px', background: 'linear-gradient(135deg, #00c2ff, #7b2fff)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' },
  title: { fontSize: 'clamp(28px, 5vw, 44px)', fontWeight: 700, marginBottom: '36px', textAlign: 'center' },
  grid: { display: 'flex', flexWrap: 'wrap', gap: '28px', justifyContent: 'center', maxWidth: '900px' },
  tile: { background: 'none', border: 'none', color: '#fff', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', width: '140px', transition: 'transform 0.2s', fontFamily: 'inherit' },
  name: { fontSize: '16px', color: '#aaa', fontWeight: 500, textAlign: 'center', wordBreak: 'break-word', transition: 'color 0.2s' },
  streamling: { marginTop: '-6px', fontSize: '11px', fontWeight: 800, letterSpacing: '0.8px', textTransform: 'uppercase', color: '#ffb703' },
  lock: { position: 'absolute', right: -6, bottom: -6, width: 30, height: 30, borderRadius: '50%', background: '#1e1e1e', border: '1px solid rgba(255,255,255,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px' },
  outline: { padding: '10px 26px', background: 'transparent', color: '#aaa', border: '1px solid #555', borderRadius: '6px', fontSize: '14px', fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase', cursor: 'pointer', fontFamily: 'inherit' },
  pin: { width: '180px', textAlign: 'center', fontSize: '32px', letterSpacing: '18px', padding: '12px 0 12px 18px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '10px', color: '#fff', outline: 'none' },
  error: { color: '#ff6b6b', fontSize: '14px', marginBottom: '16px', textAlign: 'center' },
};
