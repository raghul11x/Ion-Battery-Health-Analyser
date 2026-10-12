/**
 * Ion+ Pure Formatters & String Utilities
 * Deterministic helper functions for unit conversion, date formatting, and HTML escaping.
 */

function formatCapacity(uah) {
  if (uah === null || uah === undefined || isNaN(uah)) return '—';
  const mah = Math.round(uah / 1000);
  return `${mah.toLocaleString()} mAh`;
}

function formatDate(isoStr) {
  if (!isoStr) return '—';
  try {
    const d = parseUtcDate(isoStr);
    if (!d || isNaN(d.getTime())) return isoStr;
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

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Global scope export for classic script tags
if (typeof window !== 'undefined') {
  window.formatCapacity = formatCapacity;
  window.formatDate = formatDate;
  window.escapeHtml = escapeHtml;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    formatCapacity,
    formatDate,
    escapeHtml,
  };
}
