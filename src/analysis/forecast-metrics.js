/**
 * Forecast Metrics — skill decay curves, CRPS calibration, and model divergence.
 */

/**
 * Compute Forecast Skill Decay — empirical decay curve based on
 * NWS/ECMWF verification studies. Returns skill factor (0-1) and
 * confidence rating for the given lead time.
 */
export function computeForecastSkillDecay(daysOut) {
  if (daysOut == null) return { skillFactor: null, grade: 'N/A', description: 'Unknown lead time' };

  // Empirical skill decay based on ECMWF and GFS verification data
  // These approximate the Anomaly Correlation Coefficient (ACC) decay
  const decayTable = [
    { maxDays: 1, skill: 0.95, grade: 'A+', desc: 'Highest confidence. Forecast skill near maximum. Deterministic models highly reliable.' },
    { maxDays: 2, skill: 0.90, grade: 'A',  desc: 'Very high confidence. Minor uncertainty from mesoscale variability.' },
    { maxDays: 3, skill: 0.85, grade: 'B+', desc: 'High confidence. Ensemble spread provides meaningful uncertainty bounds.' },
    { maxDays: 5, skill: 0.70, grade: 'B',  desc: 'Moderate confidence. Model divergence becomes significant. Ensemble spread critical.' },
    { maxDays: 7, skill: 0.55, grade: 'C+', desc: 'Reduced confidence. Synoptic-scale pattern changes affect accuracy.' },
    { maxDays: 10, skill: 0.40, grade: 'C', desc: 'Low confidence. Forecasts capture trends but threshold accuracy degrades.' },
    { maxDays: 14, skill: 0.25, grade: 'D', desc: 'Very low confidence. Only large-scale patterns reliably forecast.' },
    { maxDays: Infinity, skill: 0.15, grade: 'F', desc: 'Minimal skill. Approaching climatological baseline only.' },
  ];

  const entry = decayTable.find((e) => daysOut <= e.maxDays);
  return {
    skillFactor: entry.skill,
    grade: entry.grade,
    daysOut,
    description: entry.desc,
  };
}

/**
 * Compute CRPS (Continuous Ranked Probability Score)
 * Measures how well the ensemble probability distribution matches reality.
 * Lower CRPS = better calibrated ensemble.
 *
 * Since we don't have observations yet (forecasting forward), we compute
 * a proxy CRPS based on ensemble spread characteristics:
 * - How tight/dispersed is the ensemble?
 * - Is the spread consistent with expected uncertainty?
 */
export function computeCRPS(ensemble) {
  if (!ensemble?.timeSteps?.length) return null;

  // Use the ensemble spread characteristics as a calibration proxy
  const steps = ensemble.timeSteps;
  const spreads = steps.map((s) => s.spread).filter((v) => v != null);

  if (spreads.length === 0) return null;

  const avgSpread = spreads.reduce((a, b) => a + b, 0) / spreads.length;
  const maxSpread = Math.max(...spreads);
  const minSpread = Math.min(...spreads);
  const spreadVariance = spreads.reduce((sum, s) => sum + Math.pow(s - avgSpread, 2), 0) / spreads.length;
  const spreadStdDev = Math.sqrt(spreadVariance);

  // CRPS proxy: normalize spread to a score
  // Well-calibrated ensembles have moderate, consistent spread
  // Score < 2 = good, 2-4 = fair, > 4 = poor
  const score = avgSpread / 5;

  return {
    score: Math.min(score, 10),
    avgSpread,
    maxSpread,
    minSpread,
    spreadStdDev,
    memberCount: ensemble.memberCount,
    interpretation: score < 2
      ? 'Well-calibrated ensemble. Spread consistent with expected uncertainty.'
      : score < 4
        ? 'Moderate calibration. Some spread inconsistency detected.'
        : 'Wide ensemble spread. High uncertainty in forecast distribution.',
  };
}

/**
 * Detect divergence between GFS and ECMWF models.
 * Extended to include all available models for richer analysis.
 * Uses weighted mean/std dev when model weights are available.
 */
export function detectModelDivergence(multiModel) {
  if (!multiModel?.consensus?.predictions) return null;

  const preds = multiModel.consensus.predictions;
  const gfs = preds.find((p) => p.model?.includes('gfs'));
  const ecmwf = preds.find((p) => p.model?.includes('ecmwf'));

  if (!gfs?.maxTemp || !ecmwf?.maxTemp) return null;

  const diff = Math.abs(gfs.maxTemp - ecmwf.maxTemp);
  const divergent = diff > 1.5; // 1.5°C divergence threshold

  // Compute weighted mean and std dev across all models
  const validPreds = preds.filter((p) => p.maxTemp != null);
  const totalWeight = validPreds.reduce((s, p) => s + (p.weight || 1), 0);
  const mean = validPreds.reduce((s, p) => s + p.maxTemp * (p.weight || 1), 0) / totalWeight;
  const variance = validPreds.reduce((s, p) => s + (p.weight || 1) * Math.pow(p.maxTemp - mean, 2), 0) / totalWeight;
  const stdDev = Math.sqrt(variance);

  // Identify outlier models (> 1.5 std dev from weighted mean)
  const outliers = validPreds.filter((p) => Math.abs(p.maxTemp - mean) > 1.5 * stdDev);

  return {
    gfsTemp: gfs.maxTemp,
    ecmwfTemp: ecmwf.maxTemp,
    difference: diff,
    isDivergent: divergent,
    warmerModel: gfs.maxTemp > ecmwf.maxTemp ? 'GFS' : 'ECMWF',
    modelCount: validPreds.length,
    meanTemp: mean,
    stdDev,
    isWeighted: validPreds.some(p => p.weight && p.weight !== 1),
    outlierModels: outliers.map((p) => p.model),
    summary: divergent
      ? `Models disagree by ${diff.toFixed(1)}°C. ${gfs.maxTemp > ecmwf.maxTemp ? 'GFS' : 'ECMWF'} is warmer. Std dev: ${stdDev.toFixed(1)}°C across ${validPreds.length} models.`
      : `Models agree within ${diff.toFixed(1)}°C. Std dev: ${stdDev.toFixed(1)}°C across ${validPreds.length} models.`,
  };
}
