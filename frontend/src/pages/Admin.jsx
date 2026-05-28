import React, { useEffect, useState, useRef } from 'react';
import axios from 'axios';
import Navbar from '../components/Navbar';

function StatCard({ label, value, icon }) {
  return (
    <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', padding: '24px', display: 'flex', alignItems: 'center', gap: '16px' }}>
      <div style={{ fontSize: '32px' }}>{icon}</div>
      <div>
        <div style={{ fontSize: '28px', fontWeight: '800' }}>{value}</div>
        <div style={{ fontSize: '13px', color: '#666', marginTop: '2px' }}>{label}</div>
      </div>
    </div>
  );
}

function ProgressBar({ percent }) {
  return (
    <div style={{ background: 'rgba(255,255,255,0.08)', borderRadius: '4px', height: '6px', overflow: 'hidden' }}>
      <div style={{ width: `${percent}%`, height: '100%', background: 'linear-gradient(90deg, #00c2ff, #7b2fff)', borderRadius: '4px', transition: 'width 0.3s ease' }} />
    </div>
  );
}

function ScanProgress({ events, scanning, onClose }) {
  const logRef = useRef(null);
  const lastEvent = events[events.length - 1];
  const completeEvent = events.find(e => e.type === 'complete');

  const currentLib = [...events].reverse().find(e => e.type === 'library_start');
  const progressEvent = [...events].reverse().find(e => e.type === 'scanning');
  const percent = progressEvent?.percent || 0;

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [events]);

  const logLines = events.filter(e => ['library_start', 'library_error', 'found', 'library_done', 'file_error', 'complete', 'error'].includes(e.type));

  return (
    <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', padding: '24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h3 style={{ fontSize: '16px', fontWeight: '700' }}>
          {scanning ? '⟳ Scanning Libraries…' : completeEvent ? '✓ Scan Complete' : 'Scan'}
        </h3>
        {!scanning && <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: '#666', fontSize: '18px', cursor: 'pointer' }}>✕</button>}
      </div>

      {/* Current file progress */}
      {scanning && progressEvent && (
        <div style={{ marginBottom: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
            <span style={{ fontSize: '13px', color: '#888' }}>
              {currentLib?.library} — {progressEvent.index}/{progressEvent.total} files
            </span>
            <span style={{ fontSize: '13px', fontWeight: '700', color: '#00c2ff' }}>{percent}%</span>
          </div>
          <ProgressBar percent={percent} />
          <div style={{ marginTop: '8px', fontSize: '12px', color: '#555', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {progressEvent.file}
          </div>
        </div>
      )}

      {/* Summary on complete */}
      {completeEvent && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginBottom: '20px' }}>
          {[
            { label: 'Added', value: completeEvent.added, color: '#00c864' },
            { label: 'Already existed', value: completeEvent.skipped, color: '#888' },
            { label: 'Errors', value: completeEvent.errors, color: completeEvent.errors > 0 ? '#ff4444' : '#555' },
          ].map(({ label, value, color }) => (
            <div key={label} style={{ background: 'rgba(0,0,0,0.3)', borderRadius: '8px', padding: '14px', textAlign: 'center' }}>
              <div style={{ fontSize: '24px', fontWeight: '800', color }}>{value}</div>
              <div style={{ fontSize: '11px', color: '#555', marginTop: '2px' }}>{label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Event log */}
      <div ref={logRef} style={{ maxHeight: '220px', overflowY: 'auto', fontFamily: 'monospace', fontSize: '12px', lineHeight: '1.8' }}>
        {logLines.map((e, i) => {
          if (e.type === 'library_start') return <div key={i} style={{ color: '#00c2ff' }}>▶ Library: {e.library} ({e.path})</div>;
          if (e.type === 'library_error') return <div key={i} style={{ color: '#ff4444' }}>✕ {e.message}</div>;
          if (e.type === 'found') return <div key={i} style={{ color: '#888' }}>  Found {e.count} video file{e.count !== 1 ? 's' : ''}</div>;
          if (e.type === 'library_done') return <div key={i} style={{ color: '#00c864' }}>  ✓ Done — added {e.added}, skipped {e.skipped}{e.errors > 0 ? `, ${e.errors} errors` : ''}</div>;
          if (e.type === 'file_error') return <div key={i} style={{ color: '#ff4444' }}>  ✕ {e.file}: {e.message}</div>;
          if (e.type === 'complete') return <div key={i} style={{ color: '#00c2ff', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '8px', marginTop: '4px' }}>✓ All libraries scanned. Total added: {e.added}</div>;
          if (e.type === 'error') return <div key={i} style={{ color: '#ff4444' }}>✕ {e.message}</div>;
          return null;
        })}
        {scanning && <div style={{ color: '#555' }}>…</div>}
      </div>
    </div>
  );
}

function PathValidator({ value, onChange, placeholder }) {
  const [status, setStatus] = useState(null);
  const timerRef = useRef(null);

  useEffect(() => {
    setStatus(null);
    if (!value) return;
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      axios.get('/api/admin/validate-path', { params: { path: value } })
        .then(res => setStatus(res.data))
        .catch(() => setStatus(null));
    }, 600);
    return () => clearTimeout(timerRef.current);
  }, [value]);

  return (
    <div style={{ flex: 1, position: 'relative' }}>
      <input
        style={{
          width: '100%', padding: '10px 14px',
          background: 'rgba(255,255,255,0.06)',
          border: `1px solid ${status ? (status.exists ? 'rgba(0,200,100,0.4)' : 'rgba(255,68,68,0.4)') : 'rgba(255,255,255,0.1)'}`,
          borderRadius: '8px', color: '#fff', fontSize: '14px', outline: 'none',
        }}
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={e => onChange(e.target.value)}
        onFocus={e => { if (!status) e.target.style.borderColor = '#00c2ff'; }}
        onBlur={e => { if (!status) e.target.style.borderColor = 'rgba(255,255,255,0.1)'; }}
      />
      {status && (
        <div style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', fontSize: '12px', pointerEvents: 'none', color: status.exists ? '#00c864' : '#ff4444', whiteSpace: 'nowrap' }}>
          {status.exists ? `✓ ${status.fileCount} video file${status.fileCount !== 1 ? 's' : ''}` : '✕ Path not found'}
        </div>
      )}
    </div>
  );
}

function RefreshMetadata() {
  const [running, setRunning] = useState(false);
  const [events, setEvents] = useState([]);
  const [done, setDone] = useState(false);
  const esRef = useRef(null);

  const start = () => {
    setRunning(true);
    setDone(false);
    setEvents([]);
    const token = localStorage.getItem('streamulus_token');
    const es = new EventSource(`/api/admin/refresh-metadata/stream?token=${token}`);
    esRef.current = es;
    es.onmessage = (e) => {
      const ev = JSON.parse(e.data);
      setEvents(prev => [...prev, ev]);
      if (ev.type === 'complete') { setRunning(false); setDone(true); es.close(); }
    };
    es.onerror = () => { setRunning(false); es.close(); };
  };

  useEffect(() => () => esRef.current?.close(), []);

  const last = events[events.length - 1];
  const percent = last?.type === 'progress' ? last.percent : last?.type === 'complete' ? 100 : 0;

  return (
    <div>
      {running && (
        <div style={{ marginBottom: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
            <span style={{ fontSize: '13px', color: '#888' }}>{last?.title || 'Starting…'}</span>
            <span style={{ fontSize: '13px', fontWeight: '700', color: '#00c2ff' }}>{percent}%</span>
          </div>
          <ProgressBar percent={percent} />
        </div>
      )}
      {done && (
        <div style={{ marginBottom: '12px', fontSize: '14px', color: '#00c864' }}>
          ✓ Updated {events.find(e => e.type === 'complete')?.updated} of {events.find(e => e.type === 'complete')?.total} movies
        </div>
      )}
      <button
        onClick={start}
        disabled={running}
        style={{ padding: '10px 24px', background: running ? '#333' : 'rgba(0,194,255,0.15)', color: running ? '#555' : '#00c2ff', border: '1px solid', borderColor: running ? '#333' : 'rgba(0,194,255,0.3)', borderRadius: '8px', fontSize: '14px', fontWeight: '600', cursor: running ? 'not-allowed' : 'pointer' }}
      >
        {running ? '⟳ Refreshing…' : '⟳ Refresh All Metadata'}
      </button>
    </div>
  );
}

export default function Admin() {
  const [stats, setStats] = useState(null);
  const [users, setUsers] = useState([]);
  const [config, setConfig] = useState({});
  const [activeTab, setActiveTab] = useState('overview');
  const [tmdbKey, setTmdbKey] = useState('');
  const [newLib, setNewLib] = useState({ name: '', path: '', type: 'movies' });
  const [newUser, setNewUser] = useState({ username: '', password: '', email: '', role: 'user' });
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  // Scan state
  const [scanning, setScanning] = useState(false);
  const [scanEvents, setScanEvents] = useState([]);
  const [showScan, setShowScan] = useState(false);
  const esRef = useRef(null);

  const flash = (m, isErr = false) => {
    if (isErr) setError(m); else setMsg(m);
    setTimeout(() => { setMsg(''); setError(''); }, 4000);
  };

  const loadData = async () => {
    try {
      const [statsRes, usersRes, configRes] = await Promise.all([
        axios.get('/api/admin/stats'),
        axios.get('/api/admin/users'),
        axios.get('/api/admin/config'),
      ]);
      setStats(statsRes.data);
      setUsers(usersRes.data.users || []);
      setConfig(configRes.data);
    } catch { }
  };

  useEffect(() => { loadData(); }, []);

  const handleScan = () => {
    if (scanning) return;
    setScanEvents([]);
    setShowScan(true);
    setScanning(true);

    const token = localStorage.getItem('streamulus_token');
    const es = new EventSource(`/api/admin/scan/stream?token=${token}`);
    esRef.current = es;

    es.onmessage = (e) => {
      const event = JSON.parse(e.data);
      setScanEvents(prev => [...prev, event]);
      if (event.type === 'complete' || event.type === 'error') {
        setScanning(false);
        es.close();
        loadData();
      }
    };

    es.onerror = () => {
      setScanning(false);
      setScanEvents(prev => [...prev, { type: 'error', message: 'Connection lost. Scan may still be running.' }]);
      es.close();
    };
  };

  useEffect(() => () => esRef.current?.close(), []);

  const handleSaveConfig = async () => {
    try {
      await axios.put('/api/admin/config', { tmdbApiKey: tmdbKey });
      flash('Settings saved!');
      loadData();
    } catch { flash('Failed to save settings', true); }
  };

  const handleAddLibrary = async (e) => {
    e.preventDefault();
    try {
      const res = await axios.post('/api/admin/libraries', newLib);
      const { pathExists, fileCount } = res.data;
      if (!pathExists) {
        flash(`Library added but path "${newLib.path}" was not found inside the container. Make sure the volume is mounted correctly.`, true);
      } else {
        flash(`Library added! Found ${fileCount} video file${fileCount !== 1 ? 's' : ''}. Run a scan to import them.`);
      }
      setNewLib({ name: '', path: '', type: 'movies' });
      loadData();
    } catch (err) { flash(err.response?.data?.error || 'Failed to add library', true); }
  };

  const handleDeleteLibrary = async (id) => {
    if (!confirm('Remove this library? Your files will not be deleted.')) return;
    try {
      await axios.delete(`/api/admin/libraries/${id}`);
      flash('Library removed');
      loadData();
    } catch { flash('Failed to remove library', true); }
  };

  const handleAddUser = async (e) => {
    e.preventDefault();
    try {
      await axios.post('/api/admin/users', newUser);
      flash('User created!');
      setNewUser({ username: '', password: '', email: '', role: 'user' });
      loadData();
    } catch (err) { flash(err.response?.data?.error || 'Failed to create user', true); }
  };

  const handleDeleteUser = async (id) => {
    if (!confirm('Delete this user?')) return;
    try {
      await axios.delete(`/api/admin/users/${id}`);
      flash('User deleted');
      loadData();
    } catch (err) { flash(err.response?.data?.error || 'Failed', true); }
  };

  const inputStyle = { padding: '10px 14px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#fff', fontSize: '14px', outline: 'none', flex: 1 };
  const selectStyle = { ...inputStyle, cursor: 'pointer', flex: 'none', width: '130px' };
  const tabs = ['overview', 'libraries', 'users', 'settings'];

  return (
    <div style={{ minHeight: '100vh', background: '#0f0f0f' }}>
      <Navbar />
      <div style={{ padding: '90px 32px 60px', maxWidth: '1100px', margin: '0 auto' }}>
        <h1 style={{ fontSize: '28px', fontWeight: '800', marginBottom: '32px' }}>Admin Dashboard</h1>

        {msg && <div style={{ marginBottom: '20px', padding: '12px 16px', background: 'rgba(0,200,100,0.1)', border: '1px solid rgba(0,200,100,0.2)', borderRadius: '8px', color: '#00c864', fontSize: '14px' }}>✓ {msg}</div>}
        {error && <div style={{ marginBottom: '20px', padding: '12px 16px', background: 'rgba(255,68,68,0.1)', border: '1px solid rgba(255,68,68,0.2)', borderRadius: '8px', color: '#ff4444', fontSize: '14px' }}>⚠ {error}</div>}

        <div style={{ display: 'flex', gap: '4px', marginBottom: '32px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          {tabs.map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)} style={{ padding: '10px 20px', background: 'transparent', border: 'none', borderBottom: activeTab === tab ? '2px solid #00c2ff' : '2px solid transparent', color: activeTab === tab ? '#00c2ff' : '#666', fontSize: '14px', fontWeight: '600', cursor: 'pointer', textTransform: 'capitalize', marginBottom: '-1px', transition: 'color 0.15s' }}>
              {tab}
            </button>
          ))}
        </div>

        {/* Overview */}
        {activeTab === 'overview' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            {stats && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '16px' }}>
                <StatCard label="Movies" value={stats.movieCount} icon="🎬" />
                <StatCard label="TV Shows" value={stats.showCount} icon="📺" />
                <StatCard label="Episodes" value={stats.episodeCount} icon="🎞" />
                <StatCard label="Users" value={stats.userCount} icon="👥" />
              </div>
            )}

            {/* Scan panel */}
            {showScan ? (
              <ScanProgress events={scanEvents} scanning={scanning} onClose={() => { setShowScan(false); setScanEvents([]); }} />
            ) : (
              <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', padding: '24px' }}>
                <h3 style={{ fontSize: '16px', fontWeight: '700', marginBottom: '8px' }}>Media Scan</h3>
                <p style={{ color: '#888', fontSize: '14px', marginBottom: '20px' }}>
                  Scan all configured libraries for new media and fetch metadata from TMDB.
                </p>
                {stats?.libraries?.length === 0 && (
                  <div style={{ padding: '12px 16px', background: 'rgba(255,200,0,0.08)', border: '1px solid rgba(255,200,0,0.2)', borderRadius: '8px', color: '#ffcc00', fontSize: '13px', marginBottom: '16px' }}>
                    ⚠ No libraries configured. Add a library in the Libraries tab first.
                  </div>
                )}
                <button
                  onClick={handleScan}
                  disabled={scanning || !stats?.libraries?.length}
                  style={{ padding: '12px 28px', background: (scanning || !stats?.libraries?.length) ? '#333' : '#00c2ff', color: (scanning || !stats?.libraries?.length) ? '#555' : '#000', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: '700', cursor: (scanning || !stats?.libraries?.length) ? 'not-allowed' : 'pointer' }}
                >
                  ⟳ Start Scan
                </button>
              </div>
            )}
          </div>
        )}

        {/* Libraries */}
        {activeTab === 'libraries' && (
          <div>
            <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', padding: '24px', marginBottom: '24px' }}>
              <h3 style={{ fontSize: '16px', fontWeight: '700', marginBottom: '8px' }}>Add Library</h3>
              <p style={{ color: '#666', fontSize: '13px', marginBottom: '16px' }}>
                Enter the path <strong style={{ color: '#aaa' }}>inside the container</strong>. Make sure your volume is mapped in docker-compose.yml, e.g. <code style={{ color: '#00c2ff' }}>/your/movies:/movies</code> → enter <code style={{ color: '#00c2ff' }}>/movies</code>
              </p>
              <form onSubmit={handleAddLibrary} style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'flex-start' }}>
                <input style={{ ...inputStyle, flex: '0 1 180px' }} placeholder="Library name" value={newLib.name}
                  onChange={e => setNewLib(l => ({ ...l, name: e.target.value }))}
                  onFocus={e => { e.target.style.borderColor = '#00c2ff'; }}
                  onBlur={e => { e.target.style.borderColor = 'rgba(255,255,255,0.1)'; }} />
                <PathValidator
                  value={newLib.path}
                  onChange={v => setNewLib(l => ({ ...l, path: v }))}
                  placeholder="/movies or /tv"
                />
                <select style={selectStyle} value={newLib.type} onChange={e => setNewLib(l => ({ ...l, type: e.target.value }))}>
                  <option value="movies">Movies</option>
                  <option value="tv">TV Shows</option>
                </select>
                <button type="submit" style={{ padding: '10px 20px', background: '#00c2ff', color: '#000', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: '700', cursor: 'pointer', flexShrink: 0 }}>
                  Add
                </button>
              </form>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {(stats?.libraries || []).map(lib => (
                <div key={lib.id} style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '10px', padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ fontWeight: '600', fontSize: '15px', marginBottom: '4px' }}>{lib.name}</div>
                    <div style={{ fontSize: '13px', color: '#555', fontFamily: 'monospace' }}>{lib.path}</div>
                    <div style={{ display: 'flex', gap: '10px', marginTop: '4px', alignItems: 'center' }}>
                      <span style={{ fontSize: '11px', color: '#00c2ff', textTransform: 'uppercase', fontWeight: '600', letterSpacing: '0.5px' }}>{lib.type}</span>
                      {lib.last_scanned && <span style={{ fontSize: '11px', color: '#444' }}>Last scanned: {new Date(lib.last_scanned).toLocaleString()}</span>}
                    </div>
                  </div>
                  <button
                    onClick={() => handleDeleteLibrary(lib.id)}
                    style={{ padding: '8px 16px', background: 'transparent', border: '1px solid rgba(255,68,68,0.3)', color: '#ff4444', borderRadius: '6px', fontSize: '13px', cursor: 'pointer' }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,68,68,0.1)'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                  >
                    Remove
                  </button>
                </div>
              ))}
              {!stats?.libraries?.length && (
                <div style={{ textAlign: 'center', padding: '40px', color: '#444' }}>No libraries configured yet</div>
              )}
            </div>
          </div>
        )}

        {/* Users */}
        {activeTab === 'users' && (
          <div>
            <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', padding: '24px', marginBottom: '24px' }}>
              <h3 style={{ fontSize: '16px', fontWeight: '700', marginBottom: '16px' }}>Add User</h3>
              <form onSubmit={handleAddUser} style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
                <input style={inputStyle} placeholder="Username" value={newUser.username}
                  onChange={e => setNewUser(u => ({ ...u, username: e.target.value }))}
                  onFocus={e => { e.target.style.borderColor = '#00c2ff'; }} onBlur={e => { e.target.style.borderColor = 'rgba(255,255,255,0.1)'; }} />
                <input style={inputStyle} type="password" placeholder="Password" value={newUser.password}
                  onChange={e => setNewUser(u => ({ ...u, password: e.target.value }))}
                  onFocus={e => { e.target.style.borderColor = '#00c2ff'; }} onBlur={e => { e.target.style.borderColor = 'rgba(255,255,255,0.1)'; }} />
                <input style={{ ...inputStyle, flex: '0 1 200px' }} type="email" placeholder="Email (optional)" value={newUser.email}
                  onChange={e => setNewUser(u => ({ ...u, email: e.target.value }))}
                  onFocus={e => { e.target.style.borderColor = '#00c2ff'; }} onBlur={e => { e.target.style.borderColor = 'rgba(255,255,255,0.1)'; }} />
                <select style={selectStyle} value={newUser.role} onChange={e => setNewUser(u => ({ ...u, role: e.target.value }))}>
                  <option value="user">User</option>
                  <option value="admin">Admin</option>
                </select>
                <button type="submit" style={{ padding: '10px 20px', background: '#00c2ff', color: '#000', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: '700', cursor: 'pointer' }}>Create</button>
              </form>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {users.map(user => (
                <div key={user.id} style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '10px', padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                    <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: 'linear-gradient(135deg, #00c2ff, #7b2fff)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px', fontWeight: '700' }}>
                      {user.username[0].toUpperCase()}
                    </div>
                    <div>
                      <div style={{ fontWeight: '600', fontSize: '15px' }}>{user.username}</div>
                      <div style={{ fontSize: '12px', color: '#555' }}>{user.email || 'No email'}</div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <span style={{ padding: '3px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.5px', background: user.role === 'admin' ? 'rgba(0,194,255,0.15)' : 'rgba(255,255,255,0.06)', color: user.role === 'admin' ? '#00c2ff' : '#888' }}>{user.role}</span>
                    <button onClick={() => handleDeleteUser(user.id)} style={{ padding: '7px 14px', background: 'transparent', border: '1px solid rgba(255,68,68,0.3)', color: '#ff4444', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' }}
                      onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,68,68,0.1)'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}>
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Settings */}
        {activeTab === 'settings' && (
          <div style={{ maxWidth: '560px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', padding: '28px' }}>
              <h3 style={{ fontSize: '16px', fontWeight: '700', marginBottom: '6px' }}>TMDB API Key</h3>
              <p style={{ color: '#666', fontSize: '14px', marginBottom: '20px' }}>
                Current status: <strong style={{ color: config.tmdbApiKey ? '#00c864' : '#ff4444' }}>{config.tmdbApiKey ? 'Configured' : 'Not set'}</strong>
                <br /><span style={{ fontSize: '12px' }}>Without a TMDB key, media will still be imported but without posters or descriptions.</span>
              </p>
              <div style={{ display: 'flex', gap: '10px' }}>
                <input style={{ ...inputStyle }} type="text" placeholder="Enter TMDB v3 API key" value={tmdbKey}
                  onChange={e => setTmdbKey(e.target.value)}
                  onFocus={e => { e.target.style.borderColor = '#00c2ff'; }}
                  onBlur={e => { e.target.style.borderColor = 'rgba(255,255,255,0.1)'; }} />
                <button onClick={handleSaveConfig} style={{ padding: '10px 20px', background: '#00c2ff', color: '#000', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: '700', cursor: 'pointer', flexShrink: 0 }}>Save</button>
              </div>
            </div>

            <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', padding: '28px' }}>
              <h3 style={{ fontSize: '16px', fontWeight: '700', marginBottom: '6px' }}>Refresh Artwork & Metadata</h3>
              <p style={{ color: '#666', fontSize: '14px', marginBottom: '20px' }}>
                Re-fetch posters, backdrops, ratings, and overviews for all movies already in your library. Run this after adding your TMDB API key.
              </p>
              <RefreshMetadata />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
