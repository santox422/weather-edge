/**
 * Probability Matrix — applies advanced factor temperature adjustments to
 * bracket probabilities. Takes the base KDE/BMA probabilities and shifts
 * them based on the net temperature adjustment from all advanced factors.
 *
 * The key insight: a +1°C adjustment shifts the entire probability
 * distribution rightward (toward higher brackets), while a -1°C adjustment
 * shifts it leftward (toward lower brackets). The shift magnitude is
 * proportional to the adjustment confidence.
 */

/**
 * Apply advanced factor adjustments to bracket probabilities.
 *
 * Method: Re-center the ensemble KDE by the net temperature adjustment,
 * then re-integrate over each bracket. This is equivalent to shifting all
 * ensemble members by the adjustment amount.
 *
 * When raw member data is not available, uses a simplified Gaussian shift
 * that redistributes probability mass between adjacent brackets.
 *
 * @param {Object[]} bracketProbs — current bracket probability objects
 * @param {Object} factorResults — from runAllAdvancedFactors()
 * @param {number[]} memberMaxes — raw ensemble member maxima (optional, for re-KDE)
 * @param {Object[]} outcomes — market outcomes with threshold info
 * @param {string} marketUnit — 'C' or 'F'
 * @returns {Object} { adjusted, applied, breakdown }
 */
export function applyFactorAdjustments(bracketProbs, factorResults, memberMaxes = null, outcomes = null, marketUnit = 'C') {
  if (!bracketProbs || bracketProbs.length === 0 || !factorResults) {
    return { adjusted: bracketProbs, applied: false, breakdown: null };
  }

  const { netAdjustment, netConfidence, factors } = factorResults;

  // Only apply if the adjustment is meaningful
  if (Math.abs(netAdjustment) < 0.1 || netConfidence < 0.1) {
    return {
      adjusted: bracketProbs,
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

  // Scale the adjustment by confidence — we don't want to full-send on low-confidence shifts
  const effectiveShift = netAdjustment * netConfidence;

  // Method: Gaussian probability redistribution
  // For each bracket, compute how much probability mass shifts in/out
  // based on the effective temperature shift.
  //
  // If shift is +0.5°C (warming), probability moves from lower brackets to higher.
  // If shift is -0.5°C (cooling), probability moves from higher brackets to lower.
  //
  // The magnitude of redistribution is proportional to:
  //   1. The absolute shift magnitude
  //   2. Each bracket's current probability (higher-prob brackets shift more)
  //   3. The bracket width (typically 1°C for exact brackets)

  const isFahrenheit = marketUnit === 'F';
  const bracketWidthC = isFahrenheit ? 0.56 : 1.0; // 1°F ≈ 0.56°C

  // Extract bracket temperatures for ordering
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

  // Sort by temperature to identify adjacency
  const sorted = parsedBrackets.filter(b => b.tempC != null).sort((a, b) => a.tempC - b.tempC);

  if (sorted.length < 2) {
    // Can't do meaningful redistribution with less than 2 brackets
    return { adjusted: bracketProbs, applied: false, breakdown: null };
  }

  // Compute shift fractions: how much probability each bracket donates/receives
  // Using a sigmoid-weighted transfer based on distance from the shift direction
  const shiftFraction = Math.min(0.4, Math.abs(effectiveShift) / bracketWidthC * 0.3);
  const shiftDirection = effectiveShift > 0 ? 1 : -1; // +1 = warming, -1 = cooling

  const adjusted = [...bracketProbs];
  const perBracket = [];

  for (let i = 0; i < sorted.length; i++) {
    const bracket = sorted[i];
    const origIdx = bracket.index;
    const origProb = bracket.forecastProb || 0;

    let newProb = origProb;

    // Donate probability in the direction opposite to shift
    // Receive probability from the direction of shift
    if (shiftDirection > 0) {
      // Warming: lower brackets lose, higher brackets gain
      // This bracket loses probability to the bracket above
      const donateUp = origProb * shiftFraction;
      newProb -= donateUp;

      // This bracket receives from the bracket below
      if (i > 0) {
        const belowProb = sorted[i - 1].forecastProb || 0;
        const receiveFromBelow = belowProb * shiftFraction;
        newProb += receiveFromBelow;
      }
    } else {
      // Cooling: higher brackets lose, lower brackets gain
      const donateDown = origProb * shiftFraction;
      newProb -= donateDown;

      if (i < sorted.length - 1) {
        const aboveProb = sorted[i + 1].forecastProb || 0;
        const receiveFromAbove = aboveProb * shiftFraction;
        newProb += receiveFromAbove;
      }
    }

    // Clamp to [0, 1]
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

  // Renormalize to ensure probabilities sum to ~1.0
  const totalProb = adjusted.reduce((s, b) => s + (b.forecastProb || 0), 0);
  if (totalProb > 0 && Math.abs(totalProb - 1.0) > 0.01) {
    for (const b of adjusted) {
      if (b.forecastProb > 0) {
        b.forecastProb = b.forecastProb / totalProb;
        b.edge = b.forecastProb - (b.marketPrice || 0);
      }
    }
  }

  // Build active factor summary for the breakdown
  const activeFactors = (factors || [])
    .filter(f => Math.abs(f.adjustment) > 0.01 && f.confidence > 0.1)
    .map(f => ({
      factor: f.factor,
      adjustment: f.adjustment,
      confidence: f.confidence,
      reasoning: f.reasoning,
    }));

  return {
    adjusted,
    applied: true,
    breakdown: {
      netAdjustment,
      netConfidence,
      effectiveShift: +effectiveShift.toFixed(3),
      shiftFraction: +shiftFraction.toFixed(3),
      shiftDirection: shiftDirection > 0 ? 'WARMING' : 'COOLING',
      activeFactors,
      perBracket,
    },
  };
}
