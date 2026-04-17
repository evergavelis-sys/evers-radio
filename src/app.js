// app.js
// Orchestration: owns the playback clock, drives the visualizer from cached
// Audio Analysis, manages album-art card lifecycle, triggers preset changes.

(function () {
  const state = {
    trackId: null,
    analysis: null,        // audio-analysis JSON
    features: null,        // audio-features JSON
    isPlaying: false,
    progressMs: 0,         // last known Spotify progress
    progressSyncedAt: 0,   // performance.now() when progressMs was last refreshed
    durationMs: 0,
    lastSectionIdx: -1,
    lastBeatIdx: -1,
    lastPresetChangeAt: 0,
    cycle: {
      track: true,
      section: true,
      auto: true
    },
    artMode: 'intro',
    artTimer: null
  };

  function nowMs() { return performance.now(); }

  function localProgressMs() {
    if (!state.isPlaying) return state.progressMs;
    return Math.min(state.durationMs, state.progressMs + (nowMs() - state.progressSyncedAt));
  }

  // ---- Spotify polling loop ----

  async function pollCurrentlyPlaying() {
    const r = await window.Spotify.currentlyPlaying();
    if (r.error === 'unauthenticated') {
      window.UI.showAuthGate(true);
      return;
    }
    if (r.error === 'rate-limited') {
      window.UI.setStatus(`rate-limited — backing off ${r.retryAfter}s`);
      return;
    }
    if (r.error) {
      window.UI.setStatus(`spotify error: ${r.error}`);
      return;
    }
    if (r.empty || !r.data || !r.data.item) {
      state.isPlaying = false;
      return;
    }
    const d = r.data;
    const item = d.item;
    state.isPlaying = !!d.is_playing;
    state.progressMs = d.progress_ms || 0;
    state.progressSyncedAt = nowMs();
    state.durationMs = item.duration_ms || 0;

    if (item.id !== state.trackId) {
      onTrackChange(item);
    }
  }

  async function onTrackChange(item) {
    state.trackId = item.id;
    state.analysis = null;
    state.features = null;
    state.lastSectionIdx = -1;
    state.lastBeatIdx = -1;

    const title = item.name;
    const artist = (item.artists || []).map(a => a.name).join(', ');
    const album = item.album && item.album.name;
    const artUrl = item.album && item.album.images && item.album.images[0] && item.album.images[0].url;

    window.UI.setTrackMeta({ title, artist, album, artUrl });
    showAlbumCardForNewTrack();

    // Extract dominant color asynchronously.
    if (artUrl) {
      window.ColorExtractor.extract(artUrl).then(c => {
        if (c) window.UI.setAccent(c.hex);
      });
    }

    // Fetch analysis + features. Spotify deprecated some of these for new
    // apps; handle 403 gracefully by falling back to tempo-less synthesis.
    const [a, f] = await Promise.all([
      window.Spotify.audioAnalysis(item.id),
      window.Spotify.audioFeatures(item.id)
    ]);
    if (a.data) state.analysis = a.data;
    if (f.data) state.features = f.data;
    if (a.error || f.error) {
      window.UI.setStatus('audio analysis unavailable — driving with tempo estimate', 5000);
    }

    if (state.cycle.track) window.Visualizer.random();
  }

  // ---- Album card lifecycle ----

  function showAlbumCardForNewTrack() {
    const mode = state.artMode;
    clearTimeout(state.artTimer);
    if (mode === 'off') {
      window.UI.setAlbumCardVisible(false, window.CONFIG.ALBUM_ART_FADE_OUT_MS);
      return;
    }
    if (mode === 'always') {
      window.UI.setAlbumCardVisible(true, window.CONFIG.ALBUM_ART_FADE_IN_MS, false);
      return;
    }
    if (mode === 'faded') {
      window.UI.setAlbumCardVisible(true, window.CONFIG.ALBUM_ART_FADE_IN_MS, true);
      return;
    }
    // 'intro': in, hold, out.
    window.UI.setAlbumCardVisible(true, window.CONFIG.ALBUM_ART_FADE_IN_MS, false);
    state.artTimer = setTimeout(() => {
      window.UI.setAlbumCardVisible(false, window.CONFIG.ALBUM_ART_FADE_OUT_MS);
    }, window.CONFIG.ALBUM_ART_INTRO_HOLD_MS);
  }

  function setArtMode(mode) {
    state.artMode = mode;
    if (!state.trackId) return;
    if (mode === 'off') {
      clearTimeout(state.artTimer);
      window.UI.setAlbumCardVisible(false, window.CONFIG.ALBUM_ART_FADE_OUT_MS);
    } else if (mode === 'always') {
      clearTimeout(state.artTimer);
      window.UI.setAlbumCardVisible(true, window.CONFIG.ALBUM_ART_FADE_IN_MS, false);
    } else if (mode === 'faded') {
      clearTimeout(state.artTimer);
      window.UI.setAlbumCardVisible(true, window.CONFIG.ALBUM_ART_FADE_IN_MS, true);
    } else {
      showAlbumCardForNewTrack();
    }
  }

  // ---- Local interpolation tick: synthesize levels + detect section boundaries ----

  function findIndexBinary(arr, key, t) {
    // Find largest i where arr[i][key] <= t.
    let lo = 0, hi = arr.length - 1, best = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (arr[mid][key] <= t) { best = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return best;
  }

  function tick() {
    if (!state.isPlaying || !state.analysis) {
      // Gentle idle motion so the visualizer doesn't look dead.
      const t = nowMs() * 0.001;
      window.Visualizer.setLevels({
        bass: 0.2 + Math.sin(t * 0.7) * 0.1,
        mid: 0.15 + Math.sin(t * 1.1) * 0.08,
        high: 0.1 + Math.sin(t * 1.9) * 0.06
      });
      return;
    }

    const t = localProgressMs() / 1000;
    const { segments = [], beats = [], sections = [] } = state.analysis;

    const segIdx = findIndexBinary(segments, 'start', t);
    const seg = segIdx >= 0 ? segments[segIdx] : null;
    const beatIdx = findIndexBinary(beats, 'start', t);
    const sectionIdx = findIndexBinary(sections, 'start', t);

    // --- Band synthesis ---
    if (seg) {
      // loudness_max is dB, typically -60..0. Map to 0..1.
      const loudNorm = Math.max(0, Math.min(1, (seg.loudness_max + 60) / 60));
      // timbre[1] roughly = brightness, timbre[2] = attack. Spotify values run ~-300..300.
      const timbre1 = seg.timbre && seg.timbre[1] != null ? seg.timbre[1] : 0;
      const timbre2 = seg.timbre && seg.timbre[2] != null ? seg.timbre[2] : 0;
      const midNorm = Math.max(0, Math.min(1, (timbre1 + 200) / 400));
      const highNorm = Math.max(0, Math.min(1, (timbre2 + 200) / 400));
      // Decay within segment — hit high at start, trail off.
      const segProgress = seg.duration > 0 ? Math.max(0, Math.min(1, (t - seg.start) / seg.duration)) : 0;
      const envelope = 1 - segProgress * 0.4;
      window.Visualizer.setLevels({
        bass: loudNorm * envelope,
        mid: midNorm * envelope * 0.9,
        high: highNorm * envelope * 0.8
      });
    }

    // --- Beat pulses ---
    if (beatIdx !== state.lastBeatIdx && beatIdx >= 0) {
      state.lastBeatIdx = beatIdx;
      const b = beats[beatIdx];
      window.Visualizer.hitBeat(Math.max(0.3, b.confidence || 0.5));
    }

    // --- Section boundary → preset cycle ---
    if (sectionIdx !== state.lastSectionIdx && state.lastSectionIdx !== -1 && sectionIdx >= 0) {
      if (state.cycle.section && !window.Visualizer.isLocked()) {
        window.Visualizer.random();
        state.lastPresetChangeAt = nowMs();
      }
    }
    state.lastSectionIdx = sectionIdx;

    // --- Auto-cycle fallback ---
    if (state.cycle.auto && !window.Visualizer.isLocked()) {
      if (nowMs() - state.lastPresetChangeAt > window.CONFIG.AUTO_CYCLE_FALLBACK_MS) {
        window.Visualizer.random();
        state.lastPresetChangeAt = nowMs();
      }
    }
  }

  // ---- Bootstrap ----

  async function boot() {
    if (!window.CONFIG || window.CONFIG.SPOTIFY_CLIENT_ID === 'PASTE_CLIENT_ID_HERE') {
      document.body.innerHTML = '<div style="padding:32px;font-family:system-ui;color:#e6edf3;background:#0d1117;min-height:100vh;">' +
        '<h1>config missing</h1><p>copy <code>config.js.template</code> to <code>config.js</code> and paste your Spotify Client ID.</p></div>';
      return;
    }

    window.UI.init();
    window.UI.bind({
      next: () => window.Visualizer.next(),
      prev: () => window.Visualizer.prev(),
      random: () => window.Visualizer.random(),
      lock: (v) => window.Visualizer.setLocked(v),
      cycleTrack: (v) => state.cycle.track = v,
      cycleSection: (v) => state.cycle.section = v,
      cycleAuto: (v) => state.cycle.auto = v,
      artMode: (mode) => setArtMode(mode),
      reauth: () => { window.Spotify.clearAuth(); window.Spotify.beginAuth(); },
      authorize: () => window.Spotify.beginAuth()
    });

    const canvas = document.getElementById('butterchurn-canvas');
    const { presetCount } = window.Visualizer.init(canvas);
    window.UI.setStatus(`${presetCount} presets loaded`, 3000);
    state.lastPresetChangeAt = nowMs();

    // Handle OAuth redirect.
    const exchanged = await window.Spotify.exchangeCodeIfPresent();
    if (exchanged) window.UI.setStatus('connected to spotify', 3000);

    const authed = window.Spotify.hasValidToken() || await window.Spotify.refreshIfNeeded();
    window.UI.showAuthGate(!authed);

    if (authed) {
      pollCurrentlyPlaying();
      setInterval(pollCurrentlyPlaying, window.CONFIG.POLL_CURRENTLY_PLAYING_MS);
    }

    setInterval(tick, window.CONFIG.LOCAL_INTERP_TICK_MS);
  }

  window.addEventListener('DOMContentLoaded', boot);
})();
