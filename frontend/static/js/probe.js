/**
 * Ion+ Hardware Diagnostics Probe Subsystem
 * Renders low-level hardware inspection data:
 * - OEM sysfs power supply register paths and permissions
 * - Raw dumpsys battery output table
 * - Standby and error state presentation cards
 */

/**
 * Render the hardware diagnostics probe view.
 */
function renderProbe() {
  const container = (typeof el !== 'undefined' && el.probeContentContainer) || document.getElementById('probe-content-container');
  if (!container) return;

  const p = (typeof state !== 'undefined' && state && state.probeReport) ? state.probeReport : null;
  if (!p) {
    container.innerHTML = `
      <div class="eura-dark-card p-6 text-center text-zinc-400 text-xs">
        Connect phone via USB-C to inspect readable OEM sysfs hardware paths.
      </div>
    `;
    return;
  }

  if (p.error) {
    container.innerHTML = `
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

  container.innerHTML = `
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

// Global scope export for classic script tags
if (typeof window !== 'undefined') {
  window.renderProbe = renderProbe;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    renderProbe,
  };
}
