# Weather Analysis — Probability Pipeline

> **Audience**: Developers modifying the analysis engine.
> **Last updated**: 2026-03-27

This document describes the probability pipeline that converts raw weather model output into bracket trading probabilities.

## Pipeline Overview

```
┌──────────────┐    ┌──────────────┐    ┌──────────────┐    ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│ 1. Ensemble  │ → │ 2. Station   │ → │ 3. BMA       │ → │ 4. Base Rate │ → │ 5. PhD Factor│ → │ 6. METAR     │
│    KDE       │    │    Bias Corr │    │    Blend     │    │    Prior     │    │    Shifts    │    │    Constraint│
└──────────────┘    └──────────────┘    └──────────────┘    └──────────────┘    └──────────────┘    └──────────────┘
    ensemble.js         ensemble.js        ensemble.js      analysis-engine   probability-matrix    ensemble.js
                                                                                  .js
```

## Stage 1: Ensemble KDE

**File**: `ensemble.js` → `computeKDE()`

Converts discrete ensemble member temperatures into a smooth probability density using **Gaussian Kernel Density Estimation**.

- **Input**: 170+ ensemble member max temperatures (GFS 31 + ECMWF 51 + AIFS 51 + ICON-EPS 40)
- **Bandwidth**: Silverman's Rule of Thumb (σ × (4/3n)^(1/5))
- **Per-model weighting**: Each ensemble system has a regional weight from `model-registry.js`
- **Output**: `rawBracketProbabilities[]` — raw KDE-derived probability per bracket

## Stage 2: Station Bias Correction

**File**: `ensemble.js` → inline in KDE computation

Applies systematic correction based on historical forecast errors at the specific weather station.

- **Input**: Station bias data (mean error, std dev, sample count)
- **Method**: Shifts all ensemble member temps by the bias offset before KDE
- **Threshold**: Only applied when sample count N ≥ 30 (otherwise unreliable)

## Stage 3: BMA Blend (Bayesian Model Averaging)

**File**: `ensemble.js` → `computeBMA()`

Blends the ensemble KDE distribution with deterministic model forecasts.

- **Ensemble stream**: KDE probability from Stage 1
- **Deterministic stream**: Each model's max temp forecast → Gaussian CDF (σ = 0.7°C for 1-day lead) → bracket probability
- **Blending weights**: Regional BMA weights from `model-registry.js` (e.g. GFS 1.5× in US, ECMWF 1.3× in UK)
- **Output**: `preFactorBracketProbabilities[]` — BMA-blended probability per bracket

## Stage 4: Base Rate Prior (Bayesian)

**File**: `analysis-engine.js` → inline

Optional Bayesian prior from historical temperature data at the location.

- **Method**: Historical exceedance rate for each bracket threshold
- **Weight**: Low (typically 20% of the blend) — climatology is a weak signal compared to NWP
- **Applied only** when sufficient historical data exists (≥ 5 years)

## Stage 5: PhD Factor Adjustments (Re-KDE)

**File**: `probability-matrix.js` → `applyFactorAdjustments()`

Applies 12 advanced meteorological factor corrections via **dual-stream Re-KDE**.

### The 12 Factors

| # | Factor | Effect |
|---|--------|--------|
| 1 | Midnight Carryover | Pre-dawn T → next-day heating deficit |
| 2 | Solar Budget | Cloud/transparency → incoming energy |
| 3 | Thermal Inertia | Soil wetness/temp → heat absorption |
| 4 | Diurnal Range | Clear/dry → amplified day-night swing |
| 5 | Precip Timing | Afternoon rain → evaporative ceiling |
| 6 | Wind Regime | Boundary-layer mixing suppresses extremes |
| 7 | Synoptic Pattern | Air mass classification → systematic bias |
| 8 | Dew Point Ceiling | Humidity → energy diverted to evaporation |
| 9 | Urban Heat Island | City built-environment → +T bias |
| 10 | Humidity Ceiling | High RH → Bowen ratio < 0.5 |
| 11 | Temp Advection | Multi-level wind → warm/cold air transport |
| 12 | Trajectory Momentum | Model run trend (warming/cooling drift) |

### Method: Dual-Stream Re-KDE + BMA Re-Blend

1. **Compute net shift**: Σ(adjustment_i × confidence_i), capped to ±3°C
2. **Un-damp** the shift to recover physical magnitude (÷ 0.45 scaling)
3. **Stream A**: Shift all ensemble members by the net shift → re-run KDE
4. **Stream B**: Shift deterministic model max temps by the net shift → re-run Gaussian CDF
5. **BMA re-blend**: Combine using same regional weights as Stage 3
6. **Output**: `bracketProbabilities[]` — factor-adjusted BMA probability

### Key Design Decisions

- **Shift applied to raw members** (not to probabilities) — preserves the shape of the distribution
- **Both streams shifted** — ensures ensemble and deterministic agree on the direction
- **Probability mass is conserved** — re-KDE + re-CDF always produces a proper distribution summing to 1

## Stage 6: METAR Live Constraint

**File**: `ensemble.js` → inline, called from `analysis-engine.js`

Final hard constraint using real-time METAR observations from the nearest airport station.

- **Method**: If the current observed temperature already exceeds a bracket's upper bound, that bracket's probability is zeroed
- **Applied last** — METAR is ground truth, it overrides all modeled probabilities
- **Output**: Final `bracketProbabilities[]` on the Edge object

## Data Flow Summary

```
analysis-engine.js::analyzeMarket()
  ├── fetch ensemble data → ensemble.js::processEnsemble()
  │     ├── Stage 1: KDE (rawBracketProbabilities)
  │     ├── Stage 2: Station bias correction
  │     └── Stage 3: BMA blend (preFactorBracketProbabilities)
  ├── fetch atmospheric, soil, solar data
  ├── advanced-factors.js::runAllAdvancedFactors()  → 12 factors
  ├── probability-matrix.js::applyFactorAdjustments()
  │     └── Stage 5: Re-KDE + BMA re-blend (bracketProbabilities)
  ├── Stage 6: METAR constraint
  ├── edge-scoring.js::computeEdgeScore()  → trading signals
  └── trading-strategy.js::computeTradingStrategy()  → Kelly sizing
```

## Client-Side Recalculation

When a user toggles models on/off or adjusts BMA weights in the UI, the client performs a **partial recalculation**:

1. Recomputes deterministic BMA using only enabled models with adjusted weights
2. Re-applies the server-computed factor shifts on top
3. Does **not** re-run ensemble KDE (too expensive for client-side)

This is implemented in `useBracketRecalculation.ts`.
