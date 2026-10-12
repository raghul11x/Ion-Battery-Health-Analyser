/**
 * Ion+ Reusable Single-Instance Tooltip System with Boundary Collision Detection
 * Provides viewport-aware floating tooltips with zero layout shift.
 */

let sharedTooltipEl = null;
let activeTooltipTarget = null;
let tooltipHideTimer = null;
let isTooltipSystemInitialized = false;

function getOrCreateSharedTooltip() {
  if (!sharedTooltipEl) {
    sharedTooltipEl = document.getElementById('app-tooltip');
    if (!sharedTooltipEl) {
      sharedTooltipEl = document.createElement('div');
      sharedTooltipEl.id = 'app-tooltip';
      sharedTooltipEl.className = 'fixed z-[9999] pointer-events-none px-2.5 py-1.5 rounded-lg bg-[#0F1024]/95 border border-white/15 text-[11px] font-medium text-zinc-200 shadow-2xl backdrop-blur-md transition-opacity duration-150 opacity-0 hidden max-w-xs';
      sharedTooltipEl.setAttribute('role', 'tooltip');
      sharedTooltipEl.setAttribute('aria-hidden', 'true');
      document.body.appendChild(sharedTooltipEl);
    }
  }
  return sharedTooltipEl;
}

/**
 * Positions the tooltip relative to triggerEl, clamping strictly within
 * the visible viewport boundaries (window.innerWidth / window.innerHeight).
 */
function positionSharedTooltip(triggerEl, tipEl) {
  const margin = 10; // Minimum margin from viewport edge (px)
  const gap = 8; // Vertical gap from trigger (px)
  const triggerRect = triggerEl.getBoundingClientRect();

  // Reset positioning styles to measure natural unconstrained dimensions
  tipEl.style.left = '0px';
  tipEl.style.top = '0px';
  tipEl.style.right = 'auto';
  tipEl.style.bottom = 'auto';

  const tipRect = tipEl.getBoundingClientRect();
  const tipWidth = tipRect.width;
  const tipHeight = tipRect.height;
  const vpWidth = window.innerWidth;
  const vpHeight = window.innerHeight;

  // 1. Horizontal Calculation & Boundary Collision Detection
  // Center horizontally over the trigger element by default
  let left = triggerRect.left + (triggerRect.width / 2) - (tipWidth / 2);

  // If overflowing the right window edge, flip to align with the trigger's right side
  if (left + tipWidth > vpWidth - margin) {
    const rightAligned = triggerRect.right - tipWidth;
    left = Math.min(rightAligned, vpWidth - tipWidth - margin);
  }

  // If overflowing the left window edge, flip to align with the trigger's left side
  if (left < margin) {
    left = Math.max(triggerRect.left, margin);
  }

  // Strict clamp ensuring right <= vpWidth - margin and left >= margin
  left = Math.max(margin, Math.min(left, vpWidth - tipWidth - margin));

  // 2. Vertical Calculation & Boundary Collision Detection
  // Position directly below the trigger by default
  let top = triggerRect.bottom + gap;

  // If overflowing bottom window edge, flip to position directly above the trigger
  if (top + tipHeight > vpHeight - margin) {
    top = triggerRect.top - tipHeight - gap;
  }

  // If flipped above and overflowing top window edge, clamp to top margin
  if (top < margin) {
    top = margin;
  }

  tipEl.style.left = `${Math.round(left)}px`;
  tipEl.style.top = `${Math.round(top)}px`;
}

function showSharedTooltip(triggerEl) {
  const text = triggerEl.getAttribute('data-tooltip') || triggerEl.getAttribute('title');
  if (!text || !text.trim()) return;

  // Strip native title attribute to permanently prevent browser/OS duplicate tooltip popup
  if (triggerEl.hasAttribute('title')) {
    triggerEl.setAttribute('data-tooltip', text.trim());
    triggerEl.removeAttribute('title');
  }

  if (tooltipHideTimer) {
    clearTimeout(tooltipHideTimer);
    tooltipHideTimer = null;
  }

  activeTooltipTarget = triggerEl;
  const tip = getOrCreateSharedTooltip();
  tip.textContent = text.trim();

  // Make visible in DOM to measure bounding dimensions accurately
  tip.classList.remove('hidden');

  // Compute collision-free coordinates
  positionSharedTooltip(triggerEl, tip);

  // Trigger smooth fade-in
  requestAnimationFrame(() => {
    if (activeTooltipTarget === triggerEl) {
      tip.classList.remove('opacity-0');
      tip.classList.add('opacity-100');
      tip.setAttribute('aria-hidden', 'false');
    }
  });
}

function hideSharedTooltip(triggerEl = null) {
  if (triggerEl && activeTooltipTarget !== triggerEl) {
    return;
  }
  activeTooltipTarget = null;
  const tip = getOrCreateSharedTooltip();
  tip.classList.remove('opacity-100');
  tip.classList.add('opacity-0');
  tip.setAttribute('aria-hidden', 'true');

  if (tooltipHideTimer) clearTimeout(tooltipHideTimer);
  tooltipHideTimer = setTimeout(() => {
    if (!activeTooltipTarget) {
      tip.classList.add('hidden');
    }
  }, 160);
}

function initSharedTooltips() {
  if (isTooltipSystemInitialized) return;
  isTooltipSystemInitialized = true;

  getOrCreateSharedTooltip();

  // Strip existing title attributes from any tooltip elements on page load
  document.querySelectorAll('[data-tooltip]').forEach(el => {
    if (el.hasAttribute('title')) {
      el.removeAttribute('title');
    }
  });

  // Delegated event listening guarantees:
  // 1. Single shared tooltip instance reused always.
  // 2. Listeners attached exactly once on document - immune to re-renders or stacking duplicates.
  document.addEventListener('mouseover', (e) => {
    const target = e.target.closest('[data-tooltip]');
    if (target) {
      showSharedTooltip(target);
    }
  }, { passive: true });

  document.addEventListener('mouseout', (e) => {
    const target = e.target.closest('[data-tooltip]');
    if (target) {
      hideSharedTooltip(target);
    }
  }, { passive: true });

  document.addEventListener('focusin', (e) => {
    const target = e.target.closest('[data-tooltip]');
    if (target) {
      showSharedTooltip(target);
    }
  }, { passive: true });

  document.addEventListener('focusout', (e) => {
    const target = e.target.closest('[data-tooltip]');
    if (target) {
      hideSharedTooltip(target);
    }
  }, { passive: true });

  // Reposition on window resize if active
  window.addEventListener('resize', () => {
    if (activeTooltipTarget) {
      positionSharedTooltip(activeTooltipTarget, getOrCreateSharedTooltip());
    }
  }, { passive: true });

  // Dismiss on scroll
  window.addEventListener('scroll', () => {
    if (activeTooltipTarget) {
      hideSharedTooltip();
    }
  }, { passive: true });
}

// Global scope export for classic script tags
window.initSharedTooltips = initSharedTooltips;
window.positionSharedTooltip = positionSharedTooltip;
window.showSharedTooltip = showSharedTooltip;
window.hideSharedTooltip = hideSharedTooltip;
window.getOrCreateSharedTooltip = getOrCreateSharedTooltip;
