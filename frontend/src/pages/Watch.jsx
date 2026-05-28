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
  const [statusMsg, setStatusMsg] = useState('Loading…');
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
      .catch(() => setError('Media not found — the item may have been removed from your library.'))
      .finally(() => setLoading(false));
  }, [type, id]);

  // ── Start playback once media metadata is ready ────────────────────────────
  useEffect(() => {
    if (!media || !videoRef.current) return;
    let cancelled = false;
    const video = videoRef.current;

    (async () => {
      // 1. Pre-flight: verify file exists and is readable
      let check = null;
      try {
        const r = await axios.get(`/api/stream/check/${type}/${id}`);
        check = r.data;
      } catch {
        // network error on check — still attempt playback
      }

      if (cancelled) return;

      if (check && !check.ok) {
        setError(check.error);
        setBuffering(false);
        return;
      }

      // 2. Choose playback mode
      const direct = check?.canDirectPlay ?? false;
      const videoUrl = direct
        ? `/api/stream/direct/${type}/${id}?token=${token}`
        : `/api/stream/transcode/${type}/${id}?token=${token}`;

      setStatusMsg(direct ? 'Loading…' : 'Transcoding… first load may take 10–30 seconds');

      // 3. Point the video element at the chosen URL
      video.src = videoUrl;

      video.onloadedmetadata = () => {
        if (cancelled) return;
        setBuffering(false);
        if (media.progress?.position > 10) {
          video.currentTime = media.progress.position;
        }
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
          1: 'Playback was aborted',
          2: 'Network error fetching the video',
          3: 'Decoding error — the file may use a codec not supported by this browser',
          4: 'Video format not supported',
        }[code] || `Error code ${code}`;

        setError(
          `${codeMsg}.\n\n` +
          (direct
            ? 'This MP4 may use H.265/HEVC or another codec the browser cannot decode natively. ' +
              'Try a different browser, or contact support.'
            : 'Check the Portainer container logs for FFmpeg error output. ' +
              'Common cause: FFmpeg not installed, or codec/file issue.')
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

  // ── Save watch progress every 10 s ────────────────────────────────────────
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

  // ── Auto-hide controls ─────────────────────────────────────────────────────
  const showControls = useCallback(() => {
    setShowBar(true);
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setShowBar(false), 3500);
  }, []);
  useEffect(() => () => clearTimeout(hideTimer.current), []);

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading) return (
    <div style={styles.center}>
      <div className="spinner" />
    </div>
  );

  if (error) return (
    <div style={{ ...styles.center, flexDirection: 'column', gap: '20px', padding: '32px', textAlign: 'center' }}>
      <div style={{ fontSize: '48px' }}>⚠️</div>
      <div style={{ color: '#ff4444', fontSize: '16px', maxWidth: '660px', lineHeight: '1.7', whiteSpace: 'pre-line' }}>
        {error}
      </div>
      <div style={{ color: '#444', fontSize: '12px', maxWidth: '560px', lineHeight: '1.6' }}>
        Open Portainer → your container → Logs to see server-side error output.
        Look for lines starting with <code style={{ background: '#1a1a1a', padding: '1px 5px', borderRadius: 3 }}>[ffmpeg]</code> or
        <code style={{ background: '#1a1a1a', padding: '1px 5px', borderRadius: 3 }}>[stream]</code>.
      </div>
      <button onClick={() => navigate(-1)} style={styles.backBtn}>← Go Back</button>
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
        padding: '16px 24px',
        display: 'flex', alignItems: 'center', gap: '16px',
        background: 'linear-gradient(to bottom, rgba(0,0,0,0.85), transparent)',
        transition: 'opacity 0.3s',
        opacity: showBar ? 1 : 0,
        pointerEvents: showBar ? 'auto' : 'none',
      }}>
        <button onClick={() => navigate(-1)} style={styles.backBtn}>← Back</button>
        <div style={{ fontSize: '15px', fontWeight: '600', color: '#fff', textShadow: '0 1px 4px rgba(0,0,0,0.8)' }}>
          {media?.title}
          {media?.year && <span style={{ color: '#888', marginLeft: '8px', fontWeight: '400', fontSize: '13px' }}>{media.year}</span>}
        </div>
      </div>

      {/* Buffering / transcoding overlay */}
      {buffering && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 50, ...styles.center, flexDirection: 'column', background: 'rgba(0,0,0,0.92)', gap: '20px' }}>
          <div className="spinner" />
          <div style={{ color: '#fff', fontSize: '16px', fontWeight: '600' }}>{statusMsg}</div>
          <div style={{ color: '#555', fontSize: '12px', textAlign: 'center', maxWidth: '400px' }}>
            If it takes over a minute, open Portainer container logs to see what FFmpeg is doing.
          </div>
        </div>
      )}

      {/* Video */}
      <video
        ref={videoRef}
        controls
        style={{ width: '100%', height: '100vh', background: '#000', display: 'block' }}
      />
    </div>
  );
}

const styles = {
  center: { minHeight: '100vh', background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  backBtn: { background: 'rgba(0,0,0,0.6)', border: '1px solid rgba(255,255,255,0.2)', color: '#fff', borderRadius: '8px', padding: '8px 16px', fontSize: '14px', fontWeight: '600', cursor: 'pointer' },
};
