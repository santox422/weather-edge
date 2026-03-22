/**
 * Ensemble Processing — compute probability distributions from ensemble
 * member spread, KDE-based bracket probabilities, and exceedance.
 */

/**
 * Process ensemble data — compute probability from ensemble member spread
 */
export function processEnsembleData(ensembleData, market) {
  if (!ensembleData || !ensembleData.hourly) {
    return { probability: null, spread: null, members: [] };
  }

  const hourly = ensembleData.hourly;
  const times = hourly.time || [];

  const memberKeys = Object.keys(hourly).filter((k) => k.startsWith('temperature_2m_member'));
  if (memberKeys.length === 0) {
    return { probability: null, spread: null, members: [] };
  }

  const memberData = times.map((time, i) => {
    const values = memberKeys.map((k) => hourly[k][i]).filter((v) => v != null);
    return {
      time,
      values,
      min: Math.min(...values),
      max: Math.max(...values),
      mean: values.reduce((a, b) => a + b, 0) / values.length,
      spread: Math.max(...values) - Math.min(...values),
      p10: percentile(values, 10),
      p25: percentile(values, 25),
      p50: percentile(values, 50),
      p75: percentile(values, 75),
      p90: percentile(values, 90),
    };
  });

  let probability = null;
  let bracketProbabilities = null;
  let closestDayMaxes = null;

  if (market.marketType === 'temperature') {
    const dailyMaxByMember = {};
    memberKeys.forEach((key) => {
      dailyMaxByMember[key] = {};
      times.forEach((time, i) => {
        const day = time.split('T')[0];
        const val = hourly[key][i];
        if (val != null) {
          if (!dailyMaxByMember[key][day] || val > dailyMaxByMember[key][day]) {
            dailyMaxByMember[key][day] = val;
          }
        }
      });
    });

    const allDays = [...new Set(times.map((t) => t.split('T')[0]))];
    const targetDay = market.endDate
      ? new Date(market.endDate).toISOString().split('T')[0]
      : allDays[allDays.length - 1];

    const closestDay = allDays.reduce((best, day) => {
      if (!best) return day;
      return Math.abs(new Date(day) - new Date(targetDay)) <
        Math.abs(new Date(best) - new Date(targetDay))
        ? day
        : best;
    }, null);

    if (closestDay) {
      const memberMaxes = memberKeys
        .map((key) => dailyMaxByMember[key][closestDay])
        .filter((v) => v != null);
      closestDayMaxes = memberMaxes;

      if (memberMaxes.length > 0) {
        if (market.threshold) {
          const exceedCount = memberMaxes.filter((v) => v >= market.threshold).length;
          probability = exceedCount / memberMaxes.length;
        }

        if (market.outcomes && market.outcomes.length > 1) {
          bracketProbabilities = computeBracketProbabilities(memberMaxes, market.outcomes);
        }
      }
    }
  }

  return {
    probability,
    bracketProbabilities,
    memberMaxes: closestDayMaxes,
    memberCount: memberKeys.length,
    timeSteps: memberData,
    averageSpread:
      memberData.reduce((sum, d) => sum + d.spread, 0) / memberData.length,
  };
}

/**
 * Gaussian KDE — fits a smooth probability density over ensemble member maxima.
 * Bandwidth controls smoothness (default 0.5°C produces well-calibrated brackets).
 */
function gaussianKDE(values, bandwidth = 0.5) {
  const n = values.length;
  const coeff = 1 / (n * bandwidth * Math.sqrt(2 * Math.PI));
  return function pdf(x) {
    let sum = 0;
    for (const xi of values) {
      sum += Math.exp(-0.5 * ((x - xi) / bandwidth) ** 2);
    }
    return sum * coeff;
  };
}

/**
 * Integrate KDE PDF over a range [lo, hi) using trapezoidal rule.
 */
function integratePDF(pdf, lo, hi, steps = 200) {
  const dx = (hi - lo) / steps;
  let integral = 0;
  for (let i = 0; i < steps; i++) {
    integral += pdf(lo + (i + 0.5) * dx) * dx;
  }
  return Math.max(0, Math.min(1, integral));
}

/**
 * Compute probability distribution across bracket outcomes from ensemble
 * using Kernel Density Estimation for smoother, more accurate distributions.
 * Optionally applies station bias correction.
 */
export function computeBracketProbabilities(memberMaxes, outcomes, biasCorrectionCelsius = 0) {
  if (!memberMaxes || memberMaxes.length === 0 || !outcomes) return null;

  // Apply bias correction (shift members toward actual station readings)
  const corrected = biasCorrectionCelsius !== 0
    ? memberMaxes.map((v) => v - biasCorrectionCelsius)
    : memberMaxes;

  // Build KDE from corrected member maxima
  const kde = gaussianKDE(corrected, 0.5);

  return outcomes.map((outcome) => {
    const threshold = outcome.threshold;
    if (!threshold) return { name: outcome.name, title: outcome.title, marketPrice: outcome.price, forecastProb: null, edge: null };

    const val = threshold.value;
    let forecastProb;

    if (threshold.type === 'range') {
      forecastProb = integratePDF(kde, val, threshold.high + 0.5);
    } else if (threshold.type === 'below') {
      forecastProb = integratePDF(kde, val - 30, val + 0.5);
    } else if (threshold.type === 'above') {
      forecastProb = integratePDF(kde, val - 0.5, val + 30);
    } else {
      // Exact bracket: integrate over [val-0.5, val+0.5) — matches whole-degree rounding
      forecastProb = integratePDF(kde, val - 0.5, val + 0.5);
    }

    return {
      name: outcome.name,
      title: outcome.title,
      marketPrice: outcome.price,
      forecastProb,
      edge: forecastProb - outcome.price,
    };
  });
}

/**
 * Calculate ensemble exceedance probability for a given threshold
 */
export function calculateEnsembleProbability(memberValues, threshold) {
  if (!memberValues || memberValues.length === 0) return null;
  const exceedCount = memberValues.filter((v) => v >= threshold).length;
  return exceedCount / memberValues.length;
}

/**
 * Utility: compute percentile of an array
 */
export function percentile(arr, p) {
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (idx - lower);
}
