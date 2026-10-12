/**
 * Ion+ Live Device Status Feed Subsystem
 * Manages the collapsible live device status feed and renders incoming device status events:
 * - Toggle expanded/collapsed state with keyboard and aria-expanded accessibility
 * - SessionStorage persistence for feed toggle state ('ion_status_feed_expanded')
 * - Real-time event feed rendering with category badges, timestamps, and live ping indicators
 * - Multi-mode UI support: Connected Active, Connected Paused, Demo/Seeded, and Neutral Standby
 */

// Local module state tracking for feed expansion
let isStatusFeedExpanded = false;

/**
 * Defensive HTML escaper fallback.
 * @param {string} str
 * @returns {string}
 */
function _escapeHtml(str) {
  if (typeof escapeHtml === 'function') {
    return escapeHtml(str);
  }
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Defensive timestamp resolver for paused telemetry status.
 * @returns {string}
 */
function _getLastReadingTime() {
  if (typeof getFormattedLastReadingTime === 'function') {
    return getFormattedLastReadingTime();
  }
  return 'Recently';
}

/**
 * Toggle the visibility of the live device status events feed.
 * @param {boolean|null} forceState - Optional explicit open (true) or closed (false) state
 */
function toggleDeviceStatusFeed(forceState = null) {
  const content = (typeof el !== 'undefined' && el.deviceStatusContent) || document.getElementById('device-status-content');
  const chevron = (typeof el !== 'undefined' && el.statusFeedChevron) || document.getElementById('status-feed-chevron');
  const toggleBtn = (typeof el !== 'undefined' && el.deviceStatusToggle) || document.getElementById('device-status-toggle');
  if (!content) return;

  const willExpand = forceState !== null ? forceState : content.classList.contains('hidden');
  if (willExpand) {
    content.classList.remove('hidden');
    if (chevron) chevron.classList.add('rotate-180');
    if (toggleBtn) toggleBtn.setAttribute('aria-expanded', 'true');
    isStatusFeedExpanded = true;
    if (typeof state !== 'undefined' && state) {
      state.statusFeedExpanded = true;
    }
    try { sessionStorage.setItem('ion_status_feed_expanded', 'true'); } catch (_) {}
  } else {
    content.classList.add('hidden');
    if (chevron) chevron.classList.remove('rotate-180');
    if (toggleBtn) toggleBtn.setAttribute('aria-expanded', 'false');
    isStatusFeedExpanded = false;
    if (typeof state !== 'undefined' && state) {
      state.statusFeedExpanded = false;
    }
    try { sessionStorage.setItem('ion_status_feed_expanded', 'false'); } catch (_) {}
  }
}

/**
 * Render the live device status feed header, preview, badges, and event list.
 */
function renderDeviceStatus() {
  const panel = (typeof el !== 'undefined' && el.deviceStatusPanel) || document.getElementById('device-status-panel');
  if (!panel) return;

  const currentAppState = (typeof AppState !== 'undefined' && AppState) ? AppState : {};
  const isConnected = !!currentAppState.connected;
  const isSeeded = currentAppState.mode === 'seeded';
  const isPaused = !!currentAppState.liveTelemetryPaused;
  const currentState = (typeof state !== 'undefined' && state) ? state : {};
  const events = isConnected ? (currentState.deviceStatusEvents || []) : [];

  panel.classList.remove('hidden');

  const previewEl = (typeof el !== 'undefined' && el.statusFeedLatestPreview) || document.getElementById('status-feed-latest-preview');
  const badgeEl = (typeof el !== 'undefined' && el.statusFeedCountBadge) || document.getElementById('status-feed-count-badge');
  const listEl = (typeof el !== 'undefined' && el.deviceStatusList) || document.getElementById('device-status-list');
  const pingEl = (typeof el !== 'undefined' && el.statusFeedPing) || document.getElementById('status-feed-ping');

  if (isConnected && isPaused) {
    const timeStr = _getLastReadingTime();
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

        const time = _escapeHtml(ev.time_display || '—');
        const categoryText = _escapeHtml((ev.category || 'INFO').toUpperCase());
        const msg = _escapeHtml(ev.message || '');
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

        const time = _escapeHtml(ev.time_display || '—');
        const categoryText = _escapeHtml((ev.category || 'INFO').toUpperCase());
        const msg = _escapeHtml(ev.message || '');
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

// Global scope export for classic script tags
if (typeof window !== 'undefined') {
  window.toggleDeviceStatusFeed = toggleDeviceStatusFeed;
  window.renderDeviceStatus = renderDeviceStatus;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    toggleDeviceStatusFeed,
    renderDeviceStatus,
  };
}
