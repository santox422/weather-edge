/**
 * Edge Scoring & Confidence — composite edge computation, multi-factor
 * confidence model, and human-readable reasoning generation.
 */

/**
 * Compute composite edge score
 */
export function computeEdgeScore(analysis) {
  const { market, ensemble, multiModel, baseRate, daysUntilResolution, modelDivergence, forecastSkill, crps, atmospheric } = analysis;

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

    const best = scored.sort((a, b) => b.absEdge - a.absEdge)[0];

    let conf = computeConfidence(daysUntilResolution, ensemble, modelDivergence, forecastSkill, crps, atmospheric);

    const rawEdge = best.forecastProb - best.marketPrice;
    const adjEdge = rawEdge * conf;

    let signal = 'HOLD';
    const absAdj = Math.abs(adjEdge);
    if (absAdj > 0.15) signal = rawEdge > 0 ? 'STRONG_BUY_YES' : 'STRONG_BUY_NO';
    else if (absAdj > 0.08) signal = rawEdge > 0 ? 'BUY_YES' : 'BUY_NO';
    else if (absAdj > 0.04) signal = rawEdge > 0 ? 'LEAN_YES' : 'LEAN_NO';

    const reasoning = buildBracketReasoning(bracketProbs, best, conf, signal, modelDivergence, forecastSkill, crps, atmospheric);

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
  const conf = computeConfidence(daysUntilResolution, ensemble, modelDivergence, forecastSkill, crps, atmospheric);
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
    reasoning: buildReasoning(probSources, marketProb, forecastProb, conf, signal, modelDivergence, forecastSkill, crps, atmospheric),
  };
}

/**
 * Compute confidence — now incorporates forecast skill decay, CRPS, and atmospheric stability
 */
export function computeConfidence(daysUntilResolution, ensemble, modelDivergence, forecastSkill, crps, atmospheric) {
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

  // CRPS adjustment — penalize poorly calibrated ensembles
  let crpsAdj = 0;
  if (crps?.score != null) {
    if (crps.score < 2) crpsAdj = 0.05; // bonus for good calibration
    else if (crps.score > 4) crpsAdj = -0.1; // penalty for poor calibration
  }

  // Divergence bonus — divergence = potential edge opportunity
  let divBonus = modelDivergence?.isDivergent ? 0.1 : 0;

  // Atmospheric stability factor — high dew point depression = more stable = more predictable
  let atmAdj = 0;
  if (atmospheric?.dewPointDepression != null) {
    if (atmospheric.dewPointDepression > 11) atmAdj = 0.05; // very dry, stable
    else if (atmospheric.dewPointDepression < 3) atmAdj = -0.05; // near saturation, thunderstorm risk
  }

  return Math.max(0.1, Math.min(1.0, timeMult * spreadConf + divBonus + crpsAdj + atmAdj));
}

function buildBracketReasoning(brackets, best, conf, signal, divergence, forecastSkill, crps, atmospheric) {
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

  if (crps) {
    parts.push(`CRPS: ${crps.score.toFixed(2)} -- ${crps.interpretation}`);
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

  parts.push(`\nConfidence: ${(conf * 100).toFixed(0)}% | Signal: ${signal}`);
  return parts.join('\n');
}

function buildReasoning(sources, marketProb, forecastProb, confidence, signal, divergence, forecastSkill, crps, atmospheric) {
  const parts = [];
  parts.push(`Market implies ${(marketProb * 100).toFixed(0)}% probability.`);
  parts.push(`Forecast analysis suggests ${(forecastProb * 100).toFixed(0)}%.`);

  for (const s of sources) {
    parts.push(`  - ${s.source}: ${(s.value * 100).toFixed(0)}% (weight: ${(s.weight * 100).toFixed(0)}%)`);
  }

  if (forecastSkill) {
    parts.push(`\nForecast Skill: ${forecastSkill.grade} (${(forecastSkill.skillFactor * 100).toFixed(0)}% @ ${forecastSkill.daysOut}d lead)`);
  }

  if (crps) {
    parts.push(`CRPS: ${crps.score.toFixed(2)} -- ${crps.interpretation}`);
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
