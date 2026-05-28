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
  const hideTimer = useRef(null);

  const [media, setMedia] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusMsg, setStatusMsg] = useState('Loading…');
  const [ready, setReady] = useState(false);  // video is ready to show
  const [showBar, setShowBar] = useState(true);

  const token = localStorage.getItem('streamulus_token');

  // Load media metadata + saved progress
  useEffect(() => {
    const fetchMedia = type === 'episode'
      ? axios.get(`/api/stream/progress/episode/${id}`)
          .then(r => ({ id, type, title: 'Episode', progress: r.data }))
      : axios.get(`/api/movies/${id}`).then(async r => {
          const movie = r.data.movie;
          const prog = await axios.get(`/api/stream/progress/movie/${id}`)
            .then(p => p.data)
            .catch(() => ({ position: 0 }));
          return { ...movie, progress: prog };
        });

    fetchMedia
      .then(m => setMedia(m))
      .catch(() => setError('Media not found — the item may have been removed from your library.'))
      .finally(() => setLoading(false));
  }, [type, id]);

  // Once media is loaded, check the file and start playback
  useEffect(() => {
    if (!media || !videoRef.current) return;
    let cancelled = false;
    const video = videoRef.current;

    async function initPlayer() {
      // Pre-flight: check the file exists and is readable
      let checkData = null;
      try {
        const r = await axios.get(`/api/stream/check/${type}/${id}`);
        checkData = r.data;
      } catch (e) {
        // If the check endpoint itself fails (e.g. network error) proceed anyway
        checkData = null;
      }

      if (cancelled) return;

      if (checkData && !checkData.ok) {
        setError(checkData.error);
        return;
      }

      const useDirectPlay = checkData?.canDirectPlay ?? false;

      if (useDirectPlay) {
        // Native browser playback — MP4 / M4V / WebM serve directly, no transcoding
        setStatusMsg('Loading…');
        const directUrl = `/api/stream/direct/${type}/${id}?token=${token}`;
        video.src = directUrl;

        video.addEventListener('loadedmetadata', () => {
          if (cancelled) return;
          setReady(true);
          if (media.progress?.position > 10) video.currentTime = media.progress.position;
          video.play().catch(() => {});
        }, { once: true });

        video.addEventListener('error', () => {
          if (cancelled) return;
          const code = video.error?.code;
          const messages = { 1: 'Playback aborted', 2: 'Network error loading file', 3: 'Decoding error', 4: 'File format not supported by your browser' };
          setError(`Direct play failed: ${messages[code] || 'Unknown error'} (code ${code}). The file may use a codec your browser doesn't support — try a different browser, or rename the file to test.`);
        }, { once: true });

      } else {
        // HLS transcoding — for MKV, AVI, TS, and anything the browser can't decode
        setStatusMsg('Transcoding… (first load may take up to 30 seconds)');

        if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }

        const manifestUrl = `/api/stream/hls/${type}/${id}/index.m3u8?token=${token}`;

        if (Hls.isSupported()) {
          const hls = new Hls({
            enableWorker: true,
            lowLatencyMode: false,
            maxBufferLength: 60,
            maxMaxBufferLength: 120,
            manifestLoadingTimeOut: 70000,   // 70s — server may take up to 60s to start
            manifestLoadingMaxRetry: 1,
          });

          hls.loadSource(manifestUrl);
          hls.attachMedia(video);

          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            if (cancelled) return;
            setReady(true);
            if (media.progress?.position > 10) video.currentTime = media.progress.position;
            video.play().catch(() => {});
          });

          hls.on(Hls.Events.ERROR, (_, data) => {
            if (!data.fatal || cancelled) return;

            // Build a detailed error string
            let detail = data.details || 'unknown';
            let httpStatus = data.response?.code;
            let body = data.response?.text || '';

            // Try to parse JSON error from the server
            let serverMsg = '';
            try { serverMsg = JSON.parse(body)?.error || ''; } catch {}

            let msg;
            if (httpStatus === 401) {
              msg = 'Authentication error — your session may have expired. Try refreshing the page.';
            } else if (httpStatus === 404) {
              msg = `File not found on server (404). Check that your media volume is mounted correctly.\n${serverMsg}`;
            } else if (httpStatus === 500 || serverMsg) {
              msg = `Server error: ${serverMsg || body.slice(0, 200) || detail}`;
            } else {
              msg = `Playback error (${detail})${httpStatus ? ` — HTTP ${httpStatus}` : ''}`;
            }

            setError(msg);
          });

          hlsRef.current = hls;

        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
          // Safari native HLS
          video.src = manifestUrl;
          video.addEventListener('loadedmetadata', () => {
            if (cancelled) return;
            setReady(true);
            if (media.progress?.position > 10) video.currentTime = media.progress.position;
            video.play().catch(() => {});
          }, { once: true });
          video.addEventListener('error', () => {
            if (cancelled) return;
            setError('Playback error on Safari. The file may use an unsupported codec or the transcoding failed.');
          }, { once: true });

        } else {
          setError('Your browser does not support HLS playback. Try Chrome, Firefox, or Safari.');
        }
      }
    }

    initPlayer();
    return () => {
      cancelled = true;
      hlsRef.current?.destroy();
      hlsRef.current = null;
    };
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
    <div style={{ minHeight: '100vh', background: '#000', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '20px', padding: '32px', textAlign: 'center' }}>
      <div style={{ fontSize: '48px' }}>⚠️</div>
      <div style={{ color: '#ff4444', fontSize: '17px', maxWidth: '640px', lineHeight: '1.6', whiteSpace: 'pre-line' }}>{error}</div>
      <div style={{ color: '#444', fontSize: '12px', maxWidth: '560px', lineHeight: '1.6' }}>
        Check the Portainer container logs for detailed FFmpeg output. Common causes:
        the media volume isn't mounted, the file path in the database doesn't match the
        actual mount point, or a permissions issue on the mounted folder.
      </div>
      <button
        onClick={() => navigate(-1)}
        style={{ padding: '10px 24px', background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', color: '#fff', borderRadius: '8px', cursor: 'pointer', fontSize: '14px' }}
      >
        ← Go Back
      </button>
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

      {/* Loading / transcoding overlay — shown until video is ready */}
      {!ready && !error && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 50,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,0.9)', gap: '20px',
        }}>
          <div className="spinner" />
          <div style={{ color: '#fff', fontSize: '16px', fontWeight: '600' }}>{statusMsg}</div>
          <div style={{ color: '#555', fontSize: '12px', textAlign: 'center', maxWidth: '380px' }}>
            If this takes longer than a minute, check the container logs in Portainer for FFmpeg errors.
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
