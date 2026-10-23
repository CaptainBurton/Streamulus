import React, { useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import EmailSettings from './EmailSettings';
import MailIcon from './MailIcon';

// Admin › Emails: write an email to people (signed by whoever sends it), reword
// the emails Streamulus sends — with a live preview and test sends — and the
// sending settings. Templates come from the server (services/emailTemplates.js),
// so new emails show up here by themselves.

const CARD = { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', padding: '24px' };
const INPUT = { width: '100%', padding: '10px 14px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#fff', fontSize: '14px', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' };
const LABEL = { fontSize: '13px', color: '#888', display: 'block', marginBottom: '6px', fontWeight: 600 };
const HINT = { fontSize: '12px', color: '#5f5f68', marginTop: '5px', lineHeight: 1.5 };
const BTN = { padding: '9px 16px', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', background: 'transparent', border: '1px solid rgba(255,255,255,0.15)', color: '#ccc', whiteSpace: 'nowrap' };
const PRIMARY = { ...BTN, background: '#00c2ff', border: '1px solid #00c2ff', color: '#000', fontWeight: 700 };
const CHIP = { padding: '4px 10px', borderRadius: '999px', fontSize: '12px', fontWeight: 600, cursor: 'pointer', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', background: 'rgba(0,194,255,0.08)', border: '1px solid rgba(0,194,255,0.25)', color: '#7fdcff' };
const TAG = (color) => ({ padding: '2px 8px', borderRadius: '20px', fontSize: '10px', fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase', color, border: `1px solid ${color}55`, whiteSpace: 'nowrap' });

const when = (ms) => (ms ? new Date(ms).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '');

const FIELD_HINTS = {
  heading: 'The big line at the top. Leave it empty for no heading.',
  message: 'A blank line starts a new paragraph · **text** is bold · web addresses become links.',
  button: 'The button opens {{link}}.',
  note: 'Smaller text under the button.',
  signature: 'Under the message, after a line. {{admin}} is whoever sends it.',
  footer: 'The last line, under “Sent by Streamulus”.',
};

export default function EmailsAdmin({ flash, composeTo, onComposeUsed }) {
  const [data, setData] = useState(null); // { templates, configured, signature }
  const [editing, setEditing] = useState(null);

  const load = () => axios.get('/api/admin/emails/templates').then(r => setData(r.data)).catch(() => flash("Couldn't load the emails", true));
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!data) return <div className="spinner" style={{ margin: '40px auto' }} />;
  const custom = data.templates.find(t => t.id === 'custom');
  const replace = (t) => setData(d => ({ ...d, templates: d.templates.map(x => (x.id === t.id ? t : x)) }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', maxWidth: '1180px' }} data-section="emails">
      {!data.configured && (
        <div style={{ padding: '14px 18px', borderRadius: '10px', background: 'rgba(255,183,3,0.08)', border: '1px solid rgba(255,183,3,0.3)', color: '#ffd166', fontSize: '14px', lineHeight: 1.6 }}>
          Email isn't set up yet — add the App Password under <strong>Sending</strong> at the bottom of this page. Until then nothing can be sent, but you can still reword the emails.
        </div>
      )}

      {custom && (
        <Composer template={custom} signature={data.signature} configured={data.configured} flash={flash}
          composeTo={composeTo} onComposeUsed={onComposeUsed} onSent={load} />
      )}

      <div style={CARD} data-section="templates">
        <h3 style={{ fontSize: '16px', fontWeight: 700, margin: '0 0 6px' }}>Email Templates</h3>
        <p style={{ color: '#777', fontSize: '14px', margin: '0 0 18px', lineHeight: 1.6 }}>
          The wording of each email Streamulus sends. Change it here — the logo, colours and layout stay the same.
          Words in <code style={{ color: '#7fdcff' }}>{'{{curly brackets}}'}</code> are filled in when the email is sent.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {data.templates.map(t => (
            <div key={t.id} data-template={t.id} style={{ border: '1px solid rgba(255,255,255,0.07)', borderRadius: '10px', background: editing === t.id ? 'rgba(0,194,255,0.03)' : 'rgba(255,255,255,0.02)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '14px 16px', flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 300px', minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 700, fontSize: '15px', color: '#fff' }}>{t.name}</span>
                    {t.customized
                      ? <span style={TAG('#00c2ff')} title={t.updatedAt ? `Changed ${when(t.updatedAt)}${t.updatedBy ? ` by ${t.updatedBy}` : ''}` : ''}>Your wording</span>
                      : <span style={TAG('#777')}>Default</span>}
                  </div>
                  <div style={{ fontSize: '13px', color: '#777', marginTop: '4px', lineHeight: 1.5 }}>{t.description}</div>
                  {t.customized && t.updatedAt && (
                    <div style={{ fontSize: '12px', color: '#555', marginTop: '4px' }}>Changed {when(t.updatedAt)}{t.updatedBy ? ` by ${t.updatedBy}` : ''}</div>
                  )}
                </div>
                <button style={editing === t.id ? BTN : PRIMARY} onClick={() => setEditing(e => (e === t.id ? null : t.id))}>
                  {editing === t.id ? 'Close' : 'Edit'}
                </button>
              </div>
              {editing === t.id && (
                <TemplateEditor key={t.id} template={t} configured={data.configured} flash={flash}
                  onSaved={replace} onClose={() => setEditing(null)} />
              )}
            </div>
          ))}
        </div>
      </div>

      <EmailSettings flash={flash} onChanged={(s) => setData(d => ({ ...d, configured: s.configured }))} />
    </div>
  );
}

// ── Write an email ───────────────────────────────────────────────────────────

const startFrom = (template, signature) => ({
  subject: template.values.subject,
  heading: template.values.heading,
  message: template.values.message,
  signature: signature ?? template.values.signature,
});

function Composer({ template, signature, configured, flash, composeTo, onComposeUsed, onSent }) {
  const [open, setOpen] = useState(false);
  const [people, setPeople] = useState(null);
  const [to, setTo] = useState([]);
  const [fields, setFields] = useState(() => startFrom(template, signature));
  const [search, setSearch] = useState('');
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState('');
  const [result, setResult] = useState(null);
  const cardRef = useRef(null);

  useEffect(() => {
    if (!open || people) return;
    axios.get('/api/admin/emails/recipients').then(r => setPeople(r.data.users)).catch(() => flash("Couldn't load the accounts", true));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // "Email this person" from Admin › Users.
  useEffect(() => {
    if (!composeTo?.length) return;
    setOpen(true);
    setTo(composeTo);
    setResult(null);
    onComposeUsed?.();
    setTimeout(() => cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  }, [composeTo]); // eslint-disable-line react-hooks/exhaustive-deps

  const byId = useMemo(() => Object.fromEntries((people || []).map(p => [p.id, p])), [people]);
  const reachable = (people || []).filter(p => p.email && p.status !== 'disabled');
  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (people || [])
      .filter(p => !to.includes(p.id))
      .filter(p => !q || p.username.toLowerCase().includes(q) || (p.email || '').toLowerCase().includes(q))
      .slice(0, 8);
  }, [people, to, search]);

  const add = (id) => { setTo(t => (t.includes(id) ? t : [...t, id])); setSearch(''); };
  const remove = (id) => setTo(t => t.filter(x => x !== id));
  const set = (key, value) => setFields(f => ({ ...f, [key]: value }));

  const send = async () => {
    if (!to.length) return flash('Choose who to send it to', true);
    if (!window.confirm(`Send this email to ${to.length === 1 ? (byId[to[0]]?.username || '1 person') : `${to.length} people`}?`)) return;
    setBusy('send');
    try {
      const r = await axios.post('/api/admin/emails/send', { userIds: to, ...fields });
      setResult(r.data);
      flash(`Sent to ${r.data.sent.length} ${r.data.sent.length === 1 ? 'person' : 'people'}${r.data.failed.length ? ` — ${r.data.failed.length} failed` : ''}`, r.data.failed.length > 0);
      if (r.data.failed.length) setTo(r.data.failed.map(f => f.id)); // try those again
      else { setTo([]); setFields(startFrom(template, fields.signature)); }
      onSent?.();
    } catch (err) {
      setResult(err.response?.data?.sent ? err.response.data : null);
      flash(err.response?.data?.error || "Couldn't send the email", true);
    }
    setBusy('');
  };

  const test = async () => {
    setBusy('test');
    try {
      const r = await axios.post('/api/admin/emails/templates/custom/test', { fields, userId: to[0] });
      flash(`Test sent to ${r.data.to}`);
    } catch (err) {
      flash(err.response?.data?.error || "Couldn't send the test", true);
    }
    setBusy('');
  };

  const composerFields = template.fields.filter(f => f.key !== 'footer');

  return (
    <div style={{ ...CARD, border: '1px solid rgba(0,194,255,0.2)', background: 'rgba(0,194,255,0.04)' }} ref={cardRef} data-section="compose">
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 300px' }}>
          <h3 style={{ fontSize: '16px', fontWeight: 700, margin: '0 0 4px' }}>Write an Email</h3>
          <p style={{ color: '#777', fontSize: '14px', margin: 0, lineHeight: 1.6 }}>
            Send a personal email to one or more people. Each gets their own copy, with {'{{name}}'} filled in for them, signed by you.
          </p>
        </div>
        <button style={{ ...(open ? BTN : PRIMARY), display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '10px 18px', fontSize: '14px' }}
          onClick={() => setOpen(o => !o)} data-action="compose">
          {open ? 'Close' : <><MailIcon /> Write an Email</>}
        </button>
      </div>

      {open && (
        <div style={{ marginTop: '20px' }}>
          {/* To */}
          <label style={LABEL}>To</label>
          <div style={{ ...INPUT, display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center', padding: '7px 8px', position: 'relative' }}>
            {to.map(id => {
              const p = byId[id];
              return (
                <span key={id} data-recipient={p?.username} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '4px 6px 4px 10px', borderRadius: '999px', background: 'rgba(0,194,255,0.15)', color: '#cfefff', fontSize: '13px' }}>
                  {p ? p.username : '…'}{p && !p.email && <span style={{ color: '#ff8080', fontSize: '11px' }}>no email</span>}
                  <button onClick={() => remove(id)} aria-label={`Remove ${p?.username || ''}`} style={{ background: 'none', border: 'none', color: '#9fc9d9', cursor: 'pointer', fontSize: '15px', lineHeight: 1, padding: '0 4px' }}>×</button>
                </span>
              );
            })}
            <input value={search} onChange={e => { setSearch(e.target.value); setPicking(true); }} onFocus={() => setPicking(true)} onBlur={() => setTimeout(() => setPicking(false), 150)}
              placeholder={to.length ? 'Add someone…' : 'Search by name or email…'} aria-label="Add a recipient"
              style={{ flex: '1 1 160px', minWidth: '120px', background: 'transparent', border: 'none', outline: 'none', color: '#fff', fontSize: '14px', fontFamily: 'inherit', padding: '4px' }} />
            {picking && people && matches.length > 0 && (
              <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 20, background: '#1b1b21', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '10px', boxShadow: '0 12px 30px rgba(0,0,0,0.5)', overflow: 'hidden' }}>
                {matches.map(p => (
                  <button key={p.id} disabled={!p.email} onMouseDown={e => e.preventDefault()} onClick={() => add(p.id)} data-pick={p.username}
                    style={{ display: 'flex', width: '100%', alignItems: 'center', gap: '10px', padding: '10px 14px', background: 'transparent', border: 'none', borderBottom: '1px solid rgba(255,255,255,0.04)', color: p.email ? '#ddd' : '#555', cursor: p.email ? 'pointer' : 'not-allowed', fontSize: '14px', textAlign: 'left', fontFamily: 'inherit' }}>
                    <span style={{ fontWeight: 600 }}>{p.username}</span>
                    <span style={{ flex: 1, color: '#777', fontSize: '12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.email || 'No email address'}</span>
                    {p.status !== 'active' && <span style={TAG(p.status === 'pending' ? '#ffb703' : '#ff6b6b')}>{p.status === 'pending' ? 'Request' : p.status}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: '10px', marginTop: '8px', flexWrap: 'wrap' }}>
            <button style={{ ...BTN, padding: '5px 12px', fontSize: '12px' }} disabled={!reachable.length}
              onClick={() => setTo(reachable.map(p => p.id))}>Everyone with an email ({reachable.length})</button>
            {to.length > 0 && <button style={{ ...BTN, padding: '5px 12px', fontSize: '12px' }} onClick={() => setTo([])}>Clear</button>}
          </div>

          <div className="email-editor-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(340px, 100%), 1fr))', gap: '24px', marginTop: '20px', alignItems: 'start' }}>
            <Fields fields={composerFields} placeholders={template.placeholders} values={fields} onChange={set} />
            <Preview templateId="custom" fields={fields} userId={to[0]} />
          </div>

          {result && (
            <div style={{ marginTop: '16px', padding: '12px 16px', borderRadius: '10px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', fontSize: '13px', lineHeight: 1.7 }} data-result>
              {result.sent.length > 0 && <div style={{ color: '#00c864' }}>✓ Sent to {result.sent.map(s => s.username).join(', ')}</div>}
              {result.failed.map(f => <div key={f.id} style={{ color: '#ff8080' }}>✗ {f.username}: {f.error}</div>)}
              {result.skipped.map(s => <div key={s.id} style={{ color: '#ffb703' }}>– {s.username || 'Unknown account'}: {s.reason}</div>)}
            </div>
          )}

          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center', marginTop: '20px', paddingTop: '16px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
            <button style={PRIMARY} disabled={!!busy || !configured || !to.length} onClick={send} data-action="send">
              {busy === 'send' ? 'Sending…' : `Send${to.length ? ` to ${to.length === 1 ? (byId[to[0]]?.username || '1 person') : `${to.length} people`}` : ''}`}
            </button>
            <button style={BTN} disabled={!!busy || !configured} onClick={test}>{busy === 'test' ? 'Sending…' : 'Send Me a Test'}</button>
            <span style={{ fontSize: '12px', color: '#666' }}>The test goes to your own email address.</span>
            <div style={{ flex: 1 }} />
            <button style={{ ...BTN, color: '#888' }} disabled={!!busy} onClick={() => setFields(startFrom(template, fields.signature))}>Start Over</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Edit a template ──────────────────────────────────────────────────────────

function TemplateEditor({ template, configured, flash, onSaved, onClose }) {
  const [values, setValues] = useState(template.values);
  const [testTo, setTestTo] = useState('');
  const [busy, setBusy] = useState('');
  const [confirmReset, setConfirmReset] = useState(false);
  const dirty = template.fields.some(f => values[f.key] !== template.values[f.key]);
  const isDefault = template.fields.every(f => values[f.key] === template.defaults[f.key]);

  const run = async (name, fn) => {
    setBusy(name);
    try { await fn(); } catch (err) { flash(err.response?.data?.error || 'Something went wrong', true); }
    setBusy('');
  };
  const save = () => run('save', async () => {
    const r = await axios.put(`/api/admin/emails/templates/${template.id}`, { fields: values });
    onSaved(r.data.template);
    setValues(r.data.template.values);
    flash(`Saved — the ${template.name} email uses this wording now`);
  });
  const reset = () => {
    if (!confirmReset) { setConfirmReset(true); setTimeout(() => setConfirmReset(false), 4000); return; }
    setConfirmReset(false);
    run('reset', async () => {
      const r = await axios.delete(`/api/admin/emails/templates/${template.id}`);
      onSaved(r.data.template);
      setValues(r.data.template.values);
      flash(`The ${template.name} email is back to the default wording`);
    });
  };
  const test = () => run('test', async () => {
    const r = await axios.post(`/api/admin/emails/templates/${template.id}/test`, { fields: values, to: testTo.trim() || undefined });
    flash(`Test sent to ${r.data.to}${dirty ? ' (with your unsaved changes)' : ''}`);
  });

  return (
    <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', padding: '18px 16px 18px' }} data-editor={template.id}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(340px, 100%), 1fr))', gap: '24px', alignItems: 'start' }}>
        <Fields fields={template.fields} placeholders={template.placeholders} values={values} onChange={(k, v) => setValues(x => ({ ...x, [k]: v }))} />
        <Preview templateId={template.id} fields={values} />
      </div>
      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center', marginTop: '20px', paddingTop: '16px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        <button style={PRIMARY} disabled={!!busy || !dirty} onClick={save} data-action="save-template">{busy === 'save' ? 'Saving…' : 'Save'}</button>
        <button style={BTN} disabled={!!busy || !dirty} onClick={() => setValues(template.values)}>Undo Changes</button>
        <button style={{ ...BTN, color: confirmReset ? '#fff' : '#ff8080', background: confirmReset ? '#ff4444' : 'transparent', border: `1px solid ${confirmReset ? '#ff4444' : 'rgba(255,77,77,0.35)'}` }}
          disabled={!!busy || (isDefault && !template.customized)} onClick={reset} data-action="reset-template">
          {confirmReset ? 'Click again to reset' : 'Reset to Default'}
        </button>
        <div style={{ flex: 1 }} />
        <input style={{ ...INPUT, width: 'auto', flex: '0 1 240px' }} type="email" value={testTo} onChange={e => setTestTo(e.target.value)} placeholder="Send a test to… (your email)" aria-label="Test email address" />
        <button style={BTN} disabled={!!busy || !configured} onClick={test} data-action="test-template">{busy === 'test' ? 'Sending…' : 'Send Test Email'}</button>
        <button style={{ ...BTN, border: 'none', color: '#777' }} onClick={onClose}>Close</button>
      </div>
      {dirty && <div style={{ ...HINT, color: '#ffb703' }}>You have unsaved changes — the preview and test email use them; real emails won't until you save.</div>}
    </div>
  );
}

// ── Shared pieces ────────────────────────────────────────────────────────────

// The text fields, with placeholder chips that drop {{name}} etc. where the cursor is.
function Fields({ fields, placeholders, values, onChange }) {
  const refs = useRef({});
  const [focus, setFocus] = useState(fields.find(f => f.key === 'message')?.key || fields[0]?.key);

  const insert = (key) => {
    const el = refs.current[focus];
    const token = `{{${key}}}`;
    const value = values[focus] ?? '';
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? start;
    onChange(focus, value.slice(0, start) + token + value.slice(end));
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', minWidth: 0 }}>
      {placeholders?.length > 0 && (
        <div>
          <div style={{ ...LABEL, marginBottom: '8px' }}>Insert into {fields.find(f => f.key === focus)?.label.toLowerCase() || 'the message'}</div>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {placeholders.map(p => (
              <button key={p.key} type="button" title={p.label} style={CHIP} onMouseDown={e => e.preventDefault()} onClick={() => insert(p.key)} data-placeholder={p.key}>
                {`{{${p.key}}}`}
              </button>
            ))}
          </div>
          <div style={HINT}>{placeholders.map(p => `{{${p.key}}} ${p.label.toLowerCase()}`).join(' · ')}</div>
        </div>
      )}
      {fields.map(f => {
        const common = {
          ref: el => { refs.current[f.key] = el; },
          id: `email-field-${f.key}`,
          value: values[f.key] ?? '',
          onChange: e => onChange(f.key, e.target.value),
          onFocus: () => setFocus(f.key),
          maxLength: f.max,
          style: { ...INPUT, ...(f.multiline ? { resize: 'vertical', lineHeight: 1.55 } : {}), ...(focus === f.key ? { border: '1px solid rgba(0,194,255,0.45)' } : {}) },
        };
        return (
          <div key={f.key}>
            <label style={LABEL} htmlFor={common.id}>{f.label}{!f.required && <span style={{ color: '#555', fontWeight: 500 }}> · optional</span>}</label>
            {f.multiline
              ? <textarea {...common} rows={f.key === 'message' ? 9 : f.key === 'note' ? 4 : 3} />
              : <input {...common} />}
            {FIELD_HINTS[f.key] && <div style={HINT}>{FIELD_HINTS[f.key]}</div>}
          </div>
        );
      })}
    </div>
  );
}

// What the email will look like (with example values), updated as you type.
function Preview({ templateId, fields, userId }) {
  const [email, setEmail] = useState(null);
  const [error, setError] = useState('');
  const [phone, setPhone] = useState(false);
  const [height, setHeight] = useState(560);
  const latest = useRef(0);
  const frame = useRef(null);
  const key = JSON.stringify(fields) + (userId || '');

  useEffect(() => {
    const ask = ++latest.current;
    const t = setTimeout(() => {
      axios.post(`/api/admin/emails/templates/${templateId}/preview`, { fields, userId })
        .then(r => { if (ask === latest.current) { setEmail(r.data); setError(''); } })
        .catch(err => { if (ask === latest.current) setError(err.response?.data?.error || "Couldn't show a preview"); });
    }, 300);
    return () => clearTimeout(t);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const fit = () => {
    try {
      const doc = frame.current?.contentDocument;
      if (doc) setHeight(Math.max(320, doc.documentElement.scrollHeight));
    } catch {}
  };
  useEffect(() => { fit(); }, [phone]);

  return (
    <div style={{ minWidth: 0, position: 'sticky', top: '80px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
        <span style={{ ...LABEL, margin: 0, flex: 1 }}>Preview</span>
        {[['Desktop', false], ['Phone', true]].map(([label, value]) => (
          <button key={label} onClick={() => setPhone(value)}
            style={{ ...BTN, padding: '4px 10px', fontSize: '12px', ...(phone === value ? { background: 'rgba(255,255,255,0.1)', color: '#fff', border: '1px solid rgba(255,255,255,0.25)' } : {}) }}>{label}</button>
        ))}
      </div>
      <div style={{ borderRadius: '10px', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.1)', background: '#0f0f0f' }}>
        <div style={{ padding: '10px 14px', background: '#1a1a1f', borderBottom: '1px solid rgba(255,255,255,0.06)', fontSize: '13px' }}>
          <span style={{ color: '#666' }}>Subject: </span>
          <span style={{ color: '#fff', fontWeight: 600 }} data-preview-subject>{email?.subject || ' '}</span>
        </div>
        {error && <div style={{ padding: '12px 14px', color: '#ff8080', fontSize: '13px' }}>{error}</div>}
        <div style={{ display: 'flex', justifyContent: 'center', background: '#0f0f0f' }}>
          {email ? (
            <iframe ref={frame} title="Email preview" srcDoc={email.html} onLoad={fit} sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
              style={{ width: phone ? '375px' : '100%', maxWidth: '100%', height: `${height}px`, border: 'none', display: 'block', background: '#0f0f0f' }} />
          ) : <div className="spinner" style={{ margin: '60px auto' }} />}
        </div>
      </div>
      <div style={HINT}>Shown with example details{templateId === 'custom' && userId ? '' : ' (your name in place of theirs)'}. The logo shows in real emails too.</div>
    </div>
  );
}
