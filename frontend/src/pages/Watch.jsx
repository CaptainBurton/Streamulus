import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import Hls from 'hls.js';

export default function Watch() {
  const { type, id } = useParams();
  const navigate = useNavigate();
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const startPosRef = useRef(0);
  const progressTimer = useRef(null);
  const hideTimer = useRef(null);

  const [media, setMedia] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [buffering, setBuffering] = useState(true);
  const [showBar, setShowBar] = useState(true);
  const [diagInfo, setDiagInfo] = useState(null);
  const [diagLoading, setDiagLoading] = useState(false);

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
      // Pre-flight: verify file is on disk and readable
      try {
        const r = await axios.get(`/api/stream/check/${type}/${id}`);
        if (!r.data.ok) {
          setError(r.data.error);
          setBuffering(false);
          return;
        }
      } catch {
        // Network error — still attempt playback
      }
      if (cancelled) return;

      const startPos = media.progress?.position > 10 ? Math.floor(media.progress.position) : 0;
      startPosRef.current = startPos;
      const hlsUrl = `/api/stream/hls/${type}/${id}/manifest.m3u8?token=${token}${startPos > 0 ? `&start=${startPos}` : ''}`;

      video.onwaiting = () => { if (!cancelled) setBuffering(true); };
      video.onplaying = () => { if (!cancelled) setBuffering(false); };
      video.oncanplay = () => { if (!cancelled) setBuffering(false); };

      console.log('[Watch] hlsUrl:', hlsUrl, '| Hls.isSupported():', Hls.isSupported());

      if (Hls.isSupported()) {
        // hls.js works on every browser including modern Safari (MSE+WebKitMSE).
        // Segments are MPEG-TS; hls.js demuxes and re-muxes to fMP4 in the main
        // thread (enableWorker:false avoids Vite-built Worker issues in Safari).
        const hls = new Hls({ enableWorker: false });
        hlsRef.current = hls;
        hls.loadSource(hlsUrl);
        hls.attachMedia(video);

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          if (cancelled) return;
          console.log('[Watch] Manifest parsed, starting playback');
          setBuffering(false);
          video.play().catch(e => console.warn('[Watch] play() rejected:', e.message));
        });

        hls.on(Hls.Events.ERROR, (_, data) => {
          console.error('[Watch] hls.js error:', data.type, data.details, 'fatal:', data.fatal, 'HTTP:', data.response?.status, data.error?.message);
          if (cancelled || !data.fatal) return;
          let msg = `HLS error: ${data.details}`;
          if (data.response?.status) msg += ` (HTTP ${data.response.status})`;
          if (data.response?.data) {
            try { const e = JSON.parse(data.response.data); if (e?.error) msg += `\n${e.error}`; } catch {}
          }
          if (data.error?.message && !msg.includes(data.error.message)) msg += `\n${data.error.message}`;
          msg += '\n\nOpen Safari → Develop → Show Web Inspector → Console for full details.\nOr click "Diagnose File" below.';
          setError(msg);
          setBuffering(false);
          hls.destroy();
        });

      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        // Fallback: native HLS for browsers that support it but not MSE.
        console.log('[Watch] Using native HLS fallback (hls.js MSE not supported)');
        // Probe the manifest first so we surface server errors (auth, 500, etc.)
        // instead of the browser's opaque MEDIA_ERR_SRC_NOT_SUPPORTED.
        try {
          const probe = await fetch(hlsUrl);
          if (!probe.ok) {
            const text = await probe.text().catch(() => '');
            let serverMsg = '';
            try { serverMsg = JSON.parse(text)?.error; } catch {}
            if (!cancelled) {
              setError(`Stream error (HTTP ${probe.status}): ${serverMsg || text.slice(0, 300) || 'Server returned no details'}`);
              setBuffering(false);
            }
            return;
          }
        } catch (e) {
          if (!cancelled && e.name !== 'AbortError') {
            setError(`Cannot reach server: ${e.message}`);
            setBuffering(false);
            return;
          }
        }
        if (cancelled) return;
        video.src = hlsUrl;
        video.onloadedmetadata = () => {
          if (cancelled) return;
          setBuffering(false);
          video.play().catch(() => {});
        };
        video.onerror = () => {
          console.error('[Watch] native video error:', video.error?.code, video.error?.message);
          if (!cancelled) {
            setError(`Playback failed (code ${video.error?.code ?? '?'}): ${video.error?.message || 'unknown'}\n\nOpen Safari → Develop → Show Web Inspector → Console for details.\nOr click "Diagnose File" below.`);
            setBuffering(false);
          }
        };
      } else {
        setError('Your browser does not support video streaming. Please try Chrome, Firefox, or Safari.');
        setBuffering(false);
      }
    })();

    return () => {
      cancelled = true;
      if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
      if (videoRef.current) { videoRef.current.pause(); videoRef.current.src = ''; }
    };
  }, [media, type, id, token]);

  // ── Save progress every 10 s ──────────────────────────────────────────────
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const save = () => {
      // HLS stream starts at 0; add startPos to get actual source position
      const position = startPosRef.current + Math.floor(video.currentTime);
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

  if (loading) return <div style={S.center}><div className="spinner" /></div>;

  const runDiag = async () => {
    setDiagLoading(true);
    try {
      const r = await axios.get(`/api/stream/diagnose/${type}/${id}`);
      setDiagInfo(r.data);
    } catch (e) {
      setDiagInfo({ error: e.response?.data?.error || e.message });
    } finally {
      setDiagLoading(false);
    }
  };

  if (error) return (
    <div style={{ ...S.center, flexDirection: 'column', gap: '20px', padding: '32px', textAlign: 'center' }}>
      <div style={{ fontSize: '40px' }}>⚠️</div>
      <div style={{ color: '#ff4444', fontSize: '16px', maxWidth: '660px', lineHeight: '1.7', whiteSpace: 'pre-line' }}>
        {error}
      </div>
      <div style={{ display: 'flex', gap: '12px' }}>
        <button onClick={() => navigate(-1)} style={S.btn}>← Go Back</button>
        <button onClick={runDiag} disabled={diagLoading} style={S.btn}>
          {diagLoading ? 'Running…' : 'Diagnose File'}
        </button>
      </div>
      {diagInfo && (
        <div style={{ background: '#111', border: '1px solid #333', borderRadius: '8px', padding: '16px', maxWidth: '700px', textAlign: 'left', fontSize: '12px', color: '#ccc', fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
          {JSON.stringify(diagInfo, null, 2)}
        </div>
      )}
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
          <div style={{ color: '#fff', fontSize: '16px', fontWeight: '600' }}>Loading… please wait</div>
          <div style={{ color: '#555', fontSize: '12px', textAlign: 'center', maxWidth: '400px' }}>
            Preparing your video. First load takes 5–30 seconds.
            <br />If it takes longer, check Portainer container logs for output.
          </div>
        </div>
      )}

      {/* Video element */}
      <video
        ref={videoRef}
        controls
        playsInline
        style={{ width: '100%', height: '100vh', background: '#000', display: 'block' }}
      />
    </div>
  );
}

const S = {
  center: { minHeight: '100vh', background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  btn: { background: 'rgba(0,0,0,0.6)', border: '1px solid rgba(255,255,255,0.2)', color: '#fff', borderRadius: '8px', padding: '8px 16px', fontSize: '14px', fontWeight: '600', cursor: 'pointer' },
};
