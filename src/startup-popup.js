// src/startup-popup.js
// First-visit explainer popup + "?" help overlay.
// Dependency-free, plain script. Safe to load anywhere in <head>/<body>.
//
// Exposes:
//   window.StartupPopup.show(reason)   // reason: 'first-visit' | 'help'
//   window.StartupPopup.hide()
//   window.StartupPopup.toggle()
//   window.StartupPopup.markSeen()
//
// Auto-shows on first load (localStorage key 'er.seenIntro').
// Listens for '?' or 'h' key to toggle help overlay.
// Listens for 'Escape' to close.

(function () {
    'use strict';

   const STORAGE_KEY = 'er.seenIntro';
    const VERSION = 1; // bump if intro content changes meaningfully

   let overlay = null;
    let lastFocus = null;
    let keyHandler = null;

   function hasSeen() {
         try {
                 const v = localStorage.getItem(STORAGE_KEY);
                 return v && Number(v) >= VERSION;
         } catch (_) {
                 return false;
         }
   }

   function markSeen() {
         try { localStorage.setItem(STORAGE_KEY, String(VERSION)); } catch (_) {}
   }

   function buildOverlay(reason) {
         const root = document.createElement('div');
         root.id = 'intro-overlay';
         root.className = 'intro-overlay';
         root.setAttribute('role', 'dialog');
         root.setAttribute('aria-modal', 'true');
         root.setAttribute('aria-labelledby', 'intro-title');
         root.innerHTML = `
               <div class="intro-backdrop" data-dismiss="1"></div>
                     <div class="intro-card" tabindex="-1">
                             <div class="intro-brand">
                                       <div class="intro-wordmark">ever's radio</div>
                                                 <div class="intro-subtitle">an ambient environment, driven by your music</div>
                                                         </div>

                                                                 <div class="intro-body">
                                                                           <p class="intro-lede">
                                                                                       Spotify tells the visuals what to do. The album art floats on a glass surface —
                                                                                                   nudge it, fling it, send it home. Everything breathes with the track.
                                                                                                             </p>
                                                                                                             
                                                                                                                       <div class="intro-grid">
                                                                                                                                   <div class="intro-section">
                                                                                                                                                 <div class="intro-section-label">card</div>
                                                                                                                                                               <ul>
                                                                                                                                                                               <li><kbd>drag</kbd> the art to play</li>
                                                                                                                                                                                               <li><kbd>double-click</kbd> to send home</li>
                                                                                                                                                                                                               <li><kbd>1</kbd>–<kbd>5</kbd> corners & center</li>
                                                                                                                                                                                                                               <li><kbd>space</kbd> pause physics</li>
                                                                                                                                                                                                                                             </ul>
                                                                                                                                                                                                                                                         </div>
                                                                                                                                                                                                                                                                     <div class="intro-section">
                                                                                                                                                                                                                                                                                   <div class="intro-section-label">visuals</div>
                                                                                                                                                                                                                                                                                                 <ul>
                                                                                                                                                                                                                                                                                                                 <li><kbd>←</kbd> <kbd>→</kbd> preset prev / next</li>
                                                                                                                                                                                                                                                                                                                                 <li><kbd>R</kbd> random, <kbd>L</kbd> lock</li>
                                                                                                                                                                                                                                                                                                                                                 <li><kbd>F</kbd> fullscreen</li>
                                                                                                                                                                                                                                                                                                                                                                 <li><kbd>M</kbd> mode (soon: ambient / focus / rave)</li>
                                                                                                                                                                                                                                                                                                                                                                               </ul>
                                                                                                                                                                                                                                                                                                                                                                                           </div>
                                                                                                                                                                                                                                                                                                                                                                                                     </div>
                                                                                                                                                                                                                                                                                                                                                                                                     
                                                                                                                                                                                                                                                                                                                                                                                                               <p class="intro-footnote">
                                                                                                                                                                                                                                                                                                                                                                                                                           press <kbd>?</kbd> anytime to see this again. <span class="intro-dot">·</span>
                                                                                                                                                                                                                                                                                                                                                                                                                                       press <kbd>esc</kbd> to dismiss.
                                                                                                                                                                                                                                                                                                                                                                                                                                                 </p>
                                                                                                                                                                                                                                                                                                                                                                                                                                                         </div>
                                                                                                                                                                                                                                                                                                                                                                                                                                                         
                                                                                                                                                                                                                                                                                                                                                                                                                                                                 <div class="intro-actions">
                                                                                                                                                                                                                                                                                                                                                                                                                                                                           <button type="button" class="intro-primary" data-dismiss="1">let's go</button>
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   </div>
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           <div class="intro-meta">
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     <span class="intro-pkce">PKCE · no server · your token stays in this tab</span>
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             </div>
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   </div>
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       `;

      // Delegate dismiss clicks
      root.addEventListener('click', (e) => {
              const t = e.target;
              if (t && (t.getAttribute('data-dismiss') === '1')) {
                        hide();
              }
      });

      return root;
   }

   function show(reason = 'help') {
         if (overlay) return; // already open

      overlay = buildOverlay(reason);
         document.body.appendChild(overlay);

      // Focus management — remember previous focus, then move it in.
      lastFocus = document.activeElement;
         requestAnimationFrame(() => {
                 overlay.classList.add('visible');
                 const card = overlay.querySelector('.intro-card');
                 if (card) card.focus();
         });

      // Key handler (scoped while overlay is up)
      keyHandler = (e) => {
              if (e.key === 'Escape') { e.preventDefault(); hide(); return; }
              // trap Tab within the card
              if (e.key === 'Tab') {
                        const focusables = overlay.querySelectorAll(
                                    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
                                  );
                        if (!focusables.length) return;
                        const first = focusables[0], last = focusables[focusables.length - 1];
                        if (e.shiftKey && document.activeElement === first) {
                                    e.preventDefault(); last.focus();
                        } else if (!e.shiftKey && document.activeElement === last) {
                                    e.preventDefault(); first.focus();
                        }
              }
      };
         document.addEventListener('keydown', keyHandler, true);

      if (reason === 'first-visit') markSeen();
   }

   function hide() {
         if (!overlay) return;
         overlay.classList.remove('visible');
         const toRemove = overlay;
         overlay = null;
         document.removeEventListener('keydown', keyHandler, true);
         keyHandler = null;

      // Allow CSS fade-out before removing
      setTimeout(() => {
              if (toRemove && toRemove.parentNode) toRemove.parentNode.removeChild(toRemove);
      }, 220);

      // Restore focus
      if (lastFocus && typeof lastFocus.focus === 'function') {
              try { lastFocus.focus(); } catch (_) {}
      }
         lastFocus = null;

      // Mark seen on any dismiss, so it doesn't keep re-popping
      markSeen();
   }

   function toggle() {
         if (overlay) hide(); else show('help');
   }

   // Global hotkey for help (?, h). Intentionally ignored while typing.
   document.addEventListener('keydown', (e) => {
         const tag = (e.target && e.target.tagName) || '';
         if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable) return;
         // '?' is Shift+/ on US keyboards; accept either
                                 if (e.key === '?' || (e.key === '/' && e.shiftKey)) {
                                         e.preventDefault();
                                         toggle();
                                 } else if (e.key === 'h' || e.key === 'H') {
                                         // Don't clobber if some input owns 'H'; we're only listening at bubble phase.
           if (!overlay) { e.preventDefault(); show('help'); }
                                 }
   });

   // Auto-show on first visit, once DOM is ready.
   function maybeAutoShow() {
         if (!hasSeen()) {
                 // Delay briefly so the visualizer can paint a first frame underneath
           setTimeout(() => show('first-visit'), 450);
         }
   }

   if (document.readyState === 'loading') {
         document.addEventListener('DOMContentLoaded', maybeAutoShow, { once: true });
   } else {
         maybeAutoShow();
   }

   // Public API
   window.StartupPopup = { show, hide, toggle, markSeen };
})();
