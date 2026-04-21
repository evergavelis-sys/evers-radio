// src/intro-animation.js
// First-visit intro: wordmark → tagline → staggered instructions → graceful dissolve.
// Runs full-screen over the visualizer. Skippable with any key or click.
//
// Behavior:
//   - Auto-plays once per browser (localStorage key 'er.seenIntroAnim').
//     Supersedes startup-popup for first visit (startup-popup checks same key).
//   - Replay via window.IntroAnimation.play() — wired from the ? button later.
//   - Respects prefers-reduced-motion: instant show+fade, no transforms.
//
// Public API:
//   window.IntroAnimation.play({ reason })  // 'first-visit' | 'replay'
//   window.IntroAnimation.stop()
//   window.IntroAnimation.hasPlayed()

(function () {
  'use strict';

  const STORAGE_KEY = 'er.seenIntroAnim';
  const VERSION = 1;

  // Timing (ms)
  const T = {
    wordmarkFadeIn: 700,
    wordmarkHold: 900,
    taglineFadeIn: 600,
    taglineHold: 500,
    instructionStagger: 120,
    instructionFadeIn: 500,
    instructionHold: 1800,
    dissolve: 900,
  };

  const INSTRUCTIONS = [
    { key: 'play something', sub: 'in spotify — the visuals follow' },
    { key: 'drag the art', sub: 'glass surface physics' },
    { key: 'press ?', sub: 'for help, any time' },
    { key: 'press M', sub: 'switch moods' },
  ];

  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let root = null;
  let timers = [];
  let playing = false;
  let onCompleteCb = null;

  function hasPlayed() {
    try {
      const v = localStorage.getItem(STORAGE_KEY);
      return v && Number(v) >= VERSION;
    } catch (_) { return false; }
  }

  function markPlayed() {
    try { localStorage.setItem(STORAGE_KEY, String(VERSION)); } catch (_) {}
  }

  function schedule(fn, ms) {
    const id = setTimeout(() => {
      timers = timers.filter(t => t !== id);
      fn();
    }, ms);
    timers.push(id);
    return id;
  }

  function clearAllTimers() {
    timers.forEach(id => clearTimeout(id));
    timers = [];
  }

  function build() {
    const el = document.createElement('div');
    el.id = 'intro-anim';
    el.className = 'intro-anim';
    el.setAttribute('aria-hidden', 'false');
    el.setAttribute('role', 'presentation');
    el.innerHTML = `
      <div class="intro-anim-backdrop"></div>
      <div class="intro-anim-stage">
        <div class="intro-anim-logo-slot" aria-hidden="true">
          <!-- Placeholder "e" mark — swap for umbrella logo later -->
          <div class="intro-anim-mark">
            <span class="intro-anim-mark-glyph">e</span>
            <span class="intro-anim-mark-ring"></span>
          </div>
        </div>
        <div class="intro-anim-wordmark">
          <span class="intro-anim-word">ever's</span>
          <span class="intro-anim-word">radio</span>
        </div>
        <div class="intro-anim-tagline">an ambient environment, driven by your music</div>
        <ul class="intro-anim-instructions" aria-hidden="true">
          ${INSTRUCTIONS.map((it, i) => `
            <li class="intro-anim-instruction" style="--i:${i}">
              <span class="intro-anim-instr-key">${it.key}</span>
              <span class="intro-anim-instr-sub">${it.sub}</span>
            </li>
          `).join('')}
        </ul>
        <div class="intro-anim-skip">press any key to skip</div>
      </div>
    `;
    return el;
  }

  function run() {
    // Reveal stages via class toggles (CSS handles the actual motion)
    if (reduced) {
      // Accessibility path: show everything briefly, then fade.
      root.classList.add('show-all');
      schedule(finish, 1600);
      return;
    }

    // Stage 1: wordmark
    schedule(() => root.classList.add('stage-word'), 80);
    // Stage 2: tagline
    schedule(() => root.classList.add('stage-tag'), T.wordmarkFadeIn + T.wordmarkHold);
    // Stage 3: instructions (CSS uses --i for stagger)
    schedule(() => root.classList.add('stage-instr'),
      T.wordmarkFadeIn + T.wordmarkHold + T.taglineFadeIn + T.taglineHold);
    // Stage 4: dissolve
    const dissolveAt =
      T.wordmarkFadeIn + T.wordmarkHold +
      T.taglineFadeIn + T.taglineHold +
      (INSTRUCTIONS.length * T.instructionStagger) + T.instructionFadeIn +
      T.instructionHold;
    schedule(finish, dissolveAt);
  }

  function finish() {
    if (!root) return;
    root.classList.add('dissolving');
    schedule(() => {
      markPlayed();
      cleanup();
      if (typeof onCompleteCb === 'function') {
        try { onCompleteCb(); } catch (_) {}
      }
    }, T.dissolve);
  }

  function cleanup() {
    clearAllTimers();
    if (root && root.parentNode) root.parentNode.removeChild(root);
    root = null;
    playing = false;
    document.removeEventListener('keydown', onSkipKey, true);
    if (root) root.removeEventListener('click', onSkipClick);
  }

  function onSkipKey(e) {
    // Any key skips (including Escape). Ignore modifier-only events.
    if (e.key === 'Shift' || e.key === 'Meta' || e.key === 'Control' || e.key === 'Alt') return;
    e.preventDefault();
    skip();
  }

  function onSkipClick() { skip(); }

  function skip() {
    if (!playing) return;
    clearAllTimers();
    finish();
  }

  function play(opts = {}) {
    if (playing) return;
    const { reason = 'replay', onComplete = null } = opts;
    onCompleteCb = onComplete;
    playing = true;

    root = build();
    document.body.appendChild(root);

    // Force reflow before adding .playing so transitions actually run
    void root.offsetWidth;
    root.classList.add('playing');

    document.addEventListener('keydown', onSkipKey, true);
    root.addEventListener('click', onSkipClick);

    run();
  }

  function stop() {
    if (!playing) return;
    clearAllTimers();
    cleanup();
  }

  // ---- Auto-play on first visit -------------------------------------------
  function maybeAutoPlay() {
    if (hasPlayed()) return;
    // Coordinate with startup-popup: suppress the popup for first visit,
    // since the intro animation already covers the onboarding copy.
    try { localStorage.setItem('er.seenIntro', '1'); } catch (_) {}
    // Small delay so the visualizer paints under us
    setTimeout(() => play({ reason: 'first-visit' }), 250);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', maybeAutoPlay, { once: true });
  } else {
    maybeAutoPlay();
  }

  // Public API
  window.IntroAnimation = { play, stop, hasPlayed };
})();
