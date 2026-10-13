/**
 * Ion+ Virtualized History Log Table Subsystem
 * High-performance virtualized table renderer for 5,000+ telemetry records:
 * - 60+ FPS DOM windowing with top and bottom spacer rows
 * - Dynamic viewport calculation with buffer rows
 * - Microsecond RAF-throttled scroll event handler
 * - Row styling with health pills, voltage conversion, temperature, and cycle counts
 */

// Virtualized History Log Table Implementation State
let virtualHistoryState = {
  items: [],
  rowHeight: 44,
  container: null,
  scrollListenerAttached: false,
  lastRenderedStart: -1,
  lastRenderedEnd: -1,
};

/**
 * Defensive date formatter fallback.
 * @param {string} ts
 * @returns {string}
 */
function _formatDate(ts) {
  if (typeof formatDate === 'function') {
    return formatDate(ts);
  }
  if (!ts) return '—';
  try {
    return new Date(ts).toLocaleString();
  } catch (_) {
    return String(ts);
  }
}

/**
 * Defensive resolver for history table body element.
 * @returns {HTMLElement|null}
 */
function _getTableBody() {
  return (typeof el !== 'undefined' && el && el.historyTableBody) || document.getElementById('history-table-body');
}

/**
 * Defensive resolver for history scroll container element.
 * @returns {HTMLElement|null}
 */
function _getScrollContainer() {
  return document.getElementById('history-scroll-container');
}

/**
 * Signal active user scrolling to the render scheduler without coupling.
 */
function _markUserScrolling() {
  const now = performance.now();
  try {
    if (typeof lastScrollTimestamp !== 'undefined') {
      lastScrollTimestamp = now;
    }
  } catch (_) {}
  try {
    if (typeof window !== 'undefined') {
      window.lastScrollTimestamp = now;
    }
  } catch (_) {}
}

/**
 * Primary entrypoint for rendering virtualized telemetry history.
 * @param {Array} items - Array of history reading records
 */
function renderVirtualHistory(items) {
  if (items) {
    virtualHistoryState.items = items;
    virtualHistoryState.lastRenderedStart = -1;
    virtualHistoryState.lastRenderedEnd = -1;
  }
  const container = _getScrollContainer();
  const tableBody = _getTableBody();
  if (!container || !tableBody) return;

  virtualHistoryState.container = container;

  if (!virtualHistoryState.scrollListenerAttached) {
    virtualHistoryState.scrollListenerAttached = true;
    let scrollRaf = null;
    container.addEventListener('scroll', () => {
      _markUserScrolling();
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

/**
 * Compute visible slice and update table DOM with spacer rows.
 */
function updateVirtualHistoryView() {
  const { items, rowHeight, container } = virtualHistoryState;
  const tableBody = _getTableBody();
  if (!container || !tableBody) return;
  if (!items || items.length === 0) {
    tableBody.innerHTML = `
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
        <td class="py-3 px-4 font-mono text-zinc-400">${_formatDate(r.timestamp)}</td>
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

  tableBody.innerHTML = topRow + rowsHtml + bottomRow;
}

// Global scope export for classic script tags
if (typeof window !== 'undefined') {
  window.renderVirtualHistory = renderVirtualHistory;
  window.updateVirtualHistoryView = updateVirtualHistoryView;
  window.virtualHistoryState = virtualHistoryState;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    renderVirtualHistory,
    updateVirtualHistoryView,
    virtualHistoryState,
  };
}
