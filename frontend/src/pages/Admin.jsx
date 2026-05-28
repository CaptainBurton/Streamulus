import React, { useEffect, useState } from 'react';
import axios from 'axios';
import Navbar from '../components/Navbar';

function StatCard({ label, value, icon }) {
  return (
    <div style={{
      background: 'rgba(255,255,255,0.04)',
      border: '1px solid rgba(255,255,255,0.08)',
      borderRadius: '12px',
      padding: '24px',
      display: 'flex',
      alignItems: 'center',
      gap: '16px',
    }}>
      <div style={{ fontSize: '32px' }}>{icon}</div>
      <div>
        <div style={{ fontSize: '28px', fontWeight: '800', color: '#fff' }}>{value}</div>
        <div style={{ fontSize: '13px', color: '#666', marginTop: '2px' }}>{label}</div>
      </div>
    </div>
  );
}

export default function Admin() {
  const [stats, setStats] = useState(null);
  const [users, setUsers] = useState([]);
  const [config, setConfig] = useState({});
  const [scanning, setScanning] = useState(false);
  const [scanResults, setScanResults] = useState(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [tmdbKey, setTmdbKey] = useState('');
  const [newLib, setNewLib] = useState({ name: '', path: '', type: 'movies' });
  const [newUser, setNewUser] = useState({ username: '', password: '', email: '', role: 'user' });
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

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

  const handleScan = async () => {
    setScanning(true);
    setScanResults(null);
    try {
      const res = await axios.post('/api/admin/scan');
      setScanResults(res.data.results);
      flash('Scan complete!');
      loadData();
    } catch (err) {
      flash(err.response?.data?.error || 'Scan failed', true);
    } finally {
      setScanning(false);
    }
  };

  const handleSaveConfig = async () => {
    try {
      await axios.put('/api/admin/config', { tmdbApiKey: tmdbKey });
      flash('Settings saved!');
      loadData();
    } catch {
      flash('Failed to save settings', true);
    }
  };

  const handleAddLibrary = async (e) => {
    e.preventDefault();
    try {
      await axios.post('/api/admin/libraries', newLib);
      flash('Library added!');
      setNewLib({ name: '', path: '', type: 'movies' });
      loadData();
    } catch (err) {
      flash(err.response?.data?.error || 'Failed to add library', true);
    }
  };

  const handleDeleteLibrary = async (id) => {
    if (!confirm('Delete this library? This will not delete your files.')) return;
    try {
      await axios.delete(`/api/admin/libraries/${id}`);
      flash('Library removed');
      loadData();
    } catch { flash('Failed to delete library', true); }
  };

  const handleAddUser = async (e) => {
    e.preventDefault();
    try {
      await axios.post('/api/admin/users', newUser);
      flash('User created!');
      setNewUser({ username: '', password: '', email: '', role: 'user' });
      loadData();
    } catch (err) {
      flash(err.response?.data?.error || 'Failed to create user', true);
    }
  };

  const handleDeleteUser = async (id) => {
    if (!confirm('Delete this user?')) return;
    try {
      await axios.delete(`/api/admin/users/${id}`);
      flash('User deleted');
      loadData();
    } catch (err) {
      flash(err.response?.data?.error || 'Failed to delete user', true);
    }
  };

  const inputStyle = {
    padding: '10px 14px',
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '8px',
    color: '#fff',
    fontSize: '14px',
    outline: 'none',
    flex: 1,
  };
  const selectStyle = { ...inputStyle, cursor: 'pointer', flex: 'none', width: '130px' };

  const tabs = ['overview', 'libraries', 'users', 'settings'];

  return (
    <div style={{ minHeight: '100vh', background: '#0f0f0f' }}>
      <Navbar />
      <div style={{ padding: '90px 32px 60px', maxWidth: '1100px', margin: '0 auto' }}>
        <h1 style={{ fontSize: '28px', fontWeight: '800', marginBottom: '32px' }}>Admin Dashboard</h1>

        {/* Flash messages */}
        {msg && (
          <div style={{ marginBottom: '20px', padding: '12px 16px', background: 'rgba(0,200,100,0.1)', border: '1px solid rgba(0,200,100,0.2)', borderRadius: '8px', color: '#00c864', fontSize: '14px' }}>
            ✓ {msg}
          </div>
        )}
        {error && (
          <div style={{ marginBottom: '20px', padding: '12px 16px', background: 'rgba(255,68,68,0.1)', border: '1px solid rgba(255,68,68,0.2)', borderRadius: '8px', color: '#ff4444', fontSize: '14px' }}>
            ⚠ {error}
          </div>
        )}

        {/* Tabs */}
        <div style={{ display: 'flex', gap: '4px', marginBottom: '32px', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '0' }}>
          {tabs.map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                padding: '10px 20px',
                background: 'transparent',
                border: 'none',
                borderBottom: activeTab === tab ? '2px solid #00c2ff' : '2px solid transparent',
                color: activeTab === tab ? '#00c2ff' : '#666',
                fontSize: '14px',
                fontWeight: '600',
                cursor: 'pointer',
                textTransform: 'capitalize',
                marginBottom: '-1px',
                transition: 'color 0.15s',
              }}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Overview */}
        {activeTab === 'overview' && (
          <div>
            {stats && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '16px', marginBottom: '32px' }}>
                <StatCard label="Movies" value={stats.movieCount} icon="🎬" />
                <StatCard label="TV Shows" value={stats.showCount} icon="📺" />
                <StatCard label="Episodes" value={stats.episodeCount} icon="🎞" />
                <StatCard label="Users" value={stats.userCount} icon="👥" />
              </div>
            )}

            <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', padding: '24px' }}>
              <h3 style={{ fontSize: '16px', fontWeight: '700', marginBottom: '16px' }}>Media Scan</h3>
              <p style={{ color: '#888', fontSize: '14px', marginBottom: '20px' }}>
                Scan all libraries for new media and fetch metadata from TMDB.
              </p>
              <button
                onClick={handleScan}
                disabled={scanning}
                style={{
                  padding: '12px 28px',
                  background: scanning ? '#333' : '#00c2ff',
                  color: scanning ? '#666' : '#000',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '14px',
                  fontWeight: '700',
                  cursor: scanning ? 'not-allowed' : 'pointer',
                  transition: 'all 0.2s',
                }}
              >
                {scanning ? '⟳ Scanning...' : '⟳ Scan Libraries'}
              </button>

              {scanResults && (
                <div style={{ marginTop: '20px' }}>
                  {scanResults.map((r, i) => (
                    <div key={i} style={{ padding: '8px 14px', background: 'rgba(0,194,255,0.06)', borderRadius: '6px', marginBottom: '6px', fontSize: '14px', color: '#aaa' }}>
                      <strong style={{ color: '#fff' }}>{r.library}:</strong> Found {r.scanned} files, added {r.added} new
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Libraries */}
        {activeTab === 'libraries' && (
          <div>
            <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', padding: '24px', marginBottom: '24px' }}>
              <h3 style={{ fontSize: '16px', fontWeight: '700', marginBottom: '16px' }}>Add Library</h3>
              <form onSubmit={handleAddLibrary} style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                <input style={inputStyle} placeholder="Library name" value={newLib.name}
                  onChange={e => setNewLib(l => ({ ...l, name: e.target.value }))}
                  onFocus={e => { e.target.style.borderColor = '#00c2ff'; }}
                  onBlur={e => { e.target.style.borderColor = 'rgba(255,255,255,0.1)'; }} />
                <input style={inputStyle} placeholder="/movies or /tv" value={newLib.path}
                  onChange={e => setNewLib(l => ({ ...l, path: e.target.value }))}
                  onFocus={e => { e.target.style.borderColor = '#00c2ff'; }}
                  onBlur={e => { e.target.style.borderColor = 'rgba(255,255,255,0.1)'; }} />
                <select style={selectStyle} value={newLib.type}
                  onChange={e => setNewLib(l => ({ ...l, type: e.target.value }))}>
                  <option value="movies">Movies</option>
                  <option value="tv">TV Shows</option>
                </select>
                <button type="submit" style={{ padding: '10px 20px', background: '#00c2ff', color: '#000', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: '700', cursor: 'pointer' }}>
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
                    <div style={{ fontSize: '11px', color: '#00c2ff', marginTop: '4px', textTransform: 'uppercase', fontWeight: '600', letterSpacing: '0.5px' }}>{lib.type}</div>
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
                <div style={{ textAlign: 'center', padding: '40px', color: '#444' }}>No libraries configured</div>
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
                  onFocus={e => { e.target.style.borderColor = '#00c2ff'; }}
                  onBlur={e => { e.target.style.borderColor = 'rgba(255,255,255,0.1)'; }} />
                <input style={inputStyle} type="password" placeholder="Password" value={newUser.password}
                  onChange={e => setNewUser(u => ({ ...u, password: e.target.value }))}
                  onFocus={e => { e.target.style.borderColor = '#00c2ff'; }}
                  onBlur={e => { e.target.style.borderColor = 'rgba(255,255,255,0.1)'; }} />
                <input style={{ ...inputStyle, flex: 'none', width: '200px' }} type="email" placeholder="Email (optional)" value={newUser.email}
                  onChange={e => setNewUser(u => ({ ...u, email: e.target.value }))}
                  onFocus={e => { e.target.style.borderColor = '#00c2ff'; }}
                  onBlur={e => { e.target.style.borderColor = 'rgba(255,255,255,0.1)'; }} />
                <select style={selectStyle} value={newUser.role}
                  onChange={e => setNewUser(u => ({ ...u, role: e.target.value }))}>
                  <option value="user">User</option>
                  <option value="admin">Admin</option>
                </select>
                <button type="submit" style={{ padding: '10px 20px', background: '#00c2ff', color: '#000', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: '700', cursor: 'pointer' }}>
                  Create
                </button>
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
                    <span style={{
                      padding: '3px 10px',
                      borderRadius: '20px',
                      fontSize: '11px',
                      fontWeight: '700',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                      background: user.role === 'admin' ? 'rgba(0,194,255,0.15)' : 'rgba(255,255,255,0.06)',
                      color: user.role === 'admin' ? '#00c2ff' : '#888',
                    }}>
                      {user.role}
                    </span>
                    <button
                      onClick={() => handleDeleteUser(user.id)}
                      style={{ padding: '7px 14px', background: 'transparent', border: '1px solid rgba(255,68,68,0.3)', color: '#ff4444', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' }}
                      onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,68,68,0.1)'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                    >
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
          <div style={{ maxWidth: '560px' }}>
            <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', padding: '28px' }}>
              <h3 style={{ fontSize: '16px', fontWeight: '700', marginBottom: '6px' }}>TMDB API Key</h3>
              <p style={{ color: '#666', fontSize: '14px', marginBottom: '20px' }}>
                Current status: <strong style={{ color: config.tmdbApiKey ? '#00c864' : '#ff4444' }}>
                  {config.tmdbApiKey ? 'Configured' : 'Not set'}
                </strong>
              </p>
              <div style={{ display: 'flex', gap: '10px' }}>
                <input
                  style={{ ...inputStyle }}
                  type="text"
                  placeholder="Enter new TMDB API key"
                  value={tmdbKey}
                  onChange={e => setTmdbKey(e.target.value)}
                  onFocus={e => { e.target.style.borderColor = '#00c2ff'; }}
                  onBlur={e => { e.target.style.borderColor = 'rgba(255,255,255,0.1)'; }}
                />
                <button
                  onClick={handleSaveConfig}
                  style={{ padding: '10px 20px', background: '#00c2ff', color: '#000', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: '700', cursor: 'pointer', flexShrink: 0 }}
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
