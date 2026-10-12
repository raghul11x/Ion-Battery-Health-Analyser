/**
 * Approved Aurora Background Initialization (Reference Implementation)
 * Sets displacement map tile for fluted glass and manages drift pause/resume.
 */
function initAuroraBg() {
  const root = document.querySelector('.aurora-bg');
  if (!root) return;

  // Fluted-glass tile used as the displacement map
  const TILE = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1 1' color-interpolation-filters='sRGB'>" +
    "<g><rect width='1' height='1' fill='black'/>" +
    "<rect width='1' height='1' fill='url(#red)' style='mix-blend-mode:screen'/>" +
    "<rect width='1' height='1' fill='url(#green)' style='mix-blend-mode:screen'/>" +
    "<rect width='1' height='1' fill='url(#yellow)' style='mix-blend-mode:screen'/></g>" +
    "<defs>" +
    "<radialGradient id='yellow' cx='0' cy='0' r='1'><stop stop-color='yellow'/><stop stop-color='yellow' offset='1' stop-opacity='0'/></radialGradient>" +
    "<radialGradient id='green' cx='1' cy='0' r='1'><stop stop-color='green'/><stop stop-color='green' offset='1' stop-opacity='0'/></radialGradient>" +
    "<radialGradient id='red' cx='0' cy='1' r='1'><stop stop-color='red'/><stop stop-color='red' offset='1' stop-opacity='0'/></radialGradient>" +
    "</defs></svg>";
  const fluteImg = document.getElementById('aurora-flute-img');
  if (fluteImg) {
    fluteImg.setAttribute('href', 'data:image/svg+xml,' + encodeURIComponent(TILE));
  }
  // Pause drift when hidden or blurred to conserve GPU/battery
  const pause = () => root.classList.add('is-paused');
  const resume = () => { if (!document.hidden) root.classList.remove('is-paused'); };
  document.addEventListener('visibilitychange', () => (document.hidden ? pause() : resume()));
  window.addEventListener('blur', () => pause());
  window.addEventListener('focus', () => { if (!document.hidden) resume(); });

  // Passive scroll listener: pause loop during active scroll and resume on scroll-end
  let scrollTimeout = null;
  window.addEventListener('scroll', () => {
    root.classList.add('is-scrolling');
    if (scrollTimeout) clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(() => {
      root.classList.remove('is-scrolling');
    }, 150);
  }, { passive: true });
}

// Global scope export for classic script tags
if (typeof window !== 'undefined') {
  window.initAuroraBg = initAuroraBg;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { initAuroraBg };
}
