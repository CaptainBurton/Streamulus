import React, { useEffect, useState } from 'react';
import axios from 'axios';
import Select from './Select';

// Admin › Libraries › Automatic Scanning: find new and removed files by itself
// (like Plex's "Scan my library automatically"), and optionally scan everything
// every few hours for changes the watcher can't see.
const CARD = { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', padding: '24px', marginBottom: '20px' };

const ago = (ms) => {
  if (!ms) return '';
  const m = Math.round((Date.now() - ms) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
};

export default function AutoScanSettings({ flash }) {
  const [s, setS] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = () => axios.get('/api/admin/library/auto-scan').then(r => setS(r.data)).catch(() => {});
  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, []);
  if (!s) return null;

  const save = async (change) => {
    setBusy(true);
    try {
      const r = await axios.put('/api/admin/library/auto-scan', change);
      setS(r.data);
      flash(change.enabled === false ? 'Automatic scanning is off — use Scan to pick up changes'
        : change.enabled ? 'Automatic scanning is on' : 'Saved');
      setTimeout(load, 1500); // watchers start in the background
    } catch (err) { flash(err.response?.data?.error || "Couldn't save", true); }
    setBusy(false);
  };

  return (
    <div style={CARD} data-section="auto-scan">
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 320px' }}>
          <h3 style={{ fontSize: '16px', fontWeight: 700, margin: '0 0 4px' }}>Automatic Scanning</h3>
          <p style={{ color: '#777', fontSize: '14px', margin: 0, lineHeight: 1.6 }}>
            Notice new, changed and removed files by itself and add them within a minute — no need to press Scan.
            Only the folders that changed are scanned.
          </p>
        </div>
        <button role="switch" aria-checked={s.enabled} aria-label="Automatic scanning" disabled={busy} onClick={() => save({ enabled: !s.enabled })} data-action="toggle-auto-scan"
          style={{ width: '52px', height: '30px', borderRadius: '15px', border: 'none', cursor: 'pointer', position: 'relative', flexShrink: 0, background: s.enabled ? '#00c2ff' : 'rgba(255,255,255,0.15)', transition: 'background 0.2s' }}>
          <span style={{ position: 'absolute', top: '3px', left: s.enabled ? '25px' : '3px', width: '24px', height: '24px', borderRadius: '50%', background: '#fff', transition: 'left 0.2s' }} />
        </button>
      </div>

      <div style={{ fontSize: '13px', color: s.enabled ? '#9fc9d9' : '#777', marginTop: '14px' }} data-status>
        {s.enabled
          ? `Watching ${s.watching.toLocaleString()} folder${s.watching === 1 ? '' : 's'}${s.pending ? ` · ${s.pending} change${s.pending === 1 ? '' : 's'} about to be scanned` : ''}`
          : 'Off — new files appear after you press Scan.'}
        {s.enabled && s.lastRun && ` · last found ${s.lastRun.added} new, ${s.lastRun.removed} removed in ${s.lastRun.library} ${ago(s.lastRun.at)}`}
      </div>
      {s.error && <div style={{ fontSize: '13px', color: '#ffb38a', marginTop: '8px', lineHeight: 1.5 }}>{s.error}</div>}

      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginTop: '16px', paddingTop: '14px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        <div style={{ flex: '1 1 280px' }}>
          <div style={{ fontSize: '14px', fontWeight: 600, color: '#ccc' }}>Also scan everything</div>
          <div style={{ fontSize: '12px', color: '#5f5f68', marginTop: '3px', lineHeight: 1.5 }}>
            Catches changes the watcher can't see — e.g. files changed on a network share from another computer.
          </div>
        </div>
        <Select value={String(s.intervalHours)} disabled={busy} onChange={e => save({ intervalHours: Number(e.target.value) })} aria-label="Full scan interval"
          style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#fff', fontSize: '13px', padding: '8px 12px', minWidth: '180px', cursor: 'pointer', outline: 'none', colorScheme: 'dark' }}>
          {!['0', '1', '6', '12', '24'].includes(String(s.intervalHours)) && <option value={String(s.intervalHours)}>Every {s.intervalHours} hours</option>}
          <option value="0">Never</option>
          <option value="1">Every hour</option>
          <option value="6">Every 6 hours</option>
          <option value="12">Every 12 hours</option>
          <option value="24">Once a day</option>
        </Select>
      </div>
    </div>
  );
}
