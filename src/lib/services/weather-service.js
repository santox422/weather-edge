/**
 * Weather Service — wraps Open-Meteo APIs for forecast, ensemble, historical,
 * atmospheric conditions, air quality, and solar/UV data.
 * No API key required. Free for non-commercial use.
 *
 * Includes persistent disk cache for historical data (static, never changes)
 * and request throttling to stay within API rate limits.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.resolve(__dirname, '../../.cache');

// Ensure cache directory exists
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

const BASE_FORECAST = 'https://api.open-meteo.com/v1/forecast';
const BASE_ENSEMBLE = 'https://ensemble-api.open-meteo.com/v1/ensemble';
const BASE_HISTORICAL = 'https://archive-api.open-meteo.com/v1/archive';
const BASE_AIR_QUALITY = 'https://air-quality-api.open-meteo.com/v1/air-quality';
const BASE_PREV_RUNS = 'https://previous-runs-api.open-meteo.com/v1/forecast';
const BASE_HIST_FORECAST = 'https://historical-forecast-api.open-meteo.com/v1/forecast';

// ── Disk cache helpers ────────────────────────────────────────
function diskCacheKey(prefix, ...parts) {
  return path.join(CACHE_DIR, `${prefix}_${parts.join('_').replace(/[^a-zA-Z0-9_.-]/g, '_')}.json`);
}

function readDiskCache(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(raw);
    }
  } catch { /* corrupted cache — ignore */ }
  return null;
}

function writeDiskCache(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data), 'utf-8');
  } catch (err) {
    console.log(`[WARN] Failed to write cache: ${err.message}`);
  }
}

// ── Request throttle — 500ms between API calls ───────────────
let lastRequestTime = 0;
async function throttledFetch(url) {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < 500) {
    await new Promise((r) => setTimeout(r, 500 - elapsed));
  }
  lastRequestTime = Date.now();
  return fetch(url);
}

/**
 * Get deterministic forecast from multiple models (GFS + ECMWF)
 */
export async function getForecast(lat, lon, days = 7) {
  const params = new URLSearchParams({
    latitude: lat,
    longitude: lon,
    hourly: [
      'temperature_2m',
      'relative_humidity_2m',
      'precipitation',
      'precipitation_probability',
      'weather_code',
      'wind_speed_10m',
      'wind_gusts_10m',
    ].join(','),
    daily: [
      'temperature_2m_max',
      'temperature_2m_min',
      'precipitation_sum',
      'precipitation_probability_max',
      'wind_speed_10m_max',
      'wind_gusts_10m_max',
    ].join(','),
    temperature_unit: 'celsius',
    wind_speed_unit: 'mph',
    precipitation_unit: 'inch',
    forecast_days: days,
    timezone: 'auto',
    models: 'gfs_seamless,ecmwf_ifs025',
  });

  const res = await throttledFetch(`${BASE_FORECAST}?${params}`);
  if (!res.ok) throw new Error(`Forecast API error: ${res.status} ${await res.text()}`);
  return res.json();
}

/**
 * Get multi-model deterministic forecasts side-by-side.
 * OPTIMIZED: Single batched request using models= param instead of N individual calls.
 * Falls back to per-model calls if batched request fails.
 * Cached to disk with 3-hour TTL.
 */
export async function getMultiModelForecast(lat, lon, days = 7, models = null) {
  const MULTI_TTL = 3 * 60 * 60 * 1000; // 3 hours
  const modelList = models || [
    'gfs_seamless',
    'ecmwf_ifs025',
    'icon_seamless',
    'jma_seamless',
    'gem_seamless',
    'meteofrance_seamless',
  ];

  const cacheFile = diskCacheKey('multimodel_v2', lat, lon, days, modelList.join('-'));
  const cached = readDiskCache(cacheFile);
  if (cached && cached._cachedAt && Date.now() - cached._cachedAt < MULTI_TTL) {
    console.log(`[CACHE] Multi-model hit for ${lat},${lon}`);
    return cached.data;
  }

  // Attempt single batched request — all models in one call
  try {
    const params = new URLSearchParams({
      latitude: lat,
      longitude: lon,
      hourly: 'temperature_2m,precipitation',
      daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum',
      temperature_unit: 'celsius',
      wind_speed_unit: 'mph',
      precipitation_unit: 'inch',
      forecast_days: days,
      timezone: 'auto',
      models: modelList.join(','),
    });

    const res = await throttledFetch(`${BASE_FORECAST}?${params}`);
    if (res.ok) {
      const raw = await res.json();
      // Open-Meteo returns per-model columns like temperature_2m_gfs_seamless, etc.
      // Parse into per-model data objects
      const data = modelList.map(model => {
        const dailyMaxKey = `temperature_2m_max_${model}`;
        const dailyMinKey = `temperature_2m_min_${model}`;
        const dailyPrecipKey = `precipitation_sum_${model}`;
        const hourlyTempKey = `temperature_2m_${model}`;
        const hourlyPrecipKey = `precipitation_${model}`;
        // Check if this model has data in the response
        const hasDaily = raw.daily && raw.daily[dailyMaxKey];
        const hasHourly = raw.hourly && raw.hourly[hourlyTempKey];
        if (!hasDaily && !hasHourly) return null; // Model not available for this location
        return {
          model,
          data: {
            ...raw,
            daily: raw.daily ? {
              time: raw.daily.time,
              temperature_2m_max: raw.daily[dailyMaxKey] || raw.daily.temperature_2m_max,
              temperature_2m_min: raw.daily[dailyMinKey] || raw.daily.temperature_2m_min,
              precipitation_sum: raw.daily[dailyPrecipKey] || raw.daily.precipitation_sum,
            } : undefined,
            hourly: raw.hourly ? {
              time: raw.hourly.time,
              temperature_2m: raw.hourly[hourlyTempKey] || raw.hourly.temperature_2m,
              precipitation: raw.hourly[hourlyPrecipKey] || raw.hourly.precipitation,
            } : undefined,
          },
        };
      }).filter(Boolean);

      if (data.length > 0) {
        writeDiskCache(cacheFile, { _cachedAt: Date.now(), data });
        console.log(`[CACHE] Multi-model saved for ${lat},${lon} (${data.length} models, batched)`);
        return data;
      }
    }
  } catch (err) {
    console.log(`[WARN] Batched multi-model failed, falling back to individual: ${err.message}`);
  }

  // Fallback: individual per-model calls (original approach)
  const results = await Promise.allSettled(
    modelList.map(async (model) => {
      const params = new URLSearchParams({
        latitude: lat,
        longitude: lon,
        hourly: 'temperature_2m,precipitation',
        daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum',
        temperature_unit: 'celsius',
        wind_speed_unit: 'mph',
        precipitation_unit: 'inch',
        forecast_days: days,
        timezone: 'auto',
        models: model,
      });

      const res = await throttledFetch(`${BASE_FORECAST}?${params}`);
      if (!res.ok) throw new Error(`Forecast API error for ${model}: ${res.status}`);
      return { model, data: await res.json() };
    })
  );

  for (const r of results) {
    if (r.status === 'rejected') {
      console.log(`[WARN] Multi-model request failed: ${r.reason?.message || r.reason}`);
    }
  }

  const data = results
    .filter((r) => r.status === 'fulfilled')
    .map((r) => r.value);

  writeDiskCache(cacheFile, { _cachedAt: Date.now(), data });
  console.log(`[CACHE] Multi-model saved for ${lat},${lon} (${data.length} models, individual)`);
  return data;
}

/**
 * Get ensemble forecast data (GFS 31 members + ECMWF IFS ensemble)
 * Cached to disk with 6-hour TTL (ensemble models update ~4x/day).
 */
export async function getEnsemble(lat, lon, models = ['gfs025', 'ecmwf_ifs025', 'ecmwf_aifs025']) {
  const ENSEMBLE_TTL = 6 * 60 * 60 * 1000; // 6 hours
  const cacheFile = diskCacheKey('ensemble', lat, lon, models.join('-'));
  const cached = readDiskCache(cacheFile);
  if (cached && cached._cachedAt && Date.now() - cached._cachedAt < ENSEMBLE_TTL) {
    console.log(`[CACHE] Ensemble data hit for ${lat},${lon} (age: ${((Date.now() - cached._cachedAt) / 3600000).toFixed(1)}h)`);
    return cached.data;
  }

  const params = new URLSearchParams({
    latitude: lat,
    longitude: lon,
    hourly: 'temperature_2m,precipitation',
    temperature_unit: 'celsius',
    wind_speed_unit: 'mph',
    precipitation_unit: 'inch',
    models: models.join(','),
  });

  const res = await throttledFetch(`${BASE_ENSEMBLE}?${params}`);
  if (!res.ok) throw new Error(`Ensemble API error: ${res.status} ${await res.text()}`);
  const data = await res.json();

  // Cache to disk with timestamp
  writeDiskCache(cacheFile, { _cachedAt: Date.now(), data });
  console.log(`[CACHE] Ensemble data saved for ${lat},${lon}`);

  return data;
}

// ── Unified Forecast Cache ─────────────────────────────────────
// Single request combining atmospheric + solar + soil variables.
// All three consumers share this cache.
let _unifiedCache = new Map(); // in-memory for same-request dedup

async function getUnifiedForecast(lat, lon, days = 3) {
  const UNIFIED_TTL = 3 * 60 * 60 * 1000; // 3 hours
  const cacheKey = `${lat}_${lon}_${days}`;

  // In-memory dedup for concurrent calls within same analysis
  if (_unifiedCache.has(cacheKey)) {
    const mem = _unifiedCache.get(cacheKey);
    if (Date.now() - mem._cachedAt < UNIFIED_TTL) return mem.data;
  }

  const cacheFile = diskCacheKey('unified_forecast', lat, lon, days);
  const cached = readDiskCache(cacheFile);
  if (cached && cached._cachedAt && Date.now() - cached._cachedAt < UNIFIED_TTL) {
    console.log(`[CACHE] Unified forecast hit for ${lat},${lon}`);
    _unifiedCache.set(cacheKey, cached);
    return cached.data;
  }

  const params = new URLSearchParams({
    latitude: lat,
    longitude: lon,
    hourly: [
      // Atmospheric
      'temperature_2m', 'relative_humidity_2m', 'dew_point_2m',
      'surface_pressure', 'cloud_cover', 'visibility',
      'wind_speed_10m', 'wind_speed_80m', 'wind_speed_120m',
      'wind_gusts_10m', 'wind_direction_10m',
      'precipitation_probability', 'precipitation', 'weather_code',
      // Solar radiation
      'shortwave_radiation', 'direct_radiation', 'diffuse_radiation',
      'direct_normal_irradiance', 'shortwave_radiation_instant',
      'cloud_cover_low', 'cloud_cover_mid', 'cloud_cover_high',
      // Soil
      'soil_temperature_0cm', 'soil_temperature_6cm', 'soil_temperature_18cm',
      'soil_moisture_0_to_1cm', 'soil_moisture_1_to_3cm',
      'soil_moisture_3_to_9cm', 'soil_moisture_9_to_27cm',
    ].join(','),
    daily: [
      'temperature_2m_max', 'temperature_2m_min',
      'precipitation_sum', 'precipitation_probability_max',
      'wind_speed_10m_max', 'wind_gusts_10m_max',
      'sunrise', 'sunset', 'shortwave_radiation_sum',
    ].join(','),
    temperature_unit: 'celsius',
    wind_speed_unit: 'mph',
    precipitation_unit: 'inch',
    forecast_days: days,
    timezone: 'auto',
  });

  const res = await throttledFetch(`${BASE_FORECAST}?${params}`);
  if (!res.ok) throw new Error(`Unified Forecast API error: ${res.status}`);
  const data = await res.json();

  const entry = { _cachedAt: Date.now(), data };
  writeDiskCache(cacheFile, entry);
  _unifiedCache.set(cacheKey, entry);
  console.log(`[CACHE] Unified forecast saved for ${lat},${lon} (1 call = atm+solar+soil)`);
  return data;
}

/**
 * Get atmospheric conditions — thin wrapper over unified forecast.
 * Cached to disk with 3-hour TTL.
 */
export async function getAtmosphericData(lat, lon, days = 3) {
  return getUnifiedForecast(lat, lon, days);
}

/**
 * Get air quality and UV index data
 * Cached to disk with 3-hour TTL. Uses throttledFetch.
 */
export async function getAirQuality(lat, lon) {
  const AQ_TTL = 3 * 60 * 60 * 1000; // 3 hours
  const cacheFile = diskCacheKey('aq', lat, lon);
  const cached = readDiskCache(cacheFile);
  if (cached && cached._cachedAt && Date.now() - cached._cachedAt < AQ_TTL) {
    console.log(`[CACHE] Air quality hit for ${lat},${lon}`);
    return cached.data;
  }

  const params = new URLSearchParams({
    latitude: lat,
    longitude: lon,
    hourly: [
      'pm2_5',
      'pm10',
      'ozone',
      'nitrogen_dioxide',
      'sulphur_dioxide',
      'carbon_monoxide',
      'uv_index',
      'uv_index_clear_sky',
      'us_aqi',
      'european_aqi',
    ].join(','),
    forecast_days: 3,
    timezone: 'auto',
  });

  const res = await throttledFetch(`${BASE_AIR_QUALITY}?${params}`);
  if (!res.ok) throw new Error(`Air Quality API error: ${res.status}`);
  const data = await res.json();

  writeDiskCache(cacheFile, { _cachedAt: Date.now(), data });
  console.log(`[CACHE] Air quality saved for ${lat},${lon}`);
  return data;
}

/**
 * Get historical weather data for base rate calculations
 * Uses persistent disk cache — historical data never changes.
 */
export async function getHistorical(lat, lon, startDate, endDate) {
  // Check disk cache first (historical data is immutable)
  const cacheFile = diskCacheKey('hist', lat, lon, startDate, endDate);
  const cached = readDiskCache(cacheFile);
  if (cached) {
    console.log(`[CACHE] Historical data hit for ${lat},${lon}`);
    return cached;
  }

  const params = new URLSearchParams({
    latitude: lat,
    longitude: lon,
    daily: [
      'temperature_2m_max',
      'temperature_2m_min',
      'temperature_2m_mean',
      'precipitation_sum',
      'wind_speed_10m_max',
    ].join(','),
    temperature_unit: 'celsius',
    wind_speed_unit: 'mph',
    precipitation_unit: 'inch',
    start_date: startDate,
    end_date: endDate,
    timezone: 'auto',
  });

  const res = await throttledFetch(`${BASE_HISTORICAL}?${params}`);
  if (!res.ok) throw new Error(`Historical API error: ${res.status} ${await res.text()}`);
  const data = await res.json();

  // Cache to disk permanently
  writeDiskCache(cacheFile, data);
  console.log(`[CACHE] Historical data saved for ${lat},${lon}`);

  return data;
}

/**
 * Get historical data for the same calendar date range across multiple years
 * (for base rate calculation: "What % of years did temp exceed X on this date?")
 * Uses persistent disk cache — base rates don't change.
 */
export async function getHistoricalBaseRate(lat, lon, month, day, yearsBack = 30) {
  // Check disk cache for processed base rate
  const brCacheFile = diskCacheKey('baserate', lat, lon, month, day);
  const cachedBR = readDiskCache(brCacheFile);
  if (cachedBR) {
    console.log(`[CACHE] Base rate hit for ${lat},${lon} m${month} d${day}`);
    return cachedBR;
  }

  const currentYear = new Date().getFullYear();
  const startYear = currentYear - yearsBack;

  const startDate = `${startYear}-01-01`;
  const endDate = `${currentYear - 1}-12-31`;

  const data = await getHistorical(lat, lon, startDate, endDate);

  if (!data.daily || !data.daily.time) return { years: [], values: [] };

  const targetDates = [];
  const targetValues = { max: [], min: [], precip: [] };

  data.daily.time.forEach((dateStr, i) => {
    const d = new Date(dateStr);
    const m = d.getMonth() + 1;
    const dd = d.getDate();
    if (m === month && Math.abs(dd - day) <= 2) {
      targetDates.push(dateStr);
      targetValues.max.push(data.daily.temperature_2m_max[i]);
      targetValues.min.push(data.daily.temperature_2m_min[i]);
      targetValues.precip.push(data.daily.precipitation_sum[i]);
    }
  });

  const result = { dates: targetDates, ...targetValues };

  // Cache processed base rate to disk
  writeDiskCache(brCacheFile, result);
  console.log(`[CACHE] Base rate saved for ${lat},${lon} m${month} d${day}`);

  return result;
}

/**
 * Get forecast trajectory — how the predicted max temp evolved over past model runs.
 * Queries the Historical Forecast API for BOTH ECMWF and GFS in parallel for each
 * past model initialization date, enabling detection of forecast flip-flops.
 *
 * Returns { runs: [{ daysAgo, modelRunDate, ecmwf, gfs }], convergence }
 */
export async function getForecastTrajectory(lat, lon, targetDate, daysBack = 5) {
  const TRAJ_TTL = 2 * 60 * 60 * 1000; // 2 hours
  const cacheFile = diskCacheKey('trajectory_v3', lat, lon, targetDate, daysBack);
  const cached = readDiskCache(cacheFile);
  if (cached && cached._cachedAt && Date.now() - cached._cachedAt < TRAJ_TTL && (cached.runs || cached.length > 0)) {
    console.log(`[CACHE] Trajectory hit for ${lat},${lon} → ${targetDate}`);
    return cached;
  }

  const MODELS = ['ecmwf_ifs025', 'gfs_seamless'];

  try {
    const runs = [];
    const target = new Date(targetDate);

    for (let offset = 0; offset <= daysBack; offset++) {
      const runDate = new Date(target);
      runDate.setDate(runDate.getDate() - offset);
      const runDateStr = runDate.toISOString().split('T')[0];

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (runDate > today) continue;

      // Batched: query both models in a single request
      try {
        const params = new URLSearchParams({
          latitude: lat,
          longitude: lon,
          daily: 'temperature_2m_max',
          temperature_unit: 'celsius',
          start_date: runDateStr,
          end_date: targetDate,
          models: MODELS.join(','),
        });

        const res = await throttledFetch(`${BASE_HIST_FORECAST}?${params}`);
        if (!res.ok) continue;
        const data = await res.json();

        const dates = data.daily?.time || [];
        const targetIdx = dates.indexOf(targetDate);
        if (targetIdx === -1) continue;

        // Parse per-model columns from batched response
        const ecmwfKey = 'temperature_2m_max_ecmwf_ifs025';
        const gfsKey = 'temperature_2m_max_gfs_seamless';
        const ecmwfTemp = data.daily?.[ecmwfKey]?.[targetIdx] ?? data.daily?.temperature_2m_max?.[targetIdx] ?? null;
        const gfsTemp = data.daily?.[gfsKey]?.[targetIdx] ?? null;

        if (ecmwfTemp != null || gfsTemp != null) {
          runs.push({
            daysAgo: offset,
            modelRunDate: runDateStr,
            ecmwf: ecmwfTemp,
            gfs: gfsTemp,
            forecastedMaxTemp: ecmwfTemp != null && gfsTemp != null
              ? (ecmwfTemp + gfsTemp) / 2
              : (ecmwfTemp ?? gfsTemp),
          });
        }
      } catch {
        // Skip this offset on error
      }
    }

    // Sort by daysAgo ascending (most recent first)
    runs.sort((a, b) => a.daysAgo - b.daysAgo);

    // Compute convergence metrics
    let convergence = null;
    if (runs.length >= 2) {
      const allTemps = runs.map(r => r.forecastedMaxTemp);
      const recentAvg = allTemps.slice(0, Math.min(2, allTemps.length)).reduce((a, b) => a + b, 0) / Math.min(2, allTemps.length);
      const olderAvg = allTemps.slice(-Math.min(2, allTemps.length)).reduce((a, b) => a + b, 0) / Math.min(2, allTemps.length);
      const trend = recentAvg - olderAvg;

      const latestRun = runs[0];
      const latestDivergence = (latestRun.ecmwf != null && latestRun.gfs != null)
        ? Math.abs(latestRun.ecmwf - latestRun.gfs)
        : null;

      const stdDev = allTemps.length > 1
        ? Math.sqrt(allTemps.reduce((sum, t) => sum + (t - recentAvg) ** 2, 0) / allTemps.length)
        : 0;

      convergence = {
        trend: trend > 0.3 ? 'warming' : trend < -0.3 ? 'cooling' : 'stable',
        trendDelta: +trend.toFixed(1),
        latestDivergence,
        isConverging: stdDev < 1.0,
        stdDev: +stdDev.toFixed(2),
        runsWithBothModels: runs.filter(r => r.ecmwf != null && r.gfs != null).length,
      };
    }

    const result = { runs, convergence, _cachedAt: Date.now() };

    if (runs.length > 0) {
      writeDiskCache(cacheFile, result);
    }
    return result;
  } catch {
    return { runs: [], convergence: null };
  }
}

/**
 * Compute per-city station bias by comparing historical forecasts to ERA5 reanalysis.
 * Returns the mean bias (forecast - observation) in °C over the past 90 days.
 * Positive bias = model runs warm, negative = model runs cold.
 * Cached permanently to disk.
 *
 * NOTE: The "observation" baseline is ERA5 reanalysis, NOT Weather Underground.
 * Polymarket markets resolve against Wunderground station readings, so there may
 * be residual bias from this mismatch (ERA5 grid cell vs point station measurement).
 * A future improvement could scrape Wunderground historical data for each city's
 * specific station (e.g., wunderground.com/history/daily/gb/london/EGLC) and use
 * those as the observation baseline instead.
 */
export async function getStationBias(lat, lon, days = 90) {
  const cacheFile = diskCacheKey('bias', lat, lon, days);
  const cached = readDiskCache(cacheFile);
  if (cached && cached.computedAt && Date.now() - cached.computedAt < 7 * 24 * 60 * 60 * 1000) {
    console.log(`[CACHE] Station bias hit for ${lat},${lon}`);
    return cached;
  }

  const endDate = new Date();
  endDate.setDate(endDate.getDate() - 1);
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - days);

  const startStr = startDate.toISOString().split('T')[0];
  const endStr = endDate.toISOString().split('T')[0];

  try {
    // 1. Get historical forecasts (what models predicted)
    const fcstParams = new URLSearchParams({
      latitude: lat, longitude: lon,
      daily: 'temperature_2m_max',
      temperature_unit: 'celsius',
      start_date: startStr, end_date: endStr,
      models: 'ecmwf_ifs025',
    });
    const fcstRes = await throttledFetch(`${BASE_HIST_FORECAST}?${fcstParams}`);
    if (!fcstRes.ok) throw new Error(`Historical Forecast API: ${fcstRes.status}`);
    const fcstData = await fcstRes.json();

    // 2. Get actual observations (ERA5 reanalysis)
    const obsParams = new URLSearchParams({
      latitude: lat, longitude: lon,
      daily: 'temperature_2m_max',
      temperature_unit: 'celsius',
      start_date: startStr, end_date: endStr,
    });
    const obsRes = await throttledFetch(`${BASE_HISTORICAL}?${obsParams}`);
    if (!obsRes.ok) throw new Error(`Historical API: ${obsRes.status}`);
    const obsData = await obsRes.json();

    // 3. Compute bias
    const fcstMaxes = fcstData.daily?.temperature_2m_max || [];
    const obsMaxes = obsData.daily?.temperature_2m_max || [];
    const fcstDates = fcstData.daily?.time || [];
    const obsDates = obsData.daily?.time || [];

    const biases = [];
    for (let i = 0; i < fcstDates.length; i++) {
      const obsIdx = obsDates.indexOf(fcstDates[i]);
      if (obsIdx !== -1 && fcstMaxes[i] != null && obsMaxes[obsIdx] != null) {
        biases.push(fcstMaxes[i] - obsMaxes[obsIdx]);
      }
    }

    if (biases.length < 10) {
      return { bias: 0, sampleSize: biases.length, reliable: false, computedAt: Date.now() };
    }

    const meanBias = biases.reduce((a, b) => a + b, 0) / biases.length;
    const stdDev = Math.sqrt(biases.reduce((sum, b) => sum + (b - meanBias) ** 2, 0) / biases.length);

    const result = {
      bias: meanBias,
      stdDev,
      sampleSize: biases.length,
      reliable: biases.length >= 30,
      direction: meanBias > 0.2 ? 'warm' : meanBias < -0.2 ? 'cold' : 'neutral',
      computedAt: Date.now(),
    };

    writeDiskCache(cacheFile, result);
    console.log(`[BIAS] ${lat},${lon}: ${meanBias > 0 ? '+' : ''}${meanBias.toFixed(2)}°C (n=${biases.length})`);
    return result;
  } catch (err) {
      console.log(`[WARN] Station bias unavailable for ${lat},${lon}: ${err.message}`);
      return { bias: 0, sampleSize: 0, reliable: false, computedAt: Date.now() };
    }
  }

/**
 * Get real-time METAR observation from the actual ICAO station that
 * Polymarket/Weather Underground uses for market resolution.
 * Uses the free NOAA Aviation Weather API (no API key required).
 *
 * @param {string} icao — ICAO station code (e.g. 'KLGA', 'EGLC')
 * @returns {{ currentTemp, maxToday, lastUpdated, icao, stationName, rawMETAR, wundergroundUrl }}
 */
export async function getStationMETAR(icao) {
  if (!icao) return null;

  // 15-minute cache — METAR updates every ~30 min
  const METAR_TTL = 15 * 60 * 1000;
  const cacheFile = diskCacheKey('metar', icao);
  const cached = readDiskCache(cacheFile);
  if (cached && cached._cachedAt && Date.now() - cached._cachedAt < METAR_TTL) {
    console.log(`[CACHE] METAR hit for ${icao} (age: ${((Date.now() - cached._cachedAt) / 60000).toFixed(0)}min)`);
    return cached.data;
  }

  const BASE_METAR = 'https://aviationweather.gov/api/data/metar';

  try {
    // Fetch recent observations (past 18h) — this gives us both current AND history
    // in a single request, eliminating the need for a separate current-only call
    const url = `${BASE_METAR}?ids=${encodeURIComponent(icao)}&format=json&hours=18`;
    const res = await throttledFetch(url);
    if (!res.ok) {
      console.log(`[METAR] API error for ${icao}: ${res.status}`);
      return null;
    }
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) {
      console.log(`[METAR] No data for ${icao}`);
      return null;
    }

    // Most recent observation is first
    const obs = data[0];
    const currentTemp = obs.temp;

    const wuCountryPath = getWundergroundPath(icao);
    const wundergroundUrl = `https://www.wunderground.com/history/daily/${wuCountryPath}/${icao}`;

    // Find today's max from all observations
    let maxToday = currentTemp;
    const todayStr = new Date().toISOString().split('T')[0];
    for (const m of data) {
      if (m.reportTime && m.reportTime.startsWith(todayStr) && m.temp != null) {
        maxToday = Math.max(maxToday, m.temp);
      }
    }

    console.log(`[METAR] ${icao}: ${currentTemp}°C (max today: ${maxToday}°C) @ ${obs.reportTime}`);

    const result = {
      currentTemp,
      maxToday,
      lastUpdated: obs.reportTime,
      icao: obs.icaoId || icao,
      stationName: obs.name || icao,
      rawMETAR: obs.rawOb || null,
      wundergroundUrl,
    };

    writeDiskCache(cacheFile, { _cachedAt: Date.now(), data: result });
    return result;
  } catch (err) {
    console.log(`[WARN] METAR unavailable for ${icao}: ${err.message}`);
    return null;
  }
}

/**
 * Get solar radiation data — thin wrapper over unified forecast.
 * All solar variables are included in the unified request.
 */
export async function getSolarRadiation(lat, lon, days = 3) {
  return getUnifiedForecast(lat, lon, days);
}

/**
 * Get soil conditions — thin wrapper over unified forecast.
 * All soil variables are included in the unified request.
 */
export async function getSoilConditions(lat, lon, days = 3) {
  return getUnifiedForecast(lat, lon, days);
}

/**
 * Get hourly temperature curves from multiple models for diurnal pattern analysis.
 * OPTIMIZED: Single batched request using models= param.
 * Falls back to individual calls if batched request fails.
 * Cached to disk with 3-hour TTL.
 */
export async function getHourlyTemperatureCurve(lat, lon, days = 3, models = null) {
  const CURVE_TTL = 3 * 60 * 60 * 1000;
  const modelList = models || ['ecmwf_ifs025', 'gfs_seamless', 'icon_seamless'];
  const cacheFile = diskCacheKey('hourly_curve_v2', lat, lon, days, modelList.join('-'));
  const cached = readDiskCache(cacheFile);
  if (cached && cached._cachedAt && Date.now() - cached._cachedAt < CURVE_TTL) {
    console.log(`[CACHE] Hourly curve hit for ${lat},${lon}`);
    return cached.data;
  }

  const HOURLY_VARS = ['temperature_2m', 'precipitation', 'cloud_cover', 'wind_speed_10m', 'wind_direction_10m'];

  // Attempt single batched request
  try {
    const params = new URLSearchParams({
      latitude: lat,
      longitude: lon,
      hourly: HOURLY_VARS.join(','),
      temperature_unit: 'celsius',
      wind_speed_unit: 'mph',
      forecast_days: days,
      timezone: 'auto',
      models: modelList.join(','),
    });

    const res = await throttledFetch(`${BASE_FORECAST}?${params}`);
    if (res.ok) {
      const raw = await res.json();
      // Parse per-model columns from batched response
      const data = modelList.map(model => {
        const hourly = { time: raw.hourly?.time };
        let hasData = false;
        for (const v of HOURLY_VARS) {
          const modelKey = `${v}_${model}`;
          if (raw.hourly?.[modelKey]) {
            hourly[v] = raw.hourly[modelKey];
            hasData = true;
          } else if (raw.hourly?.[v]) {
            hourly[v] = raw.hourly[v]; // Single-model fallback
          }
        }
        if (!hasData && modelList.length > 1) return null;
        return { model, data: { ...raw, hourly } };
      }).filter(Boolean);

      if (data.length > 0) {
        writeDiskCache(cacheFile, { _cachedAt: Date.now(), data });
        console.log(`[CACHE] Hourly curve saved for ${lat},${lon} (${data.length} models, batched)`);
        return data;
      }
    }
  } catch (err) {
    console.log(`[WARN] Batched hourly curve failed, falling back: ${err.message}`);
  }

  // Fallback: individual per-model calls
  const results = await Promise.allSettled(
    modelList.map(async (model) => {
      const params = new URLSearchParams({
        latitude: lat,
        longitude: lon,
        hourly: HOURLY_VARS.join(','),
        temperature_unit: 'celsius',
        wind_speed_unit: 'mph',
        forecast_days: days,
        timezone: 'auto',
        models: model,
      });

      const res = await throttledFetch(`${BASE_FORECAST}?${params}`);
      if (!res.ok) throw new Error(`Hourly curve API error for ${model}: ${res.status}`);
      return { model, data: await res.json() };
    })
  );

  const data = results
    .filter((r) => r.status === 'fulfilled')
    .map((r) => r.value);

  writeDiskCache(cacheFile, { _cachedAt: Date.now(), data });
  console.log(`[CACHE] Hourly curve saved for ${lat},${lon} (${data.length} models, individual)`);
  return data;
}

/**
 * Map ICAO code to the exact Wunderground URL path.
 * Uses explicit per-station paths verified against actual WU pages
 * used for Polymarket market resolution.
 */
function getWundergroundPath(icao) {
  if (!icao) return '';

  // Explicit map — verified correct WU paths for all tracked stations
  const exactMap = {
    'LTAC': 'tr/%C3%A7ubuk',       // Ankara — Esenboğa Airport
    'KATL': 'us/ga/atlanta',        // Atlanta — Hartsfield-Jackson
    'SAEZ': 'ar/ezeiza',            // Buenos Aires — Ezeiza Airport
    'KORD': 'us/il/chicago',        // Chicago — O'Hare
    'KDAL': 'us/tx/dallas',         // Dallas — Love Field
    'EGLC': 'gb/london',            // London — City Airport
    'KMIA': 'us/fl/miami',          // Miami — MIA Airport
    'LIMC': 'it/milan',             // Milan — Malpensa Airport
    'EDDM': 'de/munich',            // Munich — MUC Airport
    'KLGA': 'us/ny/new-york-city',  // NYC — LaGuardia Airport
    'LFPG': 'fr/paris',             // Paris — CDG Airport
    'SBGR': 'br/guarulhos',         // São Paulo — Guarulhos Airport
    'KSEA': 'us/wa/seatac',         // Seattle — SEA Airport
    'RKSI': 'kr/incheon',           // Seoul — Incheon Intl Airport
    'CYYZ': 'ca/mississauga',       // Toronto — Pearson Airport
    'NZWN': 'nz/wellington',        // Wellington — Wellington Airport
  };

  if (exactMap[icao]) return exactMap[icao];

  // Fallback for non-tracked stations: prefix-based mapping
  const prefix = icao.substring(0, 1);
  if (prefix === 'K') return 'us';
  if (prefix === 'C') return 'ca';

  const prefix2 = icao.substring(0, 2);
  const prefixMap = {
    'EG': 'gb', 'LF': 'fr', 'RJ': 'jp', 'YS': 'au',
    'LT': 'tr', 'SA': 'ar', 'VH': 'hk', 'LI': 'it',
    'ED': 'de', 'SB': 'br', 'RK': 'kr', 'NZ': 'nz',
  };
  return prefixMap[prefix2] || '';
}

// Keep backward-compatible export name
export { getStationMETAR as getCurrentWeather };
