/**
 * Ion+ App Battery Drain Attribution Subsystem
 * Monitors, fetches, and renders per-package background energy attribution,
 * wakelock activity, CPU background runtime, and thermal stress correlations.
 */

let lastAppDrainSessionKey = null;

async function fetchAppDrain(force = false) {
  const isConnected = typeof AppState !== 'undefined' && AppState.connected;
  const isSeeded = typeof AppState !== 'undefined' && AppState.mode === 'seeded';
  const hasTarget = Boolean(
    (typeof state !== 'undefined' && state.selectedSerial) ||
    (typeof state !== 'undefined' && state.snapshot?.device_serial)
  );
  if (!isConnected && !isSeeded && !hasTarget) {
    renderAppDrain(null, true);
    return;
  }

  const listEl = (typeof el !== 'undefined' && el.appDrainList) || document.getElementById('app-drain-list');
  if (typeof state !== 'undefined' && state.appDrain) {
    if (state.appDrain.loading && !force) return;
    state.appDrain.loading = true;
  }

  try {
    const targetSerial = (typeof state !== 'undefined' && state.selectedSerial) ||
      (isSeeded ? 'mock-phone-2a' : (typeof state !== 'undefined' ? state.snapshot?.device_serial : '')) || '';
    const win = (typeof state !== 'undefined' && state.appDrain?.window) || '24h';
    const sortBy = (typeof state !== 'undefined' && state.appDrain?.sort_by) || 'wakelock_ms';
    const res = await fetch(`/api/app-drain?window=${win}&sort_by=${sortBy}&serial=${encodeURIComponent(targetSerial)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (typeof state !== 'undefined' && state.appDrain) {
      state.appDrain.data = data;
    }
    if (typeof scheduleRenderPass === 'function') {
      scheduleRenderPass('appDrain');
    } else {
      renderAppDrain(data, false);
    }
  } catch (err) {
    console.error('[APP DRAIN] Fetch failed:', err);
    if (listEl && (typeof state === 'undefined' || !state.appDrain?.data?.items)) {
      const errMsg = typeof escapeHtml === 'function' ? escapeHtml(err.message) : err.message;
      listEl.innerHTML = `<div class="py-6 text-center text-zinc-500 text-xs font-mono">Unable to retrieve app battery drain telemetry (${errMsg}).</div>`;
    }
  } finally {
    if (typeof state !== 'undefined' && state.appDrain) {
      state.appDrain.loading = false;
    }
  }
}

function renderAppDrain(data, isStandby = false) {
  const listEl = (typeof el !== 'undefined' && el.appDrainList) || document.getElementById('app-drain-list');
  const thermalBanner = (typeof el !== 'undefined' && el.appDrainThermalBanner) || document.getElementById('app-drain-thermal-banner');
  const thermalText = (typeof el !== 'undefined' && el.appDrainThermalText) || document.getElementById('app-drain-thermal-text');
  if (!listEl) return;

  if (isStandby || !data || !data.items) {
    if (thermalBanner) thermalBanner.classList.add('hidden');
    listEl.innerHTML = `
      <div class="py-8 text-center text-zinc-500 text-xs font-mono">
        Standby Mode — Connect device via USB-C to analyze application battery drain.
      </div>
    `;
    return;
  }

  // Handle thermal correlation banner
  if (data.thermal_correlation && thermalBanner) {
    if (thermalText) {
      const summaryMsg = `Thermal Correlation: ${data.thermal_summary || 'Elevated device temperature during background activity.'}`;
      if (typeof updateTextIfChanged === 'function') {
        updateTextIfChanged(thermalText, summaryMsg);
      } else {
        thermalText.textContent = summaryMsg;
      }
    }
    thermalBanner.classList.remove('hidden');
  } else if (thermalBanner) {
    thermalBanner.classList.add('hidden');
  }

  const sortKey = (typeof state !== 'undefined' && state.appDrain?.sort_by) || 'wakelock_ms';
  const items = [...(data.items || [])];
  if (items.length === 0) {
    listEl.innerHTML = `
      <div class="py-8 text-center text-zinc-500 text-xs font-mono">
        No background drain events recorded in this ${data.window || '24h'} window.
      </div>
    `;
    return;
  }

  const runIdleFn = typeof runIdle === 'function'
    ? runIdle
    : (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function'
      ? window.requestIdleCallback
      : (cb) => setTimeout(() => cb({ timeRemaining: () => 15, didTimeout: false }), 1));

  // Defer heavy sorting and DOM construction to idle budget
  runIdleFn(() => {
    // Strictly sort descending by selected metric
    items.sort((a, b) => {
      const valA = a[sortKey] ?? 0;
      const valB = b[sortKey] ?? 0;
      return valB - valA;
    });

    // Calculate highest metric value to normalize relative progress bar
    let maxVal = 1;
    items.forEach(it => {
      const val = it[sortKey] || 0;
      if (val > maxVal) maxVal = val;
    });

    const escape = typeof escapeHtml === 'function' ? escapeHtml : (s) => String(s ?? '');

    const html = items.map((app, idx) => {
      const rank = idx + 1;
      const displayName = escape(app.display_name || app.package_name || 'App');
      const pkgName = escape(app.package_name || '');
      const wakelockDisplay = escape(app.wakelock_duration_display || '0s');
      const wakelockCount = app.wakelock_count || 0;
      const cpuBgSec = Math.round((app.cpu_bg_ms || 0) / 1000);
      const estMah = app.estimated_mah !== null && app.estimated_mah !== undefined ? `${app.estimated_mah} mAh` : null;

      const currVal = app[sortKey] || 0;
      const pctBar = Math.min(100, Math.max(6, Math.round((currVal / maxVal) * 100)));

      const thermalTagHtml = app.has_thermal_correlation ? `
        <span class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-rose-500/20 text-rose-300 border border-rose-500/30 flex items-center gap-1 shrink-0" data-tooltip="${escape(app.thermal_flag || 'Elevated temperature during wakelock')}">
          <span class="w-1.5 h-1.5 rounded-full bg-rose-400 animate-pulse"></span>
          Thermal Stress
        </span>
      ` : '';

      let primaryMetricHtml = '';
      if (sortKey === 'cpu_bg_ms') {
        primaryMetricHtml = `
          <div class="text-right">
            <div class="text-xs font-black font-mono text-indigo-300">${cpuBgSec}s CPU</div>
            <div class="text-[10px] font-mono text-zinc-500">Wakelock: ${wakelockDisplay}</div>
          </div>
        `;
      } else if (sortKey === 'estimated_mah') {
        primaryMetricHtml = `
          <div class="text-right">
            <div class="text-xs font-black font-mono text-indigo-300">${estMah || '—'}</div>
            <div class="text-[10px] font-mono text-zinc-500">Wakelock: ${wakelockDisplay}</div>
          </div>
        `;
      } else {
        primaryMetricHtml = `
          <div class="text-right">
            <div class="text-xs font-bold font-mono text-white">${wakelockDisplay}</div>
            <div class="text-[10px] font-mono text-zinc-500">${wakelockCount} locks</div>
          </div>
        `;
      }

      const estMahSub = (sortKey !== 'estimated_mah' && estMah) ? `
        <div class="text-right">
          <div class="text-xs font-black font-mono text-indigo-300">${estMah}</div>
          <div class="text-[9px] uppercase font-mono text-zinc-500">Est. Power</div>
        </div>
      ` : '';

      return `
        <div class="p-3.5 rounded-2xl bg-black/40 hover:bg-black/60 border border-white/5 transition flex flex-col gap-2">
          <div class="flex items-center justify-between gap-3">
            <div class="flex items-center gap-3 min-w-0">
              <span class="w-6 h-6 rounded-full bg-indigo-950/60 border border-indigo-500/30 text-indigo-300 font-mono text-[11px] font-black flex items-center justify-center shrink-0">
                ${rank}
              </span>
              <div class="min-w-0 truncate">
                <div class="flex items-center gap-2">
                  <span class="text-sm font-bold text-white truncate">${displayName}</span>
                  ${thermalTagHtml}
                </div>
                <div class="text-[10px] font-mono text-zinc-500 truncate">${pkgName}</div>
              </div>
            </div>

            <div class="flex items-center gap-4 shrink-0">
              ${primaryMetricHtml}
              ${estMahSub}
            </div>
          </div>

          <!-- Relative Drain Progress Bar & Counters (Compositor-Only ScaleX) -->
          <div class="flex items-center gap-3 pt-1">
            <div class="flex-1 bg-black/50 h-1.5 rounded-full overflow-hidden border border-white/5">
              <div class="h-full w-full bg-gradient-to-r from-indigo-500 to-teal-400 rounded-full origin-left transition-transform duration-500" style="transform: scaleX(${pctBar / 100});"></div>
            </div>
            <div class="flex items-center gap-2 text-[10px] font-mono text-zinc-400 shrink-0">
              <span>Bg CPU: <strong class="text-zinc-300">${cpuBgSec}s</strong></span>
              ${app.radio_active_ms > 0 ? `<span>Radio: <strong class="text-zinc-300">${Math.round(app.radio_active_ms / 1000)}s</strong></span>` : ''}
              ${app.gps_active_ms > 0 ? `<span>GPS: <strong class="text-zinc-300">${Math.round(app.gps_active_ms / 1000)}s</strong></span>` : ''}
            </div>
          </div>
        </div>
      `;
    }).join('');

    requestAnimationFrame(() => {
      if (listEl) listEl.innerHTML = html;
    });
  });
}

function updateAppDrainWindowPills(targetWindow) {
  const currentWindow = (targetWindow || (typeof state !== 'undefined' && state.appDrain?.window) || '24h').toLowerCase();
  if (typeof state !== 'undefined' && state.appDrain) {
    state.appDrain.window = currentWindow;
  }
  document.querySelectorAll('.app-drain-window-pill').forEach(b => {
    const isMatch = (b.dataset.window || '').toLowerCase() === currentWindow;
    if (isMatch) {
      b.classList.add('active', 'bg-white', 'text-black', 'font-bold', 'shadow');
      b.classList.remove('text-zinc-400', 'font-medium');
    } else {
      b.classList.remove('active', 'bg-white', 'text-black', 'font-bold', 'shadow');
      b.classList.add('text-zinc-400', 'font-medium');
    }
  });
}

function subscribeTopBatteryDrainers({ connected, mode, device }) {
  const currentKey = `${connected}-${mode}-${device?.serial || ''}`;
  if (currentKey === lastAppDrainSessionKey) {
    return;
  }
  lastAppDrainSessionKey = currentKey;
  updateAppDrainWindowPills((typeof state !== 'undefined' && state.appDrain?.window) || '24h');
  if (connected || mode === 'seeded') {
    fetchAppDrain();
  } else {
    renderAppDrain(null, true);
  }
}

function initAppDrainListeners() {
  document.querySelectorAll('.app-drain-sort-pill').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      document.querySelectorAll('.app-drain-sort-pill').forEach(b => {
        b.classList.remove('active', 'bg-indigo-600', 'text-white');
        b.classList.add('text-zinc-400');
      });
      btn.classList.add('active', 'bg-indigo-600', 'text-white');
      btn.classList.remove('text-zinc-400');
      if (typeof state !== 'undefined' && state.appDrain) {
        state.appDrain.sort_by = btn.dataset.sort;
        if (state.appDrain.data && Array.isArray(state.appDrain.data.items)) {
          renderAppDrain(state.appDrain.data, false);
        }
      }
      fetchAppDrain(true);
    });
  });

  document.querySelectorAll('.app-drain-window-pill').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      updateAppDrainWindowPills(btn.dataset.window);
      fetchAppDrain(true);
    });
  });

  // Ensure default window pill active styling (24H) is explicitly applied on boot
  updateAppDrainWindowPills((typeof state !== 'undefined' && state.appDrain?.window) || '24h');
}

// Global scope export for classic script tags
if (typeof window !== 'undefined') {
  window.fetchAppDrain = fetchAppDrain;
  window.renderAppDrain = renderAppDrain;
  window.updateAppDrainWindowPills = updateAppDrainWindowPills;
  window.subscribeTopBatteryDrainers = subscribeTopBatteryDrainers;
  window.initAppDrainListeners = initAppDrainListeners;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    fetchAppDrain,
    renderAppDrain,
    updateAppDrainWindowPills,
    subscribeTopBatteryDrainers,
    initAppDrainListeners,
  };
}
