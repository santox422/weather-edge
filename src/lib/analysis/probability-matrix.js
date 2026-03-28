/**
 * Probability Matrix — applies advanced factor temperature adjustments to
 * bracket probabilities. Takes the base KDE/BMA probabilities and shifts
 * them based on the net temperature adjustment from all advanced factors.
 *
 * Method: Shift the raw ensemble member maxima AND deterministic model
 * predictions by the effective adjustment, then re-run KDE + BMA blend.
 * This is physically exact and properly conserves probability mass.
 *
 * Fix B: Re-KDE with shifted members (replaces adjacent-bracket redistribution).
 * Fix C: netAdjustment is already confidence-weighted; no double-discounting.
 * Fix D: Un-damp effectiveShift via Option B — confidence weights WHETHER an
 *        effect exists, not its magnitude. Shift = netAdj / avgConfidence.
 * Fix E: Dual-stream re-KDE + BMA re-blend so deterministic models are not
 *        silently dropped when shifting probabilities.
 * Fix F: Return ensShiftedBrackets separately for accurate ENS+PhD column.
 */

import {
  computeBracketProbabilities,
  computeDeterministicBracketProbs,
  blendBracketProbabilities,
} from './ensemble.js';

/**
 * Apply advanced factor adjustments to bracket probabilities.
 *
 * Primary method: Shift all ensemble member maxima AND deterministic model
 * predictions by the effective adjustment, then re-run KDE integration and
 * BMA blend. This is physically exact.
 *
 * Fallback: When memberMaxes are not available, uses adjacent-bracket
 * redistribution (less accurate but functional).
 *
 * @param {Object[]} bracketProbs — current BMA-blended bracket probabilities
 * @param {Object} factorResults — from runAllAdvancedFactors()
 * @param {number[]} memberMaxes — raw ensemble member maxima (for re-KDE)
 * @param {Object[]} outcomes — market outcomes with threshold info
 * @param {string} marketUnit — 'C' or 'F'
 * @param {Object[]} detPredictions — deterministic model predictions [{maxTemp, weight, model}, ...]
 * @param {number} ensWeightTotal — total ensemble BMA weight
 * @param {number} detWeightTotal — total deterministic BMA weight
 * @param {number} daysOut — forecast lead time in days
 * @param {number} biasCorrection — station bias correction in °C
 * @returns {Object} { adjusted, ensShiftedBrackets, applied, breakdown }
 */
export function applyFactorAdjustments(
  bracketProbs, factorResults, memberMaxes = null, outcomes = null, marketUnit = 'C',
  detPredictions = null, ensWeightTotal = 4.0, detWeightTotal = 4.0, daysOut = 1, biasCorrection = 0,
  metarFloorC = null
) {
  if (!bracketProbs || bracketProbs.length === 0 || !factorResults) {
    return { adjusted: bracketProbs, ensShiftedBrackets: null, applied: false, breakdown: null };
  }

  const { netAdjustment, netConfidence, factors } = factorResults;

  // Only apply if the adjustment is meaningful
  if (Math.abs(netAdjustment) < 0.1 || netConfidence < 0.1) {
    return {
      adjusted: bracketProbs,
      ensShiftedBrackets: null,
      applied: false,
      breakdown: {
        netAdjustment,
        netConfidence,
        reason: 'Adjustment too small or confidence too low to meaningfully shift probabilities',
        perBracket: bracketProbs.map(b => ({
          name: b.name,
          originalProb: b.forecastProb,
          adjustedProb: b.forecastProb,
          shift: 0,
        })),
      },
    };
  }

  // Compute the effective temperature shift for re-KDE.
  //
  // The netAdjustment from advanced-factors.js is Σ(adjustment × confidence),
  // which produces an over-damped shift (e.g., -1.0°C at 60% confidence → -0.6°C).
  //
  // Physically, confidence represents HOW CERTAIN we are that an effect exists,
  // not how much to reduce its magnitude. A -1.0°C solar budget deficit at 60%
  // confidence means: "there's a 60% chance we'll see -1.0°C cooling from this."
  //
  // Correct approach: compute the effective shift as the confidence-weighted
  // AVERAGE of factor adjustments (not sum). This gives the expected shift
  // magnitude given the active factors, without double-damping.
  //
  // effectiveShift = Σ(adj_i × conf_i) / Σ(conf_i)  ← weighted average
  //
  // Then scale by the overall confidence to get a realistic shift:
  // If all factors are 100% confident, effectiveShift = raw average
  // If factors are 50% confident, the shift is the raw average × a mild discount
  //
  // This typically produces shifts of 0.6-1.5× the netAdjustment, avoiding
  // both the over-damped original and over-amplified un-damping.
  const activeFx = (factors || []).filter(f => Math.abs(f.adjustment) > 0.01 && f.confidence > 0.1);
  
  // Confidence-weighted average: direction and magnitude from raw adjustments,
  // weighted by how sure we are about each one
  const totalConfidence = activeFx.reduce((s, f) => s + f.confidence, 0);
  const weightedAvgAdj = totalConfidence > 0
    ? activeFx.reduce((s, f) => s + f.adjustment * f.confidence, 0) / totalConfidence
    : 0;
  
  // The effective shift is the weighted average adjustment.
  // This is the best estimate of the actual temperature shift given all factors.
  // For example:
  //   solar_budget: -1.0°C @ 60% → contributes -0.6 to numerator, 0.6 to denominator
  //   wind_regime:  -0.3°C @ 50% → contributes -0.15 to numerator, 0.5 to denominator
  //   UHI:          +0.2°C @ 35% → contributes +0.07 to numerator, 0.35 to denominator
  //   weightedAvgAdj = (-0.6 + -0.15 + 0.07) / (0.6 + 0.5 + 0.35) = -0.68 / 1.45 = -0.47°C
  //
  // Compare to netAdjustment = -0.68 (over-damped) and raw sum = -1.1 (too aggressive)
  // The weighted average (-0.47) represents the expected shift per active factor.
  //
  // But we want the TOTAL shift from ALL active factors, not the average per factor.
  // So we use: effectiveShift = weightedAvgAdj × min(activeFx.length, 3)
  // Capped at 3 to prevent runaway when many weak factors align.
  //
  // Actually, the simplest correct approach: use netAdjustment directly but
  // ensure it's not over-damped by computing it as Σ(adj_i) weighted by
  // normalized confidence scores. This is equivalent to:
  //   effectiveShift = weightedAvgAdj × activeFx.length (but capped)
  //
  // Let's just compute the raw sum and blend it with the confidence-weighted sum:
  //   rawSum = Σ(adj_i)               ← what would happen if all factors are certain
  //   dampedSum = Σ(adj_i × conf_i)   ← netAdjustment from advanced-factors.js
  //   effectiveShift = blend of these two based on overall confidence
  
  const rawAdjSum = activeFx.reduce((s, f) => s + f.adjustment, 0);
  const avgConfidence = totalConfidence / Math.max(1, activeFx.length);
  
  // Blend: at low confidence (0.2), use mostly the damped sum (conservative)
  //        at high confidence (0.8+), use mostly the raw sum (factors are real)
  // blendAlpha = avgConfidence^0.5 to give more weight to raw than purely linear
  const blendAlpha = Math.pow(Math.max(0.1, Math.min(1.0, avgConfidence)), 0.5);
  const effectiveShift = Math.max(-3.0, Math.min(3.0,
    blendAlpha * rawAdjSum + (1 - blendAlpha) * netAdjustment
  ));
  
  const shiftDirection = effectiveShift > 0 ? 1 : -1;

  // Build active factor summary for the breakdown
  const activeFactors = activeFx.map(f => ({
    factor: f.factor,
    adjustment: f.adjustment,
    confidence: f.confidence,
    reasoning: f.reasoning,
  }));

  console.log(`[PROB_MATRIX] Shift calc: rawSum=${rawAdjSum.toFixed(3)}, netAdj(damped)=${netAdjustment.toFixed(3)}, avgConf=${avgConfidence.toFixed(2)}, blendAlpha=${blendAlpha.toFixed(2)} → effectiveShift=${effectiveShift.toFixed(3)}°C`);

  // ── Fix B+E: Primary method — dual-stream re-KDE + BMA re-blend ──────
  // Stream 1: Shift ensemble members → re-KDE
  // Stream 2: Shift deterministic predictions → re-compute Gaussian CDF brackets
  // Then BMA-blend the two shifted streams for final adjusted probabilities.
  if (memberMaxes && memberMaxes.length > 0 && outcomes && outcomes.length > 1) {
    // Stream 1: Shift ensemble members and re-KDE
    const shiftedMembers = memberMaxes.map(m => {
      const shifted = m + effectiveShift;
      return metarFloorC != null ? Math.max(metarFloorC - 0.5, shifted) : shifted;
    });
    const ensShiftedBrackets = computeBracketProbabilities(shiftedMembers, outcomes, biasCorrection, marketUnit);

    // Stream 2: Shift deterministic predictions and re-compute brackets
    let detShiftedBrackets = null;
    if (detPredictions && detPredictions.length > 0) {
      const shiftedPreds = detPredictions.map(p => {
        let maxT = p.maxTemp != null ? p.maxTemp + effectiveShift : null;
        if (maxT != null && metarFloorC != null) {
          maxT = Math.max(metarFloorC - 0.5, maxT);
        }
        return { ...p, maxTemp: maxT };
      });
      detShiftedBrackets = computeDeterministicBracketProbs(
        shiftedPreds.filter(p => p.maxTemp != null),
        outcomes, daysOut, biasCorrection, marketUnit
      );
    }

    // BMA re-blend: combine shifted ensemble + shifted deterministic
    let adjusted;
    if (ensShiftedBrackets && detShiftedBrackets) {
      const blended = blendBracketProbabilities(
        ensShiftedBrackets, detShiftedBrackets, ensWeightTotal, detWeightTotal
      );
      // Merge with original bracket metadata (market prices, names, etc.)
      adjusted = bracketProbs.map((b, i) => {
        const bl = blended?.[i];
        if (!bl || bl.forecastProb == null) return b;
        return {
          ...b,
          forecastProb: bl.forecastProb,
          edge: bl.forecastProb - (b.marketPrice || 0),
          factorAdjusted: true,
        };
      });
    } else if (ensShiftedBrackets) {
      // No deterministic predictions available — use ensemble-only
      adjusted = bracketProbs.map((b, i) => {
        const reKDEBracket = ensShiftedBrackets[i];
        if (!reKDEBracket || reKDEBracket.forecastProb == null) return b;
        return {
          ...b,
          forecastProb: reKDEBracket.forecastProb,
          edge: reKDEBracket.forecastProb - (b.marketPrice || 0),
          factorAdjusted: true,
        };
      });
    } else {
      adjusted = bracketProbs;
    }

    // Build per-bracket shift breakdown
    const perBracket = bracketProbs.map((b, i) => ({
      name: b.name,
      originalProb: +(b.forecastProb || 0).toFixed(4),
      adjustedProb: +(adjusted[i].forecastProb || 0).toFixed(4),
      shift: +((adjusted[i].forecastProb || 0) - (b.forecastProb || 0)).toFixed(4),
    }));

    // Also prepare the ENS-only shifted brackets (for the ENS+PhD column)
    // with proper metadata merged from the original raw brackets
    const ensShiftedForUI = ensShiftedBrackets
      ? bracketProbs.map((b, i) => {
          const es = ensShiftedBrackets[i];
          if (!es || es.forecastProb == null) return { ...b, forecastProb: null };
          return {
            ...b,
            forecastProb: es.forecastProb,
            edge: es.forecastProb - (b.marketPrice || 0),
          };
        })
      : null;

    console.log(`[PROB_MATRIX] Dual-stream re-KDE+BMA: ${shiftedMembers.length} members + ${detPredictions?.length || 0} det models shifted by ${effectiveShift > 0 ? '+' : ''}${effectiveShift.toFixed(2)}°C`);

    // Log the shift impact for validation
    const origPeak = bracketProbs.reduce((best, b) => (!best || (b.forecastProb || 0) > (best.forecastProb || 0)) ? b : best, null);
    const adjPeak = adjusted.reduce((best, b) => (!best || (b.forecastProb || 0) > (best.forecastProb || 0)) ? b : best, null);
    if (origPeak && adjPeak) {
      console.log(`[PROB_MATRIX] Peak shift: ${origPeak.name} (${((origPeak.forecastProb || 0) * 100).toFixed(1)}%) → ${adjPeak.name} (${((adjPeak.forecastProb || 0) * 100).toFixed(1)}%)`);
    }

    return {
      adjusted,
      ensShiftedBrackets: ensShiftedForUI,
      applied: true,
      breakdown: {
        netAdjustment,
        netConfidence,
        effectiveShift: +effectiveShift.toFixed(3),
        blendAlpha: +blendAlpha.toFixed(2),
        avgConfidence: +avgConfidence.toFixed(2),
        method: 'RE_KDE_BMA_BLEND',
        shiftDirection: shiftDirection > 0 ? 'WARMING' : 'COOLING',
        memberCount: shiftedMembers.length,
        detModelCount: detPredictions?.length || 0,
        activeFactors,
        perBracket,
      },
    };
  }

  // ── Fallback: Adjacent-bracket redistribution ────────────────────
  // Used only when memberMaxes are not available
  const isFahrenheit = marketUnit === 'F';
  const bracketWidthC = isFahrenheit ? 0.56 : 1.0;

  const parsedBrackets = bracketProbs.map((b, i) => {
    let tempC = null;
    if (b.threshold) {
      tempC = isFahrenheit
        ? (b.threshold.value - 32) * 5 / 9
        : b.threshold.value;
    } else if (outcomes?.[i]?.threshold) {
      const t = outcomes[i].threshold;
      tempC = isFahrenheit ? (t.value - 32) * 5 / 9 : t.value;
    }
    return { ...b, tempC, index: i };
  });

  const sorted = parsedBrackets.filter(b => b.tempC != null).sort((a, b) => a.tempC - b.tempC);

  if (sorted.length < 2) {
    return { adjusted: bracketProbs, ensShiftedBrackets: null, applied: false, breakdown: null };
  }

  // Use un-damped effectiveShift for the redistribution fallback too
  const shiftFraction = Math.min(0.5, Math.abs(effectiveShift) / bracketWidthC * 0.4);

  const adjusted = [...bracketProbs];
  const perBracket = [];

  for (let i = 0; i < sorted.length; i++) {
    const bracket = sorted[i];
    const origIdx = bracket.index;
    const origProb = bracket.forecastProb || 0;

    let newProb = origProb;

    if (shiftDirection > 0) {
      const donateUp = origProb * shiftFraction;
      newProb -= donateUp;
      if (i > 0) {
        const belowProb = sorted[i - 1].forecastProb || 0;
        newProb += belowProb * shiftFraction;
      }
    } else {
      const donateDown = origProb * shiftFraction;
      newProb -= donateDown;
      if (i < sorted.length - 1) {
        const aboveProb = sorted[i + 1].forecastProb || 0;
        newProb += aboveProb * shiftFraction;
      }
    }

    newProb = Math.max(0, Math.min(1, newProb));

    adjusted[origIdx] = {
      ...bracketProbs[origIdx],
      forecastProb: newProb,
      edge: newProb - (bracketProbs[origIdx].marketPrice || 0),
      factorAdjusted: true,
    };

    perBracket.push({
      name: bracket.name,
      tempC: bracket.tempC,
      originalProb: +origProb.toFixed(4),
      adjustedProb: +newProb.toFixed(4),
      shift: +(newProb - origProb).toFixed(4),
    });
  }

  // Renormalize
  const totalProb = adjusted.reduce((s, b) => s + (b.forecastProb || 0), 0);
  if (totalProb > 0 && Math.abs(totalProb - 1.0) > 0.01) {
    for (const b of adjusted) {
      if (b.forecastProb > 0) {
        b.forecastProb = b.forecastProb / totalProb;
        b.edge = b.forecastProb - (b.marketPrice || 0);
      }
    }
  }

  return {
    adjusted,
    ensShiftedBrackets: null,
    applied: true,
    breakdown: {
      netAdjustment,
      netConfidence,
      effectiveShift: +effectiveShift.toFixed(3),
      blendAlpha: +blendAlpha.toFixed(2),
      avgConfidence: +avgConfidence.toFixed(2),
      method: 'REDISTRIBUTION_FALLBACK',
      shiftFraction: +shiftFraction.toFixed(3),
      shiftDirection: shiftDirection > 0 ? 'WARMING' : 'COOLING',
      activeFactors,
      perBracket,
    },
  };
}
