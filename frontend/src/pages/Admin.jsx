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
  const fileLogRef = useRef(null);
  const completeEvent = events.find(e => e.type === 'complete');

  // Latest progress tick (file_start or file_done)
  const progressEvent = [...events].reverse().find(e => e.type === 'file_start' || e.type === 'file_done');
  const currentFile = scanning ? [...events].reverse().find(e => e.type === 'file_start') : null;
  // Only show spinner for file_start that hasn't been resolved by a file_done yet
  const processingFile = scanning && currentFile &&
    !events.some(e => (e.type === 'file_done' || e.type === 'file_error') && e.file === currentFile.file && events.indexOf(e) > events.indexOf(currentFile))
    ? currentFile : null;

  const currentLib = [...events].reverse().find(e => e.type === 'library_start');
  const percent = completeEvent ? 100 : progressEvent?.percent || 0;

  // Individual file result rows
  const fileResults = events.filter(e => e.type === 'file_done' || e.type === 'file_error');

  // Library-level messages
  const libMessages = events.filter(e => ['library_start', 'library_error', 'found', 'library_done', 'error'].includes(e.type));

  useEffect(() => {
    if (fileLogRef.current) fileLogRef.current.scrollTop = fileLogRef.current.scrollHeight;
  }, [fileResults.length]);

  return (
    <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', padding: '24px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h3 style={{ fontSize: '16px', fontWeight: '700' }}>
          {scanning ? '⟳ Scanning Libraries…' : completeEvent ? '✓ Scan Complete' : 'Scan'}
        </h3>
        {!scanning && (
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: '#666', fontSize: '18px', cursor: 'pointer', lineHeight: 1 }}>✕</button>
        )}
      </div>

      {/* Progress bar + current file */}
      {(scanning || completeEvent) && progressEvent && (
        <div style={{ marginBottom: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
            <span style={{ fontSize: '13px', color: '#888' }}>
              {currentLib?.library} — {progressEvent.index}/{progressEvent.total} files
            </span>
            <span style={{ fontSize: '13px', fontWeight: '700', color: '#00c2ff' }}>{percent}%</span>
          </div>
          <ProgressBar percent={percent} />
          {processingFile && (
            <div style={{ marginTop: '8px', fontSize: '12px', color: '#555', display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden' }}>
              <span style={{ animation: 'spin 1s linear infinite', display: 'inline-block', flexShrink: 0 }}>⟳</span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{processingFile.file}</span>
            </div>
          )}
        </div>
      )}

      {/* Summary stats on complete */}
      {completeEvent && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginBottom: '20px' }}>
          {[
            { label: 'Added', value: completeEvent.added, color: '#00c864' },
            { label: 'Already in library', value: completeEvent.skipped, color: '#888' },
            { label: 'Errors', value: completeEvent.errors, color: completeEvent.errors > 0 ? '#ff4444' : '#555' },
          ].map(({ label, value, color }) => (
            <div key={label} style={{ background: 'rgba(0,0,0,0.3)', borderRadius: '8px', padding: '14px', textAlign: 'center' }}>
              <div style={{ fontSize: '24px', fontWeight: '800', color }}>{value}</div>
              <div style={{ fontSize: '11px', color: '#555', marginTop: '2px' }}>{label}</div>
            </div>
          ))}
        </div>
      )}

      {/* File-by-file results log */}
      <div ref={fileLogRef} style={{ maxHeight: '280px', overflowY: 'auto', fontFamily: 'monospace', fontSize: '12px', lineHeight: '1.75', borderRadius: '6px', background: 'rgba(0,0,0,0.2)', padding: '10px 12px' }}>
        {/* Library-level messages */}
        {libMessages.map((e, i) => {
          if (e.type === 'library_start') return (
            <div key={`lib-${i}`} style={{ color: '#00c2ff', marginTop: i > 0 ? '8px' : 0 }}>
              ▶ {e.library} <span style={{ color: '#444' }}>({e.path})</span>
            </div>
          );
          if (e.type === 'library_error') return <div key={`lib-${i}`} style={{ color: '#ff4444' }}>✕ {e.message}</div>;
          if (e.type === 'found') return <div key={`lib-${i}`} style={{ color: '#555' }}>  Found {e.count} file{e.count !== 1 ? 's' : ''}</div>;
          if (e.type === 'library_done') return (
            <div key={`lib-${i}`} style={{ color: '#00c864', borderTop: '1px solid rgba(255,255,255,0.05)', marginTop: '6px', paddingTop: '6px' }}>
              ✓ {e.library} done — {e.added} added, {e.skipped} skipped{e.errors > 0 ? `, ${e.errors} errors` : ''}
            </div>
          );
          if (e.type === 'error') return <div key={`lib-${i}`} style={{ color: '#ff4444' }}>✕ {e.message}</div>;
          return null;
        })}

        {/* Individual file results */}
        {fileResults.map((e, i) => {
          if (e.type === 'file_done') {
            const isAdded = e.result === 'added';
            return (
              <div key={`f-${i}`} style={{ display: 'flex', gap: '8px', alignItems: 'baseline', color: isAdded ? '#ccc' : '#444' }}>
                <span style={{ color: isAdded ? '#00c864' : '#3a3a3a', flexShrink: 0 }}>{isAdded ? '✓' : '→'}</span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }} title={e.title}>{e.title}</span>
                <span style={{ color: isAdded ? '#00c864' : '#2a2a2a', fontSize: '11px', flexShrink: 0 }}>
                  {isAdded ? 'added' : 'exists'}
                </span>
              </div>
            );
          }
          if (e.type === 'file_error') {
            return (
              <div key={`f-${i}`} style={{ color: '#ff4444', display: 'flex', gap: '8px' }}>
                <span style={{ flexShrink: 0 }}>✕</span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }} title={`${e.file}: ${e.message}`}>
                  {e.file}: {e.message}
                </span>
              </div>
            );
          }
          return null;
        })}

        {/* Currently processing indicator */}
        {processingFile && (
          <div style={{ color: '#555', display: 'flex', gap: '8px' }}>
            <span style={{ flexShrink: 0 }}>⟳</span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{processingFile.file}</span>
          </div>
        )}
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
      {done && (() => {
        const c = events.find(e => e.type === 'complete');
        return (
          <div style={{ marginBottom: '12px', fontSize: '14px', color: '#00c864' }}>
            ✓ Updated {c?.moviesUpdated ?? 0} movie{c?.moviesUpdated !== 1 ? 's' : ''} and {c?.showsUpdated ?? 0} TV show{c?.showsUpdated !== 1 ? 's' : ''} (of {c?.total} total)
          </div>
        );
      })()}
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

function FixDuplicates() {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);

  const run = async () => {
    setRunning(true);
    setResult(null);
    try {
      const r = await axios.post('/api/admin/tv/deduplicate');
      setResult(r.data);
    } catch (e) {
      setResult({ error: e.response?.data?.error || e.message });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div>
      {result && !result.error && (
        <div style={{ marginBottom: '12px', fontSize: '14px', color: result.merged > 0 ? '#00c864' : '#888' }}>
          {result.merged > 0 ? `✓ Merged ${result.merged} duplicate show${result.merged !== 1 ? 's' : ''}` : '✓ No duplicates found'}
        </div>
      )}
      {result?.error && (
        <div style={{ marginBottom: '12px', fontSize: '14px', color: '#ff4444' }}>⚠ {result.error}</div>
      )}
      <button
        onClick={run}
        disabled={running}
        style={{ padding: '10px 24px', background: running ? '#333' : 'rgba(0,194,255,0.15)', color: running ? '#555' : '#00c2ff', border: '1px solid', borderColor: running ? '#333' : 'rgba(0,194,255,0.3)', borderRadius: '8px', fontSize: '14px', fontWeight: '600', cursor: running ? 'not-allowed' : 'pointer' }}
      >
        {running ? 'Scanning…' : 'Fix Duplicate Shows'}
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
  const [tmdbVisible, setTmdbVisible] = useState(false);
  const [tvdbKey, setTvdbKey] = useState('');
  const [tvdbVisible, setTvdbVisible] = useState(false);
  const [omdbKey, setOmdbKey] = useState('');
  const [omdbVisible, setOmdbVisible] = useState(false);
  const [imdbKey, setImdbKey] = useState('');
  const [imdbVisible, setImdbVisible] = useState(false);
  const [movieSourceOrder, setMovieSourceOrder] = useState(['tmdb', 'imdb']);
  const [tvSourceOrder, setTvSourceOrder] = useState(['tvdb', 'tmdb', 'imdb']);
  const [preferredLanguage, setPreferredLanguage] = useState('en');
  const [preferredCountry, setPreferredCountry] = useState('US');
  const [debugLogs, setDebugLogs] = useState(() => localStorage.getItem('streamulus_debug_logs') === 'true');
  const [encSettings, setEncSettings] = useState({
    videoCrf: '23', videoPreset: 'ultrafast', videoResolution: 'original',
    audioBitrate: '192k', audioChannels: '2', hlsSegmentDuration: '4', progressMinSeconds: '10',
  });
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
      setTmdbKey(configRes.data.tmdbApiKey || '');
      setTvdbKey(configRes.data.tvdbApiKey || '');
      setOmdbKey(configRes.data.omdbApiKey || '');
      setImdbKey(configRes.data.imdbApiKey || '');
      setMovieSourceOrder(configRes.data.movieSourceOrder || ['tmdb', 'imdb']);
      setTvSourceOrder(configRes.data.tvSourceOrder || ['tvdb', 'tmdb', 'imdb']);
      setEncSettings({
        videoCrf: configRes.data.videoCrf || '23',
        videoPreset: configRes.data.videoPreset || 'ultrafast',
        videoResolution: configRes.data.videoResolution || 'original',
        audioBitrate: configRes.data.audioBitrate || '192k',
        audioChannels: configRes.data.audioChannels || '2',
        hlsSegmentDuration: configRes.data.hlsSegmentDuration || '4',
        progressMinSeconds: configRes.data.progressMinSeconds || '10',
      });
      setPreferredLanguage(configRes.data.preferredLanguage || 'en');
      setPreferredCountry(configRes.data.preferredCountry || 'US');
    } catch { }
  };

  useEffect(() => { loadData(); }, []);

  const startScan = (libraryId = null) => {
    if (scanning) return;
    setScanEvents([]);
    setShowScan(true);
    setScanning(true);
    const token = localStorage.getItem('streamulus_token');
    const url = `/api/admin/scan/stream?token=${token}${libraryId ? `&libraryId=${libraryId}` : ''}`;
    const es = new EventSource(url);
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

  const handleScan = () => startScan(null);

  useEffect(() => () => esRef.current?.close(), []);

  const handleSaveConfig = async () => {
    try {
      await axios.put('/api/admin/config', { tmdbApiKey: tmdbKey });
      flash('Settings saved!');
      loadData();
    } catch { flash('Failed to save settings', true); }
  };

  const handleSaveTVDB = async () => {
    try {
      await axios.put('/api/admin/config', { tvdbApiKey: tvdbKey });
      flash('TVDB key saved!');
      loadData();
    } catch { flash('Failed to save TVDB key', true); }
  };

  const handleSaveOMDb = async () => {
    try {
      await axios.put('/api/admin/config', { omdbApiKey: omdbKey });
      flash('OMDb key saved!');
      loadData();
    } catch { flash('Failed to save OMDb key', true); }
  };

  const handleSaveIMDb = async () => {
    try {
      await axios.put('/api/admin/config', { imdbApiKey: imdbKey });
      flash('IMDb key saved!');
      loadData();
    } catch { flash('Failed to save IMDb key', true); }
  };

  const handleSaveSources = async () => {
    try {
      await axios.put('/api/admin/config', { movieSourceOrder, tvSourceOrder });
      flash('Metadata sources saved!');
      loadData();
    } catch { flash('Failed to save metadata sources', true); }
  };

  const handleSaveEncoding = async () => {
    try {
      await axios.put('/api/admin/config', encSettings);
      flash('Encoding settings saved — applies to next video played.');
    } catch { flash('Failed to save encoding settings', true); }
  };

  const handleSaveRegional = async () => {
    try {
      await axios.put('/api/admin/config', { preferredLanguage, preferredCountry });
      flash('Regional settings saved!');
    } catch { flash('Failed to save regional settings', true); }
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
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <button
                      onClick={() => { setActiveTab('overview'); startScan(lib.id); }}
                      disabled={scanning}
                      style={{ padding: '8px 16px', background: scanning ? 'transparent' : 'rgba(0,194,255,0.1)', border: '1px solid', borderColor: scanning ? 'rgba(255,255,255,0.08)' : 'rgba(0,194,255,0.3)', color: scanning ? '#444' : '#00c2ff', borderRadius: '6px', fontSize: '13px', cursor: scanning ? 'not-allowed' : 'pointer', fontWeight: '600' }}
                      onMouseEnter={e => { if (!scanning) e.currentTarget.style.background = 'rgba(0,194,255,0.2)'; }}
                      onMouseLeave={e => { if (!scanning) e.currentTarget.style.background = 'rgba(0,194,255,0.1)'; }}
                    >
                      ⟳ Scan
                    </button>
                    <button
                      onClick={() => handleDeleteLibrary(lib.id)}
                      style={{ padding: '8px 16px', background: 'transparent', border: '1px solid rgba(255,68,68,0.3)', color: '#ff4444', borderRadius: '6px', fontSize: '13px', cursor: 'pointer' }}
                      onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,68,68,0.1)'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                    >
                      Remove
                    </button>
                  </div>
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
          <div style={{ maxWidth: '620px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {/* TMDB API Key */}
            <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', padding: '28px' }}>
              <h3 style={{ fontSize: '16px', fontWeight: '700', marginBottom: '6px' }}>TMDB API Key</h3>
              <p style={{ color: '#666', fontSize: '14px', marginBottom: '20px' }}>
                Current status: <strong style={{ color: config.tmdbApiKey ? '#00c864' : '#ff4444' }}>{config.tmdbApiKey ? 'Configured' : 'Not set'}</strong>
                <br /><span style={{ fontSize: '12px' }}>Without a TMDB key, media will still be imported but without posters or descriptions.</span>
              </p>
              <div style={{ display: 'flex', gap: '10px' }}>
                <div style={{ position: 'relative', flex: 1 }}>
                  <input
                    style={{ ...inputStyle, paddingRight: '44px', width: '100%', boxSizing: 'border-box' }}
                    type={tmdbVisible ? 'text' : 'password'}
                    placeholder="Enter TMDB v3 API key"
                    value={tmdbKey}
                    onChange={e => setTmdbKey(e.target.value)}
                    onFocus={e => { e.target.style.borderColor = '#00c2ff'; }}
                    onBlur={e => { e.target.style.borderColor = 'rgba(255,255,255,0.1)'; }}
                  />
                  <button
                    type="button"
                    onClick={() => setTmdbVisible(v => !v)}
                    style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px', color: '#666', display: 'flex', alignItems: 'center' }}
                    title={tmdbVisible ? 'Hide key' : 'Show key'}
                  >
                    {tmdbVisible ? (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                        <line x1="1" y1="1" x2="23" y2="23"/>
                      </svg>
                    ) : (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                        <circle cx="12" cy="12" r="3"/>
                      </svg>
                    )}
                  </button>
                </div>
                <button onClick={handleSaveConfig} style={{ padding: '10px 20px', background: '#00c2ff', color: '#000', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: '700', cursor: 'pointer', flexShrink: 0 }}>Save</button>
              </div>
            </div>

            {/* TVDB API Key */}
            <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', padding: '28px' }}>
              <h3 style={{ fontSize: '16px', fontWeight: '700', marginBottom: '6px' }}>TVDB API Key</h3>
              <p style={{ color: '#666', fontSize: '14px', marginBottom: '20px' }}>
                Current status: <strong style={{ color: config.tvdbApiKey ? '#00c864' : '#ff4444' }}>{config.tvdbApiKey ? 'Configured' : 'Not set'}</strong>
                <br /><span style={{ fontSize: '12px' }}>Used for TV show metadata and episode details. When set, TVDB is preferred over TMDB for TV shows. Get a free key at <span style={{ color: '#00c2ff' }}>thetvdb.com</span>.</span>
              </p>
              <div style={{ display: 'flex', gap: '10px' }}>
                <div style={{ position: 'relative', flex: 1 }}>
                  <input
                    style={{ ...inputStyle, paddingRight: '44px', width: '100%', boxSizing: 'border-box' }}
                    type={tvdbVisible ? 'text' : 'password'}
                    placeholder="Enter TVDB v4 API key"
                    value={tvdbKey}
                    onChange={e => setTvdbKey(e.target.value)}
                    onFocus={e => { e.target.style.borderColor = '#00c2ff'; }}
                    onBlur={e => { e.target.style.borderColor = 'rgba(255,255,255,0.1)'; }}
                  />
                  <button
                    type="button"
                    onClick={() => setTvdbVisible(v => !v)}
                    style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px', color: '#666', display: 'flex', alignItems: 'center' }}
                    title={tvdbVisible ? 'Hide key' : 'Show key'}
                  >
                    {tvdbVisible ? (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                        <line x1="1" y1="1" x2="23" y2="23"/>
                      </svg>
                    ) : (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                        <circle cx="12" cy="12" r="3"/>
                      </svg>
                    )}
                  </button>
                </div>
                <button onClick={handleSaveTVDB} style={{ padding: '10px 20px', background: '#00c2ff', color: '#000', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: '700', cursor: 'pointer', flexShrink: 0 }}>Save</button>
              </div>
            </div>

            {/* OMDb / IMDb API Key */}
            <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', padding: '28px' }}>
              <h3 style={{ fontSize: '16px', fontWeight: '700', marginBottom: '6px' }}>OMDb API Key <span style={{ fontSize: '12px', color: '#f5c518', fontWeight: '600', marginLeft: '8px' }}>IMDb</span></h3>
              <p style={{ color: '#666', fontSize: '14px', marginBottom: '20px' }}>
                Current status: <strong style={{ color: config.omdbApiKey ? '#00c864' : '#ff4444' }}>{config.omdbApiKey ? 'Configured' : 'Not set'}</strong>
                <br /><span style={{ fontSize: '12px' }}>Used to fetch IMDb ratings, content ratings (PG-13, TV-MA), and IMDb IDs for movies and TV shows. Free key (1000 req/day) at <span style={{ color: '#00c2ff' }}>omdbapi.com</span>. Run Refresh Metadata after adding key.</span>
              </p>
              <div style={{ display: 'flex', gap: '10px' }}>
                <div style={{ position: 'relative', flex: 1 }}>
                  <input
                    style={{ ...inputStyle, paddingRight: '44px', width: '100%', boxSizing: 'border-box' }}
                    type={omdbVisible ? 'text' : 'password'}
                    placeholder="Enter OMDb API key"
                    value={omdbKey}
                    onChange={e => setOmdbKey(e.target.value)}
                    onFocus={e => { e.target.style.borderColor = '#00c2ff'; }}
                    onBlur={e => { e.target.style.borderColor = 'rgba(255,255,255,0.1)'; }}
                  />
                  <button
                    type="button"
                    onClick={() => setOmdbVisible(v => !v)}
                    style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px', color: '#666', display: 'flex', alignItems: 'center' }}
                    title={omdbVisible ? 'Hide key' : 'Show key'}
                  >
                    {omdbVisible ? (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                        <line x1="1" y1="1" x2="23" y2="23"/>
                      </svg>
                    ) : (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                        <circle cx="12" cy="12" r="3"/>
                      </svg>
                    )}
                  </button>
                </div>
                <button onClick={handleSaveOMDb} style={{ padding: '10px 20px', background: '#00c2ff', color: '#000', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: '700', cursor: 'pointer', flexShrink: 0 }}>Save</button>
              </div>
            </div>

            {/* IMDb API Key */}
            <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', padding: '28px' }}>
              <h3 style={{ fontSize: '16px', fontWeight: '700', marginBottom: '6px' }}>IMDb API Key <span style={{ fontSize: '12px', color: '#f5c518', fontWeight: '600', marginLeft: '8px' }}>imdb-api.com</span></h3>
              <p style={{ color: '#666', fontSize: '14px', marginBottom: '20px' }}>
                Current status: <strong style={{ color: config.imdbApiKey ? '#00c864' : '#ff4444' }}>{config.imdbApiKey ? 'Configured' : 'Not set'}</strong>
                <br /><span style={{ fontSize: '12px' }}>When set as primary source, fetches full metadata (posters, overviews, genres) directly from IMDb. Free key (100 req/day) or paid at <span style={{ color: '#00c2ff' }}>imdb-api.com</span>. Select IMDb as source below after adding key.</span>
              </p>
              <div style={{ display: 'flex', gap: '10px' }}>
                <div style={{ position: 'relative', flex: 1 }}>
                  <input
                    style={{ ...inputStyle, paddingRight: '44px', width: '100%', boxSizing: 'border-box' }}
                    type={imdbVisible ? 'text' : 'password'}
                    placeholder="Enter imdb-api.com API key"
                    value={imdbKey}
                    onChange={e => setImdbKey(e.target.value)}
                    onFocus={e => { e.target.style.borderColor = '#00c2ff'; }}
                    onBlur={e => { e.target.style.borderColor = 'rgba(255,255,255,0.1)'; }}
                  />
                  <button
                    type="button"
                    onClick={() => setImdbVisible(v => !v)}
                    style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px', color: '#666', display: 'flex', alignItems: 'center' }}
                    title={imdbVisible ? 'Hide key' : 'Show key'}
                  >
                    {imdbVisible ? (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                        <line x1="1" y1="1" x2="23" y2="23"/>
                      </svg>
                    ) : (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                        <circle cx="12" cy="12" r="3"/>
                      </svg>
                    )}
                  </button>
                </div>
                <button onClick={handleSaveIMDb} style={{ padding: '10px 20px', background: '#00c2ff', color: '#000', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: '700', cursor: 'pointer', flexShrink: 0 }}>Save</button>
              </div>
            </div>

            {/* Metadata Source Priority */}
            <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', padding: '28px' }}>
              <h3 style={{ fontSize: '16px', fontWeight: '700', marginBottom: '6px' }}>Metadata Source Priority</h3>
              <p style={{ color: '#666', fontSize: '14px', marginBottom: '24px' }}>
                Sources are tried top-to-bottom. If the first source returns no result, the next is tried automatically. OMDb always runs as a supplement to add IMDb ratings.
              </p>

              {(() => {
                const SOURCE_INFO = {
                  tmdb: { label: 'TMDB', sub: 'The Movie Database', configured: !!config.tmdbApiKey },
                  tvdb: { label: 'TVDB', sub: 'TheTVDB', configured: !!config.tvdbApiKey },
                  imdb: { label: 'IMDb', sub: 'imdb-api.com', configured: !!config.imdbApiKey },
                };
                const btnBase = { width: '28px', height: '28px', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', background: 'rgba(255,255,255,0.04)', color: '#888', cursor: 'pointer', fontSize: '13px', display: 'flex', alignItems: 'center', justifyContent: 'center' };
                const move = (arr, setArr, idx, dir) => {
                  const next = [...arr];
                  const t = idx + dir;
                  if (t < 0 || t >= next.length) return;
                  [next[idx], next[t]] = [next[t], next[idx]];
                  setArr(next);
                };

                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                    {[
                      { label: 'Movies', order: movieSourceOrder, setOrder: setMovieSourceOrder },
                      { label: 'TV Shows', order: tvSourceOrder, setOrder: setTvSourceOrder },
                    ].map(({ label, order, setOrder }) => (
                      <div key={label}>
                        <div style={{ fontSize: '11px', color: '#444', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '10px' }}>{label}</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          {order.map((src, i) => {
                            const info = SOURCE_INFO[src];
                            return (
                              <div key={src} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px', background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '8px' }}>
                                <span style={{ fontSize: '12px', color: '#444', width: '18px', textAlign: 'center', fontWeight: '800', flexShrink: 0 }}>{i + 1}</span>
                                <div style={{ flex: 1 }}>
                                  <span style={{ fontSize: '14px', fontWeight: '700', color: info.configured ? '#fff' : '#555' }}>{info.label}</span>
                                  <span style={{ fontSize: '12px', color: '#444', marginLeft: '8px' }}>{info.sub}</span>
                                  {!info.configured && <span style={{ fontSize: '11px', color: '#c04', marginLeft: '8px', fontWeight: '600' }}>no key set</span>}
                                </div>
                                <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
                                  <button
                                    onClick={() => move(order, setOrder, i, -1)}
                                    disabled={i === 0}
                                    style={{ ...btnBase, opacity: i === 0 ? 0.25 : 1 }}
                                    title="Move up"
                                  >↑</button>
                                  <button
                                    onClick={() => move(order, setOrder, i, 1)}
                                    disabled={i === order.length - 1}
                                    style={{ ...btnBase, opacity: i === order.length - 1 ? 0.25 : 1 }}
                                    title="Move down"
                                  >↓</button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })()}

              <button
                onClick={handleSaveSources}
                style={{ marginTop: '24px', padding: '10px 24px', background: '#00c2ff', color: '#000', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: '700', cursor: 'pointer' }}
              >
                Save Priority
              </button>
            </div>

            {/* Fix Duplicate Shows */}
            <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', padding: '28px' }}>
              <h3 style={{ fontSize: '16px', fontWeight: '700', marginBottom: '6px' }}>Fix Duplicate TV Shows</h3>
              <p style={{ color: '#666', fontSize: '14px', marginBottom: '20px' }}>
                Merge TV shows that were scanned as separate entries due to slight filename differences (e.g. "American Dad" vs "American Dad!"). All episodes will be moved to the oldest matching entry.
              </p>
              <FixDuplicates />
            </div>

            {/* Transcoding & Streaming */}
            <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', padding: '28px' }}>
              <h3 style={{ fontSize: '16px', fontWeight: '700', marginBottom: '6px' }}>Transcoding &amp; Streaming</h3>
              <p style={{ color: '#666', fontSize: '14px', marginBottom: '20px' }}>
                Controls how videos are encoded when streamed. Changes apply to new playback sessions.
              </p>

              {/* VIDEO section */}
              <div style={{ fontSize: '11px', color: '#444', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '12px', marginTop: '4px' }}>Video</div>
              {[
                {
                  label: 'Quality',
                  key: 'videoCrf',
                  options: { '18': 'High (larger file, more CPU)', '23': 'Balanced (default)', '28': 'Low (smaller file, less CPU)' },
                },
                {
                  label: 'Speed',
                  key: 'videoPreset',
                  options: { 'ultrafast': 'Ultra Fast (recommended)', 'veryfast': 'Very Fast', 'fast': 'Fast', 'medium': 'Medium (better compression)' },
                },
                {
                  label: 'Max Resolution',
                  key: 'videoResolution',
                  options: { 'original': 'Original (no limit)', '1080': '1080p', '720': '720p', '480': '480p' },
                },
              ].map(({ label, key, options }, i, arr) => (
                <div key={key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0', borderBottom: i < arr.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none' }}>
                  <span style={{ fontSize: '14px', fontWeight: '600', color: '#ccc' }}>{label}</span>
                  <select
                    value={encSettings[key]}
                    onChange={e => setEncSettings(s => ({ ...s, [key]: e.target.value }))}
                    style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#fff', fontSize: '13px', padding: '8px 12px', minWidth: '200px', cursor: 'pointer', outline: 'none' }}
                  >
                    {Object.entries(options).map(([val, lbl]) => (
                      <option key={val} value={val}>{lbl}</option>
                    ))}
                  </select>
                </div>
              ))}

              {/* AUDIO section */}
              <div style={{ fontSize: '11px', color: '#444', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '12px', marginTop: '16px' }}>Audio</div>
              {[
                {
                  label: 'Bitrate',
                  key: 'audioBitrate',
                  options: { '128k': '128 kbps', '192k': '192 kbps (default)', '256k': '256 kbps', '320k': '320 kbps' },
                },
                {
                  label: 'Channels',
                  key: 'audioChannels',
                  options: { '2': 'Stereo (recommended)', 'original': 'Original (keep source channels)' },
                },
              ].map(({ label, key, options }, i, arr) => (
                <div key={key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0', borderBottom: i < arr.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none' }}>
                  <span style={{ fontSize: '14px', fontWeight: '600', color: '#ccc' }}>{label}</span>
                  <select
                    value={encSettings[key]}
                    onChange={e => setEncSettings(s => ({ ...s, [key]: e.target.value }))}
                    style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#fff', fontSize: '13px', padding: '8px 12px', minWidth: '200px', cursor: 'pointer', outline: 'none' }}
                  >
                    {Object.entries(options).map(([val, lbl]) => (
                      <option key={val} value={val}>{lbl}</option>
                    ))}
                  </select>
                </div>
              ))}

              {/* STREAMING section */}
              <div style={{ fontSize: '11px', color: '#444', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '12px', marginTop: '16px' }}>Streaming</div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                <span style={{ fontSize: '14px', fontWeight: '600', color: '#ccc' }}>Segment Size</span>
                <select
                  value={encSettings.hlsSegmentDuration}
                  onChange={e => setEncSettings(s => ({ ...s, hlsSegmentDuration: e.target.value }))}
                  style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#fff', fontSize: '13px', padding: '8px 12px', minWidth: '200px', cursor: 'pointer', outline: 'none' }}
                >
                  <option value="2">2 seconds (precise seeking)</option>
                  <option value="4">4 seconds (default)</option>
                  <option value="6">6 seconds (fewer requests)</option>
                </select>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0' }}>
                <div>
                  <span style={{ fontSize: '14px', fontWeight: '600', color: '#ccc' }}>Resume Threshold</span>
                  <div style={{ fontSize: '12px', color: '#555', marginTop: '3px' }}>Minimum seconds watched before adding to Continue Watching</div>
                </div>
                <select
                  value={encSettings.progressMinSeconds}
                  onChange={e => setEncSettings(s => ({ ...s, progressMinSeconds: e.target.value }))}
                  style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#fff', fontSize: '13px', padding: '8px 12px', minWidth: '200px', cursor: 'pointer', outline: 'none', flexShrink: 0 }}
                >
                  <option value="5">5 seconds</option>
                  <option value="10">10 seconds (default)</option>
                  <option value="15">15 seconds</option>
                  <option value="20">20 seconds</option>
                  <option value="25">25 seconds</option>
                  <option value="30">30 seconds</option>
                </select>
              </div>

              <button
                onClick={handleSaveEncoding}
                style={{ marginTop: '20px', padding: '10px 24px', background: '#00c2ff', color: '#000', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: '700', cursor: 'pointer' }}
              >
                Save Encoding Settings
              </button>
            </div>

            {/* Regional Settings */}
            <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', padding: '28px' }}>
              <h3 style={{ fontSize: '16px', fontWeight: '700', marginBottom: '6px' }}>Regional Settings</h3>
              <p style={{ color: '#666', fontSize: '14px', marginBottom: '24px' }}>
                Preferred language for metadata and country for content ratings (TV-14, BBFC, etc.).
              </p>
              <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: '200px' }}>
                  <label style={{ fontSize: '13px', color: '#888', display: 'block', marginBottom: '8px', fontWeight: '600' }}>Metadata Language</label>
                  <select value={preferredLanguage} onChange={e => setPreferredLanguage(e.target.value)}
                    style={{ ...inputStyle, cursor: 'pointer', width: '100%' }}>
                    <option value="en">English</option>
                    <option value="fr">French</option>
                    <option value="de">German</option>
                    <option value="es">Spanish</option>
                    <option value="it">Italian</option>
                    <option value="pt">Portuguese</option>
                    <option value="ja">Japanese</option>
                    <option value="ko">Korean</option>
                    <option value="zh">Chinese</option>
                    <option value="ru">Russian</option>
                    <option value="ar">Arabic</option>
                    <option value="nl">Dutch</option>
                    <option value="sv">Swedish</option>
                    <option value="no">Norwegian</option>
                    <option value="da">Danish</option>
                    <option value="fi">Finnish</option>
                    <option value="pl">Polish</option>
                    <option value="tr">Turkish</option>
                    <option value="hi">Hindi</option>
                  </select>
                </div>
                <div style={{ flex: 1, minWidth: '200px' }}>
                  <label style={{ fontSize: '13px', color: '#888', display: 'block', marginBottom: '8px', fontWeight: '600' }}>Content Rating Country</label>
                  <select value={preferredCountry} onChange={e => setPreferredCountry(e.target.value)}
                    style={{ ...inputStyle, cursor: 'pointer', width: '100%' }}>
                    <option value="US">United States</option>
                    <option value="GB">United Kingdom</option>
                    <option value="AU">Australia</option>
                    <option value="CA">Canada</option>
                    <option value="IE">Ireland</option>
                    <option value="NZ">New Zealand</option>
                    <option value="DE">Germany</option>
                    <option value="FR">France</option>
                    <option value="ES">Spain</option>
                    <option value="IT">Italy</option>
                    <option value="NL">Netherlands</option>
                    <option value="SE">Sweden</option>
                    <option value="NO">Norway</option>
                    <option value="DK">Denmark</option>
                    <option value="FI">Finland</option>
                    <option value="JP">Japan</option>
                    <option value="KR">South Korea</option>
                    <option value="IN">India</option>
                    <option value="BR">Brazil</option>
                    <option value="MX">Mexico</option>
                    <option value="ZA">South Africa</option>
                  </select>
                </div>
              </div>
              <button
                onClick={handleSaveRegional}
                style={{ marginTop: '20px', padding: '10px 24px', background: '#00c2ff', color: '#000', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: '700', cursor: 'pointer' }}
              >
                Save Regional Settings
              </button>
            </div>

            {/* Refresh Metadata */}
            <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', padding: '28px' }}>
              <h3 style={{ fontSize: '16px', fontWeight: '700', marginBottom: '6px' }}>Refresh Artwork &amp; Metadata</h3>
              <p style={{ color: '#666', fontSize: '14px', marginBottom: '20px' }}>
                Re-fetch posters, backdrops, ratings, and overviews for all movies already in your library. Run this after adding your TMDB API key.
              </p>
              <RefreshMetadata />
            </div>

            {/* Player Diagnostics */}
            <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', padding: '28px' }}>
              <h3 style={{ fontSize: '16px', fontWeight: '700', marginBottom: '6px' }}>Player Diagnostics</h3>
              <p style={{ color: '#666', fontSize: '14px', marginBottom: '20px' }}>
                Debug options for troubleshooting playback issues.
              </p>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0' }}>
                <div>
                  <div style={{ fontSize: '14px', fontWeight: '600', color: '#ccc' }}>Buffering Debug Log</div>
                  <div style={{ fontSize: '12px', color: '#555', marginTop: '3px' }}>Show timestamped debug messages in the loading overlay and error screen</div>
                </div>
                <button
                  onClick={() => {
                    const next = !debugLogs;
                    setDebugLogs(next);
                    localStorage.setItem('streamulus_debug_logs', String(next));
                  }}
                  style={{
                    width: '44px', height: '24px', borderRadius: '12px', border: 'none', cursor: 'pointer', flexShrink: 0,
                    background: debugLogs ? '#00c2ff' : 'rgba(255,255,255,0.1)',
                    position: 'relative', transition: 'background 0.2s',
                  }}
                >
                  <div style={{
                    width: '18px', height: '18px', borderRadius: '50%', background: '#fff',
                    position: 'absolute', top: '3px', transition: 'left 0.2s',
                    left: debugLogs ? '23px' : '3px',
                  }} />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
