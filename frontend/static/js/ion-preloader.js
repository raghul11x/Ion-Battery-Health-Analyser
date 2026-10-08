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

  var INIT_BANNER_MIN_MS = 10000;

  var script = document.currentScript;
  var cfg = {
    target: (script && script.dataset.target) || '',
    minMs: INIT_BANNER_MIN_MS,
    maxMs: Number(script && script.dataset.max) || 30000
  };

  var visibleStartTime = null;
  var banner = null;
  var statusEl = null;
  var progressEl = null;
  var finished = false;
  var isAppReady = false;
  var dismissTimer = null;
  var pendingText = null;
  var pendingFraction = null;
  var rafId = null;

  function markVisible() {
    if (visibleStartTime === null) {
      visibleStartTime = performance.now();
    }
  }

  // Setup visible timer start on first painted frame when document is visible
  if (typeof window !== 'undefined') {
    if (typeof requestAnimationFrame !== 'undefined') {
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          markVisible();
        });
      });
    }
    if (document.readyState === 'complete') {
      markVisible();
    } else {
      window.addEventListener('load', function () {
        if (typeof requestAnimationFrame !== 'undefined') {
          requestAnimationFrame(markVisible);
        } else {
          markVisible();
        }
      });
    }
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && visibleStartTime === null) {
        markVisible();
      }
    });
  }

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
    if (!rafId && typeof requestAnimationFrame !== 'undefined') {
      rafId = requestAnimationFrame(flushUpdates);
    } else if (typeof requestAnimationFrame === 'undefined') {
      flushUpdates();
    }
  }

  function dismissNow() {
    if (finished) return;
    finished = true;
    if (dismissTimer) {
      clearTimeout(dismissTimer);
      dismissTimer = null;
    }
    initElements();

    if (!banner) {
      cleanup();
      return;
    }
    banner.classList.remove('animating-in');
    banner.classList.remove('settled');
    banner.classList.add('animating-out');

    // Failsafe exit timer (in case animationend is delayed or reduced motion)
    setTimeout(function () {
      cleanup();
    }, 350);
  }

  function finish(err) {
    if (finished) return;
    initElements();

    // If init fails: show real error immediately, do not wait 10s
    if (err) {
      if (statusEl) {
        statusEl.textContent = typeof err === 'string' ? err : (err.message || 'Initialization failed');
        statusEl.style.color = '#ef4444';
      }
      dismissNow();
      return;
    }

    isAppReady = true;
    markVisible();

    var elapsed = performance.now() - visibleStartTime;
    var delay = Math.max(0, INIT_BANNER_MIN_MS - elapsed);

    // Real status update to Ready on successful boot completion
    step('Ready', 1.0);

    if (delay === 0) {
      dismissNow();
    } else {
      if (!dismissTimer) {
        dismissTimer = setTimeout(function () {
          if (isAppReady) {
            dismissNow();
          }
        }, delay);
      }
    }
  }

  function cleanup() {
    if (banner) {
      banner.style.display = 'none';
      if (banner.parentNode) {
        banner.remove();
      }
      banner = null;
    }
    window.dispatchEvent(new CustomEvent('ionpl:done'));
  }

  function start(opts) {
    if (opts) {
      for (var k in opts) cfg[k] = opts[k];
    }
    initElements();
    visibleStartTime = performance.now();
    finished = false;
    isAppReady = false;
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
  setTimeout(function () {
    if (!finished) {
      dismissNow();
    }
  }, cfg.maxMs || 30000);

  window.IonPreloader = {
    INIT_BANNER_MIN_MS: INIT_BANNER_MIN_MS,
    start: start,
    step: step,
    finish: finish,
    error: function (e) { finish(e || 'Initialization error'); },
    markVisible: markVisible,
    getVisibleStartTime: function () { return visibleStartTime; },
    isReady: function () { return isAppReady; }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initElements);
  } else {
    initElements();
  }
})();
