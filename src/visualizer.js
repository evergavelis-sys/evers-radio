// visualizer.js
// Butterchurn wrapper. Accepts a synthetic audio driver because the Spotify
// Web Playback SDK is DRM-gated and raw audio FFT isn't available to us.
//
// Strategy: create a real Web Audio AnalyserNode (required by Butterchurn's
// connectAudio), but monkey-patch getByteFrequencyData / getByteTimeDomainData
// so that Butterchurn reads OUR synthesized FFT, derived from Spotify's
// Audio Analysis segments+beats, keyed off the local playback clock.

(function () {
  let audioCtx = null;
  let analyser = null;
  let visualizer = null;
  let renderer = null;
  let presetNames = [];
  let currentPresetIdx = 0;
  let locked = false;

  // Synthesized audio state (0..1 floats per band).
  const synth = {
    bass: 0,
    mid: 0,
    high: 0,
    beatPulse: 0,   // decays each frame, bumped on beat hit
  };

  function initCanvas(canvas) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.floor(canvas.clientWidth * dpr) || Math.floor(window.innerWidth * dpr);
    const h = Math.floor(canvas.clientHeight * dpr) || Math.floor(window.innerHeight * dpr);
    canvas.width = w;
    canvas.height = h;
    return { w, h };
  }

  function makeSyntheticAnalyser(ctx) {
    const a = ctx.createAnalyser();
    a.fftSize = 1024;
    a.smoothingTimeConstant = 0.8;

    const bins = a.frequencyBinCount;

    // Replace the FFT readers with our synthetic version.
    a.getByteFrequencyData = function (arr) {
      const bass = synth.bass + synth.beatPulse * 0.6;
      const mid = synth.mid;
      const high = synth.high;
      for (let i = 0; i < arr.length; i++) {
        const t = i / bins;
        // Three overlapping lobes — bass (0..0.15), mid (0.15..0.55), high (0.55..1).
        let v;
        if (t < 0.15) {
          const k = t / 0.15;
          v = bass * (1 - k * 0.4);
        } else if (t < 0.55) {
          const k = (t - 0.15) / 0.4;
          v = bass * (1 - k) * 0.5 + mid * (1 - Math.abs(k - 0.5) * 1.4);
        } else {
          const k = (t - 0.55) / 0.45;
          v = mid * (1 - k) * 0.4 + high * (1 - k * 0.6);
        }
        // Add a touch of shimmer so presets with time-domain sensitivity don't freeze.
        v += (Math.random() - 0.5) * 0.04;
        arr[i] = Math.max(0, Math.min(255, Math.round(v * 255)));
      }
    };

    a.getByteTimeDomainData = function (arr) {
      // Waveform around 128 (the "silence" midline), modulated by beatPulse.
      const amp = 40 + synth.beatPulse * 80 + synth.bass * 30;
      for (let i = 0; i < arr.length; i++) {
        const t = i / arr.length;
        const wave = Math.sin(t * Math.PI * 6 + performance.now() * 0.004) * amp;
        arr[i] = Math.max(0, Math.min(255, Math.round(128 + wave)));
      }
    };

    return a;
  }

  function init(canvas) {
    const { w, h } = initCanvas(canvas);
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    analyser = makeSyntheticAnalyser(audioCtx);

    // A silent source: required to keep the AudioContext "running".
    // We use a muted GainNode off an OscillatorNode that's never started.
    // Butterchurn only reads from the analyser, so no sound will play.
    const silent = audioCtx.createGain();
    silent.gain.value = 0;
    silent.connect(analyser);

    visualizer = window.butterchurn.default.createVisualizer(audioCtx, canvas, {
      width: w,
      height: h,
      pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
      textureRatio: 1,
    });
    visualizer.connectAudio(analyser);
    renderer = visualizer;

    const presets = window.butterchurnPresets.getPresets();
    presetNames = Object.keys(presets);
    // Curate out a few low-contrast / mostly-black presets that look bad on TV.
    presetNames = presetNames.filter(n => {
      const s = n.toLowerCase();
      return !s.includes('blank') && !s.includes('empty');
    });

    window.addEventListener('resize', () => {
      const d = initCanvas(canvas);
      visualizer.setRendererSize(d.w, d.h);
    });

    // Resume context on first user gesture — browsers require it.
    const resume = () => {
      if (audioCtx.state !== 'running') audioCtx.resume();
      window.removeEventListener('click', resume);
      window.removeEventListener('keydown', resume);
    };
    window.addEventListener('click', resume);
    window.addEventListener('keydown', resume);

    loadPresetByIndex(Math.floor(Math.random() * presetNames.length), 0);
    startRenderLoop();
    return { presetCount: presetNames.length };
  }

  function loadPresetByIndex(idx, blendSeconds = 2.0) {
    if (!visualizer || presetNames.length === 0) return;
    idx = ((idx % presetNames.length) + presetNames.length) % presetNames.length;
    const name = presetNames[idx];
    const preset = window.butterchurnPresets.getPresets()[name];
    visualizer.loadPreset(preset, blendSeconds);
    currentPresetIdx = idx;
    return name;
  }

  function next() { if (!locked) return loadPresetByIndex(currentPresetIdx + 1, 2.5); }
  function prev() { if (!locked) return loadPresetByIndex(currentPresetIdx - 1, 2.5); }
  function random() {
    if (locked) return null;
    const idx = Math.floor(Math.random() * presetNames.length);
    return loadPresetByIndex(idx, 2.5);
  }
  function setLocked(v) { locked = !!v; }
  function isLocked() { return locked; }
  function currentName() { return presetNames[currentPresetIdx] || ''; }

  function startRenderLoop() {
    const tick = () => {
      // Decay beat pulse each frame.
      synth.beatPulse *= 0.92;
      if (renderer) renderer.render();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  // Public driver — called by app.js with pre-computed band values 0..1.
  function setLevels({ bass, mid, high }) {
    if (typeof bass === 'number') synth.bass = Math.max(0, Math.min(1, bass));
    if (typeof mid === 'number') synth.mid = Math.max(0, Math.min(1, mid));
    if (typeof high === 'number') synth.high = Math.max(0, Math.min(1, high));
  }

  function hitBeat(strength = 1.0) {
    synth.beatPulse = Math.max(synth.beatPulse, Math.min(1, strength));
  }

  window.Visualizer = {
    init,
    next,
    prev,
    random,
    setLocked,
    isLocked,
    currentName,
    setLevels,
    hitBeat,
    loadPresetByIndex
  };
})();
