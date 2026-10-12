/**
 * Ion+ Disconnected Device Last-Seen Subsystem
 * Tracks previously connected devices and renders human-readable last-seen context:
 * - Relative time formatting (e.g. "just now", "5 min ago", "2 hours ago", "yesterday")
 * - 8-second debounce TTL cache for /api/devices queries
 * - Connection bar status label updates when no device is actively attached
 */

// Exclusive cache state for device history lookups
let cachedDevices = [];
let lastDevicesFetchTime = 0;

/**
 * Safely parse UTC ISO date string with fallback.
 * @param {string} isoStr
 * @returns {Date}
 */
function _parseUtcDate(isoStr) {
  if (typeof parseUtcDate === 'function') {
    return parseUtcDate(isoStr);
  }
  if (!isoStr) return new Date();
  const norm = isoStr.includes('T') ? isoStr : isoStr.replace(' ', 'T');
  const hasTz = norm.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(norm);
  const finalIso = hasTz ? norm : norm + 'Z';
  const d = new Date(finalIso);
  return isNaN(d.getTime()) ? new Date(isoStr) : d;
}

/**
 * Format an ISO date string into a concise relative time string.
 * @param {string} isoString
 * @returns {string|null}
 */
function formatRelativeTime(isoString) {
  if (!isoString) return null;
  const d = _parseUtcDate(isoString);
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

/**
 * Fetch recently seen devices from API with an 8-second in-memory cache.
 * @returns {Promise<Array>}
 */
async function fetchRecentDevices() {
  const now = Date.now();
  const currentLastFetch = (typeof state !== 'undefined' && state && typeof state.lastDevicesFetchTime === 'number')
    ? state.lastDevicesFetchTime
    : lastDevicesFetchTime;
  const currentCached = (typeof state !== 'undefined' && state && Array.isArray(state.cachedDevices))
    ? state.cachedDevices
    : cachedDevices;

  if (now - (currentLastFetch || 0) < 8000 && currentCached && currentCached.length > 0) {
    return currentCached;
  }

  try {
    const res = await fetch('/api/devices');
    if (res.ok) {
      const data = await res.json();
      cachedDevices = data;
      lastDevicesFetchTime = now;
      if (typeof state !== 'undefined' && state) {
        state.cachedDevices = data;
        state.lastDevicesFetchTime = now;
      }
      return data;
    }
  } catch (err) {
    console.warn('Failed to fetch devices for last-seen context:', err);
  }
  return currentCached || [];
}

/**
 * Update connection bar last-seen device label when no device is actively attached.
 */
async function updateLastSeenDeviceLabel() {
  const labelEl = (typeof el !== 'undefined' && el.connLastSeenLabel) || document.getElementById('conn-last-seen-label');
  if (!labelEl) return;

  const isConn = (typeof state !== 'undefined' && state && (
    state.snapshot?.connected || state.systemStatus?.connected_devices?.some(d => d.state === 'device')
  ));

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

  valid.sort((a, b) => _parseUtcDate(b.last_seen) - _parseUtcDate(a.last_seen));
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

// Global scope export for classic script tags
if (typeof window !== 'undefined') {
  window.formatRelativeTime = formatRelativeTime;
  window.fetchRecentDevices = fetchRecentDevices;
  window.updateLastSeenDeviceLabel = updateLastSeenDeviceLabel;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    formatRelativeTime,
    fetchRecentDevices,
    updateLastSeenDeviceLabel,
  };
}
