// The emails admins can reword (Admin › Emails). Each template has a few text
// fields — subject, heading, message, button, small print, footer (and a
// signature for custom emails) — with {{placeholders}} filled in when it's sent.
// Changes are kept in email_templates; anything not changed uses the default
// wording below. New emails get added to TEMPLATES and show up in the tab.
//
// Message text: a blank line starts a new paragraph, **text** is bold, and web
// addresses become links.
const fs = require('fs');
const path = require('path');
const db = require('../database/db');
const mailer = require('./mailer');

const FIELDS = {
  subject: { label: 'Subject', max: 200 },
  heading: { label: 'Heading', max: 200 },
  message: { label: 'Message', multiline: true, max: 10000 },
  button: { label: 'Button', max: 60 },
  note: { label: 'Small print', multiline: true, max: 4000 },
  signature: { label: 'Signature', multiline: true, max: 1000 },
  footer: { label: 'Footer', max: 500 },
};

const PLACEHOLDERS = {
  name: 'Their username',
  site: 'Server address',
  contact: 'Who to contact for help',
  admin: 'Admin sending it',
  passphrase: 'The Admin Passphrase',
  minutes: 'Minutes until it runs out',
  link: 'The link the button opens',
};

const TEMPLATES = [
  {
    id: 'passphrase',
    name: 'Admin Passphrase',
    description: 'Sent only when an admin presses Email Passphrase on an account request — never automatically. The passphrase appears in a box under the message.',
    fields: ['subject', 'heading', 'message', 'button', 'note', 'footer'],
    required: ['subject', 'message', 'button'],
    placeholders: ['name', 'passphrase', 'minutes', 'link', 'site', 'contact', 'admin'],
    defaults: {
      subject: 'Your Streamulus Admin Passphrase',
      heading: "You're almost in",
      message: "Hi {{name}},\n\nYour Streamulus account has been approved. Sign in with the username and password you chose, and enter this Admin Passphrase when you're asked for it:",
      button: 'Sign In to Streamulus',
      note: "The passphrase works once, for the next {{minutes}} minutes. If it runs out, ask {{contact}} for a new one.\n\nDidn't ask for a Streamulus account? You can ignore this email.",
      footer: "You're getting this because you asked for an account and {{admin}} approved it.",
    },
  },
  {
    id: 'reset',
    name: 'Password Reset',
    description: 'Sent when someone chooses Forgot password? on the sign-in page. The button opens the page where they choose a new password.',
    fields: ['subject', 'heading', 'message', 'button', 'note', 'footer'],
    required: ['subject', 'message', 'button'],
    placeholders: ['name', 'link', 'minutes', 'site', 'contact'],
    defaults: {
      subject: 'Reset your Streamulus password',
      heading: 'Reset your password',
      message: 'Hi {{name}},\n\nWe got a request to reset the password for your Streamulus account **{{name}}**. Press the button below to choose a new one.',
      button: 'Reset Password',
      note: "This link works once, for the next {{minutes}} minutes. After you reset your password, you'll be signed out on your other devices.\n\nIf you didn't ask for this, you can ignore this email — your password stays the same. Questions? Ask {{contact}}.",
      footer: "You're getting this because a password reset was requested for your account.",
    },
  },
  {
    id: 'custom',
    name: 'Custom Email',
    description: "A blank email you write to someone from Write an Email. The wording here is where each new email starts, and the signature is signed by whoever sends it.",
    fields: ['subject', 'heading', 'message', 'signature', 'footer'],
    required: ['subject', 'message'],
    placeholders: ['name', 'admin', 'site', 'contact'],
    defaults: {
      subject: 'A message from Streamulus',
      heading: '',
      message: 'Hi {{name}},\n\n',
      signature: 'Thanks,\n{{admin}}\nStreamulus',
      footer: "You're getting this because you have an account on Streamulus.",
    },
  },
];

const byId = (id) => TEMPLATES.find(t => t.id === id);

function saved(id) {
  const row = db.prepare('SELECT fields, updated_at, updated_by FROM email_templates WHERE id = ?').get(id);
  if (!row) return { fields: {}, updatedAt: null, updatedBy: null };
  let fields = {};
  try { fields = JSON.parse(row.fields) || {}; } catch {}
  return { fields, updatedAt: row.updated_at, updatedBy: row.updated_by };
}

/** The wording in use: saved changes over the defaults. */
function current(id) {
  const t = byId(id);
  const s = saved(id).fields;
  return Object.fromEntries(t.fields.map(f => [f, typeof s[f] === 'string' ? s[f] : t.defaults[f]]));
}

/** Everything the Emails tab shows for one template. */
function describe(t) {
  const s = saved(t.id);
  return {
    id: t.id,
    name: t.name,
    description: t.description,
    fields: t.fields.map(key => ({ key, ...FIELDS[key], required: t.required.includes(key) })),
    placeholders: t.placeholders.map(key => ({ key, label: PLACEHOLDERS[key] })),
    defaults: t.defaults,
    values: current(t.id),
    customized: Object.keys(s.fields).length > 0,
    updatedAt: s.updatedAt,
    updatedBy: s.updatedBy,
  };
}

const list = () => TEMPLATES.map(describe);

/** Checks wording from the editor: { fields } or { error }. Only known fields, trimmed to size. */
function clean(t, input = {}) {
  const fields = {};
  for (const key of t.fields) {
    if (input[key] === undefined) continue;
    const value = String(input[key] ?? '').replace(/\r\n?/g, '\n');
    if (value.length > FIELDS[key].max) return { error: `${FIELDS[key].label} is too long (${FIELDS[key].max} characters at most)` };
    if (t.required.includes(key) && !value.trim()) return { error: `${FIELDS[key].label} can't be empty` };
    fields[key] = FIELDS[key].multiline ? value : value.replace(/\n+/g, ' ');
  }
  return { fields };
}

/** Saves wording; anything matching the default isn't stored, so later default improvements still apply. */
function save(id, input, adminName) {
  const t = byId(id);
  const { fields, error } = clean(t, input);
  if (error) return { error };
  const merged = { ...saved(id).fields, ...fields };
  const changed = Object.fromEntries(Object.entries(merged).filter(([k, v]) => t.fields.includes(k) && v !== t.defaults[k]));
  if (!Object.keys(changed).length) db.prepare('DELETE FROM email_templates WHERE id = ?').run(id);
  else db.prepare('INSERT OR REPLACE INTO email_templates (id, fields, updated_at, updated_by) VALUES (?, ?, ?, ?)').run(id, JSON.stringify(changed), Date.now(), adminName || null);
  return { template: describe(t) };
}

function reset(id) {
  db.prepare('DELETE FROM email_templates WHERE id = ?').run(id);
  return describe(byId(id));
}

// ── Rendering ────────────────────────────────────────────────────────────────

const escape = mailer.escape;

function fill(text, values) {
  return String(text || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (all, key) => (values[key] !== undefined && values[key] !== null ? String(values[key]) : all));
}

const URL_RE = /(https?:\/\/[^\s<>"']*[^\s<>"'.,;:!?)])/g;

// Plain text → paragraphs for the email: placeholders filled, then escaped, with **bold** and links.
function toHtml(text, values, { color = '#c9c9d1', strong = '#ffffff', link = '#00c2ff' } = {}) {
  const paragraphs = fill(text, values).replace(/\r\n?/g, '\n').split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  return paragraphs.map((p, i) => {
    const html = p.split(URL_RE).map((part, j) => (j % 2
      ? `<a href="${escape(part)}" style="color:${link};word-break:break-all;">${escape(part)}</a>`
      : escape(part).replace(/\*\*(.+?)\*\*/g, `<strong style="color:${strong};">$1</strong>`))).join('').replace(/\n/g, '<br>');
    return `<p style="margin:0 0 ${i === paragraphs.length - 1 ? 0 : 14}px;color:${color};">${html}</p>`;
  }).join('\n');
}

const toText = (text, values) => fill(text, values).replace(/\*\*(.+?)\*\*/g, '$1').trim();

/**
 * Builds a template's email: { subject, html, text }.
 * values: what the placeholders become. fields: wording to use instead of the saved
 * wording (the editor's unsaved changes, or what an admin wrote for a custom email).
 */
function render(id, values = {}, fields = null) {
  const t = byId(id);
  if (!t) throw new Error(`Unknown email template: ${id}`);
  const words = { ...current(id), ...(fields ? clean(t, fields).fields || {} : {}) };
  const site = values.site || '';
  const v = { ...values };

  const message = toHtml(words.message, v);
  const signature = words.signature?.trim()
    ? `<div style="margin-top:22px;padding-top:16px;border-top:1px solid #2a2a30;">${toHtml(words.signature, v, { color: '#e6e6ec' })}</div>`
    : '';
  const passphraseBox = id === 'passphrase' ? `<div style="margin:22px 0 4px;padding:18px 16px;border:1px dashed #2f6f86;border-radius:12px;background:#10161c;text-align:center;">
      <div style="font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#00c2ff;margin-bottom:8px;">Admin Passphrase</div>
      <div style="font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:22px;font-weight:700;color:#ffffff;letter-spacing:0.5px;word-break:break-all;">${escape(v.passphrase)}</div>
    </div>` : '';
  const hasButton = t.fields.includes('button') && v.link;
  const fallbackLink = hasButton
    ? `<p style="margin:${words.note?.trim() ? 12 : 0}px 0 0;color:#6b6b75;">Button not working? Copy this link into your browser:<br>
      <a href="${escape(v.link)}" style="color:#00c2ff;word-break:break-all;">${escape(v.link)}</a></p>`
    : '';
  const footerLine = words.footer?.trim() ? `<br>${escape(fill(words.footer, v))}` : '';
  const siteLink = site ? ` · <a href="${escape(site)}" style="color:#5d5d66;">${escape(site.replace(/^https?:\/\//, ''))}</a>` : '';

  const subject = fill(words.subject, v).replace(/\s+/g, ' ').trim();
  const heading = fill(words.heading, v).trim();
  const html = mailer.layout({
    title: heading || subject,
    heading,
    bodyHtml: message + passphraseBox + signature,
    button: hasButton ? { label: fill(words.button, v), url: v.link } : null,
    afterHtml: (words.note?.trim() ? toHtml(words.note, v, { color: '#8b8b95' }) : '') + fallbackLink,
    footer: `Sent by Streamulus${siteLink}${footerLine}`,
  });

  const text = [
    heading,
    toText(words.message, v),
    id === 'passphrase' ? `Admin Passphrase: ${v.passphrase}` : '',
    hasButton ? `${fill(words.button, v)}: ${v.link}` : '',
    toText(words.note, v),
    toText(words.signature, v),
    `— Streamulus${site ? ` (${site})` : ''}`,
  ].filter(Boolean).join('\n\n');

  return { subject, html, text };
}

// Example values for previews and test sends.
function sampleValues(id, { site, contact, admin }) {
  const base = { name: admin || 'Alex', site, contact, admin: admin || 'Admin', minutes: 60 };
  if (id === 'passphrase') return { ...base, passphrase: 'maple-otter-river-comet', link: `${site}/` };
  if (id === 'reset') return { ...base, link: `${site}/reset-password?token=example-only` };
  return base;
}

// The logo is attached to real emails (cid:); previews in the browser get it inline.
const WORDMARK = path.join(__dirname, '../assets/email/streamulus-wordmark.png');
let wordmarkData = null;
function forPreview(html) {
  if (wordmarkData === null) {
    wordmarkData = fs.existsSync(WORDMARK) ? `data:image/png;base64,${fs.readFileSync(WORDMARK).toString('base64')}` : '';
  }
  return html.replace(/cid:streamulus-wordmark/g, wordmarkData);
}

// Each admin's own signature for custom emails, remembered from the last one they sent.
const signatureKey = (userId) => `email_signature_${userId}`;
function signatureFor(userId) {
  return db.prepare('SELECT value FROM config WHERE key = ?').get(signatureKey(userId))?.value ?? null;
}
function rememberSignature(userId, signature) {
  db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run(signatureKey(userId), String(signature ?? ''));
}

module.exports = {
  TEMPLATES, FIELDS, byId, list, describe, current, clean, save, reset, render, sampleValues, forPreview,
  signatureFor, rememberSignature,
};
