/**
 * Ion+ Forecast & Lifespan Simulation Subsystem
 * Manages electrochemical cell replacement timeline forecasting,
 * normal baseline degradation modeling, urgency categorization,
 * and side-by-side 80% charge limit simulation comparison.
 */

// Forecast State Handlers (Normal Baseline + On-Toggle Side-by-Side Simulation)
let forecastRequestId = 0;

/**
 * Format an ISO string or YYYY-MM date string into short month and year (e.g., 'Oct 2026').
 * @param {string} dateStr
 * @returns {string}
 */
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
    const d = typeof parseUtcDate === 'function' ? parseUtcDate(dateStr) : new Date(dateStr);
    if (d && !isNaN(d.getTime())) {
      return d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
    }
  } catch (_) {}
  return dateStr;
}

/**
 * Project a date by adding days to current date.
 * @param {number} days
 * @returns {string}
 */
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

/**
 * Resets the forecast card UI to idle/standby.
 */
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

/**
 * Render the baseline replacement forecast card with degradation metrics.
 * @param {Object} forecast
 */
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

/**
 * Render side-by-side simulation comparison drawer for 80% charge cap.
 * @param {Object} forecast
 */
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

/**
 * Render insufficient data state in the forecast card.
 * @param {string} message
 */
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

/**
 * Render error state in the forecast card.
 * @param {string} message
 * @param {string} subtext
 */
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

/**
 * Handle user toggle of 80% charge limit simulation.
 * @param {Event} e
 */
async function handleSimCapToggle(e) {
  // Preserve scroll position to eliminate any jump on click or reflow
  const savedScrollY = window.scrollY || window.pageYOffset || document.documentElement?.scrollTop || 0;

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

// Global scope export for classic script tags
if (typeof window !== 'undefined') {
  window.forecastRequestId = forecastRequestId;
  window.formatTargetMonthYear = formatTargetMonthYear;
  window.calculateProjectedDateFromDays = calculateProjectedDateFromDays;
  window.renderForecastIdle = renderForecastIdle;
  window.renderForecast = renderForecast;
  window.renderSimulatedForecast = renderSimulatedForecast;
  window.renderForecastInsufficientData = renderForecastInsufficientData;
  window.renderForecastError = renderForecastError;
  window.handleSimCapToggle = handleSimCapToggle;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    formatTargetMonthYear,
    calculateProjectedDateFromDays,
    renderForecastIdle,
    renderForecast,
    renderSimulatedForecast,
    renderForecastInsufficientData,
    renderForecastError,
    handleSimCapToggle,
  };
}
