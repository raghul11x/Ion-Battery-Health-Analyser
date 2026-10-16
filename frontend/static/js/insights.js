/**
 * Ion+ Diagnostic Habit Insights Subsystem
 * Renders battery usage habit insights:
 * - Time above 80% charge level percentage
 * - High-speed fast charging exposure percentage
 * - Average cell operating temperature
 * - 30-day health delta percentage and dynamic trend color
 * - Diagnostic habit cards list with trend directions (↑/↓/→) and severity badges
 */

/**
 * Render diagnostic habit insights and metric cards.
 */
function renderInsights() {
  const ins = (typeof state !== 'undefined' && state && state.insights) ? state.insights : null;
  if (!ins) return;

  const metricAbove80 = (typeof el !== 'undefined' && el.metricAbove80) || document.getElementById('metric-above-80');
  const metricFastCharge = (typeof el !== 'undefined' && el.metricFastCharge) || document.getElementById('metric-fast-charge');
  const metricAvgTemp = (typeof el !== 'undefined' && el.metricAvgTemp) || document.getElementById('metric-avg-temp');
  const metricDelta = (typeof el !== 'undefined' && el.metricDelta) || document.getElementById('metric-delta');
  const insightsListContainer = (typeof el !== 'undefined' && el.insightsListContainer) || document.getElementById('insights-list-container');

  if (metricAbove80) metricAbove80.textContent = `${ins.time_above_80_pct}%`;
  if (metricFastCharge) metricFastCharge.textContent = `${ins.fast_charge_pct}%`;
  if (metricAvgTemp) metricAvgTemp.textContent = `${ins.avg_temp_c}°C`;

  const delta = ins.health_delta_pct;
  const sign = delta > 0 ? '+' : '';
  if (metricDelta) {
    metricDelta.textContent = `${sign}${delta}%`;
    if (delta < -1) {
      metricDelta.className = 'text-3xl font-black text-rose-400 font-mono mt-1';
    } else {
      metricDelta.className = 'text-3xl font-black text-emerald-400 font-mono mt-1';
    }
  }

  // Insight cards list
  if (!insightsListContainer) return;

  const list = ins.insights_list || [];
  if (list.length === 0) {
    insightsListContainer.innerHTML = `
      <div class="text-xs text-zinc-500 py-4 text-center">
        No diagnostic habit insights recorded yet.
      </div>
    `;
    return;
  }

  insightsListContainer.innerHTML = list.map(item => {
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
      <div class="insight-item p-4 rounded-2xl bg-[#0B0B10] border border-white/[0.06] flex items-center justify-between gap-4">
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

// Global scope export for classic script tags
if (typeof window !== 'undefined') {
  window.renderInsights = renderInsights;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    renderInsights,
  };
}
