import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { noteAdminCounts } from './Navbar';
import { StatusPill, ProgressBar, RequestStyles } from './RequestStatus';

// Admin › Requests: films people asked for — approve (adds it to Radarr and
// searches) or decline (with a reason, emailed to them) — then follow them until
// they're ready, with Search Again for ones Radarr couldn't find, or the backup:
// paste a magnet link, which goes to Deluge and is moved into the movie library
// when it's done. Plus the Radarr and Deluge connections and request settings.

const CARD = { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', padding: '24px' };
const INPUT = { width: '100%', padding: '10px 14px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#fff', fontSize: '14px', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' };
const SELECT = { ...INPUT, cursor: 'pointer', colorScheme: 'dark' };
const LABEL = { fontSize: '13px', color: '#888', display: 'block', marginBottom: '6px', fontWeight: 600 };
const BTN = { padding: '8px 14px', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', background: 'transparent', border: '1px solid rgba(255,255,255,0.15)', color: '#ccc', whiteSpace: 'nowrap' };
const PRIMARY = { ...BTN, background: '#00c2ff', border: '1px solid #00c2ff', color: '#000', fontWeight: 700 };
const DANGER = { ...BTN, border: '1px solid rgba(255,77,77,0.35)', color: '#ff6b6b' };

// Quick notes for a declined request (the admin can still write their own).
const DECLINE_NOTES = [
  "Not released yet — ask again once it's out",
  "It's already on a streaming service we all use",
  "Couldn't find a good-quality copy",
  'Not suitable for this server',
  "We've got too many requests right now — try again later",
];

// Statuses a magnet link can be used for (not while it's being moved in, or once it's ready).
const MAGNET_OK = ['pending', 'declined', 'searching', 'waiting_release', 'not_found', 'failed', 'missing', 'downloading'];
const isMagnet = (v) => /^magnet:\?.*xt=urn:btih:[a-z0-9]{32,40}/i.test(String(v || '').trim());

// A horseshoe magnet: two pole tips over the U.
const MagnetIcon = ({ size = 15 }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true" style={{ flexShrink: 0 }}>
    <path d="M4 2.5h5.2v3.6H4zM14.8 2.5H20v3.6h-5.2z" />
    <path d="M4 7.6h5.2v3.6a2.8 2.8 0 0 0 5.6 0V7.6H20v3.6a8 8 0 0 1-16 0z" />
  </svg>
);

const FILTERS = [['pending', 'Waiting'], ['attention', 'Needs attention'], ['active', 'In progress'], ['available', 'Ready'], ['declined', 'Declined'], ['all', 'All']];
const when = (ms) => (ms ? new Date(ms).toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '');

export default function RequestsAdmin({ flash }) {
  const [settings, setSettings] = useState(null);
  const [counts, setCounts] = useState({ pending: 0, attention: 0, active: 0 });
  const [filter, setFilter] = useState('pending');
  const [list, setList] = useState(null);
  const [radarrOptions, setRadarrOptions] = useState(null); // { rootFolders, qualityProfiles }

  const loadCounts = () => axios.get('/api/admin/requests/counts').then(r => {
    setCounts(r.data);
    noteAdminCounts({ requests: r.data.pending, requestsAttention: r.data.attention });
    return r.data;
  }).catch(() => {});
  const loadList = (f = filter) => axios.get('/api/admin/requests', { params: { filter: f } }).then(r => setList(r.data.requests)).catch(() => flash("Couldn't load the requests", true));
  const reload = () => { loadCounts(); loadList(); };

  useEffect(() => {
    axios.get('/api/admin/requests/settings').then(r => {
      setSettings(r.data);
      if (r.data.radarr.configured) axios.post('/api/admin/requests/settings/test', {}).then(t => setRadarrOptions(t.data)).catch(() => {});
    }).catch(() => {});
    loadCounts().then(c => {
      // Start where the work is.
      const start = c?.pending ? 'pending' : c?.attention ? 'attention' : c?.active ? 'active' : 'all';
      setFilter(start);
      loadList(start);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep progress current while downloads are going (Refresh every, below).
  const everyMs = Math.max(1, settings?.refreshSeconds || 2) * 1000;
  useEffect(() => {
    if (!counts.active) return undefined;
    const t = setInterval(() => { if (!document.hidden) { loadCounts(); loadList(); } }, everyMs);
    return () => clearInterval(t);
  }, [counts.active, filter, everyMs]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (f) => { setFilter(f); setList(null); loadList(f); };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', maxWidth: '1100px' }} data-section="requests-admin">
      <RequestStyles />
      {settings && !settings.radarr.configured && (
        <div style={{ padding: '14px 18px', borderRadius: '10px', background: 'rgba(255,183,3,0.08)', border: '1px solid rgba(255,183,3,0.3)', color: '#ffd166', fontSize: '14px', lineHeight: 1.6 }}>
          Connect Radarr below to turn requests on. Until then, nobody sees the Requests page.
        </div>
      )}

      <div style={CARD}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginBottom: '16px' }}>
          <h3 style={{ fontSize: '16px', fontWeight: 700, margin: 0, flex: 1 }}>Film Requests</h3>
          <button style={BTN} onClick={reload}>Refresh</button>
        </div>
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '16px' }}>
          {FILTERS.map(([key, label]) => {
            const n = key === 'pending' ? counts.pending : key === 'attention' ? counts.attention : key === 'active' ? counts.active : 0;
            return (
              <button key={key} onClick={() => pick(key)} data-filter={key}
                style={{ ...BTN, borderRadius: '999px', padding: '6px 12px', ...(filter === key ? { background: '#00c2ff', color: '#000', border: '1px solid #00c2ff' } : {}) }}>
                {label}{n ? ` · ${n}` : ''}
              </button>
            );
          })}
        </div>
        {!list ? <div className="spinner" style={{ margin: '30px auto' }} /> : list.length === 0 ? (
          <div style={{ color: '#666', fontSize: '14px', padding: '18px 0' }}>
            {filter === 'pending' ? 'Nothing waiting for approval.' : filter === 'attention' ? 'Nothing needs your attention.' : 'No requests here.'}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {list.map(r => <AdminRow key={r.id} r={r} flash={flash} options={radarrOptions} settings={settings} onChanged={reload} />)}
          </div>
        )}
      </div>

      {settings && <RadarrSettings settings={settings} flash={flash} options={radarrOptions}
        onSaved={(s) => setSettings(s)} onOptions={setRadarrOptions} />}
    </div>
  );
}

function AdminRow({ r, flash, options, settings, onChanged }) {
  const [mode, setMode] = useState(null); // 'approve' | 'decline' | 'magnet'
  const [magnet, setMagnet] = useState('');
  const [profile, setProfile] = useState(settings?.radarr.qualityProfileId || '');
  const [root, setRoot] = useState(settings?.radarr.rootFolder || '');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const run = async (fn, done) => {
    setBusy(true);
    try { await fn(); flash(done); setMode(null); onChanged(); } catch (err) { flash(err.response?.data?.error || 'Something went wrong', true); }
    setBusy(false);
  };
  const approve = () => run(() => axios.post(`/api/admin/requests/${r.id}/approve`, { qualityProfileId: profile || undefined, rootFolder: root || undefined }),
    `Approved ${r.title} — added to Radarr and searching`);
  const decline = () => run(() => axios.post(`/api/admin/requests/${r.id}/decline`, { reason }), `Declined ${r.title}`);
  const searchAgain = () => run(() => axios.post(`/api/admin/requests/${r.id}/search`), `Searching again for ${r.title}`);
  const checkNow = () => run(() => axios.post(`/api/admin/requests/${r.id}/refresh`), `Checked ${r.title} in ${r.manual ? 'Deluge' : 'Radarr'}`);
  const startMagnet = () => run(async () => { await axios.post(`/api/admin/requests/${r.id}/magnet`, { magnet: magnet.trim() }); setMagnet(''); },
    `Added ${r.title} to Deluge — it moves into the library by itself when it's done`);
  const pasteMagnet = async () => {
    try { const text = await navigator.clipboard.readText(); if (text) setMagnet(text.trim()); } catch { /* not allowed: paste by hand */ }
  };
  const remove = () => {
    if (!confirmRemove) { setConfirmRemove(true); setTimeout(() => setConfirmRemove(false), 4000); return; }
    run(() => axios.delete(`/api/admin/requests/${r.id}`), `Removed the request for ${r.title}`);
  };
  const followed = ['searching', 'waiting_release', 'not_found', 'downloading', 'importing', 'failed', 'adding', 'missing'].includes(r.status);

  return (
    <div data-admin-request={r.title} style={{ border: `1px solid ${r.needsAdmin ? 'rgba(255,140,66,0.35)' : 'rgba(255,255,255,0.07)'}`, borderRadius: '10px', background: 'rgba(255,255,255,0.02)', padding: '14px 16px' }}>
      <div style={{ display: 'flex', gap: '14px', alignItems: 'flex-start' }}>
        {r.posterUrl ? <img src={r.posterUrl} alt="" style={{ width: '46px', height: '69px', objectFit: 'cover', borderRadius: '6px', flexShrink: 0 }} />
          : <div style={{ width: '46px', height: '69px', borderRadius: '6px', background: '#1c1c1e', flexShrink: 0 }} />}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 700, fontSize: '15px' }}>{r.title}</span>
            <span style={{ color: '#777', fontSize: '13px' }}>{r.year || ''}</span>
            <StatusPill status={r.status} label={r.label} />
            {r.needsAdmin && <span style={{ fontSize: '11px', fontWeight: 700, color: '#ff8c42' }}>NEEDS YOU</span>}
          </div>
          <div style={{ fontSize: '12px', color: '#777' }}>
            Asked for by <strong style={{ color: '#bbb' }}>{r.requesters.map(p => p.username).join(', ') || 'nobody now'}</strong> · {when(r.createdAt)}
            {r.decidedBy && ` · ${r.status === 'declined' ? 'declined' : 'approved'} by ${r.decidedBy}`}
          </div>
          {r.note && <div style={{ fontSize: '13px', color: '#bbb', fontStyle: 'italic' }}>“{r.note}”</div>}
          {r.status === 'downloading' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', maxWidth: '420px' }}>
              <div style={{ flex: 1 }}><ProgressBar status={r.status} progress={r.progress} /></div>
              <span style={{ fontSize: '12px', color: '#00c2ff', fontWeight: 700 }}>{Math.round((r.progress || 0) * 100)}%</span>
            </div>
          )}
          {r.detail && <div style={{ fontSize: '13px', color: r.needsAdmin ? '#ffb38a' : '#999' }}>{r.detail}</div>}
          {r.manual && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#8a8a94', minWidth: 0 }} data-manual>
              <span style={{ color: '#c58cff', display: 'inline-flex' }}><MagnetIcon size={13} /></span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                Magnet link{r.manual.name ? <> · <span style={{ color: '#bbb' }}>{r.manual.name}</span></> : ''} · added by {r.manual.by} {when(r.manual.at)}
              </span>
            </div>
          )}
          {r.declineReason && <div style={{ fontSize: '13px', color: '#ff9a9a' }}>Note to them: “{r.declineReason}”</div>}
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {['pending', 'declined'].includes(r.status) && !mode && (
            <button style={PRIMARY} disabled={busy} onClick={() => setMode('approve')} data-action="approve">Approve</button>
          )}
          {r.status === 'pending' && !mode && <button style={DANGER} disabled={busy} onClick={() => setMode('decline')} data-action="decline">Decline</button>}
          {MAGNET_OK.includes(r.status) && mode !== 'magnet' && (
            <button style={{ ...(r.needsAdmin ? PRIMARY : BTN), display: 'inline-flex', alignItems: 'center', gap: '6px' }} disabled={busy} onClick={() => setMode('magnet')} data-action="magnet"
              title="Radarr can't find it? Paste a magnet link — it's downloaded in Deluge and moved into the library">
              <MagnetIcon /> {r.manual && r.status === 'downloading' ? 'Replace Magnet' : 'Magnet Link'}
            </button>
          )}
          {['not_found', 'failed', 'missing', 'searching', 'waiting_release'].includes(r.status) && (
            <button style={BTN} disabled={busy} onClick={searchAgain} data-action="search-again" title={r.manual ? 'Hand it back to Radarr to find' : 'Ask Radarr to search again'}>Search Again</button>
          )}
          {followed && <button style={BTN} disabled={busy} onClick={checkNow}>Check Now</button>}
          <button style={{ ...DANGER, ...(confirmRemove ? { background: '#ff4444', color: '#fff', border: '1px solid #ff4444' } : {}) }} disabled={busy} onClick={remove}
            title={r.manual && ['downloading', 'failed'].includes(r.status) ? 'Removes the request, and its unfinished download in Deluge' : 'Removes the request from Streamulus (Radarr keeps the film)'}>
            {confirmRemove ? 'Click to remove' : 'Remove'}
          </button>
        </div>
      </div>

      {mode === 'approve' && (
        <div style={{ marginTop: '14px', paddingTop: '14px', borderTop: '1px solid rgba(255,255,255,0.06)', display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ flex: '1 1 200px' }}>
            <label style={LABEL}>Quality profile</label>
            <select style={SELECT} value={profile} onChange={e => setProfile(e.target.value)} aria-label="Quality profile">
              {(options?.qualityProfiles || []).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              {!options && <option value={profile}>Default</option>}
            </select>
          </div>
          <div style={{ flex: '1 1 200px' }}>
            <label style={LABEL}>Root folder</label>
            <select style={SELECT} value={root} onChange={e => setRoot(e.target.value)} aria-label="Root folder">
              {(options?.rootFolders || []).map(f => <option key={f.path} value={f.path}>{f.path}</option>)}
              {!options && <option value={root}>{root || 'Default'}</option>}
            </select>
          </div>
          <button style={PRIMARY} disabled={busy} onClick={approve} data-action="confirm-approve">{busy ? 'Approving…' : 'Approve & Download'}</button>
          <button style={BTN} disabled={busy} onClick={() => setMode(null)}>Cancel</button>
          <div style={{ flexBasis: '100%', fontSize: '12px', color: '#666' }}>Everyone who asked for it gets an email that it's approved.</div>
        </div>
      )}
      {mode === 'magnet' && (
        <MagnetPanel r={r} settings={settings} magnet={magnet} setMagnet={setMagnet} busy={busy} onPaste={pasteMagnet}
          onStart={startMagnet} onCancel={() => setMode(null)} />
      )}
      {mode === 'decline' && (
        <div style={{ marginTop: '14px', paddingTop: '14px', borderTop: '1px solid rgba(255,255,255,0.06)', display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ flex: '1 1 100%' }}>
            <label style={LABEL}>Note for {r.requesters.map(p => p.username).join(', ') || 'them'} · optional — shown in their Requests and included in their email</label>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '8px' }}>
              {DECLINE_NOTES.map(n => (
                <button key={n} type="button" onClick={() => setReason(n)} data-note={n}
                  style={{ ...BTN, padding: '5px 11px', fontSize: '12px', borderRadius: '999px', ...(reason === n ? { background: 'rgba(255,77,77,0.18)', color: '#fff', border: '1px solid rgba(255,77,77,0.5)' } : {}) }}>
                  {n}
                </button>
              ))}
            </div>
            <input style={INPUT} value={reason} onChange={e => setReason(e.target.value)} maxLength={500} placeholder="Or write your own, e.g. it's already on Netflix" aria-label="Reason" />
          </div>
          <button style={{ ...DANGER, background: '#ff4444', color: '#fff', border: '1px solid #ff4444' }} disabled={busy} onClick={decline} data-action="confirm-decline">{busy ? 'Declining…' : 'Decline Request'}</button>
          <button style={BTN} disabled={busy} onClick={() => setMode(null)}>Cancel</button>
        </div>
      )}
    </div>
  );
}

// Paste a magnet link: it's added to Deluge, followed like any download, and the
// film moved into the movie library (named by the naming format) when it's done.
function MagnetPanel({ r, settings, magnet, setMagnet, busy, onPaste, onStart, onCancel }) {
  const delugeReady = !!settings?.deluge?.configured;
  const valid = isMagnet(magnet);
  const typed = magnet.trim().length > 0;
  const undecided = ['pending', 'declined'].includes(r.status);
  const radarrBusy = r.radarrId && !r.manual && ['downloading', 'searching'].includes(r.status);
  const steps = [
    'Added to your Deluge',
    radarrBusy ? "Radarr's own download of it is cancelled, and Radarr stops looking" : r.radarrId ? 'Radarr stops looking for it, so there\'s no second copy' : null,
    `When it's done, the film (and any subtitles) is moved into your movies folder as “${r.title}${r.year ? ` (${r.year})` : ''}” and added to Streamulus`,
    undecided ? `${r.requesters.map(p => p.username).join(', ') || 'Whoever asked'} is emailed that it's approved now, and again when it's ready` : `${r.requesters.map(p => p.username).join(', ') || 'Whoever asked'} can follow it in Requests and is emailed when it's ready`,
  ].filter(Boolean);
  return (
    <div style={{ marginTop: '14px', paddingTop: '14px', borderTop: '1px solid rgba(255,255,255,0.06)' }} data-panel="magnet">
      <label style={LABEL} htmlFor={`magnet-${r.id}`}>Magnet link for {r.title}{r.year ? ` (${r.year})` : ''}</label>
      {!delugeReady && (
        <div style={{ padding: '10px 14px', borderRadius: '8px', background: 'rgba(255,183,3,0.08)', border: '1px solid rgba(255,183,3,0.3)', color: '#ffd166', fontSize: '13px', marginBottom: '10px' }}>
          Connect Deluge first (Deluge section below) — the magnet link is downloaded there.
        </div>
      )}
      <div style={{ display: 'flex', gap: '8px', alignItems: 'stretch' }}>
        <textarea id={`magnet-${r.id}`} value={magnet} onChange={e => setMagnet(e.target.value)} rows={2} spellCheck={false} aria-label="Magnet link"
          placeholder="magnet:?xt=urn:btih:…" disabled={!delugeReady}
          style={{ ...INPUT, flex: 1, resize: 'vertical', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '12.5px', lineHeight: 1.5, wordBreak: 'break-all',
            ...(typed && !valid ? { border: '1px solid rgba(255,107,107,0.6)' } : valid ? { border: '1px solid rgba(0,194,255,0.6)' } : {}) }} />
        <button type="button" style={{ ...BTN, alignSelf: 'flex-start' }} onClick={onPaste} disabled={!delugeReady || busy}>Paste</button>
      </div>
      {typed && !valid && <div style={{ fontSize: '12px', color: '#ff8a8a', marginTop: '6px' }}>That doesn't look like a magnet link — it should start with magnet:?xt=urn:btih:</div>}
      <ul style={{ margin: '12px 0 14px', paddingLeft: '18px', color: '#8a8a94', fontSize: '12.5px', lineHeight: 1.7 }}>
        {steps.map(s => <li key={s}>{s}</li>)}
      </ul>
      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
        <button style={{ ...PRIMARY, display: 'inline-flex', alignItems: 'center', gap: '7px' }} disabled={busy || !valid || !delugeReady} onClick={onStart} data-action="start-magnet">
          <MagnetIcon /> {busy ? 'Adding…' : undecided ? 'Approve & Download' : 'Download in Deluge'}
        </button>
        <button style={BTN} disabled={busy} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function RadarrSettings({ settings, flash, options, onSaved, onOptions }) {
  const [form, setForm] = useState({
    url: settings.radarr.url || '', apiKey: '', rootFolder: settings.radarr.rootFolder || '',
    qualityProfileId: settings.radarr.qualityProfileId || '', minimumAvailability: settings.radarr.minimumAvailability || 'released',
    enabled: settings.enabled, limit: settings.limit, notifyAdmins: settings.notifyAdmins,
    refreshSeconds: settings.refreshSeconds || 2,
    delugeUrl: settings.deluge?.url || '', delugePassword: '',
    delugeRemotePath: settings.deluge?.remotePath || '', delugeLocalPath: settings.deluge?.localPath || '',
  });
  const [delugeOk, setDelugeOk] = useState(null); // torrent count after a good test
  const [folder, setFolder] = useState(null); // { downloadFolder, localFolder, visible } after a test
  const [busy, setBusy] = useState('');
  const [tested, setTested] = useState(null); // version string after a good test
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  const test = async () => {
    setBusy('test');
    try {
      const r = await axios.post('/api/admin/requests/settings/test', { url: form.url, apiKey: form.apiKey || undefined });
      onOptions(r.data);
      setTested(r.data.version);
      setForm(f => ({
        ...f,
        rootFolder: f.rootFolder || r.data.rootFolders[0]?.path || '',
        qualityProfileId: f.qualityProfileId || r.data.qualityProfiles[0]?.id || '',
      }));
      flash(`Connected to Radarr ${r.data.version || ''} — choose a root folder and quality profile, then Save`);
    } catch (err) {
      setTested(null);
      flash(err.response?.data?.error || "Couldn't connect to Radarr", true);
    }
    setBusy('');
  };
  const testDeluge = async () => {
    setBusy('deluge');
    try {
      const r = await axios.post('/api/admin/requests/settings/deluge-test', {
        url: form.delugeUrl, password: form.delugePassword || undefined, remotePath: form.delugeRemotePath, localPath: form.delugeLocalPath,
      });
      setDelugeOk(r.data.torrents);
      setFolder(r.data);
      flash(`Connected to Deluge (${r.data.torrents} torrent${r.data.torrents === 1 ? '' : 's'})${r.data.downloadFolder && !r.data.visible ? " — but Streamulus can't see its download folder yet (see below)" : ''} — press Save to use it`, r.data.downloadFolder && !r.data.visible);
    } catch (err) {
      setDelugeOk(null);
      setFolder(null);
      flash(err.response?.data?.error || "Couldn't connect to Deluge", true);
    }
    setBusy('');
  };
  const save = async () => {
    setBusy('save');
    try {
      const body = { ...form, qualityProfileId: form.qualityProfileId ? Number(form.qualityProfileId) : '', refreshSeconds: Number(form.refreshSeconds) };
      if (!body.apiKey) delete body.apiKey;
      if (!body.delugePassword) delete body.delugePassword;
      const r = await axios.put('/api/admin/requests/settings', body);
      onSaved(r.data);
      setForm(f => ({ ...f, apiKey: '', delugePassword: '' }));
      flash(r.data.open ? 'Saved — requests are open' : 'Saved');
    } catch (err) { flash(err.response?.data?.error || "Couldn't save", true); }
    setBusy('');
  };
  const gb = (bytes) => (bytes == null ? '' : ` · ${(bytes / 1e12 >= 1 ? `${(bytes / 1e12).toFixed(1)} TB` : `${Math.round(bytes / 1e9)} GB`)} free`);

  return (
    <div style={CARD} data-section="radarr">
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px', flexWrap: 'wrap' }}>
        <h3 style={{ fontSize: '16px', fontWeight: 700, margin: 0 }}>Radarr</h3>
        <span style={{ padding: '2px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase',
          color: settings.open ? '#00c864' : '#ffb703', border: `1px solid ${settings.open ? '#00c86455' : '#ffb70355'}` }}>
          {settings.open ? 'Requests open' : settings.radarr.configured ? 'Requests turned off' : 'Not connected'}
        </span>
      </div>
      <p style={{ color: '#777', fontSize: '14px', margin: '0 0 18px', lineHeight: 1.6 }}>
        Approved films are added to Radarr (monitored) and searched for; Radarr and your download client do the downloading and moving.
        Streamulus follows each one and adds it to the library when it's done.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(260px, 100%), 1fr))', gap: '16px' }}>
        <div>
          <label style={LABEL} htmlFor="radarr-url">Radarr address</label>
          <input id="radarr-url" style={INPUT} value={form.url} onChange={set('url')} placeholder="http://192.168.1.20:7878" />
          <div style={{ fontSize: '12px', color: '#5f5f68', marginTop: '5px' }}>As Streamulus's server sees it — in Docker, the Radarr container's name or the server's IP (not localhost).</div>
        </div>
        <div>
          <label style={LABEL} htmlFor="radarr-key">API key</label>
          <input id="radarr-key" style={INPUT} type="password" value={form.apiKey} onChange={set('apiKey')} autoComplete="off"
            placeholder={settings.radarr.apiKeySet ? '•••••••••••••••• (saved — type to replace)' : 'Radarr › Settings › General › API Key'} />
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '14px', flexWrap: 'wrap' }}>
        <button style={BTN} onClick={test} disabled={!!busy || !form.url} data-action="test-radarr">{busy === 'test' ? 'Connecting…' : 'Test Connection'}</button>
        {tested && <span style={{ fontSize: '13px', color: '#00c864' }}>✓ Radarr {tested}</span>}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(220px, 100%), 1fr))', gap: '16px', marginTop: '18px' }}>
        <div>
          <label style={LABEL} htmlFor="radarr-root">Root folder</label>
          <select id="radarr-root" style={SELECT} value={form.rootFolder} onChange={set('rootFolder')}>
            {!options && <option value={form.rootFolder}>{form.rootFolder || 'Test the connection to choose'}</option>}
            {(options?.rootFolders || []).map(f => <option key={f.path} value={f.path}>{f.path}{gb(f.freeSpace)}</option>)}
          </select>
        </div>
        <div>
          <label style={LABEL} htmlFor="radarr-profile">Quality profile</label>
          <select id="radarr-profile" style={SELECT} value={form.qualityProfileId} onChange={set('qualityProfileId')}>
            {!options && <option value={form.qualityProfileId}>{form.qualityProfileId ? `Profile ${form.qualityProfileId}` : 'Test the connection to choose'}</option>}
            {(options?.qualityProfiles || []).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div>
          <label style={LABEL} htmlFor="radarr-availability">Download when</label>
          <select id="radarr-availability" style={SELECT} value={form.minimumAvailability} onChange={set('minimumAvailability')}>
            <option value="announced">Announced (as soon as anything appears)</option>
            <option value="inCinemas">In cinemas</option>
            <option value="released">Released on digital / disc (recommended)</option>
          </select>
        </div>
      </div>

      <div style={{ fontSize: '11px', color: '#444', letterSpacing: '1px', textTransform: 'uppercase', margin: '22px 0 6px' }}>Deluge · live progress and magnet links (optional)</div>
      <p style={{ color: '#666', fontSize: '13px', margin: '0 0 12px', lineHeight: 1.6 }}>
        With Deluge connected, download progress, speed and time left come straight from Deluge (Radarr's lag by about a minute), and when
        Radarr can't find a film you can paste a magnet link on its request instead — it downloads in Deluge and is moved into your movies
        folder when it's done.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(260px, 100%), 1fr))', gap: '16px' }}>
        <div>
          <label style={LABEL} htmlFor="deluge-url">Deluge Web UI address</label>
          <input id="deluge-url" style={INPUT} value={form.delugeUrl} onChange={set('delugeUrl')} placeholder="http://192.168.1.20:8112" />
        </div>
        <div>
          <label style={LABEL} htmlFor="deluge-password">Web UI password</label>
          <input id="deluge-password" style={INPUT} type="password" value={form.delugePassword} onChange={set('delugePassword')} autoComplete="off"
            placeholder={settings.deluge?.passwordSet ? '•••••••• (saved — type to replace)' : 'The password you sign in to Deluge with'} />
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '12px', flexWrap: 'wrap' }}>
        <button style={BTN} onClick={testDeluge} disabled={!!busy || !form.delugeUrl} data-action="test-deluge">{busy === 'deluge' ? 'Connecting…' : 'Test Deluge'}</button>
        {delugeOk != null && <span style={{ fontSize: '13px', color: '#00c864' }}>✓ Connected · {delugeOk} torrent{delugeOk === 1 ? '' : 's'}</span>}
        {settings.deluge?.error && delugeOk == null && <span style={{ fontSize: '13px', color: '#ffb38a' }}>{settings.deluge.error}</span>}
      </div>
      {folder?.downloadFolder && (
        <div style={{ marginTop: '12px', padding: '10px 14px', borderRadius: '8px', fontSize: '13px', lineHeight: 1.6,
          background: folder.visible ? 'rgba(0,200,100,0.07)' : 'rgba(255,140,66,0.08)', border: `1px solid ${folder.visible ? 'rgba(0,200,100,0.25)' : 'rgba(255,140,66,0.3)'}`,
          color: folder.visible ? '#7fe0a8' : '#ffb38a' }} data-folder-check>
          Deluge saves downloads to <code style={{ color: '#fff' }}>{folder.downloadFolder}</code>.{' '}
          {folder.visible
            ? <>✓ Streamulus can see it{folder.localFolder !== folder.downloadFolder ? <> (at <code style={{ color: '#fff' }}>{folder.localFolder}</code>)</> : ''} — finished magnet downloads are moved into your movies folder from there.</>
            : <>Streamulus can't see that folder{folder.localFolder !== folder.downloadFolder ? <> (looked at <code style={{ color: '#fff' }}>{folder.localFolder}</code>)</> : ''}. If Deluge runs in Docker or on another computer, enter where that folder is on this server below, then Test again.</>}
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(260px, 100%), 1fr))', gap: '16px', marginTop: '14px' }}>
        <div>
          <label style={LABEL} htmlFor="deluge-remote-path">Deluge's download folder <span style={{ color: '#555', fontWeight: 500 }}>· as Deluge sees it</span></label>
          <input id="deluge-remote-path" style={INPUT} value={form.delugeRemotePath} onChange={set('delugeRemotePath')} placeholder={folder?.downloadFolder || '/downloads'} />
        </div>
        <div>
          <label style={LABEL} htmlFor="deluge-local-path">The same folder on this server</label>
          <input id="deluge-local-path" style={INPUT} value={form.delugeLocalPath} onChange={set('delugeLocalPath')} placeholder="/mnt/media/downloads" />
        </div>
      </div>
      <div style={{ fontSize: '12px', color: '#5f5f68', marginTop: '6px' }}>
        Only needed when they differ (like Radarr's Remote Path Mappings). Leave both empty if Deluge and Streamulus see the same paths.
      </div>

      <div style={{ fontSize: '11px', color: '#444', letterSpacing: '1px', textTransform: 'uppercase', margin: '22px 0 10px' }}>Requests</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '14px', color: '#ccc', cursor: 'pointer' }}>
          <input type="checkbox" checked={form.enabled} onChange={set('enabled')} style={{ accentColor: '#00c2ff', width: '16px', height: '16px' }} data-setting="requests-enabled" />
          Let people request films (adds Requests to the menu)
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '14px', color: '#ccc', cursor: 'pointer' }}>
          <input type="checkbox" checked={form.notifyAdmins} onChange={set('notifyAdmins')} style={{ accentColor: '#00c2ff', width: '16px', height: '16px' }} />
          Email admins when someone asks for a film
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '14px', color: '#ccc', flexWrap: 'wrap' }}>
          Check progress and refresh pages every
          <select value={String(form.refreshSeconds)} onChange={set('refreshSeconds')} aria-label="Refresh every" data-setting="refresh"
            style={{ ...SELECT, width: 'auto', padding: '7px 10px' }}>
            {!['1', '2', '3', '5', '10', '15', '30'].includes(String(form.refreshSeconds)) && <option value={String(form.refreshSeconds)}>{form.refreshSeconds} seconds</option>}
            <option value="1">1 second</option>
            <option value="2">2 seconds (default)</option>
            <option value="3">3 seconds</option>
            <option value="5">5 seconds</option>
            <option value="10">10 seconds</option>
            <option value="15">15 seconds</option>
            <option value="30">30 seconds</option>
          </select>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '14px', color: '#ccc' }}>
          Each person can have up to
          <input type="number" min="1" max="100" value={form.limit} onChange={set('limit')} style={{ ...INPUT, width: '80px', padding: '7px 10px' }} aria-label="Request limit" />
          requests on the go at once
        </label>
      </div>
      <div style={{ marginTop: '20px', paddingTop: '16px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        <button style={PRIMARY} onClick={save} disabled={!!busy} data-action="save-radarr">{busy === 'save' ? 'Saving…' : 'Save'}</button>
      </div>
    </div>
  );
}
