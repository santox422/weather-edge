/**
 * Analysis Engine — orchestrates the full analysis pipeline for weather
 * markets by coordinating ensemble processing, multi-model data, forecast
 * metrics, edge scoring, trading strategy, and signal logging.
 *
 * Supports multi-outcome bracket markets (not just binary Yes/No).
 * Uses 7-model consensus: GFS, ECMWF IFS, ECMWF AIFS, ICON, JMA, GEM, MeteoFrance.
 * Features: KDE bracket probabilities, station bias correction, forecast trajectory.
 */

import {
  getEnsemble,
  getHistoricalBaseRate,
  getMultiModelForecast,
  getAtmosphericData,
  getAirQuality,
  getForecastTrajectory,
  getStationBias,
  getCurrentWeather,
} from "../services/weather-service.js";
import { resolveCity } from "./city-resolver.js";

// ── Module imports ──
import {
  processEnsembleData,
  computeBracketProbabilities,
  computeDeterministicBracketProbs,
  blendBracketProbabilities,
  calculateEnsembleProbability,
} from "./ensemble.js";
import {
  processAtmosphericData,
  processAirQuality,
  processMultiModelData,
  computeBaseRate,
} from "./weather-processors.js";
import {
  computeForecastSkillDecay,
  computeSpreadScore,
  detectModelDivergence,
} from "./forecast-metrics.js";
import { computeEdgeScore } from "./edge-scoring.js";
import { computeTradingStrategy } from "./trading-strategy.js";
import { logSignal, getSignalLogs } from "./signal-logger.js";
import { getModelsForCity } from "./model-registry.js";

// ── Re-exports (public API) ──
export { calculateEnsembleProbability } from "./ensemble.js";
export { computeTradingStrategy } from "./trading-strategy.js";
export { getSignalLogs } from "./signal-logger.js";

/**
 * Run full analysis for a weather market
 */
export async function analyzeMarket(market) {
  const city = resolveCity(`${market.title || ""} ${market.description || ""}`);
  if (!city) {
    return {
      market,
      error: "Could not resolve city/station from market text",
      edge: null,
    };
  }

  const daysUntilResolution = market.endDate
    ? Math.max(
        1,
        Math.ceil(
          (new Date(market.endDate) - new Date()) / (1000 * 60 * 60 * 24),
        ),
      )
    : null;

  // Get city-aware model configuration
  const modelConfig = getModelsForCity(city);
  console.log(
    `[MODELS] ${city.matchedKey} (${modelConfig.region}): ${modelConfig.deterministicSlugs.length} deterministic, ${modelConfig.ensemble.length} ensemble`,
  );

  const analysis = {
    market,
    city,
    daysUntilResolution,
    modelConfig, // Store model config for UI display
    ensemble: null,
    multiModel: null,
    baseRate: null,
    edge: null,
    modelDivergence: null,
    atmospheric: null,
    airQuality: null,
    forecastSkill: null,
    spreadScore: null,
    stationBias: null,
    trajectory: null,
    liveWeather: null,
    strategy: null,
  };

  try {
    // 1. Get ensemble data (city-aware ensemble models)
    const ensembleData = await getEnsemble(
      city.lat,
      city.lon,
      modelConfig.ensemble,
    );
    analysis.ensemble = processEnsembleData(
      ensembleData,
      market,
      modelConfig.ensembleWeights,
    );

    // 1b. Get station bias correction
    // NOTE: Bias correction is stored here but NOT applied to bracket probs yet.
    // The actual bias-corrected bracket probabilities are computed in step 2a,
    // which blends ensemble + deterministic pseudo-members with bias correction.
    // Applying it here would be wasted computation since 2a overwrites the result.
    try {
      analysis.stationBias = await getStationBias(city.lat, city.lon, 90);
      if (analysis.stationBias?.reliable && analysis.stationBias.bias !== 0) {
        console.log(
          `[BIAS] ${analysis.stationBias.bias > 0 ? "+" : ""}${analysis.stationBias.bias.toFixed(2)}°C correction for ${city.matchedKey} (applied in step 2a)`,
        );
      }
    } catch (err) {
      console.log(
        `[WARN] Bias correction unavailable for ${city.matchedKey}: ${err.message}`,
      );
    }

    // 2. Get multi-model comparison (city-aware model selection)
    const multiModelData = await getMultiModelForecast(
      city.lat,
      city.lon,
      Math.min((daysUntilResolution || 7) + 1, 16),
      modelConfig.deterministicSlugs,
    );
    analysis.multiModel = processMultiModelData(
      multiModelData,
      market,
      modelConfig.modelWeights,
    );

    // 2a. BMA (Bayesian Model Averaging) blend of ensemble + deterministic.
    // Two independent probability streams blended by total model quality weight:
    //   Stream 1 (Ensemble): KDE over ~170 weighted members → P_ens(bracket)
    //   Stream 2 (Deterministic): Per-model Gaussian N(pred, σ²) → P_det(bracket)
    //   Final: P = (w_ens × P_ens + w_det × P_det) / (w_ens + w_det)
    // This properly represents deterministic-only models (UKMO, ICON-EU, AROME)
    // that have no ensemble products but carry the highest city-specific weights.
    if (analysis.ensemble?.bracketProbabilities) {
      analysis.ensemble.rawBracketProbabilities = analysis.ensemble.bracketProbabilities;
    }
    if (analysis.ensemble?.bracketProbabilities && analysis.multiModel?.consensus?.predictions) {
      const preds = analysis.multiModel.consensus.predictions.filter(p => p.maxTemp != null);

      if (preds.length > 0) {
        // Bias correction (discounted 50%: ERA5 reanalysis vs Wunderground station)
        const bias = (analysis.stationBias?.reliable && analysis.stationBias.bias !== 0)
          ? analysis.stationBias.bias * 0.5 : 0;

        // Stream 1: Ensemble KDE (re-compute with bias correction)
        const ensBrackets = analysis.ensemble.memberMaxes
          ? computeBracketProbabilities(analysis.ensemble.memberMaxes, market.outcomes, bias, market.unit || 'C')
          : analysis.ensemble.bracketProbabilities;

        // Stream 2: Deterministic per-model Gaussian (weighted by model quality)
        const detBrackets = computeDeterministicBracketProbs(
          preds, market.outcomes, daysUntilResolution || 1, bias, market.unit || 'C'
        );

        // BMA blend by total model weight per stream
        const ensWeightTotal = modelConfig.ensembleWeights
          ? Object.values(modelConfig.ensembleWeights).reduce((a, b) => a + b, 0)
          : 4.0;
        const detWeightTotal = preds.reduce((s, p) => s + (p.weight || 1), 0);

        analysis.ensemble.bracketProbabilities = blendBracketProbabilities(
          ensBrackets, detBrackets, ensWeightTotal, detWeightTotal
        );

        analysis.ensemble.bmaBlend = {
          ensWeight: ensWeightTotal,
          detWeight: detWeightTotal,
          ensFraction: (ensWeightTotal / (ensWeightTotal + detWeightTotal) * 100).toFixed(0) + '%',
          detFraction: (detWeightTotal / (ensWeightTotal + detWeightTotal) * 100).toFixed(0) + '%',
          detModels: preds.length,
          daysOut: daysUntilResolution || 1,
        };
        console.log(`[BMA] Blend: ensemble ${analysis.ensemble.bmaBlend.ensFraction} (wt ${ensWeightTotal.toFixed(1)}) + deterministic ${analysis.ensemble.bmaBlend.detFraction} (wt ${detWeightTotal.toFixed(1)}, ${preds.length} models) | ${daysUntilResolution || 1}d lead`);
      }
    }

    // 2b. Detect model divergence (GFS vs ECMWF vs others)
    analysis.modelDivergence = detectModelDivergence(analysis.multiModel);

    // 3. Get historical base rate
    try {
      if (market.endDate) {
        const resDate = new Date(market.endDate);
        const baseRateData = await getHistoricalBaseRate(
          city.lat,
          city.lon,
          resDate.getMonth() + 1,
          resDate.getDate(),
        );
        analysis.baseRate = computeBaseRate(baseRateData, market);
      }
    } catch (err) {
      console.log(
        `[WARN] Historical data unavailable for ${city.matchedKey}: ${err.message}`,
      );
    }

    // 4. Get atmospheric conditions
    try {
      const atmData = await getAtmosphericData(city.lat, city.lon, 3);
      analysis.atmospheric = processAtmosphericData(atmData, market);
    } catch (err) {
      console.log(
        `[WARN] Atmospheric data unavailable for ${city.matchedKey}: ${err.message}`,
      );
    }

    // 5. Get air quality, UV index, and live weather constraints
    try {
      const aqData = await getAirQuality(city.lat, city.lon);
      analysis.airQuality = processAirQuality(aqData);
    } catch (err) {
      console.log(
        `[WARN] Air quality data unavailable for ${city.matchedKey}: ${err.message}`,
      );
    }

    try {
      analysis.liveWeather = await getCurrentWeather(city.lat, city.lon);
    } catch (err) {
      console.log(
        `[WARN] Live weather unavailable for ${city.matchedKey}: ${err.message}`,
      );
    }

    // 6. Compute forecast skill decay
    analysis.forecastSkill = computeForecastSkillDecay(daysUntilResolution);

    // 7. Compute ensemble spread score if ensemble data available
    if (analysis.ensemble?.timeSteps?.length > 0) {
      analysis.spreadScore = computeSpreadScore(analysis.ensemble);
    }

    // 8. Get forecast trajectory (how prediction evolved)
    try {
      if (market.endDate) {
        const targetDate = new Date(market.endDate).toISOString().split("T")[0];
        analysis.trajectory = await getForecastTrajectory(
          city.lat,
          city.lon,
          targetDate,
          5,
        );
      }
    } catch (err) {
      console.log(
        `[WARN] Trajectory unavailable for ${city.matchedKey}: ${err.message}`,
      );
    }

    // 9. Compute composite edge score
    analysis.edge = computeEdgeScore(analysis);

    // 10. Compute trading strategy recommendations
    analysis.strategy = computeTradingStrategy(analysis);

    // 11. Log signal for backtesting
    logSignal(analysis);
  } catch (err) {
    analysis.error = err.message;
  }

  return analysis;
}
