/**
 * Ion+ Performance Subsystem & Dev-Only Diagnostics HUD
 * 
 * Provides:
 * - Refresh rate (Hz) detection & adaptation (60, 75, 90, 120, 144, 165, 240, 360 Hz)
 * - Frame interval & budget calculation
 * - Hidden Diagnostics HUD (Ctrl+Shift+P) with zero overhead when closed
 * - LongTask and LongAnimationFrame observer
 * - Frame pacing & baseline recording harness
 */

(function () {
  'use strict';

  // Standard monitor refresh rates
  const STANDARD_RATES = [60, 75, 90, 120, 144, 165, 240, 360];

  // Global IonPerf namespace
  window.IonPerf = {
    hz: 60,
    rawHz: 60,
    frameMs: 16.67,
    budgetMs: 10.0,
    qualityTier: 'high', // 'high' | 'medium' | 'low'
    gpuRenderer: 'Detecting...',
    isMeasuring: false,
    hudVisible: false,
    longTaskCount: 0,
    worstLongTaskMs: 0,
    recentLongTasks: [],
    // Metrics getters for programmatic testing
    getStats: null,
    startBenchmark: null,
  };

  // Cached GPU string
  function detectGpu() {
    let renderer = 'Software / Fallback';
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      if (gl) {
        const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
        if (debugInfo) {
          renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) || 'WebGL Generic';
        } else {
          renderer = gl.getParameter(gl.RENDERER) || 'WebGL Supported';
        }
      }
      if (typeof navigator !== 'undefined' && navigator.gpu) {
        renderer += ' [WebGPU Active]';
      }
    } catch (_) {}
    return renderer;
  }

  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(() => { window.IonPerf.gpuRenderer = detectGpu(); });
  } else {
    setTimeout(() => { window.IonPerf.gpuRenderer = detectGpu(); }, 1200);
  }

  // 1. Refresh Rate Detection
  function sampleRefreshRate(callback) {
    if (window.IonPerf.isMeasuring) return;
    window.IonPerf.isMeasuring = true;

    const SAMPLES = 65;
    const timestamps = [];

    function onFrame(now) {
      timestamps.push(now);
      if (timestamps.length < SAMPLES) {
        requestAnimationFrame(onFrame);
      } else {
        // Discard first 5 warmup frames
        const valid = timestamps.slice(5);
        const deltas = [];
        for (let i = 1; i < valid.length; i++) {
          const delta = valid[i] - valid[i - 1];
          if (delta > 2 && delta < 50) { // filter extreme anomalies
            deltas.push(delta);
          }
        }

        deltas.sort((a, b) => a - b);
        const medianDelta = deltas.length > 0 ? deltas[Math.floor(deltas.length / 2)] : 16.67;
        const rawHz = 1000 / medianDelta;

        // Snap to nearest standard refresh rate
        let closestHz = 60;
        let minDiff = Infinity;
        for (const std of STANDARD_RATES) {
          const diff = Math.abs(rawHz - std);
          if (diff < minDiff) {
            minDiff = diff;
            closestHz = std;
          }
        }

        const snappedFrameMs = 1000 / closestHz;
        window.IonPerf.hz = closestHz;
        window.IonPerf.rawHz = Math.round(rawHz * 10) / 10;
        window.IonPerf.frameMs = Math.round(snappedFrameMs * 100) / 100;
        window.IonPerf.budgetMs = Math.round((snappedFrameMs * 0.6) * 100) / 100;
        window.IonPerf.isMeasuring = false;

        // Apply CSS variables on root
        document.documentElement.style.setProperty('--hz', `${closestHz}`);
        document.documentElement.style.setProperty('--frame-ms', `${window.IonPerf.frameMs}ms`);

        if (typeof callback === 'function') {
          callback(window.IonPerf);
        }
      }
    }

    requestAnimationFrame(onFrame);
  }

  // Initial detection
  sampleRefreshRate();

  // Re-measure on visibility, focus, or window movement (multi-monitor setups)
  let lastScreenX = window.screenX;
  let lastScreenY = window.screenY;

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      sampleRefreshRate();
    }
  }, { passive: true });

  window.addEventListener('focus', () => {
    sampleRefreshRate();
  }, { passive: true });

  window.addEventListener('resize', () => {
    if (Math.abs(window.screenX - lastScreenX) > 40 || Math.abs(window.screenY - lastScreenY) > 40) {
      lastScreenX = window.screenX;
      lastScreenY = window.screenY;
      sampleRefreshRate();
    }
  }, { passive: true });

  setInterval(() => {
    if (Math.abs(window.screenX - lastScreenX) > 40 || Math.abs(window.screenY - lastScreenY) > 40) {
      lastScreenX = window.screenX;
      lastScreenY = window.screenY;
      sampleRefreshRate();
    }
  }, 4000);

  // 2. LongTask & LongAnimationFrame Observer
  if (typeof PerformanceObserver !== 'undefined' && PerformanceObserver.supportedEntryTypes) {
    try {
      if (PerformanceObserver.supportedEntryTypes.includes('longtask')) {
        const longTaskObserver = new PerformanceObserver((list) => {
          const entries = list.getEntries();
          for (const entry of entries) {
            window.IonPerf.longTaskCount++;
            if (entry.duration > window.IonPerf.worstLongTaskMs) {
              window.IonPerf.worstLongTaskMs = Math.round(entry.duration);
            }
            window.IonPerf.recentLongTasks.push({
              duration: Math.round(entry.duration),
              time: performance.now()
            });
            // Keep recent list clean
            if (window.IonPerf.recentLongTasks.length > 20) {
              window.IonPerf.recentLongTasks.shift();
            }
          }
        });
        longTaskObserver.observe({ entryTypes: ['longtask'] });
      }

      if (PerformanceObserver.supportedEntryTypes.includes('long-animation-frame')) {
        const loafObserver = new PerformanceObserver((list) => {
          const entries = list.getEntries();
          for (const entry of entries) {
            if (entry.duration > window.IonPerf.worstLongTaskMs) {
              window.IonPerf.worstLongTaskMs = Math.round(entry.duration);
            }
          }
        });
        loafObserver.observe({ entryTypes: ['long-animation-frame'] });
      }
    } catch (_) {}
  }

  // 3. Performance HUD UI Implementation
  let hudContainer = null;
  let hudRafId = null;

  // Frame circular buffer for 5-second window
  const frameHistory = []; // { time, delta }

  function createHudElement() {
    if (hudContainer) return hudContainer;

    hudContainer = document.createElement('div');
    hudContainer.id = 'ion-perf-hud';
    hudContainer.setAttribute('role', 'region');
    hudContainer.setAttribute('aria-label', 'Performance Diagnostics HUD');
    hudContainer.style.cssText = `
      position: fixed;
      bottom: 16px;
      right: 16px;
      z-index: 100000;
      background: rgba(11, 15, 28, 0.94);
      backdrop-filter: blur(14px);
      -webkit-backdrop-filter: blur(14px);
      border: 1px solid rgba(56, 189, 248, 0.35);
      border-radius: 14px;
      padding: 12px 16px;
      color: #E2E8F0;
      font-family: var(--font-sans), 'Geist', sans-serif;
      font-size: 11px;
      line-height: 1.5;
      box-shadow: 0 16px 40px rgba(0, 0, 0, 0.7), inset 0 1px 0 rgba(255, 255, 255, 0.15);
      pointer-events: auto;
      user-select: none;
      min-width: 260px;
      display: none;
    `;

    hudContainer.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 6px; margin-bottom: 8px;">
        <span style="font-weight: 700; color: #38BDF8; letter-spacing: 0.05em;">ION+ PERF HUD</span>
        <span id="hud-tier-badge" style="background: rgba(34,197,94,0.2); color: #86EFAC; border: 1px solid rgba(34,197,94,0.3); padding: 1px 6px; border-radius: 6px; font-size: 9px; font-weight: 700;">HIGH</span>
      </div>
      <div style="display: grid; grid-template-columns: 1fr auto; row-gap: 3px; column-gap: 12px;">
        <span style="color: #94A3B8;">Live FPS:</span>
        <span id="hud-live-fps" style="font-weight: 700; color: #FFFFFF; font-variant-numeric: tabular-nums;">--</span>

        <span style="color: #94A3B8;">Display Refresh:</span>
        <span id="hud-refresh-rate" style="font-variant-numeric: tabular-nums;">--</span>

        <span style="color: #94A3B8;">Target / Budget:</span>
        <span id="hud-frame-budget" style="font-variant-numeric: tabular-nums;">--</span>

        <span style="color: #94A3B8;">Worst Frame (5s):</span>
        <span id="hud-worst-frame" style="font-variant-numeric: tabular-nums;">--</span>

        <span style="color: #94A3B8;">Hitch Frames (&gt;1.5x):</span>
        <span id="hud-hitch-count" style="font-variant-numeric: tabular-nums;">0</span>

        <span style="color: #94A3B8;">Main-Thread Stalls:</span>
        <span id="hud-stalls" style="font-variant-numeric: tabular-nums;">0 (max 0ms)</span>
      </div>
      <div style="margin-top: 8px; padding-top: 6px; border-top: 1px solid rgba(255,255,255,0.08); font-size: 9px; color: #64748B; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 240px;" id="hud-gpu-info" title="${window.IonPerf.gpuRenderer}">
        GPU: ${window.IonPerf.gpuRenderer}
      </div>
    `;

    document.body.appendChild(hudContainer);
    return hudContainer;
  }

  // Update HUD values
  let lastHudUpdate = 0;
  let hudFramesSinceLastUpdate = 0;
  let currentFps = 60;

  function runHudLoop(now) {
    if (!window.IonPerf.hudVisible) return;

    if (!runHudLoop.lastFrameTime) {
      runHudLoop.lastFrameTime = now;
    }
    const delta = now - runHudLoop.lastFrameTime;
    runHudLoop.lastFrameTime = now;

    hudFramesSinceLastUpdate++;

    // Record in circular buffer
    frameHistory.push({ time: now, delta });
    const cutoff = now - 5000;
    while (frameHistory.length > 0 && frameHistory[0].time < cutoff) {
      frameHistory.shift();
    }

    // Refresh HUD visual metrics every 250ms
    if (now - lastHudUpdate >= 250) {
      const elapsed = (now - lastHudUpdate) / 1000;
      currentFps = Math.round((hudFramesSinceLastUpdate / elapsed) * 10) / 10;
      hudFramesSinceLastUpdate = 0;
      lastHudUpdate = now;

      // Calculate worst frame in last 5s and hitch count (> 1.5x interval)
      let worstDelta = 0;
      let hitches = 0;
      const hitchThreshold = window.IonPerf.frameMs * 1.5;

      for (let i = 0; i < frameHistory.length; i++) {
        const d = frameHistory[i].delta;
        if (d > worstDelta) worstDelta = d;
        if (d > hitchThreshold) hitches++;
      }

      // Update DOM nodes
      const fpsEl = document.getElementById('hud-live-fps');
      const hzEl = document.getElementById('hud-refresh-rate');
      const budgetEl = document.getElementById('hud-frame-budget');
      const worstEl = document.getElementById('hud-worst-frame');
      const hitchEl = document.getElementById('hud-hitch-count');
      const stallEl = document.getElementById('hud-stalls');
      const tierEl = document.getElementById('hud-tier-badge');

      if (fpsEl) {
        fpsEl.textContent = `${currentFps.toFixed(1)} FPS`;
        fpsEl.style.color = currentFps >= window.IonPerf.hz * 0.95 ? '#4ADE80' : currentFps >= window.IonPerf.hz * 0.8 ? '#FBBF24' : '#F87171';
      }
      if (hzEl) {
        hzEl.textContent = `${window.IonPerf.hz} Hz (${window.IonPerf.rawHz} raw)`;
      }
      if (budgetEl) {
        budgetEl.textContent = `${window.IonPerf.frameMs.toFixed(1)}ms / ${window.IonPerf.budgetMs.toFixed(1)}ms`;
      }
      if (worstEl) {
        worstEl.textContent = `${worstDelta.toFixed(1)} ms`;
        worstEl.style.color = worstDelta <= hitchThreshold ? '#E2E8F0' : '#F87171';
      }
      if (hitchEl) {
        hitchEl.textContent = `${hitches} / ${frameHistory.length} frames`;
        hitchEl.style.color = hitches === 0 ? '#86EFAC' : hitches <= 3 ? '#FDE047' : '#F87171';
      }
      if (stallEl) {
        stallEl.textContent = `${window.IonPerf.longTaskCount} (max ${window.IonPerf.worstLongTaskMs}ms)`;
        stallEl.style.color = window.IonPerf.longTaskCount === 0 ? '#86EFAC' : '#FCA5A5';
      }
      if (tierEl) {
        tierEl.textContent = (window.IonPerf.qualityTier || 'high').toUpperCase();
        if (window.IonPerf.qualityTier === 'low') {
          tierEl.style.background = 'rgba(239,68,68,0.2)';
          tierEl.style.color = '#FCA5A5';
          tierEl.style.borderColor = 'rgba(239,68,68,0.3)';
        } else if (window.IonPerf.qualityTier === 'medium') {
          tierEl.style.background = 'rgba(245,158,11,0.2)';
          tierEl.style.color = '#FDE047';
          tierEl.style.borderColor = 'rgba(245,158,11,0.3)';
        } else {
          tierEl.style.background = 'rgba(34,197,94,0.2)';
          tierEl.style.color = '#86EFAC';
          tierEl.style.borderColor = 'rgba(34,197,94,0.3)';
        }
      }
    }

    hudRafId = requestAnimationFrame(runHudLoop);
  }

  function togglePerfHud(forceState) {
    const el = createHudElement();
    const targetState = typeof forceState === 'boolean' ? forceState : !window.IonPerf.hudVisible;

    window.IonPerf.hudVisible = targetState;

    if (targetState) {
      el.style.display = 'block';
      frameHistory.length = 0;
      runHudLoop.lastFrameTime = null;
      lastHudUpdate = performance.now();
      hudFramesSinceLastUpdate = 0;
      hudRafId = requestAnimationFrame(runHudLoop);
    } else {
      el.style.display = 'none';
      if (hudRafId) {
        cancelAnimationFrame(hudRafId);
        hudRafId = null;
      }
      frameHistory.length = 0;
    }
  }

  // 4. Adaptive Quality Governor
  const GOVERNOR_TIERS = ['low', 'medium', 'high'];
  let currentTierIndex = 2; // 2: high, 1: medium, 0: low
  let cleanFramesStartTime = 0;
  const rollingGovernorWindow = []; // { time, delta }
  let governorRafId = null;
  let isGovernorRunning = false;
  let governorActiveUntil = 0;

  function applyQualityTier(tierName) {
    if (!['high', 'medium', 'low'].includes(tierName)) return;
    window.IonPerf.qualityTier = tierName;
    currentTierIndex = GOVERNOR_TIERS.indexOf(tierName);

    document.body.classList.remove('tier-high', 'tier-medium', 'tier-low', 'no-glass');
    document.documentElement.classList.remove('tier-high', 'tier-medium', 'tier-low', 'no-glass');

    if (tierName === 'medium') {
      document.body.classList.add('tier-medium');
      document.documentElement.classList.add('tier-medium');
      document.documentElement.style.setProperty('--glass-blur', '8px');
    } else if (tierName === 'low') {
      document.body.classList.add('tier-low', 'no-glass');
      document.documentElement.classList.add('tier-low', 'no-glass');
      document.documentElement.style.setProperty('--glass-blur', '0px');
    } else {
      document.body.classList.add('tier-high');
      document.documentElement.classList.add('tier-high');
      document.documentElement.style.setProperty('--glass-blur', '16px');
    }

    // Update HUD tier badge if HUD is present
    const badge = document.getElementById('hud-tier-badge');
    if (badge) {
      badge.textContent = tierName.toUpperCase();
      if (tierName === 'low') {
        badge.style.background = 'rgba(239,68,68,0.2)';
        badge.style.color = '#FCA5A5';
        badge.style.borderColor = 'rgba(239,68,68,0.3)';
      } else if (tierName === 'medium') {
        badge.style.background = 'rgba(245,158,11,0.2)';
        badge.style.color = '#FDE047';
        badge.style.borderColor = 'rgba(245,158,11,0.3)';
      } else {
        badge.style.background = 'rgba(34,197,94,0.2)';
        badge.style.color = '#86EFAC';
        badge.style.borderColor = 'rgba(34,197,94,0.3)';
      }
    }
  }

  // Expose setter for test matrix & verification
  window.IonPerf.setQualityTier = applyQualityTier;

  function processGovernorFrame(now, delta) {
    rollingGovernorWindow.push({ time: now, delta });
    const cutoff = now - 2000; // rolling 2-second window
    while (rollingGovernorWindow.length > 0 && rollingGovernorWindow[0].time < cutoff) {
      rollingGovernorWindow.shift();
    }

    if (rollingGovernorWindow.length < 15) return;

    const hitchThreshold = window.IonPerf.frameMs * 1.5;
    let hitches = 0;
    for (let i = 0; i < rollingGovernorWindow.length; i++) {
      if (rollingGovernorWindow[i].delta > hitchThreshold) {
        hitches++;
      }
    }

    const hitchRate = hitches / rollingGovernorWindow.length;

    // Step quality down if >8% of frames exceed 1.5x interval
    if (hitchRate > 0.08) {
      cleanFramesStartTime = 0;
      if (currentTierIndex > 0) {
        currentTierIndex--;
        applyQualityTier(GOVERNOR_TIERS[currentTierIndex]);
        rollingGovernorWindow.length = 0;
      }
    } else {
      // Step quality back up only after ~10s of clean frames with hysteresis
      if (!cleanFramesStartTime) {
        cleanFramesStartTime = now;
      } else if (now - cleanFramesStartTime >= 10000) {
        if (currentTierIndex < 2) {
          currentTierIndex++;
          applyQualityTier(GOVERNOR_TIERS[currentTierIndex]);
          cleanFramesStartTime = now;
          rollingGovernorWindow.length = 0;
        }
      }
    }
  }

  function runGovernorLoop(now) {
    if (now > governorActiveUntil && !window.IonPerf.hudVisible) {
      isGovernorRunning = false;
      governorRafId = null;
      runGovernorLoop.lastTs = null;
      return;
    }

    const delta = runGovernorLoop.lastTs ? (now - runGovernorLoop.lastTs) : window.IonPerf.frameMs;
    runGovernorLoop.lastTs = now;

    processGovernorFrame(now, delta);

    governorRafId = requestAnimationFrame(runGovernorLoop);
  }

  function startGovernorTracking(durationMs = 3000) {
    governorActiveUntil = Math.max(governorActiveUntil, performance.now() + durationMs);
    if (!isGovernorRunning) {
      isGovernorRunning = true;
      runGovernorLoop.lastTs = performance.now();
      governorRafId = requestAnimationFrame(runGovernorLoop);
    }
  }

  window.IonPerf.onScrollStart = function () {
    // Disabled: scroll does not demote quality tiers or darken cards
  };

  window.IonPerf.onScrollEnd = function () {
    // Disabled
  };

  // Keyboard shortcut: Ctrl + Shift + P
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && (e.key === 'P' || e.key === 'p')) {
      e.preventDefault();
      togglePerfHud();
    }
  });

  // Expose helper to get live stats
  window.IonPerf.getStats = function () {
    let worstDelta = 0;
    let hitches = 0;
    const hitchThreshold = window.IonPerf.frameMs * 1.5;
    for (let i = 0; i < frameHistory.length; i++) {
      const d = frameHistory[i].delta;
      if (d > worstDelta) worstDelta = d;
      if (d > hitchThreshold) hitches++;
    }
    return {
      fps: currentFps,
      hz: window.IonPerf.hz,
      frameMs: window.IonPerf.frameMs,
      budgetMs: window.IonPerf.budgetMs,
      worstDeltaMs: Math.round(worstDelta * 10) / 10,
      hitches,
      totalFrames: frameHistory.length,
      longTasks: window.IonPerf.longTaskCount,
      worstLongTaskMs: window.IonPerf.worstLongTaskMs,
      qualityTier: window.IonPerf.qualityTier,
    };
  };

  // Automated 10-second scroll benchmark runner for baseline and verification tests
  window.IonPerf.startBenchmark = function (viewId, durationSeconds = 10, onComplete) {
    const targetView = document.getElementById(viewId);
    if (!targetView) {
      console.error(`View ${viewId} not found`);
      return;
    }

    // Ensure view is visible
    targetView.classList.remove('hidden');

    const durationMs = durationSeconds * 1000;
    startGovernorTracking(durationMs + 2000);

    const startTs = performance.now();
    let frames = 0;
    const deltas = [];
    let prev = startTs;
    let longTasksAtStart = window.IonPerf.longTaskCount;
    let worstLongTaskAtStart = window.IonPerf.worstLongTaskMs;

    // Smooth continuous scroll simulation
    let scrollPos = 0;
    let scrollDirection = 1;
    const scrollContainer = window;
    const maxScroll = Math.max(document.documentElement.scrollHeight - window.innerHeight, 500);

    function step(now) {
      const delta = now - prev;
      prev = now;
      frames++;
      deltas.push(delta);

      // Continuous programmatic scroll (time-based delta, rate-independent)
      const scrollSpeedPxPerSec = 750;
      scrollPos += (scrollSpeedPxPerSec * (delta / 1000)) * scrollDirection;
      if (scrollPos >= maxScroll) {
        scrollPos = maxScroll;
        scrollDirection = -1;
      } else if (scrollPos <= 0) {
        scrollPos = 0;
        scrollDirection = 1;
      }
      window.scrollTo(0, scrollPos);

      if (now - startTs < durationMs) {
        requestAnimationFrame(step);
      } else {
        // Benchmark complete: analyze
        const elapsed = (now - startTs) / 1000;
        const avgFps = Math.round((frames / elapsed) * 10) / 10;
        const hitchThreshold = window.IonPerf.frameMs * 1.5;
        const strictThreshold = window.IonPerf.frameMs * 1.2;
        let hitches = 0;
        let framesWithin1_2x = 0;
        let worstFrameMs = 0;

        for (const d of deltas) {
          if (d > worstFrameMs) worstFrameMs = d;
          if (d > hitchThreshold) hitches++;
          if (d <= strictThreshold) framesWithin1_2x++;
        }

        const pctWithin1_2x = Math.round((framesWithin1_2x / deltas.length) * 1000) / 10;
        const newLongTasks = window.IonPerf.longTaskCount - longTasksAtStart;

        const results = {
          view: viewId,
          durationS: durationSeconds,
          totalFrames: frames,
          avgFps,
          hz: window.IonPerf.hz,
          frameMs: window.IonPerf.frameMs,
          worstFrameMs: Math.round(worstFrameMs * 10) / 10,
          hitchCount: hitches,
          framesWithin1_2xPct: pctWithin1_2x,
          longTasksDetected: newLongTasks,
          worstLongTaskMs: window.IonPerf.worstLongTaskMs,
          tier: window.IonPerf.qualityTier,
        };

        if (typeof onComplete === 'function') {
          onComplete(results);
        }
      }
    }

    requestAnimationFrame(step);
  };

  // Full baseline & verification suite
  window.IonPerf.runFullSuite = function (onComplete) {
    const views = ['view-dashboard', 'view-trends', 'view-habits', 'view-diagnostics'];
    const suiteResults = {
      timestamp: new Date().toISOString(),
      hz: window.IonPerf.hz,
      frameMs: window.IonPerf.frameMs,
      budgetMs: window.IonPerf.budgetMs,
      gpu: window.IonPerf.gpuRenderer,
      tests: []
    };

    function runScenario(viewIndex, isConnected, done) {
      if (viewIndex >= views.length) {
        if (!isConnected) {
          // Switch to connected / seeded state
          console.log('[PERF SUITE] Seeding demo dataset for connected tests...');
          const seedBtn = document.getElementById('seed-btn');
          if (seedBtn) seedBtn.click();
          setTimeout(() => {
            runScenario(0, true, done);
          }, 1500);
          return;
        } else {
          // Run forced low tier benchmarks on Dashboard and Trends
          console.log('[PERF SUITE] Testing forced LOW tier on Dashboard and Trends...');
          window.IonPerf.setQualityTier('low');
          setTimeout(() => {
            if (typeof window.switchTab === 'function') {
              window.switchTab('dashboard');
            }
            window.IonPerf.startBenchmark('view-dashboard', 10, (lowDashRes) => {
              lowDashRes.state = 'connected (forced low tier)';
              lowDashRes.tier = 'low';
              suiteResults.tests.push(lowDashRes);
              console.log(`[PERF SUITE] Completed view-dashboard [connected (forced low tier)]: ${lowDashRes.avgFps} FPS, worst: ${lowDashRes.worstFrameMs}ms, hitches: ${lowDashRes.hitchCount}`);
              setTimeout(() => {
                if (typeof window.switchTab === 'function') {
                  window.switchTab('trends');
                }
                window.IonPerf.startBenchmark('view-trends', 10, (lowTrendsRes) => {
                  lowTrendsRes.state = 'connected (forced low tier)';
                  lowTrendsRes.tier = 'low';
                  suiteResults.tests.push(lowTrendsRes);
                  console.log(`[PERF SUITE] Completed view-trends [connected (forced low tier)]: ${lowTrendsRes.avgFps} FPS, worst: ${lowTrendsRes.worstFrameMs}ms, hitches: ${lowTrendsRes.hitchCount}`);
                  // Restore high tier
                  window.IonPerf.setQualityTier('high');
                  done(suiteResults);
                });
              }, 500);
            });
          }, 500);
          return;
        }
      }

      const viewId = views[viewIndex];
      const tabName = viewId.replace('view-', '');
      console.log(`[PERF SUITE] Testing ${viewId} [${isConnected ? 'CONNECTED' : 'IDLE'}]...`);

      // Switch tab
      if (typeof window.switchTab === 'function') {
        window.switchTab(tabName);
      } else {
        const seg = document.querySelector(`.capsule-segment[data-tab="${tabName}"]`);
        if (seg) seg.click();
      }

      setTimeout(() => {
        window.IonPerf.startBenchmark(viewId, 10, (res) => {
          res.state = isConnected ? 'connected' : 'idle';
          res.tier = 'high';
          suiteResults.tests.push(res);
          console.log(`[PERF SUITE] Completed ${viewId} [${res.state}]: ${res.avgFps} FPS, worst: ${res.worstFrameMs}ms, hitches: ${res.hitchCount}`);
          setTimeout(() => {
            runScenario(viewIndex + 1, isConnected, done);
          }, 500);
        });
      }, 500);
    }

    runScenario(0, false, (finalReport) => {
      window.__perfReport = finalReport;
      if (typeof onComplete === 'function') {
        onComplete(finalReport);
      }
    });
  };

})();

