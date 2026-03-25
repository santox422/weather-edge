/**
 * Paper Trade Engine v2 — Auto-active multi-strategy system.
 * 
 * Runs automatically when tab opens. For each city/date:
 *   - Strategy A (ENS): Buy YES on highest ensemble probability bracket
 *   - Strategy B (FCST): Buy YES on highest blended forecast bracket
 *   - 3 NO brackets on tails for both strategies
 *   - Calculates estimated profit for each strategy
 *   - Compares against Honda Civic's gold standard
 * 
 * Honda Civic data: YES = side:BUY + outcome:Yes, NO = side:BUY + outcome:No
 */

import { analyzeMarket } from '../analysis/analysis-engine.js';
import { getCityMarketsMultiDay, HONDA_CITIES } from './polymarket-service.js';
import { addTrades } from './paper-trade-store.js';

const PORTFOLIO_SIZE = 10000;

/**
 * Run full paper trading analysis for a target date.
 * Returns detailed per-city data with multiple strategy scenarios.
 */
export async function runPaperAnalysis(targetDate) {
  console.log(`[PAPER] Running auto paper analysis for ${targetDate}...`);

  let multiData;
  try {
    multiData = await getCityMarketsMultiDay(14);
  } catch (err) {
    return { error: `Failed to fetch markets: ${err.message}`, cities: [] };
  }

  const cities = multiData.cities;
  const citiesWithMarkets = cities.filter(c => c.marketsByDate?.[targetDate] != null);
  const numActive = Math.max(citiesWithMarkets.length, 1);
  const perEventBudget = PORTFOLIO_SIZE / numActive;

  console.log(`[PAPER] ${citiesWithMarkets.length} cities have markets for ${targetDate} → $${perEventBudget.toFixed(0)}/event`);

  // Analyze all cities in parallel
  const results = await Promise.allSettled(citiesWithMarkets.map(async (city) => {
    const market = city.marketsByDate[targetDate];
    try {
      const fullMarket = {
        ...market,
        title: market.title || `Highest temperature in ${city.name} on ${targetDate}`,
        city: city.slug,
        marketType: 'temperature',
        threshold: market.thresholds?.[0]?.value || null,
        unit: market.thresholds?.[0]?.unit || 'F',
        endDate: market.endDate || new Date(targetDate + 'T23:59:59Z').toISOString(),
      };

      // Timing info
      let hoursLeft = null;
      let entryWindow = 'UNKNOWN';
      if (fullMarket.endDate) {
        hoursLeft = Math.max(0, (new Date(fullMarket.endDate) - new Date()) / 3600000);
        if (hoursLeft < 4) entryWindow = 'TOO_LATE';
        else if (hoursLeft <= 12) entryWindow = 'OPTIMAL';
        else if (hoursLeft <= 24) entryWindow = 'GOOD';
        else entryWindow = 'EARLY';
      }

      const analysis = await analyzeMarket(fullMarket);
      const brackets = analysis.edge?.bracketProbabilities;
      if (!brackets || brackets.length < 3) return null;

      const valid = brackets
        .filter(b => b.forecastProb != null && b.marketPrice != null)
        .map(b => ({
          name: b.name || b.title,
          fcstProb: b.forecastProb,
          ensProb: b.ensembleProb || b.forecastProb,
          mktPrice: b.marketPrice,
          edge: b.forecastProb - b.marketPrice,
        }));

      if (valid.length < 4) return null;

      // Strategy A: ENS pick (highest ensemble probability)
      const ensSorted = [...valid].sort((a, b) => b.ensProb - a.ensProb);
      const ensYes = ensSorted[0];

      // Strategy B: FCST pick (highest blended forecast probability)
      const fcstSorted = [...valid].sort((a, b) => b.fcstProb - a.fcstProb);
      const fcstYes = fcstSorted[0];

      // NO candidates: 3 lowest probability brackets (excluding YES pick)
      function pickNOs(yesBracket) {
        return valid
          .filter(b => b.name !== yesBracket.name)
          .sort((a, b) => a.fcstProb - b.fcstProb)
          .slice(0, 3);
      }

      const ensNOs = pickNOs(ensYes);
      const fcstNOs = pickNOs(fcstYes);

      // Calculate estimated profit for a strategy
      function calcProfit(yesBracket, noBrackets) {
        const yesAlloc = perEventBudget * 0.06;
        const noAllocEach = perEventBudget * 0.29;
        const yesPrice = Math.max(yesBracket.mktPrice, 0.01);
        const yesShares = yesAlloc / yesPrice;
        const totalCost = yesAlloc + noAllocEach * noBrackets.length;

        // Expected profit: sum over all possible outcomes
        let expectedProfit = 0;
        for (const outcome of valid) {
          const outcomeProb = outcome.fcstProb;
          let profit = 0;

          // YES leg
          if (outcome.name === yesBracket.name) {
            profit += yesShares * (1 - yesPrice) ; // YES wins: shares × (1 - entry)
          } else {
            profit -= yesAlloc; // YES loses: cost lost
          }

          // NO legs
          for (const no of noBrackets) {
            const noPrice = Math.max(1 - no.mktPrice, 0.90);
            const noShares = noAllocEach / noPrice;
            if (outcome.name !== no.name) {
              profit += noShares * (1 - noPrice); // NO wins: shares × profit per share
            } else {
              profit -= noAllocEach; // NO loses: cost lost
            }
          }

          expectedProfit += profit * outcomeProb;
        }

        return {
          yesAlloc: +yesAlloc.toFixed(2),
          noAllocEach: +noAllocEach.toFixed(2),
          totalCost: +totalCost.toFixed(2),
          yesPrice: +yesPrice.toFixed(4),
          yesShares: +yesShares.toFixed(1),
          expectedProfit: +expectedProfit.toFixed(2),
          expectedROI: totalCost > 0 ? +((expectedProfit / totalCost) * 100).toFixed(1) : 0,
        };
      }

      const ensStrategy = calcProfit(ensYes, ensNOs);
      const fcstStrategy = calcProfit(fcstYes, fcstNOs);

      return {
        city: city.slug,
        cityName: city.name,
        date: targetDate,
        hoursLeft: hoursLeft !== null ? +hoursLeft.toFixed(1) : null,
        entryWindow,
        ens: {
          yesBracket: ensYes.name,
          yesProb: +(ensYes.ensProb * 100).toFixed(1),
          yesPrice: +(ensYes.mktPrice * 100).toFixed(1),
          yesEdge: +((ensYes.ensProb - ensYes.mktPrice) * 100).toFixed(1),
          noBrackets: ensNOs.map(b => b.name),
          ...ensStrategy,
        },
        fcst: {
          yesBracket: fcstYes.name,
          yesProb: +(fcstYes.fcstProb * 100).toFixed(1),
          yesPrice: +(fcstYes.mktPrice * 100).toFixed(1),
          yesEdge: +((fcstYes.fcstProb - fcstYes.mktPrice) * 100).toFixed(1),
          noBrackets: fcstNOs.map(b => b.name),
          ...fcstStrategy,
        },
        samePick: ensYes.name === fcstYes.name,
        allBrackets: valid.map(b => ({
          name: b.name,
          mkt: +(b.mktPrice * 100).toFixed(1),
          ens: +(b.ensProb * 100).toFixed(1),
          fcst: +(b.fcstProb * 100).toFixed(1),
        })),
      };
    } catch (err) {
      console.error(`[PAPER] ${city.name} error:`, err.message);
      return null;
    }
  }));

  const paperCities = results
    .filter(r => r.status === 'fulfilled' && r.value != null)
    .map(r => r.value);

  // Summary stats
  const totalEnsProfit = paperCities.reduce((s, c) => s + c.ens.expectedProfit, 0);
  const totalFcstProfit = paperCities.reduce((s, c) => s + c.fcst.expectedProfit, 0);

  return {
    date: targetDate,
    citiesAnalyzed: paperCities.length,
    citiesTotal: citiesWithMarkets.length,
    perEventBudget: +perEventBudget.toFixed(0),
    portfolioSize: PORTFOLIO_SIZE,
    cities: paperCities,
    allCityNames: HONDA_CITIES.map(c => c.name),
    totalEnsExpectedProfit: +totalEnsProfit.toFixed(2),
    totalFcstExpectedProfit: +totalFcstProfit.toFixed(2),
  };
}

/**
 * Get Honda Civic's DETAILED trades from SQLite DB for a specific date.
 * Returns per-city breakdown with YES/NO positions, costs, shares, and PnL.
 */
export function getHondaCivicTrades(db, targetDate) {
  if (!db) return [];

  try {
    // Net positions: BUY vs SELL aggregated per bracket
    const positions = db.prepare(`
      SELECT city, target_date, temperature, temp_high, unit, outcome,
             SUM(CASE WHEN side='BUY' THEN usdc_size ELSE 0 END) as buy_cost,
             SUM(CASE WHEN side='SELL' THEN usdc_size ELSE 0 END) as sell_proceeds,
             SUM(CASE WHEN side='BUY' THEN size ELSE 0 END) as buy_shares,
             SUM(CASE WHEN side='SELL' THEN size ELSE 0 END) as sell_shares,
             COUNT(*) as trade_count
      FROM trades
      WHERE type='TRADE' AND target_date = ?
      GROUP BY city, target_date, temperature, temp_high, unit, outcome
      ORDER BY city, outcome DESC, temperature
    `).all(targetDate);

    // Redemptions (= resolution results)
    const redeems = db.prepare(`
      SELECT city, temperature, SUM(usdc_size) as redeemed
      FROM trades WHERE type='REDEEM' AND target_date = ?
      GROUP BY city, temperature
    `).all(targetDate);

    const redeemMap = {};
    for (const r of redeems) {
      const key = `${r.city}|${r.temperature}`;
      redeemMap[key] = r.redeemed;
    }

    // Group by city
    const byCity = {};
    for (const p of positions) {
      if (!byCity[p.city]) {
        byCity[p.city] = {
          city: p.city,
          date: p.target_date,
          unit: p.unit,
          yesPositions: [],
          noPositions: [],
          totalYesCost: 0,
          totalNoCost: 0,
          totalRedeemed: 0,
          tradeCount: 0,
        };
      }
      const cd = byCity[p.city];
      const netCost = p.buy_cost - p.sell_proceeds;
      const netShares = p.buy_shares - p.sell_shares;
      const avgPrice = netShares > 0 ? netCost / netShares : 0;
      const label = p.temp_high && p.temp_high !== 999
        ? `${p.temperature}-${p.temp_high}°${p.unit}`
        : p.temp_high === 999
          ? `${p.temperature}°${p.unit}+`
          : `${p.temperature}°${p.unit}`;

      const pos = {
        temp: p.temperature,
        label,
        netCost: +netCost.toFixed(2),
        netShares: +netShares.toFixed(1),
        avgPrice: +avgPrice.toFixed(4),
        trades: p.trade_count,
        redeemed: redeemMap[`${p.city}|${p.temperature}`] || 0,
      };

      if (p.outcome === 'Yes') {
        cd.yesPositions.push(pos);
        cd.totalYesCost += Math.max(0, netCost);
      } else {
        cd.noPositions.push(pos);
        cd.totalNoCost += Math.max(0, netCost);
      }
      cd.tradeCount += p.trade_count;
    }

    // Calculate PnL for each city
    for (const cd of Object.values(byCity)) {
      cd.totalYesCost = +cd.totalYesCost.toFixed(2);
      cd.totalNoCost = +cd.totalNoCost.toFixed(2);
      cd.totalCost = +(cd.totalYesCost + cd.totalNoCost).toFixed(2);
      cd.totalRedeemed = +[...cd.yesPositions, ...cd.noPositions]
        .reduce((s, p) => s + p.redeemed, 0).toFixed(2);
      cd.estimatedPnl = +(cd.totalRedeemed - cd.totalCost).toFixed(2);

      // Main YES bracket = highest cost YES position
      const topYes = cd.yesPositions.sort((a, b) => b.netCost - a.netCost)[0];
      cd.mainYesBracket = topYes?.label || null;
      cd.mainYesPrice = topYes ? +(topYes.avgPrice * 100).toFixed(1) : 0;
    }

    return Object.values(byCity);
  } catch (err) {
    console.error(`[PAPER] Honda Civic DB error: ${err.message}`);
    return [];
  }
}

/**
 * Execute paper trades for all cities in an analysis result.
 * Follows the HondaCivic strategy: 1 YES on best bracket + 3 NO on tail brackets.
 * Budget: 6% YES, 29%×3 NO per city event.
 */
export function executePaperTrades(analysis) {
  if (!analysis || !analysis.cities || analysis.cities.length === 0) {
    return { trades: [], added: 0 };
  }

  const now = Date.now();
  const newTrades = [];

  for (const city of analysis.cities) {
    const perEventBudget = analysis.perEventBudget || (PORTFOLIO_SIZE / analysis.cities.length);
    const yesAlloc = perEventBudget * 0.06;
    const noAllocEach = perEventBudget * 0.29;

    // Use FCST strategy (blended forecast — matches HondaCivic's approach)
    const yesBracket = city.fcst?.yesBracket || city.ens?.yesBracket;
    const noBrackets = city.fcst?.noBrackets || city.ens?.noBrackets || [];
    if (!yesBracket) continue;

    // Find YES bracket data from allBrackets
    const yesData = city.allBrackets?.find(b => b.name === yesBracket);
    const yesPrice = yesData ? yesData.mkt / 100 : (city.fcst?.yesPrice || 50) / 100;
    const yesProb = yesData ? yesData.fcst : (city.fcst?.yesProb || 50);

    // YES trade
    const safeYesPrice = Math.max(yesPrice, 0.01);
    newTrades.push({
      id: `${city.city}-${city.date}-YES-${now}`,
      city: city.city,
      cityName: city.cityName || city.city,
      date: city.date,
      bracket: yesBracket,
      side: 'YES',
      entryPrice: +safeYesPrice.toFixed(4),
      shares: +(yesAlloc / safeYesPrice).toFixed(2),
      cost: +yesAlloc.toFixed(2),
      forecastProb: +yesProb,
      status: 'PENDING',
      pnl: 0,
      entryTime: new Date(now).toISOString(),
      source: 'FCST',
    });

    // 3 NO trades on tail brackets
    for (const noBracket of noBrackets.slice(0, 3)) {
      const noData = city.allBrackets?.find(b => b.name === noBracket);
      const noMktPrice = noData ? noData.mkt / 100 : 0.01;
      // NO entry price = 1 - yesPrice (buy NO = sell YES)
      const noEntryPrice = Math.max(1 - noMktPrice, 0.90);
      const noProb = noData ? (100 - noData.fcst) : 100;

      newTrades.push({
        id: `${city.city}-${city.date}-NO-${noBracket}-${now}`,
        city: city.city,
        cityName: city.cityName || city.city,
        date: city.date,
        bracket: noBracket,
        side: 'NO',
        entryPrice: +noEntryPrice.toFixed(4),
        shares: +(noAllocEach / noEntryPrice).toFixed(2),
        cost: +noAllocEach.toFixed(2),
        forecastProb: +noProb,
        status: 'PENDING',
        pnl: 0,
        entryTime: new Date(now).toISOString(),
        source: 'FCST',
      });
    }
  }

  if (newTrades.length === 0) return { trades: [], added: 0 };

  const result = addTrades(newTrades);
  console.log(`[PAPER] Executed ${result.added} new trades (${newTrades.length} generated, ${result.total} total stored)`);
  return { trades: newTrades, added: result.added, total: result.total };
}
