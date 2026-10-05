import React, { useState } from 'react';
import axios from 'axios';

const SOURCE_COLORS = { tmdb: '#01b4e4', tvdb: '#6cd491', imdb: '#f5c518' };
const SOURCE_NAMES = { tmdb: 'TMDB', tvdb: 'TVDB', imdb: 'IMDb' };

// Admin "Fix Match" (like Plex): search the metadata sources set up in Settings
// for the right movie/show by title and year, then apply the chosen result —
// title, year, overview, artwork and genres (and episode details for shows).
export default function FixMatch({ type, itemId, initialTitle = '', initialYear = '', onClose, onMatched }) {
  const [query, setQuery] = useState(initialTitle);
  const [year, setYear] = useState(initialYear ? String(initialYear) : '');
  const [results, setResults] = useState(null);
  const [sources, setSources] = useState([]);
  const [warnings, setWarnings] = useState([]);
  const [searching, setSearching] = useState(false);
  const [applying, setApplying] = useState(null); // key of the result being applied
  const [error, setError] = useState('');

  const search = async (e) => {
    e?.preventDefault();
    if (!query.trim()) { setError('Enter a title to search for.'); return; }
    setSearching(true);
    setError('');
    try {
      const res = await axios.get('/api/admin/match/search', { params: { type, query: query.trim(), year: year.trim() || undefined } });
      setResults(res.data.results || []);
      setSources(res.data.sources || []);
      setWarnings(res.data.warnings || []);
    } catch (err) {
      setError(err.response?.data?.error || 'Search failed.');
      setResults(null);
    } finally { setSearching(false); }
  };

  const apply = async (r) => {
    const key = `${r.source}-${r.id}`;
    setApplying(key);
    setError('');
    try {
      const res = await axios.post('/api/admin/match/apply', { type, mediaId: itemId, source: r.source, id: r.id });
      onMatched?.(res.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not apply that match.');
      setApplying(null);
    }
  };

  const field = { padding: '10px 14px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '8px', color: '#fff', fontSize: '14px', outline: 'none' };

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget && !applying) onClose(); }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px', backdropFilter: 'blur(4px)' }}
    >
      <div role="dialog" aria-label="Fix Match" style={{ background: '#1a1a1a', borderRadius: '16px', border: '1px solid rgba(255,255,255,0.1)', width: '100%', maxWidth: '820px', maxHeight: '88vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 24px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <div>
            <h2 style={{ fontSize: '18px', fontWeight: '700', color: '#fff', margin: 0 }}>Fix Match</h2>
            <p style={{ fontSize: '12px', color: '#666', margin: '4px 0 0' }}>
              Search for the right {type === 'movie' ? 'movie' : 'show'} and choose it to replace this one's info and artwork.
            </p>
          </div>
          <button onClick={onClose} disabled={!!applying} aria-label="Close" style={{ background: 'none', border: 'none', color: '#666', fontSize: '26px', cursor: 'pointer', lineHeight: 1, padding: '4px 8px' }}>×</button>
        </div>

        <form onSubmit={search} style={{ display: 'flex', gap: '10px', padding: '16px 24px', borderBottom: '1px solid rgba(255,255,255,0.06)', flexWrap: 'wrap' }}>
          <input aria-label="Title" placeholder="Title" value={query} onChange={e => setQuery(e.target.value)} style={{ ...field, flex: '1 1 260px' }} autoFocus />
          <input aria-label="Year" placeholder="Year" inputMode="numeric" value={year} onChange={e => setYear(e.target.value.replace(/\D/g, '').slice(0, 4))} style={{ ...field, width: '90px' }} />
          <button type="submit" disabled={searching} style={{ padding: '10px 22px', background: '#00c2ff', color: '#000', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: '700', cursor: 'pointer', opacity: searching ? 0.6 : 1 }}>
            {searching ? 'Searching…' : 'Search'}
          </button>
        </form>

        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px 24px' }}>
          {error && <div style={{ marginBottom: '12px', padding: '10px 14px', background: 'rgba(255,68,68,0.1)', border: '1px solid rgba(255,68,68,0.25)', borderRadius: '8px', color: '#ff6b6b', fontSize: '13px' }}>{error}</div>}
          {warnings.map(w => <div key={w} style={{ marginBottom: '8px', fontSize: '12px', color: '#c9a227' }}>⚠ {w}</div>)}
          {results === null ? (
            <div style={{ color: '#666', fontSize: '14px', padding: '24px 0', textAlign: 'center' }}>
              Searches your metadata sources (Settings) — add the year to narrow it down.
            </div>
          ) : results.length === 0 ? (
            <div style={{ color: '#666', fontSize: '14px', padding: '24px 0', textAlign: 'center' }}>
              No matches in {sources.join(', ') || 'your sources'}. Try a different spelling, or leave the year out.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {results.map(r => {
                const key = `${r.source}-${r.id}`;
                return (
                  <div key={key} data-testid="match-result" style={{ display: 'flex', gap: '14px', alignItems: 'flex-start', padding: '12px', borderRadius: '10px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', opacity: applying && applying !== key ? 0.4 : 1 }}>
                    <div style={{ width: '62px', aspectRatio: '2 / 3', borderRadius: '6px', overflow: 'hidden', background: '#222', flexShrink: 0 }}>
                      {r.poster_url && <img src={r.poster_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={e => { e.target.style.display = 'none'; }} />}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '15px', fontWeight: '700', color: '#fff' }}>{r.title}</span>
                        {r.year && <span style={{ fontSize: '13px', color: '#888' }}>{r.year}</span>}
                        <span style={{ fontSize: '10px', fontWeight: '800', padding: '2px 6px', borderRadius: '4px', background: 'rgba(0,0,0,0.4)', color: SOURCE_COLORS[r.source] }}>{SOURCE_NAMES[r.source]}</span>
                      </div>
                      {r.overview && <div style={{ fontSize: '12px', color: '#999', marginTop: '4px', lineHeight: 1.45, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{r.overview}</div>}
                    </div>
                    <button onClick={() => apply(r)} disabled={!!applying} style={{ padding: '8px 16px', background: applying === key ? '#00c2ff' : 'rgba(0,194,255,0.12)', color: applying === key ? '#000' : '#00c2ff', border: '1px solid rgba(0,194,255,0.35)', borderRadius: '8px', fontSize: '12px', fontWeight: '700', cursor: 'pointer', flexShrink: 0, alignSelf: 'center' }}>
                      {applying === key ? 'Applying…' : 'Choose'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
