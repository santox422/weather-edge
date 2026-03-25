/**
 * Advanced Weather Factors — PhD-level analysis indicators for temperature
 * probability adjustment. Incorporates Honda Civic's domain expertise and
 * boundary-layer meteorology.
 *
 * Each factor returns: { factor, adjustment, confidence, reasoning, data }
 *   - adjustment: temperature shift in °C (positive = warmer, negative = cooler)
 *   - confidence: 0-1 reliability of the adjustment
 *   - reasoning: human-readable explanation
 */

// ── Factor 1: Midnight Heat Carryover ──────────────────────────
// Honda Civic: "Markets can be decided around midnight if heat from the
// previous day is still lingering. Mostly in autumn, winter or early spring."
//
// Physical mechanism: When overnight cooling is suppressed (clouds, warm soil,
// advection), the daily max may occur at 00:00–02:00 from the previous day's
// residual warmth, not in the afternoon.
export function analyzeMidnightCarryover(hourlyCurve, soilData, market) {
  if (!hourlyCurve || hourlyCurve.length === 0) {
    return { factor: 'midnight_carryover', adjustment: 0, confidence: 0, reasoning: 'No hourly data available', data: null };
  }

  const targetDate = market.endDate
    ? new Date(market.endDate).toISOString().split('T')[0]
    : new Date().toISOString().split('T')[0];

  // Get the previous day's date
  const prevDate = new Date(targetDate);
  prevDate.setDate(prevDate.getDate() - 1);
  const prevDateStr = prevDate.toISOString().split('T')[0];

  // Determine season (for northern hemisphere; invert for southern)
  const month = new Date(targetDate).getMonth() + 1; // 1-12
  const lat = market.lat || 0;
  const isNorthern = lat >= 0;
  const effectiveMonth = isNorthern ? month : ((month + 5) % 12) + 1;
  // Midnight carryover most common in autumn (Sep-Nov), winter (Dec-Feb), early spring (Mar-Apr)
  const isRiskyseason = effectiveMonth >= 9 || effectiveMonth <= 4;
  const seasonMultiplier = isRiskyseason ? 1.0 : 0.3;

  // Aggregate hourly data across all available models
  let eveningTemps = [];   // 18:00-23:59 previous day
  let nightTemps = [];     // 00:00-05:59 target day
  let afternoonTemps = []; // 12:00-17:59 target day
  let overnightCloudCover = []; // 00:00-05:59 target day
  let overnightWindSpeed = [];  // 00:00-05:59 target day

  for (const modelResult of hourlyCurve) {
    const hourly = modelResult.data?.hourly;
    if (!hourly?.time) continue;

    hourly.time.forEach((time, i) => {
      const day = time.split('T')[0];
      const hour = parseInt(time.split('T')[1]?.split(':')[0] || '0');

      if (day === prevDateStr && hour >= 18) {
        if (hourly.temperature_2m?.[i] != null) eveningTemps.push(hourly.temperature_2m[i]);
      }
      if (day === targetDate && hour < 6) {
        if (hourly.temperature_2m?.[i] != null) nightTemps.push(hourly.temperature_2m[i]);
        if (hourly.cloud_cover?.[i] != null) overnightCloudCover.push(hourly.cloud_cover[i]);
        if (hourly.wind_speed_10m?.[i] != null) overnightWindSpeed.push(hourly.wind_speed_10m[i]);
      }
      if (day === targetDate && hour >= 12 && hour < 18) {
        if (hourly.temperature_2m?.[i] != null) afternoonTemps.push(hourly.temperature_2m[i]);
      }
    });
  }

  if (eveningTemps.length === 0 || nightTemps.length === 0 || afternoonTemps.length === 0) {
    return { factor: 'midnight_carryover', adjustment: 0, confidence: 0, reasoning: 'Insufficient hourly data for carryover analysis', data: null };
  }

  const avgEvening = eveningTemps.reduce((a, b) => a + b, 0) / eveningTemps.length;
  const maxNight = Math.max(...nightTemps);
  const avgAfternoon = afternoonTemps.reduce((a, b) => a + b, 0) / afternoonTemps.length;
  const avgCloudOvernight = overnightCloudCover.length > 0
    ? overnightCloudCover.reduce((a, b) => a + b, 0) / overnightCloudCover.length : 50;
  const avgWindOvernight = overnightWindSpeed.length > 0
    ? overnightWindSpeed.reduce((a, b) => a + b, 0) / overnightWindSpeed.length : 5;

  // Soil thermal inertia — warm soil suppresses overnight cooling
  let soilWarmth = 0;
  if (soilData?.hourly?.soil_temperature_0cm) {
    const soilTemps = soilData.hourly.time?.map((t, i) => {
      if (t.split('T')[0] === targetDate && parseInt(t.split('T')[1]?.split(':')[0] || '0') < 6) {
        return soilData.hourly.soil_temperature_0cm[i];
      }
      return null;
    }).filter(v => v != null) || [];

    if (soilTemps.length > 0) {
      const avgSoilTemp = soilTemps.reduce((a, b) => a + b, 0) / soilTemps.length;
      // If soil is warmer than air, it radiates heat upward preventing cooling
      soilWarmth = Math.max(0, avgSoilTemp - maxNight);
    }
  }

  // Carryover detection signals
  const eveningWarmThanAfternoon = avgEvening > avgAfternoon + 0.5; // Previous evening warmer than next-day afternoon
  const nightWarmEnough = maxNight > avgAfternoon - 1.5; // Midnight temps stay close to daytime peak
  const cloudsTrapping = avgCloudOvernight > 70; // Thick clouds prevent radiative cooling
  const windMixing = avgWindOvernight > 8; // Wind maintains mixing (prevents strong inversion)
  const soilRetaining = soilWarmth > 1.0; // Warm soil radiating heat

  // Count positive signals
  let signalCount = 0;
  if (eveningWarmThanAfternoon) signalCount++;
  if (nightWarmEnough) signalCount++;
  if (cloudsTrapping) signalCount++;
  if (windMixing) signalCount++;
  if (soilRetaining) signalCount++;

  // Only trigger if at least 2 signals are present
  if (signalCount < 2) {
    return {
      factor: 'midnight_carryover',
      adjustment: 0,
      confidence: 0.2,
      reasoning: `Midnight carryover unlikely (${signalCount}/5 signals). Evening: ${avgEvening.toFixed(1)}°C, Night max: ${maxNight.toFixed(1)}°C, Afternoon: ${avgAfternoon.toFixed(1)}°C`,
      data: { signalCount, avgEvening, maxNight, avgAfternoon, avgCloudOvernight, soilWarmth, seasonMultiplier },
    };
  }

  // Compute the upward adjustment — the "actual max" may be higher than models predict
  // because models assume afternoon peak, but the true max is at midnight
  const carryoverDelta = maxNight - avgAfternoon;
  const adjustment = Math.max(0, carryoverDelta * 0.6 * seasonMultiplier); // Discounted 40%
  const confidence = Math.min(0.9, (signalCount / 5) * seasonMultiplier);

  const reasons = [];
  if (eveningWarmThanAfternoon) reasons.push(`prev evening ${avgEvening.toFixed(1)}°C > next-day afternoon ${avgAfternoon.toFixed(1)}°C`);
  if (nightWarmEnough) reasons.push(`midnight max ${maxNight.toFixed(1)}°C near afternoon level`);
  if (cloudsTrapping) reasons.push(`overnight cloud cover ${avgCloudOvernight.toFixed(0)}% traps heat`);
  if (windMixing) reasons.push(`overnight wind ${avgWindOvernight.toFixed(0)} mph maintains mixing`);
  if (soilRetaining) reasons.push(`soil +${soilWarmth.toFixed(1)}°C warmer than air → upward heat flux`);

  return {
    factor: 'midnight_carryover',
    adjustment: +adjustment.toFixed(2),
    confidence: +confidence.toFixed(2),
    reasoning: `🌙 Midnight carryover detected (${signalCount}/5 signals, season×${seasonMultiplier}): ${reasons.join('; ')}. Daily max may have occurred at midnight (+${adjustment.toFixed(1)}°C shift).`,
    data: { signalCount, avgEvening, maxNight, avgAfternoon, avgCloudOvernight, avgWindOvernight, soilWarmth, seasonMultiplier, carryoverDelta },
  };
}

// ── Factor 2: Solar Radiation Budget ───────────────────────────
// The ratio of forecast radiation to clear-sky potential determines
// the "radiative ceiling" — how much the surface can actually heat.
export function analyzeSolarBudget(solarData, market) {
  if (!solarData?.hourly || !solarData?.daily) {
    return { factor: 'solar_budget', adjustment: 0, confidence: 0, reasoning: 'No solar data available', data: null };
  }

  const targetDate = market.endDate
    ? new Date(market.endDate).toISOString().split('T')[0]
    : new Date().toISOString().split('T')[0];

  const hourly = solarData.hourly;
  const times = hourly.time || [];

  // Collect radiation and cloud data for peak hours (10:00-16:00)
  let totalShortwave = 0;
  let totalClearSky = 0;
  let cloudCoverPeak = [];
  let cloudLow = [];
  let cloudMid = [];
  let cloudHigh = [];
  let peakHourCount = 0;

  times.forEach((time, i) => {
    const day = time.split('T')[0];
    const hour = parseInt(time.split('T')[1]?.split(':')[0] || '0');

    if (day === targetDate && hour >= 10 && hour <= 16) {
      if (hourly.shortwave_radiation?.[i] != null) {
        totalShortwave += hourly.shortwave_radiation[i];
        peakHourCount++;
      }
      // Use direct_normal_irradiance as clear-sky proxy (scaled)
      // Clear sky shortwave for mid-latitudes: ~600-900 W/m² during peak
      if (hourly.shortwave_radiation_instant?.[i] != null) {
        totalClearSky += hourly.shortwave_radiation_instant[i];
      }
      if (hourly.cloud_cover?.[i] != null) cloudCoverPeak.push(hourly.cloud_cover[i]);
      if (hourly.cloud_cover_low?.[i] != null) cloudLow.push(hourly.cloud_cover_low[i]);
      if (hourly.cloud_cover_mid?.[i] != null) cloudMid.push(hourly.cloud_cover_mid[i]);
      if (hourly.cloud_cover_high?.[i] != null) cloudHigh.push(hourly.cloud_cover_high[i]);
    }
  });

  if (peakHourCount < 3) {
    return { factor: 'solar_budget', adjustment: 0, confidence: 0, reasoning: 'Insufficient solar radiation data for target day', data: null };
  }

  const avgShortwave = totalShortwave / peakHourCount;
  const avgCloudCover = cloudCoverPeak.reduce((a, b) => a + b, 0) / cloudCoverPeak.length;
  const avgCloudLow = cloudLow.length > 0 ? cloudLow.reduce((a, b) => a + b, 0) / cloudLow.length : 0;

  // Determine radiation fraction relative to clear-sky expectation
  // For mid-latitudes spring equinox: clear sky ~650 W/m² average during 10-16h
  // Summer: ~800, Winter: ~350. Use month to approximate.
  const month = new Date(targetDate).getMonth() + 1;
  const lat = parseFloat(solarData.latitude || 45);
  const absLat = Math.abs(lat);

  // Simplified clear-sky radiation model based on latitude and month
  const solarAngleFactor = Math.cos((absLat - 23.5 * Math.cos((month - 1) * Math.PI / 6)) * Math.PI / 180);
  const clearSkyBaseline = Math.max(200, 1000 * Math.max(0.2, solarAngleFactor));
  const radiationFraction = Math.min(1.0, avgShortwave / clearSkyBaseline);

  // Temperature adjustment: each 10% reduction in radiation → ~0.5°C lower max
  // This is derived from surface energy balance: ΔT ≈ ΔQ_s / (ρ * c_p * h)
  const radiationDeficit = 1.0 - radiationFraction;
  const adjustment = -(radiationDeficit * 5.0); // Max -5°C for complete overcast

  // Low clouds matter more than high clouds for radiation blocking
  const lowCloudWeight = avgCloudLow > 60 ? 0.85 : 1.0;
  const finalAdjustment = adjustment * lowCloudWeight;

  // Confidence based on clear-sky vs reality gap — larger gap = more certain adjustment
  const confidence = Math.min(0.85, radiationDeficit * 1.2);

  return {
    factor: 'solar_budget',
    adjustment: +finalAdjustment.toFixed(2),
    confidence: +confidence.toFixed(2),
    reasoning: avgCloudCover > 60
      ? `☁️ Reduced solar budget: ${avgShortwave.toFixed(0)} W/m² (${(radiationFraction * 100).toFixed(0)}% of clear-sky). Cloud cover ${avgCloudCover.toFixed(0)}% (low: ${avgCloudLow.toFixed(0)}%). Surface heating capped → ${finalAdjustment.toFixed(1)}°C adjustment.`
      : `☀️ Solar budget adequate: ${avgShortwave.toFixed(0)} W/m² (${(radiationFraction * 100).toFixed(0)}% of clear-sky). Cloud cover ${avgCloudCover.toFixed(0)}%. ${Math.abs(finalAdjustment) < 0.3 ? 'No significant radiative constraint.' : `Minor adjustment: ${finalAdjustment.toFixed(1)}°C.`}`,
    data: { avgShortwave, clearSkyBaseline, radiationFraction, avgCloudCover, avgCloudLow, avgCloudMid: cloudMid.length > 0 ? cloudMid.reduce((a, b) => a + b, 0) / cloudMid.length : 0, avgCloudHigh: cloudHigh.length > 0 ? cloudHigh.reduce((a, b) => a + b, 0) / cloudHigh.length : 0 },
  };
}

// ── Factor 3: Thermal Inertia Score ────────────────────────────
// Soil temperature + moisture determine heat storage from previous days
export function analyzeThermalInertia(soilData, market) {
  if (!soilData?.hourly) {
    return { factor: 'thermal_inertia', adjustment: 0, confidence: 0, reasoning: 'No soil data available', data: null };
  }

  const targetDate = market.endDate
    ? new Date(market.endDate).toISOString().split('T')[0]
    : new Date().toISOString().split('T')[0];

  const hourly = soilData.hourly;
  const times = hourly.time || [];

  let soilTemp0 = [];
  let soilTemp6 = [];
  let soilTemp18 = [];
  let soilMoisture = [];
  let airTemp = [];

  times.forEach((time, i) => {
    const day = time.split('T')[0];
    const hour = parseInt(time.split('T')[1]?.split(':')[0] || '0');

    // Use early morning values (03:00-07:00) for thermal inertia assessment
    if (day === targetDate && hour >= 3 && hour <= 7) {
      if (hourly.soil_temperature_0cm?.[i] != null) soilTemp0.push(hourly.soil_temperature_0cm[i]);
      if (hourly.soil_temperature_6cm?.[i] != null) soilTemp6.push(hourly.soil_temperature_6cm[i]);
      if (hourly.soil_temperature_18cm?.[i] != null) soilTemp18.push(hourly.soil_temperature_18cm[i]);
      if (hourly.soil_moisture_0_to_1cm?.[i] != null) soilMoisture.push(hourly.soil_moisture_0_to_1cm[i]);
      if (hourly.temperature_2m?.[i] != null) airTemp.push(hourly.temperature_2m[i]);
    }
  });

  if (soilTemp0.length === 0 || airTemp.length === 0) {
    return { factor: 'thermal_inertia', adjustment: 0, confidence: 0, reasoning: 'Insufficient soil data for target day', data: null };
  }

  const avgSoilTemp0 = soilTemp0.reduce((a, b) => a + b, 0) / soilTemp0.length;
  const avgSoilTemp6 = soilTemp6.length > 0 ? soilTemp6.reduce((a, b) => a + b, 0) / soilTemp6.length : avgSoilTemp0;
  const avgSoilTemp18 = soilTemp18.length > 0 ? soilTemp18.reduce((a, b) => a + b, 0) / soilTemp18.length : avgSoilTemp6;
  const avgAirTemp = airTemp.reduce((a, b) => a + b, 0) / airTemp.length;
  const avgMoisture = soilMoisture.length > 0 ? soilMoisture.reduce((a, b) => a + b, 0) / soilMoisture.length : 0.3;

  // Soil-air temperature gradient: positive = soil warmer = heat radiating upward
  const soilAirGradient = avgSoilTemp0 - avgAirTemp;

  // Vertical soil gradient: if deeper soil is warmer, heat is stored from previous days
  const verticalGradient = avgSoilTemp18 - avgSoilTemp0;

  // Thermal inertia score: combines soil warmth, moisture (high = slower response), depth gradient
  // High inertia → moderate temps (less extreme max and min)
  // Low inertia → extreme temps (higher max in dry clear conditions)
  const thermalInertiaIndex = (avgMoisture * 5) + Math.max(0, soilAirGradient * 0.3); // 0-3 scale

  // Adjustment: warm soil + wet = moderates max (slight negative), warm soil + dry = boosts max (slight positive)
  let adjustment = 0;
  if (soilAirGradient > 2 && avgMoisture < 0.15) {
    adjustment = 0.5; // Warm dry soil → faster heating → higher max
  } else if (soilAirGradient > 1 && avgMoisture > 0.3) {
    adjustment = -0.3; // Warm wet soil → evaporative cooling limits max
  } else if (soilAirGradient < -2) {
    adjustment = -0.3; // Cold soil → slows surface heating
  }

  const confidence = Math.min(0.6, Math.abs(soilAirGradient) * 0.15 + avgMoisture * 0.5);

  return {
    factor: 'thermal_inertia',
    adjustment: +adjustment.toFixed(2),
    confidence: +confidence.toFixed(2),
    reasoning: `🌱 Thermal inertia: soil ${avgSoilTemp0.toFixed(1)}°C (surface), ${avgSoilTemp18.toFixed(1)}°C (18cm), air ${avgAirTemp.toFixed(1)}°C. Gradient: ${soilAirGradient > 0 ? '+' : ''}${soilAirGradient.toFixed(1)}°C. Moisture: ${(avgMoisture * 100).toFixed(0)}%. ${adjustment > 0 ? 'Warm dry soil accelerates heating.' : adjustment < 0 ? 'Wet/cold soil moderates heating.' : 'Neutral thermal state.'}`,
    data: { avgSoilTemp0, avgSoilTemp6, avgSoilTemp18, avgAirTemp, avgMoisture, soilAirGradient, verticalGradient, thermalInertiaIndex },
  };
}

// ── Factor 4: Diurnal Temperature Range Analysis ───────────────
// Analyzes the shape of the hourly temperature curve
export function analyzeDiurnalRange(hourlyCurve, market) {
  if (!hourlyCurve || hourlyCurve.length === 0) {
    return { factor: 'diurnal_range', adjustment: 0, confidence: 0, reasoning: 'No hourly curve data', data: null };
  }

  const targetDate = market.endDate
    ? new Date(market.endDate).toISOString().split('T')[0]
    : new Date().toISOString().split('T')[0];

  // Aggregate hourly temperatures across models for target day
  const hourlyByHour = {}; // hour -> [temps across models]

  for (const modelResult of hourlyCurve) {
    const hourly = modelResult.data?.hourly;
    if (!hourly?.time) continue;

    hourly.time.forEach((time, i) => {
      const day = time.split('T')[0];
      const hour = parseInt(time.split('T')[1]?.split(':')[0] || '0');

      if (day === targetDate && hourly.temperature_2m?.[i] != null) {
        if (!hourlyByHour[hour]) hourlyByHour[hour] = [];
        hourlyByHour[hour].push(hourly.temperature_2m[i]);
      }
    });
  }

  const hours = Object.keys(hourlyByHour).map(Number).sort((a, b) => a - b);
  if (hours.length < 12) {
    return { factor: 'diurnal_range', adjustment: 0, confidence: 0, reasoning: 'Insufficient hourly resolution', data: null };
  }

  // Compute mean temperature per hour (across models)
  const meanByHour = {};
  for (const h of hours) {
    meanByHour[h] = hourlyByHour[h].reduce((a, b) => a + b, 0) / hourlyByHour[h].length;
  }

  // Find when the peak occurs and what the min is
  let peakHour = 14; // default
  let peakTemp = -Infinity;
  let minTemp = Infinity;

  for (const h of hours) {
    if (meanByHour[h] > peakTemp) { peakTemp = meanByHour[h]; peakHour = h; }
    if (meanByHour[h] < minTemp) minTemp = meanByHour[h];
  }

  const dtr = peakTemp - minTemp;

  // Check model agreement at peak hour
  const peakTemps = hourlyByHour[peakHour] || [];
  const peakSpread = peakTemps.length > 1
    ? Math.max(...peakTemps) - Math.min(...peakTemps)
    : 0;

  // Anomalous peak detection
  const peakIsNormal = peakHour >= 12 && peakHour <= 17; // Normal peak: noon to 5pm
  const peakIsMidnight = peakHour < 6 || peakHour >= 22;

  // DHR classification
  let dtrClass;
  if (dtr < 5) dtrClass = 'NARROW';        // Maritime / overcast
  else if (dtr < 10) dtrClass = 'MODERATE'; // Mixed / transitional
  else if (dtr < 15) dtrClass = 'WIDE';     // Continental / clear
  else dtrClass = 'EXTREME';                // Desert / steppe

  // Adjustment: narrow DTR = higher certainty (no adjustment needed)
  // Peak at midnight = likely carryover (handled by factor 1, but flag here)
  let adjustment = 0;
  if (!peakIsNormal && peakIsMidnight) {
    adjustment = 0.5; // Peak at unusual time → model might underpredict daily max
  }
  if (peakSpread > 3) {
    adjustment -= 0.3; // Models disagree significantly → reduce certainty
  }

  const confidence = Math.min(0.7, peakIsNormal ? 0.6 : 0.4);

  // Build hourly curve string for reasoning
  const curveStr = [0, 3, 6, 9, 12, 15, 18, 21]
    .filter(h => meanByHour[h] != null)
    .map(h => `${h}h:${meanByHour[h].toFixed(0)}°`)
    .join(' → ');

  return {
    factor: 'diurnal_range',
    adjustment: +adjustment.toFixed(2),
    confidence: +confidence.toFixed(2),
    reasoning: `📊 DTR: ${dtr.toFixed(1)}°C (${dtrClass}). Peak at ${peakHour}:00 (${peakTemp.toFixed(1)}°C)${peakIsNormal ? '' : ' ⚠️ ABNORMAL PEAK TIME'}. Model spread at peak: ${peakSpread.toFixed(1)}°C. Curve: ${curveStr}`,
    data: { dtr, dtrClass, peakHour, peakTemp, minTemp, peakSpread, peakIsNormal, meanByHour },
  };
}

// ── Factor 5: Precipitation Timing Constraint ──────────────────
// Rain during peak heating hours caps surface temperature
export function analyzePrecipTiming(hourlyCurve, atmospheric, market) {
  if (!hourlyCurve || hourlyCurve.length === 0) {
    return { factor: 'precip_timing', adjustment: 0, confidence: 0, reasoning: 'No hourly data for precip analysis', data: null };
  }

  const targetDate = market.endDate
    ? new Date(market.endDate).toISOString().split('T')[0]
    : new Date().toISOString().split('T')[0];

  let peakHourPrecip = [];        // 10:00-16:00 precipitation values
  let morningPrecip = [];         // 06:00-10:00 precipitation
  let peakHourCloudCover = [];    // 10:00-16:00 cloud cover

  for (const modelResult of hourlyCurve) {
    const hourly = modelResult.data?.hourly;
    if (!hourly?.time) continue;

    hourly.time.forEach((time, i) => {
      const day = time.split('T')[0];
      const hour = parseInt(time.split('T')[1]?.split(':')[0] || '0');

      if (day === targetDate) {
        if (hour >= 10 && hour <= 16) {
          if (hourly.precipitation?.[i] != null) peakHourPrecip.push(hourly.precipitation[i]);
          if (hourly.cloud_cover?.[i] != null) peakHourCloudCover.push(hourly.cloud_cover[i]);
        }
        if (hour >= 6 && hour < 10) {
          if (hourly.precipitation?.[i] != null) morningPrecip.push(hourly.precipitation[i]);
        }
      }
    });
  }

  const totalPeakPrecip = peakHourPrecip.reduce((a, b) => a + b, 0);
  const totalMorningPrecip = morningPrecip.reduce((a, b) => a + b, 0);
  const avgPeakCloud = peakHourCloudCover.length > 0
    ? peakHourCloudCover.reduce((a, b) => a + b, 0) / peakHourCloudCover.length : 50;

  // Also check atmospheric precip probability if available
  const precipProb = atmospheric?.precipProbability || 0;

  // Compute temperature suppression:
  // - Light rain (0.1-2mm in peak hours): -0.5 to -1.0°C
  // - Moderate rain (2-10mm): -1.0 to -2.5°C
  // - Heavy rain (>10mm): -2.5 to -4.0°C
  // - Morning rain wetting the ground: -0.3 to -0.8°C (ground evaporative cooling)
  let adjustment = 0;
  let confidence = 0;

  const avgPeakPrecipPerModel = hourlyCurve.length > 0 ? totalPeakPrecip / hourlyCurve.length : 0;
  const avgMorningPrecipPerModel = hourlyCurve.length > 0 ? totalMorningPrecip / hourlyCurve.length : 0;

  if (avgPeakPrecipPerModel > 10) {
    adjustment = -3.0;
    confidence = 0.8;
  } else if (avgPeakPrecipPerModel > 2) {
    adjustment = -1.5;
    confidence = 0.7;
  } else if (avgPeakPrecipPerModel > 0.1) {
    adjustment = -0.5;
    confidence = 0.5;
  }

  // Morning rain adds ground wetness
  if (avgMorningPrecipPerModel > 1) {
    adjustment -= 0.5;
    confidence = Math.max(confidence, 0.4);
  }

  // High precip probability from atmospheric data amplifies adjustment
  if (precipProb > 70 && adjustment < -0.3) {
    confidence = Math.min(confidence + 0.15, 0.9);
  }

  if (Math.abs(adjustment) < 0.1) {
    return {
      factor: 'precip_timing',
      adjustment: 0,
      confidence: 0.3,
      reasoning: `🌤️ No significant precipitation expected during peak hours. Peak cloud: ${avgPeakCloud.toFixed(0)}%.`,
      data: { avgPeakPrecipPerModel, avgMorningPrecipPerModel, avgPeakCloud, precipProb },
    };
  }

  return {
    factor: 'precip_timing',
    adjustment: +adjustment.toFixed(2),
    confidence: +confidence.toFixed(2),
    reasoning: `🌧️ Precipitation constraint: ${avgPeakPrecipPerModel.toFixed(1)}mm expected during peak heating (10-16h)${avgMorningPrecipPerModel > 0.5 ? `, + ${avgMorningPrecipPerModel.toFixed(1)}mm morning rain wetting ground` : ''}. Temperature capped by ${Math.abs(adjustment).toFixed(1)}°C. Precip probability: ${precipProb}%.`,
    data: { avgPeakPrecipPerModel, avgMorningPrecipPerModel, avgPeakCloud, precipProb },
  };
}

// ── Factor 6: Wind Regime Assessment ───────────────────────────
// Wind effects on surface temperature: mixing, advection, marine influence
export function analyzeWindRegime(atmospheric, hourlyCurve, city, market) {
  if (!atmospheric && (!hourlyCurve || hourlyCurve.length === 0)) {
    return { factor: 'wind_regime', adjustment: 0, confidence: 0, reasoning: 'No wind data', data: null };
  }

  const windSpeed = atmospheric?.windSpeed ?? null;
  const windGusts = atmospheric?.windGusts ?? null;
  const windDir = atmospheric?.windDirection ?? null;
  const wind80m = atmospheric?.windSpeed80m ?? null;

  if (windSpeed == null) {
    return { factor: 'wind_regime', adjustment: 0, confidence: 0, reasoning: 'No wind speed data', data: null };
  }

  // Classify wind regime
  let regime;
  if (windSpeed < 5) regime = 'CALM';          // Decoupled boundary layer → local effects dominate
  else if (windSpeed < 12) regime = 'LIGHT';    // Normal mixing
  else if (windSpeed < 20) regime = 'MODERATE'; // Strong mixing → moderate temperatures
  else regime = 'STRONG';                       // Mechanical mixing dominates

  // Marine/continental advection based on wind direction and city position
  // Auto-detect coastal cities and their onshore wind directions
  let advectionEffect = 0;
  const coastalMap = {
    'london':         { onshoreRange: [30, 150] },     // E-SE winds from North Sea
    'new york':       { onshoreRange: [90, 200] },     // E-S winds from Atlantic
    'new york city':  { onshoreRange: [90, 200] },     // E-S winds from Atlantic
    'nyc':            { onshoreRange: [90, 200] },     // E-S winds from Atlantic
    'seattle':        { onshoreRange: [210, 330] },    // SW-NW winds from Pacific
    'miami':          { onshoreRange: [60, 180] },     // E-S winds from Atlantic
    'seoul':          { onshoreRange: [210, 330] },    // W-NW from Yellow Sea
    'wellington':     { onshoreRange: [160, 280] },    // S-W from Southern Ocean
    'buenos aires':   { onshoreRange: [30, 150] },     // NE-SE from Río de la Plata
    'sao paulo':      { onshoreRange: [90, 200] },     // E-S from Atlantic
    'milan':          { onshoreRange: [150, 210] },    // S from Mediterranean (weak)
    'toronto':        { onshoreRange: [90, 200] },     // E-S from Lake Ontario
    'hong kong':      { onshoreRange: [90, 230] },     // E-SW from South China Sea
    'boston':          { onshoreRange: [30, 150] },     // NE-SE from Atlantic
    'san francisco':  { onshoreRange: [210, 330] },    // SW-NW from Pacific
  };

  const cityKey = (city?.matchedKey || '').toLowerCase();
  const isCoastal = !!coastalMap[cityKey];
  if (isCoastal && windDir != null) {
    const coastal = coastalMap[cityKey];
    const inRange = windDir >= coastal.onshoreRange[0] && windDir <= coastal.onshoreRange[1];
    if (inRange && windSpeed > 8) {
      advectionEffect = -1.0; // Onshore flow → marine air suppresses heating
    } else if (!inRange && windSpeed > 8) {
      advectionEffect = 0.5; // Offshore flow → continental air enhances heating
    }
  }

  // Strong wind mixing effect
  let mixingEffect = 0;
  if (windSpeed > 20) mixingEffect = -0.5; // Strong mixing prevents extreme highs
  else if (windSpeed < 3) mixingEffect = 0.3; // Light wind → stronger surface heating (if clear)

  const adjustment = advectionEffect + mixingEffect;
  const confidence = Math.min(0.5, (Math.abs(adjustment) > 0.3 ? 0.5 : 0.2));

  return {
    factor: 'wind_regime',
    adjustment: +adjustment.toFixed(2),
    confidence: +confidence.toFixed(2),
    reasoning: `💨 Wind regime: ${regime} (${windSpeed.toFixed(0)} mph, gusts ${windGusts?.toFixed(0) || '?'} mph, dir ${windDir?.toFixed(0) || '?'}°). ${advectionEffect < 0 ? 'Onshore flow suppresses heating.' : advectionEffect > 0 ? 'Offshore flow enhances heating.' : 'No significant advection.'} ${mixingEffect !== 0 ? (mixingEffect < 0 ? 'Strong mixing moderates temps.' : 'Calm conditions enhance surface heating.') : ''}`,
    data: { windSpeed, windGusts, windDir, wind80m, regime, advectionEffect, mixingEffect, isCoastal },
  };
}

// ── Factor 7: Synoptic Pattern Classifier ──────────────────────
// Classifies the large-scale weather pattern from atmospheric variables
export function classifySynopticPattern(atmospheric, solarData, market) {
  if (!atmospheric) {
    return { factor: 'synoptic_pattern', adjustment: 0, confidence: 0, reasoning: 'No atmospheric data for classification', data: null };
  }

  const pressure = atmospheric.pressure;
  const humidity = atmospheric.humidity;
  const cloudCover = atmospheric.cloudCover;
  const precipProb = atmospheric.precipProbability || 0;
  const windSpeed = atmospheric.windSpeed;
  const windDir = atmospheric.windDirection;
  const dewPoint = atmospheric.dewPoint;

  let pattern = 'UNKNOWN';
  let tempBehavior = '';
  let adjustment = 0;
  let confidence = 0.3;

  // Classification priority: most specific patterns first
  if (precipProb > 50 && cloudCover > 50) {
    pattern = 'FRONTAL_PASSAGE';
    tempBehavior = 'Temperature depends on front timing. Pre-frontal warmth vs post-frontal cooling.';
    adjustment = -0.5;
    confidence = 0.4;
  } else if (pressure > 1018 && cloudCover < 40 && precipProb < 25) {
    pattern = 'HIGH_PRESSURE_CLEAR';
    tempBehavior = 'Max follows radiation curve — standard model prediction reliable';
    confidence = 0.6;
  } else if (pressure > 1012 && humidity < 45 && cloudCover < 50 && precipProb < 20) {
    pattern = 'CONTINENTAL_WARM';
    tempBehavior = 'Dry continental airmass — enhanced surface heating, large DTR expected.';
    adjustment = 0.5;
    confidence = 0.5;
  } else if (cloudCover > 60 && humidity > 70 && precipProb < 40 && windSpeed < 18) {
    pattern = 'MARITIME_OVERCAST';
    tempBehavior = 'Max capped 2-4°C below clear-sky potential. Models often overpredict.';
    adjustment = -1.0;
    confidence = 0.6;
  } else if (pressure < 1008 && humidity > 70) {
    pattern = 'LOW_PRESSURE_TROUGH';
    tempBehavior = 'Active low pressure — unsettled conditions, suppressed max temperatures.';
    adjustment = -0.8;
    confidence = 0.5;
  } else if (pressure < 1010 && humidity > 80 && windSpeed < 8) {
    pattern = 'STAGNANT';
    tempBehavior = 'Weak gradient. Urban heat island effects dominate. High humidity limits heating.';
    adjustment = -0.3;
    confidence = 0.4;
  } else if (precipProb < 30 && cloudCover > 40 && cloudCover < 75 && pressure < 1018) {
    pattern = 'POST_FRONT_CLEARING';
    tempBehavior = 'Morning cloud → afternoon sun → late, sharp peak. Models may underestimate clearance timing.';
    adjustment = 0.3;
    confidence = 0.3;
  } else if (pressure > 1012 && humidity < 55 && cloudCover < 45) {
    pattern = 'THERMAL_TROUGH';
    tempBehavior = 'Dry, enhanced heating. Large DTR expected. Continental influence.';
    adjustment = 0.5;
    confidence = 0.5;
  } else {
    pattern = 'TRANSITIONAL';
    tempBehavior = 'No clear synoptic signal. Weather in transition between regimes.';
    confidence = 0.2;
  }

  return {
    factor: 'synoptic_pattern',
    pattern,
    adjustment: +adjustment.toFixed(2),
    confidence: +confidence.toFixed(2),
    reasoning: `🌍 Synoptic: ${pattern}. ${tempBehavior} (P: ${pressure?.toFixed(0) || '?'} hPa, RH: ${humidity?.toFixed(0) || '?'}%, cloud: ${cloudCover?.toFixed(0) || '?'}%, precip: ${precipProb?.toFixed(0) || '?'}%)`,
    data: { pattern, pressure, humidity, cloudCover, precipProb, windSpeed, windDir, dewPoint },
  };
}

// ── Run All Factors ────────────────────────────────────────────
/**
 * Run all 7 advanced analysis factors and return results.
 *
 * @param {Object} params
 * @param {Object[]} params.hourlyCurve — multi-model hourly temperature curves
 * @param {Object} params.soilData — soil conditions (temp + moisture)
 * @param {Object} params.solarData — solar radiation data
 * @param {Object} params.atmospheric — processed atmospheric conditions
 * @param {Object} params.city — resolved city info
 * @param {Object} params.market — market metadata
 * @returns {Object} { factors: [...], netAdjustment, netConfidence, dominantFactor }
 */
export function runAllAdvancedFactors({ hourlyCurve, soilData, solarData, atmospheric, city, market }) {
  const factors = [];

  // Run each factor, catching errors so one failure doesn't break all
  const safeRun = (fn, ...args) => {
    try { return fn(...args); }
    catch (err) {
      console.log(`[WARN] Advanced factor failed: ${err.message}`);
      return { factor: fn.name, adjustment: 0, confidence: 0, reasoning: `Error: ${err.message}`, data: null };
    }
  };

  factors.push(safeRun(analyzeMidnightCarryover, hourlyCurve, soilData, market));
  factors.push(safeRun(analyzeSolarBudget, solarData, market));
  factors.push(safeRun(analyzeThermalInertia, soilData, market));
  factors.push(safeRun(analyzeDiurnalRange, hourlyCurve, market));
  factors.push(safeRun(analyzePrecipTiming, hourlyCurve, atmospheric, market));
  factors.push(safeRun(analyzeWindRegime, atmospheric, hourlyCurve, city, market));
  factors.push(safeRun(classifySynopticPattern, atmospheric, solarData, market));

  // Compute net adjustment (confidence-weighted sum)
  const activeFx = factors.filter(f => Math.abs(f.adjustment) > 0.01 && f.confidence > 0.1);
  const totalConfWeight = activeFx.reduce((s, f) => s + f.confidence, 0);
  const netAdjustment = totalConfWeight > 0
    ? activeFx.reduce((s, f) => s + f.adjustment * f.confidence, 0) / totalConfWeight
    : 0;

  // Overall confidence: geometric mean of active factor confidences (penalizes disagreement)
  const netConfidence = activeFx.length > 0
    ? Math.pow(activeFx.reduce((p, f) => p * Math.max(0.01, f.confidence), 1), 1 / activeFx.length)
    : 0;

  // Dominant factor: the one with largest absolute weighted impact
  const dominantFactor = activeFx.length > 0
    ? activeFx.sort((a, b) => Math.abs(b.adjustment * b.confidence) - Math.abs(a.adjustment * a.confidence))[0]?.factor
    : null;

  console.log(`[FACTORS] Net adjustment: ${netAdjustment > 0 ? '+' : ''}${netAdjustment.toFixed(2)}°C (conf: ${(netConfidence * 100).toFixed(0)}%, dominant: ${dominantFactor || 'none'}, ${activeFx.length}/${factors.length} active)`);

  return {
    factors,
    netAdjustment: +netAdjustment.toFixed(2),
    netConfidence: +netConfidence.toFixed(2),
    dominantFactor,
    activeFactorCount: activeFx.length,
  };
}
