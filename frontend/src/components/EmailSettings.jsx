import React, { useEffect, useState } from 'react';
import axios from 'axios';

// Admin › Emails › Sending: the address Streamulus sends from, its Google App
// Password, who people should contact for help, and a test send. Gmail is the
// default; other servers are under "Other email server".

const CARD = { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', padding: '28px' };
const INPUT = { width: '100%', padding: '10px 14px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#fff', fontSize: '14px', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' };
const LABEL = { fontSize: '13px', color: '#888', display: 'block', marginBottom: '8px', fontWeight: 600 };
const BTN = { padding: '10px 20px', borderRadius: '8px', fontSize: '14px', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' };

export default function EmailSettings({ flash, onChanged }) {
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null);
  const [password, setPassword] = useState('');
  const [testTo, setTestTo] = useState('');
  const [advanced, setAdvanced] = useState(false);
  const [busy, setBusy] = useState('');

  const apply = (d) => {
    setData(d);
    setForm({ fromAddress: d.fromAddress, fromName: d.fromName, supportContact: d.supportContact, host: d.host, port: String(d.port), secure: d.secure, username: d.username });
  };
  useEffect(() => { axios.get('/api/admin/email').then(r => apply(r.data)).catch(() => {}); }, []);
  if (!data || !form) return null;

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const run = async (name, fn) => {
    setBusy(name);
    try { await fn(); } catch (err) { flash(err.response?.data?.error || 'Something went wrong', true); }
    setBusy('');
  };

  const save = () => run('save', async () => {
    const body = { ...form, port: form.port };
    if (password.trim()) body.password = password;
    const r = await axios.put('/api/admin/email', body);
    apply(r.data);
    setPassword('');
    onChanged?.(r.data);
    flash(r.data.configured ? 'Email settings saved — send a test to check them' : 'Email settings saved');
  });
  const removePassword = () => run('remove', async () => {
    const r = await axios.put('/api/admin/email', { clearPassword: true });
    apply(r.data);
    onChanged?.(r.data);
    flash('App Password removed — password reset emails are off until you add one');
  });
  const test = () => run('test', async () => {
    const r = await axios.post('/api/admin/email/test', { to: testTo.trim() || undefined });
    flash(`Test email sent to ${r.data.to} — check that inbox (and spam)`);
  });

  const gmail = /gmail\.com$/i.test(form.host);

  return (
    <div style={CARD} data-section="email">
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px', flexWrap: 'wrap' }}>
        <h3 style={{ fontSize: '16px', fontWeight: '700' }}>Sending</h3>
        <span style={{ padding: '2px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase',
          color: data.configured ? '#00c864' : '#ffb703', border: `1px solid ${data.configured ? '#00c86455' : '#ffb70355'}` }}>
          {data.configured ? 'Ready' : 'Needs an App Password'}
        </span>
      </div>
      <p style={{ color: '#666', fontSize: '14px', marginBottom: '22px', lineHeight: 1.6 }}>
        Streamulus sends its emails from this address — password resets (people choose <em>Forgot password?</em> on the sign-in page),
        Admin Passphrases you email, and emails you write. Someone without an email on their account is told to contact the person below.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '18px' }}>
        <div>
          <label style={LABEL} htmlFor="mail-from">Send from</label>
          <input id="mail-from" style={INPUT} type="email" value={form.fromAddress} onChange={set('fromAddress')} placeholder={data.defaults.fromAddress} />
        </div>
        <div>
          <label style={LABEL} htmlFor="mail-name">Sender name</label>
          <input id="mail-name" style={INPUT} value={form.fromName} onChange={set('fromName')} placeholder="Streamulus" />
        </div>
        <div>
          <label style={LABEL} htmlFor="mail-password">{gmail ? 'Google App Password' : 'Password'}</label>
          <input id="mail-password" style={INPUT} type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="new-password"
            placeholder={data.passwordFromEnv ? 'Set by SMTP_PASSWORD on the server' : data.passwordSet ? '•••••••••••••••• (saved — type to replace)' : gmail ? '16 letters, e.g. abcd efgh ijkl mnop' : 'Password'}
            disabled={data.passwordFromEnv} />
          {data.passwordSet && !data.passwordFromEnv && (
            <button type="button" onClick={removePassword} disabled={!!busy} style={{ background: 'none', border: 'none', color: '#ff8080', fontSize: '12px', cursor: 'pointer', padding: '6px 0 0' }}>Remove saved password</button>
          )}
        </div>
        <div>
          <label style={LABEL} htmlFor="mail-contact">People contact for help</label>
          <input id="mail-contact" style={INPUT} value={form.supportContact} onChange={set('supportContact')} placeholder="Erin" />
        </div>
      </div>

      {gmail && (
        <div style={{ marginTop: '18px', padding: '14px 16px', borderRadius: '10px', background: 'rgba(0,194,255,0.06)', border: '1px solid rgba(0,194,255,0.2)', fontSize: '13px', color: '#9fc9d9', lineHeight: 1.7 }}>
          <strong style={{ color: '#cfefff' }}>Gmail needs an App Password</strong> (not the account's normal password):
          <ol style={{ margin: '6px 0 0', paddingLeft: '20px' }}>
            <li>Sign in to <strong>{form.fromAddress || 'the Gmail account'}</strong> and turn on <strong>2-Step Verification</strong> (Google Account › Security).</li>
            <li>Open <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer" style={{ color: '#00c2ff' }}>myaccount.google.com/apppasswords</a>, name it “Streamulus” and press <strong>Create</strong>.</li>
            <li>Paste the 16-letter password above, press <strong>Save</strong>, then send yourself a test.</li>
          </ol>
        </div>
      )}

      <details style={{ marginTop: '18px', padding: '14px 16px', borderRadius: '10px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', fontSize: '13px', color: '#aaa', lineHeight: 1.7 }} data-section="spam-tips">
        <summary style={{ cursor: 'pointer', color: '#ddd', fontWeight: 700 }}>Keeping emails out of spam</summary>
        <p style={{ margin: '10px 0 6px' }}>
          Streamulus already sends each email the way inboxes like (through Gmail itself, with a plain-text copy, no hidden text, and the right headers).
          A new Gmail address sending sign-in links is still unfamiliar to spam filters at first, so:
        </p>
        <ol style={{ margin: 0, paddingLeft: '20px' }}>
          <li>When someone gets their first email from <strong style={{ color: '#ddd' }}>{form.fromAddress || 'Streamulus'}</strong>, ask them to open it from Spam and press <strong style={{ color: '#ddd' }}>Not spam</strong> (Gmail) or <strong style={{ color: '#ddd' }}>Not junk</strong> (Outlook / Hotmail), and add the address to their contacts. Their inbox remembers it from then on.</li>
          <li>Send yourself a test and do the same — every “Not spam” teaches the filters this sender is fine.</li>
          <li>Set a public address in <strong style={{ color: '#ddd' }}>Settings › Remote Access</strong> so links point at your server's name, not a bare IP address (links to IP addresses look suspicious).</li>
          <li>In the Gmail account, give it a name and profile picture (Google Account › Personal info), and use it only for Streamulus.</li>
          <li>Keep emails personal and few — send custom emails to the people they're for rather than everyone at once.</li>
          <li>For the best results, send from your own domain (e.g. <em>hello@yourdomain.com</em>) through a mail service that sets up SPF and DKIM for it (Zoho Mail, Fastmail, Brevo, Resend…) and enter its details under <em>Other email server</em>.</li>
        </ol>
      </details>

      <button type="button" onClick={() => setAdvanced(a => !a)} style={{ background: 'none', border: 'none', color: '#888', fontSize: '13px', cursor: 'pointer', padding: '16px 0 0' }}>
        {advanced ? '▾' : '▸'} Other email server
      </button>
      {advanced && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '14px', marginTop: '12px' }}>
          <div>
            <label style={LABEL} htmlFor="mail-host">Server</label>
            <input id="mail-host" style={INPUT} value={form.host} onChange={set('host')} placeholder={data.defaults.host} />
          </div>
          <div>
            <label style={LABEL} htmlFor="mail-port">Port</label>
            <input id="mail-port" style={INPUT} inputMode="numeric" value={form.port} onChange={set('port')} placeholder={String(data.defaults.port)} />
          </div>
          <div>
            <label style={LABEL} htmlFor="mail-user">Sign-in name</label>
            <input id="mail-user" style={INPUT} value={form.username} onChange={set('username')} placeholder="Same as Send from" />
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: '#aaa', cursor: 'pointer', alignSelf: 'end', paddingBottom: '10px' }}>
            <input type="checkbox" checked={form.secure} onChange={set('secure')} style={{ accentColor: '#00c2ff' }} /> Secure connection (SSL, port 465)
          </label>
        </div>
      )}

      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center', marginTop: '22px', paddingTop: '18px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        <button onClick={save} disabled={!!busy} style={{ ...BTN, border: 'none', background: '#00c2ff', color: '#000' }}>{busy === 'save' ? 'Saving…' : 'Save'}</button>
        <div style={{ flex: 1 }} />
        <input style={{ ...INPUT, width: 'auto', flex: '0 1 240px' }} type="email" value={testTo} onChange={e => setTestTo(e.target.value)} placeholder="Send a test to… (your email)" aria-label="Test email address" />
        <button onClick={test} disabled={!!busy || !data.configured} style={{ ...BTN, background: 'transparent', color: data.configured ? '#00c2ff' : '#555', border: `1px solid ${data.configured ? 'rgba(0,194,255,0.35)' : 'rgba(255,255,255,0.1)'}` }}>
          {busy === 'test' ? 'Sending…' : 'Send Test Email'}
        </button>
      </div>
    </div>
  );
}
