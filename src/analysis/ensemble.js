/**
 * Ensemble Processing — compute probability distributions from ensemble
 * member spread, KDE-based bracket probabilities, and exceedance.
 */

/**
 * Process ensemble data — compute probability from ensemble member spread.
 * Accepts optional ensembleWeights to replicate members from higher-weighted
 * ensemble models proportionally in the KDE pool.
 * @param {Object} ensembleData — raw ensemble API response
 * @param {Object} market — market metadata
 * @param {Object} [ensembleWeights] — e.g. { gfs025: 1.5, ecmwf_ifs025: 1.0, ... }
 */
export function processEnsembleData(ensembleData, market, ensembleWeights = null) {
  if (!ensembleData || !ensembleData.hourly) {
    return { probability: null, spread: null, members: [] };
  }

  const hourly = ensembleData.hourly;
  const times = hourly.time || [];

  const memberKeys = Object.keys(hourly).filter((k) => k.startsWith('temperature_2m_member'));
  if (memberKeys.length === 0) {
    return { probability: null, spread: null, members: [] };
  }

  // Identify which ensemble model each member key belongs to
  // Open-Meteo prefixes member keys like: temperature_2m_member00, etc.
  // When multiple models are requested, keys may have model prefixes.
  // We approximate by grouping based on member index ranges:
  // GFS has 31 members, ECMWF IFS has 51, ECMWF AIFS has 51, ICON-EPS has 40
  function getMemberWeight(key) {
    if (!ensembleWeights) return 1.0;
    // Try to identify model from key pattern — Open-Meteo uses flat member indices
    // We can't perfectly disambiguate, so we use a uniform weight approach:
    // Apply the average ensemble weight across all models
    const weights = Object.values(ensembleWeights);
    return weights.length > 0 ? weights.reduce((a, b) => a + b, 0) / weights.length : 1.0;
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
      let memberMaxes = memberKeys
        .map((key) => dailyMaxByMember[key][closestDay])
        .filter((v) => v != null);

      // Apply regional ensemble weights by scaling member counts proportionally.
      // Higher-weighted models get more representation, lower-weighted get less.
      if (ensembleWeights && memberMaxes.length > 0) {
        const weightValues = Object.values(ensembleWeights);
        const minWeight = Math.min(...weightValues);
        const maxWeight = Math.max(...weightValues);

        // Only scale if there's meaningful weight variation
        if (maxWeight > minWeight * 1.2) {
          const modelSegments = Object.entries(ensembleWeights);
          const knownCounts = { gfs025: 31, ecmwf_ifs025: 51, ecmwf_aifs025: 51, icon_seamless_eps: 40 };

          let idx = 0;
          const weightedMaxes = [];
          for (const [model, weight] of modelSegments) {
            const count = knownCounts[model] || Math.floor(memberMaxes.length / modelSegments.length);
            const segment = memberMaxes.slice(idx, idx + count);
            idx += count;

            // Target count = original × weight (e.g. 0.8× = subsample, 1.3× = replicate)
            const targetCount = Math.max(1, Math.round(segment.length * weight));
            for (let i = 0; i < targetCount; i++) {
              weightedMaxes.push(segment[i % segment.length]);
            }
          }

          // Use remaining members if any (safety)
          if (idx < memberMaxes.length) {
            weightedMaxes.push(...memberMaxes.slice(idx));
          }

          memberMaxes = weightedMaxes;
        }
      }

      closestDayMaxes = memberMaxes;

      if (memberMaxes.length > 0) {
        if (market.threshold) {
          // Convert threshold to °C if market uses °F (ensemble members are in °C)
          const thresholdC = market.unit === 'F'
            ? (market.threshold - 32) * 5 / 9
            : market.threshold;
          const exceedCount = memberMaxes.filter((v) => v >= thresholdC).length;
          probability = exceedCount / memberMaxes.length;
        }

        if (market.outcomes && market.outcomes.length > 1) {
          bracketProbabilities = computeBracketProbabilities(memberMaxes, market.outcomes, 0, market.unit || 'C');
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
 * Uses Silverman's rule for adaptive bandwidth when no explicit bandwidth is provided:
 *   h = 0.9 × min(σ, IQR / 1.34) × n^(-1/5)
 * Clamped to [0.2, 1.5]°C as a safety bound.
 */
function gaussianKDE(values, bandwidth = null) {
  const n = values.length;

  // Compute adaptive bandwidth via Silverman's rule if not explicitly provided
  if (bandwidth == null) {
    const sorted = [...values].sort((a, b) => a - b);
    const mean = values.reduce((a, b) => a + b, 0) / n;
    const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / n;
    const sigma = Math.sqrt(variance);
    const q1 = sorted[Math.floor(n * 0.25)];
    const q3 = sorted[Math.floor(n * 0.75)];
    const iqr = q3 - q1;
    const spread = iqr > 0 ? Math.min(sigma, iqr / 1.34) : sigma;
    bandwidth = 0.9 * spread * Math.pow(n, -0.2);
    // Clamp to reasonable range
    bandwidth = Math.max(0.2, Math.min(1.5, bandwidth));
  }

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
 * Applies station bias correction. Wunderground integer bucketing is handled
 * by the integration bounds [val-0.5, val+0.5) rather than rounding the data.
 * @param {number[]} memberMaxes — ensemble member daily max temperatures (°C)
 * @param {Object[]} outcomes — bracket outcomes with threshold info
 * @param {number} biasCorrectionCelsius — bias offset to subtract from members
 * @param {string} marketUnit — 'C' or 'F', used to convert thresholds to match ensemble °C data
 */
export function computeBracketProbabilities(memberMaxes, outcomes, biasCorrectionCelsius = 0, marketUnit = 'C') {
  if (!memberMaxes || memberMaxes.length === 0 || !outcomes) return null;

  // Apply bias correction (shift members toward actual station readings)
  let corrected = biasCorrectionCelsius !== 0
    ? memberMaxes.map((v) => v - biasCorrectionCelsius)
    : [...memberMaxes];

  // NOTE: We intentionally do NOT round members to integers here.
  // Wunderground reports whole-degree integers, but rounding the raw data before
  // KDE destroys the continuous distribution shape — e.g. models predicting
  // 15.3–15.7°C would all round to 16, leaving 15°C in an artificial valley.
  // Instead, the integration bounds [val-0.5, val+0.5) correctly capture
  // Wunderground's integer bucketing without distorting the underlying density.

  // Build KDE from corrected member maxima (always in °C)
  // Bandwidth computed via Silverman's rule (adaptive to ensemble spread)
  const kde = gaussianKDE(corrected);

  // Helper: convert a °F value to °C
  const toC = (f) => (f - 32) * 5 / 9;
  const isFahrenheit = marketUnit === 'F';

  return outcomes.map((outcome) => {
    const threshold = outcome.threshold;
    if (!threshold) return { name: outcome.name, title: outcome.title, marketPrice: outcome.price, forecastProb: null, edge: null };

    // Convert threshold values to °C if market is in °F
    const val = isFahrenheit ? toC(threshold.value) : threshold.value;
    // For °F brackets, 0.5°F ≈ 0.28°C. Use °C-equivalent half-width.
    const halfWidth = isFahrenheit ? 0.28 : 0.5;
    let forecastProb;

    if (threshold.type === 'range') {
      const high = isFahrenheit ? toC(threshold.high) : threshold.high;
      forecastProb = integratePDF(kde, val - halfWidth, high + halfWidth);
    } else if (threshold.type === 'below') {
      forecastProb = integratePDF(kde, val - 30, val + halfWidth);
    } else if (threshold.type === 'above') {
      forecastProb = integratePDF(kde, val - halfWidth, val + 30);
    } else {
      // Exact bracket: integrate over [val-halfWidth, val+halfWidth)
      forecastProb = integratePDF(kde, val - halfWidth, val + halfWidth);
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
 * Compute bracket probabilities from deterministic model predictions using
 * Bayesian Model Averaging (BMA). Each model contributes a Gaussian centered
 * on its prediction with σ based on forecast lead time (reflects typical
 * model error at that horizon). Bracket probabilities are the weighted average
 * of per-model integrals.
 *
 * @param {Object[]} predictions — [{maxTemp, weight, model}, ...]
 * @param {Object[]} outcomes — bracket outcomes with threshold info
 * @param {number} daysOut — forecast lead time in days (drives σ)
 * @param {number} biasCorrectionCelsius — station bias to subtract from predictions
 * @param {string} marketUnit — 'C' or 'F'
 */
export function computeDeterministicBracketProbs(predictions, outcomes, daysOut = 1, biasCorrectionCelsius = 0, marketUnit = 'C') {
  if (!predictions || predictions.length === 0 || !outcomes) return null;

  // Forecast error σ by lead time (typical NWP MAE for good models)
  const sigma = daysOut <= 1 ? 0.7 : daysOut <= 2 ? 1.0 : daysOut <= 4 ? 1.3 : 1.8;

  const isFahrenheit = marketUnit === 'F';
  const toC = (f) => (f - 32) * 5 / 9;

  const totalWeight = predictions.reduce((s, p) => s + (p.weight || 1), 0);
  if (totalWeight === 0) return null;

  return outcomes.map((outcome) => {
    const threshold = outcome.threshold;
    if (!threshold) return { name: outcome.name, title: outcome.title, marketPrice: outcome.price, forecastProb: null, edge: null };

    const val = isFahrenheit ? toC(threshold.value) : threshold.value;
    const halfWidth = isFahrenheit ? 0.28 : 0.5;

    // Compute bracket bounds
    let lo, hi;
    if (threshold.type === 'range') {
      const high = isFahrenheit ? toC(threshold.high) : threshold.high;
      lo = val - halfWidth;
      hi = high + halfWidth;
    } else if (threshold.type === 'below') {
      lo = val - 30;
      hi = val + halfWidth;
    } else if (threshold.type === 'above') {
      lo = val - halfWidth;
      hi = val + 30;
    } else {
      lo = val - halfWidth;
      hi = val + halfWidth;
    }

    // Weighted average of per-model bracket probabilities
    let forecastProb = 0;
    for (const p of predictions) {
      const mu = p.maxTemp - biasCorrectionCelsius;
      const w = (p.weight || 1) / totalWeight;
      // Integrate Gaussian N(mu, sigma²) over [lo, hi]
      forecastProb += w * (gaussianCDF((hi - mu) / sigma) - gaussianCDF((lo - mu) / sigma));
    }

    return {
      name: outcome.name,
      title: outcome.title,
      marketPrice: outcome.price,
      forecastProb: Math.max(0, Math.min(1, forecastProb)),
      edge: Math.max(0, Math.min(1, forecastProb)) - outcome.price,
    };
  });
}

/**
 * Standard normal CDF (Abramowitz & Stegun approximation, ≤ 7.5×10⁻⁸ error)
 */
function gaussianCDF(x) {
  if (x < -8) return 0;
  if (x > 8) return 1;
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const t = 1 / (1 + p * Math.abs(x));
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x / 2);
  return 0.5 * (1 + sign * y);
}

/**
 * Blend ensemble and deterministic bracket probabilities using BMA weights.
 * Each stream gets influence proportional to its total model weight sum.
 *
 * @param {Object[]} ensBrackets — ensemble KDE bracket probabilities
 * @param {Object[]} detBrackets — deterministic model bracket probabilities
 * @param {number} ensWeight — total ensemble model weight (sum of ensemble model weights)
 * @param {number} detWeight — total deterministic model weight (sum of det model weights)
 */
export function blendBracketProbabilities(ensBrackets, detBrackets, ensWeight, detWeight) {
  if (!ensBrackets) return detBrackets;
  if (!detBrackets) return ensBrackets;

  const totalWeight = ensWeight + detWeight;
  const alpha = ensWeight / totalWeight;   // ensemble fraction
  const beta = detWeight / totalWeight;    // deterministic fraction

  return ensBrackets.map((ens, i) => {
    const det = detBrackets[i];
    if (!ens || !det || ens.forecastProb == null || det.forecastProb == null) {
      return ens || det;
    }

    const forecastProb = alpha * ens.forecastProb + beta * det.forecastProb;
    return {
      name: ens.name,
      title: ens.title,
      marketPrice: ens.marketPrice,
      forecastProb,
      edge: forecastProb - ens.marketPrice,
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
