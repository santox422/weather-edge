/**
 * Analysis Constants — single source of truth for factor metadata,
 * model colors, and shared calculation utilities.
 *
 * Consolidates constants previously duplicated across:
 *   - BracketAnalysisPanel.tsx (FACTOR_ICONS, FACTOR_SHORT, FACTOR_TIPS)
 *   - AdvancedFactorsPanel.tsx (FACTOR_ICONS, FACTOR_LABELS, FACTOR_DESCRIPTIONS)
 */

import type { AdvancedFactor } from '@/types';

// ═══════════════════════════════════════════════════════════════
//  FACTOR METADATA
// ═══════════════════════════════════════════════════════════════

/** Emoji icons for each advanced analysis factor */
export const FACTOR_ICONS: Record<string, string> = {
  midnight_carryover: '🌙',
  solar_budget: '☁️',
  thermal_inertia: '🌱',
  diurnal_range: '📊',
  precip_timing: '🌧️',
  wind_regime: '💨',
  synoptic_pattern: '🌍',
  dew_point_ceiling: '💧',
  urban_heat_island: '🏙️',
  temp_advection_proxy: '🌀',
  trajectory_momentum: '📈',
};

/** Short abbreviated names for compact table columns */
export const FACTOR_SHORT: Record<string, string> = {
  midnight_carryover: 'Midnight',
  solar_budget: 'Solar',
  thermal_inertia: 'Thermal',
  diurnal_range: 'DTR',
  precip_timing: 'Precip',
  wind_regime: 'Wind',
  synoptic_pattern: 'Synoptic',
  dew_point_ceiling: 'DewPt',
  urban_heat_island: 'UHI',
  temp_advection_proxy: 'Advect',
  trajectory_momentum: 'Traj',
};

/** Full uppercase labels for panel headers */
export const FACTOR_LABELS: Record<string, string> = {
  midnight_carryover: 'MIDNIGHT CARRYOVER',
  solar_budget: 'SOLAR RADIATION BUDGET',
  thermal_inertia: 'THERMAL INERTIA',
  diurnal_range: 'DIURNAL RANGE',
  precip_timing: 'PRECIPITATION TIMING',
  wind_regime: 'WIND REGIME',
  synoptic_pattern: 'SYNOPTIC PATTERN',
  dew_point_ceiling: 'DEW POINT CEILING',
  urban_heat_island: 'URBAN HEAT ISLAND',
  temp_advection_proxy: 'TEMP ADVECTION',
  trajectory_momentum: 'TRAJECTORY MOMENTUM',
};

/** One-line tooltip descriptions for bracket table expanded drawers */
export const FACTOR_TIPS: Record<string, string> = {
  midnight_carryover: 'Pre-dawn minimum carryover — warmer nights reduce the next-day heating deficit.',
  solar_budget: 'Solar radiation budget — cloud cover/transparency reduces incoming energy, cooling max temp.',
  thermal_inertia: 'Soil thermal inertia — wet/cold soil absorbs energy, slowing surface heating.',
  diurnal_range: 'Diurnal temperature range — clear+dry conditions amplify day-night swings.',
  precip_timing: 'Precipitation timing — rain during peak hours caps heating via evaporative cooling.',
  wind_regime: 'Wind regime — strong winds mix the boundary layer, preventing surface overheating.',
  synoptic_pattern: 'Synoptic pattern — large-scale air mass type drives systematic biases.',
  dew_point_ceiling: 'Moisture ceiling — high humidity and low dew point depression divert energy to evaporation.',
  urban_heat_island: 'UHI — cities warmer than NWP grid due to built surfaces. Airport stations partially capture this.',
  temp_advection_proxy: 'Temp advection (Diagnostic) — typical advection effect handled by NWP models.',
  trajectory_momentum: 'Trajectory — recent model run trends (warming or cooling drift).',
};

/** Detailed multi-line descriptions for the Advanced Factors panel tooltips */
export const FACTOR_DESCRIPTIONS: Record<string, string> = {
  midnight_carryover: 'Pre-dawn minimum temperature carryover — warmer night lows reduce the heating deficit needed to reach max temp. Uses midnight-to-6am temperature analysis.',
  solar_budget: 'Solar radiation reaching the surface — cloud cover, aerosols, and atmospheric transparency reduce incoming shortwave energy, lowering peak temperature. Key driver of daytime heating.',
  thermal_inertia: 'Soil and surface thermal inertia — wet or cold soils absorb more incoming energy (higher heat capacity), slowing surface heating and reducing max temperature. Uses soil temperature at surface + 18cm depth.',
  diurnal_range: 'Diurnal temperature range analysis — clear/dry conditions allow large day-night swings. Historical DTR patterns and current conditions predict whether max temp will exceed or fall short of model forecasts.',
  precip_timing: 'Precipitation timing relative to peak heating — rain during afternoon hours (12-17 local) caps surface temperature via evaporative cooling. Morning rain has less impact on max temp.',
  wind_regime: 'Wind speed and mixing effects — strong winds mix the boundary layer, preventing surface overheating. Calm conditions can trap heat near the surface. Also considers warm/cold advection from wind direction.',
  synoptic_pattern: 'Large-scale synoptic weather pattern — identifies the dominant air mass type (high pressure clear, continental warm, frontal passage, etc.) and applies systematic bias corrections for each pattern.',
  dew_point_ceiling: 'Moisture ceiling — combined dew point depression and relative humidity check. When moisture is high, energy is diverted to evaporation instead of heating, capping the maximum temperature (Bowen ratio < 0.5).',
  urban_heat_island: 'Urban Heat Island effect — cities are systematically warmer than NWP model grid cells due to concrete, asphalt, and reduced vegetation. Airport stations partially capture this bias. City-specific base UHI values adjusted for wind/cloud conditions.',
  temp_advection_proxy: 'Temperature advection from wind (Diagnostic) — wind direction and speed determine whether warmer/cooler air is transported. Displayed for context, but adjustment is 0 since NWP models natively resolve thermodynamic advection.',
  trajectory_momentum: 'Forecast model trajectory — tracks whether recent model runs (past 3-5 days) have been trending systematically warmer or cooler, indicating potential drift/bias in the current forecast.',
};

// ═══════════════════════════════════════════════════════════════
//  BRACKET TABLE TOOLTIPS
// ═══════════════════════════════════════════════════════════════

/** Tooltip dictionary for bracket outcomes table column headers */
export const BRACKET_TIPS = {
  BRACKET:    'Temperature bracket — click to expand per-model & factor detail',
  MKT:        'Polymarket YES price in cents. This is the market\'s implied probability.',
  ENS_RAW:    'Raw ensemble KDE — Gaussian Kernel Density Estimation over ensemble member maxima. BEFORE station bias correction and BMA blending.',
  BMA:        'BMA-blended probability — weighted average of ensemble KDE + deterministic models. Uses regional BMA weights. BEFORE PhD factors.',
  ENS_PHD:    'ENS + PhD — Raw ensemble probability AFTER PhD factor adjustments (solar budget, UHI, thermal inertia, etc.) are applied via Re-KDE.',
  BMA_PHD:    'BMA + PhD — BMA-blended probability AFTER PhD factor adjustments and METAR live constraints. This is the system\'s best estimate.',
  EDGE:       'Trading edge = BMA+PhD − MKT. Positive = market underprices (buy YES), negative = overpriced.',
  BAR:        'Visual edge bar — proportional to absolute edge magnitude.',
  MODELS_TOG: 'Show/hide individual model probability columns. Each model computes bracket probability from its max temp forecast via Gaussian CDF (σ=0.7°C for 1-day lead).',
  RESET:      'Reset all custom overrides — restore original model weights and re-enable all models.',
  CUSTOM:     'Custom mode — you\'ve modified weights or disabled models. Probabilities reflect your custom scenario.',
  WEIGHT:     'BMA weight — higher weight = more influence on BMA blend. Weights are set per-region based on model verification scores.',
  MAX_T:      'Model\'s predicted max temperature (°C) for the target day, after station bias correction.',
  ENS_COUNT:  'Raw ensemble member count landing in this bracket. More members = more confident estimate.',
} as const;

// ═══════════════════════════════════════════════════════════════
//  MODEL DISPLAY
// ═══════════════════════════════════════════════════════════════

/** Color assignments for each weather model in charts and tables */
export const MODEL_COLORS: Record<string, string> = {
  ENS_KDE: '#bb86fc',
  gfs_seamless: '#4488ff',
  ecmwf_ifs025: '#00bcd4',
  icon_seamless: '#ff8c00',
  icon_eu: '#ff6600',
  icon_d2: '#ff4400',
  jma_seamless: '#ff6b81',
  gem_seamless: '#26de81',
  meteofrance_seamless: '#a55eea',
  meteofrance_arome_france: '#8854d0',
  ukmo_seamless: '#fed330',
};

/** Get model color with fallback */
export function getModelColor(model: string): string {
  return MODEL_COLORS[model] || '#888';
}

// ═══════════════════════════════════════════════════════════════
//  SHARED EDGE COLOR
// ═══════════════════════════════════════════════════════════════

/** Tailwind text color class based on edge value sign */
export function edgeColorClass(v: number | null | undefined): string {
  if (v == null) return 'text-[#555]';
  return v > 0 ? 'text-[#00ff41]' : v < 0 ? 'text-[#ff3333]' : 'text-[#555]';
}

// ═══════════════════════════════════════════════════════════════
//  SHARED CALCULATION: NET ADJUSTMENT
// ═══════════════════════════════════════════════════════════════

/**
 * Compute the confidence-weighted net temperature adjustment from advanced factors.
 *
 * Formula: Σ(adjustment_i × confidence_i) for active factors, capped to ±3.0°C.
 * A factor is considered "active" when |adjustment| > 0.01 AND confidence > 0.1.
 *
 * This is the same formula used by:
 *   - Server: advanced-factors.js → runAllAdvancedFactors()
 *   - Client: AnalysisView (standalone factor toggles)
 *   - Client: BracketAnalysisPanel (displayNetAdj fallback)
 *
 * @param factors — array of AdvancedFactor objects
 * @param disabledFactors — optional set of factor names to exclude
 * @returns net adjustment in °C, or 0 if no active factors
 */
export function computeNetAdjustment(
  factors: AdvancedFactor[],
  disabledFactors?: Set<string>,
): number {
  const activeFx = factors.filter(
    (f) => Math.abs(f.adjustment) > 0.01 && f.confidence > 0.1,
  );
  const enabledFx = disabledFactors
    ? activeFx.filter((f) => !disabledFactors.has(f.factor))
    : activeFx;

  if (enabledFx.length === 0) return 0;

  return Math.max(
    -3.0,
    Math.min(
      3.0,
      enabledFx.reduce((sum, f) => sum + f.adjustment * f.confidence, 0),
    ),
  );
}
