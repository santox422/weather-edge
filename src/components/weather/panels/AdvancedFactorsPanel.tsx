'use client';

import type { AdvancedFactors, AdvancedFactor } from '@/types';
import {
  FACTOR_ICONS, FACTOR_LABELS, FACTOR_DESCRIPTIONS,
} from '@/lib/analysis/constants';

/**
 * AdvancedFactorsPanel — displays all 12 PhD-level meteorological factors
 * with per-factor toggle, confidence bar, and reasoning text.
 *
 * Now imports constants from shared modules instead of
 * duplicating them locally.
 */

interface AdvancedFactorsPanelProps {
  factors: AdvancedFactors;
  disabledFactors: Set<string>;
  customNetAdj: number | null;
  effectiveShift?: number | null;
}

export default function AdvancedFactorsPanel({ factors, disabledFactors, customNetAdj, effectiveShift }: AdvancedFactorsPanelProps) {
  const hasCustom = disabledFactors.size > 0;
  // Show effectiveShift (the actual value applied to distributions) when available,
  // unless custom toggles are active (then use recalculated customNetAdj).
  const displayNetAdj = hasCustom && customNetAdj != null
    ? customNetAdj
    : (effectiveShift ?? factors.netAdjustment);

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
        const desc = FACTOR_DESCRIPTIONS[f.factor] || `${label} — adjustment: ${f.adjustment.toFixed(2)}°C, confidence: ${confPct}%`;

        return (
          <div
            key={f.factor}
            className={`border ${isDisabled ? 'border-[#0a0a0a] bg-[#030303] opacity-50' : isActive ? 'border-[#1a1a1a] bg-[#080808]' : 'border-[#0e0e0e] bg-[#050505]'} p-[6px] transition-all`}
            data-tip={desc}
          >
            {/* Factor header row */}
            <div className="flex items-center gap-[6px]">
              <span className="text-[11px] w-[16px]">{icon}</span>
              <span className={`text-[8px] font-bold uppercase tracking-[0.1em] ${isDisabled ? 'text-[#333] line-through' : isActive ? 'text-[#ccc]' : 'text-[#444]'}`}>{label}</span>
              {f.pattern && (
                <span className={`text-[7px] border px-1.5 py-[0px] tracking-wider ${isDisabled ? 'border-[#222] text-[#333] bg-transparent' : 'border-[#ff8c00]/30 text-[#ff8c00] bg-[#ff8c00]/5'}`}
                  data-tip={`Detected pattern: ${f.pattern.replace(/_/g, ' ')} — this pattern drives the synoptic adjustment value`}
                >{f.pattern}</span>
              )}
              <span className="flex-1" />
              {/* Adjustment badge */}
              <span className={`text-[9px] font-bold ${adjColor}`}
                data-tip={f.adjustment !== 0
                  ? `Temperature adjustment: ${f.adjustment > 0 ? '+' : ''}${f.adjustment.toFixed(2)}°C. ${f.adjustment > 0 ? 'Warming' : 'Cooling'} effect. Weighted by confidence (${confPct}%) to contribute ${(f.adjustment * f.confidence).toFixed(3)}°C to the net.`
                  : 'No temperature adjustment — this factor is inactive or below threshold'
                }
              >
                {f.adjustment !== 0 ? `${f.adjustment > 0 ? '+' : ''}${f.adjustment.toFixed(2)}°C` : '—'}
              </span>
              {/* Confidence bar */}
              <div className="flex items-center gap-[3px] w-[60px]"
                data-tip={`Confidence: ${confPct}% — ${confPct > 70 ? 'high certainty, strong physical signal detected' : confPct > 40 ? 'moderate confidence in this factor\'s impact' : confPct > 15 ? 'low confidence — marginal effect' : 'minimal impact, essentially inactive'}. Weighted contribution: ${(Math.abs(f.adjustment * f.confidence)).toFixed(3)}°C.`}
              >
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
                {f.reasoning.replace(/^[🌙☁️🌱📊🌧️💨🌍⚡]\\s*/, '')}
              </div>
            )}
          </div>
        );
      })}

      {/* Net summary */}
      <div className="flex items-center gap-2 pt-[4px] mt-[2px] border-t border-[#111]"
        data-tip={`Effective PhD shift: ${displayNetAdj.toFixed(2)}°C applied to ensemble via Re-KDE (shifts all members, then re-integrates bracket probabilities). Raw confidence-weighted sum: ${factors.netAdjustment.toFixed(2)}°C.`}
      >
        <span className="text-[8px] font-bold text-[#555] uppercase tracking-[0.1em]">NET ADJUSTMENT</span>
        <span className={`text-[10px] font-bold ${displayNetAdj > 0 ? 'text-[#ff3333]' : displayNetAdj < 0 ? 'text-[#00bcd4]' : 'text-[#555]'}`}>
          {displayNetAdj > 0 ? '+' : ''}{displayNetAdj.toFixed(2)}°C
        </span>
        {hasCustom && (
          <span className="text-[7px] border border-[#ff8c00]/50 px-1 py-[0px] text-[#ff8c00] bg-[#ff8c00]/10 tracking-wider font-bold"
            data-tip="Custom configuration active — you have disabled one or more factors. The net adjustment reflects only the enabled factors.">
            CUSTOM
          </span>
        )}
        <span className="text-[7px] text-[#444]"
          data-tip={`Net confidence: ${Math.round(factors.netConfidence * 100)}% — geometric mean of active factor confidences. Higher = more reliable adjustment.`}>
          conf: {Math.round(factors.netConfidence * 100)}%
        </span>
        {factors.dominantFactor && (
          <span className="text-[7px] text-[#ff8c00]"
            data-tip={`Dominant factor: ${factors.dominantFactor.replace(/_/g, ' ')} — the single factor with the largest absolute weighted impact (adjustment × confidence).`}>
            dominant: {factors.dominantFactor.replace(/_/g, ' ')}
          </span>
        )}
      </div>
    </div>
  );
}
