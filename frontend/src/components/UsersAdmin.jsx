import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import ProfileAvatar from './ProfileAvatar';
import MailIcon from './MailIcon';

// Admin › Users: every account (search, filter, sort), each one's details —
// name, email, role, disable, new password, signed-in devices (sign one or all
// out), recent activity, what it watched and its profiles — and the activity log.

const CARD = { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', padding: '24px', marginBottom: '24px' };
const INPUT = { padding: '9px 12px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#fff', fontSize: '14px', outline: 'none', fontFamily: 'inherit', minWidth: 0 };
const SELECT = { ...INPUT, cursor: 'pointer', colorScheme: 'dark' };
const BTN = { padding: '8px 14px', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', background: 'transparent', border: '1px solid rgba(255,255,255,0.15)', color: '#ccc' };
const PRIMARY = { ...BTN, background: '#00c2ff', border: '1px solid #00c2ff', color: '#000', fontWeight: 700 };
const DANGER = { ...BTN, border: '1px solid rgba(255,77,77,0.35)', color: '#ff6b6b' };
const TAG = (color) => ({ padding: '2px 8px', borderRadius: '20px', fontSize: '10px', fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase', color, border: `1px solid ${color}55`, whiteSpace: 'nowrap' });

export function ago(ms) {
  if (!ms) return 'never';
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return new Date(ms).toLocaleDateString();
}
const when = (ms) => (ms ? new Date(ms).toLocaleString() : '');
const sqlTime = (s) => (s ? Date.parse(String(s).replace(' ', 'T') + (String(s).includes('Z') ? '' : 'Z')) : null);

export default function UsersAdmin({ flash, onChanged, onEmail }) {
  const [data, setData] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState('active');
  const [adding, setAdding] = useState(false);

  const load = () => axios.get('/api/admin/users').then(r => setData(r.data)).catch(() => flash('Failed to load accounts', true));
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const changed = () => { load(); onChanged?.(); };

  const accounts = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    return data.users
      .filter(u => u.status !== 'pending') // those are under Account Requests
      .filter(u => !q || u.username.toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q) || u.profiles.some(p => p.name.toLowerCase().includes(q)))
      .filter(u => filter === 'all' || (filter === 'admins' ? u.role === 'admin' : filter === 'users' ? u.role !== 'admin' : u.status === 'disabled'))
      .sort((a, b) => sort === 'name' ? a.username.localeCompare(b.username)
        : sort === 'newest' ? (sqlTime(b.created_at) || 0) - (sqlTime(a.created_at) || 0)
          : (b.last_active_at || 0) - (a.last_active_at || 0));
  }, [data, query, filter, sort]);

  return (
    <>
      <div style={CARD}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', marginBottom: '16px' }}>
          <h3 style={{ fontSize: '16px', fontWeight: 700 }}>Accounts {data && <span style={{ color: '#555', fontWeight: 500 }}>· {accounts.length}</span>}</h3>
          <button style={adding ? BTN : PRIMARY} onClick={() => setAdding(a => !a)}>{adding ? 'Cancel' : '+ Add User'}</button>
        </div>
        {adding && <AddUser flash={flash} onAdded={() => { setAdding(false); changed(); }} />}
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '14px' }}>
          <input style={{ ...INPUT, flex: '1 1 220px' }} placeholder="Search names, emails, profiles…" value={query} onChange={e => setQuery(e.target.value)} aria-label="Search accounts" />
          <select style={SELECT} value={filter} onChange={e => setFilter(e.target.value)} aria-label="Show">
            <option value="all">All accounts</option>
            <option value="admins">Admins</option>
            <option value="users">Users</option>
            <option value="disabled">Disabled</option>
          </select>
          <select style={SELECT} value={sort} onChange={e => setSort(e.target.value)} aria-label="Sort">
            <option value="active">Recently active</option>
            <option value="name">Name</option>
            <option value="newest">Newest</option>
          </select>
        </div>

        {!data ? <div className="spinner" style={{ margin: '30px auto' }} /> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {accounts.map(u => (
              <div key={u.id} data-account={u.username} style={{ borderRadius: '10px', border: `1px solid ${openId === u.id ? 'rgba(0,194,255,0.35)' : 'rgba(255,255,255,0.06)'}`, background: 'rgba(255,255,255,0.03)', opacity: u.status === 'disabled' ? 0.75 : 1 }}>
                <button onClick={() => setOpenId(openId === u.id ? null : u.id)} aria-expanded={openId === u.id}
                  style={{ display: 'flex', alignItems: 'center', gap: '14px', width: '100%', padding: '12px 16px', background: 'transparent', border: 'none', color: '#fff', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', flexWrap: 'wrap' }}>
                  <div style={{ width: '38px', height: '38px', borderRadius: '50%', flexShrink: 0, background: u.status === 'disabled' ? '#333' : 'linear-gradient(135deg, #00c2ff, #7b2fff)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '15px', fontWeight: 800 }}>
                    {u.username[0].toUpperCase()}
                  </div>
                  <div style={{ flex: '1 1 180px', minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 700, fontSize: '15px' }}>{u.username}</span>
                      {u.id === data.me && <span style={TAG('#aaa')}>You</span>}
                      {u.role === 'admin' && <span style={TAG('#00c2ff')}>Admin</span>}
                      {u.status === 'disabled' && <span style={TAG('#ff6b6b')}>Disabled</span>}
                    </div>
                    <div style={{ fontSize: '12px', color: '#666', marginTop: '2px' }}>{u.email || 'No email'}</div>
                  </div>
                  <div style={{ fontSize: '12px', color: '#888', textAlign: 'right', lineHeight: 1.6 }}>
                    <div>{u.last_active_at ? `Active ${ago(u.last_active_at)}` : 'Never signed in'}</div>
                    <div style={{ color: '#555' }}>
                      {u.device_count} device{u.device_count === 1 ? '' : 's'} · {u.profiles.length} profile{u.profiles.length === 1 ? '' : 's'}
                      {u.watches_30d > 0 && ` · ${u.watches_30d} watched (30d)`}
                    </div>
                  </div>
                </button>
                {openId === u.id && <UserDetail id={u.id} me={data.me} flash={flash} onChanged={changed} onDeleted={() => { setOpenId(null); changed(); }} onEmail={onEmail} />}
              </div>
            ))}
            {accounts.length === 0 && <div style={{ color: '#555', padding: '20px', textAlign: 'center', fontSize: '14px' }}>No accounts match.</div>}
          </div>
        )}
      </div>

      <ActivityLog users={data?.users || []} flash={flash} />
    </>
  );
}

function AddUser({ flash, onAdded }) {
  const [form, setForm] = useState({ username: '', password: '', email: '', role: 'user' });
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await axios.post('/api/admin/users', form);
      flash(`Account ${form.username} created`);
      onAdded();
    } catch (err) { flash(err.response?.data?.error || 'Failed to create the account', true); }
    setBusy(false);
  };
  return (
    <form onSubmit={submit} style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', padding: '14px', marginBottom: '16px', borderRadius: '10px', background: 'rgba(0,194,255,0.05)', border: '1px solid rgba(0,194,255,0.2)' }}>
      <input style={{ ...INPUT, flex: '1 1 150px' }} placeholder="Username" value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} aria-label="New username" />
      <input style={{ ...INPUT, flex: '1 1 150px' }} type="password" placeholder="Password (6+ characters)" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} aria-label="New password" />
      <input style={{ ...INPUT, flex: '1 1 180px' }} type="email" placeholder="Email (optional)" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} aria-label="Email" />
      <select style={SELECT} value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))} aria-label="Role">
        <option value="user">User</option>
        <option value="admin">Admin</option>
      </select>
      <button type="submit" style={PRIMARY} disabled={busy || !form.username.trim() || form.password.length < 6}>Create</button>
    </form>
  );
}

const DETAIL_TABS = [['account', 'Account'], ['devices', 'Devices'], ['activity', 'Activity'], ['watching', 'Watching'], ['profiles', 'Profiles']];

function UserDetail({ id, me, flash, onChanged, onDeleted, onEmail }) {
  const [detail, setDetail] = useState(null);
  const [tab, setTab] = useState('account');
  const load = () => axios.get(`/api/admin/users/${id}`).then(r => setDetail(r.data)).catch(() => flash('Failed to load the account', true));
  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!detail) return <div style={{ padding: '16px' }}><div className="spinner" style={{ margin: '10px auto' }} /></div>;
  const reload = () => { load(); onChanged(); };
  const counts = { devices: detail.sessions.length, activity: detail.activity.length, watching: detail.watched.length, profiles: detail.user.profiles.length };

  return (
    <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', padding: '14px 16px 18px' }}>
      <div role="tablist" style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '16px' }}>
        {DETAIL_TABS.map(([key, label]) => (
          <button key={key} role="tab" aria-selected={tab === key} onClick={() => setTab(key)}
            style={{ ...BTN, padding: '6px 12px', borderRadius: '999px', ...(tab === key ? { background: '#00c2ff', color: '#000', border: '1px solid #00c2ff' } : {}) }}>
            {label}{counts[key] !== undefined ? ` · ${counts[key]}` : ''}
          </button>
        ))}
      </div>
      {tab === 'account' && <AccountTab user={detail.user} self={detail.user.id === me} flash={flash} onChanged={reload} onDeleted={onDeleted} onEmail={onEmail} />}
      {tab === 'devices' && <DevicesTab user={detail.user} sessions={detail.sessions} self={detail.user.id === me} flash={flash} onChanged={reload} />}
      {tab === 'activity' && <EntryList items={detail.activity} empty="No activity recorded yet." />}
      {tab === 'watching' && (
        detail.watched.length === 0 ? <div style={{ color: '#555', fontSize: '13px' }}>Nothing watched yet.</div> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {detail.watched.map((w, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '13px', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                <span style={{ flex: 1, minWidth: 0, color: '#ddd', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.title}</span>
                {w.profile && <span style={{ color: '#777' }}>{w.profile}</span>}
                <span style={{ color: w.completed ? '#00c864' : '#00c2ff', width: '70px', textAlign: 'right' }}>{w.completed ? 'Watched' : w.progress != null ? `${Math.round(w.progress * 100)}%` : 'Started'}</span>
                <span style={{ color: '#555', width: '80px', textAlign: 'right' }} title={when(sqlTime(w.watched_at))}>{ago(sqlTime(w.watched_at))}</span>
              </div>
            ))}
          </div>
        )
      )}
      {tab === 'profiles' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {detail.user.profiles.map(p => (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <ProfileAvatar profile={p} size={30} radius="8px" />
              <span style={{ fontSize: '14px', color: '#ddd', fontWeight: 500 }}>{p.name}</span>
              {p.is_main && <span style={TAG('#00c2ff')}>Main</span>}
              {p.is_kids && <span style={TAG('#ffb703')}>Streamling</span>}
              {p.has_pin && <span style={TAG('#888')}>🔒 PIN</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AccountTab({ user, self, flash, onChanged, onDeleted, onEmail }) {
  const [form, setForm] = useState({ username: user.username, email: user.email || '', role: user.role });
  const [password, setPassword] = useState('');
  const [signOut, setSignOut] = useState(true);
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => setForm({ username: user.username, email: user.email || '', role: user.role }), [user]);

  const run = async (fn) => {
    setBusy(true);
    try { await fn(); } catch (err) { flash(err.response?.data?.error || 'Something went wrong', true); }
    setBusy(false);
  };
  const ask = (key, fn) => () => {
    if (confirm !== key) { setConfirm(key); setTimeout(() => setConfirm(c => (c === key ? '' : c)), 4000); return; }
    setConfirm('');
    run(fn);
  };
  const dirty = form.username !== user.username || form.email !== (user.email || '') || form.role !== user.role;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <Field label="Username"><input style={{ ...INPUT, width: '100%' }} value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} aria-label="Username" /></Field>
        <Field label="Email"><input style={{ ...INPUT, width: '100%' }} type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} aria-label="Email" /></Field>
        <Field label="Role" small>
          <select style={{ ...SELECT, width: '100%' }} value={form.role} disabled={self} onChange={e => setForm(f => ({ ...f, role: e.target.value }))} aria-label="Role">
            <option value="user">User</option>
            <option value="admin">Admin</option>
          </select>
        </Field>
        <button style={PRIMARY} disabled={busy || !dirty} onClick={() => run(async () => {
          const r = await axios.put(`/api/admin/users/${user.id}`, form);
          flash(r.data.changed.length ? `Saved: ${r.data.changed.join(', ')}` : 'Nothing changed');
          onChanged();
        })}>Save</button>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', fontSize: '12px', color: '#666' }}>
        <span style={{ flex: '1 1 260px' }}>
          Created {when(sqlTime(user.created_at)) || 'a while ago'} · last signed in {user.last_login_at ? `${ago(user.last_login_at)} (${when(user.last_login_at)})` : 'never'}
        </span>
        {onEmail && user.email && (
          <button style={{ ...BTN, display: 'inline-flex', alignItems: 'center', gap: '7px' }} onClick={() => onEmail(user.id)} data-action="email-user">
            <MailIcon size="1.25em" /> Email {user.username}
          </button>
        )}
      </div>

      <div>
        <div style={{ fontSize: '13px', fontWeight: 700, color: '#ccc', marginBottom: '8px' }}>New password</div>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
          <input style={{ ...INPUT, flex: '1 1 200px' }} type="password" placeholder="At least 6 characters" value={password} onChange={e => setPassword(e.target.value)} aria-label="New password for this account" />
          {!self && (
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: '#aaa', cursor: 'pointer' }}>
              <input type="checkbox" checked={signOut} onChange={e => setSignOut(e.target.checked)} style={{ accentColor: '#00c2ff' }} /> Sign out everywhere
            </label>
          )}
          <button style={BTN} disabled={busy || password.length < 6} onClick={() => run(async () => {
            const r = await axios.post(`/api/admin/users/${user.id}/password`, { password, signOut });
            setPassword('');
            flash(`Password changed for ${user.username}${r.data.signedOut ? ' — signed out on every device' : ''}`);
            onChanged();
          })}>Set Password</button>
        </div>
      </div>

      {!self && (
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', paddingTop: '14px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          <button style={BTN} disabled={busy} onClick={ask('signout', async () => {
            await axios.post(`/api/admin/users/${user.id}/sign-out`);
            flash(`${user.username} is signed out on every device`);
            onChanged();
          })}>{confirm === 'signout' ? 'Click again to sign out everywhere' : 'Sign Out Everywhere'}</button>
          <button style={user.status === 'disabled' ? PRIMARY : DANGER} disabled={busy} onClick={ask('status', async () => {
            const next = user.status === 'disabled' ? 'active' : 'disabled';
            await axios.put(`/api/admin/users/${user.id}`, { status: next });
            flash(next === 'disabled' ? `${user.username} is disabled and signed out` : `${user.username} can sign in again`);
            onChanged();
          })}>{confirm === 'status' ? 'Click again to confirm' : user.status === 'disabled' ? 'Enable Account' : 'Disable Account'}</button>
          <button style={{ ...DANGER, ...(confirm === 'delete' ? { background: '#ff4444', color: '#fff', border: '1px solid #ff4444' } : {}) }} disabled={busy} onClick={ask('delete', async () => {
            await axios.delete(`/api/admin/users/${user.id}`);
            flash(`${user.username} removed`);
            onDeleted();
          })}>{confirm === 'delete' ? 'Click again — removes the account, profiles and history' : 'Remove Account'}</button>
        </div>
      )}
    </div>
  );
}

const Field = ({ label, small, children }) => (
  <label style={{ flex: small ? '0 1 130px' : '1 1 200px', display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '12px', fontWeight: 700, color: '#888' }}>
    {label}{children}
  </label>
);

function DevicesTab({ user, sessions, self, flash, onChanged }) {
  const [busy, setBusy] = useState('');
  const signOut = async (s) => {
    setBusy(s.id);
    try {
      await axios.delete(`/api/admin/users/${user.id}/sessions/${s.id}`);
      flash(`Signed out of ${[s.app, s.device].filter(Boolean).join(' · ') || 'that device'}`);
      onChanged();
    } catch (err) { flash(err.response?.data?.error || 'Failed to sign out', true); }
    setBusy('');
  };
  if (!sessions.length) return <div style={{ color: '#555', fontSize: '13px' }}>Not signed in anywhere (in the last 30 days).</div>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {sessions.map(s => (
        <div key={s.id} data-session={s.app} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 12px', borderRadius: '8px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', flexWrap: 'wrap' }}>
          <div style={{ fontSize: '20px', width: '28px', textAlign: 'center' }}>{/TV/i.test(`${s.app} ${s.device}`) ? '📺' : /iOS|iPhone|iPad|Android/i.test(`${s.app} ${s.device}`) ? '📱' : '💻'}</div>
          <div style={{ flex: '1 1 200px', minWidth: 0 }}>
            <div style={{ fontSize: '14px', fontWeight: 600, color: '#ddd' }}>
              {[s.app, s.device].filter(Boolean).join(' · ') || 'Unknown device'}
              {s.current && <span style={{ ...TAG('#00c864'), marginLeft: '8px' }}>This browser</span>}
            </div>
            <div style={{ fontSize: '12px', color: '#666' }}>
              Signed in {when(s.created_at)} · last used {ago(s.last_seen_at)}{s.ip ? ` · ${s.ip}` : ''}
            </div>
          </div>
          {!(self && s.current) && <button style={BTN} disabled={!!busy} onClick={() => signOut(s)}>{busy === s.id ? 'Signing out…' : 'Sign Out'}</button>}
        </div>
      ))}
    </div>
  );
}

// ── Activity log ─────────────────────────────────────────────────────────────

const CATEGORIES = [['', 'Everything'], ['auth', 'Sign-ins'], ['playback', 'Watching'], ['account', 'Account changes'], ['admin', 'Admin actions']];
const COLORS = { auth: '#00c2ff', playback: '#00c864', account: '#b48cff', admin: '#ffb703' };

const DESCRIBE = {
  sign_in: (e) => `signed in${e.detail ? ` with ${e.detail.replace(/^Password$/, 'their password')}` : ''}`,
  sign_in_failed: (e) => `couldn't sign in — ${e.detail || 'unknown reason'}`,
  sign_out: () => 'signed out',
  profile_switch: (e) => (e.detail ? e.detail.replace(/^Switched/, 'switched') : 'switched profile'),
  quick_login_approved: (e) => `approved a Quick Login${e.detail ? ` (${e.detail.replace(/^Approved /, '')})` : ''}`,
  registered: () => 'asked for an account',
  activated: () => 'activated their account with an Admin Passphrase',
  password_changed: () => 'changed their password',
  username_changed: (e) => `changed their username (${e.detail})`,
  profile_added: (e) => (e.detail || 'added a profile').replace(/^Added/, 'added'),
  profile_removed: (e) => (e.detail || 'removed a profile').replace(/^Removed/, 'removed'),
  watch: (e) => `started watching ${e.detail || 'something'}`,
  user_updated: (e) => `changed ${e.detail}`,
  password_reset: (e) => (e.detail || '').replace(/^New password/, 'set a new password'),
  passphrase_created: (e) => `made an ${e.detail}`,
  passphrase_emailed: (e) => (e.detail || 'emailed an Admin Passphrase').replace(/^Emailed/, 'emailed'),
  email_sent: (e) => (e.detail || 'sent an email').replace(/^Emailed/, 'emailed'),
  email_test: (e) => (e.detail || 'sent a test email').replace(/^Sent/, 'sent'),
  email_template_changed: (e) => `reworded the ${e.detail}`,
  email_template_reset: (e) => `put the ${e.detail} back to its default wording`,
  settings_changed: (e) => `changed ${(e.detail || 'settings').replace(/^Settings: /, 'settings: ')}`,
  season_moved: (e) => `moved ${e.detail}`,
  show_merged: (e) => `merged ${e.detail}`,
  title_removed: (e) => `removed ${e.detail}`,
};

export function describe(e) {
  const fn = DESCRIBE[e.action];
  if (fn) return fn(e);
  // Admin actions: the detail says it all.
  return e.detail ? e.detail.charAt(0).toLowerCase() + e.detail.slice(1) : e.action.replace(/_/g, ' ');
}

function EntryList({ items, empty }) {
  if (!items.length) return <div style={{ color: '#555', fontSize: '13px' }}>{empty}</div>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {items.map(e => (
        <div key={e.id} data-action={e.action} style={{ display: 'flex', gap: '12px', padding: '9px 2px', borderBottom: '1px solid rgba(255,255,255,0.04)', alignItems: 'flex-start' }}>
          <span style={{ width: '8px', height: '8px', borderRadius: '50%', marginTop: '6px', flexShrink: 0, background: e.action === 'sign_in_failed' ? '#ff6b6b' : COLORS[e.category] || '#888' }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '13px', color: '#ddd', lineHeight: 1.5 }}>
              <strong style={{ color: '#fff' }}>{e.username || 'Someone'}</strong>
              {e.profile_name && <span style={{ color: '#888' }}> ({e.profile_name})</span>} {describe(e)}
            </div>
            <div style={{ fontSize: '11px', color: '#555' }}>{[e.app, e.device, e.ip].filter(Boolean).join(' · ')}</div>
          </div>
          <span style={{ fontSize: '12px', color: '#666', whiteSpace: 'nowrap' }} title={when(e.at)}>{ago(e.at)}</span>
        </div>
      ))}
    </div>
  );
}

const PAGE = 50;

function ActivityLog({ users, flash }) {
  const [filters, setFilters] = useState({ category: '', user: '', period: '7d', q: '', failed: false });
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [retention, setRetention] = useState(null);
  const [loading, setLoading] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  const params = (offset = 0) => ({
    category: filters.failed ? 'auth' : filters.category || undefined,
    action: filters.failed ? 'sign_in_failed' : undefined,
    user: filters.user || undefined,
    period: filters.period === 'all' ? undefined : filters.period,
    q: filters.q.trim() || undefined,
    limit: PAGE, offset,
  });

  const load = async (offset = 0) => {
    setLoading(true);
    try {
      const { data } = await axios.get('/api/admin/activity', { params: params(offset) });
      setItems(list => (offset ? [...list, ...data.items] : data.items));
      setTotal(data.total);
      setRetention(data.retentionDays);
    } catch { flash('Failed to load the activity log', true); }
    setLoading(false);
  };
  useEffect(() => {
    const timer = setTimeout(() => load(0), 250);
    return () => clearTimeout(timer);
  }, [filters]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k) => (e) => setFilters(f => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  const exportCsv = async () => {
    try {
      const { data } = await axios.get('/api/admin/activity/export', { params: { ...params(), limit: undefined, offset: undefined }, responseType: 'blob' });
      const url = URL.createObjectURL(data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `streamulus-activity-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch { flash('Export failed', true); }
  };

  const saveRetention = async (days) => {
    try {
      const { data } = await axios.put('/api/admin/activity/settings', { retentionDays: Number(days) });
      setRetention(data.retentionDays);
      flash(data.retentionDays ? `Keeping activity for ${data.retentionDays} days` : 'Keeping all activity');
    } catch (err) { flash(err.response?.data?.error || 'Failed to save', true); }
  };

  const clear = async () => {
    if (!confirmClear) { setConfirmClear(true); setTimeout(() => setConfirmClear(false), 4000); return; }
    setConfirmClear(false);
    try {
      const { data } = await axios.delete('/api/admin/activity');
      flash(`Cleared ${data.removed} entries`);
      load(0);
    } catch { flash('Failed to clear the log', true); }
  };

  return (
    <div style={CARD} data-section="activity">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', marginBottom: '6px' }}>
        <h3 style={{ fontSize: '16px', fontWeight: 700 }}>Activity Log</h3>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button style={BTN} onClick={exportCsv}>Export CSV</button>
          <button style={{ ...DANGER, ...(confirmClear ? { background: '#ff4444', color: '#fff' } : {}) }} onClick={clear}>{confirmClear ? 'Click again to clear everything' : 'Clear Log'}</button>
        </div>
      </div>
      <p style={{ color: '#666', fontSize: '13px', marginBottom: '16px', lineHeight: 1.6 }}>
        Sign-ins (and failed attempts), what people start watching, account changes and admin actions — with the app, device and IP address.
      </p>

      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '10px' }}>
        {CATEGORIES.map(([key, label]) => {
          const on = !filters.failed && filters.category === key;
          return (
            <button key={key || 'all'} onClick={() => setFilters(f => ({ ...f, category: key, failed: false }))}
              style={{ ...BTN, padding: '6px 12px', borderRadius: '999px', ...(on ? { background: '#00c2ff', color: '#000', border: '1px solid #00c2ff' } : {}) }}>{label}</button>
          );
        })}
        <button onClick={() => setFilters(f => ({ ...f, failed: !f.failed }))}
          style={{ ...BTN, padding: '6px 12px', borderRadius: '999px', ...(filters.failed ? { background: '#ff4d4d', color: '#fff', border: '1px solid #ff4d4d' } : { color: '#ff8080', border: '1px solid rgba(255,77,77,0.35)' }) }}>Failed sign-ins</button>
      </div>
      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '14px' }}>
        <input style={{ ...INPUT, flex: '1 1 200px' }} placeholder="Search names, titles, IPs, devices…" value={filters.q} onChange={set('q')} aria-label="Search activity" />
        <select style={SELECT} value={filters.user} onChange={set('user')} aria-label="Account">
          <option value="">All accounts</option>
          {users.map(u => <option key={u.id} value={u.id}>{u.username}</option>)}
        </select>
        <select style={SELECT} value={filters.period} onChange={set('period')} aria-label="Period">
          <option value="24h">Last 24 hours</option>
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
          <option value="all">All time</option>
        </select>
      </div>

      <div style={{ fontSize: '12px', color: '#666', marginBottom: '6px' }}>{loading && !items.length ? 'Loading…' : `${total} entr${total === 1 ? 'y' : 'ies'}`}</div>
      <EntryList items={items} empty="Nothing logged for these filters." />
      {items.length < total && (
        <div style={{ textAlign: 'center', marginTop: '12px' }}>
          <button style={BTN} disabled={loading} onClick={() => load(items.length)}>{loading ? 'Loading…' : `Show more (${total - items.length} left)`}</button>
        </div>
      )}

      {retention !== null && (
        <label style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '18px', paddingTop: '14px', borderTop: '1px solid rgba(255,255,255,0.06)', fontSize: '13px', color: '#aaa', flexWrap: 'wrap' }}>
          Keep entries for
          <select style={SELECT} value={String(retention)} onChange={e => saveRetention(e.target.value)} aria-label="Keep entries for">
            {[[30, '30 days'], [90, '90 days'], [180, '6 months'], [365, '1 year'], [0, 'Forever']].map(([v, l]) => <option key={v} value={String(v)}>{l}</option>)}
            {![30, 90, 180, 365, 0].includes(retention) && <option value={String(retention)}>{retention} days</option>}
          </select>
        </label>
      )}
    </div>
  );
}
