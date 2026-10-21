import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import Navbar from '../components/Navbar';
import ServiceLogo, { logoSize } from '../components/ServiceLogo';
import TitleGrid, { FILTERS, FilterTabs, sortTitles } from '../components/TitleGrid';

// One streaming service (from the Home row): its banner and logo, then its
// movies and shows like the Movies / TV Shows pages. The filter is kept in the
// URL (?type=movies) so Back returns to the same view.
export default function Service() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const type = FILTERS.some(f => f.key === params.get('type')) ? params.get('type') : 'all';
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [narrow, setNarrow] = useState(() => window.innerWidth < 700);

  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < 700);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    setData(null);
    setError('');
    axios.get(`/api/services/${encodeURIComponent(id)}`)
      .then(r => setData(r.data))
      .catch(err => setError(err.response?.status === 404 ? 'Nothing from this service here yet.' : 'Could not load this service.'));
  }, [id]);

  const items = sortTitles(data, type);
  const countFor = key => !data ? 0 : key === 'movies' ? data.movie_count : key === 'shows' ? data.show_count : data.movie_count + data.show_count;
  const service = data?.service;
  const logo = service ? logoSize(service.logo_aspect, narrow ? 300 : 560, narrow ? 120 : 200, 0.3, 0.95, 0.75) : null;

  return (
    <div style={{ minHeight: '100vh', background: '#0f0f0f' }}>
      <Navbar />

      {/* Banner with the logo over it */}
      <div style={{ position: 'relative', height: narrow ? '300px' : '46vh', minHeight: narrow ? '300px' : '360px', overflow: 'hidden', background: 'radial-gradient(120% 100% at 50% 0%, #1b2633 0%, #111116 70%)' }}>
        {service?.banner_url && (
          <img src={service.banner_url} alt="" onError={e => { e.target.style.display = 'none'; }}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center 25%', opacity: 0.55 }} />
        )}
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to bottom, rgba(15,15,15,0.55) 0%, rgba(15,15,15,0.15) 40%, rgba(15,15,15,0.75) 78%, #0f0f0f 100%)' }} />
        <button onClick={() => navigate(-1)}
          style={{ position: 'absolute', top: '90px', left: narrow ? '16px' : '32px', background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.2)', color: '#fff', borderRadius: '8px', padding: '10px 18px', fontSize: '14px', fontWeight: '600', cursor: 'pointer', backdropFilter: 'blur(8px)' }}>
          ← Back
        </button>
        {service && (
          <div style={{ position: 'absolute', left: narrow ? '16px' : '32px', right: narrow ? '16px' : '32px', bottom: '28px', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '10px' }}>
            <ServiceLogo service={service} width={logo.width} height={logo.height} style={{ filter: 'drop-shadow(0 4px 22px rgba(0,0,0,0.6))' }} />
            <div style={{ color: '#aaa', fontSize: '14px' }}>{countFor('all')} title{countFor('all') === 1 ? '' : 's'} on {service.name}</div>
          </div>
        )}
      </div>

      <div style={{ padding: narrow ? '20px 16px 48px' : '24px 32px 60px' }}>
        {error ? (
          <div style={{ color: '#666', fontSize: '15px', paddingTop: '20px' }}>{error}</div>
        ) : !data ? (
          <div className="spinner" style={{ margin: '80px auto' }} />
        ) : (
          <>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '24px' }}>
              <FilterTabs type={type} onChange={key => setParams(key === 'all' ? {} : { type: key }, { replace: true })} countFor={countFor} />
            </div>
            {items.length === 0
              ? <div style={{ color: '#666', fontSize: '15px' }}>No {type === 'movies' ? 'movies' : 'TV shows'} on {service.name} here.</div>
              : <TitleGrid items={items} showKind={type === 'all'} />}
          </>
        )}
      </div>
    </div>
  );
}
