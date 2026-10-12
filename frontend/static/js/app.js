/**
 * EURA iOS Health/Wellness Style App Logic (Design Doc v2)
 * Manages live ADB polling, EURA dynamic hero gradient, range dial, and Heart Report chart.
 */

// Phase 3: Pacing & Render Scheduling Foundation
if (typeof Chart !== 'undefined') {
  Chart.defaults.devicePixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  Chart.defaults.font.family = "'Geist', system-ui, -apple-system, sans-serif";
}

const runIdle = typeof window.requestIdleCallback === 'function'
  ? window.requestIdleCallback
  : (cb) => setTimeout(() => cb({ timeRemaining: () => 15, didTimeout: false }), 1);

function updateTextIfChanged(node, val) {
  if (!node) return;
  const str = String(val ?? '');
  if (node.textContent !== str) {
    node.textContent = str;
  }
}

function parseUtcDate(isoStr) {
  if (!isoStr) return null;
  if (isoStr instanceof Date) return isoStr;
  const str = String(isoStr).trim();
  const normalized = (!str.endsWith('Z') && !/[+-]\d{2}:?\d{2}$/.test(str)) ? `${str}Z` : str;
  const d = new Date(normalized);
  return isNaN(d.getTime()) ? new Date(str) : d;
}

let lastScrollTimestamp = 0;
let pendingScrollFlush = false;
let renderPassScheduled = false;
const pendingRenderTasks = new Set();

function isUserScrolling() {
  return (performance.now() - lastScrollTimestamp) < 120;
}

function scheduleRenderPass(taskType) {
  if (taskType) pendingRenderTasks.add(taskType);
  if (renderPassScheduled) return;
  renderPassScheduled = true;

  requestAnimationFrame(() => {
    renderPassScheduled = false;

    // If user is currently scrolling, buffer non-critical updates and defer until scroll finishes
    if (isUserScrolling()) {
      pendingScrollFlush = true;
      return;
    }

    flushPendingRenders();
  });
}

function flushPendingRenders() {
  if (pendingRenderTasks.size === 0) return;
  const tasks = new Set(pendingRenderTasks);
  pendingRenderTasks.clear();

  if (tasks.has('appState') || tasks.has('status') || tasks.has('snapshot')) {
    if (typeof AppState.broadcast === 'function') {
      AppState.broadcast();
    }
  }
  if (tasks.has('history')) {
    renderHistoryAndChart();
  }
  if (tasks.has('insights')) {
    renderInsights();
  }
  if (tasks.has('appDrain')) {
    renderAppDrain(state.appDrain.data, false);
  }
  if (tasks.has('deviceStatus')) {
    renderDeviceStatus();
  }
}

// Application State
const state = {
  currentTab: 'dashboard',
  systemStatus: null,
  snapshot: null,
  history: [],
  insights: null,
  probeReport: null,
  selectedDays: 30,
  chartInstance: null,
  pollTimer: null,
  deviceStatusTimer: null,
  throttledPollTimer: null,
  isRefreshing: false,
  is80CapSimulated: false,
  forecastData: null,
  forecastLoading: false,
  calibrationPollTimer: null,
  cachedDevices: [],
  lastDevicesFetchTime: 0,
  deviceStatusEvents: [],
  statusFeedExpanded: false,
  selectedSerial: null,
  lastHistoryLivePoll: 0,
  appDrain: {
    window: '24h',
    sort_by: 'wakelock_ms',
    data: null,
    loading: false,
  },
};

// Global Application Connection State (Single Source of Truth)
const _storedLivePref = (function() {
  try {
    return localStorage.getItem('ion_live_telemetry_enabled') !== 'false';
  } catch (_) {
    return true;
  }
})();

const AppState = {
  connected: false,
  mode: 'idle', // 'idle' | 'connected' | 'seeded'
  device: null,
  snapshot: null,
  systemStatus: null,
  liveTelemetryEnabled: _storedLivePref,
  liveTelemetryPaused: !_storedLivePref,
  lastTelemetryTimestamp: null,
  _listeners: [],

  subscribe(listener) {
    this._listeners.push(listener);
    try {
      listener({
        connected: this.connected,
        mode: this.mode,
        device: this.device,
        snapshot: this.snapshot,
        systemStatus: this.systemStatus,
        liveTelemetryEnabled: this.liveTelemetryEnabled,
        liveTelemetryPaused: this.liveTelemetryPaused,
      });
    } catch (e) {
      console.error('AppState listener error on mount:', e);
    }
    return () => {
      this._listeners = this._listeners.filter(l => l !== listener);
    };
  },

  notify() {
    scheduleRenderPass('appState');
  },

  broadcast() {
    const payload = {
      connected: this.connected,
      mode: this.mode,
      device: this.device,
      snapshot: this.snapshot,
      systemStatus: this.systemStatus,
      liveTelemetryEnabled: this.liveTelemetryEnabled,
      liveTelemetryPaused: this.liveTelemetryPaused,
    };
    for (const listener of this._listeners) {
      try {
        listener(payload);
      } catch (err) {
        console.error('AppState subscriber error:', err);
      }
    }
  },

  setLiveTelemetry(enabled) {
    const isEn = Boolean(enabled);
    this.liveTelemetryEnabled = isEn;
    this.liveTelemetryPaused = !isEn;
    try {
      localStorage.setItem('ion_live_telemetry_enabled', isEn ? 'true' : 'false');
    } catch (_) {}

    if (isEn) {
      if (this.connected) {
        fetchStatus();
        fetchSnapshot();
        fetchHistory(state.selectedDays);
        fetchAppDrain();
        fetchDeviceStatus();
      }
    }
    updateLiveTelemetryPausedUI();
    if (components.liveToggle) {
      components.liveToggle.setChecked(isEn, { silent: true });
    }
    this.notify();
  },

  updateFromSystemStatus(status) {
    this.systemStatus = status;
    const isConn = status?.active_device_count > 0;
    const activeDev = status?.connected_devices?.find(d => d.state === 'device');
    const isConnected = !!(isConn && activeDev);

    if (isConnected) {
      const serial = activeDev.serial;
      const wasConnected = this.connected;
      const deviceChanged = !wasConnected || this.device?.serial !== serial || this.mode !== 'connected';

      this.connected = true;
      this.mode = 'connected';
      this.device = activeDev;
      state.selectedSerial = serial;

      // Re-enable Live Telemetry toggle and restore stored preference
      if (components.liveToggle) {
        components.liveToggle.setDisabled(false);
        components.liveToggle.setChecked(this.liveTelemetryEnabled, { silent: true });
      }

      if (deviceChanged) {
        this.notify();
        if (!this.liveTelemetryPaused) {
          fetchSnapshot(serial);
          fetchHistory(state.selectedDays, serial);
          fetchInsights(serial);
        }
      }
    } else {
      // If currently displaying seeded demo evaluation, do not let an empty poll kick out to idle
      if (this.mode === 'seeded') {
        return;
      }
      // Demo mode does NOT auto-restore on restart / disconnect!
      // Disconnected / idle
      const hadSession = this.connected || this.mode !== 'idle' || state.selectedSerial !== null;
      this.connected = false;
      this.mode = 'idle';
      this.device = null;
      this.snapshot = null;
      state.selectedSerial = null;
      state.snapshot = null;
      state.normalForecast = null;
      state.is80CapSimulated = false;
      state.deviceStatusEvents = [];

      // Disable live toggle when disconnected and render unchecked without overwriting stored preference
      if (components.liveToggle) {
        components.liveToggle.setChecked(false, { silent: true });
        components.liveToggle.setDisabled(true, 'Connect a device to use live telemetry');
      }

      if (hadSession) {
        this.notify();
      }
    }
  },

  setSnapshot(snapshot) {
    if (snapshot?.timestamp) {
      this.lastTelemetryTimestamp = snapshot.timestamp;
    }
    if (!this.connected && this.mode !== 'seeded') {
      if (snapshot?.connection_state === 'unauthorized' || snapshot?.connection_state === 'offline') {
        this.snapshot = snapshot;
        state.snapshot = snapshot;
        this.notify();
        return;
      }
      this.snapshot = null;
      state.snapshot = null;
      this.notify();
      return;
    }
    this.snapshot = snapshot;
    state.snapshot = snapshot;
    this.notify();
  },

  setSeededMode(mockSerial, mockSnapshot) {
    this._userExplicitlyUnseeded = false;
    this.connected = false;
    this.mode = 'seeded';
    this.device = { serial: mockSerial, model: mockSnapshot?.device_model || 'Nothing Phone 2a' };
    this.snapshot = mockSnapshot;
    state.selectedSerial = mockSerial;
    state.snapshot = mockSnapshot;
    if (components.demoToggle) {
      components.demoToggle.setChecked(true, { silent: true });
    }
    const capsule = el.demoDataCapsule || document.getElementById('demo-data-capsule');
    if (capsule) {
      capsule.classList.add('border-amber-500/40', 'bg-amber-500/10', 'text-amber-300');
    }
    this.notify();
  },

  clearSeededMode() {
    this.connected = false;
    this.mode = 'idle';
    this.device = null;
    this.snapshot = null;
    this._userExplicitlyUnseeded = true;
    state.selectedSerial = null;
    state.snapshot = null;
    state.normalForecast = null;
    state.is80CapSimulated = false;
    state.deviceStatusEvents = [];
    state.history = [];
    state.insights = null;
    if (state.appDrain) state.appDrain.data = null;
    if (components.demoToggle) {
      components.demoToggle.setChecked(false, { silent: true });
    }
    const capsule = el.demoDataCapsule || document.getElementById('demo-data-capsule');
    if (capsule) {
      capsule.classList.remove('border-amber-500/40', 'bg-amber-500/10', 'text-amber-300');
    }
    this.notify();
  }
};

// Registered Sparkle Toggle Instances
const components = {
  liveToggle: null,
  demoToggle: null,
};

// DOM References
const el = {
  // Live Device Status Feed
  deviceStatusPanel: document.getElementById('device-status-panel'),
  deviceStatusToggle: document.getElementById('device-status-toggle'),
  deviceStatusContent: document.getElementById('device-status-content'),
  statusFeedLatestPreview: document.getElementById('status-feed-latest-preview'),
  statusFeedCountBadge: document.getElementById('status-feed-count-badge'),
  statusFeedChevron: document.getElementById('status-feed-chevron'),
  deviceStatusList: document.getElementById('device-status-list'),
  statusFeedPing: document.getElementById('status-feed-ping'),
  liveTelemetryContainer: document.getElementById('live-telemetry-container'),
  liveTelemetrySlot: document.getElementById('live-telemetry-slot'),

  // Toast Notification
  connectToast: document.getElementById('device-connect-toast'),
  toastDeviceName: document.getElementById('toast-device-name'),
  toastProgress: document.getElementById('toast-progress'),
  toastCloseBtn: document.getElementById('toast-close-btn'),

  // Connection Bar
  connDot: document.getElementById('conn-dot'),
  connStatusLabel: document.getElementById('conn-status-label'),
  connDeviceLabel: document.getElementById('conn-device-label'),
  connLastSeenLabel: document.getElementById('conn-last-seen-label'),
  probeBtn: document.getElementById('probe-btn'),
  probeIcon: document.getElementById('probe-icon'),
  seedBtn: document.getElementById('seed-btn'),
  demoDataCapsule: document.getElementById('demo-data-capsule'),
  demoDataSlot: document.getElementById('demo-data-slot'),

  // Hero Card (EURA Bio-Age Style)
  heroEyebrow: document.getElementById('hero-eyebrow'),
  heroHeadline: document.getElementById('hero-headline'),
  heroHeadlineSubtext: document.getElementById('hero-headline-subtext'),
  heroCard: document.getElementById('hero-card'),
  heroStatusPill: document.getElementById('hero-status-pill'),
  heroHealthNumber: document.getElementById('hero-health-number'),
  rangeDialMarker: document.getElementById('range-dial-marker'),
  heroStatusHeading: document.getElementById('hero-status-heading'),
  heroStatusSubtext: document.getElementById('hero-status-subtext'),
  heroMethodBadge: document.getElementById('hero-method-badge'),

  // Secondary 3-Stat Row (Heart Report)
  statTemp: document.getElementById('stat-temp'),
  statTempLabel: document.getElementById('stat-temp-label'),
  statVoltage: document.getElementById('stat-voltage'),
  statCycles: document.getElementById('stat-cycles'),

  // Secondary Cards
  snapStatusBadge: document.getElementById('snap-status-badge'),
  snapLevelText: document.getElementById('snap-level-text'),
  snapChargeSpeedText: document.getElementById('snap-charge-speed-text'),
  snapLastSync: document.getElementById('snap-last-sync'),
  capFullText: document.getElementById('cap-full-text'),
  capFullSubtext: document.getElementById('cap-full-subtext'),
  capDesignText: document.getElementById('cap-design-text'),
  capBadge: document.getElementById('cap-badge'),
  capFooterNote: document.getElementById('cap-footer-note'),

  // Capsule Navigation
  capsuleSegments: document.querySelectorAll('.capsule-segment'),
  views: {
    dashboard: document.getElementById('view-dashboard'),
    trends: document.getElementById('view-trends'),
    habits: document.getElementById('view-habits'),
    diagnostics: document.getElementById('view-diagnostics'),
  },

  // Chart & History
  chartCanvasContainer: document.getElementById('chart-canvas-container'),
  chartEmptyState: document.getElementById('chart-empty-state'),
  chartLastSyncedLabel: document.getElementById('chart-last-synced-label'),
  chartCanvas: document.getElementById('heart-report-chart'),
  historyCountBadge: document.getElementById('history-count-badge'),
  historyTableBody: document.getElementById('history-table-body'),

  // Habit Insights
  metricAbove80: document.getElementById('metric-above-80'),
  metricFastCharge: document.getElementById('metric-fast-charge'),
  metricAvgTemp: document.getElementById('metric-avg-temp'),
  metricDelta: document.getElementById('metric-delta'),
  insightsListContainer: document.getElementById('insights-list-container'),

  // Probe
  probeContentContainer: document.getElementById('probe-content-container'),

  // Forecast & Lifespan
  forecastUrgencyPill: document.getElementById('forecast-urgency-pill'),
  forecastMonthsText: document.getElementById('forecast-months-text'),
  forecastSubtextLabel: document.getElementById('forecast-subtext-label'),
  forecastDateText: document.getElementById('forecast-date-text'),
  forecastCurrentHealth: document.getElementById('forecast-current-health'),
  forecastProgressBar: document.getElementById('forecast-progress-bar'),
  forecastCyclesLeft: document.getElementById('forecast-cycles-left'),
  forecastDailyCadence: document.getElementById('forecast-daily-cadence'),
  simCapToggle: document.getElementById('sim-cap-toggle'),
  simCapKnob: document.getElementById('sim-cap-knob'),
  simCapResult: document.getElementById('sim-cap-result'),
  simCapExtraText: document.getElementById('sim-cap-extra-text'),
  simCompareNormalMonths: document.getElementById('sim-compare-normal-months'),
  simCompareNormalDetail: document.getElementById('sim-compare-normal-detail'),
  simCompareCappedMonths: document.getElementById('sim-compare-capped-months'),
  simCompareCappedDetail: document.getElementById('sim-compare-capped-detail'),

  // Active Coulomb Calibration
  calStatusBadge: document.getElementById('cal-status-badge'),
  calCurrentText: document.getElementById('cal-current-text'),
  calAccumulatedText: document.getElementById('cal-accumulated-text'),
  calVerdictBox: document.getElementById('cal-verdict-box'),
  calExtrapolatedText: document.getElementById('cal-extrapolated-text'),
  calHealthPctText: document.getElementById('cal-health-pct-text'),
  calComparisonSubtext: document.getElementById('cal-comparison-subtext'),
  calStartBtn: document.getElementById('cal-start-btn'),
  calSimBtn: document.getElementById('cal-sim-btn'),
  calStopBtn: document.getElementById('cal-stop-btn'),

  // Pure Math & Core Capacity Metrics
  capRetentionText: document.getElementById('cap-retention-text'),
  capFadeText: document.getElementById('cap-fade-text'),
  capFullProvenance: document.getElementById('cap-full-provenance'),
  capDesignProvenance: document.getElementById('cap-design-provenance'),
  bdFadeText: document.getElementById('bd-fade-text'),
  bdCycleText: document.getElementById('bd-cycle-text'),
  bdCalendarText: document.getElementById('bd-calendar-text'),
  bdStressText: document.getElementById('bd-stress-text'),
  bdFinalText: document.getElementById('bd-final-text'),
  bdSourcesPill: document.getElementById('bd-sources-pill'),
  breakdownProvenanceNote: document.getElementById('breakdown-provenance-note'),

  // App Drain Attribution
  appDrainCard: document.getElementById('app-drain-card'),
  appDrainList: document.getElementById('app-drain-list'),
  appDrainThermalBanner: document.getElementById('app-drain-thermal-banner'),
  appDrainThermalText: document.getElementById('app-drain-thermal-text'),
};

// Utilities extracted to /static/js/formatters.js:
// formatCapacity, formatDate, escapeHtml

// In-Flight Request Tracking (Prevents Overlapping Polling & Backend Socket Contention)
let isFetchingStatus = false;
let isFetchingSnapshot = false;
let isFetchingHistory = false;
let isFetchingInsights = false;
let isFetchingProbe = false;
let isFetchingDeviceStatus = false;

// API Calls
async function fetchStatus() {
  if (isFetchingStatus) return;
  isFetchingStatus = true;
  try {
    const res = await fetch('/api/status');
    if (res.ok) {
      state.systemStatus = await res.json();
      updateConnectionStatus();
    }
  } catch (err) {
    console.warn('Failed to fetch status:', err);
  } finally {
    isFetchingStatus = false;
  }
}

async function fetchSnapshot(serial = null) {
  if (isFetchingSnapshot) return;
  isFetchingSnapshot = true;
  try {
    const isSeeded = AppState.mode === 'seeded';
    // Only query a specific serial if connected or in seeded mode; otherwise fetch clean idle snapshot
    const targetSerial = (AppState.connected || isSeeded) ? (serial || state.selectedSerial) : null;
    const includeDemoParam = isSeeded ? 'include_demo=true' : 'include_demo=false';
    const url = targetSerial
      ? `/api/snapshot?serial=${encodeURIComponent(targetSerial)}&${includeDemoParam}`
      : `/api/snapshot?${includeDemoParam}`;
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      AppState.setSnapshot(data);
    }
  } catch (err) {
    console.warn('Failed to fetch snapshot:', err);
  } finally {
    isFetchingSnapshot = false;
  }
}

async function fetchHistory(days = 30, serial = null) {
  if (isFetchingHistory) return;
  isFetchingHistory = true;
  try {
    const isSeeded = AppState.mode === 'seeded';
    const targetSerial = serial || state.selectedSerial;
    const serialParam = targetSerial ? `&serial=${encodeURIComponent(targetSerial)}` : '';
    const includeDemoParam = isSeeded ? '&include_demo=true' : '&include_demo=false';
    const res = await fetch(`/api/history?days=${days}&limit=500${serialParam}${includeDemoParam}`);
    if (res.ok) {
      const data = await res.json();
      state.history = data.readings || [];
      scheduleRenderPass('history');
    }
  } catch (err) {
    console.warn('Failed to fetch history:', err);
  } finally {
    isFetchingHistory = false;
  }
}

async function fetchInsights(serial = null) {
  if (isFetchingInsights) return;
  isFetchingInsights = true;
  try {
    const isSeeded = AppState.mode === 'seeded';
    const targetSerial = serial || state.selectedSerial;
    const serialParam = targetSerial ? `serial=${encodeURIComponent(targetSerial)}&` : '';
    const includeDemoParam = isSeeded ? 'include_demo=true' : 'include_demo=false';
    const res = await fetch(`/api/insights?${serialParam}${includeDemoParam}`);
    if (res.ok) {
      state.insights = await res.json();
      scheduleRenderPass('insights');
    }
  } catch (err) {
    console.warn('Failed to fetch insights:', err);
  } finally {
    isFetchingInsights = false;
  }
}

async function fetchProbe() {
  if (isFetchingProbe) return;
  isFetchingProbe = true;
  try {
    const res = await fetch('/api/probe');
    if (res.ok) {
      state.probeReport = await res.json();
    } else {
      const err = await res.json().catch(() => ({}));
      state.probeReport = { error: err.detail || 'Hardware probe not accessible' };
    }
    renderProbe();
  } catch (err) {
    state.probeReport = { error: 'Request to probe failed' };
    renderProbe();
  } finally {
    isFetchingProbe = false;
  }
}

async function fetchDeviceStatus() {
  if (isFetchingDeviceStatus) return;
  isFetchingDeviceStatus = true;
  try {
    const res = await fetch('/api/device-status?limit=25');
    if (res.ok) {
      const data = await res.json();
      if (AppState.connected) {
        state.deviceStatusEvents = data.events || [];
      } else {
        state.deviceStatusEvents = [];
      }
      scheduleRenderPass('deviceStatus');
    }
  } catch (err) {
    console.warn('Failed to fetch device status feed:', err);
  } finally {
    isFetchingDeviceStatus = false;
  }
}

// Device Connected Toast State & Management (Design Doc v2 §5.2)
const toastState = {
  wasConnected: false,
  lastSerial: null,
  holdTimer: null,
  exitTimer: null,
  lastDismissedAt: 0,
};

function formatConnectedDeviceSubtitle(activeDev) {
  const model = activeDev?.model ? activeDev.model.replace(/_/g, ' ') : (state.snapshot?.device_model || '');
  const serial = activeDev?.serial || state.snapshot?.device_serial || '';

  if (model && serial) {
    if (model.toLowerCase().includes(serial.toLowerCase())) {
      return model;
    }
    const displaySerial = serial.length > 10 ? `${serial.slice(0, 8)}...` : serial;
    return `${model} · ${displaySerial}`;
  }
  if (model) return model;
  if (serial) return `Android Device · ${serial.length > 10 ? serial.slice(0, 8) + '...' : serial}`;
  return 'Android Device';
}

function showDeviceConnectedToast(deviceName) {
  const toastEl = el.connectToast || document.getElementById('device-connect-toast');
  const nameEl = el.toastDeviceName || document.getElementById('toast-device-name');
  const progressEl = el.toastProgress || document.getElementById('toast-progress');
  if (!toastEl || !nameEl) return;

  nameEl.textContent = deviceName;

  // Clear any existing dismissal timers
  if (toastState.holdTimer) {
    clearTimeout(toastState.holdTimer);
    toastState.holdTimer = null;
  }
  if (toastState.exitTimer) {
    clearTimeout(toastState.exitTimer);
    toastState.exitTimer = null;
  }

  // Remove exiting state if currently transitioning out
  toastEl.classList.remove('toast-exiting');

  // Reset progress bar drain animation asynchronously
  if (progressEl) {
    progressEl.style.animation = 'none';
    requestAnimationFrame(() => {
      progressEl.style.animation = '';
    });
  }

  // Ensure visible with entrance animation
  if (!toastEl.classList.contains('toast-visible')) {
    requestAnimationFrame(() => {
      toastEl.classList.add('toast-visible');
    });
  }

  // 3-second hold timer
  toastState.holdTimer = setTimeout(() => {
    dismissDeviceConnectedToast();
  }, 3000);
}

function dismissDeviceConnectedToast(immediate = false) {
  const toastEl = el.connectToast || document.getElementById('device-connect-toast');
  if (!toastEl || (!toastEl.classList.contains('toast-visible') && !toastEl.classList.contains('toast-exiting'))) return;

  if (toastState.holdTimer) {
    clearTimeout(toastState.holdTimer);
    toastState.holdTimer = null;
  }
  if (toastState.exitTimer) {
    clearTimeout(toastState.exitTimer);
    toastState.exitTimer = null;
  }

  toastState.lastDismissedAt = Date.now();

  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (immediate || prefersReduced) {
    toastEl.classList.remove('toast-visible', 'toast-exiting');
  } else {
    toastEl.classList.remove('toast-visible');
    toastEl.classList.add('toast-exiting');

    toastState.exitTimer = setTimeout(() => {
      toastEl.classList.remove('toast-exiting');
      toastState.exitTimer = null;
    }, 220);
  }
}

function updateHeroHeadline(isConnected) {
  const headlineEl = el.heroHeadline || document.getElementById('hero-headline');
  const subtextEl = el.heroHeadlineSubtext || document.getElementById('hero-headline-subtext');
  if (!headlineEl) return;

  const unauthDev = state.systemStatus?.connected_devices?.find(d => d.state === 'unauthorized');
  const offlineDev = state.systemStatus?.connected_devices?.find(d => d.state === 'offline');
  const isUnauth = unauthDev || state.snapshot?.connection_state === 'unauthorized' || state.snapshot?.health_status === 'unauthorized';
  const isOffline = offlineDev || state.snapshot?.connection_state === 'offline' || state.snapshot?.health_status === 'offline';

  if (isConnected) {
    headlineEl.textContent = 'Genuine Battery Degradation.';
    if (subtextEl) {
      subtextEl.textContent = 'Real capacity loss computed directly from OEM hardware full-charge counters vs factory design specifications.';
    }
  } else if (isUnauth) {
    headlineEl.textContent = 'Authorization Required.';
    if (subtextEl) {
      subtextEl.textContent = 'Unlock your phone screen and tap "Allow USB debugging" (check "Always allow from this computer") to fetch results.';
    }
  } else if (isOffline) {
    headlineEl.textContent = 'Device Offline.';
    if (subtextEl) {
      subtextEl.textContent = 'Your phone was detected in an offline state. Reconnect the USB cable or toggle USB debugging in Developer Options.';
    }
  } else {
    headlineEl.textContent = 'Plug In to Begin.';
    if (subtextEl) {
      subtextEl.textContent = 'Connect your phone over USB-C to see genuine capacity loss, computed from real hardware counters.';
    }
  }
}

// Renderers
function updateConnectionStatus() {
  const activeDev = state.systemStatus?.connected_devices?.find(d => d.state === 'device');
  const isConnected = !!(state.systemStatus?.active_device_count > 0 && activeDev);
  const currentSerial = activeDev ? (activeDev.serial || 'connected-device') : null;

  // Connection Toast Trigger Check (Design Doc v2 §5.2)
  if (isConnected) {
    const isNewConnection = !toastState.wasConnected || (toastState.lastSerial !== currentSerial);
    if (isNewConnection) {
      const formattedName = formatConnectedDeviceSubtitle(activeDev);
      showDeviceConnectedToast(formattedName);
      toastState.wasConnected = true;
      toastState.lastSerial = currentSerial;
    }
  } else {
    toastState.wasConnected = false;
  }

  // Synchronously update AppState (Single Source of Truth) which broadcasts to all subscribers
  AppState.updateFromSystemStatus(state.systemStatus);
}

function subscribeTopBar({ connected, mode, systemStatus }) {
  const activeDev = systemStatus?.connected_devices?.find(d => d.state === 'device');
  const unauthDev = systemStatus?.connected_devices?.find(d => d.state === 'unauthorized');
  const offlineDev = systemStatus?.connected_devices?.find(d => d.state === 'offline');
  const isProfiling = systemStatus?.watcher_status?.is_profiling;
  const profilingMsg = systemStatus?.watcher_status?.profiling_message || 'Profiling new device...';

  if (isProfiling) {
    if (el.connDot && el.connDot.className !== 'w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse') {
      el.connDot.className = 'w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse';
    }
    updateTextIfChanged(el.connStatusLabel, profilingMsg);
    const name = activeDev?.model ? activeDev.model.replace(/_/g, ' ') : (state.snapshot?.device_model || 'Android Device');
    if (el.connDeviceLabel) {
      updateTextIfChanged(el.connDeviceLabel, `· ${name}`);
      el.connDeviceLabel.classList.remove('hidden');
    }
    return;
  }

  if (connected && activeDev) {
    if (el.connDot && el.connDot.className !== 'dot-live-green') el.connDot.className = 'dot-live-green';
    const name = activeDev.model ? activeDev.model.replace(/_/g, ' ') : (state.snapshot?.device_model || 'Android Device');
    updateTextIfChanged(el.connStatusLabel, 'Connected');
    if (el.connDeviceLabel) {
      updateTextIfChanged(el.connDeviceLabel, `· ${name}`);
      el.connDeviceLabel.classList.remove('hidden');
    }
    if (el.connLastSeenLabel) {
      el.connLastSeenLabel.classList.add('hidden');
      updateTextIfChanged(el.connLastSeenLabel, '');
    }
  } else if (mode === 'seeded') {
    if (el.connDot && el.connDot.className !== 'w-2.5 h-2.5 rounded-full bg-emerald-400') el.connDot.className = 'w-2.5 h-2.5 rounded-full bg-emerald-400';
    updateTextIfChanged(el.connStatusLabel, 'Demo Mode');
    if (el.connDeviceLabel) {
      updateTextIfChanged(el.connDeviceLabel, '· Nothing Phone 2a');
      el.connDeviceLabel.classList.remove('hidden');
    }
    if (el.connLastSeenLabel) {
      el.connLastSeenLabel.classList.add('hidden');
      updateTextIfChanged(el.connLastSeenLabel, '');
    }
  } else if (unauthDev || state.snapshot?.health_status === 'unauthorized' || state.snapshot?.connection_state === 'unauthorized') {
    if (el.connDot && el.connDot.className !== 'w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse') el.connDot.className = 'w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse';
    updateTextIfChanged(el.connStatusLabel, 'Unauthorized');
    const sName = unauthDev?.serial ? `(${unauthDev.serial.slice(0, 8)}...)` : '';
    if (el.connDeviceLabel) {
      updateTextIfChanged(el.connDeviceLabel, `· Phone detected ${sName}`);
      el.connDeviceLabel.classList.remove('hidden');
    }
  } else if (offlineDev || state.snapshot?.health_status === 'offline' || state.snapshot?.connection_state === 'offline') {
    if (el.connDot && el.connDot.className !== 'w-2.5 h-2.5 rounded-full bg-amber-400') el.connDot.className = 'w-2.5 h-2.5 rounded-full bg-amber-400';
    updateTextIfChanged(el.connStatusLabel, 'Offline');
    const sName = offlineDev?.serial ? `(${offlineDev.serial.slice(0, 8)}...)` : '';
    if (el.connDeviceLabel) {
      updateTextIfChanged(el.connDeviceLabel, `· Phone offline ${sName}`);
      el.connDeviceLabel.classList.remove('hidden');
    }
  } else {
    if (el.connDot && el.connDot.className !== 'dot-idle-gray') el.connDot.className = 'dot-idle-gray';
    updateTextIfChanged(el.connStatusLabel, 'Disconnected');
    if (el.connDeviceLabel) el.connDeviceLabel.classList.add('hidden');
    updateLastSeenDeviceLabel();
  }

  // Synchronize Demo Toggle and button state
  updateSeedBtnState(mode === 'seeded');
}

function updateSeedBtnState(isSeeded) {
  if (components.demoToggle) {
    components.demoToggle.setChecked(isSeeded, { silent: true });
  }
  const capsule = el.demoDataCapsule || document.getElementById('demo-data-capsule');
  if (capsule) {
    if (isSeeded) {
      capsule.classList.add('border-amber-500/40', 'bg-amber-500/10', 'text-amber-300');
    } else {
      capsule.classList.remove('border-amber-500/40', 'bg-amber-500/10', 'text-amber-300');
    }
  }
  if (!el.seedBtn) return;
  const label = isSeeded ? 'Unseed' : 'Seed 30D';
  const tooltip = isSeeded
    ? 'Clears the 30-day simulated demo dataset and resets to clean state.'
    : 'Populates a 30-day simulated dataset to preview degradation curves and insights.';
  const span = el.seedBtn.querySelector('span');
  if (span) {
    updateTextIfChanged(span, label);
  } else {
    updateTextIfChanged(el.seedBtn, label);
  }
  el.seedBtn.setAttribute('data-tooltip', tooltip);
  if (isSeeded) {
    el.seedBtn.classList.add('text-amber-300');
    el.seedBtn.classList.remove('text-zinc-300');
  } else {
    el.seedBtn.classList.remove('text-amber-300');
    el.seedBtn.classList.add('text-zinc-300');
  }
}

function subscribeGuidanceBanner({ systemStatus }) {
  const unauthDev = systemStatus?.connected_devices?.find(d => d.state === 'unauthorized');
  const offlineDev = systemStatus?.connected_devices?.find(d => d.state === 'offline');
  const guidanceBanner = document.getElementById('connection-guidance-banner');
  const guidanceText = document.getElementById('connection-guidance-text');
  if (!guidanceBanner) return;

  if (unauthDev || state.snapshot?.health_status === 'unauthorized' || state.snapshot?.connection_state === 'unauthorized') {
    if (guidanceText) {
      guidanceText.innerHTML = `<strong>Action Required on Phone:</strong> Unlock your phone screen and tap <strong>&quot;Allow USB debugging&quot;</strong> (check <em>&quot;Always allow from this computer&quot;</em>).`;
    }
    guidanceBanner.classList.remove('hidden');
  } else if (offlineDev || state.snapshot?.health_status === 'offline' || state.snapshot?.connection_state === 'offline') {
    if (guidanceText) {
      guidanceText.innerHTML = `<strong>Device Offline:</strong> Please unplug and reconnect your USB cable, or toggle USB debugging in Developer Options.`;
    }
    guidanceBanner.classList.remove('hidden');
  } else {
    guidanceBanner.classList.add('hidden');
  }
}

function subscribeHeroHeadline({ connected }) {
  updateHeroHeadline(connected);
}

function masterDashboardSubscriber({ connected, mode, snapshot }) {
  if (connected || mode === 'seeded') {
    renderSnapshot();
  } else {
    renderIdleState();
  }
}

function toggleDeviceStatusFeed(forceState = null) {
  const content = el.deviceStatusContent || document.getElementById('device-status-content');
  const chevron = el.statusFeedChevron || document.getElementById('status-feed-chevron');
  const toggleBtn = el.deviceStatusToggle || document.getElementById('device-status-toggle');
  if (!content) return;

  const willExpand = forceState !== null ? forceState : content.classList.contains('hidden');
  if (willExpand) {
    content.classList.remove('hidden');
    if (chevron) chevron.classList.add('rotate-180');
    if (toggleBtn) toggleBtn.setAttribute('aria-expanded', 'true');
    state.statusFeedExpanded = true;
    try { sessionStorage.setItem('ion_status_feed_expanded', 'true'); } catch (_) {}
  } else {
    content.classList.add('hidden');
    if (chevron) chevron.classList.remove('rotate-180');
    if (toggleBtn) toggleBtn.setAttribute('aria-expanded', 'false');
    state.statusFeedExpanded = false;
    try { sessionStorage.setItem('ion_status_feed_expanded', 'false'); } catch (_) {}
  }
}

function renderDeviceStatus() {
  const panel = el.deviceStatusPanel || document.getElementById('device-status-panel');
  if (!panel) return;

  const isConnected = AppState.connected;
  const isSeeded = AppState.mode === 'seeded';
  const isPaused = AppState.liveTelemetryPaused;
  const events = isConnected ? (state.deviceStatusEvents || []) : [];

  panel.classList.remove('hidden');

  const previewEl = el.statusFeedLatestPreview || document.getElementById('status-feed-latest-preview');
  const badgeEl = el.statusFeedCountBadge || document.getElementById('status-feed-count-badge');
  const listEl = el.deviceStatusList || document.getElementById('device-status-list');
  const pingEl = el.statusFeedPing || document.getElementById('status-feed-ping');

  if (isConnected && isPaused) {
    const timeStr = getFormattedLastReadingTime();
    if (previewEl) {
      previewEl.textContent = `Telemetry paused · Last reading: ${timeStr}`;
      previewEl.removeAttribute('title');
      previewEl.setAttribute('data-tooltip', `Live polling paused. Last reading received at ${timeStr}`);
    }
    if (badgeEl) {
      badgeEl.textContent = 'Paused';
      badgeEl.className = 'glass-chip glass-chip-amber text-amber-300';
    }
    if (pingEl) pingEl.classList.add('hidden');
    if (listEl && events.length > 0) {
      listEl.innerHTML = events.map((ev, index) => {
        const isLatest = index === 0;
        let badgeClass = 'status-badge-default';
        const cat = (ev.category || '').toLowerCase();
        if (cat === 'connection') badgeClass = 'status-badge-connection';
        else if (cat === 'probe') badgeClass = 'status-badge-probe';
        else if (cat === 'consensus') badgeClass = 'status-badge-consensus';
        else if (cat === 'health') badgeClass = 'status-badge-health';
        else if (cat === 'calibration') badgeClass = 'status-badge-calibration';

        const time = escapeHtml(ev.time_display || '—');
        const categoryText = escapeHtml((ev.category || 'INFO').toUpperCase());
        const msg = escapeHtml(ev.message || '');
        const itemClass = isLatest ? 'status-item status-item-latest py-1 flex items-start gap-2.5' : 'status-item py-1 flex items-start gap-2.5 opacity-85 hover:opacity-100';
        const textClass = isLatest ? 'text-zinc-100 font-medium' : 'text-zinc-400';

        return `
          <div class="${itemClass}">
            <span class="text-zinc-500 shrink-0 font-mono text-[11px] pt-0.5">${time}</span>
            <span class="status-badge ${badgeClass}">${categoryText}</span>
            <span class="${textClass} flex-1 break-words leading-relaxed">${msg}</span>
          </div>
        `;
      }).join('');
    }
  } else if (isConnected && events.length > 0) {
    const latest = events[0];
    if (previewEl) {
      previewEl.textContent = latest.message;
      previewEl.removeAttribute('title');
      previewEl.setAttribute('data-tooltip', `${latest.time_display} · ${latest.message}`);
    }
    if (badgeEl) {
      badgeEl.textContent = `${events.length} event${events.length === 1 ? '' : 's'}`;
      badgeEl.className = 'glass-chip glass-chip-cyan';
    }
    if (pingEl) pingEl.classList.remove('hidden');
    if (listEl) {
      listEl.innerHTML = events.map((ev, index) => {
        const isLatest = index === 0;
        let badgeClass = 'status-badge-default';
        const cat = (ev.category || '').toLowerCase();
        if (cat === 'connection') badgeClass = 'status-badge-connection';
        else if (cat === 'probe') badgeClass = 'status-badge-probe';
        else if (cat === 'consensus') badgeClass = 'status-badge-consensus';
        else if (cat === 'health') badgeClass = 'status-badge-health';
        else if (cat === 'calibration') badgeClass = 'status-badge-calibration';

        const time = escapeHtml(ev.time_display || '—');
        const categoryText = escapeHtml((ev.category || 'INFO').toUpperCase());
        const msg = escapeHtml(ev.message || '');
        const itemClass = isLatest ? 'status-item status-item-latest py-1 flex items-start gap-2.5' : 'status-item py-1 flex items-start gap-2.5 opacity-85 hover:opacity-100';
        const textClass = isLatest ? 'text-zinc-100 font-medium' : 'text-zinc-400';

        return `
          <div class="${itemClass}">
            <span class="text-zinc-500 shrink-0 font-mono text-[11px] pt-0.5">${time}</span>
            <span class="status-badge ${badgeClass}">${categoryText}</span>
            <span class="${textClass} flex-1 break-words leading-relaxed">${msg}</span>
          </div>
        `;
      }).join('');
    }
  } else if (isSeeded) {
    if (previewEl) {
      previewEl.textContent = 'Demo data active (mock-phone-2a)';
      previewEl.removeAttribute('data-tooltip');
    }
    if (badgeEl) {
      badgeEl.textContent = 'Demo Data';
      badgeEl.className = 'glass-chip glass-chip-amber text-amber-300';
    }
    if (pingEl) pingEl.classList.add('hidden');
    if (listEl) {
      listEl.innerHTML = '<div class="text-zinc-500 py-2 italic text-center">Demo data session active. Connect phone for live telemetry.</div>';
    }
  } else {
    // Neutral Idle / Standby mode
    if (previewEl) {
      previewEl.textContent = 'No active session — connect device to view live telemetry';
      previewEl.removeAttribute('data-tooltip');
    }
    if (badgeEl) {
      badgeEl.textContent = 'Standby';
      badgeEl.className = 'glass-chip glass-chip-cyan';
    }
    if (pingEl) pingEl.classList.add('hidden');
    if (listEl) {
      listEl.innerHTML = '<div class="text-zinc-500 py-2 italic text-center">No active device session. Plug in to start logging events.</div>';
    }
  }
}

// Hardware-accelerated range dial positioner (compositor-only transform)
let cachedTrackWidth = 0;
window.addEventListener('resize', () => {
  cachedTrackWidth = 0;
}, { passive: true });

function setRangeDialPosition(pct) {
  if (!el.rangeDialMarker) return;
  const dialMeter = document.getElementById('hero-health-dial');

  if (pct === null || pct === undefined || isNaN(pct)) {
    el.rangeDialMarker.classList.add('hidden');
    el.rangeDialMarker.style.display = 'none';
    if (dialMeter) {
      dialMeter.removeAttribute('aria-valuenow');
      dialMeter.setAttribute('aria-valuetext', 'Health unavailable');
    }
    return;
  }

  // Real numeric health: clamp [0, 100], and clamp dial position [2, 98] for clean pin margin
  const clampedVal = Math.min(100, Math.max(0, Number(pct)));
  const clampedPos = Math.min(98, Math.max(2, clampedVal));

  el.rangeDialMarker.classList.remove('hidden');
  el.rangeDialMarker.style.display = '';

  if (!cachedTrackWidth) {
    const track = el.rangeDialTrack || document.querySelector('.range-dial-track');
    cachedTrackWidth = track ? track.clientWidth : 200;
  }
  const x = (clampedPos / 100) * (cachedTrackWidth || 200);
  el.rangeDialMarker.style.setProperty('--dial-x', `${x}px`);

  if (dialMeter) {
    dialMeter.setAttribute('aria-valuenow', `${Math.round(clampedVal)}`);
    dialMeter.setAttribute('aria-valuetext', `${Math.round(clampedVal)}%`);
  }
}

function renderIdleState() {
  const unauthDev = state.systemStatus?.connected_devices?.find(d => d.state === 'unauthorized');
  const offlineDev = state.systemStatus?.connected_devices?.find(d => d.state === 'offline');
  const isUnauth = unauthDev || state.snapshot?.connection_state === 'unauthorized' || state.snapshot?.health_status === 'unauthorized';
  const isOffline = offlineDev || state.snapshot?.connection_state === 'offline' || state.snapshot?.health_status === 'offline';

  // 1. Eyebrow
  if (el.heroEyebrow) {
    if (isUnauth) {
      el.heroEyebrow.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse"></span>Action Required on Phone';
      el.heroEyebrow.className = 'eyebrow-label text-amber-300 flex items-center gap-2';
    } else if (isOffline) {
      el.heroEyebrow.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-amber-400"></span>Connection Offline';
      el.heroEyebrow.className = 'eyebrow-label text-amber-300 flex items-center gap-2';
    } else {
      el.heroEyebrow.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-zinc-500"></span>Standby Mode';
      el.heroEyebrow.className = 'eyebrow-label text-zinc-400 flex items-center gap-2';
    }
  }

  // 1b. Fix 1: State-aware Hero Headline & Subtext
  updateHeroHeadline(false);

  // 2. Hero Card (EURA Bio-Age Style)
  if (el.heroCard) {
    el.heroCard.classList.remove('hero-gradient-healthy', 'hero-gradient-fair', 'hero-gradient-poor');
    el.heroCard.classList.add('hero-gradient-unknown');
  }

  // Fix 2: Hero Number Skeleton Shimmer
  if (el.heroHealthNumber) {
    el.heroHealthNumber.textContent = '--';
    el.heroHealthNumber.classList.add('skeleton-shimmer');
  }

  if (isUnauth) {
    if (el.heroStatusPill) el.heroStatusPill.textContent = 'Unauthorized';
    if (el.heroStatusHeading) el.heroStatusHeading.textContent = 'Tap "Allow USB Debugging"';
    if (el.heroStatusSubtext) {
      const sName = (unauthDev?.serial || state.snapshot?.device_serial || '').slice(0, 10);
      el.heroStatusSubtext.textContent = `Phone detected${sName ? ' (' + sName + ')' : ''}. Please unlock your screen and approve the USB debugging prompt.`;
    }
  } else if (isOffline) {
    if (el.heroStatusPill) el.heroStatusPill.textContent = 'Device Offline';
    if (el.heroStatusHeading) el.heroStatusHeading.textContent = 'Reconnect USB Cable';
    if (el.heroStatusSubtext) el.heroStatusSubtext.textContent = 'Device is in offline state. Reconnect cable or toggle USB debugging in Developer Options.';
  } else {
    if (el.heroStatusPill) el.heroStatusPill.textContent = 'Awaiting Device';
    if (el.heroStatusHeading) el.heroStatusHeading.textContent = 'No Device Connected';
    if (el.heroStatusSubtext) el.heroStatusSubtext.textContent = 'Connect phone over USB-C to compute real chemical health.';
  }
  // Exactly ONE standby pill in the hero card: hide secondary method badge in standby/idle
  if (el.heroMethodBadge) {
    el.heroMethodBadge.classList.add('hidden');
  }
  // When health is unknown/standby, hide the dial knob completely
  setRangeDialPosition(null);

  const oemBadge = document.getElementById('hero-oem-soh-badge');
  if (oemBadge) oemBadge.classList.add('hidden');
  const divBanner = document.getElementById('soh-divergence-banner');
  if (divBanner) divBanner.classList.add('hidden');

  // Fix 3: Stale Chart Filter & Last Synced Timestamp
  if (el.chartCanvasContainer) {
    el.chartCanvasContainer.classList.add('chart-stale-dimmed');
  }
  updateChartLastSyncedLabel();

  // Fix 5: Last Seen Device Context
  updateLastSeenDeviceLabel();

  // 3. Three-Stat Row (Heart Report)
  if (el.statTemp) el.statTemp.textContent = '—';
  if (el.statTempLabel) el.statTempLabel.textContent = 'Awaiting connection';
  if (el.statVoltage) el.statVoltage.textContent = '—';
  if (el.statCycles) el.statCycles.textContent = 'Unavailable';
  const sublabel = document.getElementById('stat-cycles-sublabel');
  if (sublabel) sublabel.textContent = 'No cycle data';

  // 4. Current Charge Card
  if (el.snapLevelText) el.snapLevelText.textContent = '—';
  if (el.snapStatusBadge) {
    el.snapStatusBadge.textContent = 'Disconnected';
    el.snapStatusBadge.className = 'px-3 py-0.5 rounded-full text-xs font-semibold bg-zinc-800 text-zinc-400 border border-white/10';
  }
  if (el.snapChargeSpeedText) el.snapChargeSpeedText.textContent = 'Connect phone over USB-C';
  if (el.snapLastSync) el.snapLastSync.textContent = 'Standby';

  // 5. Chemical Capacity Card
  if (el.capFullText) el.capFullText.textContent = '—';
  if (el.capFullSubtext) el.capFullSubtext.classList.add('hidden');
  if (el.capDesignText) el.capDesignText.textContent = '—';
  if (el.capRetentionText) el.capRetentionText.textContent = '—';
  if (el.capFadeText) el.capFadeText.textContent = '—';
  if (el.capBadge) el.capBadge.textContent = 'Hardware Standby';
  if (el.capFullProvenance) {
    el.capFullProvenance.textContent = 'Standby';
    el.capFullProvenance.className = 'text-[10px] px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400 font-mono';
  }
  if (el.capDesignProvenance) {
    el.capDesignProvenance.textContent = 'Standby';
    el.capDesignProvenance.className = 'text-[10px] px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400 font-mono';
  }
  if (el.capFooterNote) el.capFooterNote.textContent = 'Connect phone to read hardware registers.';
  if (el.bdSourcesPill) el.bdSourcesPill.innerHTML = '';

  // 6. Forecast Card (Gated to 80% toggle)
  renderForecastIdle();
  if (el.simCapToggle) {
    el.simCapToggle.disabled = true;
    el.simCapToggle.checked = false;
    el.simCapToggle.classList.add('opacity-40', 'cursor-not-allowed');
    el.simCapToggle.setAttribute('data-tooltip', 'Connect phone to run longevity forecast');
  }

  // 7. Coulomb Calibration Card (Reset on idle)
  resetCalibrationUI();

  // 8. Mathematical Degradation Breakdown Card (Reset on idle)
  if (el.bdFadeText) el.bdFadeText.textContent = '—';
  if (el.bdCycleText) el.bdCycleText.textContent = '—';
  if (el.bdCalendarText) el.bdCalendarText.textContent = '—';
  if (el.bdStressText) el.bdStressText.textContent = '—';
  if (el.bdFinalText) el.bdFinalText.textContent = '--';
  if (el.breakdownProvenanceNote) {
    el.breakdownProvenanceNote.textContent = 'Standby · Connect phone to calculate multi-factor degradation model.';
  }

  // 9. Live Device Feed Bar (Neutral Standby)
  renderDeviceStatus();
}

let lastRenderedSnapshotState = {
  healthGrade: '',
  dialPos: -1,
  connectionMode: '',
  sourcesKey: '',
};

function renderSnapshot() {
  if (!AppState.connected && AppState.mode !== 'seeded') {
    renderIdleState();
    return;
  }

  const s = AppState.snapshot || state.snapshot;
  if (!s) {
    renderIdleState();
    return;
  }

  // Active connected phone vs seeded/cached evaluation
  const modeKey = AppState.connected ? (AppState.liveTelemetryPaused ? 'connected_paused' : 'connected_live') : 'idle_seeded';
  if (el.heroEyebrow && lastRenderedSnapshotState.connectionMode !== modeKey) {
    lastRenderedSnapshotState.connectionMode = modeKey;
    if (AppState.connected) {
      if (AppState.liveTelemetryPaused) {
        const timeStr = getFormattedLastReadingTime();
        el.heroEyebrow.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-amber-400"></span>Paused · Last reading: ${timeStr}`;
        el.heroEyebrow.className = 'eyebrow-label text-amber-300 flex items-center gap-2';
      } else {
        el.heroEyebrow.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse"></span>Live Biometric Evaluation';
        el.heroEyebrow.className = 'eyebrow-label text-indigo-400 flex items-center gap-2';
      }
    } else {
      el.heroEyebrow.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-amber-400"></span>Demo Data Preview (mock-phone-2a)';
      el.heroEyebrow.className = 'eyebrow-label text-amber-300 flex items-center gap-2';
    }
  }

  // Active connected state restorations (Fix 1, Fix 2, Fix 3, Fix 5)
  if (AppState.connected) {
    updateHeroHeadline(true);
    el.heroHealthNumber.classList.remove('skeleton-shimmer');
    if (el.chartCanvasContainer) {
      el.chartCanvasContainer.classList.remove('chart-stale-dimmed');
    }
    if (el.chartLastSyncedLabel) {
      if (AppState.liveTelemetryPaused) {
        const timeStr = getFormattedLastReadingTime();
        el.chartLastSyncedLabel.classList.remove('hidden');
        updateTextIfChanged(el.chartLastSyncedLabel, `Paused · Last reading: ${timeStr}`);
      } else {
        el.chartLastSyncedLabel.classList.add('hidden');
        updateTextIfChanged(el.chartLastSyncedLabel, '');
      }
    }
    if (el.connLastSeenLabel) {
      el.connLastSeenLabel.classList.add('hidden');
      updateTextIfChanged(el.connLastSeenLabel, '');
    }
  } else {
    // Seeded / historical evaluation (not connected)
    updateHeroHeadline(false);
    if (el.chartCanvasContainer) {
      el.chartCanvasContainer.classList.remove('chart-stale-dimmed');
    }
    if (el.chartLastSyncedLabel) {
      el.chartLastSyncedLabel.classList.remove('hidden');
      updateTextIfChanged(el.chartLastSyncedLabel, 'Demo Data Preview');
    }
    if (el.heroStatusPill) {
      el.heroStatusPill.className = 'glass-pill px-3.5 py-1 text-xs font-semibold text-amber-300 border border-amber-500/30 bg-amber-500/10';
      updateTextIfChanged(el.heroStatusPill, 'Demo Data');
    }
    updateLastSeenDeviceLabel();
    el.heroHealthNumber.classList.remove('skeleton-shimmer');
  }

  // Enable 80% simulator toggle when device is active or evaluated
  if (el.simCapToggle) {
    el.simCapToggle.disabled = false;
    el.simCapToggle.classList.remove('opacity-40', 'cursor-not-allowed');
    el.simCapToggle.removeAttribute('data-tooltip');
  }

  // Enable Coulomb calibration start button only when real phone is actively connected
  if (el.calStartBtn) {
    el.calStartBtn.disabled = !AppState.connected;
    if (AppState.connected) {
      el.calStartBtn.removeAttribute('data-tooltip');
    } else {
      el.calStartBtn.setAttribute('data-tooltip', 'Connect phone to calibrate');
    }
  }

  // Sync richer snapshot model name to active toast if currently visible
  if (s.device_model) {
    const toastEl = el.connectToast || document.getElementById('device-connect-toast');
    const toastNameEl = el.toastDeviceName || document.getElementById('toast-device-name');
    if (toastEl && toastEl.classList.contains('toast-visible') && toastNameEl) {
      const activeDev = state.systemStatus?.connected_devices?.find(d => d.state === 'device');
      updateTextIfChanged(toastNameEl, formatConnectedDeviceSubtitle(activeDev));
    }
  }

  const health = s.health_pct;

  // OEM SoH Badge and Divergence Banner
  const oemBadge = document.getElementById('hero-oem-soh-badge');
  if (oemBadge) {
    if (s.oem_reported_soh !== null && s.oem_reported_soh !== undefined) {
      updateTextIfChanged(oemBadge, `OEM SoH: ${Math.round(s.oem_reported_soh)}%`);
      oemBadge.classList.remove('hidden');
    } else {
      oemBadge.classList.add('hidden');
    }
  }

  const divBanner = document.getElementById('soh-divergence-banner');
  const divText = document.getElementById('soh-divergence-text');
  if (divBanner) {
    if (s.soh_divergence_flag) {
      if (divText) {
        updateTextIfChanged(divText, `Notice: OEM reported SoH (${s.oem_reported_soh}%) diverges from calculated health (${s.health_pct}%) by >10%. Both metrics are presented independently.`);
      }
      divBanner.classList.remove('hidden');
    } else {
      divBanner.classList.add('hidden');
    }
  }

  if (s.connected && (s.health_status === 'insufficient_data' || health === null || health === undefined)) {
    if (lastRenderedSnapshotState.healthGrade !== 'unknown') {
      lastRenderedSnapshotState.healthGrade = 'unknown';
      el.heroCard.classList.remove('hero-gradient-healthy', 'hero-gradient-fair', 'hero-gradient-poor');
      el.heroCard.classList.add('hero-gradient-unknown');
    }
    updateTextIfChanged(el.heroHealthNumber, '--');
    updateTextIfChanged(el.heroStatusPill, 'Gathering Data');
    updateTextIfChanged(el.heroStatusHeading, 'Insufficient Data to Compute Health');
    updateTextIfChanged(el.heroStatusSubtext, "Cycle count isn't exposed by this device's firmware — building an estimate from usage history, check back in a few days.");
    if (lastRenderedSnapshotState.dialPos !== null) {
      lastRenderedSnapshotState.dialPos = null;
      setRangeDialPosition(null);
    }
    const days = s.history_days !== undefined ? `${s.history_days}d history` : 'Gathering';
    if (el.heroMethodBadge) {
      el.heroMethodBadge.classList.remove('hidden');
      updateTextIfChanged(el.heroMethodBadge, `Gathering Data · ${days}`);
    }
  } else if (health === null || health === undefined) {
    renderIdleState();
  } else {
    const displayVal = Math.min(100, Math.max(0, Math.round(health)));
    updateTextIfChanged(el.heroHealthNumber, displayVal);
    if (el.heroHealthNumber) {
      el.heroHealthNumber.classList.remove('skeleton-shimmer');
    }

    // Range Dial position
    if (lastRenderedSnapshotState.dialPos !== displayVal) {
      lastRenderedSnapshotState.dialPos = displayVal;
      setRangeDialPosition(displayVal);
    }
    if (el.heroMethodBadge) {
      el.heroMethodBadge.classList.remove('hidden');
    }

    // Dynamic Gradient & Evaluation
    let grade = 'unknown';
    let statusPillText = 'Gathering Data';
    let statusHeadingText = 'Insufficient Data to Compute Health';
    let statusSubtextText = "Cycle count isn't exposed by this device's firmware — building an estimate from usage history, check back in a few days.";

    if (health >= 85) {
      grade = 'healthy';
      statusPillText = 'Steady & Healthy';
      statusHeadingText = 'Optimal Retention';
      statusSubtextText = s.is_static_register
        ? `Retaining ~${formatCapacity(s.effective_capacity_uah)} · ${s.cycle_count || 0} cycles with optimal retention.`
        : `Retaining ${displayVal}% of factory capacity · Outstanding chemical stability.`;
    } else if (health >= 70) {
      grade = 'fair';
      statusPillText = 'Fair Condition';
      statusHeadingText = 'Moderate Capacity Fade';
      statusSubtextText = s.is_static_register
        ? `Retaining ~${formatCapacity(s.effective_capacity_uah)} · ${s.cycle_count || 0} cycles with calendar wear.`
        : `Retaining ${displayVal}% of factory capacity · Normal wear for current cycle progression.`;
    } else {
      grade = 'poor';
      statusPillText = 'Needs Care';
      statusHeadingText = 'Significant Degradation';
      statusSubtextText = s.is_static_register
        ? `Retaining ~${formatCapacity(s.effective_capacity_uah)} · High cumulative cycle & calendar wear.`
        : `Retaining ${displayVal}% of factory capacity · High cell impedance detected.`;
    }

    if (lastRenderedSnapshotState.healthGrade !== grade) {
      lastRenderedSnapshotState.healthGrade = grade;
      el.heroCard.classList.remove('hero-gradient-healthy', 'hero-gradient-fair', 'hero-gradient-poor', 'hero-gradient-unknown');
      el.heroCard.classList.add(`hero-gradient-${grade}`);
    }

    updateTextIfChanged(el.heroStatusPill, statusPillText);
    updateTextIfChanged(el.heroStatusHeading, statusHeadingText);
    updateTextIfChanged(el.heroStatusSubtext, statusSubtextText);

    let methodText = 'Capacity Ratio';
    if (s.health_method === 'apple_standard_calibrated' || s.is_static_register) {
      methodText = `Apple-Standard SoH · ${s.cycle_count ? s.cycle_count + ' Cycles' : 'Calibrated'}`;
    } else if (s.health_method === 'trend_estimate_no_cycle_data') {
      methodText = 'Trend Estimate (7+ Days History)';
    } else if (s.health_method === 'oem_reported_soh') {
      methodText = 'OEM Verified SoH';
    } else if (s.health_method === 'trend_estimate') {
      methodText = 'Trend Baseline';
    } else if (s.recalibrated) {
      methodText += ` · Recalibrated (${s.raw_capacity_ratio || 100}% raw)`;
    }
    updateTextIfChanged(el.heroMethodBadge, methodText);
  }

  // 2. THREE-STAT ROW (Heart Report)
  // Temp
  if (s.temperature_c !== null && s.temperature_c !== undefined) {
    updateTextIfChanged(el.statTemp, `${s.temperature_c}°C`);
    const tb = s.temperature_band || {};
    updateTextIfChanged(el.statTempLabel, tb.label || 'Optimal condition');
  } else {
    updateTextIfChanged(el.statTemp, '—');
    updateTextIfChanged(el.statTempLabel, 'No thermal reading');
  }

  // Voltage
  updateTextIfChanged(el.statVoltage, s.voltage_mv ? `${(s.voltage_mv / 1000).toFixed(2)} V` : '—');

  // Cycles
  const sublabel = document.getElementById('stat-cycles-sublabel');
  const hasCycles = s.cycle_count !== null && s.cycle_count !== undefined && s.cycle_count !== 'unavailable' && s.cycle_count_type !== 'unavailable';
  if (hasCycles) {
    const cycleType = s.cycle_count_type === 'estimated' ? ' (Estimated)' : ' (Hardware)';
    updateTextIfChanged(el.statCycles, `${s.cycle_count}`);
    if (sublabel) updateTextIfChanged(sublabel, `OEM cycle count${cycleType}`);
  } else {
    updateTextIfChanged(el.statCycles, 'Unavailable');
    if (sublabel) updateTextIfChanged(sublabel, s.connected ? 'No cycle data exposed' : 'OEM cycle count');
  }

  // 3. SECONDARY INDIGO & DARK CARDS
  // Level & Status
  updateTextIfChanged(el.snapLevelText, s.level_pct !== null && s.level_pct !== undefined ? `${s.level_pct}%` : '—');
  updateTextIfChanged(el.snapStatusBadge, s.status || 'Disconnected');
  let chargeSpeedStr = 'Running on battery';
  if (s.status === 'Charging') {
    chargeSpeedStr = s.voltage_mv >= 4200 ? 'Fast charging active (>4.2V)' : 'Standard USB charge';
  } else if (s.status === 'Full') {
    chargeSpeedStr = 'Fully charged';
  }
  updateTextIfChanged(el.snapChargeSpeedText, chargeSpeedStr);
  updateTextIfChanged(el.snapLastSync, new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));

  // Capacities
  const effectiveCap = s.effective_capacity_uah || s.charge_full_uah || s.charge_counter_uah;
  updateTextIfChanged(el.capFullText, formatCapacity(effectiveCap));
  updateTextIfChanged(el.capDesignText, formatCapacity(s.charge_full_design_uah));

  if (s.is_static_register || s.health_method === 'apple_standard_calibrated') {
    if (el.capFullSubtext) {
      updateTextIfChanged(el.capFullSubtext, `OEM Static Register: ${formatCapacity(s.charge_full_uah)}`);
      el.capFullSubtext.classList.remove('hidden');
    }
    updateTextIfChanged(el.capBadge, 'Apple Standard SoH');
    if (el.capFooterNote) {
      updateTextIfChanged(el.capFooterNote, 'Calibrated against IEC 61960 Li-ion wear standards (OEM register was static).');
    }
  } else {
    if (el.capFullSubtext) el.capFullSubtext.classList.add('hidden');
    updateTextIfChanged(el.capBadge, 'Hardware Counter');
    if (el.capFooterNote) {
      updateTextIfChanged(el.capFooterNote, 'Read directly from sysfs power_supply registers.');
    }
  }

  // Core Capacity Retention & Fade Ratios
  if (el.capRetentionText) {
    updateTextIfChanged(el.capRetentionText, s.capacity_retention_pct !== null && s.capacity_retention_pct !== undefined ? `${s.capacity_retention_pct}%` : '—');
  }
  if (el.capFadeText) {
    updateTextIfChanged(el.capFadeText, s.capacity_fade_pct !== null && s.capacity_fade_pct !== undefined ? `${s.capacity_fade_pct}%` : '—');
  }

  // Provenance Badges on Chemical Capacity
  const bd = s.breakdown || {};
  const sources = bd.data_sources || {};
  if (el.capFullProvenance) {
    const src = sources.charge_full || 'local';
    updateTextIfChanged(el.capFullProvenance, src === 'ai_consensus' ? 'AI Consensus' : (src === 'insufficient_data' ? 'No Data' : 'Local USB'));
    const expectedClass = src === 'ai_consensus'
      ? 'text-[10px] px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 font-mono'
      : (src === 'insufficient_data'
        ? 'text-[10px] px-2 py-0.5 rounded-full bg-zinc-700 text-zinc-400 font-mono'
        : 'text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-mono');
    if (el.capFullProvenance.className !== expectedClass) el.capFullProvenance.className = expectedClass;
  }
  if (el.capDesignProvenance) {
    const src = sources.charge_full_design || 'local';
    updateTextIfChanged(el.capDesignProvenance, src === 'ai_consensus' ? 'AI Consensus' : (src === 'insufficient_data' ? 'No Data' : 'Local USB'));
    const expectedClass = src === 'ai_consensus'
      ? 'text-[10px] px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 font-mono'
      : (src === 'insufficient_data'
        ? 'text-[10px] px-2 py-0.5 rounded-full bg-zinc-700 text-zinc-400 font-mono'
        : 'text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-mono');
    if (el.capDesignProvenance.className !== expectedClass) el.capDesignProvenance.className = expectedClass;
  }

  // Mathematical Model Breakdown Card
  if (el.bdFadeText) updateTextIfChanged(el.bdFadeText, bd.capacity_fade_pct !== null && bd.capacity_fade_pct !== undefined ? `${bd.capacity_fade_pct}%` : '—');
  if (el.bdCycleText) updateTextIfChanged(el.bdCycleText, bd.cycle_fatigue_pct !== null && bd.cycle_fatigue_pct !== undefined ? `${bd.cycle_fatigue_pct}%` : '—');
  if (el.bdCalendarText) updateTextIfChanged(el.bdCalendarText, bd.calendar_aging_pct !== null && bd.calendar_aging_pct !== undefined ? `${bd.calendar_aging_pct}%` : '—');
  if (el.bdStressText) updateTextIfChanged(el.bdStressText, bd.stress_multiplier !== null && bd.stress_multiplier !== undefined ? `${bd.stress_multiplier}×` : '1.0×');
  if (el.bdFinalText) updateTextIfChanged(el.bdFinalText, bd.final_health_pct !== null && bd.final_health_pct !== undefined ? `${bd.final_health_pct}%` : '--');

  if (el.breakdownProvenanceNote && bd.provenance_note) {
    updateTextIfChanged(el.breakdownProvenanceNote, bd.provenance_note);
  }

  const currentSourcesKey = `${sources.charge_full}-${sources.charge_full_design}-${sources.cycle_count}-${s.connected}`;
  if (el.bdSourcesPill && lastRenderedSnapshotState.sourcesKey !== currentSourcesKey) {
    lastRenderedSnapshotState.sourcesKey = currentSourcesKey;
    el.bdSourcesPill.innerHTML = '';
    const pillFields = [
      { key: 'charge_full', label: 'Fuel Gauge' },
      { key: 'charge_full_design', label: 'Design' },
      { key: 'cycle_count', label: 'Cycles' },
    ];
    pillFields.forEach(f => {
      const src = sources[f.key] || 'local';
      const badge = document.createElement('span');
      let badgeStyle = 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30';
      let srcLabel = 'Local';
      if (src === 'ai_consensus') {
        badgeStyle = 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30';
        srcLabel = 'AI Consensus';
      } else if (src === 'insufficient_data' || src === 'unavailable' || !s.connected) {
        badgeStyle = 'bg-zinc-800 text-zinc-400 border-white/10';
        srcLabel = 'Unavailable';
      }
      badge.className = `px-2 py-0.5 rounded text-[10px] font-mono border ${badgeStyle}`;
      badge.textContent = `${f.label}: ${srcLabel}`;
      el.bdSourcesPill.appendChild(badge);
    });
  }

  // 4. PREDICTIVE REPLACEMENT FORECAST
  // Normal forecast renders automatically whenever snapshot data is available
  if (s.replacement_forecast) {
    state.normalForecast = s.replacement_forecast;
    renderForecast(s.replacement_forecast);
  } else if (!s.connected && !state.selectedSerial) {
    renderForecastIdle();
  }
}

// Forecast State Handlers (Normal Baseline + On-Toggle Side-by-Side Simulation)
let forecastRequestId = 0;

function formatTargetMonthYear(dateStr) {
  if (!dateStr || dateStr === '—') return '—';
  try {
    const parts = String(dateStr).split('-');
    if (parts.length >= 2) {
      const year = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10) - 1;
      const d = new Date(Date.UTC(year, month, 1));
      if (!isNaN(d.getTime())) {
        return d.toLocaleDateString(undefined, { month: 'short', year: 'numeric', timeZone: 'UTC' });
      }
    }
    const d = parseUtcDate(dateStr);
    if (d && !isNaN(d.getTime())) {
      return d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
    }
  } catch (_) {}
  return dateStr;
}

function calculateProjectedDateFromDays(days) {
  if (!days || days <= 0) return '—';
  try {
    const d = new Date();
    d.setDate(d.getDate() + Math.round(days));
    return d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
  } catch (_) {
    return '—';
  }
}

function renderForecastIdle() {
  if (el.forecastMonthsText) {
    el.forecastMonthsText.textContent = '—';
    el.forecastMonthsText.classList.remove('skeleton-shimmer');
  }
  if (el.forecastSubtextLabel) {
    el.forecastSubtextLabel.textContent = 'Estimated To 80%';
  }
  if (el.forecastDateText) {
    el.forecastDateText.textContent = 'Awaiting connection';
  }
  if (el.forecastUrgencyPill) {
    el.forecastUrgencyPill.textContent = 'Standby';
    el.forecastUrgencyPill.className = 'px-3.5 py-1 rounded-full text-xs font-bold bg-zinc-800 text-zinc-400 border border-white/10';
  }
  if (el.forecastCurrentHealth) {
    el.forecastCurrentHealth.textContent = '—';
  }
  if (el.forecastProgressBar) {
    el.forecastProgressBar.style.width = '0%';
  }
  if (el.forecastCyclesLeft) {
    el.forecastCyclesLeft.textContent = '— cycles remaining';
  }
  if (el.forecastDailyCadence) {
    el.forecastDailyCadence.textContent = '— cycles/day';
  }
  if (el.simCapResult) {
    el.simCapResult.classList.add('hidden');
  }
  if (el.simCapToggle) {
    el.simCapToggle.checked = false;
    el.simCapToggle.setAttribute('aria-checked', 'false');
    el.simCapToggle.classList.remove('bg-indigo-600');
    el.simCapToggle.classList.add('bg-zinc-700');
    el.simCapKnob?.classList.remove('translate-x-5');
    el.simCapKnob?.classList.add('translate-x-0');
  }
}

function renderForecast(forecast) {
  if (!forecast || !el.forecastMonthsText) return;
  state.normalForecast = forecast;

  if (el.forecastMonthsText) {
    el.forecastMonthsText.classList.remove('skeleton-shimmer');
  }

  const targetDateRaw = forecast.projected_date_formatted || forecast.projected_date_iso || '—';
  const targetDateFormatted = formatTargetMonthYear(targetDateRaw);

  if (forecast.urgency === 'Service Recommended' || (forecast.current_health_pct && forecast.current_health_pct <= 80.0)) {
    updateTextIfChanged(el.forecastMonthsText, '0 mo');
    updateTextIfChanged(el.forecastSubtextLabel, 'Service Limit: 80%');
    updateTextIfChanged(el.forecastDateText, 'Service Recommended');
    if (el.forecastUrgencyPill) {
      updateTextIfChanged(el.forecastUrgencyPill, 'Service Limit');
      el.forecastUrgencyPill.className = 'px-3.5 py-1 rounded-full text-xs font-bold bg-rose-500/20 text-rose-300 border border-rose-500/30';
    }
  } else {
    updateTextIfChanged(el.forecastMonthsText, `~${forecast.months_remaining} mo`);
    if (el.forecastSubtextLabel) {
      updateTextIfChanged(el.forecastSubtextLabel, targetDateFormatted !== '—' ? `Estimated to 80%: ${targetDateFormatted}` : 'Estimated to 80%');
    }
    if (el.forecastDateText) {
      updateTextIfChanged(el.forecastDateText, targetDateFormatted !== '—' ? `Target: ${targetDateFormatted}` : 'Target: —');
    }
    if (el.forecastUrgencyPill) {
      updateTextIfChanged(el.forecastUrgencyPill, forecast.urgency || 'Upcoming');
      if (forecast.urgency === 'Healthy') {
        el.forecastUrgencyPill.className = 'px-3.5 py-1 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30';
      } else if (forecast.urgency === 'Upcoming') {
        el.forecastUrgencyPill.className = 'px-3.5 py-1 rounded-full text-xs font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30';
      } else {
        el.forecastUrgencyPill.className = 'px-3.5 py-1 rounded-full text-xs font-bold bg-rose-500/20 text-rose-300 border border-rose-500/30';
      }
    }
  }

  const formattedHealth = (forecast.current_health_pct !== null && forecast.current_health_pct !== undefined)
    ? `${forecast.current_health_pct}%`
    : '--%';
  updateTextIfChanged(el.forecastCurrentHealth, formattedHealth);
  updateTextIfChanged(el.forecastCyclesLeft, `~${forecast.cycles_remaining} cycles remaining`);
  updateTextIfChanged(el.forecastDailyCadence, `~${forecast.daily_cycle_rate} cycles/day`);

  // Scale progress bar: 70% to 100% maps to 0% to 100% width via compositor scaleX
  if (el.forecastProgressBar) {
    if (forecast.current_health_pct !== null && forecast.current_health_pct !== undefined) {
      const health = Math.min(100, Math.max(0, Number(forecast.current_health_pct)));
      const progressPct = Math.min(100, Math.max(5, ((health - 70) / 30) * 100));
      el.forecastProgressBar.style.transform = `scaleX(${progressPct / 100})`;
    } else {
      el.forecastProgressBar.style.transform = 'scaleX(0)';
    }
  }

  // If 80% simulation toggle is active, update the side-by-side comparison too
  if (state.is80CapSimulated) {
    renderSimulatedForecast(forecast);
  }
}

function renderSimulatedForecast(forecast) {
  if (!forecast) return;
  const sim = forecast.simulation_80_cap;
  if (!sim) return;

  const extraMonths = sim.extra_months || 18.0;
  const extraYears = (extraMonths / 12.0).toFixed(1);

  const normalDateFormatted = formatTargetMonthYear(forecast.projected_date_formatted || forecast.projected_date_iso);
  const cappedDateFormatted = sim.projected_date_iso
    ? formatTargetMonthYear(sim.projected_date_iso)
    : calculateProjectedDateFromDays(sim.extended_days || (sim.extended_months * 30.44));

  if (el.simCapExtraText) {
    el.simCapExtraText.textContent = `+${extraYears} years (~${extraMonths} extra months)`;
  }
  if (el.simCompareNormalMonths) {
    el.simCompareNormalMonths.textContent = `~${forecast.months_remaining} mo`;
  }
  if (el.simCompareNormalDetail) {
    el.simCompareNormalDetail.textContent = `${normalDateFormatted} · ~${forecast.cycles_remaining} cycles`;
  }
  if (el.simCompareCappedMonths) {
    el.simCompareCappedMonths.textContent = `~${sim.extended_months} mo`;
  }
  if (el.simCompareCappedDetail) {
    el.simCompareCappedDetail.textContent = `${cappedDateFormatted} · +${sim.lifespan_extension_pct || 82}% gain`;
  }

  if (el.simCapResult) {
    el.simCapResult.classList.remove('hidden');
  }

  if (el.simCapToggle) {
    el.simCapToggle.checked = true;
    el.simCapToggle.setAttribute('aria-checked', 'true');
    el.simCapToggle.classList.remove('bg-zinc-700');
    el.simCapToggle.classList.add('bg-indigo-600');
    el.simCapKnob?.classList.add('translate-x-5');
    el.simCapKnob?.classList.remove('translate-x-0');
  }
}

function renderForecastInsufficientData(message = 'Not enough data yet') {
  if (el.forecastMonthsText) {
    el.forecastMonthsText.textContent = '—';
    el.forecastMonthsText.classList.remove('skeleton-shimmer');
  }
  if (el.forecastSubtextLabel) el.forecastSubtextLabel.textContent = message;
  if (el.forecastDateText) el.forecastDateText.textContent = 'Needs more historical readings';
  if (el.forecastUrgencyPill) {
    el.forecastUrgencyPill.textContent = 'Pending';
    el.forecastUrgencyPill.className = 'px-3.5 py-1 rounded-full text-xs font-bold bg-zinc-800 text-zinc-400 border border-white/10';
  }
  if (el.forecastCurrentHealth) el.forecastCurrentHealth.textContent = '—';
  if (el.forecastProgressBar) el.forecastProgressBar.style.width = '0%';
  if (el.forecastCyclesLeft) el.forecastCyclesLeft.textContent = 'Insufficient cycle data';
  if (el.forecastDailyCadence) el.forecastDailyCadence.textContent = '—';
  if (el.simCapResult) el.simCapResult.classList.add('hidden');
  state.is80CapSimulated = false;
  if (el.simCapToggle) {
    el.simCapToggle.checked = false;
    el.simCapToggle.setAttribute('aria-checked', 'false');
  }
}

function renderForecastError(message = 'Forecast calculation error', subtext = 'API request failed') {
  if (el.forecastMonthsText) {
    el.forecastMonthsText.textContent = '—';
    el.forecastMonthsText.classList.remove('skeleton-shimmer');
  }
  if (el.forecastSubtextLabel) el.forecastSubtextLabel.textContent = message;
  if (el.forecastDateText) el.forecastDateText.textContent = subtext;
  if (el.forecastUrgencyPill) {
    el.forecastUrgencyPill.textContent = 'Error';
    el.forecastUrgencyPill.className = 'px-3.5 py-1 rounded-full text-xs font-bold bg-rose-500/20 text-rose-300 border border-rose-500/30';
  }
  if (el.forecastCurrentHealth) el.forecastCurrentHealth.textContent = '—';
  if (el.forecastProgressBar) el.forecastProgressBar.style.width = '0%';
  if (el.forecastCyclesLeft) el.forecastCyclesLeft.textContent = '—';
  if (el.forecastDailyCadence) el.forecastDailyCadence.textContent = '—';
  if (el.simCapResult) el.simCapResult.classList.add('hidden');

  // Revert toggle state to OFF
  state.is80CapSimulated = false;
  if (el.simCapToggle) {
    el.simCapToggle.checked = false;
    el.simCapToggle.setAttribute('aria-checked', 'false');
    el.simCapToggle.classList.remove('bg-indigo-600');
    el.simCapToggle.classList.add('bg-zinc-700');
    el.simCapKnob?.classList.remove('translate-x-5');
    el.simCapKnob?.classList.add('translate-x-0');
  }
}

async function handleSimCapToggle(e) {
  // Preserve scroll position to eliminate any jump on click or reflow
  const savedScrollY = window.scrollY || window.pageYOffset || document.documentElement.scrollTop || 0;

  const isConnected = AppState.connected || AppState.mode === 'seeded';
  if (!isConnected) {
    if (el.simCapToggle) {
      el.simCapToggle.checked = false;
      el.simCapToggle.setAttribute('aria-checked', 'false');
    }
    state.is80CapSimulated = false;
    renderForecastInsufficientData('Awaiting device connection');
    if (typeof window.scrollTo === 'function') {
      window.scrollTo({ top: savedScrollY, behavior: 'instant' });
    }
    return;
  }

  // Toggle state: sync with checkbox checked status or toggle if programmatically invoked
  if (el.simCapToggle && typeof el.simCapToggle.checked === 'boolean' && e) {
    state.is80CapSimulated = el.simCapToggle.checked;
  } else {
    state.is80CapSimulated = !state.is80CapSimulated;
    if (el.simCapToggle) {
      el.simCapToggle.checked = state.is80CapSimulated;
    }
  }
  const isCapped = state.is80CapSimulated;

  if (!isCapped) {
    // Toggle OFF: hide simulation drawer, retain normal baseline forecast in hero
    forecastRequestId++;
    if (el.simCapResult) el.simCapResult.classList.add('hidden');
    if (el.simCapToggle) {
      el.simCapToggle.checked = false;
      el.simCapToggle.setAttribute('aria-checked', 'false');
    }
    if (state.normalForecast) {
      renderForecast(state.normalForecast);
    }
    if (typeof window.scrollTo === 'function') {
      window.scrollTo({ top: savedScrollY, behavior: 'instant' });
    }
    return;
  }

  // Toggle ON: update toggle button and show simulation side-by-side
  if (el.simCapToggle) {
    el.simCapToggle.checked = true;
    el.simCapToggle.setAttribute('aria-checked', 'true');
  }

  // Unhide simulation drawer
  if (el.simCapResult) {
    el.simCapResult.classList.remove('hidden');
  }

  // If already in memory with calculated simulation, display immediately
  if (state.normalForecast && state.normalForecast.simulation_80_cap) {
    renderSimulatedForecast(state.normalForecast);
  } else {
    // Scoped loading state ONLY inside the simulation drawer of the forecast card
    if (el.simCapExtraText) el.simCapExtraText.textContent = 'Calculating simulation...';
    if (el.simCompareNormalMonths && state.normalForecast) {
      el.simCompareNormalMonths.textContent = `~${state.normalForecast.months_remaining} mo`;
    }
    if (el.simCompareCappedMonths) {
      el.simCompareCappedMonths.textContent = '...';
    }
    if (el.simCompareCappedDetail) {
      el.simCompareCappedDetail.textContent = 'Simulating 80% cap...';
    }
  }

  // Also query fresh from /api/prediction (scoped to forecast card)
  const reqId = ++forecastRequestId;
  const targetSerial = state.selectedSerial || state.snapshot?.device_serial;
  let url = '/api/prediction';
  const queryParams = [];
  if (targetSerial) queryParams.push(`serial=${encodeURIComponent(targetSerial)}`);
  if (state.snapshot?.health_pct !== null && state.snapshot?.health_pct !== undefined) {
    queryParams.push(`health=${encodeURIComponent(state.snapshot.health_pct)}`);
  }
  if (state.snapshot?.cycle_count !== null && state.snapshot?.cycle_count !== undefined && !isNaN(state.snapshot.cycle_count)) {
    queryParams.push(`cycles=${encodeURIComponent(state.snapshot.cycle_count)}`);
  }
  if (queryParams.length) url += `?${queryParams.join('&')}`;

  try {
    const res = await fetch(url);
    if (reqId !== forecastRequestId || !state.is80CapSimulated) return;

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (reqId !== forecastRequestId || !state.is80CapSimulated) return;

    if (data.forecast) {
      renderForecast(data.forecast);
      renderSimulatedForecast(data.forecast);
    }
  } catch (err) {
    if (reqId !== forecastRequestId || !state.is80CapSimulated) return;
    console.warn('Simulation prediction fetch failed:', err);
    if (!state.normalForecast) {
      renderForecastError('Forecast calculation error', 'API request failed');
    }
  } finally {
    if (typeof window.scrollTo === 'function') {
      window.scrollTo({ top: savedScrollY, behavior: 'instant' });
    }
  }
}

// ==========================================
// ACTIVE COULOMB CALIBRATION SUB-SYSTEM
// Extracted to /static/js/calibration.js
// Provides startCalibration, pollCalibrationStatus, stopCalibration,
// resetCalibrationUI, and initCalibrationListeners
// ==========================================

let chartObserver = null;
let chartIsVisible = true;
let chartNeedsUpdate = false;

function initChartObserver() {
  const container = document.getElementById('chart-canvas-container') || document.getElementById('chart-container');
  if (!container || typeof IntersectionObserver === 'undefined') return;

  chartObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      chartIsVisible = entry.isIntersecting;
      if (chartIsVisible && chartNeedsUpdate) {
        chartNeedsUpdate = false;
        renderHistoryAndChart();
      }
    }
  }, { threshold: 0.05 });

  chartObserver.observe(container);
}

function renderHistoryAndChart() {
  const readings = state.history || [];
  if (el.historyCountBadge) {
    if (readings.length > 0) {
      const firstTs = parseUtcDate(readings[0].timestamp).getTime();
      const lastTs = parseUtcDate(readings[readings.length - 1].timestamp).getTime();
      const spanDays = Math.max(1, Math.round((lastTs - firstTs) / (1000 * 60 * 60 * 24)));
      const filterDays = state.selectedDays || 30;
      const countText = spanDays < filterDays
        ? `${readings.length} readings · ${spanDays}D recorded`
        : `${readings.length} readings · ${filterDays}D range`;
      updateTextIfChanged(el.historyCountBadge, countText);
    } else {
      updateTextIfChanged(el.historyCountBadge, '0 readings');
    }
  }

  // 1. Chart.js (EURA Heart Report Aesthetic: Clean White Curve)
  if (el.chartCanvas) {
    const emptyStateEl = el.chartEmptyState || document.getElementById('chart-empty-state');
    if (!chartIsVisible) {
      chartNeedsUpdate = true;
    } else if (readings.length > 0) {
      if (emptyStateEl) emptyStateEl.classList.add('hidden');
      const labels = readings.map(r => {
        const d = parseUtcDate(r.timestamp);
        return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${d.getMinutes().toString().padStart(2, '0')}`;
      });

      const healthVals = readings.map(r => r.health_pct);
      const tempVals = readings.map(r => r.temperature_c);

      if (state.chartInstance) {
        state.chartInstance.data.labels = labels;
        state.chartInstance.data.datasets[0].data = healthVals;
        state.chartInstance.data.datasets[1].data = tempVals;
        state.chartInstance.data.datasets[0].pointRadius = readings.length > 40 ? 0 : 3;
        if (state.chartInstance.options?.scales?.yHealth) {
          state.chartInstance.options.scales.yHealth.min = Math.max(60, Math.floor(Math.min(...healthVals) - 4));
        }
        state.chartInstance.update('none');
      } else {
        const ctx = el.chartCanvas.getContext('2d');
        // Subtle gradient beneath white curve
        const gradient = ctx.createLinearGradient(0, 0, 0, 240);
        gradient.addColorStop(0, 'rgba(255, 255, 255, 0.15)');
        gradient.addColorStop(1, 'rgba(255, 255, 255, 0.0)');

        state.chartInstance = new Chart(ctx, {
          type: 'line',
          data: {
            labels: labels,
            datasets: [
              {
                label: 'Battery Health %',
                data: healthVals,
                borderColor: '#FFFFFF',
                backgroundColor: gradient,
                borderWidth: 2.5,
                tension: 0.0,
                fill: true,
                pointRadius: readings.length > 40 ? 0 : 3,
                pointHoverRadius: 6,
                pointBackgroundColor: '#FFFFFF',
                pointBorderColor: '#0F1024',
                pointBorderWidth: 2,
                yAxisID: 'yHealth',
              },
              {
                label: 'Temp (°C)',
                data: tempVals,
                borderColor: 'rgba(129, 140, 248, 0.65)',
                borderWidth: 1.5,
                borderDash: [3, 3],
                tension: 0.0,
                fill: false,
                pointRadius: 0,
                pointHoverRadius: 4,
                pointBackgroundColor: '#818CF8',
                yAxisID: 'yTemp',
              }
            ],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
              mode: 'index',
              intersect: false,
            },
            plugins: {
              legend: {
                display: true,
                position: 'top',
                align: 'end',
                labels: {
                  color: '#A1A1AA',
                  font: { size: 11 },
                  boxWidth: 10,
                  boxHeight: 10,
                  usePointStyle: true,
                },
              },
              tooltip: {
                backgroundColor: 'rgba(15, 16, 36, 0.95)',
                titleColor: '#FFFFFF',
                bodyColor: '#A1A1AA',
                borderColor: 'rgba(255, 255, 255, 0.15)',
                borderWidth: 1,
                padding: 12,
                cornerRadius: 14,
                callbacks: {
                  label: function(context) {
                    const r = readings[context.dataIndex];
                    if (!r) return `${context.dataset.label}: ${context.parsed.y}`;
                    if (context.datasetIndex === 0) {
                      const hp = (r.health_pct !== null && r.health_pct !== undefined) ? r.health_pct : context.parsed.y;
                      return ` Battery Health %: ${hp}%`;
                    } else if (context.datasetIndex === 1) {
                      const temp = (r.temperature_c !== null && r.temperature_c !== undefined) ? r.temperature_c : context.parsed.y;
                      return ` Temp (°C): ${temp}`;
                    }
                    return `${context.dataset.label}: ${context.parsed.y}`;
                  },
                  afterBody: function(contexts) {
                    if (!contexts || contexts.length === 0) return '';
                    const r = readings[contexts[0].dataIndex];
                    if (!r) return '';
                    const parts = [];
                    if (r.voltage_mv) parts.push(`Voltage: ${r.voltage_mv} mV`);
                    if (r.cycle_count !== null && r.cycle_count !== undefined) parts.push(`Cycles: ${r.cycle_count}`);
                    if (r.health_method) parts.push(`Method: ${r.health_method}`);
                    return parts.length ? '\n' + parts.join(' | ') : '';
                  }
                }
              },
            },
            scales: {
              x: {
                grid: { color: 'rgba(255, 255, 255, 0.06)' },
                ticks: {
                  color: '#71717A',
                  font: { size: 10 },
                  maxRotation: 0,
                  autoSkip: true,
                  maxTicksLimit: 7,
                },
              },
              yHealth: {
                type: 'linear',
                position: 'left',
                min: Math.max(60, Math.floor(Math.min(...healthVals) - 4)),
                max: 102,
                grid: { color: 'rgba(255, 255, 255, 0.06)' },
                ticks: {
                  color: '#FFFFFF',
                  font: { size: 11, weight: 'bold' },
                  callback: v => `${v}%`,
                },
              },
              yTemp: {
                type: 'linear',
                position: 'right',
                grid: { display: false },
                ticks: {
                  color: '#818CF8',
                  font: { size: 10 },
                  callback: v => `${v}°C`,
                },
              },
            },
          },
        });
      }
    } else {
      // readings.length === 0: show clean empty state
      if (emptyStateEl) emptyStateEl.classList.remove('hidden');
      if (state.chartInstance) {
        state.chartInstance.data.labels = [];
        state.chartInstance.data.datasets[0].data = [];
        state.chartInstance.data.datasets[1].data = [];
        state.chartInstance.update('none');
      }
    }

    // Fix 3: Stale chart sync check
    const isConn = state.snapshot?.connected || state.systemStatus?.connected_devices?.some(d => d.state === 'device');
    if (!isConn) {
      if (el.chartCanvasContainer) {
        el.chartCanvasContainer.classList.add('chart-stale-dimmed');
      }
      updateChartLastSyncedLabel();
    } else {
      if (el.chartCanvasContainer) {
        el.chartCanvasContainer.classList.remove('chart-stale-dimmed');
      }
      if (el.chartLastSyncedLabel) {
        el.chartLastSyncedLabel.classList.add('hidden');
        el.chartLastSyncedLabel.textContent = '';
      }
    }
  }

  // 2. History Log Table (Virtualized for 60+ FPS with 5,000+ rows)
  if (readings.length === 0) {
    renderVirtualHistory([]);
    return;
  }

  const reversed = [...readings].reverse();
  renderVirtualHistory(reversed);
}

// Virtualized History Log Table Implementation
let virtualHistoryState = {
  items: [],
  rowHeight: 44,
  container: null,
  scrollListenerAttached: false,
  lastRenderedStart: -1,
  lastRenderedEnd: -1,
};

function renderVirtualHistory(items) {
  if (items) {
    virtualHistoryState.items = items;
    virtualHistoryState.lastRenderedStart = -1;
    virtualHistoryState.lastRenderedEnd = -1;
  }
  const container = document.getElementById('history-scroll-container');
  if (!container || !el.historyTableBody) return;

  virtualHistoryState.container = container;

  if (!virtualHistoryState.scrollListenerAttached) {
    virtualHistoryState.scrollListenerAttached = true;
    let scrollRaf = null;
    container.addEventListener('scroll', () => {
      lastScrollTimestamp = performance.now();
      if (!scrollRaf) {
        scrollRaf = requestAnimationFrame(() => {
          updateVirtualHistoryView();
          scrollRaf = null;
        });
      }
    }, { passive: true });
  }

  updateVirtualHistoryView();
}

function updateVirtualHistoryView() {
  const { items, rowHeight, container } = virtualHistoryState;
  if (!container || !el.historyTableBody) return;
  if (!items || items.length === 0) {
    el.historyTableBody.innerHTML = `
      <tr>
        <td colspan="7" class="py-8 text-center text-zinc-500 text-xs">
          No history yet. Connect a device or toggle Demo data to preview.
        </td>
      </tr>
    `;
    return;
  }

  const scrollTop = container.scrollTop;
  const viewportHeight = container.clientHeight || 500;
  const totalItems = items.length;
  const buffer = 10;

  let startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - buffer);
  let endIndex = Math.min(totalItems, Math.ceil((scrollTop + viewportHeight) / rowHeight) + buffer);

  if (startIndex === virtualHistoryState.lastRenderedStart && endIndex === virtualHistoryState.lastRenderedEnd) {
    return; // Already rendered this exact slice
  }

  virtualHistoryState.lastRenderedStart = startIndex;
  virtualHistoryState.lastRenderedEnd = endIndex;

  const topSpacerHeight = startIndex * rowHeight;
  const bottomSpacerHeight = Math.max(0, (totalItems - endIndex) * rowHeight);

  const visibleItems = items.slice(startIndex, endIndex);

  const rowsHtml = visibleItems.map(r => {
    let badge = `<span class="glass-chip font-bold">${r.health_pct}%</span>`;
    if (r.health_pct >= 85) {
      badge = `<span class="glass-chip glass-chip-success font-bold">${r.health_pct}%</span>`;
    } else if (r.health_pct >= 70) {
      badge = `<span class="glass-chip glass-chip-warning font-bold">${r.health_pct}%</span>`;
    } else {
      badge = `<span class="glass-chip glass-chip-danger font-bold">${r.health_pct}%</span>`;
    }

    return `
      <tr class="history-virtual-row border-b border-white/[0.04] hover:bg-white/[0.04] text-xs text-zinc-300 transition-colors">
        <td class="py-3 px-4 font-mono text-zinc-400">${formatDate(r.timestamp)}</td>
        <td class="py-3 px-4">${badge}</td>
        <td class="py-3 px-4 font-bold text-white font-mono">${r.level_pct}%</td>
        <td class="py-3 px-4 font-mono text-zinc-400">${(r.voltage_mv / 1000).toFixed(2)} V</td>
        <td class="py-3 px-4 text-zinc-300 font-mono">${r.temperature_c} °C</td>
        <td class="py-3 px-4 font-mono text-zinc-400">${(r.cycle_count !== null && r.cycle_count !== undefined && r.cycle_count_type !== 'unavailable') ? r.cycle_count : '<span class="text-zinc-500 italic">Unavailable</span>'}</td>
        <td class="py-3 px-4">
          <span class="glass-chip text-[10px]">
            ${r.health_method === 'capacity_ratio' ? 'Capacity Ratio' : 'Trend'}
          </span>
        </td>
      </tr>
    `;
  }).join('');

  const topRow = topSpacerHeight > 0 
    ? `<tr style="height:${topSpacerHeight}px; padding:0; border:none; pointer-events:none;"><td colspan="7" style="height:${topSpacerHeight}px; padding:0; border:none;"></td></tr>`
    : '';

  const bottomRow = bottomSpacerHeight > 0
    ? `<tr style="height:${bottomSpacerHeight}px; padding:0; border:none; pointer-events:none;"><td colspan="7" style="height:${bottomSpacerHeight}px; padding:0; border:none;"></td></tr>`
    : '';

  el.historyTableBody.innerHTML = topRow + rowsHtml + bottomRow;
}

function renderInsights() {
  const ins = state.insights;
  if (!ins) return;

  el.metricAbove80.textContent = `${ins.time_above_80_pct}%`;
  el.metricFastCharge.textContent = `${ins.fast_charge_pct}%`;
  el.metricAvgTemp.textContent = `${ins.avg_temp_c}°C`;

  const delta = ins.health_delta_pct;
  const sign = delta > 0 ? '+' : '';
  el.metricDelta.textContent = `${sign}${delta}%`;
  if (delta < -1) {
    el.metricDelta.className = 'text-3xl font-black text-rose-400 font-mono mt-1';
  } else {
    el.metricDelta.className = 'text-3xl font-black text-emerald-400 font-mono mt-1';
  }

  // Insight cards list
  const list = ins.insights_list || [];
  if (list.length === 0) {
    el.insightsListContainer.innerHTML = `
      <div class="text-xs text-zinc-500 py-4 text-center">
        No diagnostic habit insights recorded yet.
      </div>
    `;
    return;
  }

  el.insightsListContainer.innerHTML = list.map(item => {
    let arrow = '→';
    let arrowColor = 'text-zinc-400';
    if (item.trend === 'up') {
      arrow = '↑';
      arrowColor = 'text-emerald-400';
    } else if (item.trend === 'down') {
      arrow = '↓';
      arrowColor = 'text-rose-400';
    }

    let pillClass = 'bg-zinc-800 text-zinc-300';
    if (item.pill_color === 'green') pillClass = 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30';
    if (item.pill_color === 'amber') pillClass = 'bg-amber-500/20 text-amber-300 border border-amber-500/30';
    if (item.pill_color === 'red') pillClass = 'bg-rose-500/20 text-rose-300 border border-rose-500/30';

    return `
      <div class="p-4 rounded-2xl bg-[#0B0B10] border border-white/[0.06] flex items-center justify-between gap-4">
        <div class="flex items-center gap-3">
          <div class="w-8 h-8 rounded-full bg-zinc-900 border border-white/5 flex items-center justify-center font-bold text-sm ${arrowColor}">
            ${arrow}
          </div>
          <div>
            <div class="flex items-center gap-2">
              <h4 class="text-sm font-bold text-white">${item.title}</h4>
              <span class="px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${pillClass}">${item.pill}</span>
            </div>
            <p class="text-xs text-zinc-400 mt-0.5">${item.description}</p>
          </div>
        </div>
        <div class="text-[11px] font-mono text-zinc-500 shrink-0">${item.timestamp}</div>
      </div>
    `;
  }).join('');
}

function renderProbe() {
  const p = state.probeReport;
  if (!p) {
    el.probeContentContainer.innerHTML = `
      <div class="eura-dark-card p-6 text-center text-zinc-400 text-xs">
        Connect phone via USB-C to inspect readable OEM sysfs hardware paths.
      </div>
    `;
    return;
  }

  if (p.error) {
    el.probeContentContainer.innerHTML = `
      <div class="eura-dark-card p-6 border-rose-500/30 text-rose-300 text-xs">
        <p class="font-bold mb-1">Diagnostic Probe Status</p>
        <p class="text-zinc-400">${p.error}</p>
      </div>
    `;
    return;
  }

  const sysfs = p.sysfs?.sysfs_paths_probed || {};
  const rows = Object.entries(sysfs).map(([k, info]) => {
    const isOk = info.readable;
    const badge = isOk
      ? `<span class="glass-chip glass-chip-success">READABLE</span>`
      : `<span class="glass-chip text-zinc-500">HIDDEN</span>`;

    return `
      <tr class="border-b border-white/[0.04] hover:bg-white/[0.04] text-xs transition-colors">
        <td class="py-3 px-4 font-mono text-zinc-300">${info.path}</td>
        <td class="py-3 px-4 font-medium text-zinc-400">${k}</td>
        <td class="py-3 px-4">${badge}</td>
        <td class="py-3 px-4 font-mono text-white">${isOk ? info.raw_val : '—'}</td>
      </tr>
    `;
  }).join('');

  el.probeContentContainer.innerHTML = `
    <div class="eura-dark-card p-6 space-y-3">
      <h3 class="text-sm font-bold text-white uppercase tracking-wider">OEM Sysfs Registers</h3>
      <div class="overflow-x-auto rounded-xl border border-white/[0.06]">
        <table class="w-full text-left">
          <thead class="glass-table-head">
            <tr class="text-[11px] uppercase tracking-wider text-zinc-400 border-b border-white/[0.08]">
              <th class="py-2.5 px-4">Register Path</th>
              <th class="py-2.5 px-4">Field</th>
              <th class="py-2.5 px-4">Permission</th>
              <th class="py-2.5 px-4">Value</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>
    </div>

    <div class="eura-dark-card p-6 space-y-3">
      <h3 class="text-sm font-bold text-white uppercase tracking-wider">Raw dumpsys battery</h3>
      <pre class="glass-inset p-4 text-xs font-mono text-cyan-200 overflow-x-auto">${p.dumpsys_battery?.raw_output || 'No dumpsys output'}</pre>
    </div>
  `;
}

// Sliding Capsule Nav Indicator — correct width + translateX implementation.
// Uses offsetLeft/offsetWidth (layout coordinates, no DPR scaling issues).
// JS sets the blob's width and translateX inline; CSS transitions both.
function updateCapsuleBlob(activeBtn) {
  const blob = document.getElementById('capsule-blob');
  if (!blob) return;
  const target = activeBtn || document.querySelector('.capsule-segment.active');
  if (!target) return;
  if (target.offsetWidth === 0) return; // element not yet painted
  const left = target.offsetLeft;
  const w    = target.offsetWidth;
  // Set width directly (CSS transition handles the animation) and
  // use translate3d for the horizontal position (compositor-friendly GPU execution).
  blob.style.width     = w + 'px';
  blob.style.transform = `translate3d(${left}px, 0, 0)`;
}

// Navigation Tab Switching
function switchTab(tabId) {
  state.currentTab = tabId;

  let activeSeg = null;
  // Update capsule segments
  el.capsuleSegments.forEach(seg => {
    if (seg.dataset.tab === tabId) {
      seg.classList.add('active');
      activeSeg = seg;
    } else {
      seg.classList.remove('active');
    }
  });

  if (activeSeg) {
    updateCapsuleBlob(activeSeg);
  }

  // Toggle views with optical flow smooth entrance
  Object.keys(el.views).forEach(key => {
    const viewEl = el.views[key];
    if (!viewEl) return;
    if (key === tabId) {
      viewEl.classList.remove('hidden');
      viewEl.classList.remove('view-pane-active');
      // trigger reflow so re-adding the animation restarts cleanly
      void viewEl.offsetWidth;
      viewEl.classList.add('view-pane-active');
    } else {
      viewEl.classList.add('hidden');
      viewEl.classList.remove('view-pane-active');
    }
  });

  // Load view data
  if (tabId === 'trends') fetchHistory(state.selectedDays);
  if (tabId === 'habits') fetchInsights();
  if (tabId === 'diagnostics') fetchProbe();
}

// Action Handlers
async function handleProbe() {
  if (state.isRefreshing) return;
  state.isRefreshing = true;
  el.probeIcon?.classList.add('animate-spin');

  try {
    await fetch('/api/reconnect', { method: 'POST' }).catch(() => {});
    await fetchStatus();
    await fetchSnapshot();
    await fetchDeviceStatus();
    if (state.currentTab === 'trends') await fetchHistory(state.selectedDays);
    if (state.currentTab === 'habits') await fetchInsights();
    if (state.currentTab === 'diagnostics') await fetchProbe();
  } finally {
    setTimeout(() => {
      el.probeIcon?.classList.remove('animate-spin');
      state.isRefreshing = false;
    }, 400);
  }
}

async function handleSeedToggle() {
  if (AppState.mode === 'seeded') {
    await handleUnseed();
  } else {
    await handleSeed();
  }
}

async function handleUnseed() {
  try {
    if (components.demoToggle) {
      components.demoToggle.setDisabled(true, 'Clearing demo data...');
    }
    if (el.seedBtn) {
      el.seedBtn.disabled = true;
      const span = el.seedBtn.querySelector('span');
      if (span) updateTextIfChanged(span, 'Unseeding...');
      else updateTextIfChanged(el.seedBtn, 'Unseeding...');
    }

    const res = await fetch('/api/unseed-mock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serial: 'mock-phone-2a' }),
    });

    if (res.ok) {
      AppState.clearSeededMode();
      await fetchStatus();
      await fetchSnapshot();
      await fetchHistory(state.selectedDays);
      await fetchInsights();
      await fetchAppDrain();
    } else {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to clear demo data');
    }
  } catch (err) {
    console.error('Failed to clear demo data:', err);
    if (components.demoToggle) {
      components.demoToggle.setChecked(true, { silent: true });
    }
    alert('Failed to clear demo data: ' + err.message);
  } finally {
    if (components.demoToggle) {
      components.demoToggle.setDisabled(false);
    }
    if (el.seedBtn) {
      el.seedBtn.disabled = false;
    }
    updateSeedBtnState(AppState.mode === 'seeded');
  }
}

async function handleSeed() {
  try {
    if (components.demoToggle) {
      components.demoToggle.setDisabled(true, 'Seeding demo data...');
    }
    if (el.seedBtn) {
      el.seedBtn.disabled = true;
      const span = el.seedBtn.querySelector('span');
      if (span) updateTextIfChanged(span, 'Seeding...');
      else updateTextIfChanged(el.seedBtn, 'Seeding...');
    }

    const res = await fetch('/api/seed-mock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ days: 30, serial: 'mock-phone-2a', model: 'Nothing Phone 2a' }),
    });

    if (res.ok) {
      state.selectedSerial = 'mock-phone-2a';
      const snapRes = await fetch('/api/snapshot?serial=mock-phone-2a&include_demo=true');
      const snapData = snapRes.ok ? await snapRes.json() : null;
      await fetchHistory(state.selectedDays, 'mock-phone-2a');
      await fetchInsights('mock-phone-2a');
      AppState.setSeededMode('mock-phone-2a', snapData);
    } else {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to seed demo data');
    }
  } catch (err) {
    console.error('Failed to seed demo data:', err);
    if (components.demoToggle) {
      components.demoToggle.setChecked(false, { silent: true });
    }
    alert('Failed to seed demo data: ' + err.message);
  } finally {
    if (components.demoToggle) {
      components.demoToggle.setDisabled(false);
    }
    if (el.seedBtn) {
      el.seedBtn.disabled = false;
    }
    updateSeedBtnState(AppState.mode === 'seeded');
  }
}

// Disconnected Polish Helper Functions (Fix 3 & Fix 5)

function getFormattedLastReadingTime() {
  const ts = AppState.lastTelemetryTimestamp || state.snapshot?.timestamp;
  if (!ts) return 'Recently';
  return formatSyncedTimestamp(ts);
}

function updateLiveTelemetryPausedUI() {
  if (!AppState.connected) return;
  const timeStr = getFormattedLastReadingTime();

  // 1. Hero Eyebrow
  if (el.heroEyebrow) {
    if (AppState.liveTelemetryPaused) {
      el.heroEyebrow.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-amber-400"></span>Paused · Last reading: ${timeStr}`;
      el.heroEyebrow.className = 'eyebrow-label text-amber-300 flex items-center gap-2';
    } else {
      el.heroEyebrow.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse"></span>Live Biometric Evaluation';
      el.heroEyebrow.className = 'eyebrow-label text-indigo-400 flex items-center gap-2';
    }
  }

  // 2. Chart Last Synced Label
  if (el.chartLastSyncedLabel) {
    if (AppState.liveTelemetryPaused) {
      el.chartLastSyncedLabel.textContent = `Paused · Last reading: ${timeStr}`;
      el.chartLastSyncedLabel.classList.remove('hidden');
    } else {
      el.chartLastSyncedLabel.textContent = '';
      el.chartLastSyncedLabel.classList.add('hidden');
    }
  }

  // 3. Live Device Feed Bar Preview & Badge
  const previewEl = el.statusFeedLatestPreview || document.getElementById('status-feed-latest-preview');
  const badgeEl = el.statusFeedCountBadge || document.getElementById('status-feed-count-badge');
  const pingEl = el.statusFeedPing || document.getElementById('status-feed-ping');

  if (AppState.liveTelemetryPaused) {
    if (previewEl) {
      previewEl.textContent = `Telemetry paused · Last reading: ${timeStr}`;
      previewEl.removeAttribute('title');
      previewEl.setAttribute('data-tooltip', `Live polling paused. Last reading received at ${timeStr}`);
    }
    if (badgeEl) {
      badgeEl.textContent = 'Paused';
      badgeEl.className = 'glass-chip glass-chip-amber text-amber-300';
    }
    if (pingEl) pingEl.classList.add('hidden');
  } else {
    renderDeviceStatus();
  }
}

function formatSyncedTimestamp(isoString) {
  try {
    const d = parseUtcDate(isoString);
    if (!d || isNaN(d.getTime())) return 'Recently';
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    const timeStr = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
    if (isToday) {
      return `Today, ${timeStr}`;
    }
    const month = d.toLocaleDateString([], { month: 'short' });
    const day = d.getDate();
    return `${month} ${day}, ${timeStr}`;
  } catch {
    return 'Recently';
  }
}

function updateChartLastSyncedLabel() {
  const labelEl = el.chartLastSyncedLabel || document.getElementById('chart-last-synced-label');
  if (!labelEl) return;

  const isConn = state.snapshot?.connected || state.systemStatus?.connected_devices?.some(d => d.state === 'device');
  if (isConn) {
    labelEl.classList.add('hidden');
    labelEl.textContent = '';
    return;
  }

  let latestTimestamp = null;
  if (state.history && state.history.length > 0) {
    for (const r of state.history) {
      if (r.timestamp) {
        if (!latestTimestamp || (parseUtcDate(r.timestamp) > parseUtcDate(latestTimestamp))) {
          latestTimestamp = r.timestamp;
        }
      }
    }
  } else if (state.snapshot && state.snapshot.timestamp) {
    latestTimestamp = state.snapshot.timestamp;
  }

  if (latestTimestamp) {
    const formatted = formatSyncedTimestamp(latestTimestamp);
    labelEl.textContent = `Last synced: ${formatted}`;
    labelEl.classList.remove('hidden');
  } else {
    labelEl.textContent = 'Last synced: Standby';
    labelEl.classList.remove('hidden');
  }
}

function formatRelativeTime(isoString) {
  if (!isoString) return null;
  const d = parseUtcDate(isoString);
  if (!d || isNaN(d.getTime())) return null;
  const now = new Date();
  const diffSec = Math.floor((now - d) / 1000);
  if (diffSec < 0 || isNaN(diffSec)) return 'just now';
  if (diffSec < 45) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
  const diffDays = Math.floor(diffMin / 1440);
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

async function fetchRecentDevices() {
  const now = Date.now();
  if (now - (state.lastDevicesFetchTime || 0) < 8000 && state.cachedDevices && state.cachedDevices.length > 0) {
    return state.cachedDevices;
  }
  try {
    const res = await fetch('/api/devices');
    if (res.ok) {
      state.cachedDevices = await res.json();
      state.lastDevicesFetchTime = now;
      return state.cachedDevices;
    }
  } catch (err) {
    console.warn('Failed to fetch devices for last-seen context:', err);
  }
  return state.cachedDevices || [];
}

async function updateLastSeenDeviceLabel() {
  const labelEl = el.connLastSeenLabel || document.getElementById('conn-last-seen-label');
  if (!labelEl) return;

  const isConn = state.snapshot?.connected || state.systemStatus?.connected_devices?.some(d => d.state === 'device');
  if (isConn) {
    labelEl.classList.add('hidden');
    labelEl.textContent = '';
    return;
  }

  const devices = await fetchRecentDevices();
  if (!devices || devices.length === 0) {
    labelEl.classList.add('hidden');
    return;
  }

  const valid = devices.filter(d => d.last_seen);
  if (valid.length === 0) {
    labelEl.classList.add('hidden');
    return;
  }

  valid.sort((a, b) => parseUtcDate(b.last_seen) - parseUtcDate(a.last_seen));
  const mostRecent = valid[0];
  const relTime = formatRelativeTime(mostRecent.last_seen);
  if (!relTime) {
    labelEl.classList.add('hidden');
    return;
  }

  if (devices.length > 1) {
    const model = mostRecent.model ? mostRecent.model.replace(/_/g, ' ') : '';
    const serial = mostRecent.serial && mostRecent.serial !== 'default' ? mostRecent.serial : '';
    const serialShort = serial.length > 8 ? serial.slice(0, 8) : serial;
    let label = model;
    if (model && serialShort && !model.toLowerCase().includes(serialShort.toLowerCase())) {
      label = `${serialShort} (${model})`;
    } else if (!model) {
      label = serialShort || 'Device';
    }
    labelEl.textContent = `${label} · last seen ${relTime}`;
  } else {
    labelEl.textContent = `Last seen ${relTime}`;
  }
  labelEl.classList.remove('hidden');
}

// ==========================================
// APP BATTERY DRAIN ATTRIBUTION SUB-SYSTEM
// Extracted to /static/js/app-drain.js
// Provides fetchAppDrain, renderAppDrain, updateAppDrainWindowPills,
// subscribeTopBatteryDrainers, and initAppDrainListeners
// ==========================================

// Aurora Background Subsystem extracted to /static/js/aurora.js:
// Provides initAuroraBg (manages 'is-paused' on visibility/blur and 'is-scrolling' on scroll)

// Boot
function init() {
  if (typeof IonPreloader !== 'undefined' && IonPreloader.step) {
    IonPreloader.step('Starting local engine', 0.25);
  }

  // Initialize approved Aurora background
  initAuroraBg();

  // Capsule Nav clicks & sliding blob
  el.capsuleSegments.forEach(seg => {
    seg.addEventListener('click', () => switchTab(seg.dataset.tab));
  });
  const initialActive = document.querySelector('.capsule-segment.active');
  if (initialActive) {
    requestAnimationFrame(() => updateCapsuleBlob(initialActive));
  }

  // Re-measure on window resize (also covers zoom/DPI changes and range dial)
  window.addEventListener('resize', () => {
    const curr = document.querySelector('.capsule-segment.active');
    if (curr) updateCapsuleBlob(curr);
    const health = AppState.snapshot?.health_pct ?? state.snapshot?.health_pct;
    if (health !== null && health !== undefined) {
      setRangeDialPosition(health);
    } else {
      setRangeDialPosition(null);
    }
  });

  // Paced render pass flush on scroll
  let scrollPauseTimer = null;
  let scrollTicking = false;
  window.addEventListener('scroll', () => {
    lastScrollTimestamp = performance.now();
    if (!scrollTicking) {
      scrollTicking = true;
      requestAnimationFrame(() => {
        scrollTicking = false;
      });
      clearTimeout(scrollPauseTimer);
      scrollPauseTimer = setTimeout(() => {
        if (pendingScrollFlush) {
          pendingScrollFlush = false;
          runIdle(() => flushPendingRenders());
        }
      }, 120);
    }
  }, { passive: true });

  // Re-measure after fonts load (web fonts can change text width)
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => {
      const curr = document.querySelector('.capsule-segment.active');
      if (curr) updateCapsuleBlob(curr);
      if (state.chartInstance) {
        state.chartInstance.update('none');
      }
    });
  }

  // ResizeObserver on the nav pill: catches DPI/zoom changes missed by window resize
  const navPill = document.querySelector('.capsule-nav');
  if (navPill && typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => {
      const curr = document.querySelector('.capsule-segment.active');
      if (curr) updateCapsuleBlob(curr);
    }).observe(navPill);
  }

  // Action Buttons
  el.probeBtn?.addEventListener('click', handleProbe);
  document.getElementById('reconnect-btn')?.addEventListener('click', handleProbe);
  document.getElementById('rescan-adb-btn')?.addEventListener('click', handleProbe);
  el.seedBtn?.addEventListener('click', handleSeedToggle);

  // Standby connection guide accordion
  const guideToggle = document.getElementById('toggle-connection-guide-btn');
  const guideSteps = document.getElementById('connection-guide-steps');
  const guideChevron = document.getElementById('guide-chevron');
  if (guideToggle && guideSteps) {
    guideToggle.addEventListener('click', () => {
      const isHidden = guideSteps.classList.contains('hidden');
      guideSteps.classList.toggle('hidden', !isHidden);
      guideChevron?.classList.toggle('rotate-180', isHidden);
      guideToggle.setAttribute('aria-expanded', String(isHidden));
    });
  }

  // Calibration & Prediction actions
  el.simCapToggle?.addEventListener('change', (e) => {
    handleSimCapToggle(e);
  });
  // Initialize Active Coulomb Calibration Listeners (from /static/js/calibration.js)
  initCalibrationListeners();

  // Time Filter Buttons
  document.querySelectorAll('.time-filter-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.time-filter-pill').forEach(b => {
        b.classList.remove('active', 'bg-white', 'text-black', 'shadow');
        b.classList.add('text-zinc-400');
      });
      btn.classList.add('active', 'bg-white', 'text-black', 'shadow');
      btn.classList.remove('text-zinc-400');
      const d = parseInt(btn.dataset.days);
      state.selectedDays = d;
      fetchHistory(d);
    });
  });

  // Chart Metric Toggle Buttons (Health % / Temp)
  document.querySelectorAll('.chart-metric-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!state.chartInstance) return;
      const idx = parseInt(btn.dataset.dataset, 10);
      const isVisible = state.chartInstance.isDatasetVisible(idx);
      state.chartInstance.setDatasetVisibility(idx, !isVisible);
      state.chartInstance.update();
      btn.classList.toggle('active', !isVisible);
    });
  });

  // Initialize App Battery Drain Listeners (from /static/js/app-drain.js)
  initAppDrainListeners();

  // Initialize Sparkle Toggles
  initSparkleToggles();

  // Register critical lightweight subscribers (state, nav, status)
  AppState.subscribe(subscribeTopBar);
  AppState.subscribe(subscribeGuidanceBanner);
  AppState.subscribe(subscribeHeroHeadline);

  // Yield utility for chunking tasks
  const yieldToMain = () => {
    if (typeof scheduler !== 'undefined' && scheduler.yield) {
      return scheduler.yield();
    }
    return new Promise(resolve => setTimeout(resolve, 0));
  };

  // Initial queries with progress telemetry
  async function runInitialBootSequence() {
    try {
      const stageDelay = (ms) => new Promise(r => setTimeout(r, ms));

      // Let initial "Starting local engine" stage render cleanly
      await stageDelay(1200);

      // Hydrate secondary cards and chart observer in yielded chunks
      AppState.subscribe(masterDashboardSubscriber);
      await yieldToMain();
      AppState.subscribe(subscribeTopBatteryDrainers);
      await yieldToMain();
      initChartObserver();
      await yieldToMain();

      if (typeof IonPreloader !== 'undefined' && IonPreloader.step) {
        IonPreloader.step('Opening history database', 0.6);
      }
      await Promise.allSettled([
        fetchHistory(state.selectedDays),
        fetchInsights(),
        fetchAppDrain(),
        stageDelay(1500)
      ]);

      await yieldToMain();

      if (typeof IonPreloader !== 'undefined' && IonPreloader.step) {
        IonPreloader.step('Checking ADB', 0.85);
      }
      await Promise.allSettled([
        fetchStatus(),
        fetchSnapshot(),
        fetchDeviceStatus(),
        stageDelay(1500)
      ]);

      await yieldToMain();
    } catch (err) {
      console.warn('Initial boot sequence warning:', err);
    } finally {
      if (typeof IonPreloader !== 'undefined' && IonPreloader.finish) {
        IonPreloader.finish();
      }
    }
  }

  runInitialBootSequence();

  // Test Verification URL query parameter hook
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get('seed') === '1') {
      setTimeout(async () => {
        await handleSeed();
        const sortParam = params.get('sort');
        if (sortParam) {
          const btn = document.querySelector(`.app-drain-sort-pill[data-sort="${sortParam}"]`);
          if (btn) btn.click();
        }
        const windowParam = params.get('window');
        if (windowParam) {
          const normWindow = (windowParam === '168' ? '7d' : (windowParam === '0' ? 'all' : windowParam)).toLowerCase();
          const btn = document.querySelector(`.app-drain-window-pill[data-window="${normWindow}"]`);
          if (btn) btn.click();
          else updateAppDrainWindowPills(normWindow);
        }
        const daysParam = params.get('days');
        if (daysParam) {
          const btn = document.querySelector(`.time-filter-pill[data-days="${daysParam}"]`);
          if (btn) btn.click();
        }
      }, 700);
    }
  } catch (_) {}

  // Background Polling Lifecycle (Active vs Visibility-Throttled)
  function pollTick() {
    fetchStatus();

    if (AppState.connected && !AppState.liveTelemetryPaused) {
      fetchSnapshot();

      const isConn = state.systemStatus?.active_device_count > 0;
      const now = Date.now();
      if (isConn && (now - (state.lastHistoryLivePoll || 0) >= 10000)) {
        state.lastHistoryLivePoll = now;
        fetchHistory(state.selectedDays);
        fetchAppDrain();
      }
    }
  }

  function deviceStatusTick() {
    if (AppState.connected && !AppState.liveTelemetryPaused) {
      fetchDeviceStatus();
    }
  }

  function startActivePolling() {
    if (state.throttledPollTimer) {
      clearInterval(state.throttledPollTimer);
      state.throttledPollTimer = null;
    }
    // Prevent duplicate timers on repeated visibility/focus events
    if (state.pollTimer) return;

    // Immediate in-flight-safe catch-up refresh upon window restore
    fetchStatus();
    if (AppState.connected && !AppState.liveTelemetryPaused) {
      fetchSnapshot();
      fetchDeviceStatus();
    }

    state.pollTimer = setInterval(pollTick, 1000);

    if (!state.deviceStatusTimer) {
      state.deviceStatusTimer = setInterval(deviceStatusTick, 2500);
    }
  }

  function pauseActivePolling() {
    if (state.pollTimer) {
      clearInterval(state.pollTimer);
      state.pollTimer = null;
    }
    if (state.deviceStatusTimer) {
      clearInterval(state.deviceStatusTimer);
      state.deviceStatusTimer = null;
    }
    // While minimized or hidden, throttle connection-sensing to 5000ms and halt all high-frequency telemetry
    if (!state.throttledPollTimer) {
      state.throttledPollTimer = setInterval(() => {
        if (document.hidden) {
          fetchStatus();
        }
      }, 5000);
    }
  }

  // Visibility & Focus Listeners (Pauses heavy polling while minimized, immediately restores on focus)
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      pauseActivePolling();
    } else {
      startActivePolling();
    }
  });

  window.addEventListener('focus', () => {
    if (!document.hidden) {
      startActivePolling();
    }
  });

  // Initialize Toast Notification Close Button
  const toastCloseBtn = el.toastCloseBtn || document.getElementById('toast-close-btn');
  if (toastCloseBtn) {
    toastCloseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      dismissDeviceConnectedToast();
    });
  }

  // Live Device Status Feed Collapsible Toggle & Restore
  try {
    const savedExpanded = sessionStorage.getItem('ion_status_feed_expanded');
    if (savedExpanded === 'true') {
      toggleDeviceStatusFeed(true);
    }
  } catch (_) {}

  const statusToggle = el.deviceStatusToggle || document.getElementById('device-status-toggle');
  if (statusToggle) {
    statusToggle.addEventListener('click', (e) => {
      if (e.target.closest('#live-telemetry-container')) return;
      toggleDeviceStatusFeed();
    });
    statusToggle.addEventListener('keydown', (e) => {
      if (e.target.closest('#live-telemetry-container')) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleDeviceStatusFeed();
      }
    });
  }

  // Engage initial active polling loop
  startActivePolling();

  // Initialize Global Boundary-Aware Tooltip System
  initSharedTooltips();

  // Cursor-Tracking Glow removed (Change B)
}

// initCursorTrackingGlow removed (Change B): all mousemove/pointermove listeners
// and --mouse-x/--mouse-y CSS variable writes deleted. No hover light remains.

function initSparkleToggles() {
  if (typeof createSparkleToggle !== 'function') {
    console.warn('createSparkleToggle helper not loaded.');
    return;
  }

  // 1. Live Telemetry Toggle in Live Device Feed bar
  const liveSlot = el.liveTelemetrySlot || document.getElementById('live-telemetry-slot');
  if (liveSlot && !components.liveToggle) {
    components.liveToggle = createSparkleToggle({
      id: 'toggle-live-telemetry',
      label: 'Live telemetry polling',
      checked: AppState.connected ? AppState.liveTelemetryEnabled : false,
      disabled: !AppState.connected,
      size: 'xs',
      onChange: (checked) => {
        AppState.setLiveTelemetry(checked);
      }
    });
    liveSlot.appendChild(components.liveToggle.element);
    if (!AppState.connected) {
      components.liveToggle.setChecked(false, { silent: true });
      components.liveToggle.setDisabled(true, 'Connect a device to use live telemetry');
    }
  }

  // 2. Demo Data Toggle in Header Status Cluster
  const demoSlot = el.demoDataSlot || document.getElementById('demo-data-slot');
  if (demoSlot && !components.demoToggle) {
    components.demoToggle = createSparkleToggle({
      id: 'toggle-demo-data',
      label: 'Demo data simulation',
      checked: false, // Always starts OFF
      disabled: false,
      size: 'sm',
      onChange: async (checked) => {
        if (checked) {
          await handleSeed();
        } else {
          await handleUnseed();
        }
      }
    });
    demoSlot.appendChild(components.demoToggle.element);
  }
}


document.addEventListener('DOMContentLoaded', init);
