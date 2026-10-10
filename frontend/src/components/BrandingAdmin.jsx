import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import BrandMark, { DEFAULT_LOGO, setBranding } from './BrandMark';

const card = { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', padding: '28px' };
const btn = (primary) => ({
  padding: '9px 18px', borderRadius: '8px', fontSize: '13px', fontWeight: 700, cursor: 'pointer',
  border: primary ? 'none' : '1px solid rgba(255,255,255,0.15)', background: primary ? '#00c2ff' : 'transparent', color: primary ? '#000' : '#ccc',
});

function Toggle({ on, onChange, label, hint, disabled }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', padding: '12px 0', cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1 }}>
      <span>
        <span style={{ display: 'block', fontSize: '14px', fontWeight: 600, color: '#ccc' }}>{label}</span>
        {hint && <span style={{ display: 'block', fontSize: '12px', color: '#555', marginTop: '3px' }}>{hint}</span>}
      </span>
      <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)}
        style={{ width: '46px', height: '26px', borderRadius: '13px', border: 'none', cursor: disabled ? 'default' : 'pointer', position: 'relative', flexShrink: 0,
          background: on ? '#00c2ff' : 'rgba(255,255,255,0.15)', transition: 'background 0.2s' }}>
        <span style={{ position: 'absolute', top: '3px', left: on ? '23px' : '3px', width: '20px', height: '20px', borderRadius: '50%', background: '#fff', transition: 'left 0.2s' }} />
      </button>
    </label>
  );
}

// Admin › Settings: the logo / "STREAMULUS" text shown on the web and in the
// apps, and the public address the apps fall back to away from home.
export default function BrandingAdmin({ flash }) {
  const [b, setB] = useState(null);
  const [busy, setBusy] = useState(false);
  const [publicUrl, setPublicUrl] = useState('');
  const fileRef = useRef(null);

  useEffect(() => {
    axios.get('/api/branding').then(r => { setB(r.data); setPublicUrl(r.data.publicUrl || ''); }).catch(() => {});
  }, []);

  const applied = (data, message) => { setB(data); setBranding(data); flash(message); };
  const fail = (err, fallback) => flash(err.response?.data?.error || fallback, true);

  const save = async (changes, message) => {
    setBusy(true);
    try { applied((await axios.put('/api/branding', changes)).data, message); }
    catch (err) { fail(err, 'Could not save branding'); }
    setBusy(false);
  };

  const upload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const form = new FormData();
    form.append('logo', file);
    setBusy(true);
    try { applied((await axios.post('/api/branding/logo', form)).data, 'Logo updated'); }
    catch (err) { fail(err, 'Upload failed'); }
    setBusy(false);
    e.target.value = '';
  };

  const reset = async () => {
    setBusy(true);
    try { applied((await axios.delete('/api/branding/logo')).data, 'Back to the Streamulus logo'); }
    catch (err) { fail(err, 'Could not reset the logo'); }
    setBusy(false);
  };

  if (!b) return null;
  return (
    <>
      <div style={card}>
        <h3 style={{ fontSize: '16px', fontWeight: '700', marginBottom: '6px' }}>Branding</h3>
        <p style={{ color: '#666', fontSize: '14px', marginBottom: '18px' }}>
          What appears in the top bar, on the sign-in page and in the Apple TV and iPhone apps. Show the logo, the text, or both.
        </p>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '22px', borderRadius: '10px', background: '#0f0f0f', border: '1px solid rgba(255,255,255,0.06)', marginBottom: '8px' }}>
          <BrandMark size={30} />
        </div>
        <Toggle label="Show logo" on={b.showLogo} disabled={busy || (b.showLogo && !b.showText)}
          hint={b.showLogo && !b.showText ? 'Turn the text on first — one of them has to stay on' : null}
          onChange={v => save({ showLogo: v }, v ? 'Logo shown' : 'Logo hidden')} />
        <Toggle label='Show "STREAMULUS" text' on={b.showText} disabled={busy || (b.showText && !b.showLogo)}
          hint={b.showText && !b.showLogo ? 'Turn the logo on first — one of them has to stay on' : null}
          onChange={v => save({ showText: v }, v ? 'Text shown' : 'Text hidden')} />
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '12px 0', flexWrap: 'wrap' }}>
          <img src={b.logoUrl || DEFAULT_LOGO} alt="Current logo" style={{ width: '56px', height: '56px', objectFit: 'contain', borderRadius: '10px', background: '#0f0f0f', padding: '6px', border: '1px solid rgba(255,255,255,0.08)' }} />
          <div style={{ flex: 1, minWidth: '180px' }}>
            <div style={{ fontSize: '14px', fontWeight: 600, color: '#ccc' }}>{b.logoUrl ? 'Custom logo' : 'Streamulus logo (default)'}</div>
            <div style={{ fontSize: '12px', color: '#555', marginTop: '3px' }}>PNG, JPG, WebP or GIF up to 5 MB — a square PNG with a transparent background works best.</div>
          </div>
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" style={{ display: 'none' }} onChange={upload} />
          <button style={btn(true)} disabled={busy} onClick={() => fileRef.current?.click()}>{b.logoUrl ? 'Change logo' : 'Upload logo'}</button>
          {b.logoUrl && <button style={btn(false)} disabled={busy} onClick={reset}>Use default</button>}
        </div>
      </div>

      <div style={card}>
        <h3 style={{ fontSize: '16px', fontWeight: '700', marginBottom: '6px' }}>Remote Access</h3>
        <p style={{ color: '#666', fontSize: '14px', marginBottom: '18px' }}>
          A public address for this server, e.g. a Tailscale Funnel URL. The iPhone and Apple TV apps learn it when they connect at home and
          switch to it automatically when the home address doesn't answer — so friends don't need a VPN.
        </p>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <input
            aria-label="Public URL"
            value={publicUrl}
            placeholder="https://streamulus.your-tailnet.ts.net"
            onChange={e => setPublicUrl(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') save({ publicUrl }, publicUrl.trim() ? 'Public URL saved' : 'Public URL removed'); }}
            style={{ flex: 1, minWidth: '240px', padding: '10px 14px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#fff', fontSize: '14px', outline: 'none' }}
          />
          <button style={btn(true)} disabled={busy} onClick={() => save({ publicUrl }, publicUrl.trim() ? 'Public URL saved' : 'Public URL removed')}>Save</button>
        </div>
      </div>
    </>
  );
}
