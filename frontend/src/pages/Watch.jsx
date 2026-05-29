import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';

export default function Watch() {
  const { type, id } = useParams();
  const navigate = useNavigate();
  const videoRef = useRef(null);
  const progressTimer = useRef(null);
  const hideTimer = useRef(null);

  const [media, setMedia] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [buffering, setBuffering] = useState(true);
  const [showBar, setShowBar] = useState(true);

  const token = localStorage.getItem('streamulus_token');

  // ── Load media metadata ────────────────────────────────────────────────────
  useEffect(() => {
    const fetchMedia = type === 'episode'
      ? axios.get(`/api/stream/progress/episode/${id}`)
          .then(r => ({ id, type, title: 'Episode', progress: r.data }))
      : axios.get(`/api/movies/${id}`).then(async r => {
          const movie = r.data.movie;
          const prog = await axios.get(`/api/stream/progress/movie/${id}`)
            .then(p => p.data).catch(() => ({ position: 0 }));
          return { ...movie, progress: prog };
        });

    fetchMedia
      .then(m => setMedia(m))
      .catch(() => setError('Media not found.'))
      .finally(() => setLoading(false));
  }, [type, id]);

  // ── Start playback once media is ready ────────────────────────────────────
  useEffect(() => {
    if (!media || !videoRef.current) return;
    let cancelled = false;
    const video = videoRef.current;

    (async () => {
      // Pre-flight: check the file exists and is readable, show a clear error if not
      try {
        const r = await axios.get(`/api/stream/check/${type}/${id}`);
        if (!r.data.ok) {
          setError(r.data.error);
          setBuffering(false);
          return;
        }
      } catch {
        // Network error on check — still try to play
      }

      if (cancelled) return;

      // All files go through the /video endpoint which always transcodes to H.264/AAC.
      // This handles MP4 (including H.265), MKV, AVI, TS — any source format.
      const videoUrl = `/api/stream/video/${type}/${id}?token=${token}`;

      // Probe the URL first so auth/server errors surface as readable messages
      // instead of the browser's generic MEDIA_ERR_SRC_NOT_SUPPORTED (code 4).
      const ctrl = new AbortController();
      try {
        const probe = await fetch(videoUrl, { signal: ctrl.signal });
        ctrl.abort();
        if (!probe.ok) {
          let errText = '';
          try { errText = await probe.clone().text(); } catch {}
          let serverMsg = '';
          try { serverMsg = JSON.parse(errText)?.error; } catch {}
          setError(`Stream error (HTTP ${probe.status}): ${serverMsg || errText.slice(0, 200) || 'No details from server'}`);
          setBuffering(false);
          return;
        }
      } catch (e) {
        if (e.name !== 'AbortError') {
          setError(`Cannot reach server: ${e.message}`);
          setBuffering(false);
          return;
        }
      }

      if (cancelled) return;
      video.src = videoUrl;

      video.onloadedmetadata = () => {
        if (cancelled) return;
        setBuffering(false);
        if (media.progress?.position > 10) video.currentTime = media.progress.position;
        video.play().catch(() => {});
      };

      video.oncanplay = () => {
        if (cancelled) return;
        setBuffering(false);
      };

      video.onerror = () => {
        if (cancelled) return;
        const code = video.error?.code;
        const codeMsg = {
          1: 'Playback aborted',
          2: 'Network error — the server may have failed to start transcoding',
          3: 'Decode error — the output codec may be invalid',
          4: 'Unsupported format',
        }[code] || `Unknown error (code ${code})`;

        setError(
          `Video failed to play: ${codeMsg}.\n\n` +
          `Check the Portainer container logs for lines starting with [ffmpeg] or [stream] to see the exact error.`
        );
        setBuffering(false);
      };
    })();

    return () => {
      cancelled = true;
      if (videoRef.current) {
        videoRef.current.pause();
        videoRef.current.src = '';
      }
    };
  }, [media, type, id, token]);

  // ── Save progress every 10 s ──────────────────────────────────────────────
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const save = () => {
      const position = Math.floor(video.currentTime);
      if (position < 2) return;
      const completed = video.duration > 0 && video.currentTime / video.duration > 0.9;
      axios.post('/api/stream/progress', {
        mediaType: type === 'episode' ? 'episode' : 'movie',
        mediaId: id, position, completed,
      }).catch(() => {});
    };
    progressTimer.current = setInterval(save, 10000);
    video.addEventListener('ended', save);
    return () => {
      clearInterval(progressTimer.current);
      video.removeEventListener('ended', save);
    };
  }, [type, id]);

  // ── Auto-hide controls ────────────────────────────────────────────────────
  const showControls = useCallback(() => {
    setShowBar(true);
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setShowBar(false), 3500);
  }, []);
  useEffect(() => () => clearTimeout(hideTimer.current), []);

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) return (
    <div style={S.center}><div className="spinner" /></div>
  );

  if (error) return (
    <div style={{ ...S.center, flexDirection: 'column', gap: '20px', padding: '32px', textAlign: 'center' }}>
      <div style={{ fontSize: '40px' }}>⚠️</div>
      <div style={{ color: '#ff4444', fontSize: '16px', maxWidth: '660px', lineHeight: '1.7', whiteSpace: 'pre-line' }}>
        {error}
      </div>
      <button onClick={() => navigate(-1)} style={S.btn}>← Go Back</button>
    </div>
  );

  return (
    <div
      style={{ minHeight: '100vh', background: '#000', position: 'relative', cursor: showBar ? 'default' : 'none' }}
      onMouseMove={showControls}
      onClick={showControls}
    >
      {/* Top bar */}
      <div style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 100,
        padding: '16px 24px', display: 'flex', alignItems: 'center', gap: '16px',
        background: 'linear-gradient(to bottom, rgba(0,0,0,0.85), transparent)',
        transition: 'opacity 0.3s',
        opacity: showBar ? 1 : 0, pointerEvents: showBar ? 'auto' : 'none',
      }}>
        <button onClick={() => navigate(-1)} style={S.btn}>← Back</button>
        <div style={{ fontSize: '15px', fontWeight: '600', color: '#fff', textShadow: '0 1px 4px rgba(0,0,0,0.8)' }}>
          {media?.title}
          {media?.year && <span style={{ color: '#888', marginLeft: '8px', fontWeight: '400', fontSize: '13px' }}>{media.year}</span>}
        </div>
      </div>

      {/* Buffering overlay */}
      {buffering && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 50, ...S.center, flexDirection: 'column', background: 'rgba(0,0,0,0.92)', gap: '20px' }}>
          <div className="spinner" />
          <div style={{ color: '#fff', fontSize: '16px', fontWeight: '600' }}>Transcoding… please wait</div>
          <div style={{ color: '#555', fontSize: '12px', textAlign: 'center', maxWidth: '400px' }}>
            Converting to a browser-compatible format. First load takes 5–30 seconds.
            <br />If it takes longer, check Portainer container logs for FFmpeg output.
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

const S = {
  center: { minHeight: '100vh', background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  btn: { background: 'rgba(0,0,0,0.6)', border: '1px solid rgba(255,255,255,0.2)', color: '#fff', borderRadius: '8px', padding: '8px 16px', fontSize: '14px', fontWeight: '600', cursor: 'pointer' },
};
