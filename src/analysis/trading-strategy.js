/**
 * Trading Strategy Engine — Multi-outcome Kelly Criterion + spread betting.
 * Modelled on HondaCivic's reverse-engineered approach (3,016 trades).
 *
 * Generates YES conviction bets, overpriced NO fades, safe NO premium,
 * and longshot positions with tail-probability-adjusted Kelly sizing.
 */

/**
 * Compute a full trading strategy from bracket probabilities and market prices.
 *
 * Uses multi-outcome Kelly Criterion (half-Kelly for safety) to size positions,
 * with a tail-probability discount to prevent over-allocation on low-probability
 * brackets where estimation uncertainty is highest.
 *
 * Generates four tiers:
 *   1.  YES conviction bets — brackets where forecast >> market price
 *   1b. Overpriced NO fades — brackets where market >> forecast (buy NO)
 *   2.  Safe NO premium — near-zero forecast prob brackets (HondaCivic "$4k blocks")
 *   3.  Longshot YES — very cheap brackets with small but real probability
 *
 * @param {Object} analysis — the full analysis object from analyzeMarket
 * @returns {Object|null} strategy recommendations
 */
export function computeTradingStrategy(analysis) {
  const bracketProbs = analysis.edge?.bracketProbabilities;
  if (!bracketProbs || bracketProbs.length < 3) return null;

  const confidence = parseFloat(analysis.edge?.confidence) / 100 || 0.5;
  const daysOut = analysis.daysUntilResolution || 1;
  const skillFactor = analysis.forecastSkill?.skillFactor ?? 1.0;

  // ── Entry Timing Logic ──
  // Reference strategy shows 10-12h before resolution is critical to edge.
  let hoursToResolution = null;
  let entryWindow = 'UNKNOWN';
  if (analysis.market?.endDate) {
    const endDate = new Date(analysis.market.endDate);
    hoursToResolution = Math.max(0, (endDate - new Date()) / (1000 * 60 * 60));
    if (hoursToResolution < 2) entryWindow = 'WAIT';       // Too late, spreads likely wide
    else if (hoursToResolution <= 12) entryWindow = 'OPTIMAL';   // Sweet spot: 6-12h
    else if (hoursToResolution <= 24) entryWindow = 'ACCEPTABLE';
    else entryWindow = 'TOO_EARLY';                           // >24h — forecast still uncertain
  }

  // Timing-based Kelly scaling: when resolution is >24h out, scale down
  // allocations by the forecast skill factor (which decays with lead time).
  const timingScale = daysOut > 1 ? skillFactor : 1.0;

  // ── Sort brackets by temperature value for adjacency analysis ──
  const brackets = bracketProbs
    .filter(b => b.forecastProb != null && b.marketPrice != null)
    .map(b => ({
      name: b.name || b.title,
      forecastProb: b.forecastProb,
      marketPrice: b.marketPrice,
      edge: b.forecastProb - b.marketPrice,
      kellyYes: null,
      kellyNo: null,
    }));

  if (brackets.length < 3) return null;

  // ── Compute Kelly fractions for each bracket ──
  for (const b of brackets) {
    // YES Kelly: f* = (p*b - q) / b  where p=forecastProb, q=1-p, b=payout odds-1
    // For a YES bet at price c, payout = 1/c - 1, so b = (1-c)/c
    if (b.marketPrice > 0.01 && b.marketPrice < 0.95) {
      const p = b.forecastProb;
      const q = 1 - p;
      const odds = (1 - b.marketPrice) / b.marketPrice; // net odds
      const kelly = (p * odds - q) / odds;
      b.kellyYes = Math.max(0, kelly);
    }

    // NO Kelly: betting NO at price (1 - marketPrice)
    // Probability of winning NO = 1 - forecastProb
    // Odds for NO bet = marketPrice / (1 - marketPrice)
    if (b.marketPrice > 0.001) {
      const noPrice = 1 - b.marketPrice;
      const pNo = 1 - b.forecastProb;
      const qNo = b.forecastProb;
      if (noPrice > 0.01 && noPrice < 1) {
        const oddsNo = (1 - noPrice) / noPrice; // = marketPrice / (1-marketPrice)
        const kellyNo = (pNo * oddsNo - qNo) / oddsNo;
        b.kellyNo = Math.max(0, kellyNo);
      }
    }
  }

  // ── Apply half-Kelly and cap at 10% per position ──
  const HALF_KELLY = 0.5;
  const MAX_PER_POSITION = 0.10; // 10% of portfolio max per single bet

  // ── Tail-probability discount ──
  // Kelly over-allocates on low-probability, high-odds brackets because
  // payout odds inflate the fraction. But estimation uncertainty is highest
  // in the tails (KDE smoothing bleeds probability from the peak).
  // Discount non-peak brackets proportionally to their distance from the mode.
  const peakProb = Math.max(...brackets.map(b => b.forecastProb));

  // ── Tier 1: YES Conviction Bets ──
  // Brackets where forecast significantly exceeds market AND Kelly is positive
  // Also recommend adjacent brackets for temperature hedging
  const yesBets = [];
  const usedNames = new Set();

  // HondaCivic Rule: Buy YES on the bracket the model says is most likely (anchor bet).
  // Only place the anchor bet when the forecast probability EXCEEDS the market price,
  // otherwise we're buying at negative expected value.
  const mostLikelyBracket = [...brackets].sort((a, b) => b.forecastProb - a.forecastProb)[0];
  if (mostLikelyBracket && mostLikelyBracket.forecastProb > 0.10 && mostLikelyBracket.edge > 0) {
    // Scale allocation by edge magnitude instead of a flat 5% — larger edge = larger anchor
    const edgeScaled = Math.max(0, mostLikelyBracket.edge) * 0.15 * confidence;
    const fixedAllocation = Math.max(0.01, Math.min(edgeScaled, 0.08)) * timingScale; // clamp to 1-8%, scaled by timing
    yesBets.push({
      bracket: mostLikelyBracket.name,
      side: 'YES',
      pctOfPortfolio: +(fixedAllocation * 100).toFixed(1),
      entryPrice: +(mostLikelyBracket.marketPrice * 100).toFixed(1),
      forecastProb: +(mostLikelyBracket.forecastProb * 100).toFixed(1),
      edge: +(mostLikelyBracket.edge * 100).toFixed(1),
      expectedReturn: mostLikelyBracket.marketPrice > 0 ? +((mostLikelyBracket.forecastProb / mostLikelyBracket.marketPrice - 1) * 100).toFixed(0) : 0,
      kellyRaw: +((mostLikelyBracket.kellyYes || 0) * 100).toFixed(1),
    });
    usedNames.add(mostLikelyBracket.name);
  }

  const yesCandidates = brackets
    .filter(b => b.kellyYes > 0 && b.edge > 0.04 && b.marketPrice >= 0.05 && b.marketPrice <= 0.75)
    .sort((a, b) => b.kellyYes - a.kellyYes);

  for (const b of yesCandidates) {
    if (usedNames.has(b.name)) continue;

    // Tail discount: brackets < 50% of peak probability get scaled down
    // This prevents Kelly inflation on low-prob, high-odds tail brackets
    const probRatio = peakProb > 0 ? b.forecastProb / peakProb : 1;
    const tailDiscount = probRatio < 0.5 ? probRatio : 1.0;

    // Also cap allocation proportional to forecast probability
    // (no bracket should get more than forecastProb * 15% of portfolio)
    const probCap = b.forecastProb * 0.15;

    const kelly = Math.min(
      b.kellyYes * HALF_KELLY * confidence * tailDiscount * timingScale,
      MAX_PER_POSITION,
      probCap
    );
    if (kelly < 0.005) continue; // Skip if less than 0.5% of portfolio

    yesBets.push({
      bracket: b.name,
      side: 'YES',
      pctOfPortfolio: +(kelly * 100).toFixed(1),
      entryPrice: +(b.marketPrice * 100).toFixed(1),
      forecastProb: +(b.forecastProb * 100).toFixed(1),
      edge: +(b.edge * 100).toFixed(1),
      expectedReturn: +((b.forecastProb / b.marketPrice - 1) * 100).toFixed(0),
      kellyRaw: +(b.kellyYes * 100).toFixed(1),
    });
    usedNames.add(b.name);
  }

  // ── Ensure adjacent bracket coverage ──
  // If we have a primary YES bet, also recommend neighbors for hedging
  // Only add neighbors with POSITIVE edge — never hedge into overpriced brackets
  if (yesBets.length > 0 && yesBets.length < 3) {
    const primaryIdx = brackets.findIndex(b => b.name === yesBets[0].bracket);
    const neighbors = [primaryIdx - 1, primaryIdx + 1]
      .filter(i => i >= 0 && i < brackets.length)
      .map(i => brackets[i])
      .filter(b => !usedNames.has(b.name) && b.forecastProb > 0.05 && b.marketPrice < 0.80 && b.edge > 0);

    for (const nb of neighbors) {
      const kelly = Math.min(
        Math.max(nb.kellyYes || 0, 0.02) * HALF_KELLY * confidence * timingScale,
        MAX_PER_POSITION * 0.8 // Neighbors get 80% allocation (matching HondaCivic spreading weights)
      );
      if (kelly < 0.003) continue;
      yesBets.push({
        bracket: nb.name,
        side: 'YES',
        pctOfPortfolio: +(kelly * 100).toFixed(1),
        entryPrice: +(nb.marketPrice * 100).toFixed(1),
        forecastProb: +(nb.forecastProb * 100).toFixed(1),
        edge: +(nb.edge * 100).toFixed(1),
        expectedReturn: nb.marketPrice > 0 ? +((nb.forecastProb / nb.marketPrice - 1) * 100).toFixed(0) : 0,
        kellyRaw: +((nb.kellyYes || 0) * 100).toFixed(1),
        isHedge: true,
      });
      usedNames.add(nb.name);
    }
  }

  // ── Tier 1b: Overpriced NO Fades ──
  // Brackets where the market significantly overprices the outcome.
  // Unlike safe NO bets (near-zero probability), these have real probability
  // but the market is too high — e.g. 13°C at 54% when forecast says 31%.
  const overpricedNoBets = brackets
    .filter(b => b.kellyNo > 0 && b.edge < -0.06 && b.marketPrice > 0.08 && b.forecastProb >= 0.03 && !usedNames.has(b.name))
    .sort((a, b) => a.edge - b.edge) // most negative edge (biggest overpricing) first
    .slice(0, 3) // Max 3 overpriced NO positions
    .map(b => {
      const noPrice = 1 - b.marketPrice;
      const kelly = Math.min(b.kellyNo * HALF_KELLY * confidence * timingScale, MAX_PER_POSITION);
      return {
        bracket: b.name,
        side: 'FADE',
        pctOfPortfolio: +(kelly * 100).toFixed(1),
        entryPrice: +(noPrice * 100).toFixed(1),
        forecastProb: +((1 - b.forecastProb) * 100).toFixed(1),
        edge: +(b.edge * 100).toFixed(1), // negative = market overprices this bracket
        edgeNo: +((1 - b.forecastProb - noPrice) * 100).toFixed(1), // positive = our NO edge
        maxLoss: +(noPrice * 100).toFixed(1), // max loss per share is the NO price
        marketYesPrice: +(b.marketPrice * 100).toFixed(1),
        kellyRaw: +(b.kellyNo * 100).toFixed(1),
      };
    })
    .filter(b => b.pctOfPortfolio >= 0.5);

  // Mark overpriced brackets as used so they don't appear in safe NO too
  for (const b of overpricedNoBets) usedNames.add(b.bracket);

  // ── Tier 2: Safe NO Premium ──
  // Brackets with near-zero forecast probability — HondaCivic's "$4,103 block" approach.
  // Buying NO at 99¢+ on brackets so far from the expected temp that losing is near-impossible.
  const noBets = brackets
    .filter(b => b.kellyNo > 0 && b.forecastProb < 0.06 && b.marketPrice >= 0.001 && b.marketPrice <= 0.12 && !usedNames.has(b.name))
    .sort((a, b) => b.kellyNo - a.kellyNo)
    .slice(0, 6) // Max 6 NO positions
    .map(b => {
      const noPrice = 1 - b.marketPrice;
      const kelly = Math.min(b.kellyNo * HALF_KELLY * confidence * timingScale, MAX_PER_POSITION);
      return {
        bracket: b.name,
        side: 'NO',
        pctOfPortfolio: +(kelly * 100).toFixed(1),
        entryPrice: +(noPrice * 100).toFixed(1),
        forecastProb: +((1 - b.forecastProb) * 100).toFixed(1),
        edge: +((1 - b.forecastProb - noPrice) * 100).toFixed(1),
        maxLoss: +(noPrice * 100).toFixed(1), // max loss per share is our NO price
        profitPerShare: +((1 - noPrice) * 100).toFixed(2),
        kellyRaw: +(b.kellyNo * 100).toFixed(1),
      };
    })
    .filter(b => b.pctOfPortfolio >= 0.5);

  // ── Tier 3: Longshot YES ──
  // Very cheap brackets with small but non-zero probability
  const longshots = brackets
    .filter(b => b.marketPrice < 0.05 && b.forecastProb > 0.02 && b.forecastProb < 0.15 && b.edge > 0.01 && !usedNames.has(b.name))
    .sort((a, b) => (b.forecastProb / b.marketPrice) - (a.forecastProb / a.marketPrice))
    .slice(0, 3) // Max 3 longshots
    .map(b => ({
      bracket: b.name,
      side: 'LONGSHOT',
      pctOfPortfolio: Math.min(+(0.5 * confidence * timingScale).toFixed(1), 1.0), // Fixed small allocation
      entryPrice: +(b.marketPrice * 100).toFixed(1),
      forecastProb: +(b.forecastProb * 100).toFixed(1),
      edge: +(b.edge * 100).toFixed(1),
      potentialReturn: b.marketPrice > 0 ? +((1 / b.marketPrice - 1) * 100).toFixed(0) : 0,
    }));

  // ── Portfolio Summary ──
  const totalYesPct = yesBets.reduce((s, b) => s + b.pctOfPortfolio, 0);
  const totalFadePct = overpricedNoBets.reduce((s, b) => s + b.pctOfPortfolio, 0);
  const totalNoPct = noBets.reduce((s, b) => s + b.pctOfPortfolio, 0);
  const totalLongshotPct = longshots.reduce((s, b) => s + b.pctOfPortfolio, 0);
  const totalDeployed = totalYesPct + totalFadePct + totalNoPct + totalLongshotPct;

  // ── True Outcome Simulation (Expected Return & Max Drawdown) ──
  // Uses BLENDED probability to avoid self-referential edge calculation:
  // blendedProb = confidence * forecastProb + (1 - confidence) * marketPrice
  // This reflects genuine edge only to the degree the system is confident.
  const allBets = [
    ...yesBets.map(b => ({ ...b, type: 'YES' })),
    ...overpricedNoBets.map(b => ({ ...b, type: 'NO' })),
    ...noBets.map(b => ({ ...b, type: 'NO' })),
    ...longshots.map(b => ({ ...b, type: 'YES' }))
  ];

  let expectedReturn = 0;
  let minPortfolioReturn = 0; // Worst-case scenario

  // Track per-outcome portfolio returns for win probability calculation
  const outcomeReturns = [];

  // ── Normalize blended probabilities before simulation ──
  // When market prices don't sum to 1, raw blended probabilities are biased.
  // Pre-compute all blended weights and normalize them to a proper distribution.
  const rawBlendedWeights = brackets.map(outcome =>
    confidence * outcome.forecastProb + (1 - confidence) * outcome.marketPrice
  );
  const blendedSum = rawBlendedWeights.reduce((a, b) => a + b, 0);
  const normalizedBlended = blendedSum > 0
    ? rawBlendedWeights.map(w => w / blendedSum)
    : rawBlendedWeights; // guard against zero

  for (let oi = 0; oi < brackets.length; oi++) {
    const outcome = brackets[oi];
    const blendedProb = normalizedBlended[oi];

    let outcomeReturn = 0; // percentage of portfolio
    for (const bet of allBets) {
      const alloc = bet.pctOfPortfolio;
      const price = bet.entryPrice / 100;

      // Guard: skip bets with zero or invalid entry price to avoid Infinity/NaN
      if (!price || price <= 0) continue;

      if (bet.type === 'YES') {
        if (bet.bracket === outcome.name) {
          outcomeReturn += alloc * (1 / price - 1); // Win profit
        } else {
          outcomeReturn -= alloc; // Lose allocated amount
        }
      } else { // NO or FADE
        if (bet.bracket !== outcome.name) {
          outcomeReturn += alloc * (1 / price - 1); // Win profit
        } else {
          outcomeReturn -= alloc; // Lose allocated amount
        }
      }
    }
    // Use normalized blended probability for expected return — reflects genuine edge
    // only to the degree the system is confident in forecast superiority
    const weightedReturn = outcomeReturn * blendedProb;
    if (isFinite(weightedReturn)) expectedReturn += weightedReturn;
    if (outcomeReturn < minPortfolioReturn) {
      minPortfolioReturn = outcomeReturn;
    }

    // Store for portfolio-level win probability calculation
    outcomeReturns.push({ forecastProb: outcome.forecastProb, netReturn: outcomeReturn });
  }

  const maxDrawdown = Math.abs(minPortfolioReturn);

  // ── Win Probability (portfolio-level profitability) ──
  // For each possible bracket outcome, we already computed the net portfolio return
  // above. winProbability = sum of forecastProb for outcomes where the entire
  // portfolio is profitable (net return > 0). This is a meaningful estimate of
  // the probability that the overall portfolio makes money, not just any single leg.
  let winProbability = 0;
  for (const { forecastProb, netReturn } of outcomeReturns) {
    if (netReturn > 0) {
      winProbability += forecastProb;
    }
  }
  // Clamp to [0, 1]
  winProbability = Math.max(0, Math.min(1, winProbability));


  const sumYesPrices = brackets.reduce((s, b) => s + b.marketPrice, 0);
  const arbProfit = sumYesPrices < 1 ? (1 - sumYesPrices) : 0;

  return {
    yesBets: yesBets.sort((a, b) => b.pctOfPortfolio - a.pctOfPortfolio),
    overpricedNoBets: overpricedNoBets.sort((a, b) => b.pctOfPortfolio - a.pctOfPortfolio),
    noBets: noBets.sort((a, b) => b.pctOfPortfolio - a.pctOfPortfolio),
    longshots,
    summary: {
      totalYesPct: +yesBets.reduce((s, b) => s + b.pctOfPortfolio, 0).toFixed(1),
      totalFadePct: +overpricedNoBets.reduce((s, b) => s + b.pctOfPortfolio, 0).toFixed(1),
      totalNoPct: +noBets.reduce((s, b) => s + b.pctOfPortfolio, 0).toFixed(1),
      totalLongshotPct: +longshots.reduce((s, b) => s + b.pctOfPortfolio, 0).toFixed(1),
      totalDeployed: +[...yesBets, ...overpricedNoBets, ...noBets, ...longshots].reduce((s, b) => s + b.pctOfPortfolio, 0).toFixed(1),
      expectedReturn: isFinite(expectedReturn) ? +expectedReturn.toFixed(2) : 0,
      expectedReturnDisclaimer: 'Model-conditional expected return using blended probability (confidence-weighted mix of forecast and market). Not risk-adjusted.',
      maxDrawdown: +maxDrawdown.toFixed(1),
      winProbability: +(winProbability * 100).toFixed(0),
      confidence: +(confidence * 100).toFixed(0),
      daysOut,
      hoursToResolution: hoursToResolution !== null ? +hoursToResolution.toFixed(1) : null,
      entryWindow,
    },
    timingAdvice: {
      hoursToResolution: hoursToResolution !== null ? +hoursToResolution.toFixed(1) : null,
      entryWindow,
      recommendation: entryWindow === 'OPTIMAL' ? 'Enter now — within optimal 6-12h window'
        : entryWindow === 'ACCEPTABLE' ? 'Acceptable entry window (12-24h) — proceed with standard sizing'
        : entryWindow === 'TOO_EARLY' ? `Consider waiting — resolution is ${hoursToResolution?.toFixed(0) || '?'}h away. Kelly allocations scaled down by ${(skillFactor * 100).toFixed(0)}%.`
        : entryWindow === 'WAIT' ? 'Too close to resolution (<2h) — spreads may be wide, exercise caution'
        : 'Unknown resolution timing',
      kellyScaling: timingScale,
    },
    arbitrage: {
      sumYesPrices: +sumYesPrices.toFixed(3),
      profitIfArb: +(arbProfit * 100).toFixed(2),
      isArbitrage: arbProfit > 0.005,
    },
  };
}
