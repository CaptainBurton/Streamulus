// Outgoing email (password resets for now), sent through Gmail by default.
// Admin › Settings › Email holds the sender address, its App Password and who
// people should contact for help. The password can also come from the
// SMTP_PASSWORD environment variable instead of being saved in the database.
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const db = require('../database/db');

const DEFAULTS = {
  mail_from: 'streamulus@gmail.com',
  mail_from_name: 'Streamulus',
  smtp_host: 'smtp.gmail.com',
  smtp_port: '465',
  smtp_secure: 'true', // TLS from the start (465); 'false' upgrades with STARTTLS (587)
  smtp_user: '', // empty = the From address (as Gmail wants)
  support_contact: 'Erin',
};

const WORDMARK = path.join(__dirname, '../assets/email/streamulus-wordmark.png');

const getConf = (key) => db.prepare('SELECT value FROM config WHERE key = ?').get(key)?.value;

function settings() {
  const out = {};
  for (const [key, def] of Object.entries(DEFAULTS)) out[key] = (getConf(key) ?? '').trim() || def;
  out.smtp_pass = (process.env.SMTP_PASSWORD || getConf('smtp_pass') || '').replace(/\s+/g, '');
  out.passwordFromEnv = !!process.env.SMTP_PASSWORD;
  return out;
}

function configured() {
  const s = settings();
  return !!(s.mail_from && s.smtp_host && s.smtp_pass);
}

function transport(s = settings()) {
  return nodemailer.createTransport({
    host: s.smtp_host,
    port: parseInt(s.smtp_port, 10) || 465,
    secure: s.smtp_secure === 'true',
    auth: { user: s.smtp_user || s.mail_from, pass: s.smtp_pass },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 30000,
  });
}

// The address people open links at: the public address from Admin › Settings ›
// Remote Access, else the one this request came in on.
function siteUrl(req) {
  const saved = (getConf('public_url') || '').trim().replace(/\/+$/, '');
  if (saved) return saved;
  const host = req?.get?.('host');
  return host ? `${req.protocol}://${host}` : 'http://localhost:8096';
}

const escape = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// The branded frame every email shares: logo, a card with the content, footer.
// Table layout and inline styles, which every email app understands.
function layout({ preheader, heading, bodyHtml, button, afterHtml, footer }) {
  const font = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark light"><meta name="supported-color-schemes" content="dark light">
<title>${escape(heading)}</title></head>
<body style="margin:0;padding:0;background:#0f0f0f;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#0f0f0f;">${escape(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#0f0f0f" style="background:#0f0f0f;">
<tr><td align="center" style="padding:40px 16px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
    <tr><td align="center" style="padding:0 0 28px;">
      <img src="cid:streamulus-wordmark" width="210" height="38" alt="STREAMULUS" style="display:block;border:0;width:210px;height:auto;color:#00c2ff;font:800 24px ${font};">
    </td></tr>
    <tr><td bgcolor="#17171b" style="background:#17171b;border:1px solid #2a2a30;border-radius:16px;overflow:hidden;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr><td height="4" bgcolor="#00c2ff" style="height:4px;line-height:4px;font-size:0;background:#00c2ff;background-image:linear-gradient(90deg,#00c2ff,#7b2fff);">&nbsp;</td></tr>
        <tr><td style="padding:36px 36px 8px;font-family:${font};">
          <h1 style="margin:0 0 16px;font-size:24px;line-height:1.3;font-weight:800;color:#ffffff;">${escape(heading)}</h1>
          <div style="font-size:15px;line-height:1.65;color:#c9c9d1;">${bodyHtml}</div>
        </td></tr>
        ${button ? `<tr><td align="center" style="padding:24px 36px 8px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
            <td align="center" bgcolor="#00c2ff" style="border-radius:10px;background:#00c2ff;background-image:linear-gradient(135deg,#00c2ff,#7b2fff);">
              <a href="${escape(button.url)}" target="_blank" style="display:inline-block;padding:15px 38px;font-family:${font};font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:10px;">${escape(button.label)}</a>
            </td></tr></table>
        </td></tr>` : ''}
        <tr><td style="padding:20px 36px 34px;font-family:${font};font-size:13px;line-height:1.6;color:#8b8b95;">${afterHtml || ''}</td></tr>
      </table>
    </td></tr>
    <tr><td align="center" style="padding:24px 12px 0;font-family:${font};font-size:12px;line-height:1.6;color:#5d5d66;">${footer}</td></tr>
  </table>
</td></tr></table>
</body></html>`;
}

/** The password reset email: { subject, html, text }. */
function resetEmail({ username, url, minutes, site, contact }) {
  const heading = 'Reset your password';
  const html = layout({
    preheader: `Choose a new password for your Streamulus account (${username}). The link works for ${minutes} minutes.`,
    heading,
    bodyHtml: `<p style="margin:0 0 14px;">Hi ${escape(username)},</p>
      <p style="margin:0;">We got a request to reset the password for your Streamulus account <strong style="color:#ffffff;">${escape(username)}</strong>.
      Press the button below to choose a new one.</p>`,
    button: { label: 'Reset Password', url },
    afterHtml: `<p style="margin:0 0 12px;">This link works once, for the next ${minutes} minutes. After you reset your password, you'll be signed out on your other devices.</p>
      <p style="margin:0 0 12px;">If you didn't ask for this, you can ignore this email — your password stays the same. Questions? Ask ${escape(contact)}.</p>
      <p style="margin:0;color:#6b6b75;">Button not working? Copy this link into your browser:<br>
      <a href="${escape(url)}" style="color:#00c2ff;word-break:break-all;">${escape(url)}</a></p>`,
    footer: `Sent by Streamulus · <a href="${escape(site)}" style="color:#5d5d66;">${escape(site.replace(/^https?:\/\//, ''))}</a><br>You're getting this because a password reset was requested for your account.`,
  });
  const text = `Hi ${username},

We got a request to reset the password for your Streamulus account "${username}".
Open this link to choose a new one (it works once, for the next ${minutes} minutes):

${url}

If you didn't ask for this, ignore this email — your password stays the same.
Questions? Ask ${contact}.

— Streamulus (${site})`;
  return { subject: 'Reset your Streamulus password', html, text };
}

/** A short "it works" email for Admin › Settings › Email. */
function testEmail({ site, admin }) {
  const html = layout({
    preheader: 'Your Streamulus server can send email.',
    heading: 'Email is working',
    bodyHtml: `<p style="margin:0;">This is a test from your Streamulus server, sent by ${escape(admin)}. Password reset emails will look like this and come from this address.</p>`,
    afterHtml: '',
    footer: `Sent by Streamulus · <a href="${escape(site)}" style="color:#5d5d66;">${escape(site.replace(/^https?:\/\//, ''))}</a>`,
  });
  return { subject: 'Streamulus email test', html, text: `This is a test from your Streamulus server, sent by ${admin}.\n\n— Streamulus (${site})` };
}

async function send({ to, subject, html, text }) {
  const s = settings();
  if (!s.smtp_pass) throw Object.assign(new Error('Email isn\'t set up yet (Admin › Settings › Email)'), { code: 'EMAIL_NOT_CONFIGURED' });
  const attachments = fs.existsSync(WORDMARK) ? [{ filename: 'streamulus.png', path: WORDMARK, cid: 'streamulus-wordmark' }] : [];
  return transport(s).sendMail({ from: { name: s.mail_from_name, address: s.mail_from }, to, subject, html, text, attachments });
}

// "erin@gmail.com" → "e••••@gmail.com"
function maskEmail(email) {
  const [name, domain] = String(email).split('@');
  if (!domain) return email;
  return `${name.slice(0, 1)}${'•'.repeat(Math.max(2, Math.min(6, name.length - 1)))}@${domain}`;
}

const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(e || '').trim());

module.exports = { DEFAULTS, settings, configured, send, siteUrl, resetEmail, testEmail, maskEmail, validEmail };
