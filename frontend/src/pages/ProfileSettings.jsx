import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import Navbar from '../components/Navbar';
import ProfileAvatar from '../components/ProfileAvatar';
import { useAuth } from '../context/AuthContext';

const IMAGE_TYPES = 'image/png,image/jpeg,image/gif,image/webp';

// Profile & Account page.
//  - Everyone (except Streamlings): their own photo, name and PIN.
//  - Main profile: also the account's username/password and all profiles.
export default function ProfileSettings() {
  const { user, profile, refresh } = useAuth();
  const navigate = useNavigate();
  const [profiles, setProfiles] = useState([]);
  const [maxProfiles, setMaxProfiles] = useState(6);
  const [parentalLock, setParentalLock] = useState(null); // { enabled, method }
  const [flash, setFlash] = useState(null); // { text, error }

  const isMain = !!profile?.is_main;
  const isKids = !!profile?.is_kids;

  const flashTimer = useRef(null);
  const say = (text, error = false) => {
    setFlash({ text, error });
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), 4000);
  };
  const errText = (err, fallback) => err.response?.data?.error || fallback;

  const loadProfiles = () => axios.get('/api/profiles').then(r => {
    setProfiles(r.data.profiles);
    setMaxProfiles(r.data.maxProfiles || 6);
    setParentalLock(r.data.parentalLock || null);
  }).catch(() => {});
  useEffect(() => { loadProfiles(); }, []);

  // Keep the navbar and this page in sync after any profile change.
  const afterProfileChange = async () => { await Promise.all([loadProfiles(), refresh()]); };

  if (!profile) return null;

  return (
    <div style={{ minHeight: '100vh', background: '#0f0f0f', color: '#fff' }}>
      <Navbar />
      <div style={{ maxWidth: '820px', margin: '0 auto', padding: '96px 16px 64px' }}>
        <h1 style={{ fontSize: '32px', fontWeight: 800, marginBottom: '6px' }}>Profile &amp; Account</h1>
        <p style={{ color: '#666', marginBottom: '28px', fontSize: '14px' }}>
          Signed in as <strong style={{ color: '#aaa' }}>{user?.username}</strong> · watching as <strong style={{ color: '#aaa' }}>{profile.name}</strong>
        </p>

        {flash && (
          <div style={{ marginBottom: '20px', padding: '12px 16px', borderRadius: '8px', fontSize: '14px',
            background: flash.error ? 'rgba(255,68,68,0.1)' : 'rgba(0,200,100,0.1)',
            border: `1px solid ${flash.error ? 'rgba(255,68,68,0.25)' : 'rgba(0,200,100,0.25)'}`,
            color: flash.error ? '#ff6b6b' : '#00c864' }}>
            {flash.error ? '⚠ ' : '✓ '}{flash.text}
          </div>
        )}

        {isKids ? (
          <Card title="You're a Streamling!">
            <div style={{ display: 'flex', alignItems: 'center', gap: '18px', flexWrap: 'wrap' }}>
              <ProfileAvatar profile={profile} size={72} radius="14px" />
              <p style={{ color: '#aaa', fontSize: '14px', lineHeight: 1.6, flex: 1, minWidth: '220px' }}>
                Streamling profiles show movies and shows picked for kids. Ask a grown-up on the main profile to change your name or picture.
              </p>
            </div>
            <div style={{ marginTop: '18px' }}><Btn onClick={() => navigate('/profiles')}>Switch Profile</Btn></div>
          </Card>
        ) : (
          <ProfileEditor p={profile} self canManage={isMain} onChanged={afterProfileChange} say={say} errText={errText} />
        )}

        <LanguageSection profile={profile} onChanged={refresh} say={say} errText={errText} />

        {!isKids && (
          <Card title="Quick Login" subtitle="Sign in your Apple TV or another device without typing your password: choose Quick Login on that device, then enter the code it shows here.">
            <Btn primary onClick={() => navigate('/quick-login')}>Enter a Quick Login code</Btn>
          </Card>
        )}

        {isMain && !isKids && parentalLock && (
          <ParentalLockSection lock={parentalLock} onChanged={setParentalLock} say={say} errText={errText} />
        )}

        {isMain && !isKids && <AccountSection user={user} onChanged={refresh} say={say} errText={errText} />}

        {isMain && !isKids && (
          <Card title="Profiles" subtitle={`Each profile has its own Continue Watching and watched history. Up to ${maxProfiles} per account.`}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {profiles.filter(p => p.id !== profile.id).map(p => (
                <ProfileEditor key={p.id} p={p} canManage onChanged={afterProfileChange} say={say} errText={errText} compact />
              ))}
              {profiles.length <= 1 && <div style={{ color: '#555', fontSize: '14px' }}>No other profiles yet.</div>}
            </div>
            {profiles.length < maxProfiles
              ? <AddProfile onAdded={afterProfileChange} say={say} errText={errText} />
              : <div style={{ color: '#666', fontSize: '13px', marginTop: '16px' }}>This account has the maximum of {maxProfiles} profiles.</div>}
          </Card>
        )}
      </div>
    </div>
  );
}

// ── One profile: photo, name, Streamling switch, PIN, remove ─────────────────
function ProfileEditor({ p, self, canManage, compact, onChanged, say, errText }) {
  const [name, setName] = useState(p.name);
  const [pin, setPin] = useState('');
  const [editingPin, setEditingPin] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);
  useEffect(() => setName(p.name), [p.name]);

  const run = async (fn, ok) => {
    setBusy(true);
    try { await fn(); await onChanged(); if (ok) say(ok); } catch (err) { say(errText(err, 'Something went wrong'), true); }
    setBusy(false);
  };

  const uploadPhoto = (file) => {
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) return say('Image must be 8 MB or smaller', true);
    const form = new FormData();
    form.append('avatar', file);
    run(() => axios.post(`/api/profiles/${p.id}/avatar`, form), `Photo updated for ${p.name}`);
  };

  return (
    <div style={compact
      ? { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '10px', padding: '16px' }
      : { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', padding: '24px', marginBottom: '20px' }}>
      {!compact && <h2 style={H2}>Your profile</h2>}
      <div style={{ display: 'flex', gap: '20px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
          <ProfileAvatar profile={p} size={compact ? 64 : 96} radius="14px" />
          <input ref={fileRef} type="file" accept={IMAGE_TYPES} style={{ display: 'none' }}
            onChange={e => { uploadPhoto(e.target.files[0]); e.target.value = ''; }} />
          <div style={{ display: 'flex', gap: '6px' }}>
            <SmallBtn onClick={() => fileRef.current?.click()} disabled={busy}>{p.avatar_url ? 'Change' : 'Add photo'}</SmallBtn>
            {p.avatar_url && <SmallBtn onClick={() => run(() => axios.delete(`/api/profiles/${p.id}/avatar`), 'Photo removed')} disabled={busy}>Remove</SmallBtn>}
          </div>
        </div>

        <div style={{ flex: 1, minWidth: '230px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            {p.is_main && <Badge color="#00c2ff">Main profile</Badge>}
            {p.is_kids && <Badge color="#ffb703">Streamling</Badge>}
            {p.has_pin && <Badge color="#aaa">🔒 PIN locked</Badge>}
          </div>

          <div style={{ display: 'flex', gap: '8px' }}>
            <input style={INPUT} value={name} maxLength={20} onChange={e => setName(e.target.value)} aria-label="Profile name" />
            <Btn disabled={busy || !name.trim() || name.trim() === p.name}
              onClick={() => run(() => axios.put(`/api/profiles/${p.id}`, { name }), 'Name saved')}>Save</Btn>
          </div>

          {canManage && !p.is_main && (
            <label style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '14px', color: '#ccc', cursor: 'pointer' }}>
              <input type="checkbox" checked={p.is_kids} disabled={busy}
                onChange={e => run(() => axios.put(`/api/profiles/${p.id}`, { is_kids: e.target.checked }),
                  e.target.checked ? `${p.name} is now a Streamling` : `${p.name} is no longer a Streamling`)} />
              Streamling (kids profile) — only shows titles allowed for kids
            </label>
          )}

          {!p.is_kids && (
            editingPin ? (
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                <input style={{ ...INPUT, width: '120px', flex: 'none', letterSpacing: '6px' }} type="password" inputMode="numeric"
                  value={pin} placeholder="4 digits" maxLength={4} onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))} aria-label="New PIN" />
                <Btn disabled={busy || pin.length !== 4}
                  onClick={() => run(() => axios.put(`/api/profiles/${p.id}`, { pin }), 'PIN saved').then(() => { setEditingPin(false); setPin(''); })}>Save PIN</Btn>
                <SmallBtn onClick={() => { setEditingPin(false); setPin(''); }}>Cancel</SmallBtn>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                <SmallBtn onClick={() => setEditingPin(true)} disabled={busy}>{p.has_pin ? 'Change PIN' : 'Add a PIN lock'}</SmallBtn>
                {p.has_pin && <SmallBtn onClick={() => run(() => axios.put(`/api/profiles/${p.id}`, { pin: null }), 'PIN removed')} disabled={busy}>Remove PIN</SmallBtn>}
                {self && !p.has_pin && <span style={{ fontSize: '12px', color: '#555' }}>Stops Streamlings switching into this profile.</span>}
              </div>
            )
          )}

          {canManage && !p.is_main && !self && (
            <div>
              <SmallBtn danger disabled={busy}
                onClick={() => {
                  if (!confirmRemove) { setConfirmRemove(true); setTimeout(() => setConfirmRemove(false), 4000); return; }
                  run(() => axios.delete(`/api/profiles/${p.id}`), `${p.name} removed`);
                }}>
                {confirmRemove ? `Click again to remove ${p.name} and their history` : 'Remove profile'}
              </SmallBtn>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AddProfile({ onAdded, say, errText }) {
  const [name, setName] = useState('');
  const [kids, setKids] = useState(false);
  const [busy, setBusy] = useState(false);
  const add = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await axios.post('/api/profiles', { name, is_kids: kids });
      say(`${name.trim()} added${kids ? ' as a Streamling' : ''}`);
      setName(''); setKids(false);
      await onAdded();
    } catch (err) { say(errText(err, "Couldn't add profile"), true); }
    setBusy(false);
  };
  return (
    <form onSubmit={add} style={{ marginTop: '18px', paddingTop: '18px', borderTop: '1px solid rgba(255,255,255,0.06)', display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
      <input style={{ ...INPUT, flex: '1 1 200px' }} placeholder="New profile name" value={name} maxLength={20} onChange={e => setName(e.target.value)} />
      <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', color: '#ccc', cursor: 'pointer' }}>
        <input type="checkbox" checked={kids} onChange={e => setKids(e.target.checked)} /> Streamling
      </label>
      <Btn type="submit" primary disabled={busy || !name.trim()}>+ Add Profile</Btn>
    </form>
  );
}

// ── Parental lock (main profile only) ────────────────────────────────────────
// ── Titles in English (any profile, Streamlings too) ─────────────────────────
function LanguageSection({ profile, onChanged, say, errText }) {
  const [busy, setBusy] = useState(false);
  const on = !!profile.english_titles;
  const toggle = async () => {
    setBusy(true);
    try {
      await axios.put(`/api/profiles/${profile.id}`, { english_titles: !on });
      await onChanged();
      say(!on ? 'Titles and descriptions will show in English' : 'Titles and descriptions will show as stored');
    } catch (err) { say(errText(err, "Couldn't save that setting"), true); }
    setBusy(false);
  };
  return (
    <Card title="Language" subtitle="For movies and shows whose title or description is in another language (often anime and foreign shows).">
      <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', cursor: 'pointer' }}>
        <span>
          <span style={{ display: 'block', fontSize: '14px', fontWeight: 600, color: '#ccc' }}>Show titles and descriptions in English</span>
          <span style={{ display: 'block', fontSize: '12px', color: '#666', marginTop: '2px' }}>Where an English version is available. Applies to this profile, on the web and the Apple TV.</span>
        </span>
        <button type="button" role="switch" aria-checked={on} aria-label="Show titles and descriptions in English" disabled={busy} onClick={toggle}
          style={{ width: '46px', height: '26px', borderRadius: '13px', border: 'none', cursor: 'pointer', position: 'relative', flexShrink: 0,
            background: on ? '#00c2ff' : 'rgba(255,255,255,0.15)', transition: 'background 0.2s' }}>
          <span style={{ position: 'absolute', top: '3px', left: on ? '23px' : '3px', width: '20px', height: '20px', borderRadius: '50%', background: '#fff', transition: 'left 0.2s' }} />
        </button>
      </label>
    </Card>
  );
}

function ParentalLockSection({ lock, onChanged, say, errText }) {
  const [busy, setBusy] = useState(false);
  const save = async (changes) => {
    setBusy(true);
    try {
      const r = await axios.put('/api/auth/account/parental-lock', changes);
      onChanged(r.data.parentalLock);
      say(r.data.parentalLock.enabled ? 'Parental lock saved' : 'Parental lock turned off');
    } catch (err) { say(errText(err, "Couldn't save the parental lock"), true); }
    setBusy(false);
  };
  const option = (value, title, hint) => (
    <label style={{ display: 'flex', gap: '12px', alignItems: 'flex-start', padding: '12px 14px', borderRadius: '10px', cursor: lock.enabled ? 'pointer' : 'default',
      background: lock.method === value && lock.enabled ? 'rgba(0,194,255,0.08)' : 'rgba(255,255,255,0.03)',
      border: `1px solid ${lock.method === value && lock.enabled ? 'rgba(0,194,255,0.35)' : 'rgba(255,255,255,0.08)'}` }}>
      <input type="radio" name="lock-method" checked={lock.method === value} disabled={busy || !lock.enabled}
        onChange={() => save({ method: value })} style={{ marginTop: '3px', accentColor: '#00c2ff' }} />
      <span>
        <span style={{ display: 'block', fontSize: '14px', fontWeight: 600, color: '#ddd' }}>{title}</span>
        <span style={{ display: 'block', fontSize: '12px', color: '#666', marginTop: '2px' }}>{hint}</span>
      </span>
    </label>
  );
  return (
    <Card title="Parental lock" subtitle="Stops Streamlings switching to a grown-up profile on their own.">
      <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', marginBottom: '16px', cursor: 'pointer' }}>
        <span style={{ fontSize: '14px', fontWeight: 600, color: '#ccc' }}>Lock grown-up profiles when leaving a Streamling</span>
        <button type="button" role="switch" aria-checked={lock.enabled} disabled={busy} onClick={() => save({ enabled: !lock.enabled })}
          style={{ width: '46px', height: '26px', borderRadius: '13px', border: 'none', cursor: 'pointer', position: 'relative', flexShrink: 0,
            background: lock.enabled ? '#00c2ff' : 'rgba(255,255,255,0.15)', transition: 'background 0.2s' }}>
          <span style={{ position: 'absolute', top: '3px', left: lock.enabled ? '23px' : '3px', width: '20px', height: '20px', borderRadius: '50%', background: '#fff', transition: 'left 0.2s' }} />
        </button>
      </label>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', opacity: lock.enabled ? 1 : 0.45 }}>
        {option('password', 'Account password', 'Ask for the password you sign in with.')}
        {option('pin', 'Profile PIN', "Ask for the profile's PIN — or the account password if that profile has no PIN.")}
      </div>
    </Card>
  );
}

// ── Account (main profile only) ──────────────────────────────────────────────
function AccountSection({ user, onChanged, say, errText }) {
  const [username, setUsername] = useState('');
  const [userPw, setUserPw] = useState('');
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);

  const saveUsername = async (e) => {
    e.preventDefault(); setBusy(true);
    try {
      await axios.put('/api/auth/account/username', { username, currentPassword: userPw });
      await onChanged();
      say('Username changed — use it next time you sign in');
      setUsername(''); setUserPw('');
    } catch (err) { say(errText(err, "Couldn't change username"), true); }
    setBusy(false);
  };

  const savePassword = async (e) => {
    e.preventDefault();
    if (next !== confirm) return say("New passwords don't match", true);
    setBusy(true);
    try {
      await axios.put('/api/auth/account/password', { currentPassword: cur, newPassword: next });
      say('Password changed');
      setCur(''); setNext(''); setConfirm('');
    } catch (err) { say(errText(err, "Couldn't change password"), true); }
    setBusy(false);
  };

  return (
    <Card title="Account" subtitle="Your sign-in details. Only the main profile can change these.">
      <form onSubmit={saveUsername} style={{ marginBottom: '22px' }}>
        <div style={LABEL}>Username <span style={{ color: '#555', fontWeight: 400 }}>· currently {user?.username}</span></div>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <input style={{ ...INPUT, flex: '1 1 180px' }} placeholder="New username" value={username} onChange={e => setUsername(e.target.value)} autoComplete="username" />
          <input style={{ ...INPUT, flex: '1 1 180px' }} type="password" placeholder="Current password" value={userPw} onChange={e => setUserPw(e.target.value)} autoComplete="current-password" />
          <Btn type="submit" disabled={busy || !username.trim() || !userPw}>Change Username</Btn>
        </div>
      </form>
      <form onSubmit={savePassword}>
        <div style={LABEL}>Password</div>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <input style={{ ...INPUT, flex: '1 1 160px' }} type="password" placeholder="Current password" value={cur} onChange={e => setCur(e.target.value)} autoComplete="current-password" />
          <input style={{ ...INPUT, flex: '1 1 160px' }} type="password" placeholder="New password (6+ characters)" value={next} onChange={e => setNext(e.target.value)} autoComplete="new-password" />
          <input style={{ ...INPUT, flex: '1 1 160px' }} type="password" placeholder="Confirm new password" value={confirm} onChange={e => setConfirm(e.target.value)} autoComplete="new-password" />
          <Btn type="submit" disabled={busy || !cur || next.length < 6 || !confirm}>Change Password</Btn>
        </div>
      </form>
    </Card>
  );
}

// ── Small building blocks ────────────────────────────────────────────────────
const H2 = { fontSize: '17px', fontWeight: 700, marginBottom: '16px' };
const LABEL = { fontSize: '13px', fontWeight: 600, color: '#ccc', marginBottom: '8px' };
const INPUT = { flex: 1, minWidth: 0, padding: '10px 14px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#fff', fontSize: '14px', outline: 'none', fontFamily: 'inherit' };

function Card({ title, subtitle, children }) {
  return (
    <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', padding: '24px', marginBottom: '20px' }}>
      <h2 style={{ ...H2, marginBottom: subtitle ? '4px' : '16px' }}>{title}</h2>
      {subtitle && <p style={{ color: '#666', fontSize: '13px', marginBottom: '18px' }}>{subtitle}</p>}
      {children}
    </div>
  );
}

function Btn({ children, primary, disabled, ...rest }) {
  return (
    <button disabled={disabled} {...rest}
      style={{ padding: '10px 18px', borderRadius: '8px', fontSize: '14px', fontWeight: 700, cursor: disabled ? 'default' : 'pointer', flexShrink: 0, fontFamily: 'inherit',
        opacity: disabled ? 0.45 : 1, transition: 'background 0.2s',
        ...(primary ? { background: '#00c2ff', color: '#000', border: 'none' }
                    : { background: 'rgba(255,255,255,0.12)', color: '#fff', border: '1px solid rgba(255,255,255,0.18)' }) }}>
      {children}
    </button>
  );
}

function SmallBtn({ children, danger, disabled, ...rest }) {
  return (
    <button disabled={disabled} {...rest}
      style={{ padding: '6px 12px', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: disabled ? 'default' : 'pointer', fontFamily: 'inherit',
        background: 'transparent', opacity: disabled ? 0.45 : 1,
        color: danger ? '#ff6b6b' : '#bbb', border: `1px solid ${danger ? 'rgba(255,68,68,0.35)' : 'rgba(255,255,255,0.15)'}` }}>
      {children}
    </button>
  );
}

function Badge({ color, children }) {
  return (
    <span style={{ padding: '3px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase',
      color, background: 'rgba(255,255,255,0.06)', border: `1px solid ${color}40` }}>
      {children}
    </span>
  );
}
