/**
 * Weather Data Processors — extract and process atmospheric, air quality,
 * multi-model, and historical base rate data.
 */

/**
 * Process atmospheric data — extract key conditions for the target day
 */
export function processAtmosphericData(atmData, market) {
  if (!atmData?.hourly) return null;

  const hourly = atmData.hourly;
  const times = hourly.time || [];

  // Find the target date
  const targetDate = market.endDate
    ? new Date(market.endDate).toISOString().split('T')[0]
    : new Date().toISOString().split('T')[0];

  // Get indices for target date (midday hours for representative values)
  const targetIndices = [];
  times.forEach((t, i) => {
    if (t.startsWith(targetDate)) {
      const hour = parseInt(t.split('T')[1].split(':')[0]);
      if (hour >= 10 && hour <= 18) targetIndices.push(i);
    }
  });

  // Fallback to first available day if target not found
  if (targetIndices.length === 0) {
    const firstDay = times[0]?.split('T')[0];
    times.forEach((t, i) => {
      if (t.startsWith(firstDay)) {
        const hour = parseInt(t.split('T')[1].split(':')[0]);
        if (hour >= 10 && hour <= 18) targetIndices.push(i);
      }
    });
  }

  if (targetIndices.length === 0) return null;

  const avg = (key) => {
    const vals = targetIndices.map((i) => hourly[key]?.[i]).filter((v) => v != null);
    return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  };

  const max = (key) => {
    const vals = targetIndices.map((i) => hourly[key]?.[i]).filter((v) => v != null);
    return vals.length > 0 ? Math.max(...vals) : null;
  };

  return {
    humidity: avg('relative_humidity_2m'),
    dewPoint: avg('dew_point_2m'),
    windSpeed: avg('wind_speed_10m'),
    windSpeed80m: avg('wind_speed_80m'),
    windSpeed120m: avg('wind_speed_120m'),
    windGusts: max('wind_gusts_10m'),
    windDirection: avg('wind_direction_10m'),
    pressure: avg('surface_pressure'),
    cloudCover: avg('cloud_cover'),
    visibility: avg('visibility'),
    precipProbability: max('precipitation_probability'),
    precipitation: avg('precipitation'),
    // Dew point depression — indicator of atmospheric stability
    dewPointDepression: avg('temperature_2m') != null && avg('dew_point_2m') != null
      ? avg('temperature_2m') - avg('dew_point_2m')
      : null,
  };
}

/**
 * Process air quality data — extract current/near-term values
 */
export function processAirQuality(aqData) {
  if (!aqData?.hourly) return null;

  const hourly = aqData.hourly;
  const times = hourly.time || [];

  // Find current hour or nearest
  const now = new Date();
  const nowStr = now.toISOString().split('T')[0] + 'T' + String(now.getHours()).padStart(2, '0') + ':00';

  let idx = times.indexOf(nowStr);
  if (idx === -1) idx = 0;

  return {
    pm25: hourly.pm2_5?.[idx] ?? null,
    pm10: hourly.pm10?.[idx] ?? null,
    ozone: hourly.ozone?.[idx] ?? null,
    no2: hourly.nitrogen_dioxide?.[idx] ?? null,
    so2: hourly.sulphur_dioxide?.[idx] ?? null,
    co: hourly.carbon_monoxide?.[idx] ?? null,
    uvIndex: hourly.uv_index?.[idx] ?? null,
    uvIndexClearSky: hourly.uv_index_clear_sky?.[idx] ?? null,
    usAqi: hourly.us_aqi?.[idx] ?? null,
    europeanAqi: hourly.european_aqi?.[idx] ?? null,
  };
}

/**
 * Process multi-model forecast data for consensus analysis.
 * Supports weighted consensus — high-res local models count more.
 */
export function processMultiModelData(modelResults, market, modelWeights = null) {
  if (!modelResults || modelResults.length === 0) return null;

  const modelForecasts = modelResults.map(({ model, data }) => {
    const daily = data.daily || {};
    return {
      model,
      dates: daily.time || [],
      maxTemps: daily.temperature_2m_max || [],
      minTemps: daily.temperature_2m_min || [],
      precip: daily.precipitation_sum || [],
      weight: modelWeights?.[model] ?? 1.0,
    };
  });

  let consensus = null;
  if (market.threshold && market.marketType === 'temperature') {
    const targetDate = market.endDate
      ? new Date(market.endDate).toISOString().split('T')[0]
      : null;

    const modelPredictions = modelForecasts.map((mf) => {
      let idx = targetDate ? mf.dates.indexOf(targetDate) : -1;
      if (idx === -1) idx = mf.dates.length - 1;
      return {
        model: mf.model,
        maxTemp: mf.maxTemps[idx],
        exceedsThreshold: mf.maxTemps[idx] >= market.threshold,
        weight: mf.weight,
      };
    });

    // Weighted agreement: high-res models count proportionally more
    const totalWeight = modelPredictions.reduce((s, p) => s + p.weight, 0);
    const agreeWeight = modelPredictions
      .filter((p) => p.exceedsThreshold)
      .reduce((s, p) => s + p.weight, 0);

    consensus = {
      agreementRatio: totalWeight > 0 ? agreeWeight / totalWeight : 0,
      predictions: modelPredictions,
      allAgree: agreeWeight === totalWeight || agreeWeight === 0,
      modelCount: modelPredictions.length,
      isWeighted: modelWeights != null,
    };
  }

  return { models: modelForecasts, consensus };
}

/**
 * Compute historical base rate for a threshold
 */
export function computeBaseRate(baseRateData, market) {
  if (!baseRateData || !baseRateData.max || baseRateData.max.length === 0) {
    return { rate: null, sampleSize: 0 };
  }

  let rate = null;
  const values = baseRateData.max.filter((v) => v != null);

  if (market.threshold && market.marketType === 'temperature') {
    const exceedCount = values.filter((v) => v >= market.threshold).length;
    rate = values.length > 0 ? exceedCount / values.length : null;
  } else if (market.threshold && market.marketType === 'precipitation') {
    const precipValues = baseRateData.precip.filter((v) => v != null);
    const exceedCount = precipValues.filter((v) => v >= market.threshold).length;
    rate = precipValues.length > 0 ? exceedCount / precipValues.length : null;
  }

  return {
    rate,
    sampleSize: values.length,
    years: Math.floor(values.length / 5),
    values,
  };
}
