import React, { useState } from 'react';
import axios from 'axios';

const STEPS = ['Welcome', 'Media Folders', 'Admin Account', 'Metadata', 'Done'];

export default function Setup({ onComplete }) {
  const [step, setStep] = useState(0);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    adminUsername: '',
    adminPassword: '',
    adminPasswordConfirm: '',
    adminEmail: '',
    moviePath: '',
    tvPath: '',
    tmdbApiKey: '',
  });

  const update = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const next = () => { setError(''); setStep(s => s + 1); };
  const back = () => { setError(''); setStep(s => s - 1); };

  const validateStep = () => {
    if (step === 2) {
      if (!form.adminUsername.trim()) return 'Username is required';
      if (form.adminUsername.length < 3) return 'Username must be at least 3 characters';
      if (!form.adminPassword) return 'Password is required';
      if (form.adminPassword.length < 6) return 'Password must be at least 6 characters';
      if (form.adminPassword !== form.adminPasswordConfirm) return 'Passwords do not match';
    }
    return null;
  };

  const handleNext = () => {
    const err = validateStep();
    if (err) { setError(err); return; }
    if (step === STEPS.length - 2) {
      submit();
    } else {
      next();
    }
  };

  const submit = async () => {
    setLoading(true);
    setError('');
    try {
      await axios.post('/api/setup/complete', {
        adminUsername: form.adminUsername,
        adminPassword: form.adminPassword,
        adminEmail: form.adminEmail || undefined,
        moviePath: form.moviePath || undefined,
        tvPath: form.tvPath || undefined,
        tmdbApiKey: form.tmdbApiKey || undefined,
      });
      next();
    } catch (err) {
      setError(err.response?.data?.error || 'Setup failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const inputStyle = {
    width: '100%',
    padding: '12px 16px',
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: '8px',
    color: '#fff',
    fontSize: '15px',
    outline: 'none',
    marginTop: '6px',
    transition: 'border-color 0.2s',
  };

  const labelStyle = {
    display: 'block',
    fontSize: '12px',
    fontWeight: '600',
    color: '#888',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    marginBottom: '2px',
  };

  const fieldStyle = { marginBottom: '18px' };

  return (
    <div style={{
      minHeight: '100vh',
      background: 'radial-gradient(ellipse at top, #1a1a2e 0%, #0f0f0f 60%)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px',
    }}>
      <div style={{ width: '100%', maxWidth: '520px' }}>

        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: '40px' }}>
          <div style={{
            fontSize: '36px',
            fontWeight: '800',
            letterSpacing: '-1px',
            background: 'linear-gradient(135deg, #00c2ff, #7b2fff)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
            marginBottom: '8px',
          }}>
            STREAMULUS
          </div>
          <div style={{ color: '#555', fontSize: '14px' }}>Setup Wizard</div>
        </div>

        {/* Progress */}
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: '40px' }}>
          {STEPS.map((s, i) => (
            <React.Fragment key={s}>
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '6px',
                flex: i < STEPS.length - 1 ? '1' : 'none',
              }}>
                <div style={{
                  width: '30px',
                  height: '30px',
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '13px',
                  fontWeight: '700',
                  background: i < step ? '#00c2ff' : i === step ? 'rgba(0,194,255,0.2)' : 'rgba(255,255,255,0.06)',
                  border: i === step ? '2px solid #00c2ff' : '2px solid transparent',
                  color: i < step ? '#000' : i === step ? '#00c2ff' : '#444',
                  transition: 'all 0.3s',
                  flexShrink: 0,
                }}>
                  {i < step ? '✓' : i + 1}
                </div>
                <div style={{ fontSize: '10px', color: i <= step ? '#aaa' : '#444', whiteSpace: 'nowrap' }}>{s}</div>
              </div>
              {i < STEPS.length - 1 && (
                <div style={{
                  flex: 1,
                  height: '2px',
                  background: i < step ? '#00c2ff' : 'rgba(255,255,255,0.08)',
                  margin: '0 8px',
                  marginBottom: '22px',
                  transition: 'background 0.3s',
                }} />
              )}
            </React.Fragment>
          ))}
        </div>

        {/* Card */}
        <div style={{
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: '16px',
          padding: '36px',
        }}>

          {/* Step 0: Welcome */}
          {step === 0 && (
            <div>
              <div style={{ fontSize: '28px', marginBottom: '8px' }}>👋</div>
              <h2 style={{ fontSize: '22px', fontWeight: '700', marginBottom: '12px' }}>Welcome to Streamulus</h2>
              <p style={{ color: '#888', lineHeight: '1.7', marginBottom: '16px' }}>
                Your self-hosted media server. In just a few steps, we'll set up your libraries,
                create your admin account, and connect to metadata providers.
              </p>
              <ul style={{ color: '#666', fontSize: '14px', lineHeight: '2', paddingLeft: '20px' }}>
                <li>Point to your media folders</li>
                <li>Create your admin account</li>
                <li>Optionally add a TMDB API key for artwork & metadata</li>
                <li>That's it — you're ready to stream!</li>
              </ul>
            </div>
          )}

          {/* Step 1: Media Folders */}
          {step === 1 && (
            <div>
              <h2 style={{ fontSize: '22px', fontWeight: '700', marginBottom: '8px' }}>Media Folders</h2>
              <p style={{ color: '#888', fontSize: '14px', marginBottom: '24px', lineHeight: '1.6' }}>
                Enter the paths to your media folders inside the container.
                Map your actual folders to <code style={{ color: '#00c2ff' }}>/movies</code> and <code style={{ color: '#00c2ff' }}>/tv</code> in your Docker config.
              </p>
              <div style={fieldStyle}>
                <label style={labelStyle}>Movies Folder</label>
                <input
                  style={inputStyle}
                  type="text"
                  placeholder="/movies"
                  value={form.moviePath}
                  onChange={e => update('moviePath', e.target.value)}
                  onFocus={e => { e.target.style.borderColor = '#00c2ff'; }}
                  onBlur={e => { e.target.style.borderColor = 'rgba(255,255,255,0.12)'; }}
                />
              </div>
              <div style={fieldStyle}>
                <label style={labelStyle}>TV Shows Folder</label>
                <input
                  style={inputStyle}
                  type="text"
                  placeholder="/tv"
                  value={form.tvPath}
                  onChange={e => update('tvPath', e.target.value)}
                  onFocus={e => { e.target.style.borderColor = '#00c2ff'; }}
                  onBlur={e => { e.target.style.borderColor = 'rgba(255,255,255,0.12)'; }}
                />
              </div>
              <div style={{ padding: '12px 16px', background: 'rgba(0,194,255,0.06)', border: '1px solid rgba(0,194,255,0.15)', borderRadius: '8px', fontSize: '13px', color: '#888' }}>
                💡 Both fields are optional — you can add libraries later from the Admin panel.
              </div>
            </div>
          )}

          {/* Step 2: Admin Account */}
          {step === 2 && (
            <div>
              <h2 style={{ fontSize: '22px', fontWeight: '700', marginBottom: '8px' }}>Admin Account</h2>
              <p style={{ color: '#888', fontSize: '14px', marginBottom: '24px' }}>
                Create your administrator account. You can add more users later.
              </p>
              <div style={fieldStyle}>
                <label style={labelStyle}>Username *</label>
                <input style={inputStyle} type="text" placeholder="admin" value={form.adminUsername}
                  onChange={e => update('adminUsername', e.target.value)}
                  onFocus={e => { e.target.style.borderColor = '#00c2ff'; }}
                  onBlur={e => { e.target.style.borderColor = 'rgba(255,255,255,0.12)'; }} />
              </div>
              <div style={fieldStyle}>
                <label style={labelStyle}>Email (optional)</label>
                <input style={inputStyle} type="email" placeholder="admin@example.com" value={form.adminEmail}
                  onChange={e => update('adminEmail', e.target.value)}
                  onFocus={e => { e.target.style.borderColor = '#00c2ff'; }}
                  onBlur={e => { e.target.style.borderColor = 'rgba(255,255,255,0.12)'; }} />
              </div>
              <div style={fieldStyle}>
                <label style={labelStyle}>Password *</label>
                <input style={inputStyle} type="password" placeholder="Min. 6 characters" value={form.adminPassword}
                  onChange={e => update('adminPassword', e.target.value)}
                  onFocus={e => { e.target.style.borderColor = '#00c2ff'; }}
                  onBlur={e => { e.target.style.borderColor = 'rgba(255,255,255,0.12)'; }} />
              </div>
              <div style={fieldStyle}>
                <label style={labelStyle}>Confirm Password *</label>
                <input style={inputStyle} type="password" placeholder="Repeat password" value={form.adminPasswordConfirm}
                  onChange={e => update('adminPasswordConfirm', e.target.value)}
                  onFocus={e => { e.target.style.borderColor = '#00c2ff'; }}
                  onBlur={e => { e.target.style.borderColor = 'rgba(255,255,255,0.12)'; }} />
              </div>
            </div>
          )}

          {/* Step 3: TMDB */}
          {step === 3 && (
            <div>
              <h2 style={{ fontSize: '22px', fontWeight: '700', marginBottom: '8px' }}>Metadata (Optional)</h2>
              <p style={{ color: '#888', fontSize: '14px', marginBottom: '24px', lineHeight: '1.6' }}>
                Connect to The Movie Database (TMDB) to automatically fetch posters, backdrops, ratings, and descriptions for your media.
              </p>
              <div style={fieldStyle}>
                <label style={labelStyle}>TMDB API Key</label>
                <input style={inputStyle} type="text" placeholder="Paste your TMDB v3 API key"
                  value={form.tmdbApiKey}
                  onChange={e => update('tmdbApiKey', e.target.value)}
                  onFocus={e => { e.target.style.borderColor = '#00c2ff'; }}
                  onBlur={e => { e.target.style.borderColor = 'rgba(255,255,255,0.12)'; }} />
              </div>
              <div style={{ padding: '14px 16px', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '8px', fontSize: '13px', color: '#777', lineHeight: '1.7' }}>
                <strong style={{ color: '#aaa' }}>How to get a free TMDB API key:</strong><br />
                1. Create an account at themoviedb.org<br />
                2. Go to Settings → API<br />
                3. Request a Developer API key<br />
                4. Copy the v3 auth key and paste above
              </div>
            </div>
          )}

          {/* Step 4: Done */}
          {step === 4 && (
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '64px', marginBottom: '20px' }}>🎉</div>
              <h2 style={{ fontSize: '24px', fontWeight: '700', marginBottom: '12px' }}>You're all set!</h2>
              <p style={{ color: '#888', lineHeight: '1.7', marginBottom: '32px' }}>
                Streamulus has been configured. A media scan is running in the background.
                Log in with your admin credentials to start streaming.
              </p>
              <button
                onClick={onComplete}
                style={{
                  padding: '14px 40px',
                  background: 'linear-gradient(135deg, #00c2ff, #7b2fff)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '16px',
                  fontWeight: '700',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
                onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.03)'; }}
                onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; }}
              >
                Go to Streamulus →
              </button>
            </div>
          )}

          {error && (
            <div style={{ marginTop: '16px', padding: '12px 16px', background: 'rgba(255,68,68,0.1)', border: '1px solid rgba(255,68,68,0.2)', borderRadius: '8px', color: '#ff4444', fontSize: '14px' }}>
              {error}
            </div>
          )}

          {step < STEPS.length - 1 && (
            <div style={{ display: 'flex', gap: '12px', marginTop: '32px', justifyContent: 'flex-end' }}>
              {step > 0 && (
                <button
                  onClick={back}
                  style={{ padding: '12px 24px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', borderRadius: '8px', fontSize: '14px', fontWeight: '600', cursor: 'pointer' }}
                >
                  ← Back
                </button>
              )}
              <button
                onClick={handleNext}
                disabled={loading}
                style={{
                  padding: '12px 28px',
                  background: loading ? '#444' : '#00c2ff',
                  color: '#000',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '14px',
                  fontWeight: '700',
                  cursor: loading ? 'not-allowed' : 'pointer',
                  transition: 'all 0.2s',
                }}
              >
                {loading ? 'Setting up...' : step === STEPS.length - 2 ? 'Finish Setup' : 'Continue →'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
