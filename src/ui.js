// ui.js
// Toggle bar + album-art card + keyboard shortcuts + mouse-idle cursor hide.
// No framework — plain DOM, callbacks into app.js via window.UI.bind().

(function () {
  const ART_MODES = ['intro', 'always', 'faded', 'off'];

  const els = {};
  const callbacks = {
    next: () => {}, prev: () => {}, random: () => {}, lock: () => {},
    cycleTrack: () => {}, cycleSection: () => {}, cycleAuto: () => {},
    artMode: () => {}, reauth: () => {}, fullscreen: () => {}
  };

  let idleTimer = null;
  let idleCursor = null;
  let barLocked = false; // M toggle overrides auto-hide

  function $(id) { return document.getElementById(id); }

  function init() {
    els.authGate = $('auth-gate');
    els.bar = $('toggle-bar');
    els.card = $('album-card');
    els.art = $('album-art');
    els.title = $('track-title');
    els.artist = $('track-artist');
    els.album = $('track-album');
    els.btnArt = $('btn-art-mode');
    els.btnPrev = $('btn-prev');
    els.btnRandom = $('btn-random');
    els.btnNext = $('btn-next');
    els.btnLock = $('btn-lock');
    els.btnCycleTrack = $('btn-cycle-track');
    els.btnCycleSection = $('btn-cycle-section');
    els.btnCycleAuto = $('btn-cycle-auto');
    els.btnFullscreen = $('btn-fullscreen');
    els.btnReauth = $('btn-reauth');
    els.status = $('status-strip');
    els.authorize = $('authorize-btn');

    els.btnPrev.addEventListener('click', () => callbacks.prev());
    els.btnRandom.addEventListener('click', () => callbacks.random());
    els.btnNext.addEventListener('click', () => callbacks.next());
    els.btnLock.addEventListener('click', () => {
      const now = !(els.btnLock.classList.contains('active'));
      els.btnLock.classList.toggle('active', now);
      callbacks.lock(now);
    });
    els.btnArt.addEventListener('click', () => cycleArtMode());
    els.btnCycleTrack.addEventListener('click', () => togglePill(els.btnCycleTrack, v => callbacks.cycleTrack(v)));
    els.btnCycleSection.addEventListener('click', () => togglePill(els.btnCycleSection, v => callbacks.cycleSection(v)));
    els.btnCycleAuto.addEventListener('click', () => togglePill(els.btnCycleAuto, v => callbacks.cycleAuto(v)));
    els.btnFullscreen.addEventListener('click', () => toggleFullscreen());
    els.btnReauth.addEventListener('click', () => callbacks.reauth());
    els.authorize.addEventListener('click', () => callbacks.authorize && callbacks.authorize());

    document.addEventListener('mousemove', onActivity);
    document.addEventListener('keydown', onKey);
  }

  function togglePill(btn, cb) {
    const now = !(btn.classList.contains('active'));
    btn.classList.toggle('active', now);
    cb(now);
  }

  function cycleArtMode() {
    const currentLabel = els.btnArt.textContent.replace('art: ', '');
    const idx = ART_MODES.indexOf(currentLabel);
    const next = ART_MODES[(idx + 1) % ART_MODES.length];
    setArtModeLabel(next);
    callbacks.artMode(next);
  }

  function setArtModeLabel(mode) {
    els.btnArt.textContent = 'art: ' + mode;
  }

  function onActivity() {
    els.bar.classList.add('visible');
    document.body.classList.remove('cursor-hidden');
    clearTimeout(idleTimer);
    clearTimeout(idleCursor);
    if (!barLocked) {
      idleTimer = setTimeout(() => els.bar.classList.remove('visible'), 3000);
    }
    idleCursor = setTimeout(() => document.body.classList.add('cursor-hidden'), 2500);
  }

  function onKey(e) {
    // Ignore when typing in input fields (none currently, but future-proof).
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    switch (e.key.toLowerCase()) {
      case 'f': toggleFullscreen(); break;
      case 'n': case 'arrowright': callbacks.next(); break;
      case 'p': case 'arrowleft': callbacks.prev(); break;
      case 'r': callbacks.random(); break;
      case 'l': els.btnLock.click(); break;
      case 'a': cycleArtMode(); break;
      case 'm':
        barLocked = !barLocked;
        els.bar.classList.toggle('visible', barLocked || true);
        if (!barLocked) setTimeout(() => els.bar.classList.remove('visible'), 3000);
        break;
      default: return;
    }
    e.preventDefault();
  }

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen();
    }
  }

  function showAuthGate(show) {
    els.authGate.classList.toggle('hidden', !show);
    els.bar.classList.toggle('hidden', show);
  }

  function setTrackMeta({ title, artist, album, artUrl }) {
    els.title.textContent = title || '';
    els.artist.textContent = artist || '';
    els.album.textContent = album || '';
    if (artUrl) els.art.src = artUrl;
  }

  function setAlbumCardVisible(visible, fadeMs, faded = false) {
    els.card.classList.remove('hidden');
    els.card.style.setProperty('--album-fade', (fadeMs || 500) + 'ms');
    els.card.classList.toggle('faded', faded);
    // Force a reflow so the transition re-triggers.
    void els.card.offsetWidth;
    els.card.classList.toggle('visible', visible);
  }

  function setAccent(hex) {
    if (!hex) return;
    document.documentElement.style.setProperty('--accent', hex);
  }

  function setStatus(msg, ttl = 4000) {
    if (!msg) { els.status.classList.add('hidden'); return; }
    els.status.textContent = msg;
    els.status.classList.remove('hidden');
    clearTimeout(setStatus._t);
    if (ttl > 0) setStatus._t = setTimeout(() => els.status.classList.add('hidden'), ttl);
  }

  function bind(cbs) { Object.assign(callbacks, cbs); }

  window.UI = {
    init, bind, showAuthGate, setTrackMeta, setAlbumCardVisible,
    setAccent, setStatus, setArtModeLabel, toggleFullscreen
  };
})();
