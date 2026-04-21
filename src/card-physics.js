// card-physics.js
// Album-card behavior: drag, momentum, edge bounce, drift-home, keyboard nudge,
// anchor persistence. Owns the card's transform via a single rAF loop.
// Everything is exposed on window.CardPhysics for live tweaking and future hooks
// (FFT reactivity will just add impulses to state.vx / state.vy each frame).
(function () {
    const CARD_ID = 'album-card';
    const STORAGE_KEY_ANCHOR = 'eversRadio.card.anchor';

   // ---------------- Tunables ----------------
   // Tweak live in DevTools: CardPhysics.cfg.friction = 0.96
   const cfg = {
         friction: 0.92,         // per-frame velocity decay at ~60fps (1=ice, 0.8=mud)
         edgeBounce: 0.35,       // energy kept on viewport-edge bounce
         edgePadding: 12,        // keep this many px visible at edges
         stopThreshold: 0.015,   // px/ms — below this, snap to rest
         tiltPerVx: 0.7,         // degrees of tilt per (px/ms) horizontal velocity
         maxTilt: 3,             // tilt clamp
         velSamples: 5,          // last-N pointer samples averaged for throw velocity
         nudgeStep: 24,          // px moved per arrow-key press
         longPressMs: 450,       // hold this long w/o moving to enter "picked up" mode

         // Drift-home (humanist touch): after the card rests wherever you left it,
         // gently pull it back to its anchor using critically-damped-ish spring.
         driftHomeDelayMs: 4000, // ms of rest before drift starts
         driftStiffness: 0.00018, // spring constant (higher = snappier pull)
         driftDamping: 0.08       // velocity damping while drifting (0-1 per 16.67ms)
   };

   // ---------------- Anchor presets ----------------
   // Each preset is a function returning {left, top, scale} in viewport coords.
   // The card's *top-left* will be placed at (left, top). 'scale' multiplies size.
   // Presets are computed lazily so they respond to window resize.
   const ANCHORS = {
         'bottom-right': () => ({
                 left: window.innerWidth - getCardSize().w - 32,
                 top:  window.innerHeight - getCardSize().h - 32,
                 scale: 1
         }),
         'bottom-left': () => ({
                 left: 32,
                 top:  window.innerHeight - getCardSize().h - 32,
                 scale: 1
         }),
         'top-right': () => ({
                 left: window.innerWidth - getCardSize().w - 32,
                 top:  32,
                 scale: 1
         }),
         'top-left': () => ({
                 left: 32,
                 top:  32,
                 scale: 1
         }),
         'center-small': () => ({
                 left: (window.innerWidth  - getCardSize(0.6).w) / 2,
                 top:  (window.innerHeight - getCardSize(0.6).h) / 2,
                 scale: 0.6
         })
   };
    const DEFAULT_ANCHOR = 'bottom-right';

   // ---------------- Mutable state ----------------
   const state = {
         el: null,
         x: 0, y: 0,              // translate (px) relative to the card's CSS origin
         vx: 0, vy: 0,            // velocity in px/ms
         scale: 1,                // current scale (animated toward anchor.scale)
         dragging: false,
         pickedUp: false,         // long-press engaged
         paused: false,
         grabDX: 0, grabDY: 0,
         samples: [],
         rafId: null,
         lastT: 0,
         lastMoveT: 0,            // timestamp of last drag-move or throw
         anchor: loadAnchor(),    // current anchor name
         longPressTimer: null,
         reducedMotion: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || false
   };

   // ---------------- Utilities ----------------
   function getCardSize(scaleOverride) {
         // We read from the *unscaled* card. Cards without an intrinsic size yet
      // (e.g. during first init) fall back to 280x320 which matches the CSS.
      if (!state.el) return { w: 280, h: 320 };
         const s = scaleOverride ?? state.scale ?? 1;
         const rect = state.el.getBoundingClientRect();
         // rect reflects current scale & translate; unscale it.
      const base = state.scale || 1;
         return { w: (rect.width / base) * s, h: (rect.height / base) * s };
   }

   function loadAnchor() {
         try {
                 const saved = localStorage.getItem(STORAGE_KEY_ANCHOR);
                 if (saved && ANCHORS[saved]) return saved;
         } catch (_) {}
         return DEFAULT_ANCHOR;
   }

   function saveAnchor(name) {
         try { localStorage.setItem(STORAGE_KEY_ANCHOR, name); } catch (_) {}
   }

   function getAnchorPos() {
         const fn = ANCHORS[state.anchor] || ANCHORS[DEFAULT_ANCHOR];
         return fn();
   }

   // Where (viewport coords) the card's top-left would be if state.x = state.y = 0.
   // We back this out from the current bounding rect so it stays correct across
   // CSS changes, window resizes, and anchor switches.
   function getCssOrigin() {
         const rect = state.el.getBoundingClientRect();
         return { left: rect.left - state.x, top: rect.top - state.y };
   }

   // ---------------- Init ----------------
   function init() {
         state.el = document.getElementById(CARD_ID);
         if (!state.el) return;

      state.el.setAttribute('tabindex', '0');
         state.el.setAttribute('role', 'group');
         state.el.setAttribute('aria-label', 'Now playing — drag to move, or use arrow keys');

      state.el.addEventListener('pointerdown', onDown);
         window.addEventListener('pointermove', onMove);
         window.addEventListener('pointerup', onUp);
         window.addEventListener('pointercancel', onUp);
         state.el.addEventListener('dblclick', onDoubleClick);
         state.el.addEventListener('keydown', onKey);
         window.addEventListener('keydown', onGlobalKey);
         window.addEventListener('resize', () => {});  // loop clamps naturally

      // Respect OS-level "reduce motion" setting.
      window.matchMedia?.('(prefers-reduced-motion: reduce)')
           .addEventListener?.('change', e => { state.reducedMotion = e.matches; });

      // Place the card at its anchor on first load.
      snapToAnchor(false);

       // Re-snap to anchor when the card transitions from hidden -> visible,
       // because getBoundingClientRect returns 0x0 while display:none, so the
       // initial snapToAnchor() has no real dimensions to work with.
       const visObserver = new MutationObserver(() => {
             if (state.el.classList.contains('visible') && !state.el.classList.contains('hidden')) {
                     // Defer one frame so layout finishes first.
                     requestAnimationFrame(() => snapToAnchor(false));
             }
       });
       visObserver.observe(state.el, { attributes: true, attributeFilter: ['class'] });
       

      loop(performance.now());
   }

   // ---------------- Pointer handlers ----------------
   function onDown(e) {
         if (e.button !== undefined && e.button !== 0) return;
         state.vx = 0; state.vy = 0;
         state.samples = [{ t: e.timeStamp, x: e.clientX, y: e.clientY }];

      const rect = state.el.getBoundingClientRect();
         state.grabDX = e.clientX - rect.left;
         state.grabDY = e.clientY - rect.top;
         state.dragging = true;
         state.lastMoveT = e.timeStamp;

      // Long-press detection (for "picked up" visual) — fires if no movement.
      clearTimeout(state.longPressTimer);
         state.longPressTimer = setTimeout(() => {
                 if (state.dragging) {
                           state.pickedUp = true;
                           state.el.classList.add('picked-up');
                 }
         }, cfg.longPressMs);

      state.el.setPointerCapture?.(e.pointerId);
         state.el.classList.add('grabbing');
         state.el.focus?.();
         e.preventDefault();
   }

   function onMove(e) {
         if (!state.dragging) return;

      // Cancel long-press if pointer actually moves
      clearTimeout(state.longPressTimer);

      const origin = getCssOrigin();
         state.x = (e.clientX - state.grabDX) - origin.left;
         state.y = (e.clientY - state.grabDY) - origin.top;
         state.lastMoveT = e.timeStamp;

      state.samples.push({ t: e.timeStamp, x: e.clientX, y: e.clientY });
         if (state.samples.length > cfg.velSamples) state.samples.shift();
   }

   function onUp(e) {
         if (!state.dragging) return;
         clearTimeout(state.longPressTimer);
         state.dragging = false;
         state.pickedUp = false;
         state.el.classList.remove('grabbing', 'picked-up');

      // Throw velocity from last samples. If it was a tap (no movement), v=0.
      const s = state.samples;
         if (s.length >= 2) {
                 const a = s[0], b = s[s.length - 1];
                 const dt = Math.max(1, b.t - a.t);
                 const distSq = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
                 if (distSq > 9) {  // >3px of total travel → throw; otherwise tap
                   state.vx = (b.x - a.x) / dt;
                           state.vy = (b.y - a.y) / dt;
                 } else {
                           state.vx = 0; state.vy = 0; // tap = stop
                 }
         }
         state.samples = [];
         state.lastMoveT = (e && e.timeStamp) || performance.now();
   }

   function onDoubleClick() {
         // Double-click = snap home with a gentle animation.
      state.vx = 0; state.vy = 0;
         snapToAnchor(true);
   }

   // ---------------- Keyboard ----------------
   function onKey(e) {
         // Only when card has focus
      const step = cfg.nudgeStep * (e.shiftKey ? 3 : 1);
         switch (e.key) {
           case 'ArrowLeft':  state.x -= step; state.vx = 0; e.preventDefault(); break;
           case 'ArrowRight': state.x += step; state.vx = 0; e.preventDefault(); break;
           case 'ArrowUp':    state.y -= step; state.vy = 0; e.preventDefault(); break;
           case 'ArrowDown':  state.y += step; state.vy = 0; e.preventDefault(); break;
           case 'Home':       snapToAnchor(true); e.preventDefault(); break;
         }
         state.lastMoveT = performance.now();
   }

   function onGlobalKey(e) {
         // Ignore when typing in a form field.
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;

      // 1–5: switch anchor. Space: pause physics.
      if (e.key >= '1' && e.key <= '5') {
              const map = ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'center-small'];
              setAnchor(map[parseInt(e.key, 10) - 1]);
              e.preventDefault();
      } else if (e.key === ' ' && document.activeElement !== document.body) {
              return; // avoid trapping Space in buttons etc.
      } else if (e.code === 'Space') {
              state.paused = !state.paused;
              e.preventDefault();
      }
   }

   // ---------------- Anchor control ----------------
   function setAnchor(name) {
         if (!ANCHORS[name]) return;
         state.anchor = name;
         saveAnchor(name);
         snapToAnchor(true);
   }

   function snapToAnchor(animate) {
         const pos = getAnchorPos();
         const origin = getCssOrigin();
         const targetX = pos.left - origin.left;
         const targetY = pos.top  - origin.top;
         const targetScale = pos.scale;

      if (!animate || state.reducedMotion) {
              state.x = targetX; state.y = targetY; state.scale = targetScale;
              state.vx = 0; state.vy = 0;
      } else {
              // Mark as "drifting" by giving it a home-target; the loop will ease it.
           state.homeTarget = { x: targetX, y: targetY, scale: targetScale };
      }
   }

   // ---------------- Physics integration ----------------
   function clampToViewport() {
         const rect = state.el.getBoundingClientRect();
         const w = rect.width, h = rect.height;
         const pad = cfg.edgePadding;
         const origin = getCssOrigin();

      const minLeft = pad - origin.left;
         const maxLeft = window.innerWidth  - w - pad - origin.left;
         const minTop  = pad - origin.top;
         const maxTop  = window.innerHeight - h - pad - origin.top;

      if (state.x < minLeft) { state.x = minLeft; if (state.vx < 0) state.vx = -state.vx * cfg.edgeBounce; }
         if (state.x > maxLeft) { state.x = maxLeft; if (state.vx > 0) state.vx = -state.vx * cfg.edgeBounce; }
         if (state.y < minTop)  { state.y = minTop;  if (state.vy < 0) state.vy = -state.vy * cfg.edgeBounce; }
         if (state.y > maxTop)  { state.y = maxTop;  if (state.vy > 0) state.vy = -state.vy * cfg.edgeBounce; }
   }

   function loop(now) {
         const dt = Math.min(32, now - (state.lastT || now));
         state.lastT = now;

      if (!state.paused) {
              if (!state.dragging) {
                        // Integrate momentum
                state.x += state.vx * dt;
                        state.y += state.vy * dt;

                clampToViewport();

                // Friction (frame-rate-independent exponential decay)
                const decay = Math.pow(cfg.friction, dt / 16.6667);
                        state.vx *= decay;
                        state.vy *= decay;
                        if (Math.abs(state.vx) < cfg.stopThreshold) state.vx = 0;
                        if (Math.abs(state.vy) < cfg.stopThreshold) state.vy = 0;

                // Drift-home: once at rest long enough, pull toward anchor.
                const restedFor = now - (state.lastMoveT || now);
                        if (state.vx === 0 && state.vy === 0 && restedFor > cfg.driftHomeDelayMs && !state.homeTarget) {
                                    const pos = getAnchorPos();
                                    const origin = getCssOrigin();
                                    state.homeTarget = { x: pos.left - origin.left, y: pos.top - origin.top, scale: pos.scale };
                        }

                if (state.homeTarget) {
                            // Spring toward home target.
                          const hx = state.homeTarget.x - state.x;
                            const hy = state.homeTarget.y - state.y;
                            state.vx += hx * cfg.driftStiffness * dt;
                            state.vy += hy * cfg.driftStiffness * dt;
                            state.vx *= (1 - cfg.driftDamping);
                            state.vy *= (1 - cfg.driftDamping);
                            // Scale eases too
                          state.scale += (state.homeTarget.scale - state.scale) * 0.08;

                          // Arrived → stop drifting.
                          if (Math.abs(hx) < 0.5 && Math.abs(hy) < 0.5 && Math.abs(state.vx) < 0.01 && Math.abs(state.vy) < 0.01) {
                                        state.x = state.homeTarget.x;
                                        state.y = state.homeTarget.y;
                                        state.scale = state.homeTarget.scale;
                                        state.vx = state.vy = 0;
                                        state.homeTarget = null;
                          }
                }
              } else {
                        // Dragging: any interaction cancels the drift.
                state.homeTarget = null;
                        // Scale eases back to 1 while held.
                state.scale += (1 - state.scale) * 0.15;
              }
      }

      // Tilt from horizontal velocity, subtle
      const tilt = Math.max(-cfg.maxTilt, Math.min(cfg.maxTilt, state.vx * cfg.tiltPerVx * 10));

      // Compose transform. In reduced-motion mode, kill tilt and rotation entirely.
      if (state.reducedMotion) {
              state.el.style.transform = `translate3d(${state.x}px, ${state.y}px, 0) scale(${state.scale.toFixed(3)})`;
      } else {
              state.el.style.transform =
                        `translate3d(${state.x}px, ${state.y}px, 0) rotate(${tilt.toFixed(2)}deg) scale(${state.scale.toFixed(3)})`;
      }

      state.rafId = requestAnimationFrame(loop);
   }

   // ---------------- Public API ----------------
   window.CardPhysics = {
         init, cfg, state,
         setAnchor,
         snapHome: () => snapToAnchor(true),
         pause:    () => { state.paused = true; },
         resume:   () => { state.paused = false; },
         togglePause: () => { state.paused = !state.paused; }
   };

   if (document.readyState === 'loading') {
         document.addEventListener('DOMContentLoaded', init);
   } else {
         init();
   }
})();
