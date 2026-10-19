import React, { useEffect, useState } from 'react';
import axios from 'axios';

// Admin › Libraries: how folders and files are named (like Sonarr / Radarr's
// naming settings, which Streamulus reads instead of writes), and tidying the
// library — merging split shows, dropping gone files, and the titles hidden
// from Streamulus but kept on disk.

const CARD = { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', padding: '24px', marginTop: '24px' };
const H3 = { fontSize: '16px', fontWeight: 700, marginBottom: '6px' };
const HINT = { color: '#666', fontSize: '13px', lineHeight: 1.6, marginBottom: '18px' };
const INPUT = { width: '100%', padding: '10px 12px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#fff', fontSize: '14px', outline: 'none', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', boxSizing: 'border-box' };
const LABEL = { display: 'block', fontSize: '12px', fontWeight: 700, color: '#999', marginBottom: '6px' };
const BTN = { padding: '10px 20px', borderRadius: '8px', fontSize: '14px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' };
const PRIMARY = { ...BTN, background: '#00c2ff', color: '#000', border: 'none', fontWeight: 700 };
const SECONDARY = { ...BTN, background: 'rgba(0,194,255,0.12)', color: '#00c2ff', border: '1px solid rgba(0,194,255,0.3)' };
const SMALL = { padding: '6px 12px', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer', background: 'transparent', border: '1px solid rgba(255,255,255,0.15)', color: '#ccc', fontFamily: 'inherit' };

const FIELDS = [
  { key: 'seriesFolder', label: 'Series folder', group: 'tv' },
  { key: 'seasonFolder', label: 'Season folder', group: 'tv' },
  { key: 'specialsFolders', label: 'Specials / extras folders', group: 'tv', hint: 'Comma separated. Files in these folders belong to the show (as Season 0) instead of becoming a separate show.' },
  { key: 'episodeFile', label: 'Episode file', group: 'tv' },
  { key: 'movieFolder', label: 'Movie folder', group: 'movies' },
  { key: 'movieFile', label: 'Movie file', group: 'movies' },
];

const TOKENS = {
  tv: ['{Series Title}', '{Series TitleYear}', '{Year}', '{season:00}', '{episode:00}', '{Episode Title}', '{absolute:000}', '{tvdb-{TvdbId}}', '{tmdb-{TmdbId}}', '{Quality Full}'],
  movies: ['{Movie Title}', '{Release Year}', '{Movie TitleYear}', '{tmdb-{TmdbId}}', '{imdb-{ImdbId}}', '{Edition Tags}', '{Quality Full}'],
};

export function NamingFormats({ flash }) {
  const [data, setData] = useState(null);
  const [formats, setFormats] = useState({});
  const [saving, setSaving] = useState(false);
  const [test, setTest] = useState({ kind: 'tv', path: '' });
  const [testResult, setTestResult] = useState(null);

  const load = () => axios.get('/api/admin/library/naming').then(r => { setData(r.data); setFormats(r.data.formats); }).catch(() => {});
  useEffect(() => { load(); }, []);
  if (!data) return null;

  const changed = FIELDS.some(f => (formats[f.key] || '') !== (data.formats[f.key] || ''));

  const save = async (extra = {}) => {
    setSaving(true);
    try {
      const r = await axios.put('/api/admin/library/naming', { formats, ...extra });
      setData(r.data); setFormats(r.data.formats);
      flash?.('Naming saved — it applies from the next scan. Use Fix Duplicate Shows below to regroup what is already in the library.');
    } catch (err) {
      flash?.(err.response?.data?.error || 'Could not save the naming formats', true);
    }
    setSaving(false);
  };

  const runTest = async (e) => {
    e.preventDefault();
    setTestResult(null);
    try {
      const r = await axios.post('/api/admin/library/naming/test', { ...test, formats });
      setTestResult(r.data);
    } catch (err) {
      setTestResult({ error: err.response?.data?.error || 'Could not test that path' });
    }
  };

  const field = (f) => (
    <div key={f.key}>
      <label style={LABEL} htmlFor={`fmt-${f.key}`}>{f.label}</label>
      <div style={{ display: 'flex', gap: '8px' }}>
        <input id={`fmt-${f.key}`} style={INPUT} value={formats[f.key] || ''} spellCheck={false}
          onChange={e => setFormats(x => ({ ...x, [f.key]: e.target.value }))} />
        {formats[f.key] !== data.defaults[f.key] && (
          <button type="button" style={SMALL} title={`Default: ${data.defaults[f.key]}`}
            onClick={() => setFormats(x => ({ ...x, [f.key]: data.defaults[f.key] }))}>Default</button>
        )}
      </div>
      {f.hint && <div style={{ fontSize: '12px', color: '#555', marginTop: '5px' }}>{f.hint}</div>}
    </div>
  );

  const parsed = testResult?.parsed;
  return (
    <div style={CARD}>
      <h3 style={H3}>Naming</h3>
      <p style={HINT}>
        How your folders and files are named, in the same format as Sonarr and Radarr's naming settings — copy yours across if you use them.
        Streamulus treats everything inside a series folder as one show (so <em>Season 00</em>, <em>Specials</em> or <em>Extras</em> no longer turn into separate shows),
        and reads IDs like <code style={{ color: '#00c2ff' }}>{'{tvdb-81189}'}</code> in folder names for an exact match. Names that don't fit still go through the usual guessing.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '28px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div style={{ fontSize: '12px', fontWeight: 800, color: '#00c2ff', letterSpacing: '1px', textTransform: 'uppercase' }}>TV Shows (Sonarr)</div>
          {FIELDS.filter(f => f.group === 'tv').map(field)}
          <Tokens list={TOKENS.tv} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div style={{ fontSize: '12px', fontWeight: 800, color: '#00c2ff', letterSpacing: '1px', textTransform: 'uppercase' }}>Movies (Radarr)</div>
          {FIELDS.filter(f => f.group === 'movies').map(field)}
          <Tokens list={TOKENS.movies} />
        </div>
      </div>

      <div style={{ display: 'flex', gap: '10px', marginTop: '20px', flexWrap: 'wrap' }}>
        <button style={{ ...PRIMARY, opacity: saving || !changed ? 0.5 : 1 }} disabled={saving || !changed} onClick={() => save()}>
          {saving ? 'Saving…' : 'Save Naming'}
        </button>
        {changed && <button style={SMALL} onClick={() => setFormats(data.formats)}>Undo changes</button>}
      </div>

      {/* Test a path */}
      <form onSubmit={runTest} style={{ marginTop: '24px', paddingTop: '20px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        <label style={LABEL} htmlFor="naming-test">Test a file path</label>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <select value={test.kind} onChange={e => { setTest(t => ({ ...t, kind: e.target.value })); setTestResult(null); }}
            style={{ ...INPUT, width: 'auto', fontFamily: 'inherit', colorScheme: 'dark', cursor: 'pointer' }} aria-label="Library type">
            <option value="tv">TV</option>
            <option value="movies">Movie</option>
          </select>
          <input id="naming-test" style={{ ...INPUT, flex: '1 1 320px', width: 'auto' }} spellCheck={false} value={test.path}
            placeholder={test.kind === 'tv' ? '/tv/Show Name (2020)/Season 01/Show Name - S01E01 - Pilot.mkv' : '/movies/Movie Name (2001)/Movie Name (2001).mkv'}
            onChange={e => setTest(t => ({ ...t, path: e.target.value }))} />
          <button type="submit" style={SECONDARY} disabled={!test.path.trim()}>Test</button>
        </div>
        {testResult?.error && <div style={{ color: '#ff6b6b', fontSize: '13px', marginTop: '10px' }}>⚠ {testResult.error}</div>}
        {testResult && !testResult.error && (
          <div style={{ marginTop: '12px', padding: '12px 14px', borderRadius: '8px', background: 'rgba(0,0,0,0.3)', fontSize: '13px', lineHeight: 1.8 }}>
            {!parsed ? (
              <span style={{ color: '#ffb703' }}>Skipped — this looks like a sample, trailer or extra, not a movie.</span>
            ) : test.kind === 'tv' ? (
              <>
                <Row k="Show" v={`${parsed.showTitle}${parsed.year ? ` (${parsed.year})` : ''}`} />
                <Row k="Grouped by" v={parsed.showKey?.startsWith('title:') ? 'title (no series folder found)' : parsed.showKey} mono />
                <Row k="Episode" v={parsed.extra ? `Extra in Season ${parsed.season}${parsed.episodeTitle ? ` – ${parsed.episodeTitle}` : ''}` : `S${String(parsed.season).padStart(2, '0')}E${String(parsed.episode ?? '?').padStart(2, '0')}${parsed.episodeTitle ? ` – ${parsed.episodeTitle}` : ''}`} />
                <Ids ids={parsed.ids} />
              </>
            ) : (
              <>
                <Row k="Movie" v={`${parsed.title}${parsed.year ? ` (${parsed.year})` : ''}`} />
                <Ids ids={parsed.ids} />
              </>
            )}
          </div>
        )}
      </form>

      <label style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', marginTop: '22px', fontSize: '14px', color: '#ccc', cursor: 'pointer' }}>
        <input type="checkbox" checked={data.removeMissing} onChange={e => save({ removeMissing: e.target.checked })} style={{ marginTop: '3px', accentColor: '#00c2ff' }} />
        <span>
          Remove titles whose files are gone after each scan
          <span style={{ display: 'block', fontSize: '12px', color: '#666', marginTop: '2px' }}>
            Watch history moves to the new file when one is replaced (e.g. a quality upgrade). Nothing is removed if most of a library's files are missing, in case a drive isn't mounted.
          </span>
        </span>
      </label>
    </div>
  );
}

function Tokens({ list }) {
  return (
    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
      {list.map(t => <code key={t} style={{ fontSize: '11px', padding: '3px 7px', borderRadius: '5px', background: 'rgba(255,255,255,0.05)', color: '#888' }}>{t}</code>)}
    </div>
  );
}

const Row = ({ k, v, mono }) => (
  <div style={{ display: 'flex', gap: '12px' }}>
    <span style={{ color: '#666', width: '90px', flexShrink: 0 }}>{k}</span>
    <span style={{ color: '#ddd', overflowWrap: 'anywhere', fontFamily: mono ? 'ui-monospace, Menlo, monospace' : 'inherit' }}>{v}</span>
  </div>
);

const Ids = ({ ids }) => {
  const list = Object.entries(ids || {}).filter(([, v]) => v);
  return list.length ? <Row k="IDs" v={list.map(([k, v]) => `${k.toUpperCase()} ${v}`).join(' · ')} /> : null;
};

// ── Maintenance ──────────────────────────────────────────────────────────────

export function LibraryMaintenance({ flash, onChanged }) {
  const [busy, setBusy] = useState('');
  const [hidden, setHidden] = useState(null);

  const loadHidden = () => axios.get('/api/admin/library/excluded').then(r => setHidden(r.data.items || [])).catch(() => setHidden([]));
  useEffect(() => { loadHidden(); }, []);

  const run = async (name, fn) => {
    setBusy(name);
    try { await fn(); } catch (err) { flash?.(err.response?.data?.error || 'Something went wrong', true); }
    setBusy('');
  };

  const regroup = () => run('regroup', async () => {
    const { data } = await axios.post('/api/admin/library/regroup');
    flash?.(data.merged || data.moved
      ? `Merged ${data.merged} duplicate show${data.merged === 1 ? '' : 's'} and moved ${data.moved} episode${data.moved === 1 ? '' : 's'} to the right show`
      : 'No duplicate shows found');
    onChanged?.();
  });

  const removeMissing = () => run('missing', async () => {
    const { data } = await axios.post('/api/admin/library/remove-missing');
    const removed = data.results.reduce((n, r) => n + (r.removed || 0), 0);
    const skipped = data.results.filter(r => r.skipped);
    flash?.(`Removed ${removed} title${removed === 1 ? '' : 's'} whose files are gone${skipped.length ? ` · skipped ${skipped.map(r => `${r.library} (${r.skipped})`).join(', ')}` : ''}`, removed === 0 && skipped.length > 0);
    onChanged?.();
  });

  const restore = (item) => run(`restore:${item.path}`, async () => {
    await axios.post('/api/admin/library/excluded/restore', { path: item.path });
    flash?.(`${item.title || 'It'} will come back on the next scan`);
    loadHidden();
  });

  return (
    <div style={CARD}>
      <h3 style={H3}>Library Maintenance</h3>
      <p style={HINT}>Tidy up what's already in the library. Scans also do this automatically.</p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <Tool title="Fix duplicate shows" button={busy === 'regroup' ? 'Working…' : 'Fix Duplicate Shows'} disabled={!!busy} onClick={regroup}
          hint="Puts every episode back under the show its series folder belongs to — e.g. a Season 1 or Specials folder that showed up as its own show — and merges shows with the same TVDB / TMDB match." />
        <Tool title="Remove missing files" button={busy === 'missing' ? 'Checking…' : 'Remove Missing Now'} disabled={!!busy} onClick={removeMissing}
          hint="Removes movies and episodes whose files are no longer on the server." />
      </div>

      <div style={{ marginTop: '24px', paddingTop: '20px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        <div style={{ fontSize: '14px', fontWeight: 700, color: '#ddd', marginBottom: '4px' }}>Hidden from the library</div>
        <div style={{ fontSize: '12px', color: '#666', marginBottom: '12px' }}>Titles you removed from Streamulus but kept on the server. Scans skip them until you restore them.</div>
        {hidden === null ? null : hidden.length === 0 ? (
          <div style={{ fontSize: '13px', color: '#444' }}>Nothing hidden.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {hidden.map(item => (
              <div key={item.path} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 14px', borderRadius: '8px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '14px', color: '#ddd', fontWeight: 600 }}>
                    {item.title || 'Untitled'} <span style={{ fontSize: '11px', color: '#00c2ff', textTransform: 'uppercase', marginLeft: '6px' }}>{item.kind}</span>
                    {!item.exists && <span style={{ fontSize: '11px', color: '#ff6b6b', marginLeft: '6px' }}>no longer on disk</span>}
                  </div>
                  <div style={{ fontSize: '12px', color: '#555', fontFamily: 'ui-monospace, Menlo, monospace', overflowWrap: 'anywhere' }}>{item.path}</div>
                </div>
                <button style={SMALL} disabled={!!busy} onClick={() => restore(item)}>{busy === `restore:${item.path}` ? 'Restoring…' : 'Restore'}</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Tool({ title, hint, button, disabled, onClick }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
      <div style={{ flex: '1 1 300px' }}>
        <div style={{ fontSize: '14px', fontWeight: 700, color: '#ddd' }}>{title}</div>
        <div style={{ fontSize: '12px', color: '#666', marginTop: '2px', lineHeight: 1.5 }}>{hint}</div>
      </div>
      <button style={{ ...SECONDARY, opacity: disabled ? 0.5 : 1 }} disabled={disabled} onClick={onClick}>{button}</button>
    </div>
  );
}

// ── Country (Admin › Settings › Regional) ────────────────────────────────────
// The country whose age ratings Streamulus uses, with its ratings shown below.
export function CountryPicker({ value, onChange, style }) {
  const [info, setInfo] = useState(null);
  useEffect(() => {
    axios.get('/api/admin/library/ratings', { params: { country: value } }).then(r => setInfo(r.data)).catch(() => {});
  }, [value]);
  const list = (items) => items.filter(o => o.age != null).map(o => o.code).join(' · ');
  return (
    <div>
      <select value={value} onChange={e => onChange(e.target.value)} style={{ ...style, cursor: 'pointer', width: '100%', colorScheme: 'dark' }} aria-label="Country">
        {(info?.countries || [{ code: value, name: value }]).map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
      </select>
      {info && (
        <div style={{ marginTop: '10px', fontSize: '12px', color: '#777', lineHeight: 1.7 }}>
          <div><span style={{ color: '#999', fontWeight: 600 }}>Movies:</span> {list(info.movie)}</div>
          <div><span style={{ color: '#999', fontWeight: 600 }}>TV:</span> {list(info.tv)}</div>
        </div>
      )}
    </div>
  );
}
