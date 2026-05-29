import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';

// hls.js is loaded via <script src="/hls.min.js"> in index.html (not bundled by
// Vite). This avoids Rollup mangling the Worker URL, which breaks hls.js silently
// in production builds. window.Hls is set synchronously before React runs.

export default function Watch() {
  const { type, id } = useParams();
  const navigate = useNavigate();
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const startPosRef = useRef(0);
  const progressTimer = useRef(null);
  const hideTimer = useRef(null);
  const bufferTimer = useRef(null);

  const [media, setMedia] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [buffering, setBuffering] = useState(true);
  const [showBar, setShowBar] = useState(true);
  const [diagInfo, setDiagInfo] = useState(null);
  const [diagLoading, setDiagLoading] = useState(false);
  const [dbgLog, setDbgLog] = useState([]);

  const token = localStorage.getItem('streamulus_token');

  const addLog = useCallback((msg) => {
    const ts = new Date().toTimeString().slice(0, 8);
    console.log('[Watch]', msg);
    setDbgLog(prev => [...prev.slice(-10), `${ts}  ${msg}`]);
  }, []);

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
    const Hls = window.Hls;

    (async () => {
      addLog(`window.Hls loaded: ${Hls ? 'YES' : 'NO — script tag missing!'}`);
      if (!Hls) {
        setError('hls.js failed to load. The container may need to be rebuilt.\n\nMake sure to redeploy (not just restart) the Docker container.');
        setBuffering(false);
        return;
      }

      // Pre-flight: verify file is on disk and readable
      addLog('Checking file on disk...');
      try {
        const r = await axios.get(`/api/stream/check/${type}/${id}`);
        if (!r.data.ok) {
          addLog(`File check FAILED: ${r.data.error}`);
          setError(r.data.error);
          setBuffering(false);
          return;
        }
        addLog(`File OK: ${r.data.filePath} (${r.data.ext})`);
      } catch {
        addLog('File check request failed — continuing anyway');
      }
      if (cancelled) return;

      const startPos = media.progress?.position > 10 ? Math.floor(media.progress.position) : 0;
      startPosRef.current = startPos;
      const hlsUrl = `/api/stream/hls/${type}/${id}/manifest.m3u8?token=${token}${startPos > 0 ? `&start=${startPos}` : ''}`;

      const hlsSupported = Hls.isSupported();
      addLog(`Hls.isSupported(): ${hlsSupported} | token: ${token ? 'present' : 'MISSING'}`);

      // Debounce the buffering overlay by 800 ms so brief gaps between HLS
      // segments (including the bufferSeekOverHole auto-seek at startup) don't
      // flash the spinner. Real stalls will still show it after 800 ms.
      const showBuffering = () => {
        if (cancelled) return;
        clearTimeout(bufferTimer.current);
        bufferTimer.current = setTimeout(() => { if (!cancelled) setBuffering(true); }, 800);
      };
      const hideBuffering = () => {
        if (cancelled) return;
        clearTimeout(bufferTimer.current);
        setBuffering(false);
      };
      video.onwaiting = showBuffering;
      video.onplaying = () => { if (!cancelled) { hideBuffering(); addLog('Playing!'); } };
      video.oncanplay = hideBuffering;

      if (hlsSupported) {
        addLog('Using hls.js path (MSE supported)');

        // Extracted so we can restart from any absolute position (used for seeking).
        const startHlsAt = (absolutePos) => {
          if (cancelled) return;
          if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
          startPosRef.current = absolutePos;
          const url = `/api/stream/hls/${type}/${id}/manifest.m3u8?token=${token}${absolutePos > 0 ? `&start=${absolutePos}` : ''}`;
          addLog(`Loading manifest (start=${absolutePos}s)`);

          const hls = new Hls({
            enableWorker: false,
            // Give fragments 25 s to load (server waits 30 s for FFmpeg to write
            // each .ts file). Default 20 s causes spurious fragLoadTimeOut errors
            // when the next segment isn't transcoded yet.
            fragLoadingTimeOut: 25000,
            fragLoadingMaxRetry: 6,
            fragLoadingRetryDelay: 500,
            // Auto-skip buffer holes up to 0.5 s (eliminates bufferSeekOverHole
            // warnings caused by tiny gaps between segments).
            maxBufferHole: 0.5,
            // Be more lenient before declaring the buffer stalled.
            highBufferWatchdogPeriod: 5,
            nudgeOffset: 0.3,
            nudgeMaxRetry: 5,
          });
          hlsRef.current = hls;
          hls.loadSource(url);
          hls.attachMedia(video);

          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            if (cancelled) return;
            addLog('Manifest parsed — calling play()');
            setBuffering(false);
            video.play().catch(e => addLog(`play() rejected: ${e.message}`));
          });

          hls.on(Hls.Events.ERROR, (_, data) => {
            addLog(`hls.js ${data.fatal ? 'FATAL' : 'non-fatal'}: ${data.details} HTTP:${data.response?.status ?? '-'}`);
            if (cancelled || !data.fatal) return;
            let msg = `HLS error: ${data.details}`;
            if (data.response?.status) msg += ` (HTTP ${data.response.status})`;
            if (data.response?.data) {
              try { const e = JSON.parse(data.response.data); if (e?.error) msg += `\n${e.error}`; } catch {}
            }
            if (data.error?.message && !msg.includes(data.error.message)) msg += `\n${data.error.message}`;
            setError(msg);
            setBuffering(false);
            hls.destroy();
          });
        };

        startHlsAt(startPos);

      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        addLog('Using native HLS fallback (hls.js MSE not supported)');
        try {
          addLog('Probing manifest URL...');
          const probe = await fetch(hlsUrl);
          addLog(`Probe response: HTTP ${probe.status}`);
          if (!probe.ok) {
            const text = await probe.text().catch(() => '');
            let serverMsg = '';
            try { serverMsg = JSON.parse(text)?.error; } catch {}
            if (!cancelled) {
              setError(`Stream error (HTTP ${probe.status}): ${serverMsg || text.slice(0, 300) || 'No details'}`);
              setBuffering(false);
            }
            return;
          }
        } catch (e) {
          addLog(`Probe failed: ${e.message}`);
          if (!cancelled && e.name !== 'AbortError') {
            setError(`Cannot reach server: ${e.message}`);
            setBuffering(false);
            return;
          }
        }
        if (cancelled) return;
        addLog('Setting video.src for native HLS');
        video.src = hlsUrl;
        video.onloadedmetadata = () => {
          if (cancelled) return;
          setBuffering(false);
          video.play().catch(() => {});
        };
        video.onerror = () => {
          const code = video.error?.code ?? '?';
          addLog(`video.onerror: code=${code} msg=${video.error?.message || '-'}`);
          if (!cancelled) {
            setError(`Playback failed (code ${code}): ${video.error?.message || 'unknown codec or network error'}\n\nClick "Diagnose File" to inspect the source file's codec.`);
            setBuffering(false);
          }
        };
      } else {
        addLog('Neither hls.js nor native HLS is supported in this browser');
        setError('Your browser does not support video streaming. Please try Chrome, Firefox, or Safari.');
        setBuffering(false);
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(bufferTimer.current);
      if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
      if (videoRef.current) { videoRef.current.pause(); videoRef.current.src = ''; }
    };
  }, [media, type, id, token, addLog]);

  // ── Save progress every 10 s ──────────────────────────────────────────────
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const save = () => {
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

  const debugLogsEnabled = localStorage.getItem('streamulus_debug_logs') === 'true';
  const DebugLog = () => debugLogsEnabled && dbgLog.length > 0 ? (
    <div style={{ fontFamily: 'monospace', fontSize: '11px', color: '#444', lineHeight: '1.6', textAlign: 'left', maxWidth: '620px', width: '100%' }}>
      {dbgLog.map((line, i) => <div key={i} style={{ color: line.includes('FAIL') || line.includes('fatal') || line.includes('error') ? '#f66' : '#666' }}>{line}</div>)}
    </div>
  ) : null;

  if (error) return (
    <div style={{ ...S.center, flexDirection: 'column', gap: '16px', padding: '32px', textAlign: 'center' }}>
      <div style={{ fontSize: '40px' }}>⚠️</div>
      <div style={{ color: '#ff4444', fontSize: '16px', maxWidth: '660px', lineHeight: '1.7', whiteSpace: 'pre-line' }}>
        {error}
      </div>
      <DebugLog />
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

      {/* Buffering overlay with live debug log */}
      {buffering && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 50, ...S.center, flexDirection: 'column', background: 'rgba(0,0,0,0.92)', gap: '16px' }}>
          <div className="spinner" />
          <div style={{ color: '#fff', fontSize: '16px', fontWeight: '600' }}>Loading… please wait</div>
          <DebugLog />
          <div style={{ color: '#444', fontSize: '11px', textAlign: 'center', maxWidth: '400px' }}>
            First load takes 5–15 s. Seeking far ahead restarts the transcoder.
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
