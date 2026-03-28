'use client';

import type { FactorBreakdown, FactorBracketShift } from '@/types';

interface FactorShiftsPanelProps {
  breakdown: FactorBreakdown;
}

export default function FactorShiftsPanel({ breakdown }: FactorShiftsPanelProps) {
  const shifts = breakdown.perBracket || [];
  if (shifts.length === 0) return <div className="p-2 text-[9px] text-[#333]">No bracket shifts</div>;

  const maxShift = Math.max(...shifts.map((s: FactorBracketShift) => Math.abs(s.shift)), 0.01);

  return (
    <div className="px-3 py-2">
      {/* Header */}
      <div className="grid grid-cols-[2.5fr_1fr_1fr_1fr_1.5fr] gap-2 py-1.5 border-b border-[#222] text-[7px] text-[#555] uppercase tracking-widest font-bold">
        <span>BRACKET</span>
        <span className="text-right">BEFORE</span>
        <span className="text-right">AFTER</span>
        <span className="text-right">SHIFT</span>
        <span className="text-right pr-1">VISUAL</span>
      </div>
      {/* Rows */}
      {shifts.map((s: FactorBracketShift, i: number) => {
        const shiftPct = Math.abs(s.shift) / maxShift * 100;
        const shiftColor = s.shift > 0.001 ? 'bg-[#00ff41]' : s.shift < -0.001 ? 'bg-[#ff3333]' : 'bg-[#333]';
        const textColor = s.shift > 0.001 ? 'text-[#00ff41]' : s.shift < -0.001 ? 'text-[#ff3333]' : 'text-[#444]';

        return (
          <div key={s.name} className={`grid grid-cols-[2.5fr_1fr_1fr_1fr_1.5fr] gap-2 py-1.5 border-b border-[#0a0a0a] items-center hover:bg-[#0a0a0a] transition-colors ${i % 2 === 1 ? 'bg-[#060606]' : ''}`}>
            <span className="text-[9px] text-[#ccc] truncate">{s.name}</span>
            <span className="text-[9px] text-[#555] text-right">{(s.originalProb * 100).toFixed(1)}%</span>
            <span className="text-[9px] text-[#00bcd4] text-right font-semibold">{(s.adjustedProb * 100).toFixed(1)}%</span>
            <span className={`text-[9px] font-bold text-right ${textColor}`}>
              {s.shift > 0 ? '+' : ''}{(s.shift * 100).toFixed(1)}%
            </span>
            <span className="px-1">
              <div className="w-full h-1 bg-[#111] rounded-sm overflow-hidden relative">
                <div className={`absolute h-full ${shiftColor} transition-all`}
                  style={{ width: `${Math.max(shiftPct, 2)}%`, left: s.shift < 0 ? `${100 - shiftPct}%` : '0' }} />
              </div>
            </span>
          </div>
        );
      })}
    </div>
  );
}
