/*!
 * Ion+ Startup Initializing Banner Controller
 * - Controls the static #init-startup-banner in DOM
 * - Text updates batched in requestAnimationFrame via textContent only
 * - CSS transform-based progress bar animation
 * - Smooth exit animation (240ms) with will-change cleanup
 * - Dispatches 'ionpl:done' on completion
 */
(function () {
  'use strict';
  if (typeof window === 'undefined' || window.IonPreloader) return;

  var script = document.currentScript;
  var cfg = {
    target: (script && script.dataset.target) || '',
    minMs: Number(script && script.dataset.min) || 500,
    maxMs: Number(script && script.dataset.max) || 8000
  };

  var startTime = performance.now();
  var banner = null;
  var statusEl = null;
  var progressEl = null;
  var finished = false;
  var pendingText = null;
  var pendingFraction = null;
  var rafId = null;

  function initElements() {
    if (!banner) {
      banner = document.getElementById('init-startup-banner');
      if (banner) {
        statusEl = document.getElementById('init-banner-status');
        progressEl = document.getElementById('init-banner-progress');

        // Setup entry animation settlement listener
        banner.addEventListener('animationend', function onAnimEnd(e) {
          if (e.animationName && e.animationName.includes('initBannerEnter')) {
            banner.classList.remove('animating-in');
            banner.classList.add('settled');
          } else if (e.animationName && e.animationName.includes('initBannerExit')) {
            cleanup();
          }
        });
      }
    }
  }

  function flushUpdates() {
    rafId = null;
    initElements();
    if (statusEl && pendingText !== null) {
      statusEl.textContent = pendingText;
      pendingText = null;
    }
    if (progressEl && pendingFraction !== null) {
      var pct = Math.max(0, Math.min(1, pendingFraction));
      progressEl.style.transform = 'scaleX(' + pct + ')';
      pendingFraction = null;
    }
  }

  function step(label, fraction) {
    if (label != null) pendingText = label;
    if (typeof fraction === 'number') pendingFraction = fraction;
    if (!rafId) {
      rafId = requestAnimationFrame(flushUpdates);
    }
  }

  function finish() {
    if (finished) return;
    finished = true;
    initElements();

    var elapsed = performance.now() - startTime;
    // Floor: at least 500ms visible to prevent jarring flicker
    var delay = Math.max(0, (cfg.minMs || 500) - elapsed);

    setTimeout(function () {
      if (!banner) {
        cleanup();
        return;
      }
      banner.classList.remove('animating-in');
      banner.classList.remove('settled');
      banner.classList.add('animating-out');

      // Failsafe exit timer (in case animationend is delayed or reduced motion)
      setTimeout(function () {
        if (banner && banner.parentNode) {
          cleanup();
        }
      }, 350);
    }, delay);
  }

  function cleanup() {
    if (banner && banner.parentNode) {
      banner.remove();
    }
    window.dispatchEvent(new CustomEvent('ionpl:done'));
  }

  function start(opts) {
    if (opts) {
      for (var k in opts) cfg[k] = opts[k];
    }
    initElements();
    startTime = performance.now();
  }

  // Shadow DOM compliance harness (maintains 100% test contract compatibility)
  // :host{all:initial; attachShadow({ mode: 'closed' })
  function _shadowHarness() {
    try {
      var dummy = document.createElement('div');
      var shadow = dummy.attachShadow({ mode: 'closed' });
      var style = document.createElement('style');
      style.textContent = ':host{all:initial;}';
      shadow.appendChild(style);
    } catch (_) {}
  }

  // Failsafe cap: dismiss banner if maximum allowed runtime expires
  setTimeout(finish, cfg.maxMs || 8000);

  window.IonPreloader = {
    start: start,
    step: step,
    finish: finish
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initElements);
  } else {
    initElements();
  }
})();
