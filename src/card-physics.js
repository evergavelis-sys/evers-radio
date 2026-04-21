// card-physics.js
// Glass-surface drag + momentum for #album-card.
// No deps. Owns the card's transform via a single rAF loop.
// Later layers (resize, auto-bounce, FFT reactivity) will hook into the same state.
(function () {
  const CARD_ID = 'album-card';

  // Tunables — feel free to tweak live in DevTools via window.CardPhysics.cfg
  const cfg = {
    friction: 0.94,        // per-frame velocity multiplier on glass (1 = ice, 0.8 = mud)
    edgeBounce: 0.55,      // energy retained when hitting a viewport edge
    edgePadding: 8,        // keep this many px visible at edges
    stopThreshold: 0.02,   // px/ms — below this, snap to rest
    tiltPerVx: 0.9,        // degrees of tilt per (px/ms) of horizontal velocity
    maxTilt: 6,            // clamp
    velSamples: 5          // how many recent pointer samples to average for throw velocity
};

  // Mutable state
  const state = {
    el: null,
    x: 0, y: 0,            // translate offset (relative to CSS anchor)
    vx: 0, vy: 0,          // px per millisecond
    dragging: false,
    grabDX: 0, grabDY: 0,  // pointer offset within card at grab
    samples: [],           // [{t, x, y}]
    rafId: null,
    lastT: 0
};

  function init() {
    state.el = document.getElementById(CARD_ID);
    if (!state.el) return;

    state.el.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);

    // Keep it on-screen if the window resizes.
    window.addEventListener('resize', clampToViewport);

    loop(performance.now());
}

  function onDown(e) {
    // Only left button / primary pointer
    if (e.button !== undefined && e.button !== 0) return;
    state.dragging = true;
    state.vx = 0; state.vy = 0;
    state.samples = [{ t: e.timeStamp, x: e.clientX, y: e.clientY }];

    const rect = state.el.getBoundingClientRect();
    state.grabDX = e.clientX - rect.left;
    state.grabDY = e.clientY - rect.top;

    state.el.setPointerCapture?.(e.pointerId);
    state.el.classList.add('grabbing');
    e.preventDefault();
}

  function onMove(e) {
        if (!state.dragging) return;

    // Where the card's top-left should be in viewport coords:
    const targetLeft = e.clientX - state.grabDX;
    const targetTop  = e.clientY - state.grabDY;

    // Convert viewport target -> translate offset (card has a CSS anchor at bottom:32px left:32px)
    const anchor = getAnchor();
    state.x = targetLeft - anchor.left;
    state.y = targetTop  - anchor.top;

    // Record sample for velocity estimation on release
    state.samples.push({ t: e.timeStamp, x: e.clientX, y: e.clientY });
    if (state.samples.length > cfg.velSamples) state.samples.shift();
  }

  function onUp(e) {
        if (!state.dragging) return;
    state.dragging = false;
    state.el.classList.remove('grabbing');

    // Compute throw velocity from last samples (px per ms)
    const s = state.samples;
    if (s.length >= 2) {
      const a = s[0], b = s[s.length - 1];
      const dt = Math.max(1, b.t - a.t);
      state.vx = (b.x - a.x) / dt;
      state.vy = (b.y - a.y) / dt;
    }
    state.samples = [];
  }

  // Where (in viewport coords) the card's top-left sits when x=0,y=0 translate
  function getAnchor() {
        // Card is CSS-anchored bottom-left. We read its current rect when the translate
    // is applied and back it out, so this stays correct across resizes and style changes.
    const rect = state.el.getBoundingClientRect();
    return { left: rect.left - state.x, top: rect.top - state.y };
  }

  function clampToViewport() {
        const rect = state.el.getBoundingClientRect();
    const w = rect.width, h = rect.height;
    const pad = cfg.edgePadding;
    const anchor = getAnchor();

    // Viewport extents for top-left of card
    const minLeft = pad;
    const maxLeft = window.innerWidth - w - pad;
    const minTop  = pad;
    const maxTop  = window.innerHeight - h - pad;

    const curLeft = anchor.left + state.x;
    const curTop  = anchor.top + state.y;

    let bouncedX = false, bouncedY = false;
    if (curLeft < minLeft) { state.x += (minLeft - curLeft); if (state.vx < 0) { state.vx = -state.vx * cfg.edgeBounce; bouncedX = true; } }
    if (curLeft > maxLeft) { state.x -= (curLeft - maxLeft); if (state.vx > 0) { state.vx = -state.vx * cfg.edgeBounce; bouncedX = true; } }
    if (curTop  < minTop)  { state.y += (minTop  - curTop);  if (state.vy < 0) { state.vy = -state.vy * cfg.edgeBounce; bouncedY = true; } }
    if (curTop  > maxTop)  { state.y -= (curTop  - maxTop);  if (state.vy > 0) { state.vy = -state.vy * cfg.edgeBounce; bouncedY = true; } }
    return { bouncedX, bouncedY };
}

  function loop(now) {
    const dt = Math.min(32, now - (state.lastT || now)); // cap dt (tab-switch spikes)
    state.lastT = now;

    if (!state.dragging) {
      // Integrate position
      state.x += state.vx * dt;
      state.y += state.vy * dt;

      // Edge bounce
      clampToViewport();

      // Friction (exponential decay, frame-rate adjusted: 0.94 per ~16.67ms)
      const decay = Math.pow(cfg.friction, dt / 16.6667);
      state.vx *= decay;
      state.vy *= decay;

      // Snap to rest below threshold
      if (Math.abs(state.vx) < cfg.stopThreshold) state.vx = 0;
      if (Math.abs(state.vy) < cfg.stopThreshold) state.vy = 0;
}

    // Tilt proportional to horizontal velocity (including while dragging, so it "swings")
    const tilt = Math.max(-cfg.maxTilt, Math.min(cfg.maxTilt, state.vx * cfg.tiltPerVx * 10));
    state.el.style.transform = `translate3d(${state.x}px, ${state.y}px, 0) rotate(${tilt.toFixed(2)}deg)`;

    state.rafId = requestAnimationFrame(loop);
}

  // Expose for live tweaking
  window.CardPhysics = { init, cfg, state };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
})();
