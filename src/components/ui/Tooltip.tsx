'use client';

import { useEffect, useRef, useCallback } from 'react';

export default function Tooltip() {
  const tooltipRef = useRef<HTMLDivElement>(null);

  const showTooltip = useCallback((e: MouseEvent) => {
    const target = (e.target as HTMLElement).closest('[data-tip]');
    if (!target || !tooltipRef.current) return;
    const tip = (target as HTMLElement).dataset.tip;
    if (!tip) return;

    const el = tooltipRef.current;
    el.textContent = tip;
    el.classList.add('visible');

    const rect = (target as HTMLElement).getBoundingClientRect();
    let top = rect.bottom + 6;
    let left = rect.left;

    if (top + el.offsetHeight > window.innerHeight) top = rect.top - el.offsetHeight - 6;
    if (left + el.offsetWidth > window.innerWidth) left = window.innerWidth - el.offsetWidth - 8;
    if (left < 4) left = 4;

    el.style.top = `${top}px`;
    el.style.left = `${left}px`;
  }, []);

  const hideTooltip = useCallback(() => {
    if (tooltipRef.current) tooltipRef.current.classList.remove('visible');
  }, []);

  useEffect(() => {
    document.addEventListener('mouseover', showTooltip);
    document.addEventListener('mouseout', hideTooltip);
    document.addEventListener('scroll', hideTooltip, true);
    return () => {
      document.removeEventListener('mouseover', showTooltip);
      document.removeEventListener('mouseout', hideTooltip);
      document.removeEventListener('scroll', hideTooltip, true);
    };
  }, [showTooltip, hideTooltip]);

  return <div ref={tooltipRef} className="custom-tooltip" />;
}
