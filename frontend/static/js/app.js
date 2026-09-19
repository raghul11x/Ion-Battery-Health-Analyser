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
  calibrationPollTimer: null,
};

// DOM References
const el = {
  // Connection Bar
  connDot: document.getElementById('conn-dot'),
  connStatusLabel: document.getElementById('conn-status-label'),
  connDeviceLabel: document.getElementById('conn-device-label'),
  probeBtn: document.getElementById('probe-btn'),
  probeIcon: document.getElementById('probe-icon'),
  seedBtn: document.getElementById('seed-btn'),

  // Hero Card (EURA Bio-Age Style)
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
  forecastDateText: document.getElementById('forecast-date-text'),
  forecastCurrentHealth: document.getElementById('forecast-current-health'),
  forecastProgressBar: document.getElementById('forecast-progress-bar'),
  forecastCyclesLeft: document.getElementById('forecast-cycles-left'),
  forecastDailyCadence: document.getElementById('forecast-daily-cadence'),
  simCapToggle: document.getElementById('sim-cap-toggle'),
  simCapKnob: document.getElementById('sim-cap-knob'),
  simCapResult: document.getElementById('sim-cap-result'),
  simCapExtraText: document.getElementById('sim-cap-extra-text'),

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

async function fetchSnapshot() {
  try {
    const res = await fetch('/api/snapshot');
    if (res.ok) {
      state.snapshot = await res.json();
      renderSnapshot();
    }
  } catch (err) {
    console.warn('Failed to fetch snapshot:', err);
  }
}

async function fetchHistory(days = 30) {
  try {
    const res = await fetch(`/api/history?days=${days}&limit=150`);
    if (res.ok) {
      const data = await res.json();
      state.history = data.readings || [];
      renderHistoryAndChart();
    }
  } catch (err) {
    console.warn('Failed to fetch history:', err);
  }
}

async function fetchInsights() {
  try {
    const res = await fetch('/api/insights');
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

// Renderers
function updateConnectionStatus() {
  const isConn = state.systemStatus?.active_device_count > 0;
  const activeDev = state.systemStatus?.connected_devices?.find(d => d.state === 'device');
  const unauthDev = state.systemStatus?.connected_devices?.find(d => d.state === 'unauthorized');
  const offlineDev = state.systemStatus?.connected_devices?.find(d => d.state === 'offline');
  const isProfiling = state.systemStatus?.watcher_status?.is_profiling;
  const profilingMsg = state.systemStatus?.watcher_status?.profiling_message || 'Profiling new device...';

  const guidanceBanner = document.getElementById('connection-guidance-banner');
  const guidanceText = document.getElementById('connection-guidance-text');

  if (isProfiling) {
    el.connDot.className = 'w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse';
    el.connStatusLabel.textContent = profilingMsg;
    const name = activeDev?.model ? activeDev.model.replace(/_/g, ' ') : (state.snapshot?.device_model || 'Android Device');
    el.connDeviceLabel.textContent = `· ${name}`;
    el.connDeviceLabel.classList.remove('hidden');
    if (guidanceBanner) guidanceBanner.classList.add('hidden');
    return;
  }

  if (isConn && activeDev) {
    el.connDot.className = 'dot-live-green';
    const name = activeDev.model ? activeDev.model.replace(/_/g, ' ') : (state.snapshot?.device_model || 'Android Device');
    el.connStatusLabel.textContent = 'Connected';
    el.connDeviceLabel.textContent = `· ${name}`;
    el.connDeviceLabel.classList.remove('hidden');
    if (guidanceBanner) guidanceBanner.classList.add('hidden');
  } else if (unauthDev || state.snapshot?.health_status === 'unauthorized' || state.snapshot?.connection_state === 'unauthorized') {
    el.connDot.className = 'w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse';
    el.connStatusLabel.textContent = 'Unauthorized';
    const sName = unauthDev?.serial ? `(${unauthDev.serial.slice(0, 8)}...)` : '';
    el.connDeviceLabel.textContent = `· Phone detected ${sName}`;
    el.connDeviceLabel.classList.remove('hidden');
    if (guidanceBanner && guidanceText) {
      guidanceText.innerHTML = `<strong>Action Required on Phone:</strong> Unlock your phone screen and tap <strong>&quot;Allow USB debugging&quot;</strong> (check <em>&quot;Always allow from this computer&quot;</em>).`;
      guidanceBanner.classList.remove('hidden');
    }
  } else if (offlineDev || state.snapshot?.health_status === 'offline' || state.snapshot?.connection_state === 'offline') {
    el.connDot.className = 'w-2.5 h-2.5 rounded-full bg-amber-400';
    el.connStatusLabel.textContent = 'Offline';
    const sName = offlineDev?.serial ? `(${offlineDev.serial.slice(0, 8)}...)` : '';
    el.connDeviceLabel.textContent = `· Phone offline ${sName}`;
    el.connDeviceLabel.classList.remove('hidden');
    if (guidanceBanner && guidanceText) {
      guidanceText.innerHTML = `<strong>Device Offline:</strong> Please unplug and reconnect your USB cable, or toggle USB debugging in Developer Options.`;
      guidanceBanner.classList.remove('hidden');
    }
  } else {
    el.connDot.className = 'dot-idle-gray';
    el.connStatusLabel.textContent = 'Disconnected';
    if (guidanceBanner) guidanceBanner.classList.add('hidden');
    if (state.snapshot?.device_model && state.snapshot.device_model !== 'No device connected') {
      el.connDeviceLabel.textContent = `· ${state.snapshot.device_model} (Cached)`;
      el.connDeviceLabel.classList.remove('hidden');
    } else {
      el.connDeviceLabel.classList.add('hidden');
    }
  }
}

function renderSnapshot() {
  const s = state.snapshot;
  if (!s) return;

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
    el.heroCard.classList.add('hero-gradient-unknown');
    el.heroHealthNumber.textContent = '--';
    el.heroStatusPill.textContent = 'Awaiting Device';
    el.heroStatusHeading.textContent = 'No Device Connected';
    el.heroStatusSubtext.textContent = 'Connect phone over USB-C to compute real chemical health.';
    el.rangeDialMarker.style.left = '0%';
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
  if (s.cycle_count !== null && s.cycle_count !== undefined) {
    const cycleType = s.cycle_count_type === 'estimated' ? ' (Estimated)' : ' (Hardware)';
    el.statCycles.textContent = `${s.cycle_count}`;
    if (sublabel) sublabel.textContent = `OEM cycle count${cycleType}`;
  } else {
    el.statCycles.textContent = '—';
    if (sublabel) sublabel.textContent = s.connected ? 'Not exposed by OEM' : 'OEM cycle count';
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
      } else if (src === 'insufficient_data' || !s.connected) {
        badgeStyle = 'bg-zinc-800 text-zinc-400 border-white/10';
        srcLabel = 'No Data';
      }
      badge.className = `px-2 py-0.5 rounded text-[10px] font-mono border ${badgeStyle}`;
      badge.textContent = `${f.label}: ${srcLabel}`;
      el.bdSourcesPill.appendChild(badge);
    });
  }

  // 4. PREDICTIVE REPLACEMENT FORECAST
  if (s.replacement_forecast) {
    renderForecast(s.replacement_forecast);
  }
}

// Forecast Rendering
function renderForecast(forecast) {
  if (!forecast || !el.forecastMonthsText) return;

  const isCapped = state.is80CapSimulated;
  const monthsVal = isCapped ? forecast.simulation_80_cap?.extended_months : forecast.months_remaining;

  if (forecast.urgency === 'Service Recommended' || (forecast.current_health_pct && forecast.current_health_pct <= 80.0)) {
    el.forecastMonthsText.textContent = '0 mo';
    el.forecastDateText.textContent = 'Service Recommended';
    el.forecastUrgencyPill.textContent = 'Service Limit';
    el.forecastUrgencyPill.className = 'px-3.5 py-1 rounded-full text-xs font-bold bg-rose-500/20 text-rose-300 border border-rose-500/30';
  } else {
    el.forecastMonthsText.textContent = `~${monthsVal} mo`;
    el.forecastDateText.textContent = isCapped ? 'Capped Simulation' : (forecast.projected_date_formatted || forecast.projected_date_iso || '—');
    el.forecastUrgencyPill.textContent = forecast.urgency || 'Upcoming';

    if (forecast.urgency === 'Healthy') {
      el.forecastUrgencyPill.className = 'px-3.5 py-1 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30';
    } else if (forecast.urgency === 'Upcoming') {
      el.forecastUrgencyPill.className = 'px-3.5 py-1 rounded-full text-xs font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30';
    } else {
      el.forecastUrgencyPill.className = 'px-3.5 py-1 rounded-full text-xs font-bold bg-rose-500/20 text-rose-300 border border-rose-500/30';
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

  if (el.simCapExtraText && forecast.simulation_80_cap) {
    const extraMonths = forecast.simulation_80_cap.extra_months || 18.0;
    const extraYears = (extraMonths / 12.0).toFixed(1);
    el.simCapExtraText.textContent = `+${extraYears} years (~${extraMonths} extra months)`;
  }
}

function handleSimCapToggle() {
  state.is80CapSimulated = !state.is80CapSimulated;
  const isCapped = state.is80CapSimulated;

  if (el.simCapToggle) {
    el.simCapToggle.setAttribute('aria-checked', isCapped ? 'true' : 'false');
    if (isCapped) {
      el.simCapToggle.classList.remove('bg-zinc-700');
      el.simCapToggle.classList.add('bg-indigo-600');
      el.simCapKnob?.classList.add('translate-x-5');
      el.simCapKnob?.classList.remove('translate-x-0');
      el.simCapResult?.classList.remove('hidden');
    } else {
      el.simCapToggle.classList.remove('bg-indigo-600');
      el.simCapToggle.classList.add('bg-zinc-700');
      el.simCapKnob?.classList.remove('translate-x-5');
      el.simCapKnob?.classList.add('translate-x-0');
      el.simCapResult?.classList.add('hidden');
    }
  }

  if (state.snapshot?.replacement_forecast) {
    renderForecast(state.snapshot.replacement_forecast);
  }
}

// Active Coulomb Calibration
async function startCalibration(simulate = false) {
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
  const readings = state.history;
  el.historyCountBadge.textContent = `${readings.length} readings`;

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
              tension: 0.35,
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
              tension: 0.35,
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
        <td class="py-3 px-4 font-mono text-zinc-400">${r.cycle_count !== null ? r.cycle_count : '—'}</td>
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
      await fetchSnapshot();
      await fetchHistory(state.selectedDays);
      await fetchInsights();
    }
  } catch (err) {
    alert('Failed to seed demo data: ' + err.message);
  } finally {
    el.seedBtn.disabled = false;
    el.seedBtn.textContent = 'Seed 30D';
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
  el.simCapToggle?.addEventListener('click', handleSimCapToggle);
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

  // Initial queries
  fetchStatus();
  fetchSnapshot();
  fetchHistory(state.selectedDays);
  fetchInsights();

  // Background polling loop (1s for real-time connect/disconnect detection)
  state.pollTimer = setInterval(() => {
    fetchStatus();
    fetchSnapshot();
  }, 1000);
}

document.addEventListener('DOMContentLoaded', init);
