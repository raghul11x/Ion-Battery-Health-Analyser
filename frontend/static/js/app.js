/**
 * EURA iOS Health/Wellness Style App Logic (Design Doc v2)
 * Manages live ADB polling, EURA dynamic hero gradient, range dial, and Heart Report chart.
 */

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
const AppState = {
  connected: false,
  mode: 'idle', // 'idle' | 'connected' | 'seeded'
  device: null,
  snapshot: null,
  systemStatus: null,
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
      });
    } catch (e) {
      console.error('AppState listener error on mount:', e);
    }
    return () => {
      this._listeners = this._listeners.filter(l => l !== listener);
    };
  },

  notify() {
    const payload = {
      connected: this.connected,
      mode: this.mode,
      device: this.device,
      snapshot: this.snapshot,
      systemStatus: this.systemStatus,
    };
    for (const listener of this._listeners) {
      try {
        listener(payload);
      } catch (err) {
        console.error('AppState subscriber error:', err);
      }
    }
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

      if (deviceChanged) {
        this.notify();
        fetchSnapshot(serial);
        fetchHistory(state.selectedDays, serial);
        fetchInsights(serial);
      }
    } else {
      // If currently displaying seeded demo evaluation, do not let an empty poll kick out to idle
      if (this.mode === 'seeded') {
        return;
      }
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

      if (hadSession) {
        this.notify();
      }
    }
  },

  setSnapshot(snapshot) {
    if (!this.connected && this.mode !== 'seeded') {
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
    this.connected = false;
    this.mode = 'seeded';
    this.device = { serial: mockSerial, model: mockSnapshot?.device_model || 'Nothing Phone 2a' };
    this.snapshot = mockSnapshot;
    state.selectedSerial = mockSerial;
    state.snapshot = mockSnapshot;
    this.notify();
  }
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

// Utilities
function formatCapacity(uah) {
  if (uah === null || uah === undefined || isNaN(uah)) return '—';
  const mah = Math.round(uah / 1000);
  return `${mah.toLocaleString()} mAh`;
}

function formatDate(isoStr) {
  if (!isoStr) return '—';
  try {
    const d = new Date(isoStr);
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return isoStr;
  }
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// API Calls
async function fetchStatus() {
  try {
    const res = await fetch('/api/status');
    if (res.ok) {
      state.systemStatus = await res.json();
      updateConnectionStatus();
    }
  } catch (err) {
    console.warn('Failed to fetch status:', err);
  }
}

async function fetchSnapshot(serial = null) {
  try {
    // Only query a specific serial if connected or in seeded mode; otherwise fetch clean idle snapshot
    const targetSerial = (AppState.connected || AppState.mode === 'seeded') ? (serial || state.selectedSerial) : null;
    const url = targetSerial ? `/api/snapshot?serial=${encodeURIComponent(targetSerial)}` : '/api/snapshot';
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      if (AppState.connected || AppState.mode === 'seeded') {
        AppState.setSnapshot(data);
      } else {
        AppState.setSnapshot(null);
      }
    }
  } catch (err) {
    console.warn('Failed to fetch snapshot:', err);
  }
}

async function fetchHistory(days = 30, serial = null) {
  try {
    const targetSerial = serial || state.selectedSerial;
    const serialParam = targetSerial ? `&serial=${encodeURIComponent(targetSerial)}` : '';
    const res = await fetch(`/api/history?days=${days}&limit=500${serialParam}`);
    if (res.ok) {
      const data = await res.json();
      state.history = data.readings || [];
      renderHistoryAndChart();
    }
  } catch (err) {
    console.warn('Failed to fetch history:', err);
  }
}

async function fetchInsights(serial = null) {
  try {
    const targetSerial = serial || state.selectedSerial;
    const serialParam = targetSerial ? `?serial=${encodeURIComponent(targetSerial)}` : '';
    const res = await fetch(`/api/insights${serialParam}`);
    if (res.ok) {
      state.insights = await res.json();
      renderInsights();
    }
  } catch (err) {
    console.warn('Failed to fetch insights:', err);
  }
}

async function fetchProbe() {
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
  }
}

async function fetchDeviceStatus() {
  try {
    const res = await fetch('/api/device-status?limit=25');
    if (res.ok) {
      const data = await res.json();
      if (AppState.connected) {
        state.deviceStatusEvents = data.events || [];
      } else {
        state.deviceStatusEvents = [];
      }
      renderDeviceStatus();
    }
  } catch (err) {
    console.warn('Failed to fetch device status feed:', err);
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

  // Reset progress bar drain animation
  if (progressEl) {
    progressEl.style.animation = 'none';
    void progressEl.offsetWidth; // Force reflow to retrigger CSS animation
    progressEl.style.animation = '';
  }

  // Ensure visible with entrance animation
  if (!toastEl.classList.contains('toast-visible')) {
    void toastEl.offsetWidth;
    toastEl.classList.add('toast-visible');
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

  if (isConnected) {
    headlineEl.textContent = 'Genuine Battery Degradation.';
    if (subtextEl) {
      subtextEl.textContent = 'Real capacity loss computed directly from OEM hardware full-charge counters vs factory design specifications.';
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
    if (el.connDot) el.connDot.className = 'w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse';
    if (el.connStatusLabel) el.connStatusLabel.textContent = profilingMsg;
    const name = activeDev?.model ? activeDev.model.replace(/_/g, ' ') : (state.snapshot?.device_model || 'Android Device');
    if (el.connDeviceLabel) {
      el.connDeviceLabel.textContent = `· ${name}`;
      el.connDeviceLabel.classList.remove('hidden');
    }
    return;
  }

  if (connected && activeDev) {
    if (el.connDot) el.connDot.className = 'dot-live-green';
    const name = activeDev.model ? activeDev.model.replace(/_/g, ' ') : (state.snapshot?.device_model || 'Android Device');
    if (el.connStatusLabel) el.connStatusLabel.textContent = 'Connected';
    if (el.connDeviceLabel) {
      el.connDeviceLabel.textContent = `· ${name}`;
      el.connDeviceLabel.classList.remove('hidden');
    }
    if (el.connLastSeenLabel) {
      el.connLastSeenLabel.classList.add('hidden');
      el.connLastSeenLabel.textContent = '';
    }
  } else if (mode === 'seeded') {
    if (el.connDot) el.connDot.className = 'w-2.5 h-2.5 rounded-full bg-emerald-400';
    if (el.connStatusLabel) el.connStatusLabel.textContent = 'Seeded Demo';
    if (el.connDeviceLabel) {
      el.connDeviceLabel.textContent = `· Nothing Phone 2a`;
      el.connDeviceLabel.classList.remove('hidden');
    }
    if (el.connLastSeenLabel) {
      el.connLastSeenLabel.classList.add('hidden');
      el.connLastSeenLabel.textContent = '';
    }
  } else if (unauthDev || state.snapshot?.health_status === 'unauthorized' || state.snapshot?.connection_state === 'unauthorized') {
    if (el.connDot) el.connDot.className = 'w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse';
    if (el.connStatusLabel) el.connStatusLabel.textContent = 'Unauthorized';
    const sName = unauthDev?.serial ? `(${unauthDev.serial.slice(0, 8)}...)` : '';
    if (el.connDeviceLabel) {
      el.connDeviceLabel.textContent = `· Phone detected ${sName}`;
      el.connDeviceLabel.classList.remove('hidden');
    }
  } else if (offlineDev || state.snapshot?.health_status === 'offline' || state.snapshot?.connection_state === 'offline') {
    if (el.connDot) el.connDot.className = 'w-2.5 h-2.5 rounded-full bg-amber-400';
    if (el.connStatusLabel) el.connStatusLabel.textContent = 'Offline';
    const sName = offlineDev?.serial ? `(${offlineDev.serial.slice(0, 8)}...)` : '';
    if (el.connDeviceLabel) {
      el.connDeviceLabel.textContent = `· Phone offline ${sName}`;
      el.connDeviceLabel.classList.remove('hidden');
    }
  } else {
    if (el.connDot) el.connDot.className = 'dot-idle-gray';
    if (el.connStatusLabel) el.connStatusLabel.textContent = 'Disconnected';
    if (el.connDeviceLabel) el.connDeviceLabel.classList.add('hidden');
    updateLastSeenDeviceLabel();
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
  const events = isConnected ? (state.deviceStatusEvents || []) : [];

  panel.classList.remove('hidden');

  const previewEl = el.statusFeedLatestPreview || document.getElementById('status-feed-latest-preview');
  const badgeEl = el.statusFeedCountBadge || document.getElementById('status-feed-count-badge');
  const listEl = el.deviceStatusList || document.getElementById('device-status-list');
  const pingEl = el.statusFeedPing || document.getElementById('status-feed-ping');

  if (isConnected && events.length > 0) {
    const latest = events[0];
    if (previewEl) {
      previewEl.textContent = latest.message;
      previewEl.removeAttribute('title');
      previewEl.setAttribute('data-tooltip', `${latest.time_display} · ${latest.message}`);
    }
    if (badgeEl) {
      badgeEl.textContent = `${events.length} event${events.length === 1 ? '' : 's'}`;
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
      previewEl.textContent = 'Seeded demo session active (mock-phone-2a)';
      previewEl.removeAttribute('data-tooltip');
    }
    if (badgeEl) {
      badgeEl.textContent = 'Seeded';
    }
    if (pingEl) pingEl.classList.add('hidden');
    if (listEl) {
      listEl.innerHTML = '<div class="text-zinc-500 py-2 italic text-center">Seeded demo session active. Connect phone for live telemetry.</div>';
    }
  } else {
    // Neutral Idle / Standby mode
    if (previewEl) {
      previewEl.textContent = 'No active session — connect device to view live telemetry';
      previewEl.removeAttribute('data-tooltip');
    }
    if (badgeEl) {
      badgeEl.textContent = 'Standby';
    }
    if (pingEl) pingEl.classList.add('hidden');
    if (listEl) {
      listEl.innerHTML = '<div class="text-zinc-500 py-2 italic text-center">No active device session. Plug in to start logging events.</div>';
    }
  }
}

function renderIdleState() {
  // 1. Eyebrow
  if (el.heroEyebrow) {
    el.heroEyebrow.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-zinc-500"></span>Standby Mode';
    el.heroEyebrow.className = 'eyebrow-label text-zinc-400 flex items-center gap-2';
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

  if (el.heroStatusPill) el.heroStatusPill.textContent = 'Awaiting Device';
  if (el.heroStatusHeading) el.heroStatusHeading.textContent = 'No Device Connected';
  if (el.heroStatusSubtext) el.heroStatusSubtext.textContent = 'Connect phone over USB-C to compute real chemical health.';
  if (el.rangeDialMarker) el.rangeDialMarker.style.left = '0%';
  if (el.heroMethodBadge) el.heroMethodBadge.textContent = 'Standby';

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
    el.simCapToggle.classList.add('opacity-40', 'cursor-not-allowed');
    el.simCapToggle.setAttribute('data-tooltip', 'Connect phone to run longevity forecast');
  }

  // 7. Coulomb Calibration Card (Reset on idle)
  if (state.calibrationPollTimer) {
    clearInterval(state.calibrationPollTimer);
    state.calibrationPollTimer = null;
  }
  if (el.calStatusBadge) {
    el.calStatusBadge.textContent = 'Idle';
    el.calStatusBadge.className = 'px-3 py-0.5 rounded-full text-xs font-semibold bg-zinc-800 text-zinc-400 border border-white/10 font-mono';
  }
  if (el.calCurrentText) el.calCurrentText.textContent = '0 mA';
  if (el.calAccumulatedText) el.calAccumulatedText.textContent = '0 mAh';
  if (el.calVerdictBox) el.calVerdictBox.classList.add('hidden');
  if (el.calExtrapolatedText) el.calExtrapolatedText.textContent = '— mAh';
  if (el.calHealthPctText) el.calHealthPctText.textContent = '—% SoH';
  if (el.calComparisonSubtext) el.calComparisonSubtext.textContent = 'Validated against OEM design specification.';
  if (el.calStopBtn) el.calStopBtn.classList.add('hidden');
  if (el.calStartBtn) {
    el.calStartBtn.disabled = true;
    el.calStartBtn.setAttribute('data-tooltip', 'Connect phone to calibrate');
  }
  if (el.calSimBtn) el.calSimBtn.disabled = false;

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

function renderSnapshot() {
  if (!AppState.connected && AppState.mode !== 'seeded') {
    renderIdleState();
    return;
  }

  const s = AppState.snapshot || state.snapshot;
  if (!s || (s.health_pct === null && s.health_pct === undefined)) {
    renderIdleState();
    return;
  }

  // Active connected phone vs seeded/cached evaluation
  if (el.heroEyebrow) {
    if (AppState.connected) {
      el.heroEyebrow.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse"></span>Live Biometric Evaluation';
      el.heroEyebrow.className = 'eyebrow-label text-indigo-400 flex items-center gap-2';
    } else {
      el.heroEyebrow.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>Historical / Seeded Evaluation';
      el.heroEyebrow.className = 'eyebrow-label text-emerald-300 flex items-center gap-2';
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
      el.chartLastSyncedLabel.classList.add('hidden');
      el.chartLastSyncedLabel.textContent = '';
    }
    if (el.connLastSeenLabel) {
      el.connLastSeenLabel.classList.add('hidden');
      el.connLastSeenLabel.textContent = '';
    }
  } else {
    // Seeded / historical evaluation (not connected)
    updateHeroHeadline(false);
    if (el.chartCanvasContainer) {
      el.chartCanvasContainer.classList.remove('chart-stale-dimmed');
    }
    if (el.chartLastSyncedLabel) {
      el.chartLastSyncedLabel.classList.remove('hidden');
      el.chartLastSyncedLabel.textContent = 'Seeded Demo Preview';
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
      toastNameEl.textContent = formatConnectedDeviceSubtitle(activeDev);
    }
  }

  const health = s.health_pct;

  // 1. HERO CARD (EURA Bio-Age Style)
  el.heroCard.classList.remove('hero-gradient-healthy', 'hero-gradient-fair', 'hero-gradient-poor', 'hero-gradient-unknown');

  // OEM SoH Badge and Divergence Banner
  const oemBadge = document.getElementById('hero-oem-soh-badge');
  if (oemBadge) {
    if (s.oem_reported_soh !== null && s.oem_reported_soh !== undefined) {
      oemBadge.textContent = `OEM SoH: ${Math.round(s.oem_reported_soh)}%`;
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
        divText.textContent = `Notice: OEM reported SoH (${s.oem_reported_soh}%) diverges from calculated health (${s.health_pct}%) by >10%. Both metrics are presented independently.`;
      }
      divBanner.classList.remove('hidden');
    } else {
      divBanner.classList.add('hidden');
    }
  }

  if (s.connected && (s.health_status === 'insufficient_data' || health === null || health === undefined)) {
    el.heroCard.classList.add('hero-gradient-unknown');
    el.heroHealthNumber.textContent = '--';
    el.heroStatusPill.textContent = 'Gathering Data';
    el.heroStatusHeading.textContent = 'Insufficient Data to Compute Health';
    el.heroStatusSubtext.textContent = "Cycle count isn't exposed by this device's firmware — building an estimate from usage history, check back in a few days.";
    el.rangeDialMarker.style.left = '0%';
    const days = s.history_days !== undefined ? `${s.history_days}d history` : 'Gathering';
    el.heroMethodBadge.textContent = `Gathering Data · ${days}`;
  } else if (health === null || health === undefined) {
    renderIdleState();
    el.heroMethodBadge.textContent = 'Offline';
  } else {
    const displayVal = Math.min(100, Math.round(health));
    el.heroHealthNumber.textContent = displayVal;

    // Range Dial position (clamped 2% to 98% for clean pin alignment)
    const clampedPos = Math.min(98, Math.max(2, displayVal));
    el.rangeDialMarker.style.left = `${clampedPos}%`;

    // Dynamic Gradient & Evaluation
    if (health >= 85) {
      el.heroCard.classList.add('hero-gradient-healthy');
      el.heroStatusPill.textContent = 'Steady & Healthy';
      el.heroStatusHeading.textContent = 'Optimal Retention';
      el.heroStatusSubtext.textContent = s.is_static_register
        ? `Retaining ~${formatCapacity(s.effective_capacity_uah)} · ${s.cycle_count || 0} cycles with optimal retention.`
        : `Retaining ${displayVal}% of factory capacity · Outstanding chemical stability.`;
    } else if (health >= 70) {
      el.heroCard.classList.add('hero-gradient-fair');
      el.heroStatusPill.textContent = 'Fair Condition';
      el.heroStatusHeading.textContent = 'Moderate Capacity Fade';
      el.heroStatusSubtext.textContent = s.is_static_register
        ? `Retaining ~${formatCapacity(s.effective_capacity_uah)} · ${s.cycle_count || 0} cycles with calendar wear.`
        : `Retaining ${displayVal}% of factory capacity · Normal wear for current cycle progression.`;
    } else {
      el.heroCard.classList.add('hero-gradient-poor');
      el.heroStatusPill.textContent = 'Needs Care';
      el.heroStatusHeading.textContent = 'Significant Degradation';
      el.heroStatusSubtext.textContent = s.is_static_register
        ? `Retaining ~${formatCapacity(s.effective_capacity_uah)} · High cumulative cycle & calendar wear.`
        : `Retaining ${displayVal}% of factory capacity · High cell impedance detected.`;
    }

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
    el.heroMethodBadge.textContent = methodText;
  }

  // 2. THREE-STAT ROW (Heart Report)
  // Temp
  if (s.temperature_c !== null && s.temperature_c !== undefined) {
    el.statTemp.textContent = `${s.temperature_c}°C`;
    const tb = s.temperature_band || {};
    el.statTempLabel.textContent = tb.label || 'Optimal condition';
  } else {
    el.statTemp.textContent = '—';
    el.statTempLabel.textContent = 'No thermal reading';
  }

  // Voltage
  el.statVoltage.textContent = s.voltage_mv ? `${(s.voltage_mv / 1000).toFixed(2)} V` : '—';

  // Cycles
  const sublabel = document.getElementById('stat-cycles-sublabel');
  const hasCycles = s.cycle_count !== null && s.cycle_count !== undefined && s.cycle_count !== 'unavailable' && s.cycle_count_type !== 'unavailable';
  if (hasCycles) {
    const cycleType = s.cycle_count_type === 'estimated' ? ' (Estimated)' : ' (Hardware)';
    el.statCycles.textContent = `${s.cycle_count}`;
    if (sublabel) sublabel.textContent = `OEM cycle count${cycleType}`;
  } else {
    el.statCycles.textContent = 'Unavailable';
    if (sublabel) sublabel.textContent = s.connected ? 'No cycle data exposed' : 'OEM cycle count';
  }

  // 3. SECONDARY INDIGO & DARK CARDS
  // Level & Status
  el.snapLevelText.textContent = s.level_pct !== null && s.level_pct !== undefined ? `${s.level_pct}%` : '—';
  el.snapStatusBadge.textContent = s.status || 'Disconnected';
  if (s.status === 'Charging') {
    el.snapChargeSpeedText.textContent = s.voltage_mv >= 4200 ? 'Fast charging active (>4.2V)' : 'Standard USB charge';
  } else {
    el.snapChargeSpeedText.textContent = s.status === 'Full' ? 'Fully charged' : 'Running on battery';
  }
  el.snapLastSync.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  // Capacities
  const effectiveCap = s.effective_capacity_uah || s.charge_full_uah || s.charge_counter_uah;
  el.capFullText.textContent = formatCapacity(effectiveCap);
  el.capDesignText.textContent = formatCapacity(s.charge_full_design_uah);

  if (s.is_static_register || s.health_method === 'apple_standard_calibrated') {
    if (el.capFullSubtext) {
      el.capFullSubtext.textContent = `OEM Static Register: ${formatCapacity(s.charge_full_uah)}`;
      el.capFullSubtext.classList.remove('hidden');
    }
    if (el.capBadge) el.capBadge.textContent = 'Apple Standard SoH';
    if (el.capFooterNote) {
      el.capFooterNote.textContent = 'Calibrated against IEC 61960 Li-ion wear standards (OEM register was static).';
    }
  } else {
    if (el.capFullSubtext) el.capFullSubtext.classList.add('hidden');
    if (el.capBadge) el.capBadge.textContent = 'Hardware Counter';
    if (el.capFooterNote) {
      el.capFooterNote.textContent = 'Read directly from sysfs power_supply registers.';
    }
  }

  // Core Capacity Retention & Fade Ratios
  if (el.capRetentionText) {
    el.capRetentionText.textContent = s.capacity_retention_pct !== null && s.capacity_retention_pct !== undefined ? `${s.capacity_retention_pct}%` : '—';
  }
  if (el.capFadeText) {
    el.capFadeText.textContent = s.capacity_fade_pct !== null && s.capacity_fade_pct !== undefined ? `${s.capacity_fade_pct}%` : '—';
  }

  // Provenance Badges on Chemical Capacity
  const bd = s.breakdown || {};
  const sources = bd.data_sources || {};
  if (el.capFullProvenance) {
    const src = sources.charge_full || 'local';
    el.capFullProvenance.textContent = src === 'ai_consensus' ? 'AI Consensus' : (src === 'insufficient_data' ? 'No Data' : 'Local USB');
    el.capFullProvenance.className = src === 'ai_consensus'
      ? 'text-[10px] px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 font-mono'
      : (src === 'insufficient_data'
        ? 'text-[10px] px-2 py-0.5 rounded-full bg-zinc-700 text-zinc-400 font-mono'
        : 'text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-mono');
  }
  if (el.capDesignProvenance) {
    const src = sources.charge_full_design || 'local';
    el.capDesignProvenance.textContent = src === 'ai_consensus' ? 'AI Consensus' : (src === 'insufficient_data' ? 'No Data' : 'Local USB');
    el.capDesignProvenance.className = src === 'ai_consensus'
      ? 'text-[10px] px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 font-mono'
      : (src === 'insufficient_data'
        ? 'text-[10px] px-2 py-0.5 rounded-full bg-zinc-700 text-zinc-400 font-mono'
        : 'text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-mono');
  }

  // Mathematical Model Breakdown Card
  if (el.bdFadeText) el.bdFadeText.textContent = bd.capacity_fade_pct !== null && bd.capacity_fade_pct !== undefined ? `${bd.capacity_fade_pct}%` : '—';
  if (el.bdCycleText) el.bdCycleText.textContent = bd.cycle_fatigue_pct !== null && bd.cycle_fatigue_pct !== undefined ? `${bd.cycle_fatigue_pct}%` : '—';
  if (el.bdCalendarText) el.bdCalendarText.textContent = bd.calendar_aging_pct !== null && bd.calendar_aging_pct !== undefined ? `${bd.calendar_aging_pct}%` : '—';
  if (el.bdStressText) el.bdStressText.textContent = bd.stress_multiplier !== null && bd.stress_multiplier !== undefined ? `${bd.stress_multiplier}×` : '1.0×';
  if (el.bdFinalText) el.bdFinalText.textContent = bd.final_health_pct !== null && bd.final_health_pct !== undefined ? `${bd.final_health_pct}%` : '--';

  if (el.breakdownProvenanceNote && bd.provenance_note) {
    el.breakdownProvenanceNote.textContent = bd.provenance_note;
  }

  if (el.bdSourcesPill) {
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
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) {
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
    if (el.forecastMonthsText) el.forecastMonthsText.textContent = '0 mo';
    if (el.forecastSubtextLabel) el.forecastSubtextLabel.textContent = 'Service Limit: 80%';
    if (el.forecastDateText) el.forecastDateText.textContent = 'Service Recommended';
    if (el.forecastUrgencyPill) {
      el.forecastUrgencyPill.textContent = 'Service Limit';
      el.forecastUrgencyPill.className = 'px-3.5 py-1 rounded-full text-xs font-bold bg-rose-500/20 text-rose-300 border border-rose-500/30';
    }
  } else {
    if (el.forecastMonthsText) el.forecastMonthsText.textContent = `~${forecast.months_remaining} mo`;
    if (el.forecastSubtextLabel) {
      el.forecastSubtextLabel.textContent = targetDateFormatted !== '—' ? `Estimated to 80%: ${targetDateFormatted}` : 'Estimated to 80%';
    }
    if (el.forecastDateText) {
      el.forecastDateText.textContent = targetDateFormatted !== '—' ? `Target: ${targetDateFormatted}` : 'Target: —';
    }
    if (el.forecastUrgencyPill) {
      el.forecastUrgencyPill.textContent = forecast.urgency || 'Upcoming';
      if (forecast.urgency === 'Healthy') {
        el.forecastUrgencyPill.className = 'px-3.5 py-1 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30';
      } else if (forecast.urgency === 'Upcoming') {
        el.forecastUrgencyPill.className = 'px-3.5 py-1 rounded-full text-xs font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30';
      } else {
        el.forecastUrgencyPill.className = 'px-3.5 py-1 rounded-full text-xs font-bold bg-rose-500/20 text-rose-300 border border-rose-500/30';
      }
    }
  }

  if (el.forecastCurrentHealth) el.forecastCurrentHealth.textContent = `${forecast.current_health_pct}%`;
  if (el.forecastCyclesLeft) el.forecastCyclesLeft.textContent = `~${forecast.cycles_remaining} cycles remaining`;
  if (el.forecastDailyCadence) el.forecastDailyCadence.textContent = `~${forecast.daily_cycle_rate} cycles/day`;

  // Scale progress bar: 70% to 100% maps to 0% to 100% width
  if (el.forecastProgressBar) {
    const health = forecast.current_health_pct || 83;
    const progressPct = Math.min(100, Math.max(5, ((health - 70) / 30) * 100));
    el.forecastProgressBar.style.width = `${progressPct}%`;
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
    el.simCapToggle.setAttribute('aria-checked', 'false');
    el.simCapToggle.classList.remove('bg-indigo-600');
    el.simCapToggle.classList.add('bg-zinc-700');
    el.simCapKnob?.classList.remove('translate-x-5');
    el.simCapKnob?.classList.add('translate-x-0');
  }
}

async function handleSimCapToggle(e) {
  if (e) {
    if (typeof e.preventDefault === 'function') e.preventDefault();
    if (typeof e.stopPropagation === 'function') e.stopPropagation();
  }

  // Preserve scroll position to eliminate any jump on click or reflow
  const savedScrollY = window.scrollY || window.pageYOffset || document.documentElement.scrollTop || 0;

  const isConnected = AppState.connected || AppState.mode === 'seeded';
  if (!isConnected) {
    renderForecastInsufficientData('Awaiting device connection');
    if (el.simCapToggle) {
      el.simCapToggle.setAttribute('aria-checked', 'false');
      el.simCapToggle.classList.remove('bg-indigo-600');
      el.simCapToggle.classList.add('bg-zinc-700');
      el.simCapKnob?.classList.remove('translate-x-5');
      el.simCapKnob?.classList.add('translate-x-0');
    }
    if (typeof window.scrollTo === 'function') {
      window.scrollTo({ top: savedScrollY, behavior: 'instant' });
    }
    return;
  }

  // Toggle state
  state.is80CapSimulated = !state.is80CapSimulated;
  const isCapped = state.is80CapSimulated;

  if (!isCapped) {
    // Toggle OFF: hide simulation drawer, retain normal baseline forecast in hero
    forecastRequestId++;
    if (el.simCapResult) el.simCapResult.classList.add('hidden');
    if (el.simCapToggle) {
      el.simCapToggle.setAttribute('aria-checked', 'false');
      el.simCapToggle.classList.remove('bg-indigo-600');
      el.simCapToggle.classList.add('bg-zinc-700');
      el.simCapKnob?.classList.remove('translate-x-5');
      el.simCapKnob?.classList.add('translate-x-0');
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
    el.simCapToggle.setAttribute('aria-checked', 'true');
    el.simCapToggle.classList.remove('bg-zinc-700');
    el.simCapToggle.classList.add('bg-indigo-600');
    el.simCapKnob?.classList.add('translate-x-5');
    el.simCapKnob?.classList.remove('translate-x-0');
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

// Active Coulomb Calibration
async function startCalibration(simulate = false) {
  if (!AppState.connected && !simulate) {
    alert('Please connect an Android phone over USB-C to run empirical Coulomb calibration.');
    return;
  }
  try {
    if (el.calStartBtn) el.calStartBtn.disabled = true;
    if (el.calSimBtn) el.calSimBtn.disabled = true;

    const res = await fetch('/api/calibration/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ simulate }),
    });

    if (res.ok) {
      el.calStopBtn?.classList.remove('hidden');
      if (el.calStatusBadge) {
        el.calStatusBadge.textContent = simulate ? 'Simulating...' : 'Sampling...';
        el.calStatusBadge.className = 'px-3 py-0.5 rounded-full text-xs font-semibold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 font-mono animate-pulse';
      }

      if (state.calibrationPollTimer) clearInterval(state.calibrationPollTimer);
      state.calibrationPollTimer = setInterval(pollCalibrationStatus, 600);
    }
  } catch (err) {
    console.warn('Failed to start calibration:', err);
  }
}

async function pollCalibrationStatus() {
  try {
    const res = await fetch('/api/calibration/status');
    if (res.ok) {
      const data = await res.json();
      if (el.calCurrentText) el.calCurrentText.textContent = `+${Math.round(data.current_ma || 0)} mA`;
      if (el.calAccumulatedText) el.calAccumulatedText.textContent = `${Math.round(data.accumulated_mah || 0)} mAh`;

      if (data.extrapolated_capacity_mah > 0) {
        if (el.calVerdictBox) el.calVerdictBox.classList.remove('hidden');
        if (el.calExtrapolatedText) el.calExtrapolatedText.textContent = `${Math.round(data.extrapolated_capacity_mah)} mAh`;
        if (el.calHealthPctText) el.calHealthPctText.textContent = `${data.calibrated_health_pct}% SoH`;
        if (el.calComparisonSubtext) {
          el.calComparisonSubtext.textContent = `Measured over Δ${data.delta_level_pct}% charge (${Math.round(data.accumulated_mah)} mAh integrated).`;
        }
      }

      if (!data.is_running && data.status === 'completed') {
        clearInterval(state.calibrationPollTimer);
        state.calibrationPollTimer = null;
        if (el.calStopBtn) el.calStopBtn.classList.add('hidden');
        if (el.calStartBtn) el.calStartBtn.disabled = false;
        if (el.calSimBtn) el.calSimBtn.disabled = false;
        if (el.calStatusBadge) {
          el.calStatusBadge.textContent = 'Completed';
          el.calStatusBadge.className = 'px-3 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-mono';
        }
      }
    }
  } catch (err) {
    console.warn('Calibration poll error:', err);
  }
}

async function stopCalibration() {
  try {
    if (state.calibrationPollTimer) {
      clearInterval(state.calibrationPollTimer);
      state.calibrationPollTimer = null;
    }
    const res = await fetch('/api/calibration/stop', { method: 'POST' });
    if (res.ok) {
      await pollCalibrationStatus();
    }
  } catch (err) {
    console.warn('Failed to stop calibration:', err);
  } finally {
    if (el.calStopBtn) el.calStopBtn.classList.add('hidden');
    if (el.calStartBtn) el.calStartBtn.disabled = false;
    if (el.calSimBtn) el.calSimBtn.disabled = false;
  }
}

function renderHistoryAndChart() {
  const readings = state.history || [];
  if (el.historyCountBadge) {
    if (readings.length > 0) {
      const firstTs = new Date(readings[0].timestamp).getTime();
      const lastTs = new Date(readings[readings.length - 1].timestamp).getTime();
      const spanDays = Math.max(1, Math.round((lastTs - firstTs) / (1000 * 60 * 60 * 24)));
      const filterDays = state.selectedDays || 30;
      if (spanDays < filterDays) {
        el.historyCountBadge.textContent = `${readings.length} readings · ${spanDays}D recorded`;
      } else {
        el.historyCountBadge.textContent = `${readings.length} readings · ${filterDays}D range`;
      }
    } else {
      el.historyCountBadge.textContent = `0 readings`;
    }
  }

  // 1. Chart.js (EURA Heart Report Aesthetic: Clean White Curve)
  if (el.chartCanvas) {
    const ctx = el.chartCanvas.getContext('2d');

    if (state.chartInstance) {
      state.chartInstance.destroy();
    }

    if (readings.length > 0) {
      const labels = readings.map(r => {
        const d = new Date(r.timestamp);
        return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${d.getMinutes().toString().padStart(2, '0')}`;
      });

      const healthVals = readings.map(r => r.health_pct);
      const tempVals = readings.map(r => r.temperature_c);

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
                font: { family: '-apple-system, sans-serif', size: 11 },
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
              grid: { color: 'rgba(255, 255, 255, 0.03)' },
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
              grid: { color: 'rgba(255, 255, 255, 0.05)' },
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

  // 2. History Log Table
  if (readings.length === 0) {
    el.historyTableBody.innerHTML = `
      <tr>
        <td colspan="7" class="py-8 text-center text-zinc-500 text-xs">
          No historical readings recorded yet. Connect your device or click "Seed 30D" to preview.
        </td>
      </tr>
    `;
    return;
  }

  const reversed = [...readings].reverse();
  el.historyTableBody.innerHTML = reversed.map(r => {
    let badge = `<span class="px-2.5 py-0.5 rounded-full text-xs font-bold bg-zinc-800 text-zinc-300">${r.health_pct}%</span>`;
    if (r.health_pct >= 85) {
      badge = `<span class="px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">${r.health_pct}%</span>`;
    } else if (r.health_pct >= 70) {
      badge = `<span class="px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30">${r.health_pct}%</span>`;
    } else {
      badge = `<span class="px-2.5 py-0.5 rounded-full text-xs font-bold bg-rose-500/20 text-rose-400 border border-rose-500/30">${r.health_pct}%</span>`;
    }

    return `
      <tr class="border-b border-white/[0.04] hover:bg-white/[0.02] text-xs text-zinc-300 transition-colors">
        <td class="py-3 px-4 font-mono text-zinc-400">${formatDate(r.timestamp)}</td>
        <td class="py-3 px-4">${badge}</td>
        <td class="py-3 px-4 font-bold text-white">${r.level_pct}%</td>
        <td class="py-3 px-4 font-mono text-zinc-400">${(r.voltage_mv / 1000).toFixed(2)} V</td>
        <td class="py-3 px-4 text-zinc-300">${r.temperature_c} °C</td>
        <td class="py-3 px-4 font-mono text-zinc-400">${(r.cycle_count !== null && r.cycle_count !== undefined && r.cycle_count_type !== 'unavailable') ? r.cycle_count : '<span class="text-zinc-500 italic">Unavailable</span>'}</td>
        <td class="py-3 px-4">
          <span class="text-[11px] px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400 border border-white/5">
            ${r.health_method === 'capacity_ratio' ? 'Capacity Ratio' : 'Trend'}
          </span>
        </td>
      </tr>
    `;
  }).join('');
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
      ? `<span class="px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">READABLE</span>`
      : `<span class="px-2 py-0.5 rounded-full text-xs font-bold bg-zinc-800 text-zinc-500 border border-zinc-700">HIDDEN</span>`;

    return `
      <tr class="border-b border-white/[0.04] text-xs">
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
      <div class="overflow-x-auto">
        <table class="w-full text-left">
          <thead>
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
      <pre class="bg-black/50 p-4 rounded-2xl text-xs font-mono text-indigo-300 overflow-x-auto border border-white/5">${p.dumpsys_battery?.raw_output || 'No dumpsys output'}</pre>
    </div>
  `;
}

// Navigation Tab Switching
function switchTab(tabId) {
  state.currentTab = tabId;

  // Update capsule segments
  el.capsuleSegments.forEach(seg => {
    if (seg.dataset.tab === tabId) {
      seg.classList.add('active');
    } else {
      seg.classList.remove('active');
    }
  });

  // Toggle views
  Object.keys(el.views).forEach(key => {
    if (key === tabId) {
      el.views[key].classList.remove('hidden');
    } else {
      el.views[key].classList.add('hidden');
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

async function handleSeed() {
  try {
    el.seedBtn.disabled = true;
    el.seedBtn.textContent = 'Seeding...';

    const res = await fetch('/api/seed-mock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ days: 30, serial: 'mock-phone-2a', model: 'Nothing Phone 2a' }),
    });

    if (res.ok) {
      const isConn = state.systemStatus?.active_device_count > 0;
      if (!isConn) {
        state.selectedSerial = 'mock-phone-2a';
        const snapRes = await fetch('/api/snapshot?serial=mock-phone-2a');
        const snapData = snapRes.ok ? await snapRes.json() : null;
        await fetchHistory(state.selectedDays, 'mock-phone-2a');
        await fetchInsights('mock-phone-2a');
        AppState.setSeededMode('mock-phone-2a', snapData);
      } else {
        const activeDev = state.systemStatus?.connected_devices?.find(d => d.state === 'device');
        const realSerial = activeDev ? activeDev.serial : state.selectedSerial;
        if (realSerial) {
          state.selectedSerial = realSerial;
          await fetchHistory(state.selectedDays, realSerial);
          await fetchInsights(realSerial);
        }
      }
    }
  } catch (err) {
    alert('Failed to seed demo data: ' + err.message);
  } finally {
    el.seedBtn.disabled = false;
    el.seedBtn.textContent = 'Seed 30D';
  }
}

// Disconnected Polish Helper Functions (Fix 3 & Fix 5)

function formatSyncedTimestamp(isoString) {
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return 'Recently';
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    const timeStr = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
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
        if (!latestTimestamp || new Date(r.timestamp) > new Date(latestTimestamp)) {
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
  const d = new Date(isoString);
  const now = new Date();
  const diffSec = Math.floor((now - d) / 1000);
  if (diffSec < 0 || isNaN(diffSec)) return null;
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

  valid.sort((a, b) => new Date(b.last_seen) - new Date(a.last_seen));
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
// ==========================================
async function fetchAppDrain(force = false) {
  const isConnected = AppState.connected;
  const isSeeded = AppState.mode === 'seeded';
  const hasTarget = Boolean(state.selectedSerial || state.snapshot?.device_serial);
  if (!isConnected && !isSeeded && !hasTarget) {
    renderAppDrain(null, true);
    return;
  }

  const listEl = el.appDrainList || document.getElementById('app-drain-list');
  if (state.appDrain.loading && !force) return;
  state.appDrain.loading = true;

  try {
    const targetSerial = state.selectedSerial || (isSeeded ? 'mock-phone-2a' : (state.snapshot?.device_serial || ''));
    const res = await fetch(`/api/app-drain?window=${state.appDrain.window}&sort_by=${state.appDrain.sort_by}&serial=${encodeURIComponent(targetSerial)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    state.appDrain.data = data;
    renderAppDrain(data, false);
  } catch (err) {
    console.error('[APP DRAIN] Fetch failed:', err);
    if (listEl && (!state.appDrain.data || !state.appDrain.data.items)) {
      listEl.innerHTML = `<div class="py-6 text-center text-zinc-500 text-xs font-mono">Unable to retrieve app battery drain telemetry (${escapeHtml(err.message)}).</div>`;
    }
  } finally {
    state.appDrain.loading = false;
  }
}

function renderAppDrain(data, isStandby = false) {
  const listEl = el.appDrainList || document.getElementById('app-drain-list');
  const thermalBanner = el.appDrainThermalBanner || document.getElementById('app-drain-thermal-banner');
  const thermalText = el.appDrainThermalText || document.getElementById('app-drain-thermal-text');
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
      thermalText.textContent = `Thermal Correlation: ${data.thermal_summary || 'Elevated device temperature during background activity.'}`;
    }
    thermalBanner.classList.remove('hidden');
  } else if (thermalBanner) {
    thermalBanner.classList.add('hidden');
  }

  const sortKey = state.appDrain.sort_by || 'wakelock_ms';
  const items = [...(data.items || [])];
  if (items.length === 0) {
    listEl.innerHTML = `
      <div class="py-8 text-center text-zinc-500 text-xs font-mono">
        No background drain events recorded in this ${data.window || '24h'} window.
      </div>
    `;
    return;
  }

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

  listEl.innerHTML = items.map((app, idx) => {
    const rank = idx + 1;
    const displayName = escapeHtml(app.display_name || app.package_name || 'App');
    const pkgName = escapeHtml(app.package_name || '');
    const wakelockDisplay = escapeHtml(app.wakelock_duration_display || '0s');
    const wakelockCount = app.wakelock_count || 0;
    const cpuBgSec = Math.round((app.cpu_bg_ms || 0) / 1000);
    const estMah = app.estimated_mah !== null && app.estimated_mah !== undefined ? `${app.estimated_mah} mAh` : null;

    const currVal = app[sortKey] || 0;
    const pctBar = Math.min(100, Math.max(6, Math.round((currVal / maxVal) * 100)));

    const thermalTagHtml = app.has_thermal_correlation ? `
      <span class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-rose-500/20 text-rose-300 border border-rose-500/30 flex items-center gap-1 shrink-0" data-tooltip="${escapeHtml(app.thermal_flag || 'Elevated temperature during wakelock')}">
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

        <!-- Relative Drain Progress Bar & Counters -->
        <div class="flex items-center gap-3 pt-1">
          <div class="flex-1 bg-black/50 h-1.5 rounded-full overflow-hidden border border-white/5">
            <div class="h-full bg-gradient-to-r from-indigo-500 to-teal-400 rounded-full transition-all duration-500" style="width: ${pctBar}%;"></div>
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
}

function updateAppDrainWindowPills(targetWindow) {
  const currentWindow = (targetWindow || state.appDrain?.window || '24h').toLowerCase();
  if (state.appDrain) state.appDrain.window = currentWindow;
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

function subscribeTopBatteryDrainers({ connected, mode }) {
  updateAppDrainWindowPills(state.appDrain?.window || '24h');
  if (connected || mode === 'seeded') {
    fetchAppDrain();
  } else {
    renderAppDrain(null, true);
  }
}

// Boot
function init() {
  // Capsule Nav clicks
  el.capsuleSegments.forEach(seg => {
    seg.addEventListener('click', () => switchTab(seg.dataset.tab));
  });

  // Action Buttons
  el.probeBtn?.addEventListener('click', handleProbe);
  document.getElementById('reconnect-btn')?.addEventListener('click', handleProbe);
  el.seedBtn?.addEventListener('click', handleSeed);

  // Calibration & Prediction actions
  el.simCapToggle?.addEventListener('click', (e) => {
    if (e) {
      if (typeof e.preventDefault === 'function') e.preventDefault();
      if (typeof e.stopPropagation === 'function') e.stopPropagation();
    }
    handleSimCapToggle(e);
  });
  el.calStartBtn?.addEventListener('click', () => startCalibration(false));
  el.calSimBtn?.addEventListener('click', () => startCalibration(true));
  el.calStopBtn?.addEventListener('click', stopCalibration);

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

  // App Battery Drain Sort & Window Pill Event Listeners
  document.querySelectorAll('.app-drain-sort-pill').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      document.querySelectorAll('.app-drain-sort-pill').forEach(b => {
        b.classList.remove('active', 'bg-indigo-600', 'text-white');
        b.classList.add('text-zinc-400');
      });
      btn.classList.add('active', 'bg-indigo-600', 'text-white');
      btn.classList.remove('text-zinc-400');
      state.appDrain.sort_by = btn.dataset.sort;
      if (state.appDrain.data && Array.isArray(state.appDrain.data.items)) {
        renderAppDrain(state.appDrain.data, false);
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
  updateAppDrainWindowPills(state.appDrain?.window || '24h');

  // Register subscribers to AppState (Single Source of Truth)
  AppState.subscribe(subscribeTopBar);
  AppState.subscribe(subscribeGuidanceBanner);
  AppState.subscribe(subscribeHeroHeadline);
  AppState.subscribe(masterDashboardSubscriber);
  AppState.subscribe(subscribeTopBatteryDrainers);

  // Initial queries
  fetchStatus();
  fetchSnapshot();
  fetchHistory(state.selectedDays);
  fetchInsights();
  fetchAppDrain();

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

  // Background polling loop (1s for real-time connect/disconnect detection)
  state.pollTimer = setInterval(() => {
    fetchStatus();
    fetchSnapshot();

    const isConn = state.systemStatus?.active_device_count > 0;
    const now = Date.now();
    if (isConn && (now - (state.lastHistoryLivePoll || 0) >= 10000)) {
      state.lastHistoryLivePoll = now;
      fetchHistory(state.selectedDays);
      fetchAppDrain();
    }
  }, 1000);

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
    statusToggle.addEventListener('click', () => {
      toggleDeviceStatusFeed();
    });
  }

  fetchDeviceStatus();
  setInterval(fetchDeviceStatus, 2500);

  // Initialize Global Boundary-Aware Tooltip System
  initSharedTooltips();

  // Initialize Cursor-Tracking Glow Effect (Spotlight Hover)
  initCursorTrackingGlow();
}

// Cursor-Tracking Spotlight Glow Hover Implementation
function initCursorTrackingGlow() {
  // 1. Accessibility: Skip tracking if user prefers reduced motion
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // 2. Touch Check: Skip on touch / coarse pointer devices (no real hover)
  const supportsHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  if (prefersReducedMotion || !supportsHover) {
    return;
  }

  // Helper for delegated mousemove tracking on pill/button groups
  function setupDelegatedGlow(container, itemSelector) {
    if (!container) return;
    let rafId = null;
    let currentItem = null;
    let latestX = 0;
    let latestY = 0;

    container.addEventListener('mousemove', (e) => {
      const item = e.target.closest(itemSelector);
      if (!item) {
        currentItem = null;
        return;
      }

      currentItem = item;
      const rect = item.getBoundingClientRect();
      latestX = e.clientX - rect.left;
      latestY = e.clientY - rect.top;

      if (!rafId) {
        rafId = requestAnimationFrame(() => {
          if (currentItem) {
            currentItem.style.setProperty('--mouse-x', `${latestX}px`);
            currentItem.style.setProperty('--mouse-y', `${latestY}px`);
          }
          rafId = null;
        });
      }
    }, { passive: true });

    container.addEventListener('mouseleave', () => {
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      currentItem = null;
    }, { passive: true });
  }

  // Helper for individual card surface glow
  function setupCardGlow(card) {
    if (!card) return;
    let rafId = null;
    let latestX = 0;
    let latestY = 0;

    card.addEventListener('mousemove', (e) => {
      const rect = card.getBoundingClientRect();
      latestX = e.clientX - rect.left;
      latestY = e.clientY - rect.top;

      if (!rafId) {
        rafId = requestAnimationFrame(() => {
          card.style.setProperty('--mouse-x', `${latestX}px`);
          card.style.setProperty('--mouse-y', `${latestY}px`);
          rafId = null;
        });
      }
    }, { passive: true });

    card.addEventListener('mouseleave', () => {
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
    }, { passive: true });
  }

  // A. Delegated tracking on Navigation Capsule
  const navContainer = document.querySelector('.capsule-nav');
  if (navContainer) {
    setupDelegatedGlow(navContainer, '.capsule-segment');
  }

  // B. Delegated tracking on Header Action Pills (#connection-pill, #seed-btn, #probe-btn)
  const headerActions = document.getElementById('probe-btn')?.parentElement;
  if (headerActions) {
    setupDelegatedGlow(headerActions, '.pill-button, #connection-pill');
  }

  // C. Delegated tracking on Timeline Filter Pills (7D / 14D / 30D / 90D) and Metric Toggles
  const timeFilterContainer = document.querySelector('.time-filter-pill')?.parentElement;
  if (timeFilterContainer) {
    setupDelegatedGlow(timeFilterContainer, '.time-filter-pill');
  }

  const chartMetricContainer = document.querySelector('.chart-metric-pill')?.parentElement;
  if (chartMetricContainer) {
    setupDelegatedGlow(chartMetricContainer, '.chart-metric-pill');
  }


  // D. Surface tracking on Cards (Hero card, Health Report, Current Charge, Chemical Capacity, etc.)
  const cardElements = document.querySelectorAll('#hero-card, .eura-dark-card, .eura-indigo-card');
  cardElements.forEach(card => setupCardGlow(card));
}

// ==========================================================================
// Reusable Single-Instance Tooltip System with Boundary Collision Detection
// ==========================================================================

let sharedTooltipEl = null;
let activeTooltipTarget = null;
let tooltipHideTimer = null;
let isTooltipSystemInitialized = false;

function getOrCreateSharedTooltip() {
  if (!sharedTooltipEl) {
    sharedTooltipEl = document.getElementById('app-tooltip');
    if (!sharedTooltipEl) {
      sharedTooltipEl = document.createElement('div');
      sharedTooltipEl.id = 'app-tooltip';
      sharedTooltipEl.className = 'fixed z-[9999] pointer-events-none px-2.5 py-1.5 rounded-lg bg-[#0F1024]/95 border border-white/15 text-[11px] font-medium text-zinc-200 shadow-2xl backdrop-blur-md transition-opacity duration-150 opacity-0 hidden max-w-xs';
      sharedTooltipEl.setAttribute('role', 'tooltip');
      sharedTooltipEl.setAttribute('aria-hidden', 'true');
      document.body.appendChild(sharedTooltipEl);
    }
  }
  return sharedTooltipEl;
}

/**
 * Positions the tooltip relative to triggerEl, clamping strictly within
 * the visible viewport boundaries (window.innerWidth / window.innerHeight).
 */
function positionSharedTooltip(triggerEl, tipEl) {
  const margin = 10; // Minimum margin from viewport edge (px)
  const gap = 8; // Vertical gap from trigger (px)
  const triggerRect = triggerEl.getBoundingClientRect();

  // Reset positioning styles to measure natural unconstrained dimensions
  tipEl.style.left = '0px';
  tipEl.style.top = '0px';
  tipEl.style.right = 'auto';
  tipEl.style.bottom = 'auto';

  const tipRect = tipEl.getBoundingClientRect();
  const tipWidth = tipRect.width;
  const tipHeight = tipRect.height;
  const vpWidth = window.innerWidth;
  const vpHeight = window.innerHeight;

  // 1. Horizontal Calculation & Boundary Collision Detection
  // Center horizontally over the trigger element by default
  let left = triggerRect.left + (triggerRect.width / 2) - (tipWidth / 2);

  // If overflowing the right window edge, flip to align with the trigger's right side
  if (left + tipWidth > vpWidth - margin) {
    const rightAligned = triggerRect.right - tipWidth;
    left = Math.min(rightAligned, vpWidth - tipWidth - margin);
  }

  // If overflowing the left window edge, flip to align with the trigger's left side
  if (left < margin) {
    left = Math.max(triggerRect.left, margin);
  }

  // Strict clamp ensuring right <= vpWidth - margin and left >= margin
  left = Math.max(margin, Math.min(left, vpWidth - tipWidth - margin));

  // 2. Vertical Calculation & Boundary Collision Detection
  // Position directly below the trigger by default
  let top = triggerRect.bottom + gap;

  // If overflowing bottom window edge, flip to position directly above the trigger
  if (top + tipHeight > vpHeight - margin) {
    top = triggerRect.top - tipHeight - gap;
  }

  // If flipped above and overflowing top window edge, clamp to top margin
  if (top < margin) {
    top = margin;
  }

  tipEl.style.left = `${Math.round(left)}px`;
  tipEl.style.top = `${Math.round(top)}px`;
}

function showSharedTooltip(triggerEl) {
  const text = triggerEl.getAttribute('data-tooltip') || triggerEl.getAttribute('title');
  if (!text || !text.trim()) return;

  // Strip native title attribute to permanently prevent browser/OS duplicate tooltip popup
  if (triggerEl.hasAttribute('title')) {
    triggerEl.setAttribute('data-tooltip', text.trim());
    triggerEl.removeAttribute('title');
  }

  if (tooltipHideTimer) {
    clearTimeout(tooltipHideTimer);
    tooltipHideTimer = null;
  }

  activeTooltipTarget = triggerEl;
  const tip = getOrCreateSharedTooltip();
  tip.textContent = text.trim();

  // Make visible in DOM to measure bounding dimensions accurately
  tip.classList.remove('hidden');

  // Compute collision-free coordinates
  positionSharedTooltip(triggerEl, tip);

  // Trigger smooth fade-in
  requestAnimationFrame(() => {
    if (activeTooltipTarget === triggerEl) {
      tip.classList.remove('opacity-0');
      tip.classList.add('opacity-100');
      tip.setAttribute('aria-hidden', 'false');
    }
  });
}

function hideSharedTooltip(triggerEl = null) {
  if (triggerEl && activeTooltipTarget !== triggerEl) {
    return;
  }
  activeTooltipTarget = null;
  const tip = getOrCreateSharedTooltip();
  tip.classList.remove('opacity-100');
  tip.classList.add('opacity-0');
  tip.setAttribute('aria-hidden', 'true');

  if (tooltipHideTimer) clearTimeout(tooltipHideTimer);
  tooltipHideTimer = setTimeout(() => {
    if (!activeTooltipTarget) {
      tip.classList.add('hidden');
    }
  }, 160);
}

function initSharedTooltips() {
  if (isTooltipSystemInitialized) return;
  isTooltipSystemInitialized = true;

  getOrCreateSharedTooltip();

  // Strip existing title attributes from any tooltip elements on page load
  document.querySelectorAll('[data-tooltip]').forEach(el => {
    if (el.hasAttribute('title')) {
      el.removeAttribute('title');
    }
  });

  // Delegated event listening guarantees:
  // 1. Single shared tooltip instance reused always.
  // 2. Listeners attached exactly once on document - immune to re-renders or stacking duplicates.
  document.addEventListener('mouseover', (e) => {
    const target = e.target.closest('[data-tooltip]');
    if (target) {
      showSharedTooltip(target);
    }
  }, { passive: true });

  document.addEventListener('mouseout', (e) => {
    const target = e.target.closest('[data-tooltip]');
    if (target) {
      hideSharedTooltip(target);
    }
  }, { passive: true });

  document.addEventListener('focusin', (e) => {
    const target = e.target.closest('[data-tooltip]');
    if (target) {
      showSharedTooltip(target);
    }
  }, { passive: true });

  document.addEventListener('focusout', (e) => {
    const target = e.target.closest('[data-tooltip]');
    if (target) {
      hideSharedTooltip(target);
    }
  }, { passive: true });

  // Reposition on window resize if active; dismiss on scroll
  window.addEventListener('resize', () => {
    if (activeTooltipTarget) {
      positionSharedTooltip(activeTooltipTarget, getOrCreateSharedTooltip());
    }
  }, { passive: true });

  window.addEventListener('scroll', () => {
    if (activeTooltipTarget) {
      hideSharedTooltip();
    }
  }, { passive: true });
}

document.addEventListener('DOMContentLoaded', init);
