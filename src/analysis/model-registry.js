/**
 * Model Registry — city-aware model selection with weighted consensus.
 *
 * Each city belongs to a region. Each region defines which deterministic
 * and ensemble models to use, with weights reflecting local model quality.
 * High-resolution regional models (ICON-D2, AROME, UKV) get boosted weights
 * for cities inside their coverage zone.
 */

// ── Model catalog ──────────────────────────────────────────────
export const MODEL_CATALOG = {
  // Global models (available everywhere)
  gfs_seamless:              { name: 'GFS',           res: '25km',  family: 'NOAA',         coverage: 'global' },
  ecmwf_ifs025:              { name: 'ECMWF IFS',     res: '25km',  family: 'ECMWF',        coverage: 'global' },
  icon_seamless:             { name: 'ICON',          res: '13km',  family: 'DWD',          coverage: 'global' },
  jma_seamless:              { name: 'JMA',           res: '20km',  family: 'JMA',          coverage: 'global' },
  gem_seamless:              { name: 'GEM',           res: '25km',  family: 'ECCC',         coverage: 'global' },
  meteofrance_seamless:      { name: 'MétéoFrance',   res: '10km',  family: 'MétéoFrance',  coverage: 'global' },
  ukmo_seamless:             { name: 'UKMO',          res: '10km',  family: 'MetOffice',    coverage: 'global' },

  // Regional high-resolution models
  icon_eu:                   { name: 'ICON-EU',       res: '7km',   family: 'DWD',          coverage: 'europe' },
  icon_d2:                   { name: 'ICON-D2',       res: '2km',   family: 'DWD',          coverage: 'central_europe' },
  meteofrance_arome_france:  { name: 'AROME',         res: '1.5km', family: 'MétéoFrance',  coverage: 'france' },
};

// ── Ensemble model catalog ─────────────────────────────────────
export const ENSEMBLE_CATALOG = {
  gfs025:              { name: 'GFS ENS',       members: 31, family: 'NOAA'  },
  ecmwf_ifs025:        { name: 'ECMWF IFS ENS', members: 51, family: 'ECMWF' },
  ecmwf_aifs025:       { name: 'ECMWF AIFS ENS',members: 51, family: 'ECMWF' },
  icon_seamless_eps:   { name: 'ICON-EPS',      members: 40, family: 'DWD'   },
};

// ── Region definitions ─────────────────────────────────────────
// weight 1.0 = standard, 1.5 = boosted (home model / high-res local)
const REGIONS = {
  us: {
    deterministic: [
      { model: 'gfs_seamless',         weight: 1.5 },  // NOAA's home model for US stations
      { model: 'ecmwf_ifs025',         weight: 1.0 },
      { model: 'icon_seamless',        weight: 1.0 },
      { model: 'jma_seamless',         weight: 0.7 },  // Lower weight — far from Japan
      { model: 'gem_seamless',         weight: 1.0 },  // GEM is good for N. America
      { model: 'meteofrance_seamless', weight: 0.7 },
      { model: 'ukmo_seamless',        weight: 1.0 },
    ],
    ensemble: ['gfs025', 'ecmwf_ifs025', 'ecmwf_aifs025', 'icon_seamless_eps'],
  },

  uk: {
    deterministic: [
      { model: 'ukmo_seamless',        weight: 1.5 },  // MetOffice UKV 2km for UK
      { model: 'ecmwf_ifs025',         weight: 1.0 },
      { model: 'icon_seamless',        weight: 1.0 },
      { model: 'icon_eu',              weight: 1.2 },  // ICON-EU 7km covers UK
      { model: 'gfs_seamless',         weight: 0.8 },
      { model: 'gem_seamless',         weight: 0.7 },
      { model: 'meteofrance_seamless', weight: 1.0 },
      { model: 'jma_seamless',         weight: 0.5 },
    ],
    ensemble: ['gfs025', 'ecmwf_ifs025', 'ecmwf_aifs025', 'icon_seamless_eps'],
  },

  central_europe: {
    deterministic: [
      { model: 'icon_d2',              weight: 1.5 },  // DWD's 2km model — best for DE/AT/CH
      { model: 'icon_eu',              weight: 1.3 },  // 7km Europe
      { model: 'icon_seamless',        weight: 1.0 },
      { model: 'ecmwf_ifs025',         weight: 1.0 },
      { model: 'ukmo_seamless',        weight: 0.8 },
      { model: 'gfs_seamless',         weight: 0.7 },
      { model: 'meteofrance_seamless', weight: 1.0 },
      { model: 'gem_seamless',         weight: 0.6 },
      { model: 'jma_seamless',         weight: 0.5 },
    ],
    ensemble: ['gfs025', 'ecmwf_ifs025', 'ecmwf_aifs025', 'icon_seamless_eps'],
  },

  france: {
    deterministic: [
      { model: 'meteofrance_arome_france', weight: 1.5 },  // 1.5km AROME
      { model: 'meteofrance_seamless',     weight: 1.3 },  // ARPEGE global
      { model: 'ecmwf_ifs025',             weight: 1.0 },
      { model: 'icon_eu',                  weight: 1.2 },
      { model: 'icon_seamless',            weight: 1.0 },
      { model: 'ukmo_seamless',            weight: 0.8 },
      { model: 'gfs_seamless',             weight: 0.7 },
      { model: 'gem_seamless',             weight: 0.6 },
      { model: 'jma_seamless',             weight: 0.5 },
    ],
    ensemble: ['gfs025', 'ecmwf_ifs025', 'ecmwf_aifs025', 'icon_seamless_eps'],
  },

  europe_other: {
    deterministic: [
      { model: 'ecmwf_ifs025',         weight: 1.2 },
      { model: 'icon_eu',              weight: 1.2 },
      { model: 'icon_seamless',        weight: 1.0 },
      { model: 'ukmo_seamless',        weight: 1.0 },
      { model: 'gfs_seamless',         weight: 0.8 },
      { model: 'meteofrance_seamless', weight: 1.0 },
      { model: 'gem_seamless',         weight: 0.6 },
      { model: 'jma_seamless',         weight: 0.5 },
    ],
    ensemble: ['gfs025', 'ecmwf_ifs025', 'ecmwf_aifs025', 'icon_seamless_eps'],
  },

  east_asia: {
    deterministic: [
      { model: 'jma_seamless',         weight: 1.5 },  // JMA is the home model for Japan/Korea
      { model: 'ecmwf_ifs025',         weight: 1.0 },
      { model: 'gfs_seamless',         weight: 1.0 },
      { model: 'icon_seamless',        weight: 0.8 },
      { model: 'gem_seamless',         weight: 0.7 },
      { model: 'meteofrance_seamless', weight: 0.6 },
      { model: 'ukmo_seamless',        weight: 0.7 },
    ],
    ensemble: ['gfs025', 'ecmwf_ifs025', 'ecmwf_aifs025', 'icon_seamless_eps'],
  },

  southern_hemisphere: {
    deterministic: [
      { model: 'ecmwf_ifs025',         weight: 1.2 },  // ECMWF has best SH skill
      { model: 'gfs_seamless',         weight: 1.0 },
      { model: 'icon_seamless',        weight: 1.0 },
      { model: 'gem_seamless',         weight: 0.8 },
      { model: 'meteofrance_seamless', weight: 0.7 },
      { model: 'jma_seamless',         weight: 0.6 },
      { model: 'ukmo_seamless',        weight: 0.8 },
    ],
    ensemble: ['gfs025', 'ecmwf_ifs025', 'ecmwf_aifs025', 'icon_seamless_eps'],
  },

  // Fallback for any city without a specific region
  global_fallback: {
    deterministic: [
      { model: 'gfs_seamless',         weight: 1.0 },
      { model: 'ecmwf_ifs025',         weight: 1.0 },
      { model: 'icon_seamless',        weight: 1.0 },
      { model: 'jma_seamless',         weight: 0.8 },
      { model: 'gem_seamless',         weight: 0.8 },
      { model: 'meteofrance_seamless', weight: 0.8 },
      { model: 'ukmo_seamless',        weight: 1.0 },
    ],
    ensemble: ['gfs025', 'ecmwf_ifs025', 'ecmwf_aifs025', 'icon_seamless_eps'],
  },
};

/**
 * Get the model configuration for a city based on its region.
 * Returns { deterministic: [{model, weight}], ensemble: [string], region }
 */
export function getModelsForCity(city) {
  const region = city?.region || 'global_fallback';
  const config = REGIONS[region] || REGIONS.global_fallback;
  return {
    ...config,
    region,
    deterministicSlugs: config.deterministic.map(m => m.model),
    modelWeights: Object.fromEntries(config.deterministic.map(m => [m.model, m.weight])),
  };
}

/**
 * Look up human-readable model info from the catalog.
 */
export function getModelInfo(slug) {
  return MODEL_CATALOG[slug] || { name: slug, res: '?', family: '?', coverage: '?' };
}
