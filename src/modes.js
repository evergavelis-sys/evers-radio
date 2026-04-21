// src/modes.js
// Mood/Mode system — "different modes for different moods".
// A thin coordinator that broadcasts mode changes via CustomEvent('er:mode-change').
// Other modules (visualizer, card-physics, future FFT) subscribe and adjust themselves.
//
// Modes are declarative presets of parameters. No behavior is hardcoded here;
// we publish the *values* and let subscribers decide how to interpret them.
//
// Public API (window.Modes):
//   list()              -> array of mode ids
//   get()               -> current mode id
//   set(id)             -> set active mode, persists to localStorage
//   cycle()             -> move to next mode
//   meta(id)            -> { id, label, tagline, params }
//   on(fn)              -> subscribe; fn(meta) called on every change; returns unsubscribe
//
// Hotkey: 'M' cycles, hold Shift+M to go backwards.

(function () {
    'use strict';

   const STORAGE_KEY = 'er.mode';
    const DEFAULT_ID = 'ambient';

   // ---- Mode definitions ---------------------------------------------------
   // Keep params flat and named; subscribers pick what they need.
   // Numbers are intentionally conservative — future FFT/visualizer work
   // can multiply against these as gain stages.
   const MODES = [
     {
             id: 'ambient',
             label: 'ambient',
             tagline: 'calm environment, slow breath',
             params: {
                       // card physics
               cardFriction: 0.92,
                       cardTiltDeg: 3,
                       cardBounce: 0.35,
                       cardDriftHomeMs: 4000,
                       // preset cycling (seconds between auto-cycle)
                       presetAutoCycleSec: 120,
                       cycleOnSection: false,
                       cycleOnTrack: true,
                       // reactivity (0..1) — how much audio drives visuals; FFT module will read this
                       reactivity: 0.35,
                       // accent hue shift (0..360) applied to UI chrome by style
                       accentHue: 200,
             },
     },
     {
             id: 'focus',
             label: 'focus',
             tagline: 'minimal motion, long-form listening',
             params: {
                       cardFriction: 0.88, // more damping, card settles faster
                       cardTiltDeg: 1.5,
                       cardBounce: 0.2,
                       cardDriftHomeMs: 2500,
                       presetAutoCycleSec: 300, // barely cycles
                       cycleOnSection: false,
                       cycleOnTrack: false,
                       reactivity: 0.15,
                       accentHue: 150,
             },
     },
     {
             id: 'rave',
             label: 'rave',
             tagline: 'high reactivity, fast cycling',
             params: {
                       cardFriction: 0.965, // slippery — flings carry
                       cardTiltDeg: 6,
                       cardBounce: 0.6,
                       cardDriftHomeMs: 6000,
                       presetAutoCycleSec: 30,
                       cycleOnSection: true,
                       cycleOnTrack: true,
                       reactivity: 0.9,
                       accentHue: 320,
             },
     },
       ];

   const BY_ID = Object.fromEntries(MODES.map(m => [m.id, m]));

   // ---- State --------------------------------------------------------------
   let currentId = loadStoredId();
    const listeners = new Set();

   function loadStoredId() {
         try {
                 const v = localStorage.getItem(STORAGE_KEY);
                 if (v && BY_ID[v]) return v;
         } catch (_) {}
         return DEFAULT_ID;
   }

   function persist(id) {
         try { localStorage.setItem(STORAGE_KEY, id); } catch (_) {}
   }

   function meta(id) {
         const m = BY_ID[id || currentId];
         return m ? { ...m, params: { ...m.params } } : null;
   }

   function broadcast() {
         const payload = meta(currentId);
         // local listeners
      listeners.forEach(fn => {
              try { fn(payload); } catch (e) { console.warn('[modes] listener error', e); }
      });
         // global event (subscribers can be anywhere, load order independent)
      try {
              window.dispatchEvent(new CustomEvent('er:mode-change', { detail: payload }));
      } catch (_) {}
         // Reflect on <html data-mode="..."> so CSS can pick it up
      if (document.documentElement) {
              document.documentElement.setAttribute('data-mode', currentId);
      }
   }

   function set(id) {
         if (!BY_ID[id] || id === currentId) return;
         currentId = id;
         persist(id);
         broadcast();
         flashToast();
   }

   function cycle(dir = 1) {
         const idx = MODES.findIndex(m => m.id === currentId);
         const next = MODES[(idx + dir + MODES.length) % MODES.length];
         set(next.id);
   }

   function on(fn) {
         if (typeof fn !== 'function') return () => {};
         listeners.add(fn);
         // fire immediately so late subscribers sync up
      try { fn(meta(currentId)); } catch (_) {}
         return () => listeners.delete(fn);
   }

   function list() { return MODES.map(m => m.id); }
    function get()  { return currentId; }

   // ---- Hotkey -------------------------------------------------------------
   document.addEventListener('keydown', (e) => {
         const tag = (e.target && e.target.tagName) || '';
         if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target && e.target.isContentEditable)) return;
         if (e.metaKey || e.ctrlKey || e.altKey) return;
         if (e.key === 'm' || e.key === 'M') {
                 e.preventDefault();
                 cycle(e.shiftKey ? -1 : 1);
         }
   });

   // ---- Toast (tiny, for mode change feedback) -----------------------------
   let toastEl = null;
    let toastTimer = null;
    function flashToast() {
          const m = meta(currentId);
          if (!m) return;
          if (!toastEl) {
                  toastEl = document.createElement('div');
                  toastEl.id = 'mode-toast';
                  toastEl.className = 'mode-toast';
                  toastEl.setAttribute('role', 'status');
                  toastEl.setAttribute('aria-live', 'polite');
                  document.body.appendChild(toastEl);
          }
          toastEl.innerHTML = `
                <span class="mode-toast-label">mode</span>
                      <span class="mode-toast-value">${m.label}</span>
                            <span class="mode-toast-tagline">${m.tagline}</span>
                                `;
          toastEl.classList.add('visible');
          clearTimeout(toastTimer);
          toastTimer = setTimeout(() => {
                  if (toastEl) toastEl.classList.remove('visible');
          }, 1800);
    }

   // ---- Boot ---------------------------------------------------------------
   // Reflect initial mode on <html> before first paint, if possible.
   if (document.documentElement) {
         document.documentElement.setAttribute('data-mode', currentId);
   }
    // Broadcast once DOM is ready so late-loaded modules hear the first event.
   function bootBroadcast() { broadcast(); }
    if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', bootBroadcast, { once: true });
    } else {
          // Defer one tick so subscribers that register synchronously after us still receive it
      setTimeout(bootBroadcast, 0);
    }

   // Public API
   window.Modes = { list, get, set, cycle, meta, on };
})();
