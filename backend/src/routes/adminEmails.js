// Admin › Emails (mounted at /api/admin/emails): reword the emails Streamulus
// sends, preview and test them, and write a custom email to chosen people.
// Sending settings (address, App Password) are at /api/admin/email.
const express = require('express');
const db = require('../database/db');
const { requireAdmin } = require('../middleware/auth');
const mailer = require('../services/mailer');
const templates = require('../services/emailTemplates');
const activity = require('../services/activity');

const router = express.Router();
const MAX_RECIPIENTS = 100;

const context = (req) => ({ site: mailer.siteUrl(req), contact: mailer.settings().support_contact, admin: req.user.username });

function template(req, res) {
  const t = templates.byId(req.params.id);
  if (!t) res.status(404).json({ error: 'No such email' });
  return t;
}

router.get('/templates', requireAdmin, (req, res) => {
  res.json({ templates: templates.list(), configured: mailer.configured(), signature: templates.signatureFor(req.user.id) });
});

// { fields: { subject, heading, message, … } } — only the fields sent change.
router.put('/templates/:id', requireAdmin, (req, res) => {
  const t = template(req, res);
  if (!t) return;
  const { template: saved, error } = templates.save(t.id, req.body?.fields || {}, req.user.username);
  if (error) return res.status(400).json({ error });
  activity.log(req, { category: 'admin', action: 'email_template_changed', detail: `${t.name} email` });
  res.json({ template: saved });
});

router.delete('/templates/:id', requireAdmin, (req, res) => {
  const t = template(req, res);
  if (!t) return;
  const fresh = templates.reset(t.id);
  activity.log(req, { category: 'admin', action: 'email_template_reset', detail: `${t.name} email` });
  res.json({ template: fresh });
});

// Example values, or a real person's for a custom email ({ userId }).
function valuesFor(req, id) {
  const values = templates.sampleValues(id, context(req));
  const userId = Number(req.body?.userId);
  if (userId) {
    const u = db.prepare('SELECT username FROM users WHERE id = ?').get(userId);
    if (u) values.name = u.username;
  }
  return values;
}

// { fields?, userId? } → { subject, html, text } — the editor's unsaved wording, filled with example values.
router.post('/templates/:id/preview', requireAdmin, (req, res) => {
  const t = template(req, res);
  if (!t) return;
  const { error } = templates.clean(t, req.body?.fields || {});
  if (error) return res.status(400).json({ error });
  const email = templates.render(t.id, valuesFor(req, t.id), req.body?.fields || null);
  res.json({ ...email, html: templates.forPreview(email.html) });
});

// { fields?, to? } — sends the (unsaved) wording with example values; defaults to your own email.
router.post('/templates/:id/test', requireAdmin, async (req, res) => {
  const t = template(req, res);
  if (!t) return;
  if (!mailer.configured()) return res.status(400).json({ error: 'Add the App Password in Sending first, then send a test' });
  const s = mailer.settings();
  const to = String(req.body?.to || '').trim() || req.user.email || s.mail_from;
  if (!mailer.validEmail(to)) return res.status(400).json({ error: "That doesn't look like an email address" });
  const { error } = templates.clean(t, req.body?.fields || {});
  if (error) return res.status(400).json({ error });
  const email = templates.render(t.id, valuesFor(req, t.id), req.body?.fields || null);
  try {
    await mailer.send({ to, ...email, subject: `[Test] ${email.subject}`, personal: t.id === 'custom' });
  } catch (err) {
    console.error(`[mail] Test of the ${t.name} email failed: ${err.message}`);
    return res.status(502).json({ error: mailer.explainError(err, s.smtp_host) });
  }
  activity.log(req, { category: 'admin', action: 'email_test', detail: `Sent a test of the ${t.name} email to ${mailer.maskEmail(to)}` });
  res.json({ sent: true, to });
});

// Everyone who can be written to (and who can't, for the picker to explain).
router.get('/recipients', requireAdmin, (req, res) => {
  const users = db.prepare("SELECT id, username, email, role, status FROM users ORDER BY username COLLATE NOCASE").all();
  res.json({ users: users.map(u => ({ id: u.id, username: u.username, email: u.email || null, role: u.role, status: u.status || 'active' })) });
});

// A custom email: { userIds, subject, heading, message, signature }. Each person gets
// their own copy (nobody sees who else it went to), with {{name}} filled in for them.
router.post('/send', requireAdmin, async (req, res) => {
  if (!mailer.configured()) return res.status(400).json({ error: 'Add the App Password in Sending first' });
  const t = templates.byId('custom');
  const ids = [...new Set((Array.isArray(req.body?.userIds) ? req.body.userIds : []).map(Number).filter(Number.isInteger))];
  if (!ids.length) return res.status(400).json({ error: 'Choose who to send it to' });
  if (ids.length > MAX_RECIPIENTS) return res.status(400).json({ error: `Up to ${MAX_RECIPIENTS} people at a time` });
  const input = {};
  for (const key of ['subject', 'heading', 'message', 'signature']) input[key] = String(req.body?.[key] ?? '');
  const { fields, error } = templates.clean(t, input);
  if (error) return res.status(400).json({ error });
  if (!fields.message.trim() || fields.message.trim() === templates.current('custom').message.trim()) {
    return res.status(400).json({ error: 'Write your message first' }); // still just the starting text
  }

  const s = mailer.settings();
  const ctx = context(req);
  const sent = [], failed = [], skipped = [];
  for (const id of ids) {
    const u = db.prepare('SELECT id, username, email FROM users WHERE id = ?').get(id);
    if (!u) { skipped.push({ id, username: null, reason: 'Account not found' }); continue; }
    if (!u.email) { skipped.push({ id, username: u.username, reason: 'No email address' }); continue; }
    const email = templates.render('custom', { ...ctx, name: u.username }, fields);
    try {
      await mailer.send({ to: u.email, ...email, personal: true });
      sent.push({ id: u.id, username: u.username, to: u.email });
      activity.log(req, { category: 'admin', action: 'email_sent', detail: `Emailed ${u.username}: “${email.subject}”` });
    } catch (err) {
      console.error(`[mail] Custom email to ${u.username} failed: ${err.message}`);
      failed.push({ id: u.id, username: u.username, error: mailer.explainError(err, s.smtp_host) });
    }
  }
  templates.rememberSignature(req.user.id, fields.signature); // their signature next time
  res.status(sent.length ? 200 : 502).json({ sent, failed, skipped, ...(sent.length ? {} : { error: failed[0]?.error || skipped[0]?.reason || 'Nothing was sent' }) });
});

module.exports = router;
