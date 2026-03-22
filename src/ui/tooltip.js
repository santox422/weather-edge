/**
 * Custom tooltip system — simple, reliable, event-delegation based.
 * All tooltips use [data-tip] exclusively (never [title]) so the browser
 * never fires its native tooltip. No race condition, no double-tooltip.
 */
export function initTooltips() {
  const tip = document.getElementById('custom-tooltip');
  if (!tip) return;

  // Strip any native title attrs from data-tip elements so the browser
  // never fires its built-in delayed tooltip alongside our custom one.
  function stripTitles(root) {
    (root || document).querySelectorAll('[data-tip][title]').forEach((el) => el.removeAttribute('title'));
  }
  stripTitles();
  new MutationObserver((muts) => {
    for (const m of muts) m.addedNodes.forEach((n) => { if (n.nodeType === 1) stripTitles(n.parentElement || document); });
  }).observe(document.body, { childList: true, subtree: true });

  let isVisible = false;
  let activeEl = null;

  document.addEventListener('mouseover', (e) => {
    const el = e.target.closest('[data-tip]');
    if (!el) {
      hideTooltip();
      return;
    }

    const text = el.getAttribute('data-tip');
    if (!text) return;

    activeEl = el;

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
    const el = e.target.closest('[data-tip]');
    if (!el) return;

    const related = e.relatedTarget;
    if (related && el.contains(related)) return;

    hideTooltip();
  });

  function hideTooltip() {
    if (!isVisible) return;
    tip.classList.remove('visible');
    isVisible = false;
    activeEl = null;
  }

  function positionTooltip(e) {
    const pad = 14;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

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
