'use client';

import type { AdvancedFactors, AdvancedFactor } from '@/types';

const FACTOR_ICONS: Record<string, string> = {
  midnight_carryover: '🌙',
  solar_budget: '☁️',
  thermal_inertia: '🌱',
  diurnal_range: '📊',
  precip_timing: '🌧️',
  wind_regime: '💨',
  synoptic_pattern: '🌍',
};

const FACTOR_LABELS: Record<string, string> = {
  midnight_carryover: 'MIDNIGHT CARRYOVER',
  solar_budget: 'SOLAR RADIATION BUDGET',
  thermal_inertia: 'THERMAL INERTIA',
  diurnal_range: 'DIURNAL RANGE',
  precip_timing: 'PRECIPITATION TIMING',
  wind_regime: 'WIND REGIME',
  synoptic_pattern: 'SYNOPTIC PATTERN',
};

interface AdvancedFactorsPanelProps {
  factors: AdvancedFactors;
  disabledFactors: Set<string>;
  onToggle: (factorName: string) => void;
  customNetAdj: number | null;
}

export default function AdvancedFactorsPanel({ factors, disabledFactors, onToggle, customNetAdj }: AdvancedFactorsPanelProps) {
  const hasCustom = disabledFactors.size > 0;
  const displayNetAdj = hasCustom && customNetAdj != null ? customNetAdj : factors.netAdjustment;

  return (
    <div className="px-2 py-1 space-y-[2px]">
      {factors.factors.map((f: AdvancedFactor) => {
        const icon = FACTOR_ICONS[f.factor] || '⚡';
        const label = FACTOR_LABELS[f.factor] || f.factor.toUpperCase();
        const isDisabled = disabledFactors.has(f.factor);
        const isActive = (Math.abs(f.adjustment) > 0.01 || f.confidence > 0.2) && !isDisabled;
        const adjColor = isDisabled ? 'text-[#333]' : f.adjustment > 0.01 ? 'text-[#ff3333]' : f.adjustment < -0.01 ? 'text-[#00bcd4]' : 'text-[#444]';
        const confPct = Math.round(f.confidence * 100);
        const confColor = isDisabled ? 'text-[#333]' : confPct > 50 ? 'text-[#00ff41]' : confPct > 25 ? 'text-[#ff8c00]' : 'text-[#555]';

        return (
          <div
            key={f.factor}
            className={`border ${isDisabled ? 'border-[#0a0a0a] bg-[#030303] opacity-50' : isActive ? 'border-[#1a1a1a] bg-[#080808]' : 'border-[#0e0e0e] bg-[#050505]'} p-[6px] transition-all`}
          >
            {/* Factor header row */}
            <div className="flex items-center gap-[6px]">
              {/* Toggle switch */}
              <button
                onClick={() => onToggle(f.factor)}
                className={`w-[28px] h-[14px] rounded-full relative transition-colors cursor-pointer border-0 p-0 ${isDisabled ? 'bg-[#222]' : 'bg-[#ff8c00]/30'}`}
                title={isDisabled ? 'Enable this factor' : 'Disable this factor'}
              >
                <span className={`absolute top-[2px] w-[10px] h-[10px] rounded-full transition-all ${isDisabled ? 'left-[2px] bg-[#444]' : 'left-[15px] bg-[#ff8c00]'}`} />
              </button>
              <span className="text-[11px] w-[16px]">{icon}</span>
              <span className={`text-[8px] font-bold uppercase tracking-[0.1em] ${isDisabled ? 'text-[#333] line-through' : isActive ? 'text-[#ccc]' : 'text-[#444]'}`}>{label}</span>
              {f.pattern && (
                <span className={`text-[7px] border px-1.5 py-[0px] tracking-wider ${isDisabled ? 'border-[#222] text-[#333] bg-transparent' : 'border-[#ff8c00]/30 text-[#ff8c00] bg-[#ff8c00]/5'}`}>{f.pattern}</span>
              )}
              <span className="flex-1" />
              {/* Adjustment badge */}
              <span className={`text-[9px] font-bold ${adjColor}`}>
                {f.adjustment !== 0 ? `${f.adjustment > 0 ? '+' : ''}${f.adjustment.toFixed(2)}°C` : '—'}
              </span>
              {/* Confidence bar */}
              <div className="flex items-center gap-[3px] w-[60px]">
                <div className="flex-1 h-[3px] bg-[#111] rounded-sm overflow-hidden">
                  <div className={`h-full ${isDisabled ? 'bg-[#222]' : confPct > 50 ? 'bg-[#00ff41]' : confPct > 25 ? 'bg-[#ff8c00]' : 'bg-[#333]'} transition-all`}
                    style={{ width: `${confPct}%` }} />
                </div>
                <span className={`text-[7px] font-bold ${confColor}`}>{confPct}%</span>
              </div>
            </div>
            {/* Factor reasoning */}
            {isActive && (
              <div className="text-[8px] text-[#666] mt-[3px] ml-[50px] leading-[1.4]">
                {f.reasoning.replace(/^[🌙☁️🌱📊🌧️💨🌍⚡]\s*/, '')}
              </div>
            )}
          </div>
        );
      })}

      {/* Net summary */}
      <div className="flex items-center gap-2 pt-[4px] mt-[2px] border-t border-[#111]">
        <span className="text-[8px] font-bold text-[#555] uppercase tracking-[0.1em]">NET ADJUSTMENT</span>
        <span className={`text-[10px] font-bold ${displayNetAdj > 0 ? 'text-[#ff3333]' : displayNetAdj < 0 ? 'text-[#00bcd4]' : 'text-[#555]'}`}>
          {displayNetAdj > 0 ? '+' : ''}{displayNetAdj.toFixed(2)}°C
        </span>
        {hasCustom && (
          <span className="text-[7px] border border-[#ff8c00]/50 px-1 py-[0px] text-[#ff8c00] bg-[#ff8c00]/10 tracking-wider font-bold">CUSTOM</span>
        )}
        <span className="text-[7px] text-[#444]">conf: {Math.round(factors.netConfidence * 100)}%</span>
        {factors.dominantFactor && (
          <span className="text-[7px] text-[#ff8c00]">dominant: {factors.dominantFactor.replace(/_/g, ' ')}</span>
        )}
      </div>
    </div>
  );
}
