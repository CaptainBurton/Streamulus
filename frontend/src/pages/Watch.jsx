import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';

// ── Icons ─────────────────────────────────────────────────────────────────────
const Ico = ({ d, size = 24 }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" width={size} height={size} style={{ display: 'block', flexShrink: 0 }}>
    <path d={d} />
  </svg>
);

const ReplayIcon = ({ n }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" width={26} height={26} style={{ display: 'block' }}>
    <path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/>
    <text x="12" y="16.5" textAnchor="middle" fontSize="6.5" fontWeight="bold" fontFamily="Arial,sans-serif" fill="currentColor">{n}</text>
  </svg>
);

const ForwardIcon = ({ n }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" width={26} height={26} style={{ display: 'block' }}>
    <path d="M18 13c0 3.31-2.69 6-6 6s-6-2.69-6-6 2.69-6 6-6v4l5-5-5-5v4c-4.42 0-8 3.58-8 8s3.58 8 8 8 8-3.58 8-8h-2z"/>
    <text x="12" y="16.5" textAnchor="middle" fontSize="6.5" fontWeight="bold" fontFamily="Arial,sans-serif" fill="currentColor">{n}</text>
  </svg>
);

const D = {
  play:    'M8 5v14l11-7z',
  pause:   'M6 19h4V5H6v14zm8-14v14h4V5h-4z',
  volHi:   'M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z',
  volLo:   'M18.5 12c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM5 9v6h4l5 5V4L9 9H5z',
  volMute: 'M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z',
  fsIn:    'M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z',
  fsOut:   'M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z',
};

const fmt = (sec) => {
  if (!sec || !isFinite(sec)) return '0:00';
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
    : `${m}:${String(s).padStart(2,'0')}`;
};

// ── Component ─────────────────────────────────────────────────────────────────
export default function Watch() {
  const { type, id } = useParams();
  const navigate = useNavigate();

  // DOM / HLS refs
  const videoRef     = useRef(null);
  const hlsRef       = useRef(null);
  const startPosRef  = useRef(0);
  const progressRef  = useRef(null);
  const containerRef = useRef(null);

  // Timer refs
  const progressTimerRef = useRef(null);
  const hideTimerRef     = useRef(null);
  const bufferTimerRef   = useRef(null);
  const thumbTimerRef    = useRef(null);

  // Stable callback refs (used inside keyboard / drag handlers to avoid stale closures)
  const startHlsAtRef = useRef(null);
  const skipRef       = useRef(null);
  const fsRef          = useRef(null);
  const isDragging     = useRef(false);
  const totalDurRef    = useRef(0);
  const prewarmFired   = useRef(false);

  // UI state
  const [media,       setMedia]       = useState(null);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState('');
  const [buffering,   setBuffering]   = useState(true);
  const [showBar,     setShowBar]     = useState(true);

  // Player state
  const [paused,      setPaused]      = useState(true);
  const [curTime,     setCurTime]     = useState(0);
  const [duration,    setDuration]    = useState(0);
  const [volume,      setVolume]      = useState(1);
  const [muted,       setMuted]       = useState(false);
  const [isFS,        setIsFS]        = useState(false);
  const [showVol,     setShowVol]     = useState(false);
  const [progHover,   setProgHover]   = useState(false);
  const [hoverTime,   setHoverTime]   = useState(null);
  const [hoverX,      setHoverX]      = useState(0);
  const [dragTime,    setDragTime]    = useState(null);
  // Total file duration, derived as max(startPos + segmentDur) across all seeks.
  // Kept separate so seeking doesn't inflate totalDur with stale segment durations.
  const [totalFileDur, setTotalFileDur] = useState(0);

  // Seek thumbnail
  const [thumbSrc,    setThumbSrc]    = useState(null);

  // Diag
  const [diagInfo,    setDiagInfo]    = useState(null);
  const [diagLoad,    setDiagLoad]    = useState(false);
  const [dbgLog,      setDbgLog]      = useState([]);

  const token = localStorage.getItem('streamulus_token');

  const addLog = useCallback((msg) => {
    const ts = new Date().toTimeString().slice(0, 8);
    console.log('[Watch]', msg);
    setDbgLog(prev => [...prev.slice(-10), `${ts}  ${msg}`]);
  }, []);

  // Derived
  const absTime = startPosRef.current + curTime;
  // Only compute totalDur once we have a real segment duration from durationchange.
  // Without this guard: resuming from saved position sets startPosRef > 0 but
  // duration=0, giving totalDur=savedPos and progress=savedPos/savedPos=1 (100%).
  const totalDur = totalFileDur > 0
    ? totalFileDur
    : (duration > 0 ? startPosRef.current + duration : 0);
  totalDurRef.current = totalDur;
  const displayTime = dragTime ?? absTime;
  const progress = totalDur > 0 ? Math.min(displayTime / totalDur, 1) : 0;

  // ── Load media metadata ───────────────────────────────────────────────────
  useEffect(() => {
    const fetch_ = type === 'episode'
      ? axios.get(`/api/stream/progress/episode/${id}`)
          .then(r => ({ id, type, title: 'Episode', progress: r.data }))
      : axios.get(`/api/movies/${id}`).then(async r => {
          const m = r.data.movie;
          const p = await axios.get(`/api/stream/progress/movie/${id}`).then(x => x.data).catch(() => ({ position: 0 }));
          return { ...m, progress: p };
        });
    fetch_.then(setMedia).catch(() => setError('Media not found.')).finally(() => setLoading(false));
  }, [type, id]);

  // ── Start playback ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!media || !videoRef.current) return;
    let cancelled = false;
    const video = videoRef.current;
    const Hls = window.Hls;

    (async () => {
      addLog(`window.Hls: ${Hls ? 'OK' : 'MISSING'}`);
      if (!Hls) { setError('hls.js failed to load — redeploy the Docker container.'); setBuffering(false); return; }

      try {
        const r = await axios.get(`/api/stream/check/${type}/${id}`);
        if (!r.data.ok) { setError(r.data.error); setBuffering(false); return; }
        addLog(`File OK: ${r.data.filePath}`);
      } catch { addLog('File check failed — continuing'); }
      if (cancelled) return;

      const startPos = media.progress?.position > 10 ? Math.floor(media.progress.position) : 0;
      startPosRef.current = startPos;

      const showBuf = () => {
        if (cancelled) return;
        clearTimeout(bufferTimerRef.current);
        bufferTimerRef.current = setTimeout(() => { if (!cancelled) setBuffering(true); }, 800);
      };
      const hideBuf = () => { if (cancelled) return; clearTimeout(bufferTimerRef.current); setBuffering(false); };

      video.onwaiting = showBuf;
      video.onplaying = () => { if (!cancelled) { hideBuf(); addLog('Playing!'); } };
      video.oncanplay = hideBuf;

      if (Hls.isSupported()) {
        addLog('hls.js path');

        const startHlsAt = (absPos) => {
          if (cancelled) return;
          setBuffering(true);
          if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
          startPosRef.current = absPos;
          setCurTime(0);
          const url = `/api/stream/hls/${type}/${id}/manifest.m3u8?token=${token}${absPos > 0 ? `&start=${absPos}` : ''}`;
          addLog(`Manifest start=${absPos}s`);

          const hls = new Hls({
            enableWorker: true,
            lowLatencyMode: false,
            startFragPrefetch: true,
            maxBufferLength: 60,
            maxMaxBufferLength: 600,
            backBufferLength: 30,
            maxBufferHole: 1.0,
            fragLoadingTimeOut: 30000, fragLoadingMaxRetry: 8, fragLoadingRetryDelay: 300,
            highBufferWatchdogPeriod: 5, nudgeOffset: 0.3, nudgeMaxRetry: 5,
          });
          hlsRef.current = hls;
          hls.loadSource(url);
          hls.attachMedia(video);

          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            if (cancelled) return;
            addLog('Manifest parsed');
            setBuffering(false);
            video.play().catch(e => addLog(`play() rejected: ${e.message}`));
          });

          // Recovery counter is per-HLS-instance (reset on every startHlsAt call).
          let mediaRecoveries = 0;
          hls.on(Hls.Events.ERROR, (_, data) => {
            addLog(`hls ${data.fatal ? 'FATAL' : 'non-fatal'}: ${data.details}`);
            if (cancelled || !data.fatal) return;

            if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
              // bufferAppendError / bufferStalledError / mediaError:
              // try hls.recoverMediaError() up to 3 times, then restart the
              // stream from the current playback position.
              mediaRecoveries += 1;
              if (mediaRecoveries <= 3) {
                addLog(`Media error — recovery attempt ${mediaRecoveries}`);
                setBuffering(true);
                hls.recoverMediaError();
              } else {
                const pos = startPosRef.current + Math.floor(video.currentTime || 0);
                addLog(`Restarting HLS at ${pos}s after repeated media errors`);
                startHlsAt(Math.max(0, pos));
              }
            } else {
              // Network or other fatal error — no automatic recovery possible.
              let msg = `HLS error: ${data.details}`;
              if (data.response?.status) msg += ` (HTTP ${data.response.status})`;
              setError(msg); setBuffering(false); hls.destroy();
            }
          });
        };

        startHlsAtRef.current = startHlsAt;
        startHlsAt(startPos);

      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        addLog('Native HLS path');
        const base = `/api/stream/hls/${type}/${id}/manifest.m3u8?token=${token}`;
        const url = startPos > 0 ? `${base}&start=${startPos}` : base;

        try {
          const probe = await fetch(url);
          if (!probe.ok) {
            const text = await probe.text().catch(() => '');
            let msg = ''; try { msg = JSON.parse(text)?.error; } catch {}
            if (!cancelled) { setError(`Stream error (HTTP ${probe.status}): ${msg || text.slice(0,300)}`); setBuffering(false); }
            return;
          }
        } catch (e) {
          if (!cancelled && e.name !== 'AbortError') { setError(`Cannot reach server: ${e.message}`); setBuffering(false); return; }
        }
        if (cancelled) return;

        video.src = url;
        video.onloadedmetadata = () => { if (!cancelled) { setBuffering(false); video.play().catch(() => {}); } };
        video.onerror = () => {
          if (!cancelled) { setError(`Playback failed (code ${video.error?.code ?? '?'}): ${video.error?.message || 'unknown'}`); setBuffering(false); }
        };
        startHlsAtRef.current = (absPos) => {
          startPosRef.current = absPos; setCurTime(0);
          video.src = `${base}&start=${absPos}`;
          video.play().catch(() => {});
        };
      } else {
        setError('Your browser does not support video streaming. Try Chrome, Firefox, or Safari.');
        setBuffering(false);
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(bufferTimerRef.current);
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
      axios.post('/api/stream/progress', { mediaType: type === 'episode' ? 'episode' : 'movie', mediaId: id, position, completed }).catch(() => {});
    };
    progressTimerRef.current = setInterval(save, 10000);
    video.addEventListener('ended', save);
    return () => { clearInterval(progressTimerRef.current); video.removeEventListener('ended', save); };
  }, [type, id]);

  // ── Video events → player state ───────────────────────────────────────────
  // NOTE: deps intentionally empty — the video element is always in the DOM
  // from first render, so videoRef.current is guaranteed non-null here.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onTime  = () => setCurTime(v.currentTime);
    const onDur   = () => {
      if (isFinite(v.duration) && v.duration > 0) {
        setDuration(v.duration);
        // Keep the true total file duration; startPosRef + segmentDur = total
        const computed = startPosRef.current + v.duration;
        setTotalFileDur(prev => computed > prev ? computed : prev);
      }
    };
    const onPlay  = () => setPaused(false);
    const onPause = () => setPaused(true);
    const onVol   = () => { setVolume(v.volume); setMuted(v.muted); };
    v.addEventListener('timeupdate',    onTime);
    v.addEventListener('durationchange', onDur);
    v.addEventListener('loadedmetadata', onDur);
    v.addEventListener('play',  onPlay);
    v.addEventListener('pause', onPause);
    v.addEventListener('volumechange', onVol);
    return () => {
      v.removeEventListener('timeupdate',    onTime);
      v.removeEventListener('durationchange', onDur);
      v.removeEventListener('loadedmetadata', onDur);
      v.removeEventListener('play',  onPlay);
      v.removeEventListener('pause', onPause);
      v.removeEventListener('volumechange', onVol);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Fullscreen ────────────────────────────────────────────────────────────
  useEffect(() => {
    const onFS = () => setIsFS(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFS);
    return () => document.removeEventListener('fullscreenchange', onFS);
  }, []);

  // ── Progress bar drag (window-level) ─────────────────────────────────────
  useEffect(() => {
    const posAt = (clientX) => {
      const bar = progressRef.current;
      if (!bar) return null;
      const rect = bar.getBoundingClientRect();
      return Math.max(0, Math.min((clientX - rect.left) / rect.width, 1)) * totalDurRef.current;
    };
    const onMove = (e) => { if (isDragging.current) setDragTime(posAt(e.clientX)); };
    const onUp   = (e) => {
      if (!isDragging.current) return;
      isDragging.current = false;
      const pos = posAt(e.clientX);
      if (pos !== null && startHlsAtRef.current) startHlsAtRef.current(Math.max(0, Math.floor(pos)));
      setDragTime(null);
    };
    const onTMove = (e) => { if (isDragging.current) setDragTime(posAt(e.touches[0].clientX)); };
    const onTEnd  = (e) => {
      if (!isDragging.current) return;
      isDragging.current = false;
      const pos = posAt(e.changedTouches[0].clientX);
      if (pos !== null && startHlsAtRef.current) startHlsAtRef.current(Math.max(0, Math.floor(pos)));
      setDragTime(null);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup',   onUp);
    window.addEventListener('touchmove', onTMove, { passive: false });
    window.addEventListener('touchend',  onTEnd);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup',   onUp);
      window.removeEventListener('touchmove', onTMove);
      window.removeEventListener('touchend',  onTEnd);
    };
  }, []);

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e) => {
      const v = videoRef.current;
      if (!v || e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.key === ' ' || e.key === 'k')       { e.preventDefault(); v.paused ? v.play() : v.pause(); }
      else if (e.key === 'ArrowLeft')            { e.preventDefault(); skipRef.current?.(-10); }
      else if (e.key === 'ArrowRight')           { e.preventDefault(); skipRef.current?.(10); }
      else if (e.key === 'f' || e.key === 'F')  { e.preventDefault(); fsRef.current?.(); }
      else if (e.key === 'm' || e.key === 'M')  { e.preventDefault(); v.muted = !v.muted; }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ── Seek thumbnail (debounced 150 ms, snapped to 10 s intervals) ─────────
  useEffect(() => {
    const previewT = dragTime ?? hoverTime;
    if (previewT === null) { setThumbSrc(null); return; }
    clearTimeout(thumbTimerRef.current);
    thumbTimerRef.current = setTimeout(() => {
      const t = Math.round(previewT / 10) * 10;
      // token in query param because <img> src can't carry Authorization header
      setThumbSrc(`/api/stream/thumbnail/${type}/${id}?t=${t}&token=${token}`);
    }, 150);
    return () => clearTimeout(thumbTimerRef.current);
  }, [dragTime, hoverTime, type, id, token]); // token needed for img src URL

  // ── Pre-warm thumbnails once total duration is known ──────────────────────
  // Fires a single background POST that starts one FFmpeg pass generating ALL
  // thumbnails (fps=1/10). Frames appear incrementally on disk; the server
  // serves them the moment they exist, so hovering near the start is instant
  // after a few seconds and hovering anywhere becomes instant once the pass
  // completes. The ref prevents re-firing on re-renders or seeks.
  useEffect(() => {
    if (!totalFileDur || !type || !id || prewarmFired.current) return;
    prewarmFired.current = true;
    axios.post(`/api/stream/thumbnail/prewarm/${type}/${id}`, {}).catch(() => {});
  }, [totalFileDur, type, id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Auto-hide controls ────────────────────────────────────────────────────
  const showControls = useCallback(() => {
    setShowBar(true);
    clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => setShowBar(false), 3500);
  }, []);
  useEffect(() => () => clearTimeout(hideTimerRef.current), []);

  // Prevent Safari from ever re-enabling native controls
  useEffect(() => {
    const v = videoRef.current;
    if (v) { v.controls = false; v.disablePictureInPicture = true; }
  }, []);

  // ── Control handlers ──────────────────────────────────────────────────────
  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (v) { v.paused ? v.play() : v.pause(); }
    showControls();
  }, [showControls]);

  const handleSkip = useCallback((delta) => {
    const v = videoRef.current;
    if (!v) return;
    showControls();
    const newAbs = startPosRef.current + v.currentTime + delta;
    const newRel = newAbs - startPosRef.current;
    if (newRel >= 0 && v.duration > 0 && newRel <= v.duration) {
      v.currentTime = newRel;
    } else if (startHlsAtRef.current) {
      startHlsAtRef.current(Math.max(0, Math.floor(newAbs)));
    }
  }, [showControls]);

  skipRef.current = handleSkip;

  const toggleFS = useCallback(() => {
    const el = containerRef.current || document.documentElement;
    document.fullscreenElement ? document.exitFullscreen() : el.requestFullscreen?.();
  }, []);

  fsRef.current = toggleFS;

  const toggleMute = () => { const v = videoRef.current; if (v) v.muted = !v.muted; };

  const handleVolChange = (e) => {
    const v = videoRef.current;
    if (!v) return;
    const val = parseFloat(e.target.value);
    v.volume = val;
    v.muted = val === 0;
  };

  const handleProgDown = (e) => {
    e.preventDefault();
    isDragging.current = true;
    showControls();
    const bar = progressRef.current;
    if (!bar) return;
    const rect = bar.getBoundingClientRect();
    setDragTime(Math.max(0, Math.min((e.clientX - rect.left) / rect.width, 1)) * totalDur);
  };

  const handleProgMove = (e) => {
    const bar = progressRef.current;
    if (!bar) return;
    const rect = bar.getBoundingClientRect();
    const ratio = Math.max(0, Math.min((e.clientX - rect.left) / rect.width, 1));
    setHoverTime(ratio * totalDur);
    setHoverX(e.clientX - rect.left);
  };

  // ── Diag / debug helpers ──────────────────────────────────────────────────
  const runDiag = async () => {
    setDiagLoad(true);
    try { const r = await axios.get(`/api/stream/diagnose/${type}/${id}`); setDiagInfo(r.data); }
    catch (e) { setDiagInfo({ error: e.response?.data?.error || e.message }); }
    finally { setDiagLoad(false); }
  };

  const debugOn = localStorage.getItem('streamulus_debug_logs') === 'true';
  const DebugLog = () => debugOn && dbgLog.length > 0 ? (
    <div style={{ fontFamily: 'monospace', fontSize: '11px', lineHeight: '1.6', textAlign: 'left', maxWidth: '620px' }}>
      {dbgLog.map((l, i) => <div key={i} style={{ color: /FAIL|fatal|error/i.test(l) ? '#f66' : '#666' }}>{l}</div>)}
    </div>
  ) : null;

  // ── Main render ────────────────────────────────────────────────────────────
  // The <video> element is ALWAYS rendered so that useEffect hooks with []
  // deps can attach event listeners on first mount. Loading/error states are
  // rendered as overlays on top of the video element instead of early returns.
  const volIcon = muted || volume === 0 ? D.volMute : volume < 0.5 ? D.volLo : D.volHi;
  const barH = progHover || isDragging.current ? '7px' : '4px';

  return (
    <>
    <style>{`
      @keyframes spin { to { transform: rotate(360deg); } }
      .pbtn {
        transition: background 0.15s ease, transform 0.12s ease, opacity 0.15s ease !important;
      }
      .pbtn:hover { background: rgba(255,255,255,0.13) !important; transform: scale(1.14) !important; }
      .pbtn:active { transform: scale(0.88) !important; transition-duration: 0.06s !important; }
      .pbtn-play:hover { transform: scale(1.2) !important; }
      .pbtn-play:active { transform: scale(0.9) !important; }
      .pbtn-back {
        transition: background 0.15s ease, transform 0.12s ease, opacity 0.15s ease !important;
      }
      .pbtn-back:hover { background: rgba(255,255,255,0.15) !important; transform: translateX(-2px) scale(1.04) !important; }
      .pbtn-back:active { transform: translateX(0) scale(0.97) !important; }
    `}</style>
    <div
      ref={containerRef}
      style={{ minHeight: '100vh', background: '#000', position: 'relative', cursor: showBar ? 'default' : 'none', userSelect: 'none' }}
      onMouseMove={showControls}
    >
      {/* Video — always in DOM from first render so event listeners attach correctly */}
      <video
        ref={videoRef}
        playsInline
        disablePictureInPicture
        x-webkit-airplay="deny"
        onClick={togglePlay}
        style={{ width: '100%', height: '100vh', background: '#000', display: 'block' }}
      />

      {/* ── Loading overlay ─────────────────────────────────────────────────── */}
      {loading && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 200, ...S.center, background: '#000' }}>
          <div className="spinner" />
        </div>
      )}

      {/* ── Error overlay ───────────────────────────────────────────────────── */}
      {!loading && error && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 200, ...S.center, flexDirection: 'column', gap: '16px', padding: '32px', textAlign: 'center', background: '#000' }}>
          <div style={{ fontSize: '40px' }}>⚠️</div>
          <div style={{ color: '#ff4444', fontSize: '16px', maxWidth: '660px', lineHeight: '1.7', whiteSpace: 'pre-line' }}>{error}</div>
          <DebugLog />
          <div style={{ display: 'flex', gap: '12px' }}>
            <button onClick={() => navigate(-1)} style={S.btn}>← Go Back</button>
            <button onClick={runDiag} disabled={diagLoad} style={S.btn}>{diagLoad ? 'Running…' : 'Diagnose File'}</button>
          </div>
          {diagInfo && (
            <pre style={{ background: '#111', border: '1px solid #333', borderRadius: '8px', padding: '16px', maxWidth: '700px', textAlign: 'left', fontSize: '12px', color: '#ccc', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
              {JSON.stringify(diagInfo, null, 2)}
            </pre>
          )}
        </div>
      )}

      {/* Player controls — hidden during loading/error */}
      {!loading && !error && (
        <>
          {/* ── Top bar ──────────────────────────────────────────────────────── */}
          <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, zIndex: 100,
            padding: '20px 28px', display: 'flex', alignItems: 'center', gap: '16px',
            background: 'linear-gradient(to bottom, rgba(0,0,0,0.9) 0%, transparent 100%)',
            opacity: showBar ? 1 : 0, transition: 'opacity 0.35s', pointerEvents: showBar ? 'auto' : 'none',
          }}>
            <button onClick={() => navigate(-1)} style={S.btn} className="pbtn-back">← Back</button>
            <div style={{ fontSize: '15px', fontWeight: '600', color: '#fff', textShadow: '0 1px 4px rgba(0,0,0,0.8)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {media?.title}
              {media?.year && <span style={{ color: '#888', marginLeft: '8px', fontWeight: '400', fontSize: '13px' }}>{media.year}</span>}
            </div>
          </div>

          {/* ── Bottom controls ──────────────────────────────────────────────── */}
          <div
            style={{
              position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 100,
              padding: '0 28px 24px',
              background: 'linear-gradient(to top, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.6) 55%, transparent 100%)',
              opacity: showBar ? 1 : 0, transition: 'opacity 0.35s', pointerEvents: showBar ? 'auto' : 'none',
            }}
            onClick={e => e.stopPropagation()}
          >
            {/* Progress bar */}
            <div style={{ marginBottom: '16px', paddingTop: '20px', position: 'relative', cursor: 'pointer' }}
              onMouseEnter={() => setProgHover(true)}
              onMouseLeave={() => { setProgHover(false); if (!isDragging.current) setHoverTime(null); }}
            >
              {/* Hover / drag preview — thumbnail card + tick */}
              {(hoverTime !== null || dragTime !== null) && (() => {
                const previewTime = dragTime ?? hoverTime;
                const previewRatio = totalDur > 0 ? Math.min(previewTime / totalDur, 1) : 0;
                const barWidth = progressRef.current?.offsetWidth ?? 300;
                const rawX = previewRatio * barWidth;
                const thumbW = 160;
                const clampedX = Math.min(Math.max(rawX, thumbW / 2), barWidth - thumbW / 2);
                return (
                  <>
                    {/* Vertical tick line */}
                    <div style={{
                      position: 'absolute', bottom: 0, pointerEvents: 'none',
                      left: `${rawX}px`, transform: 'translateX(-50%)',
                      width: '2px', height: `${parseInt(barH) + 10}px`,
                      background: 'rgba(255,255,255,0.6)', borderRadius: '1px',
                    }} />
                    {/* Thumbnail card */}
                    <div style={{
                      position: 'absolute', bottom: `${parseInt(barH) + 14}px`,
                      left: `${clampedX}px`, transform: 'translateX(-50%)',
                      pointerEvents: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center',
                      filter: 'drop-shadow(0 4px 18px rgba(0,0,0,0.85))',
                    }}>
                      {/* Thumbnail image */}
                      <div style={{
                        width: `${thumbW}px`, height: '90px',
                        background: '#111', borderRadius: '6px 6px 0 0',
                        border: '1.5px solid rgba(255,255,255,0.15)',
                        borderBottom: 'none', overflow: 'hidden',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        {thumbSrc
                          ? <img src={thumbSrc} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                          : <div style={{ width: '32px', height: '32px', border: '3px solid rgba(255,255,255,0.2)', borderTopColor: '#00c2ff', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                        }
                      </div>
                      {/* Time label */}
                      <div style={{
                        background: 'rgba(10,10,10,0.97)',
                        border: '1.5px solid rgba(255,255,255,0.15)', borderTop: 'none',
                        borderRadius: '0 0 6px 6px',
                        color: '#fff', fontSize: '13px', fontWeight: '700',
                        letterSpacing: '0.6px', padding: '5px 14px',
                        width: '100%', textAlign: 'center', boxSizing: 'border-box',
                      }}>
                        {fmt(previewTime)}
                      </div>
                    </div>
                  </>
                );
              })()}

              {/* Track */}
              <div
                ref={progressRef}
                style={{ height: barH, background: 'rgba(255,255,255,0.18)', borderRadius: '4px', position: 'relative', transition: 'height 0.15s' }}
                onMouseDown={handleProgDown}
                onMouseMove={handleProgMove}
                onTouchStart={(e) => { e.preventDefault(); isDragging.current = true; showControls(); }}
              >
                {/* Buffered indicator (subtle) */}
                <div style={{ position: 'absolute', inset: 0, borderRadius: '4px', background: 'rgba(255,255,255,0.12)' }} />
                {/* Played */}
                <div style={{ width: `${progress * 100}%`, height: '100%', background: '#00c2ff', borderRadius: '4px', position: 'relative', transition: isDragging.current ? 'none' : 'width 0.25s linear' }}>
                  {/* Thumb */}
                  <div style={{
                    position: 'absolute', right: '-8px', top: '50%', transform: 'translateY(-50%)',
                    width: '16px', height: '16px', borderRadius: '50%', background: '#fff',
                    boxShadow: '0 0 8px rgba(0,194,255,0.6)',
                    opacity: progHover || isDragging.current ? 1 : 0,
                    transition: 'opacity 0.15s',
                  }} />
                </div>
              </div>
            </div>

            {/* Controls row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>

              {/* Play / Pause */}
              <button onClick={togglePlay} style={S.iBtn} className="pbtn pbtn-play" title={paused ? 'Play (Space)' : 'Pause (Space)'}>
                <Ico d={paused ? D.play : D.pause} size={30} />
              </button>

              {/* Skip back */}
              <button onClick={() => handleSkip(-10)} style={S.iBtn} className="pbtn" title="Back 10s (←)">
                <ReplayIcon n={10} />
              </button>

              {/* Skip forward */}
              <button onClick={() => handleSkip(10)} style={S.iBtn} className="pbtn" title="Forward 10s (→)">
                <ForwardIcon n={10} />
              </button>

              {/* Time */}
              <span style={{ fontSize: '13px', color: '#ccc', fontVariantNumeric: 'tabular-nums', marginLeft: '8px', flexShrink: 0, letterSpacing: '0.3px' }}>
                {fmt(displayTime)}
                {totalDur > 0 && <span style={{ color: '#555' }}> / {fmt(totalDur)}</span>}
              </span>

              {/* Spacer */}
              <div style={{ flex: 1 }} />

              {/* Volume */}
              <div
                style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
                onMouseEnter={() => setShowVol(true)}
                onMouseLeave={() => setShowVol(false)}
              >
                <button onClick={toggleMute} style={S.iBtn} className="pbtn" title="Mute (M)">
                  <Ico d={volIcon} size={22} />
                </button>
                <div style={{ width: showVol ? '84px' : '0px', overflow: 'hidden', transition: 'width 0.2s', display: 'flex', alignItems: 'center' }}>
                  <input
                    type="range" min="0" max="1" step="0.05"
                    value={muted ? 0 : volume}
                    onChange={handleVolChange}
                    style={{ width: '84px', accentColor: '#00c2ff', cursor: 'pointer' }}
                  />
                </div>
              </div>

              {/* Fullscreen */}
              <button onClick={toggleFS} style={S.iBtn} className="pbtn" title="Fullscreen (F)">
                <Ico d={isFS ? D.fsOut : D.fsIn} size={22} />
              </button>
            </div>
          </div>

          {/* ── Buffering overlay ────────────────────────────────────────────── */}
          {buffering && (
            <div style={{ position: 'fixed', inset: 0, zIndex: 50, ...S.center, flexDirection: 'column', background: 'rgba(0,0,0,0.92)', gap: '16px' }}>
              <div className="spinner" />
              <div style={{ color: '#fff', fontSize: '16px', fontWeight: '600' }}>Loading… please wait</div>
              <DebugLog />
              <div style={{ color: '#444', fontSize: '11px', textAlign: 'center', maxWidth: '380px' }}>
                First load takes 5–15 s. Seeking far ahead restarts the transcoder.
              </div>
            </div>
          )}
        </>
      )}
    </div>
    </>
  );
}

const S = {
  center: { minHeight: '100vh', background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  btn: {
    background: 'rgba(0,0,0,0.55)', border: '1px solid rgba(255,255,255,0.18)',
    color: '#fff', borderRadius: '8px', padding: '8px 16px', fontSize: '14px',
    fontWeight: '600', cursor: 'pointer', backdropFilter: 'blur(4px)', flexShrink: 0,
  },
  iBtn: {
    background: 'none', border: 'none', color: '#fff', cursor: 'pointer',
    padding: '8px', borderRadius: '8px', display: 'flex', alignItems: 'center',
    justifyContent: 'center', transition: 'background 0.15s, transform 0.1s',
    flexShrink: 0,
  },
};
