/**
 * Custom tooltip system — simple, reliable, event-delegation based.
 * Reads [title] attributes without removing them (avoids DOM churn).
 * The native browser tooltip delay (~500ms) rarely conflicts.
 */
export function initTooltips() {
  const tip = document.getElementById('custom-tooltip');
  if (!tip) return;

  let isVisible = false;

  document.addEventListener('mouseover', (e) => {
    const el = e.target.closest('[title]');
    if (!el) {
      if (isVisible) {
        tip.classList.remove('visible');
        isVisible = false;
      }
      return;
    }

    const text = el.getAttribute('title');
    if (!text) return;

    tip.textContent = text;
    if (!isVisible) {
      tip.classList.add('visible');
      isVisible = true;
    }
    positionTooltip(e);
  });

  document.addEventListener('mousemove', (e) => {
    if (isVisible) positionTooltip(e);
  });

  document.addEventListener('mouseout', (e) => {
    const el = e.target.closest('[title]');
    if (!el) return;

    // Only hide if the mouse isn't entering a child or the element itself
    const related = e.relatedTarget;
    if (related && el.contains(related)) return;

    tip.classList.remove('visible');
    isVisible = false;
  });

  function positionTooltip(e) {
    const pad = 14;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Position at 0,0 first to measure, then move
    tip.style.left = '0px';
    tip.style.top = '0px';

    const tw = tip.offsetWidth;
    const th = tip.offsetHeight;

    let x = e.clientX + pad;
    let y = e.clientY + pad;

    if (x + tw > vw - pad) x = e.clientX - tw - pad;
    if (y + th > vh - pad) y = e.clientY - th - pad;
    if (x < pad) x = pad;
    if (y < pad) y = pad;

    tip.style.left = x + 'px';
    tip.style.top = y + 'px';
  }
}
