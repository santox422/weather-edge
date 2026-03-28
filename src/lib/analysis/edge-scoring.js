/**
 * Edge Scoring & Confidence — composite edge computation, multi-factor
 * confidence model, and human-readable reasoning generation.
 */

/**
 * Compute composite edge score
 */
export function computeEdgeScore(analysis) {
  const { market, ensemble, multiModel, baseRate, daysUntilResolution, modelDivergence, forecastSkill, spreadScore, atmospheric, airQuality, trajectory, advancedFactors } = analysis;

  const bracketProbs = ensemble?.bracketProbabilities;

  // For multi-bracket markets: find the best edge across all brackets
  if (bracketProbs && bracketProbs.length > 1) {
    const scored = bracketProbs
      .filter((b) => b.forecastProb != null && b.marketPrice != null)
      .map((b) => ({
        ...b,
        absEdge: Math.abs(b.forecastProb - b.marketPrice),
      }));

    if (scored.length === 0) {
      return {
        marketProbability: null,
        forecastProbability: null,
        edgePercent: null,
        adjustedEdge: null,
        confidence: null,
        signal: 'NO_FORECAST',
        bracketProbabilities: bracketProbs,
        reasoning: 'Ensemble data available but no forecastable brackets',
      };
    }

    // Prefer largest positive edge (underpriced YES) — matches HondaCivic's strategy
    // of buying YES on the bracket your model says is most likely.
    // Fall back to largest negative edge (overpriced FADE) only if no positive edges.
    const positiveEdge = scored.filter(b => b.forecastProb > b.marketPrice);
    const best = positiveEdge.length > 0
      ? positiveEdge.sort((a, b) => (b.forecastProb - b.marketPrice) - (a.forecastProb - a.marketPrice))[0]
      : scored.sort((a, b) => b.absEdge - a.absEdge)[0];

    let conf = computeConfidence(daysUntilResolution, ensemble, modelDivergence, forecastSkill, spreadScore, atmospheric, airQuality, trajectory, advancedFactors);

    const rawEdge = best.forecastProb - best.marketPrice;
    const adjEdge = rawEdge * conf;

    let signal = 'HOLD';
    const absAdj = Math.abs(adjEdge);
    if (absAdj > 0.15) signal = rawEdge > 0 ? 'STRONG_BUY_YES' : 'STRONG_BUY_NO';
    else if (absAdj > 0.08) signal = rawEdge > 0 ? 'BUY_YES' : 'BUY_NO';
    else if (absAdj > 0.04) signal = rawEdge > 0 ? 'LEAN_YES' : 'LEAN_NO';

    const reasoning = buildBracketReasoning(bracketProbs, best, conf, signal, modelDivergence, forecastSkill, spreadScore, atmospheric, advancedFactors);

    return {
      marketProbability: best.marketPrice,
      forecastProbability: best.forecastProb,
      edgePercent: (rawEdge * 100).toFixed(1),
      adjustedEdge: (adjEdge * 100).toFixed(1),
      confidence: (conf * 100).toFixed(0),
      signal,
      bestBracket: best.name,
      bestBracketTitle: best.title || best.name,
      bracketProbabilities: bracketProbs,
      modelDivergence,
      ensembleSpread: ensemble?.averageSpread,
      reasoning,
    };
  }

  // For binary/single-threshold markets (fallback)
  let marketProb = null;
  const yesOutcome = market.outcomes?.find(
    (o) => o.name?.toLowerCase() === 'yes' || o.name?.toLowerCase().includes('yes')
  );
  if (yesOutcome) {
    marketProb = yesOutcome.price;
  } else if (market.outcomes?.length > 0) {
    const sorted = [...market.outcomes].sort((a, b) => (b.price || 0) - (a.price || 0));
    marketProb = sorted[0]?.price;
  }

  if (marketProb === null) {
    return {
      marketProbability: null,
      forecastProbability: null,
      edgePercent: null,
      adjustedEdge: null,
      confidence: null,
      signal: 'NO_DATA',
      bracketProbabilities: bracketProbs,
      reasoning: 'Could not determine market-implied probability',
    };
  }

  const probSources = [];
  if (ensemble?.probability != null) probSources.push({ source: 'ensemble', value: ensemble.probability, weight: 0.5 });
  if (multiModel?.consensus?.agreementRatio != null) probSources.push({ source: 'model_consensus', value: multiModel.consensus.agreementRatio, weight: 0.3 });
  if (baseRate?.rate != null) probSources.push({ source: 'base_rate', value: baseRate.rate, weight: 0.2 });

  if (probSources.length === 0) {
    return {
      marketProbability: marketProb,
      forecastProbability: null,
      edgePercent: null,
      adjustedEdge: null,
      confidence: null,
      signal: 'INSUFFICIENT_DATA',
      bracketProbabilities: bracketProbs,
      reasoning: 'Not enough data sources',
    };
  }

  const totalWeight = probSources.reduce((s, p) => s + p.weight, 0);
  const forecastProb = probSources.reduce((s, p) => s + (p.value * p.weight) / totalWeight, 0);
  const conf = computeConfidence(daysUntilResolution, ensemble, modelDivergence, forecastSkill, spreadScore, atmospheric, airQuality, trajectory, advancedFactors);
  const rawEdge = forecastProb - marketProb;
  const adjEdge = rawEdge * conf;

  let signal = 'HOLD';
  const absAdj = Math.abs(adjEdge);
  if (absAdj > 0.15) signal = rawEdge > 0 ? 'STRONG_BUY_YES' : 'STRONG_BUY_NO';
  else if (absAdj > 0.08) signal = rawEdge > 0 ? 'BUY_YES' : 'BUY_NO';
  else if (absAdj > 0.04) signal = rawEdge > 0 ? 'LEAN_YES' : 'LEAN_NO';

  return {
    marketProbability: marketProb,
    forecastProbability: forecastProb,
    edgePercent: (rawEdge * 100).toFixed(1),
    adjustedEdge: (adjEdge * 100).toFixed(1),
    confidence: (conf * 100).toFixed(0),
    signal,
    probSources,
    bracketProbabilities: bracketProbs,
    modelDivergence,
    ensembleSpread: ensemble?.averageSpread,
    reasoning: buildReasoning(probSources, marketProb, forecastProb, conf, signal, modelDivergence, forecastSkill, spreadScore, atmospheric),
  };
}

/**
 * Compute confidence — now incorporates forecast skill decay, spread score,
 * atmospheric stability, air quality, and trajectory convergence.
 */
export function computeConfidence(daysUntilResolution, ensemble, modelDivergence, forecastSkill, spreadScore, atmospheric, airQuality = null, trajectory = null, advancedFactors = null) {
  // Time-based decay
  let timeMult = forecastSkill?.skillFactor ?? 1.0;
  if (timeMult === null) {
    // Fallback
    if (daysUntilResolution) {
      if (daysUntilResolution <= 2) timeMult = 0.95;
      else if (daysUntilResolution <= 5) timeMult = 0.80;
      else if (daysUntilResolution <= 10) timeMult = 0.60;
      else if (daysUntilResolution <= 14) timeMult = 0.40;
      else timeMult = 0.25;
    }
  }

  // Ensemble spread factor
  let spreadConf = 1.0;
  if (ensemble?.averageSpread != null) {
    if (ensemble.averageSpread < 3) spreadConf = 1.0;
    else if (ensemble.averageSpread < 5.5) spreadConf = 0.85;
    else if (ensemble.averageSpread < 8) spreadConf = 0.65;
    else spreadConf = 0.45;
  }

  // Spread score multiplier — penalize poorly calibrated ensembles
  // NOTE: Very tight spread (< 2) is penalized as potential overconfidence,
  // not rewarded — a too-narrow ensemble may be missing real uncertainty.
  const spreadMult = spreadScore?.score != null
    ? (spreadScore.score < 2 ? 0.95 : spreadScore.score > 4 ? 0.90 : 1.0)
    : 1.0;

  // Divergence multiplier — models disagreeing means MORE uncertainty, not opportunity
  const divMult = modelDivergence?.isDivergent
    ? Math.max(0.7, 1 - 0.05 * (modelDivergence.difference / 1.5))
    : 1.0;

  // Atmospheric stability multiplier — high dew point depression = more stable = more predictable
  const atmMult = atmospheric?.dewPointDepression != null
    ? (atmospheric.dewPointDepression > 11 ? 1.05 : atmospheric.dewPointDepression < 3 ? 0.95 : 1.0)
    : 1.0;

  // Air quality multiplier — high AQI indicates haze/smog affecting surface temps
  // AQI > 100 (Unhealthy for Sensitive) reduces confidence as aerosol effects are hard to model
  let aqMult = 1.0;
  if (airQuality) {
    const aqi = airQuality.usAqi ?? airQuality.europeanAqi;
    if (aqi != null) {
      if (aqi > 150) aqMult = 0.92;       // Very unhealthy — significant aerosol effect
      else if (aqi > 100) aqMult = 0.96;   // Unhealthy for sensitive groups
    }
  }

  // Trajectory convergence multiplier — unstable forecast trajectory = less certainty
  let trajMult = 1.0;
  if (trajectory?.convergence) {
    const conv = trajectory.convergence;
    if (!conv.isConverging) trajMult = 0.93;             // Forecast still wandering
    if (conv.latestDivergence != null && conv.latestDivergence > 2.0) {
      trajMult = Math.min(trajMult, 0.90);               // GFS/ECMWF disagree significantly at latest run
    }
  }

  // Advanced factor synoptic clarity multiplier — clear synoptic pattern = more predictable
  let synopticMult = 1.0;
  if (advancedFactors?.factors) {
    const synoptic = advancedFactors.factors.find(f => f.factor === 'synoptic_pattern');
    if (synoptic?.pattern === 'HIGH_PRESSURE_CLEAR') synopticMult = 1.05;
    else if (synoptic?.pattern === 'FRONTAL_PASSAGE') synopticMult = 0.88;
    else if (synoptic?.pattern === 'POST_FRONT_CLEARING') synopticMult = 0.92;
    else if (synoptic?.pattern === 'TRANSITIONAL') synopticMult = 0.90;

    // Humidity/dew point ceilings active = clear physical constraint = more predictable
    const humCeiling = advancedFactors.factors.find(f => f.factor === 'humidity_ceiling');
    const dewCeiling = advancedFactors.factors.find(f => f.factor === 'dew_point_ceiling');
    if (humCeiling && Math.abs(humCeiling.adjustment) > 0.3) synopticMult *= 1.03;
    if (dewCeiling && Math.abs(dewCeiling.adjustment) > 0.3) synopticMult *= 1.03;
  }

  // All factors are multiplicative so they scale proportionally without
  // additive terms dominating at extremes.
  return Math.max(0.1, Math.min(1.0, timeMult * spreadConf * divMult * spreadMult * atmMult * aqMult * trajMult * synopticMult));
}

function buildBracketReasoning(brackets, best, conf, signal, divergence, forecastSkill, spreadScore, atmospheric, advancedFactors = null) {
  const parts = [];
  parts.push(`Multi-bracket analysis across ${brackets.length} outcomes.`);
  parts.push(`Best edge: "${best.name}" -- forecast ${(best.forecastProb * 100).toFixed(0)}% vs market ${(best.marketPrice * 100).toFixed(0)}%`);
  parts.push('');
  parts.push('Bracket breakdown:');
  for (const b of brackets) {
    if (b.forecastProb != null) {
      const edge = ((b.forecastProb - b.marketPrice) * 100).toFixed(1);
      const arrow = parseFloat(edge) > 0 ? '[+]' : parseFloat(edge) < 0 ? '[-]' : '[=]';
      parts.push(`  ${arrow} ${b.name}: fcst ${(b.forecastProb * 100).toFixed(0)}% / mkt ${(b.marketPrice * 100).toFixed(0)}% (edge: ${edge}%)`);
    }
  }

  if (forecastSkill) {
    parts.push(`\nForecast Skill: ${forecastSkill.grade} (${(forecastSkill.skillFactor * 100).toFixed(0)}% @ ${forecastSkill.daysOut}d lead)`);
    parts.push(`  ${forecastSkill.description}`);
  }

  if (spreadScore) {
    parts.push(`ENS SPREAD: ${spreadScore.score.toFixed(2)} -- ${spreadScore.interpretation}`);
  }

  if (divergence?.isDivergent) {
    parts.push(`\nMODEL DIVERGENCE: GFS=${divergence.gfsTemp?.toFixed(0)}°C vs ECMWF=${divergence.ecmwfTemp?.toFixed(0)}°C (${divergence.difference.toFixed(1)}°C gap)`);
    if (divergence.stdDev) parts.push(`  Std dev across ${divergence.modelCount} models: ${divergence.stdDev.toFixed(1)}°C`);
  }

  if (atmospheric) {
    parts.push(`\nAtmospheric: humidity ${atmospheric.humidity?.toFixed(0) ?? '--'}%, dew pt ${atmospheric.dewPoint?.toFixed(0) ?? '--'}°C, wind ${atmospheric.windSpeed?.toFixed(0) ?? '--'} mph, pressure ${atmospheric.pressure?.toFixed(0) ?? '--'} hPa`);
    if (atmospheric.precipProbability > 50) {
      parts.push(`  [!] High precip probability (${atmospheric.precipProbability.toFixed(0)}%) may cap temperatures`);
    }
  }

  if (advancedFactors?.factors) {
    parts.push(`\n--- Advanced Factors (PhD-Level) ---`);
    for (const f of advancedFactors.factors) {
      if (Math.abs(f.adjustment) > 0.01 || f.confidence > 0.2) {
        parts.push(f.reasoning);
      }
    }
    if (advancedFactors.netAdjustment !== 0) {
      parts.push(`\nNet factor adjustment: ${advancedFactors.netAdjustment > 0 ? '+' : ''}${advancedFactors.netAdjustment.toFixed(2)}°C (confidence: ${(advancedFactors.netConfidence * 100).toFixed(0)}%, dominant: ${advancedFactors.dominantFactor || 'none'})`);
    }
  }

  parts.push(`\nConfidence: ${(conf * 100).toFixed(0)}% | Signal: ${signal}`);
  return parts.join('\n');
}

function buildReasoning(sources, marketProb, forecastProb, confidence, signal, divergence, forecastSkill, spreadScore, atmospheric) {
  const parts = [];
  parts.push(`Market implies ${(marketProb * 100).toFixed(0)}% probability.`);
  parts.push(`Forecast analysis suggests ${(forecastProb * 100).toFixed(0)}%.`);

  for (const s of sources) {
    parts.push(`  - ${s.source}: ${(s.value * 100).toFixed(0)}% (weight: ${(s.weight * 100).toFixed(0)}%)`);
  }

  if (forecastSkill) {
    parts.push(`\nForecast Skill: ${forecastSkill.grade} (${(forecastSkill.skillFactor * 100).toFixed(0)}% @ ${forecastSkill.daysOut}d lead)`);
  }

  if (spreadScore) {
    parts.push(`ENS SPREAD: ${spreadScore.score.toFixed(2)} -- ${spreadScore.interpretation}`);
  }

  if (divergence?.isDivergent) {
    parts.push(`\nMODEL DIVERGENCE: GFS=${divergence.gfsTemp?.toFixed(0)}°C vs ECMWF=${divergence.ecmwfTemp?.toFixed(0)}°C (${divergence.difference.toFixed(1)}°C gap)`);
    parts.push(`  -> ${divergence.warmerModel} is warmer. Market may be anchored to one model.`);
    if (divergence.stdDev) parts.push(`  Std dev across ${divergence.modelCount} models: ${divergence.stdDev.toFixed(1)}°C`);
  }

  if (atmospheric) {
    parts.push(`\nAtmospheric: humidity ${atmospheric.humidity?.toFixed(0) ?? '--'}%, dew pt ${atmospheric.dewPoint?.toFixed(0) ?? '--'}°C, wind ${atmospheric.windSpeed?.toFixed(0) ?? '--'} mph`);
  }

  parts.push(`\nConfidence: ${(confidence * 100).toFixed(0)}%`);
  parts.push(`Signal: ${signal}`);

  return parts.join('\n');
}
