/**
 * Ion+ Device Connected Toast Subsystem (Design Doc v2 §5.2)
 * Manages the floating glass toast notification when a USB-C Android device connects,
 * entrance/exit animations, 3-second hold timer, progress bar drain animation,
 * and accessibility (prefers-reduced-motion) compliance.
 */

// Device Connected Toast State & Management
const toastState = {
  wasConnected: false,
  lastSerial: null,
  holdTimer: null,
  exitTimer: null,
  lastDismissedAt: 0,
};

/**
 * Format connected device model and short serial for the toast subtitle.
 * @param {Object} activeDev
 * @returns {string}
 */
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

/**
 * Present the device connected toast notification.
 * @param {string} deviceName
 */
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

  // Reset progress bar drain animation asynchronously
  if (progressEl) {
    progressEl.style.animation = 'none';
    requestAnimationFrame(() => {
      progressEl.style.animation = '';
    });
  }

  // Ensure visible with entrance animation
  if (!toastEl.classList.contains('toast-visible')) {
    requestAnimationFrame(() => {
      toastEl.classList.add('toast-visible');
    });
  }

  // 3-second hold timer
  toastState.holdTimer = setTimeout(() => {
    dismissDeviceConnectedToast();
  }, 3000);
}

/**
 * Dismiss the device connected toast notification with optional immediate exit.
 * @param {boolean} immediate
 */
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

// Global scope export for classic script tags
if (typeof window !== 'undefined') {
  window.toastState = toastState;
  window.formatConnectedDeviceSubtitle = formatConnectedDeviceSubtitle;
  window.showDeviceConnectedToast = showDeviceConnectedToast;
  window.dismissDeviceConnectedToast = dismissDeviceConnectedToast;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    toastState,
    formatConnectedDeviceSubtitle,
    showDeviceConnectedToast,
    dismissDeviceConnectedToast,
  };
}
