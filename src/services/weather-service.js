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

  const res = await fetch(`${BASE_FORECAST}?${params}`);
  if (!res.ok) throw new Error(`Forecast API error: ${res.status} ${await res.text()}`);
  return res.json();
}

/**
 * Get multi-model deterministic forecasts side-by-side.
 * Accepts an optional explicit model list for city-aware selection.
 * Uses Promise.allSettled so out-of-coverage models silently drop.
 */
export async function getMultiModelForecast(lat, lon, days = 7, models = null) {
  const modelList = models || [
    'gfs_seamless',
    'ecmwf_ifs025',
    'icon_seamless',
    'jma_seamless',
    'gem_seamless',
    'meteofrance_seamless',
  ];

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

      const res = await fetch(`${BASE_FORECAST}?${params}`);
      if (!res.ok) throw new Error(`Forecast API error for ${model}: ${res.status}`);
      return { model, data: await res.json() };
    })
  );

  // Only return successful results — some models may not cover all locations
  return results
    .filter((r) => r.status === 'fulfilled')
    .map((r) => r.value);
}

/**
 * Get ensemble forecast data (GFS 31 members + ECMWF IFS ensemble)
 */
export async function getEnsemble(lat, lon, models = ['gfs025', 'ecmwf_ifs025', 'ecmwf_aifs025']) {
  const params = new URLSearchParams({
    latitude: lat,
    longitude: lon,
    hourly: 'temperature_2m,precipitation',
    temperature_unit: 'celsius',
    wind_speed_unit: 'mph',
    precipitation_unit: 'inch',
    models: models.join(','),
  });

  const res = await fetch(`${BASE_ENSEMBLE}?${params}`);
  if (!res.ok) throw new Error(`Ensemble API error: ${res.status} ${await res.text()}`);
  return res.json();
}

/**
 * Get atmospheric conditions — humidity, dew point, wind, pressure, cloud cover, visibility
 */
export async function getAtmosphericData(lat, lon, days = 3) {
  const params = new URLSearchParams({
    latitude: lat,
    longitude: lon,
    hourly: [
      'temperature_2m',
      'relative_humidity_2m',
      'dew_point_2m',
      'surface_pressure',
      'cloud_cover',
      'visibility',
      'wind_speed_10m',
      'wind_speed_80m',
      'wind_speed_120m',
      'wind_gusts_10m',
      'wind_direction_10m',
      'precipitation_probability',
      'precipitation',
      'weather_code',
    ].join(','),
    daily: [
      'temperature_2m_max',
      'temperature_2m_min',
      'precipitation_sum',
      'precipitation_probability_max',
      'wind_speed_10m_max',
      'wind_gusts_10m_max',
      'sunrise',
      'sunset',
    ].join(','),
    temperature_unit: 'celsius',
    wind_speed_unit: 'mph',
    precipitation_unit: 'inch',
    forecast_days: days,
    timezone: 'auto',
  });

  const res = await fetch(`${BASE_FORECAST}?${params}`);
  if (!res.ok) throw new Error(`Atmospheric API error: ${res.status}`);
  return res.json();
}

/**
 * Get air quality and UV index data
 */
export async function getAirQuality(lat, lon) {
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

  const res = await fetch(`${BASE_AIR_QUALITY}?${params}`);
  if (!res.ok) throw new Error(`Air Quality API error: ${res.status}`);
  return res.json();
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
 * Get forecast trajectory — how the predicted max temp evolved over past days.
 * Uses the regular forecast API with past_days to get prior model run forecasts in one call.
 */
export async function getForecastTrajectory(lat, lon, targetDate, daysBack = 5) {
  const cacheFile = diskCacheKey('trajectory', lat, lon, targetDate, daysBack);
  const cached = readDiskCache(cacheFile);
  if (cached && cached.length > 0) return cached;

  try {
    // Calculate forecast_days needed to reach the target date from today
    const today = new Date();
    const target = new Date(targetDate);
    const daysAhead = Math.max(1, Math.ceil((target - today) / (1000 * 60 * 60 * 24)) + 1);

    const params = new URLSearchParams({
      latitude: lat,
      longitude: lon,
      daily: 'temperature_2m_max',
      temperature_unit: 'celsius',
      past_days: daysBack,
      forecast_days: Math.max(daysAhead, 2),
      models: 'ecmwf_ifs025',
    });

    const res = await throttledFetch(`${BASE_PREV_RUNS}?${params}`);
    if (!res.ok) return [];
    const data = await res.json();

    const dates = data.daily?.time || [];
    const maxTemps = data.daily?.temperature_2m_max || [];

    // Find the target date in the response and extract the forecast values
    // The Previous Runs API returns overlapping forecasts — each day's model run
    // produces its own forecast. We look at how the max temp for targetDate changed.
    const targetIdx = dates.indexOf(targetDate);
    if (targetIdx === -1) return [];

    // With past_days, data at different positions represents different model runs
    // For now, extract the single value at the target date index
    const results = [];
    const maxTemp = maxTemps[targetIdx];
    if (maxTemp != null) {
      results.push({ daysAgo: 0, maxTemp });
    }

    // Also check surrounding days to build trajectory from available data
    for (let offset = 1; offset <= daysBack; offset++) {
      const pastIdx = targetIdx - offset;
      if (pastIdx >= 0 && maxTemps[pastIdx] != null) {
        // This gives us the forecast initialized offset days earlier
        results.push({ daysAgo: offset, maxTemp: maxTemps[pastIdx] });
      }
    }

    if (results.length > 0) {
      writeDiskCache(cacheFile, results);
    }
    return results;
  } catch {
    return [];
  }
}

/**
 * Compute per-city station bias by comparing historical forecasts to ERA5 reanalysis.
 * Returns the mean bias (forecast - observation) in °C over the past 90 days.
 * Positive bias = model runs warm, negative = model runs cold.
 * Cached permanently to disk.
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
 * Get current real-time temperature and today's max.
 */
export async function getCurrentWeather(lat, lon) {
  const params = new URLSearchParams({
    latitude: lat,
    longitude: lon,
    current: 'temperature_2m',
    hourly: 'temperature_2m',
    temperature_unit: 'celsius',
    timezone: 'auto',
    forecast_days: 1,
  });
  
  try {
    const res = await throttledFetch(`${BASE_FORECAST}?${params}`);
    if (!res.ok) return null;
    const data = await res.json();
    
    // The current temperature and the current local timestamp
    const currentTemp = data.current?.temperature_2m;
    const currentTimeStr = data.current?.time;
    
    // We want the highest recorded temperature *so far* today.
    // The `forecast_days: 1` endpoint returns the 24 hourly readings for today.
    // We filter out any hours in the future.
    let maxSoFar = currentTemp;
    
    if (data.hourly && data.hourly.time && data.hourly.temperature_2m) {
      const times = data.hourly.time;
      const temps = data.hourly.temperature_2m;
      let maxHr = -999;
      
      for (let i = 0; i < times.length; i++) {
        // String comparison perfectly maps chronological order for "YYYY-MM-DDTHH:MM"
        if (times[i] <= currentTimeStr) {
          if (temps[i] != null && temps[i] > maxHr) {
            maxHr = temps[i];
          }
        }
      }
      
      if (maxHr !== -999) {
        maxSoFar = Math.max(currentTemp ?? -999, maxHr);
      }
    }

    return {
      currentTemp,
      maxToday: maxSoFar,
      lastUpdated: currentTimeStr,
    };
  } catch (err) {
    console.log(`[WARN] Live weather unavailable for ${lat},${lon}: ${err.message}`);
    return null;
  }
}
