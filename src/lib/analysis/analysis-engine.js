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
  getStationMETAR,
  getSolarRadiation,
  getSoilConditions,
  getHourlyTemperatureCurve,
  getWundergroundHistory,
} from "../services/weather-service.js";
import { resolveCity } from "./city-resolver.js";

// ── Module imports ──
import {
  processEnsembleData,
  computeBracketProbabilities,
  computeDeterministicBracketProbs,
  computePerModelBracketProbs,
  blendBracketProbabilities,
  calculateEnsembleProbability,
  applyMETARConstraint,
  applyBaseRatePrior,
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
import { runAllAdvancedFactors } from "./advanced-factors.js";
import { applyFactorAdjustments } from "./probability-matrix.js";

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
    metarConstraint: null,
    baseRateBlend: null,
    solarRadiation: null,
    soilConditions: null,
    hourlyCurve: null,
    advancedFactors: null,
    factorAdjustment: null,
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
      analysis.stationBias = await getStationBias(city.lat, city.lon, 90, city.icao);
      if (analysis.stationBias?.reliable && analysis.stationBias.bias !== 0) {
        console.log(
          `[BIAS] ${analysis.stationBias.bias > 0 ? "+" : ""}${analysis.stationBias.bias.toFixed(2)}°C correction for ${city.matchedKey} (truth: ${analysis.stationBias.truthSource}, applied in step 2a)`,
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

    // Hoist BMA variables so they're accessible for factor adjustments later (step 5g)
    let bmaPreds = [];
    let bmaBias = 0;
    let bmaEnsWeightTotal = modelConfig.ensembleWeights
      ? Object.values(modelConfig.ensembleWeights).reduce((a, b) => a + b, 0)
      : 4.0;
    let bmaDetWeightTotal = 0;

    if (analysis.ensemble?.bracketProbabilities && analysis.multiModel?.consensus?.predictions) {
      bmaPreds = analysis.multiModel.consensus.predictions.filter(p => p.maxTemp != null);

      if (bmaPreds.length > 0) {
        // Bias correction: use monthly (seasonal) bias if available for resolution month,
        // otherwise fall back to overall bias. biasDiscounted already applies the
        // truth-source discount (WU=100%, ERA5=50%).
        if (analysis.stationBias?.reliable && analysis.stationBias.bias !== 0) {
          // Try month-specific bias first (captures seasonal model behavior)
          const resMonth = market.endDate ? (new Date(market.endDate).getMonth() + 1).toString() : null;
          const monthlyEntry = resMonth && analysis.stationBias.monthly?.[resMonth];
          if (monthlyEntry && monthlyEntry.sampleSize >= 5) {
            bmaBias = monthlyEntry.bias * (analysis.stationBias.discount ?? 0.5);
            console.log(`[BIAS] Using monthly bias for month ${resMonth}: ${bmaBias > 0 ? '+' : ''}${bmaBias.toFixed(2)}°C (n=${monthlyEntry.sampleSize})`);
          } else {
            bmaBias = analysis.stationBias.biasDiscounted ?? (analysis.stationBias.bias * 0.5);
          }
        }

        // Stream 1: Ensemble KDE (re-compute with bias correction)
        const ensBrackets = analysis.ensemble.memberMaxes
          ? computeBracketProbabilities(analysis.ensemble.memberMaxes, market.outcomes, bmaBias, market.unit || 'C')
          : analysis.ensemble.bracketProbabilities;

        // Stream 2: Deterministic per-model Gaussian (weighted by model quality)
        const detBrackets = computeDeterministicBracketProbs(
          bmaPreds, market.outcomes, daysUntilResolution || 1, bmaBias, market.unit || 'C'
        );

        // BMA blend by total model weight per stream
        bmaDetWeightTotal = bmaPreds.reduce((s, p) => s + (p.weight || 1), 0);

        analysis.ensemble.bracketProbabilities = blendBracketProbabilities(
          ensBrackets, detBrackets, bmaEnsWeightTotal, bmaDetWeightTotal
        );

        // Compute per-model individual bracket probabilities for UI breakdown
        analysis.perModelBrackets = computePerModelBracketProbs(
          bmaPreds, market.outcomes, daysUntilResolution || 1, bmaBias, market.unit || 'C'
        );

        // Add ensemble KDE as a pseudo-model entry so UI can show it alongside deterministic models
        if (ensBrackets) {
          analysis.perModelBrackets.unshift({
            model: 'ENS_KDE',
            weight: bmaEnsWeightTotal,
            maxTemp: null,
            isEnsemble: true,
            memberCount: analysis.ensemble.memberMaxes?.length || 0,
            brackets: ensBrackets.map(b => ({ name: b.name, prob: b.forecastProb })),
          });
        }

        analysis.ensemble.bmaBlend = {
          ensWeight: bmaEnsWeightTotal,
          detWeight: bmaDetWeightTotal,
          ensFraction: (bmaEnsWeightTotal / (bmaEnsWeightTotal + bmaDetWeightTotal) * 100).toFixed(0) + '%',
          detFraction: (bmaDetWeightTotal / (bmaEnsWeightTotal + bmaDetWeightTotal) * 100).toFixed(0) + '%',
          detModels: bmaPreds.length,
          daysOut: daysUntilResolution || 1,
        };
        console.log(`[BMA] Blend: ensemble ${analysis.ensemble.bmaBlend.ensFraction} (wt ${bmaEnsWeightTotal.toFixed(1)}) + deterministic ${analysis.ensemble.bmaBlend.detFraction} (wt ${bmaDetWeightTotal.toFixed(1)}, ${bmaPreds.length} models) | ${daysUntilResolution || 1}d lead`);
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

    // 3b. Apply historical base rate as Bayesian prior (long-range forecasts only)
    if (analysis.ensemble?.bracketProbabilities && analysis.baseRate?.values) {
      const brResult = applyBaseRatePrior(
        analysis.ensemble.bracketProbabilities,
        analysis.baseRate,
        market.outcomes,
        daysUntilResolution || 1,
        market.unit || 'C'
      );
      if (brResult.applied) {
        analysis.ensemble.bracketProbabilities = brResult.adjusted;
        analysis.baseRateBlend = { applied: true, climWeight: brResult.climWeight };
        console.log(`[BASE_RATE] Blended ${(brResult.climWeight * 100).toFixed(0)}% climatological prior for ${city.matchedKey} (${daysUntilResolution}d lead)`);
      }
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
      const todayStr = new Date().toISOString().split('T')[0];
      const marketDateStr = market.endDate ? new Date(market.endDate).toISOString().split('T')[0] : null;
      const isToday = marketDateStr === todayStr;
      const isPast = marketDateStr && marketDateStr < todayStr;

      if (isToday) {
        analysis.liveWeather = await getStationMETAR(city.icao);
      } else if (isPast) {
        // Fetch actual historical max for the exact past date
        const offsetDays = Math.ceil((new Date(todayStr).getTime() - new Date(marketDateStr).getTime()) / (1000 * 3600 * 24)) + 5;
        const wuHist = await getWundergroundHistory(city.icao, offsetDays);
        if (wuHist) {
          const targetIdx = wuHist.dates.indexOf(marketDateStr);
          if (targetIdx !== -1) {
            const pastMax = wuHist.maxTemps[targetIdx];
            analysis.liveWeather = {
              currentTemp: pastMax, // Use actual max for both so UI renders it as final
              maxToday: pastMax,
              lastUpdated: marketDateStr + 'T23:59:59Z',
              icao: city.icao,
              stationName: city.matchedKey,
              wundergroundUrl: `https://www.wunderground.com/history/daily/${city.icao}/${marketDateStr}`
            };
            console.log(`[PAPER] Using actual historical max (${pastMax}°C) for ${city.matchedKey} on ${marketDateStr}`);
          }
        }
      } else {
        analysis.liveWeather = null;
      }
    } catch (err) {
      console.log(`[WARN] METAR/History unavailable for ${city.matchedKey} (${city.icao}): ${err.message}`);
    }

    // 5b. (METAR constraint moved to 5h — must apply AFTER factor adjustments)

    // 5c. Fetch solar radiation data
    try {
      analysis.solarRadiation = await getSolarRadiation(city.lat, city.lon, 3);
    } catch (err) {
      console.log(`[WARN] Solar radiation unavailable for ${city.matchedKey}: ${err.message}`);
    }

    // 5d. Fetch soil conditions
    try {
      analysis.soilConditions = await getSoilConditions(city.lat, city.lon, 3);
    } catch (err) {
      console.log(`[WARN] Soil conditions unavailable for ${city.matchedKey}: ${err.message}`);
    }

    // 5e. Fetch hourly temperature curves for diurnal analysis
    try {
      analysis.hourlyCurve = await getHourlyTemperatureCurve(
        city.lat, city.lon, 3,
        modelConfig.deterministicSlugs.slice(0, 3) // Top 3 models for efficiency
      );
    } catch (err) {
      console.log(`[WARN] Hourly curve unavailable for ${city.matchedKey}: ${err.message}`);
    }

    // 5e2. Get forecast trajectory (moved before factors so Factor 12 can use it)
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

    // 5f. Run all 12 advanced analysis factors (including new PhD-level factors)
    try {
      analysis.advancedFactors = runAllAdvancedFactors({
        hourlyCurve: analysis.hourlyCurve,
        soilData: analysis.soilConditions,
        solarData: analysis.solarRadiation,
        atmospheric: analysis.atmospheric,
        city,
        market: { ...market, lat: city.lat, lon: city.lon },
        trajectory: analysis.trajectory,
      });
    } catch (err) {
      console.log(`[WARN] Advanced factors failed for ${city.matchedKey}: ${err.message}`);
    }

    // 5g. Apply probability matrix adjustments from advanced factors
    // Pass deterministic predictions, BMA weights, bias, and lead time so the
    // probability matrix can perform a full dual-stream re-KDE + BMA re-blend
    // instead of only shifting ensemble members (which would drop det models).
    if (analysis.advancedFactors && analysis.ensemble?.bracketProbabilities) {
      try {
        let metarFloorC = null;
        if (analysis.liveWeather?.maxToday != null) {
          const todayStr = new Date().toISOString().split('T')[0];
          const marketDateStr = market.endDate ? new Date(market.endDate).toISOString().split('T')[0] : null;
          if (marketDateStr === todayStr || (marketDateStr && marketDateStr < todayStr)) {
            metarFloorC = analysis.liveWeather.maxToday;
          }
        }

        const matrixResult = applyFactorAdjustments(
          analysis.ensemble.bracketProbabilities,
          analysis.advancedFactors,
          analysis.ensemble.memberMaxes,
          market.outcomes,
          market.unit || 'C',
          // pass BMA parameters for dual-stream re-blend
          bmaPreds.length > 0 ? bmaPreds : null,
          bmaEnsWeightTotal,
          bmaDetWeightTotal,
          daysUntilResolution || 1,
          bmaBias,
          metarFloorC
        );
        if (matrixResult.applied) {
          analysis.ensemble.preFactorBracketProbabilities = analysis.ensemble.bracketProbabilities;
          analysis.ensemble.bracketProbabilities = matrixResult.adjusted;
          analysis.factorAdjustment = matrixResult.breakdown;
          // Store ENS-shifted brackets separately for the ENS+PhD UI column
          if (matrixResult.ensShiftedBrackets) {
            analysis.ensemble.ensShiftedBrackets = matrixResult.ensShiftedBrackets;
          }
          console.log(`[FACTORS] Applied probability shift: ${matrixResult.breakdown.shiftDirection} ${matrixResult.breakdown.effectiveShift.toFixed(2)}°C (blend=${matrixResult.breakdown.blendAlpha}) for ${city.matchedKey}`);
        }
      } catch (err) {
        console.log(`[WARN] Factor adjustment failed for ${city.matchedKey}: ${err.message}`);
      }
    }

    // 5h. Apply METAR constraint — AFTER factor adjustments!
    // The re-KDE in 5g shifts all members and re-integrates from scratch,
    // so any prior METAR elimination would be undone. We apply it last
    // to ensure brackets below the observed station max are permanently zeroed.
    if (analysis.liveWeather?.maxToday != null && analysis.ensemble?.bracketProbabilities) {
      const todayStr = new Date().toISOString().split('T')[0];
      const marketDateStr = market.endDate ? new Date(market.endDate).toISOString().split('T')[0] : null;
      const isToday = marketDateStr === todayStr;
      const isPast = marketDateStr && marketDateStr < todayStr;

      if (isToday || isPast) {
        // Save pre-METAR unmodified distributions for the client UI overriding
        analysis.ensemble.preMetarBracketProbabilities = [...analysis.ensemble.bracketProbabilities];
        if (analysis.ensemble.ensShiftedBrackets) {
          analysis.ensemble.preMetarEnsShiftedBrackets = [...analysis.ensemble.ensShiftedBrackets];
        }

        // Apply METAR to the primary BMA+PhD blend
        const metarResult = applyMETARConstraint(
          analysis.ensemble.bracketProbabilities,
          analysis.liveWeather.maxToday,
          market.unit || 'C',
          true
        );
        
        // Also apply METAR to the raw ENS+PhD stream for UI consistency
        if (analysis.ensemble.ensShiftedBrackets) {
          const ensMetarResult = applyMETARConstraint(
            analysis.ensemble.ensShiftedBrackets,
            analysis.liveWeather.maxToday,
            market.unit || 'C',
            true
          );
          if (ensMetarResult.applied) {
            analysis.ensemble.ensShiftedBrackets = ensMetarResult.adjusted;
          }
        }
        
        if (metarResult.applied) {
          analysis.ensemble.bracketProbabilities = metarResult.adjusted;
          analysis.metarConstraint = {
            applied: true,
            observedMaxC: metarResult.observedMaxC,
            eliminatedBrackets: metarResult.adjusted.filter(b => b.metarEliminated).map(b => b.name),
          };
          console.log(`[METAR] Eliminated ${analysis.metarConstraint.eliminatedBrackets.length} brackets below observed max ${metarResult.observedMaxC}°C for ${city.matchedKey}`);
        }
      }
    }

    // 6. Compute forecast skill decay
    analysis.forecastSkill = computeForecastSkillDecay(daysUntilResolution);

    // 7. Compute ensemble spread score if ensemble data available
    if (analysis.ensemble?.timeSteps?.length > 0) {
      analysis.spreadScore = computeSpreadScore(analysis.ensemble);
    }

    // 8. Forecast trajectory — already fetched in step 5e2 (needed by Factor 12)

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
