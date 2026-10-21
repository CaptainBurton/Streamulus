import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import Navbar from '../components/Navbar';
import TitleGrid, { FILTERS, FilterTabs, sortTitles } from '../components/TitleGrid';

// One genre: movies and/or shows, filterable. The filter is kept in the URL
// (?type=movies) so Back returns to the same view.
export default function Genre() {
  const { name } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const type = FILTERS.some(f => f.key === params.get('type')) ? params.get('type') : 'all';
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setError('');
    axios.get(`/api/genres/${encodeURIComponent(name)}`)
      .then(r => setData(r.data))
      .catch(err => setError(err.response?.status === 404 ? 'This genre has no titles.' : 'Could not load this genre.'));
  }, [name]);

  const items = sortTitles(data, type);

  const countFor = key => !data ? 0 : key === 'movies' ? data.movie_count : key === 'shows' ? data.show_count : data.movie_count + data.show_count;

  return (
    <div style={{ minHeight: '100vh', background: '#0f0f0f' }}>
      <Navbar />
      <div className="content-page" style={{ padding: '90px 32px 60px' }}>
        <button onClick={() => navigate('/genres')} style={{ background: 'none', border: 'none', color: '#888', fontSize: '13px', cursor: 'pointer', padding: 0, marginBottom: '10px' }}>
          ‹ All genres
        </button>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px', marginBottom: '28px' }}>
          <div>
            <h1 style={{ fontSize: '28px', fontWeight: '800' }}>{data?.genre || name}</h1>
            <div style={{ color: '#555', fontSize: '14px', marginTop: '4px' }}>{items.length} title{items.length === 1 ? '' : 's'}</div>
          </div>
          <FilterTabs type={type} onChange={key => setParams(key === 'all' ? {} : { type: key }, { replace: true })} countFor={countFor} />
        </div>

        {error ? (
          <div style={{ color: '#666', fontSize: '15px' }}>{error}</div>
        ) : !data ? (
          <div className="spinner" style={{ margin: '80px auto' }} />
        ) : items.length === 0 ? (
          <div style={{ color: '#666', fontSize: '15px' }}>No {type === 'movies' ? 'movies' : 'TV shows'} in this genre.</div>
        ) : (
          <TitleGrid items={items} showKind={type === 'all'} />
        )}
      </div>
    </div>
  );
}
