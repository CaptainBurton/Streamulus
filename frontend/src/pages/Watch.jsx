import React, { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';

export default function Watch() {
  const { type, id } = useParams();
  const navigate = useNavigate();
  const videoRef = useRef(null);
  const [media, setMedia] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [controls, setControls] = useState(true);
  const progressTimer = useRef(null);

  useEffect(() => {
    const endpoint = type === 'movie' ? `/api/movies/${id}` : `/api/tv/episode/${id}`;

    // For episodes, fetch from episodes or shows route
    const fetchEndpoint = type === 'episode'
      ? `/api/tv/episode/${id}`
      : `/api/movies/${id}`;

    if (type === 'episode') {
      // Get episode info from show
      axios.get(`/api/stream/progress/${type}/${id}`)
        .then(res => {
          setMedia({ id, type, title: 'Episode', progress: res.data });
          setLoading(false);
        })
        .catch(() => {
          setMedia({ id, type, title: 'Episode', progress: { position: 0 } });
          setLoading(false);
        });
    } else {
      axios.get(`/api/movies/${id}`)
        .then(res => {
          const movie = res.data.movie;
          axios.get(`/api/stream/progress/movie/${id}`)
            .then(pRes => { setMedia({ ...movie, progress: pRes.data }); })
            .catch(() => { setMedia({ ...movie, progress: { position: 0 } }); })
            .finally(() => setLoading(false));
        })
        .catch(err => {
          setError('Media not found');
          setLoading(false);
        });
    }
  }, [type, id]);

  useEffect(() => {
    if (!videoRef.current || !media?.progress?.position) return;
    const video = videoRef.current;
    const handleLoad = () => {
      if (media.progress.position > 0) {
        video.currentTime = media.progress.position;
      }
    };
    video.addEventListener('loadedmetadata', handleLoad);
    return () => video.removeEventListener('loadedmetadata', handleLoad);
  }, [media]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const saveProgress = () => {
      const position = Math.floor(video.currentTime);
      const completed = video.duration > 0 && (video.currentTime / video.duration) > 0.9;
      axios.post('/api/stream/progress', {
        mediaType: type === 'episode' ? 'episode' : 'movie',
        mediaId: id,
        position,
        completed
      }).catch(() => {});
    };

    progressTimer.current = setInterval(saveProgress, 15000);
    video.addEventListener('ended', saveProgress);
    return () => {
      clearInterval(progressTimer.current);
      video.removeEventListener('ended', saveProgress);
    };
  }, [type, id]);

  const streamUrl = type === 'episode'
    ? `/api/stream/episode/${id}`
    : `/api/stream/movie/${id}`;

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="spinner" />
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ minHeight: '100vh', background: '#000', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '16px' }}>
        <div style={{ fontSize: '48px' }}>⚠️</div>
        <div style={{ color: '#ff4444', fontSize: '18px' }}>{error}</div>
        <button onClick={() => navigate(-1)} className="btn btn-secondary">← Go Back</button>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: '#000', display: 'flex', flexDirection: 'column' }}>
      {/* Top bar */}
      <div
        style={{
          position: 'fixed', top: 0, left: 0, right: 0, zIndex: 100,
          padding: '16px 24px',
          display: 'flex', alignItems: 'center', gap: '16px',
          background: 'linear-gradient(to bottom, rgba(0,0,0,0.8), transparent)',
          transition: 'opacity 0.3s',
          opacity: controls ? 1 : 0,
        }}
        onMouseEnter={() => setControls(true)}
      >
        <button
          onClick={() => navigate(-1)}
          style={{
            background: 'rgba(0,0,0,0.5)',
            border: '1px solid rgba(255,255,255,0.15)',
            color: '#fff',
            borderRadius: '8px',
            padding: '8px 16px',
            fontSize: '14px',
            fontWeight: '600',
            cursor: 'pointer',
            backdropFilter: 'blur(8px)',
          }}
        >
          ← Back
        </button>
        <div style={{ fontSize: '16px', fontWeight: '600', color: '#fff', textShadow: '0 1px 4px rgba(0,0,0,0.8)' }}>
          {media?.title}
          {media?.year && <span style={{ color: '#888', marginLeft: '8px', fontWeight: '400', fontSize: '14px' }}>{media.year}</span>}
        </div>
      </div>

      {/* Video */}
      <div
        style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}
        onMouseMove={() => setControls(true)}
        onMouseLeave={() => setTimeout(() => setControls(false), 3000)}
      >
        <video
          ref={videoRef}
          src={streamUrl}
          controls
          autoPlay
          style={{ width: '100%', maxHeight: '100vh', background: '#000' }}
          onError={() => setError('Failed to load video. Check if the file exists and is accessible.')}
        />
      </div>

      {/* Movie info below player */}
      {media && type === 'movie' && (
        <div style={{
          padding: '24px 32px',
          background: 'linear-gradient(to top, #0f0f0f, transparent)',
          display: 'flex',
          gap: '20px',
          alignItems: 'flex-start',
        }}>
          {media.poster_url && (
            <img
              src={media.poster_url}
              alt={media.title}
              style={{ width: '80px', height: '120px', objectFit: 'cover', borderRadius: '8px', flexShrink: 0 }}
            />
          )}
          <div>
            <h2 style={{ fontSize: '20px', fontWeight: '700', marginBottom: '6px' }}>{media.title}</h2>
            <div style={{ display: 'flex', gap: '12px', marginBottom: '10px' }}>
              {media.year && <span style={{ color: '#888', fontSize: '13px' }}>{media.year}</span>}
              {media.rating && <span style={{ color: '#00c2ff', fontSize: '13px', fontWeight: '600' }}>★ {media.rating.toFixed(1)}</span>}
            </div>
            {media.overview && <p style={{ color: '#888', fontSize: '14px', lineHeight: '1.6', maxWidth: '700px' }}>{media.overview}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
