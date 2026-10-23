// Admin › Emails › Sending (mounted at /api/admin/email): the address Streamulus
// sends from, its App Password, who people should contact for help, and a test send.
const express = require('express');
const db = require('../database/db');
const { requireAdmin } = require('../middleware/auth');
const mailer = require('../services/mailer');
const activity = require('../services/activity');

const router = express.Router();
const setConf = (key, value) => db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run(key, value);

function state() {
  const s = mailer.settings();
  return {
    fromAddress: s.mail_from,
    fromName: s.mail_from_name,
    host: s.smtp_host,
    port: Number(s.smtp_port) || 465,
    secure: s.smtp_secure === 'true',
    username: s.smtp_user, // empty = the From address
    passwordSet: !!s.smtp_pass,
    passwordFromEnv: s.passwordFromEnv,
    supportContact: s.support_contact,
    configured: mailer.configured(),
    defaults: { fromAddress: mailer.DEFAULTS.mail_from, host: mailer.DEFAULTS.smtp_host, port: Number(mailer.DEFAULTS.smtp_port) },
  };
}

router.get('/', requireAdmin, (req, res) => res.json(state()));

// Any of { fromAddress, fromName, host, port, secure, username, password, clearPassword, supportContact }.
router.put('/', requireAdmin, (req, res) => {
  const b = req.body || {};
  const changed = [];
  if (b.fromAddress !== undefined) {
    const v = String(b.fromAddress || '').trim();
    if (v && !mailer.validEmail(v)) return res.status(400).json({ error: "The sender address doesn't look like an email address" });
    setConf('mail_from', v); changed.push('sender address');
  }
  if (b.fromName !== undefined) { setConf('mail_from_name', String(b.fromName || '').trim().slice(0, 80)); changed.push('sender name'); }
  if (b.host !== undefined) { setConf('smtp_host', String(b.host || '').trim().slice(0, 200)); changed.push('server'); }
  if (b.port !== undefined) {
    const port = parseInt(b.port, 10);
    if (b.port !== '' && b.port !== null && !(port > 0 && port < 65536)) return res.status(400).json({ error: 'Port must be 1–65535' });
    setConf('smtp_port', b.port === '' || b.port === null ? '' : String(port)); changed.push('port');
  }
  if (b.secure !== undefined) { setConf('smtp_secure', b.secure ? 'true' : 'false'); changed.push('security'); }
  if (b.username !== undefined) { setConf('smtp_user', String(b.username || '').trim().slice(0, 200)); changed.push('sign-in name'); }
  if (b.supportContact !== undefined) { setConf('support_contact', String(b.supportContact || '').trim().slice(0, 60)); changed.push('contact name'); }
  if (b.clearPassword) {
    db.prepare("DELETE FROM config WHERE key = 'smtp_pass'").run(); changed.push('App Password removed');
  } else if (typeof b.password === 'string' && b.password.trim()) {
    setConf('smtp_pass', b.password.replace(/\s+/g, '')); changed.push('App Password');
  }
  if (changed.length) activity.log(req, { category: 'admin', action: 'settings_changed', detail: `Email settings: ${changed.join(', ')}` });
  res.json(state());
});

// { to? } — defaults to your own email address, else the sender address.
router.post('/test', requireAdmin, async (req, res) => {
  const s = mailer.settings();
  if (!mailer.configured()) return res.status(400).json({ error: 'Add the App Password first, then send a test' });
  const to = String(req.body?.to || '').trim() || req.user.email || s.mail_from;
  if (!mailer.validEmail(to)) return res.status(400).json({ error: "That doesn't look like an email address" });
  try {
    await mailer.send({ to, ...mailer.testEmail({ site: mailer.siteUrl(req), admin: req.user.username }) });
    activity.log(req, { category: 'admin', action: 'email_test', detail: `Sent a test email to ${mailer.maskEmail(to)}` });
    res.json({ sent: true, to });
  } catch (err) {
    console.error(`[mail] Test email failed: ${err.message}`);
    res.status(502).json({ error: mailer.explainError(err, s.smtp_host) });
  }
});

module.exports = router;
