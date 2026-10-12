/**
 * Ion+ Active Coulomb Calibration Subsystem
 * Coordinates empirical current integration sampling over USB-C,
 * active Coulomb counting calibration polling, hardware simulation runs,
 * and calibrated SoH extrapolation UI rendering.
 */

/**
 * Start active Coulomb calibration or simulation.
 * @param {boolean} simulate - Whether to run simulated Coulomb counter
 */
async function startCalibration(simulate = false) {
  const isConnected = typeof AppState !== 'undefined' && AppState.connected;
  if (!isConnected && !simulate) {
    alert('Please connect an Android phone over USB-C to run empirical Coulomb calibration.');
    return;
  }

  const calStartBtn = (typeof el !== 'undefined' && el.calStartBtn) || document.getElementById('cal-start-btn');
  const calSimBtn = (typeof el !== 'undefined' && el.calSimBtn) || document.getElementById('cal-sim-btn');
  const calStopBtn = (typeof el !== 'undefined' && el.calStopBtn) || document.getElementById('cal-stop-btn');
  const calStatusBadge = (typeof el !== 'undefined' && el.calStatusBadge) || document.getElementById('cal-status-badge');

  try {
    if (calStartBtn) calStartBtn.disabled = true;
    if (calSimBtn) calSimBtn.disabled = true;

    const res = await fetch('/api/calibration/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ simulate }),
    });

    if (res.ok) {
      calStopBtn?.classList.remove('hidden');
      if (calStatusBadge) {
        calStatusBadge.textContent = simulate ? 'Simulating...' : 'Sampling...';
        calStatusBadge.className = 'px-3 py-0.5 rounded-full text-xs font-semibold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 font-mono animate-pulse';
      }

      if (typeof state !== 'undefined' && state.calibrationPollTimer) {
        clearInterval(state.calibrationPollTimer);
      }
      const pollTimer = setInterval(pollCalibrationStatus, 600);
      if (typeof state !== 'undefined') {
        state.calibrationPollTimer = pollTimer;
      }
    }
  } catch (err) {
    console.warn('Failed to start calibration:', err);
  }
}

/**
 * Poll active calibration progress from /api/calibration/status.
 */
async function pollCalibrationStatus() {
  const calCurrentText = (typeof el !== 'undefined' && el.calCurrentText) || document.getElementById('cal-current-text');
  const calAccumulatedText = (typeof el !== 'undefined' && el.calAccumulatedText) || document.getElementById('cal-accumulated-text');
  const calVerdictBox = (typeof el !== 'undefined' && el.calVerdictBox) || document.getElementById('cal-verdict-box');
  const calExtrapolatedText = (typeof el !== 'undefined' && el.calExtrapolatedText) || document.getElementById('cal-extrapolated-text');
  const calHealthPctText = (typeof el !== 'undefined' && el.calHealthPctText) || document.getElementById('cal-health-pct-text');
  const calComparisonSubtext = (typeof el !== 'undefined' && el.calComparisonSubtext) || document.getElementById('cal-comparison-subtext');
  const calStopBtn = (typeof el !== 'undefined' && el.calStopBtn) || document.getElementById('cal-stop-btn');
  const calStartBtn = (typeof el !== 'undefined' && el.calStartBtn) || document.getElementById('cal-start-btn');
  const calSimBtn = (typeof el !== 'undefined' && el.calSimBtn) || document.getElementById('cal-sim-btn');
  const calStatusBadge = (typeof el !== 'undefined' && el.calStatusBadge) || document.getElementById('cal-status-badge');

  try {
    const res = await fetch('/api/calibration/status');
    if (res.ok) {
      const data = await res.json();
      if (calCurrentText) calCurrentText.textContent = `+${Math.round(data.current_ma || 0)} mA`;
      if (calAccumulatedText) calAccumulatedText.textContent = `${Math.round(data.accumulated_mah || 0)} mAh`;

      if (data.extrapolated_capacity_mah > 0) {
        if (calVerdictBox) calVerdictBox.classList.remove('hidden');
        if (calExtrapolatedText) calExtrapolatedText.textContent = `${Math.round(data.extrapolated_capacity_mah)} mAh`;
        if (calHealthPctText) calHealthPctText.textContent = `${data.calibrated_health_pct}% SoH`;
        if (calComparisonSubtext) {
          calComparisonSubtext.textContent = `Measured over Δ${data.delta_level_pct}% charge (${Math.round(data.accumulated_mah)} mAh integrated).`;
        }
      }

      if (!data.is_running && data.status === 'completed') {
        if (typeof state !== 'undefined' && state.calibrationPollTimer) {
          clearInterval(state.calibrationPollTimer);
          state.calibrationPollTimer = null;
        }
        if (calStopBtn) calStopBtn.classList.add('hidden');
        if (calStartBtn) calStartBtn.disabled = false;
        if (calSimBtn) calSimBtn.disabled = false;
        if (calStatusBadge) {
          calStatusBadge.textContent = 'Completed';
          calStatusBadge.className = 'px-3 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-mono';
        }
      }
    }
  } catch (err) {
    console.warn('Calibration poll error:', err);
  }
}

/**
 * Stop currently executing active calibration session.
 */
async function stopCalibration() {
  const calStopBtn = (typeof el !== 'undefined' && el.calStopBtn) || document.getElementById('cal-stop-btn');
  const calStartBtn = (typeof el !== 'undefined' && el.calStartBtn) || document.getElementById('cal-start-btn');
  const calSimBtn = (typeof el !== 'undefined' && el.calSimBtn) || document.getElementById('cal-sim-btn');

  try {
    if (typeof state !== 'undefined' && state.calibrationPollTimer) {
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
    if (calStopBtn) calStopBtn.classList.add('hidden');
    if (calStartBtn) calStartBtn.disabled = false;
    if (calSimBtn) calSimBtn.disabled = false;
  }
}

/**
 * Reset Coulomb Calibration card UI elements to idle baseline state.
 */
function resetCalibrationUI() {
  if (typeof state !== 'undefined' && state.calibrationPollTimer) {
    clearInterval(state.calibrationPollTimer);
    state.calibrationPollTimer = null;
  }
  const calStatusBadge = (typeof el !== 'undefined' && el.calStatusBadge) || document.getElementById('cal-status-badge');
  const calCurrentText = (typeof el !== 'undefined' && el.calCurrentText) || document.getElementById('cal-current-text');
  const calAccumulatedText = (typeof el !== 'undefined' && el.calAccumulatedText) || document.getElementById('cal-accumulated-text');
  const calVerdictBox = (typeof el !== 'undefined' && el.calVerdictBox) || document.getElementById('cal-verdict-box');
  const calExtrapolatedText = (typeof el !== 'undefined' && el.calExtrapolatedText) || document.getElementById('cal-extrapolated-text');
  const calHealthPctText = (typeof el !== 'undefined' && el.calHealthPctText) || document.getElementById('cal-health-pct-text');
  const calComparisonSubtext = (typeof el !== 'undefined' && el.calComparisonSubtext) || document.getElementById('cal-comparison-subtext');
  const calStopBtn = (typeof el !== 'undefined' && el.calStopBtn) || document.getElementById('cal-stop-btn');
  const calStartBtn = (typeof el !== 'undefined' && el.calStartBtn) || document.getElementById('cal-start-btn');
  const calSimBtn = (typeof el !== 'undefined' && el.calSimBtn) || document.getElementById('cal-sim-btn');

  if (calStatusBadge) {
    calStatusBadge.textContent = 'Idle';
    calStatusBadge.className = 'px-3 py-0.5 rounded-full text-xs font-semibold bg-zinc-800 text-zinc-400 border border-white/10 font-mono';
  }
  if (calCurrentText) calCurrentText.textContent = '0 mA';
  if (calAccumulatedText) calAccumulatedText.textContent = '0 mAh';
  if (calVerdictBox) calVerdictBox.classList.add('hidden');
  if (calExtrapolatedText) calExtrapolatedText.textContent = '— mAh';
  if (calHealthPctText) calHealthPctText.textContent = '—% SoH';
  if (calComparisonSubtext) calComparisonSubtext.textContent = 'Validated against OEM design specification.';
  if (calStopBtn) calStopBtn.classList.add('hidden');
  if (calStartBtn) {
    calStartBtn.disabled = true;
    calStartBtn.setAttribute('data-tooltip', 'Connect phone to calibrate');
  }
  if (calSimBtn) calSimBtn.disabled = false;
}

/**
 * Attach click event listeners for Coulomb calibration controls.
 */
function initCalibrationListeners() {
  const calStartBtn = (typeof el !== 'undefined' && el.calStartBtn) || document.getElementById('cal-start-btn');
  const calSimBtn = (typeof el !== 'undefined' && el.calSimBtn) || document.getElementById('cal-sim-btn');
  const calStopBtn = (typeof el !== 'undefined' && el.calStopBtn) || document.getElementById('cal-stop-btn');

  calStartBtn?.addEventListener('click', () => startCalibration(false));
  calSimBtn?.addEventListener('click', () => startCalibration(true));
  calStopBtn?.addEventListener('click', stopCalibration);
}

// Global scope export for classic script tags
if (typeof window !== 'undefined') {
  window.startCalibration = startCalibration;
  window.pollCalibrationStatus = pollCalibrationStatus;
  window.stopCalibration = stopCalibration;
  window.resetCalibrationUI = resetCalibrationUI;
  window.initCalibrationListeners = initCalibrationListeners;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    startCalibration,
    pollCalibrationStatus,
    stopCalibration,
    resetCalibrationUI,
    initCalibrationListeners,
  };
}
