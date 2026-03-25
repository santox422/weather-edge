'use client';

import { TOOLTIPS } from '@/lib/helpers';

interface MetricTileProps {
  label: string;
  value: string;
  colorClass?: string;
}

export default function MetricTile({ label, value, colorClass = 'text-[#ccc]' }: MetricTileProps) {
  const tip = TOOLTIPS[label] || '';
  return (
    <div className="bg-[#0a0a0a] p-[5px_8px] cursor-help transition-colors hover:bg-[#0e0e0e]" data-tip={tip}>
      <div className="text-[7px] text-[#555] uppercase tracking-[0.12em] font-semibold">{label}</div>
      <div className={`text-[11px] font-bold mt-[1px] ${colorClass}`}>{value}</div>
    </div>
  );
}
