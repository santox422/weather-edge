'use client';

import React from 'react';

/**
 * Toggle — a compact on/off switch used across the analysis panels.
 *
 * Previously embedded inside BracketAnalysisPanel; extracted here
 * so AdvancedFactorsPanel and any future panels can reuse it.
 */

interface ToggleProps {
  on: boolean;
  onToggle: () => void;
  label: string;
  color?: string;
  size?: 'sm' | 'xs';
  tip?: string;
}

export default function Toggle({
  on,
  onToggle,
  label,
  color = '#00ff41',
  size = 'sm',
  tip,
}: ToggleProps) {
  const w = size === 'sm' ? 'w-[28px] h-[14px]' : 'w-[22px] h-[11px]';
  const dot = size === 'sm' ? 'w-[10px] h-[10px]' : 'w-[7px] h-[7px]';
  const offL = 'left-[2px]';
  const onL = size === 'sm' ? 'left-[16px]' : 'left-[13px]';

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      className={`inline-flex items-center gap-1 cursor-pointer border-0 bg-transparent select-none active:opacity-70 transition-opacity ${label ? 'px-1 min-h-[28px]' : 'px-0 min-h-[16px]'}`}
      data-tip={tip}
    >
      <span
        className={`relative rounded-sm shrink-0 transition-colors ${w} ${on ? '' : 'bg-[#222]'}`}
        style={on ? { backgroundColor: `${color}33` } : {}}
      >
        <span
          className={`absolute top-[50%] -translate-y-[50%] rounded-sm transition-all ${dot} ${on ? onL : offL}`}
          style={{ backgroundColor: on ? color : '#555' }}
        />
      </span>
      {label && (
        <span
          className={`text-[8px] font-bold tracking-wider whitespace-nowrap ${on ? '' : 'text-[#555]'}`}
          style={on ? { color } : {}}
        >
          {label}
        </span>
      )}
    </button>
  );
}
