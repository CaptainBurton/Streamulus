import React, { useState } from 'react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import QuickLoginRequest from '../components/QuickLoginRequest';
import BrandMark from '../components/BrandMark';
import MailIcon from '../components/MailIcon';

const PASSPHRASE_CODES = ['PASSPHRASE_REQUIRED', 'PASSPHRASE_NOT_READY', 'PASSPHRASE_INVALID', 'PASSPHRASE_EXPIRED'];

export default function Login() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  // 'password' | 'code' (Quick Login) | 'create' (new account) | 'forgot' (password reset email).
  // /create-account and /forgot-password open straight to theirs.
  const [mode, setModeState] = useState(() => ({ '/create-account': 'create', '/forgot-password': 'forgot' }[window.location.pathname] || 'password'));
  // A new account's first sign-in needs the Admin Passphrase: { message, created }.
  const [passphraseStep, setPassphraseStep] = useState(null);
  const [passphrase, setPassphrase] = useState('');
  const [confirm, setConfirm] = useState('');
  const [email, setEmail] = useState('');
  // Forgot password: what happened ({ sent, to, minutes } or { notice, code }).
  const [forgot, setForgot] = useState(null);

  const setMode = (m) => {
    setError('');
    setModeState(m);
    // Keep the address bar in step so the create page can be linked to (the Apple TV does).
    try { window.history.replaceState(null, '', m === 'create' ? '/create-account' : m === 'forgot' ? '/forgot-password' : '/'); } catch {}
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(username, password, passphraseStep ? passphrase : undefined);
    } catch (err) {
      const data = err.response?.data;
      if (PASSPHRASE_CODES.includes(data?.code)) {
        // First sign-in of a new account: ask for the Admin Passphrase.
        if (!passphraseStep || data.code === 'PASSPHRASE_REQUIRED') setPassphraseStep({ message: data.error });
        if (passphraseStep && data.code !== 'PASSPHRASE_REQUIRED') setError(data.error);
      } else {
        setError(data?.error || 'Login failed');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    setError('');
    if (password !== confirm) { setError("The passwords don't match"); return; }
    setLoading(true);
    try {
      const res = await axios.post('/api/auth/register', { displayName: username, password, email: email.trim() });
      setUsername(res.data.username);
      setConfirm('');
      setPassphrase('');
      setPassphraseStep({ message: res.data.message, created: true });
      setMode('password');
    } catch (err) {
      setError(err.response?.data?.error || "Couldn't create the account");
    } finally {
      setLoading(false);
    }
  };

  const handleForgot = async (e) => {
    e.preventDefault();
    setError('');
    setForgot(null);
    setLoading(true);
    try {
      const res = await axios.post('/api/auth/forgot', { identifier: email.trim() });
      setForgot({ sent: true, to: res.data.to, minutes: res.data.minutes });
    } catch (err) {
      const data = err.response?.data;
      // No email on the account (or not found / not set up): a friendly note, not an error.
      if (['NO_EMAIL', 'NOT_FOUND', 'EMAIL_NOT_CONFIGURED', 'PENDING', 'DISABLED'].includes(data?.code)) setForgot({ notice: data.error, code: data.code });
      else setError(data?.error || "Couldn't send the email — try again");
    } finally {
      setLoading(false);
    }
  };

  const inputStyle = {
    width: '100%',
    padding: '14px 16px',
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '8px',
    color: '#fff',
    fontSize: '15px',
    outline: 'none',
    transition: 'border-color 0.2s',
  };

  const labelStyle = { display: 'block', fontSize: '12px', fontWeight: '600', color: '#777', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' };
  const focusOn = e => { e.target.style.borderColor = '#00c2ff'; };
  const focusOff = e => { e.target.style.borderColor = 'rgba(255,255,255,0.1)'; };
  const field = (label, props) => (
    <div style={{ marginBottom: '18px' }}>
      <label style={labelStyle}>{label}</label>
      <input style={inputStyle} onFocus={focusOn} onBlur={focusOff} {...props} />
    </div>
  );
  const primaryButton = (text, busyText, disabled) => (
    <button
      type="submit"
      disabled={loading || disabled}
      style={{
        width: '100%',
        padding: '14px',
        marginTop: '6px',
        background: loading || disabled ? '#333' : 'linear-gradient(135deg, #00c2ff, #7b2fff)',
        color: loading || disabled ? '#666' : '#fff',
        border: 'none',
        borderRadius: '8px',
        fontSize: '16px',
        fontWeight: '700',
        cursor: loading || disabled ? 'not-allowed' : 'pointer',
        transition: 'all 0.2s',
      }}
    >
      {loading ? busyText : text}
    </button>
  );
  const secondaryButton = { width: '100%', padding: '13px', background: 'rgba(255,255,255,0.06)', color: '#ddd', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '8px', fontSize: '15px', fontWeight: 600, cursor: 'pointer' };
  const linkButton = { background: 'none', border: 'none', color: '#00c2ff', fontSize: '14px', fontWeight: 600, cursor: 'pointer', padding: '4px' };
  const errorBox = error && (
    <div style={{ marginBottom: '18px', padding: '12px 16px', background: 'rgba(255,68,68,0.1)', border: '1px solid rgba(255,68,68,0.2)', borderRadius: '8px', color: '#ff4444', fontSize: '14px' }}>
      {error}
    </div>
  );
  const divider = (
    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', margin: '22px 0 16px', color: '#444', fontSize: '12px' }}>
      <span style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.08)' }} /> OR <span style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.08)' }} />
    </div>
  );

  const subtitle = mode === 'code' ? 'Sign in with a code'
    : mode === 'create' ? 'Create your account'
    : mode === 'forgot' ? 'Reset your password'
    : passphraseStep ? 'One more step' : 'Sign in to continue';

  return (
    <div style={{
      minHeight: '100vh',
      background: 'radial-gradient(ellipse at top, #1a1a2e 0%, #0f0f0f 60%)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px',
    }}>
      <div style={{ width: '100%', maxWidth: '420px' }}>
        <div style={{ textAlign: 'center', marginBottom: '40px' }}>
          <div style={{ marginBottom: '8px', display: 'flex', justifyContent: 'center' }}>
            <BrandMark size={40} />
          </div>
          <div style={{ color: '#555', fontSize: '14px' }}>{subtitle}</div>
        </div>

        <div style={{
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: '16px',
          padding: '36px',
        }}>
          {mode === 'code' && <QuickLoginRequest onCancel={() => setMode('password')} />}

          {mode === 'create' && (
            <form onSubmit={handleCreate}>
              {field('Display name', {
                type: 'text', value: username, onChange: e => setUsername(e.target.value),
                placeholder: 'e.g. Erin', autoComplete: 'username', maxLength: 32, autoFocus: true,
              })}
              <div style={{ margin: '-10px 0 18px', color: '#666', fontSize: '12px' }}>You'll sign in with this name.</div>
              {field('Password', {
                type: 'password', value: password, onChange: e => setPassword(e.target.value),
                placeholder: 'At least 6 characters', autoComplete: 'new-password',
              })}
              {field('Confirm password', {
                type: 'password', value: confirm, onChange: e => setConfirm(e.target.value),
                placeholder: 'Type it again', autoComplete: 'new-password',
              })}
              {field('Email address', {
                type: 'email', value: email, onChange: e => setEmail(e.target.value),
                placeholder: 'you@example.com', autoComplete: 'email', required: true,
              })}
              <div style={{ margin: '-10px 0 18px', color: '#666', fontSize: '12px' }}>So you can reset your password if you ever forget it.</div>
              {errorBox}
              {primaryButton('Create Account', 'Creating…', !username.trim() || !password || !confirm || !email.trim())}
              <p style={{ margin: '16px 0 0', color: '#666', fontSize: '13px', lineHeight: 1.5 }}>
                New accounts need an <strong style={{ color: '#aaa' }}>Admin Passphrase</strong> from your Streamulus admin
                before the first sign-in. It usually takes 5–10 minutes to get one.
              </p>
              <div style={{ textAlign: 'center', marginTop: '18px' }}>
                <button type="button" style={linkButton} onClick={() => { setPassword(''); setConfirm(''); setMode('password'); }}>
                  Already have an account? Sign in
                </button>
              </div>
            </form>
          )}

          {mode === 'forgot' && (
            forgot?.sent ? (
              <div style={{ textAlign: 'center' }} data-forgot="sent">
                <div style={{ width: '56px', height: '56px', margin: '0 auto 16px', borderRadius: '50%', background: 'linear-gradient(135deg, #00c2ff, #7b2fff)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}><MailIcon size="28px" /></div>
                <div style={{ fontSize: '18px', fontWeight: 700, color: '#fff', marginBottom: '10px' }}>Check your email</div>
                <p style={{ color: '#aaa', fontSize: '14px', lineHeight: 1.6, margin: '0 0 8px' }}>
                  We've sent a link to <strong style={{ color: '#fff' }}>{forgot.to}</strong>. Press <strong style={{ color: '#fff' }}>Reset Password</strong> in the email to choose a new password.
                </p>
                <p style={{ color: '#666', fontSize: '13px', lineHeight: 1.6, margin: '0 0 22px' }}>
                  The link works for {forgot.minutes || 60} minutes. Can't see it? Check your spam folder.
                </p>
                <button type="button" style={secondaryButton} onClick={() => { setForgot(null); setMode('password'); }}>Back to sign in</button>
              </div>
            ) : (
              <form onSubmit={handleForgot}>
                <p style={{ color: '#aaa', fontSize: '14px', lineHeight: 1.6, margin: '0 0 20px' }}>
                  Enter the email address on your account and we'll send you a link to reset your password.
                </p>
                {field('Email address', {
                  type: 'text', inputMode: 'email', value: email, onChange: e => { setEmail(e.target.value); setForgot(null); },
                  placeholder: 'you@example.com', autoComplete: 'email', autoCapitalize: 'none', spellCheck: false, autoFocus: true,
                })}
                {forgot?.notice && (
                  <div data-forgot={forgot.code} style={{ marginBottom: '18px', padding: '12px 16px', background: 'rgba(255,183,3,0.08)', border: '1px solid rgba(255,183,3,0.3)', borderRadius: '8px', color: '#ffd166', fontSize: '14px', lineHeight: 1.5 }}>
                    {forgot.notice}
                  </div>
                )}
                {errorBox}
                {primaryButton('Send Reset Link', 'Sending…', !email.trim())}
                <div style={{ textAlign: 'center', marginTop: '18px' }}>
                  <button type="button" style={linkButton} onClick={() => { setForgot(null); setMode('password'); }}>Back to sign in</button>
                </div>
              </form>
            )
          )}

          {mode === 'password' && (
          <form onSubmit={handleSubmit}>
            {passphraseStep && (
              <div style={{ marginBottom: '22px', padding: '14px 16px', background: 'rgba(0,194,255,0.08)', border: '1px solid rgba(0,194,255,0.25)', borderRadius: '10px', color: '#cfefff', fontSize: '14px', lineHeight: 1.5 }}>
                {passphraseStep.created && <div style={{ fontWeight: 700, color: '#fff', marginBottom: '4px' }}>✓ Account created</div>}
                {passphraseStep.message}
              </div>
            )}
            {field('Username', {
              type: 'text', value: username, onChange: e => setUsername(e.target.value),
              placeholder: 'Enter username', autoComplete: 'username', readOnly: !!passphraseStep?.created,
            })}
            {field('Password', {
              type: 'password', value: password, onChange: e => setPassword(e.target.value),
              placeholder: 'Enter password', autoComplete: 'current-password',
            })}
            {!passphraseStep && (
              <div style={{ textAlign: 'right', margin: '-10px 0 14px' }}>
                <button type="button" style={{ ...linkButton, fontSize: '13px', fontWeight: 600 }} onClick={() => { setForgot(null); setMode('forgot'); }}>
                  Forgot password?
                </button>
              </div>
            )}
            {passphraseStep && field('Admin Passphrase', {
              type: 'text', value: passphrase, onChange: e => setPassphrase(e.target.value),
              placeholder: 'e.g. maple-river-otter-comet', autoComplete: 'one-time-code',
              autoCapitalize: 'none', spellCheck: false, autoFocus: true,
            })}

            {errorBox}

            {primaryButton(passphraseStep ? 'Activate & Sign In' : 'Sign In', 'Signing in...', passphraseStep && !passphrase.trim())}

            {passphraseStep ? (
              <div style={{ textAlign: 'center', marginTop: '18px' }}>
                <button type="button" style={linkButton} onClick={() => { setPassphraseStep(null); setPassphrase(''); setError(''); }}>
                  Back to sign in
                </button>
              </div>
            ) : (
              <>
                {divider}
                <button type="button" onClick={() => setMode('code')} style={secondaryButton}>
                  Sign in with a code (Quick Login)
                </button>
                <div style={{ textAlign: 'center', marginTop: '20px', color: '#666', fontSize: '14px' }}>
                  New here?{' '}
                  <button type="button" style={linkButton} onClick={() => { setPassword(''); setConfirm(''); setMode('create'); }}>
                    Create an account
                  </button>
                </div>
              </>
            )}
          </form>
          )}
        </div>
      </div>
    </div>
  );
}
