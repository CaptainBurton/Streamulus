import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { noteAdminCounts } from './Navbar';
import { StatusPill, ProgressBar, RequestStyles } from './RequestStatus';

// Admin › Requests: films people asked for — approve (adds it to Radarr and
// searches) or decline (with a reason, emailed to them) — then follow them until
// they're ready, with Search Again for ones Radarr couldn't find. Plus the Radarr
// connection and request settings.

const CARD = { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', padding: '24px' };
const INPUT = { width: '100%', padding: '10px 14px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#fff', fontSize: '14px', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' };
const SELECT = { ...INPUT, cursor: 'pointer', colorScheme: 'dark' };
const LABEL = { fontSize: '13px', color: '#888', display: 'block', marginBottom: '6px', fontWeight: 600 };
const BTN = { padding: '8px 14px', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', background: 'transparent', border: '1px solid rgba(255,255,255,0.15)', color: '#ccc', whiteSpace: 'nowrap' };
const PRIMARY = { ...BTN, background: '#00c2ff', border: '1px solid #00c2ff', color: '#000', fontWeight: 700 };
const DANGER = { ...BTN, border: '1px solid rgba(255,77,77,0.35)', color: '#ff6b6b' };

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

  // Keep progress current while downloads are going.
  useEffect(() => {
    if (!counts.active) return undefined;
    const t = setInterval(() => { loadCounts(); loadList(); }, 10000);
    return () => clearInterval(t);
  }, [counts.active, filter]); // eslint-disable-line react-hooks/exhaustive-deps

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
  const [mode, setMode] = useState(null); // 'approve' | 'decline'
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
  const checkNow = () => run(() => axios.post(`/api/admin/requests/${r.id}/refresh`), `Checked ${r.title} in Radarr`);
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
          {r.declineReason && <div style={{ fontSize: '13px', color: '#ff9a9a' }}>Reason given: “{r.declineReason}”</div>}
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {['pending', 'declined'].includes(r.status) && !mode && (
            <button style={PRIMARY} disabled={busy} onClick={() => setMode('approve')} data-action="approve">Approve</button>
          )}
          {r.status === 'pending' && !mode && <button style={DANGER} disabled={busy} onClick={() => setMode('decline')} data-action="decline">Decline</button>}
          {['not_found', 'failed', 'missing', 'searching', 'waiting_release'].includes(r.status) && (
            <button style={r.needsAdmin ? PRIMARY : BTN} disabled={busy} onClick={searchAgain} data-action="search-again">Search Again</button>
          )}
          {followed && <button style={BTN} disabled={busy} onClick={checkNow}>Check Now</button>}
          <button style={{ ...DANGER, ...(confirmRemove ? { background: '#ff4444', color: '#fff', border: '1px solid #ff4444' } : {}) }} disabled={busy} onClick={remove} title="Removes the request from Streamulus (Radarr keeps the film)">
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
      {mode === 'decline' && (
        <div style={{ marginTop: '14px', paddingTop: '14px', borderTop: '1px solid rgba(255,255,255,0.06)', display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ flex: '1 1 320px' }}>
            <label style={LABEL}>Reason · optional, included in their email</label>
            <input style={INPUT} value={reason} onChange={e => setReason(e.target.value)} maxLength={500} placeholder="e.g. it's already on Netflix" aria-label="Reason" />
          </div>
          <button style={{ ...DANGER, background: '#ff4444', color: '#fff', border: '1px solid #ff4444' }} disabled={busy} onClick={decline} data-action="confirm-decline">{busy ? 'Declining…' : 'Decline Request'}</button>
          <button style={BTN} disabled={busy} onClick={() => setMode(null)}>Cancel</button>
        </div>
      )}
    </div>
  );
}

function RadarrSettings({ settings, flash, options, onSaved, onOptions }) {
  const [form, setForm] = useState({
    url: settings.radarr.url || '', apiKey: '', rootFolder: settings.radarr.rootFolder || '',
    qualityProfileId: settings.radarr.qualityProfileId || '', minimumAvailability: settings.radarr.minimumAvailability || 'released',
    enabled: settings.enabled, limit: settings.limit, notifyAdmins: settings.notifyAdmins,
  });
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
  const save = async () => {
    setBusy('save');
    try {
      const body = { ...form, qualityProfileId: form.qualityProfileId ? Number(form.qualityProfileId) : '' };
      if (!body.apiKey) delete body.apiKey;
      const r = await axios.put('/api/admin/requests/settings', body);
      onSaved(r.data);
      setForm(f => ({ ...f, apiKey: '' }));
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
