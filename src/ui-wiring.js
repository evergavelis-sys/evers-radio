// src/ui-wiring.js
// Minimal glue: connects new toolbar buttons to the module APIs.
// Lives in its own file so it can't break the existing src/ui.js.

(function () {
  'use strict';

  function ready(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn, { once: true });
    } else {
      fn();
    }
  }

  ready(() => {
    // --- ? help button → replay intro animation if available, else show help popup
    const helpBtn = document.getElementById('btn-help');
    if (helpBtn) {
      helpBtn.addEventListener('click', () => {
        if (window.IntroAnimation && typeof window.IntroAnimation.play === 'function') {
          window.IntroAnimation.play({ reason: 'replay' });
        } else if (window.StartupPopup) {
          window.StartupPopup.toggle();
        }
      });
    }

    // --- Mode button → cycle modes, reflect label
    const modeBtn = document.getElementById('btn-mode');
    if (modeBtn && window.Modes) {
      const render = (m) => {
        if (!m) return;
        modeBtn.textContent = 'mode: ' + m.label;
        modeBtn.title = m.tagline + ' (M)';
      };
      // Initial paint + subscribe
      render(window.Modes.meta(window.Modes.get()));
      window.Modes.on(render);
      modeBtn.addEventListener('click', (e) => {
        window.Modes.cycle(e.shiftKey ? -1 : 1);
      });
    }

    // --- Card physics reacts to mode changes
    // Subscribe once Modes exists.
    if (window.Modes && window.CardPhysics && typeof window.CardPhysics.updateConfig === 'function') {
      window.Modes.on((m) => {
        if (!m) return;
        window.CardPhysics.updateConfig({
          friction: m.params.cardFriction,
          tiltDeg: m.params.cardTiltDeg,
          bounce: m.params.cardBounce,
          driftHomeMs: m.params.cardDriftHomeMs,
        });
      });
    }
  });
})();
