'use client';

import { useMemo } from 'react';
import type {
  AnalysisData, Outcome, BracketProbability,
  AdvancedFactor, PerModelBracket, PerModelBracketProb,
} from '@/types';
import { computeNetAdjustment } from '@/lib/analysis/constants';
import { applyMETARConstraint } from '@/lib/analysis/ensemble';

/**
 * useBracketRecalculation — client-side BMA recalculation when the user
 * has disabled models or changed weights via the MODELS toggle panel.
 *
 * This hook replaces the inline `useMemo` blocks that were previously
 * embedded in BracketAnalysisPanel (lines 154-214 of the original).
 *
 * Recalculation pipeline:
 *   1. customBmaBp:  weighted average of enabled model bracket probs
 *   2. customBmaPhd: apply server-computed factor shifts on top of custom BMA
 *   3. displayNetAdj: effective PhD temperature shift for display
 *
 * When no custom overrides are active, all values return null/server-default,
 * so the component simply shows the server-computed values unchanged.
 */

interface RecalcInputs {
  data: AnalysisData;
  outcomes: Outcome[];
  perModel: PerModelBracket[];
  disabledModels: Set<string>;
  weightOverrides: Record<string, number>;
  hasCustomModels: boolean;
  enforceMetar: boolean;
}

interface RecalcResult {
  /** Custom BMA probabilities (null if no overrides active) */
  customBmaBp: BracketProbability[] | null;
  /** Custom BMA + PhD probabilities (null if no overrides active) */
  customBmaPhd: BracketProbability[] | null;
  /** Net PhD shift for display (uses server effectiveShift when available) */
  displayNetAdj: number;
  /** Server-computed ENS + PhD shifted brackets */
  ensPhd: BracketProbability[] | null;
  /** Pre-factor BMA brackets (before PhD shifts) */
  preFactorBp: BracketProbability[] | undefined;
  /** Display-ready BMA probabilities (custom or server) */
  displayBma: BracketProbability[] | undefined;
  /** Display-ready BMA+PhD probabilities (custom or server) */
  displayBmaPhd: BracketProbability[] | undefined;
}

export function useBracketRecalculation({
  data,
  outcomes,
  perModel,
  disabledModels,
  weightOverrides,
  hasCustomModels,
  enforceMetar,
}: RecalcInputs): RecalcResult {
  const e = data.edge || {};
  // Server defaults depending on METAR toggle
  const serverFinalBp = enforceMetar 
    ? e.bracketProbabilities // The final clamped one
    : data.ensemble?.preMetarBracketProbabilities || e.bracketProbabilities;
    
  const serverEnsPhd = enforceMetar
    ? data.ensemble?.ensShiftedBrackets
    : data.ensemble?.preMetarEnsShiftedBrackets || data.ensemble?.ensShiftedBrackets;

  const rawBp: BracketProbability[] | undefined = data.ensemble?.rawBracketProbabilities;
  const preFactorBp = data.ensemble?.preFactorBracketProbabilities;
  const factorShifts = data.factorAdjustment?.perBracket as { name: string; shift: number }[] | undefined;

  // Server-computed ENS + PhD shifted brackets (possibly unclamped)
  const ensPhd = serverEnsPhd ?? null;

  // ── Custom BMA: recompute when user has disabled models or changed weights ──
  const customBmaBp = useMemo((): BracketProbability[] | null => {
    if (!hasCustomModels) return null;
    if (perModel.length === 0 || outcomes.length === 0) return null;
    const enabled = perModel.filter(pm => !disabledModels.has(pm.model));
    if (enabled.length === 0) return null;

    const effectiveWeights = enabled.map(pm => weightOverrides[pm.model] ?? pm.weight);
    const totalW = effectiveWeights.reduce((s, w) => s + w, 0);
    if (totalW === 0) return null;

    return outcomes.map((o: Outcome) => {
      const name = o.name || o.title || '';
      let wp = 0;
      for (let i = 0; i < enabled.length; i++) {
        const pm = enabled[i];
        const w = effectiveWeights[i] / totalW;
        const br = pm.brackets?.find((b: PerModelBracketProb) => b.name === name);
        if (br?.prob != null) wp += w * br.prob;
      }
      return { name, title: o.title, marketPrice: o.price, forecastProb: wp, edge: wp - o.price } as BracketProbability;
    });
  }, [hasCustomModels, perModel, outcomes, disabledModels, weightOverrides]);

  // ── Custom BMA + PhD: apply factor shifts on custom BMA ──
  // Uses additive shift approximation (the server uses true Re-KDE).
  // Renormalizes after to ensure probabilities sum to 1.0.
  const customBmaPhd = useMemo((): BracketProbability[] | null => {
    if (!customBmaBp || !factorShifts) return null;

    // Step 1: apply additive shifts (clamp to ≥ 0)
    const shifted = customBmaBp.map((pfb: BracketProbability) => {
      const sh = factorShifts.find((s: { name: string; shift: number }) => s.name === pfb.name || s.name === (pfb as any).title);
      const adj = Math.max(0, (pfb.forecastProb || 0) + (sh?.shift || 0));
      return { ...pfb, forecastProb: adj };
    });

    // Step 2: renormalize so probabilities sum to 1.0
    // (mirrors server-side Re-KDE which naturally produces a normalized distribution)
    const total = shifted.reduce((s, b) => s + (b.forecastProb || 0), 0);
    if (total > 0 && Math.abs(total - 1.0) > 0.005) {
      for (const b of shifted) {
        if (b.forecastProb != null && b.forecastProb > 0) {
          b.forecastProb = b.forecastProb / total;
        }
      }
    }

    // Step 3: compute edge after normalization
    return shifted.map((b) => ({
      ...b,
      edge: (b.forecastProb || 0) - (b.marketPrice || 0),
    }));
  }, [customBmaBp, factorShifts]);

  // ── Net PhD adjustment for display ──
  const displayNetAdj = useMemo(() => {
    // Prefer the actual effectiveShift from the factor adjustment breakdown
    if (data.factorAdjustment?.effectiveShift != null) {
      return data.factorAdjustment.effectiveShift;
    }
    // Fallback: compute from raw factors (pre-un-damping)
    if (!data.advancedFactors) return 0;
    return computeNetAdjustment(data.advancedFactors.factors);
  }, [data.advancedFactors, data.factorAdjustment]);

  // ── Apply custom METAR constraints if custom models exist ──
  // If the user tweaked models, we generated an unconstrained customBmaPhd.
  // We need to clamp it down if enforceMetar is true.
  const finalCustomBmaPhd = useMemo(() => {
    if (!customBmaPhd) return null;
    if (!enforceMetar || data.liveWeather?.maxToday == null) return customBmaPhd;
    
    // Check if it's a "today" or "past" market
    const todayStr = new Date().toISOString().split('T')[0];
    const targetStr = data.market?.endDate ? new Date(data.market.endDate).toISOString().split('T')[0] : null;
    if (targetStr && targetStr > todayStr) return customBmaPhd; // future market

    // Apply metar logic locally
    const res = applyMETARConstraint([...customBmaPhd], data.liveWeather.maxToday, (data.market as any)?.unit || 'C', true);
    return res.adjusted;
  }, [customBmaPhd, enforceMetar, data.liveWeather, data.market]);

  // ── Display layers — custom overrides or server-computed ──
  const displayBma = customBmaBp || preFactorBp;
  const displayBmaPhd = finalCustomBmaPhd || serverFinalBp;

  return {
    customBmaBp,
    customBmaPhd: finalCustomBmaPhd,
    displayNetAdj,
    ensPhd,
    preFactorBp,
    displayBma,
    displayBmaPhd,
  };
}
