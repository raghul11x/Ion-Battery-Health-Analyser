/**
 * Ion+ Telemetry Chart Subsystem
 * Renders the EURA Capacity Retention Curve using Chart.js,
 * manages IntersectionObserver-based viewport culling,
 * dual Y-axes (Battery Health % / Temperature), custom obsidian tooltips,
 * stale sync state indicators, timeline filters, and metric toggle controls.
 */

let chartObserver = null;
let chartIsVisible = true;
let chartNeedsUpdate = false;
let internalChartInstance = null;

/**
 * Access the active Chart.js instance safely across global and local scope.
 */
function getTelemetryChartInstance() {
  if (typeof state !== 'undefined' && state && state.chartInstance) {
    return state.chartInstance;
  }
  return internalChartInstance;
}

/**
 * Update the active Chart.js instance safely across global and local scope.
 */
function setTelemetryChartInstance(inst) {
  internalChartInstance = inst;
  if (typeof state !== 'undefined' && state) {
    state.chartInstance = inst;
  }
}

/**
 * Formats an ISO timestamp for the chart last synced label.
 * @param {string} isoString
 * @returns {string}
 */
function formatSyncedTimestamp(isoString) {
  if (!isoString) return 'Recently';
  try {
    const d = typeof parseUtcDate === 'function' ? parseUtcDate(isoString) : new Date(isoString);
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

/**
 * Updates the "Last synced: ..." status label above the chart when in disconnected state.
 */
function updateChartLastSyncedLabel() {
  const labelEl = (typeof el !== 'undefined' && el.chartLastSyncedLabel) || document.getElementById('chart-last-synced-label');
  if (!labelEl) return;

  const isConn = Boolean(
    (typeof state !== 'undefined' && state.snapshot?.connected) ||
    (typeof state !== 'undefined' && state.systemStatus?.connected_devices?.some(d => d.state === 'device')) ||
    (typeof AppState !== 'undefined' && AppState.connected)
  );

  if (isConn) {
    labelEl.classList.add('hidden');
    labelEl.textContent = '';
    return;
  }

  let latestTimestamp = null;
  if (typeof state !== 'undefined' && state.history && state.history.length > 0) {
    for (const r of state.history) {
      if (r.timestamp) {
        const rDate = typeof parseUtcDate === 'function' ? parseUtcDate(r.timestamp) : new Date(r.timestamp);
        const latestDate = latestTimestamp ? (typeof parseUtcDate === 'function' ? parseUtcDate(latestTimestamp) : new Date(latestTimestamp)) : null;
        if (!latestTimestamp || (rDate > latestDate)) {
          latestTimestamp = r.timestamp;
        }
      }
    }
  } else if (typeof state !== 'undefined' && state.snapshot && state.snapshot.timestamp) {
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

/**
 * Initialize IntersectionObserver to defer chart re-renders when scrolled out of view.
 */
function initChartObserver() {
  const container = (typeof el !== 'undefined' && el.chartCanvasContainer) ||
    document.getElementById('chart-canvas-container') ||
    document.getElementById('chart-container');
  if (!container || typeof IntersectionObserver === 'undefined') return;

  if (chartObserver) {
    try { chartObserver.disconnect(); } catch (_) {}
  }

  chartObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      chartIsVisible = entry.isIntersecting;
      if (chartIsVisible && chartNeedsUpdate) {
        chartNeedsUpdate = false;
        if (typeof renderTelemetryChart === 'function') {
          renderTelemetryChart();
        }
      }
    }
  }, { threshold: 0.05 });

  chartObserver.observe(container);
}

/**
 * Main telemetry chart renderer.
 * Handles empty states, viewport culling, Chart.js updates/instantiations,
 * dual-axis configurations, tooltips, and stale state indicators.
 * @param {Array|null} readings
 */
function renderTelemetryChart(readings = null) {
  const historyReadings = readings || (typeof state !== 'undefined' ? state.history : []) || [];
  const chartCanvas = (typeof el !== 'undefined' && el.chartCanvas) || document.getElementById('heart-report-chart');
  if (!chartCanvas) return;

  const emptyStateEl = (typeof el !== 'undefined' && el.chartEmptyState) || document.getElementById('chart-empty-state');
  const canvasContainer = (typeof el !== 'undefined' && el.chartCanvasContainer) || document.getElementById('chart-canvas-container');
  const lastSyncedLabel = (typeof el !== 'undefined' && el.chartLastSyncedLabel) || document.getElementById('chart-last-synced-label');

  if (!chartIsVisible) {
    chartNeedsUpdate = true;
    return;
  }

  const chartInst = getTelemetryChartInstance();

  if (historyReadings.length > 0) {
    if (emptyStateEl) emptyStateEl.classList.add('hidden');
    const labels = historyReadings.map(r => {
      const d = typeof parseUtcDate === 'function' ? parseUtcDate(r.timestamp) : new Date(r.timestamp);
      return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${d.getMinutes().toString().padStart(2, '0')}`;
    });

    const healthVals = historyReadings.map(r => r.health_pct);
    const tempVals = historyReadings.map(r => r.temperature_c);

    if (chartInst) {
      chartInst.data.labels = labels;
      chartInst.data.datasets[0].data = healthVals;
      chartInst.data.datasets[1].data = tempVals;
      chartInst.data.datasets[0].pointRadius = historyReadings.length > 40 ? 0 : 3;
      if (chartInst.options?.scales?.yHealth) {
        chartInst.options.scales.yHealth.min = Math.max(60, Math.floor(Math.min(...healthVals) - 4));
      }
      chartInst.update('none');
    } else if (typeof Chart !== 'undefined') {
      const ctx = chartCanvas.getContext('2d');
      // Subtle gradient beneath white curve
      const gradient = ctx.createLinearGradient(0, 0, 0, 240);
      gradient.addColorStop(0, 'rgba(255, 255, 255, 0.15)');
      gradient.addColorStop(1, 'rgba(255, 255, 255, 0.0)');

      const newInst = new Chart(ctx, {
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
              pointRadius: historyReadings.length > 40 ? 0 : 3,
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
                  const r = historyReadings[context.dataIndex];
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
                  const r = historyReadings[contexts[0].dataIndex];
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

      setTelemetryChartInstance(newInst);
    }
  } else {
    // readings.length === 0: show clean empty state
    if (emptyStateEl) emptyStateEl.classList.remove('hidden');
    if (chartInst) {
      chartInst.data.labels = [];
      chartInst.data.datasets[0].data = [];
      chartInst.data.datasets[1].data = [];
      chartInst.update('none');
    }
  }

  // Stale chart sync check
  const isConn = Boolean(
    (typeof state !== 'undefined' && state.snapshot?.connected) ||
    (typeof state !== 'undefined' && state.systemStatus?.connected_devices?.some(d => d.state === 'device')) ||
    (typeof AppState !== 'undefined' && AppState.connected)
  );

  if (!isConn) {
    if (canvasContainer) {
      canvasContainer.classList.add('chart-stale-dimmed');
    }
    updateChartLastSyncedLabel();
  } else {
    if (canvasContainer) {
      canvasContainer.classList.remove('chart-stale-dimmed');
    }
    if (lastSyncedLabel) {
      lastSyncedLabel.classList.add('hidden');
      lastSyncedLabel.textContent = '';
    }
  }
}

/**
 * Attach event listeners for timeline range filters and chart metric visibility toggles.
 */
function initChartListeners() {
  // Timeline Range Filter Buttons (7D, 14D, 30D, 90D)
  document.querySelectorAll('.time-filter-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.time-filter-pill').forEach(b => {
        b.classList.remove('active', 'bg-white', 'text-black', 'shadow');
        b.classList.add('text-zinc-400');
      });
      btn.classList.add('active', 'bg-white', 'text-black', 'shadow');
      btn.classList.remove('text-zinc-400');
      const d = parseInt(btn.dataset.days, 10);
      if (typeof state !== 'undefined' && state) {
        state.selectedDays = d;
      }
      if (typeof fetchHistory === 'function') {
        fetchHistory(d);
      }
    });
  });

  // Chart Metric Toggle Buttons (Health % / Temp)
  document.querySelectorAll('.chart-metric-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      const chartInst = getTelemetryChartInstance();
      if (!chartInst) return;
      const idx = parseInt(btn.dataset.dataset, 10);
      const isVisible = chartInst.isDatasetVisible(idx);
      chartInst.setDatasetVisibility(idx, !isVisible);
      chartInst.update();
      btn.classList.toggle('active', !isVisible);
    });
  });
}

/**
 * Destroy existing Chart instance and clean up references.
 */
function destroyTelemetryChart() {
  const chartInst = getTelemetryChartInstance();
  if (chartInst) {
    try {
      chartInst.destroy();
    } catch (_) {}
    setTelemetryChartInstance(null);
  }
}

// Global scope export for classic script tags
if (typeof window !== 'undefined') {
  window.formatSyncedTimestamp = formatSyncedTimestamp;
  window.updateChartLastSyncedLabel = updateChartLastSyncedLabel;
  window.initChartObserver = initChartObserver;
  window.renderTelemetryChart = renderTelemetryChart;
  window.initChartListeners = initChartListeners;
  window.destroyTelemetryChart = destroyTelemetryChart;
  window.getTelemetryChartInstance = getTelemetryChartInstance;
  window.setTelemetryChartInstance = setTelemetryChartInstance;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    formatSyncedTimestamp,
    updateChartLastSyncedLabel,
    initChartObserver,
    renderTelemetryChart,
    initChartListeners,
    destroyTelemetryChart,
    getTelemetryChartInstance,
    setTelemetryChartInstance,
  };
}
