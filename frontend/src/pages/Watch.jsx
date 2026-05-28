import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import Hls from 'hls.js';

export default function Watch() {
  const { type, id } = useParams();
  const navigate = useNavigate();
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const progressTimer = useRef(null);

  const [media, setMedia] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [transcoding, setTranscoding] = useState(true);
  const [showBar, setShowBar] = useState(true);
  const hideTimer = useRef(null);

  const token = localStorage.getItem('streamulus_token');

  // Load media metadata + saved progress
  useEffect(() => {
    const fetchMedia = type === 'episode'
      ? axios.get(`/api/stream/progress/episode/${id}`).then(r => ({ id, type, title: 'Episode', progress: r.data }))
      : axios.get(`/api/movies/${id}`).then(async r => {
          const movie = r.data.movie;
          const prog = await axios.get(`/api/stream/progress/movie/${id}`).then(p => p.data).catch(() => ({ position: 0 }));
          return { ...movie, progress: prog };
        });

    fetchMedia
      .then(m => setMedia(m))
      .catch(() => setError('Media not found'))
      .finally(() => setLoading(false));
  }, [type, id]);

  // Setup HLS player once media is loaded
  useEffect(() => {
    if (!media || !videoRef.current) return;

    const video = videoRef.current;
    const manifestUrl = `/api/stream/hls/${type}/${id}/index.m3u8?token=${token}`;

    const setupHls = () => {
      if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }

      if (Hls.isSupported()) {
        const hls = new Hls({
          enableWorker: true,
          lowLatencyMode: false,
          // Pass auth token on every XHR request hls.js makes
          xhrSetup: (xhr) => {
            xhr.setRequestHeader('Authorization', `Bearer ${token}`);
          },
        });
        hls.loadSource(manifestUrl);
        hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          setTranscoding(false);
          if (media.progress?.position > 10) video.currentTime = media.progress.position;
          video.play().catch(() => {});
        });
        hls.on(Hls.Events.ERROR, (_, data) => {
          if (data.fatal) setError('Playback error: ' + (data.details || 'unknown'));
        });
        hlsRef.current = hls;
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        // Safari — native HLS
        video.src = manifestUrl;
        video.addEventListener('loadedmetadata', () => {
          setTranscoding(false);
          if (media.progress?.position > 10) video.currentTime = media.progress.position;
          video.play().catch(() => {});
        }, { once: true });
      } else {
        setError('Your browser does not support HLS playback. Try Chrome, Firefox, or Safari.');
      }
    };

    setupHls();
    return () => { hlsRef.current?.destroy(); hlsRef.current = null; };
  }, [media, type, id, token]);

  // Save progress every 10 seconds
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const save = () => {
      const position = Math.floor(video.currentTime);
      if (position < 2) return;
      const completed = video.duration > 0 && video.currentTime / video.duration > 0.9;
      axios.post('/api/stream/progress', {
        mediaType: type === 'episode' ? 'episode' : 'movie',
        mediaId: id, position, completed
      }).catch(() => {});
    };

    progressTimer.current = setInterval(save, 10000);
    video.addEventListener('ended', save);
    return () => {
      clearInterval(progressTimer.current);
      video.removeEventListener('ended', save);
    };
  }, [type, id]);

  // Auto-hide controls bar
  const showControls = useCallback(() => {
    setShowBar(true);
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setShowBar(false), 3500);
  }, []);

  useEffect(() => () => clearTimeout(hideTimer.current), []);

  if (loading) return (
    <div style={{ minHeight: '100vh', background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="spinner" />
    </div>
  );

  if (error) return (
    <div style={{ minHeight: '100vh', background: '#000', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '16px', padding: '32px', textAlign: 'center' }}>
      <div style={{ fontSize: '48px' }}>⚠️</div>
      <div style={{ color: '#ff4444', fontSize: '18px', maxWidth: '500px' }}>{error}</div>
      <button onClick={() => navigate(-1)} style={{ padding: '10px 24px', background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', color: '#fff', borderRadius: '8px', cursor: 'pointer', fontSize: '14px' }}>← Go Back</button>
    </div>
  );

  return (
    <div
      style={{ minHeight: '100vh', background: '#000', position: 'relative', cursor: showBar ? 'default' : 'none' }}
      onMouseMove={showControls}
      onClick={showControls}
    >
      {/* Top control bar */}
      <div style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 100,
        padding: '16px 24px',
        display: 'flex', alignItems: 'center', gap: '16px',
        background: 'linear-gradient(to bottom, rgba(0,0,0,0.85), transparent)',
        transition: 'opacity 0.3s',
        opacity: showBar ? 1 : 0,
        pointerEvents: showBar ? 'auto' : 'none',
      }}>
        <button
          onClick={() => navigate(-1)}
          style={{ background: 'rgba(0,0,0,0.6)', border: '1px solid rgba(255,255,255,0.2)', color: '#fff', borderRadius: '8px', padding: '8px 16px', fontSize: '14px', fontWeight: '600', cursor: 'pointer', backdropFilter: 'blur(8px)' }}
        >
          ← Back
        </button>
        <div style={{ fontSize: '15px', fontWeight: '600', color: '#fff', textShadow: '0 1px 4px rgba(0,0,0,0.8)' }}>
          {media?.title}
          {media?.year && <span style={{ color: '#888', marginLeft: '8px', fontWeight: '400', fontSize: '13px' }}>{media.year}</span>}
        </div>
      </div>

      {/* Transcoding overlay */}
      {transcoding && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 50,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,0.85)', gap: '20px'
        }}>
          <div className="spinner" />
          <div style={{ color: '#fff', fontSize: '16px', fontWeight: '600' }}>Transcoding…</div>
          <div style={{ color: '#666', fontSize: '13px', textAlign: 'center', maxWidth: '360px' }}>
            Converting to browser-compatible format. This takes a few seconds.
          </div>
        </div>
      )}

      {/* Video element */}
      <video
        ref={videoRef}
        controls
        style={{ width: '100%', height: '100vh', background: '#000', display: 'block' }}
      />
    </div>
  );
}
