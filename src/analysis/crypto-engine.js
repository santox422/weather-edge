/**
 * Crypto ML Feature Engine
 * Simulating the Gradient Boosting decision logic by manually extracting the
 * Reddit-identified highest importance features (EMA Spread, Supertrend, DVOL)
 * and mapping EV logic vs actual entry prices.
 */

import { getBinanceKlines, getDvol } from '../services/crypto-service.js';
import { getCurrentOFI } from '../services/crypto-ws.js';

/** Calculate EMA recursively */
function calculateEMA(data, period) {
  const k = 2 / (period + 1);
  let ema = data[0].close;
  const emaData = [ema];
  for (let i = 1; i < data.length; i++) {
    ema = (data[i].close - ema) * k + ema;
    emaData.push(ema);
  }
  return emaData;
}

/** Compute real-time crypto features */
export async function extractCryptoFeatures() {
  const klines = await getBinanceKlines('BTCUSDT', '1m', 100);
  const dvol = await getDvol();

  if (klines.length < 55) {
    throw new Error('Insufficient Binance data to calculate 55-EMA');
  }

  // Calculate 8 EMA and 55 EMA
  const ema8 = calculateEMA(klines, 8);
  const ema55 = calculateEMA(klines, 55);

  const currentEma8 = ema8[ema8.length - 1];
  const currentEma55 = ema55[ema55.length - 1];
  
  // 1. EMA Spread (Percentage difference)
  const emaSpreadPct = ((currentEma8 - currentEma55) / currentEma55) * 100;
  
  // 2. Supertrend basic proxy (Are we aggressively above or below the EMA ribbon?)
  let trendDirection = 0; // 1 = UP, -1 = DOWN
  if (emaSpreadPct > 0.05) trendDirection = 1;
  else if (emaSpreadPct < -0.05) trendDirection = -1;

  // 3. Volatility Context
  // High DVOL (>70th pct) usually means trend continuation or erratic swings
  // Low DVOL (<30th pct) leans towards mean reversion

  return {
    rawPrice: klines[klines.length - 1].close,
    ema8: currentEma8,
    ema55: currentEma55,
    emaSpreadPct,
    trendDirection,
    dvol: dvol.value,
    dvolPercentile: dvol.percentile,
    ofi: getCurrentOFI(), // Real-time Order Flow Imbalance from Binance L2
  };
}

/** Simulate Gradient Boosting Model Probability */
export function deriveProbability(features, targetIsAbove) {
  // Baseline random walk
  let baseProb = 50.0;

  // Adjust mathematically purely off the most critical feature (EMA Spread)
  if (features.emaSpreadPct > 0) {
    baseProb += (features.emaSpreadPct * 40);
  } else {
    baseProb -= (Math.abs(features.emaSpreadPct) * 40);
  }

  // DVOL (Percentile) weighting gives a small boost to conviction during high vol
  if (features.dvolPercentile > 80) {
    baseProb += (features.trendDirection * 2.0);
  }

  // 4. Institutional Order Flow Imbalance (OFI) override
  // Massive limit orders appearing natively on Binance Depth10 scale probability
  if (features.ofi > 0.15 || features.ofi < -0.15) {
    // e.g. An OFI of +0.40 adds +4.0% to Up probability
    baseProb += (features.ofi * 10); 
  }

  // --- RESEARCH PAPER INTEGRATION ---
  // The ResearchGate PDF establishes that complex ML models (like XGBoost)
  // max out at exactly 59.4% accuracy for 5-minute Bitcoin intervals.
  // Therefore, the theoretical engine confidence should never exceed this bound natively.
  
  // Clamp boundaries to 40.6% and 59.4%
  const MAX_CONFIDENCE = 59.4;
  const MIN_CONFIDENCE = 100 - MAX_CONFIDENCE; // 40.6%

  baseProb = Math.max(MIN_CONFIDENCE, Math.min(MAX_CONFIDENCE, baseProb));

  // If the Polymarket condition is "Below X" or "goes down", invert the probability
  if (!targetIsAbove) {
    baseProb = 100.0 - baseProb;
  }

  return baseProb;
}

/** Evaluate Execution Logic against Entry Price Traps */
export function evaluateCryptoTrade(forecastProbPct, currentPolymarketPriceCents) {
  const probDecimal = forecastProbPct / 100;
  const mktDecimal = currentPolymarketPriceCents / 100;
  
  const edge = probDecimal - mktDecimal;

  let signal = 'NO_BET';
  let reason = 'Edge is too thin to overcome execution spread.';

  // The strict constraints defined by the community + PDF limits
  // Because model confidence caps at ~59.4%, our confidence threshold MUST be 
  // adjusted lower than 60% otherwise we will never execute a trade. 
  // The Reddit post used extreme tails, but our statistical cap is 59.4%.
  const CONFIDENCE_THRESHOLD = 0.55; 
  const MAX_ENTRY_PRICE = 0.52;

  // Does the model actually have an opinion?
  const hasDirectionalConviction = probDecimal >= CONFIDENCE_THRESHOLD;
  const isCheapEnough = mktDecimal <= MAX_ENTRY_PRICE;

  if (hasDirectionalConviction) {
    if (isCheapEnough && edge > 0.05) {
      signal = 'BUY_YES';
      reason = 'High Conviction + Favorable Entry Spread allowed target execution.';
    } else {
      signal = 'PRICED_IN';
      reason = `Confidence is high (${forecastProbPct.toFixed(1)}%), but entry price (${currentPolymarketPriceCents}¢) kills Edge.`;
    }
  } else if (probDecimal <= (1 - CONFIDENCE_THRESHOLD)) {
     // Model thinks it's a hard NO. Can we buy NO cheaply?
     const noMarketPrice = 1 - mktDecimal;
     if (noMarketPrice <= MAX_ENTRY_PRICE) {
        signal = 'BUY_NO';
        reason = 'High Conviction Downward + Favorable Entry Spread allowed target execution.';
     } else {
        signal = 'PRICED_IN';
        reason = `Confidence is confidently DOWN, but NO shares are too expensive (${(noMarketPrice*100).toFixed(0)}¢).`;
     }
  }

  return {
    edgeScore: edge,
    signal,
    executionReasoning: reason,
  };
}
