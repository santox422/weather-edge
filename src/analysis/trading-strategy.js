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
    if (b.marketPrice > 0.05) {
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
  const yesCandidates = brackets
    .filter(b => b.kellyYes > 0 && b.edge > 0.04 && b.marketPrice >= 0.05 && b.marketPrice <= 0.75)
    .sort((a, b) => b.kellyYes - a.kellyYes);

  const yesBets = [];
  const usedNames = new Set();

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
      b.kellyYes * HALF_KELLY * confidence * tailDiscount,
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
  if (yesBets.length > 0 && yesBets.length < 3) {
    const primaryIdx = brackets.findIndex(b => b.name === yesBets[0].bracket);
    const neighbors = [primaryIdx - 1, primaryIdx + 1]
      .filter(i => i >= 0 && i < brackets.length)
      .map(i => brackets[i])
      .filter(b => !usedNames.has(b.name) && b.forecastProb > 0.05 && b.marketPrice < 0.80);

    for (const nb of neighbors) {
      const kelly = Math.min(
        Math.max(nb.kellyYes || 0, 0.02) * HALF_KELLY * confidence,
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
      const kelly = Math.min(b.kellyNo * HALF_KELLY * confidence, MAX_PER_POSITION);
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
    .filter(b => b.kellyNo > 0 && b.forecastProb < 0.06 && b.marketPrice >= 0.02 && b.marketPrice <= 0.12 && !usedNames.has(b.name))
    .sort((a, b) => b.kellyNo - a.kellyNo)
    .slice(0, 6) // Max 6 NO positions
    .map(b => {
      const noPrice = 1 - b.marketPrice;
      const kelly = Math.min(b.kellyNo * HALF_KELLY * confidence, MAX_PER_POSITION);
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
      pctOfPortfolio: Math.min(+(0.5 * confidence).toFixed(1), 1.0), // Fixed small allocation
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
  const allBets = [
    ...yesBets.map(b => ({ ...b, type: 'YES' })),
    ...overpricedNoBets.map(b => ({ ...b, type: 'NO' })),
    ...noBets.map(b => ({ ...b, type: 'NO' })),
    ...longshots.map(b => ({ ...b, type: 'YES' }))
  ];

  let expectedReturn = 0;
  let minPortfolioReturn = 0; // Worst-case scenario

  for (const outcome of brackets) {
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
    // Multiply outcome result by its probability to get expected portfolio sum
    const weightedReturn = outcomeReturn * outcome.forecastProb;
    if (isFinite(weightedReturn)) expectedReturn += weightedReturn;
    if (outcomeReturn < minPortfolioReturn) {
      minPortfolioReturn = outcomeReturn;
    }
  }

  const maxDrawdown = Math.abs(minPortfolioReturn);
  // ── Win Probability (correct for mutually exclusive brackets) ──
  // Temperature can only land on ONE bracket, so bets are NOT independent.
  // For each possible outcome, check if ANY bet in the portfolio wins.
  // P(portfolio wins) = sum of P(outcome) for all outcomes where ≥1 bet profits.
  //
  // YES/LONGSHOT bets win when their specific bracket hits.
  // FADE/NO bets win when their bracket DOESN'T hit (i.e. every other outcome).
  //
  // We use the original bracket forecast probabilities (before bet selection).
  const yesBracketNames = new Set([
    ...yesBets.map(b => b.bracket),
    ...longshots.map(b => b.bracket),
  ]);
  const fadeBracketNames = new Set([
    ...overpricedNoBets.map(b => b.bracket),
    ...noBets.map(b => b.bracket),
  ]);

  let winProbability = 0;
  for (const b of brackets) {
    const outcomeProb = b.forecastProb; // probability this temperature occurs
    // Does any bet win if this outcome occurs?
    const yesWins = yesBracketNames.has(b.name); // YES/LONG bet on this bracket wins
    // FADE/NO bets on OTHER brackets win (a FADE on bracket X wins when outcome ≠ X)
    const fadeWins = [...fadeBracketNames].some(fadeName => fadeName !== b.name);
    if (yesWins || fadeWins) {
      winProbability += outcomeProb;
    }
  }
  // Clamp to [0, 1]
  winProbability = Math.max(0, Math.min(1, winProbability));

  // ── 50% Minimum Win Rate Enforcement ──
  // If portfolio win rate is below 50%, drop the riskiest positions.
  const MIN_WIN_RATE = 0.50;
  const recomputeWin = () => {
    const yNames = new Set([...yesBets.map(b => b.bracket), ...longshots.map(b => b.bracket)]);
    const fNames = new Set([...overpricedNoBets.map(b => b.bracket), ...noBets.map(b => b.bracket)]);
    let wp = 0;
    for (const b of brackets) {
      const yWin = yNames.has(b.name);
      const fWin = [...fNames].some(fn => fn !== b.name);
      if (yWin || fWin) wp += b.forecastProb;
    }
    return Math.max(0, Math.min(1, wp));
  };
  while (winProbability < MIN_WIN_RATE && longshots.length > 0) {
    longshots.pop();
    winProbability = recomputeWin();
  }
  while (winProbability < MIN_WIN_RATE && yesBets.length > 1) {
    yesBets.pop();
    winProbability = recomputeWin();
  }


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
      maxDrawdown: +maxDrawdown.toFixed(1),
      winProbability: +(winProbability * 100).toFixed(0),
      confidence: +(confidence * 100).toFixed(0),
      daysOut,
    },
    arbitrage: {
      sumYesPrices: +sumYesPrices.toFixed(3),
      profitIfArb: +(arbProfit * 100).toFixed(2),
      isArbitrage: arbProfit > 0.005,
    },
  };
}
