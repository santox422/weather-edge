import { analyzeMarket } from '../analysis/analysis-engine.js';
import { getCityMarketsMultiDay } from './polymarket-service.js';
import { getSettings, upsertDailySignal, addTrade, getModelPortfolios, resolveTrades, getAllTrades, upsertDailyEvent, getAllDailyEvents, getAllSignals, deleteFutureTrades } from './paper-db.js';
import { getHistorical, getStationMETAR } from './weather-service.js';
import { CITY_DATABASE } from '../analysis/city-resolver.js';

/**
 * Paper Trade Engine v3 — Autonomous SQLite Engine
 * Runs periodically to scan active markets.
 */
export async function runPaperTradingLoop() {
  console.log('[PAPER-ENGINE] Running background evaluation loop...');
  const settings = getSettings();

  // Cleanup: purge any erroneously-created trades/signals for future dates
  cleanupFutureTrades();
  
  if (!settings.allow_entries) {
    console.log('[PAPER-ENGINE] allow_entries is false, skipping execution.');
    return;
  }

  let multiData;
  try {
    multiData = await getCityMarketsMultiDay(14);
  } catch (err) {
    console.error('[PAPER-ENGINE] Failed to fetch markets:', err.message);
    return;
  }

  const cities = multiData.cities || [];
  const todayStr = new Date().toISOString().split('T')[0];

  for (const city of cities) {
    for (const [date, market] of Object.entries(city.marketsByDate || {})) {
      if (!market) continue;

      // CRITICAL GATE: Only trade on the ACTUAL calendar day of the market.
      // The `date` key is the weather observation date (e.g. "2026-03-28").
      // We must NOT trade early — the weather hasn't happened yet, and
      // Polymarket's `endDate` is the market closure time which can be
      // hours or days AFTER the resolution date.
      if (date !== todayStr) continue;

      const fullMarket = {
        ...market,
        title: market.title || `Highest temperature in ${city.name} on ${date}`,
        city: city.slug,
        marketType: 'temperature',
        threshold: market.thresholds?.[0]?.value || null,
        unit: market.thresholds?.[0]?.unit || 'F',
        endDate: market.endDate || new Date(date + 'T23:59:59Z').toISOString(),
      };

      // Secondary check: make sure the market hasn't fully closed yet
      const endTime = new Date(fullMarket.endDate).getTime();
      if (endTime <= Date.now()) {
        console.log(`[PAPER-ENGINE] Skipping ${city.slug} ${date} — market already closed`);
        continue;
      }

      await evaluateAndTrade(city, date, fullMarket, settings);
    }
  }

  // Auto-resolve pending past days
  // Auto-resolve pending past days actuals
  await resolveDailyActuals();
}

function isWinningBracket(bracketStr, finalTempC) {
  const str = bracketStr.toLowerCase();
  const isF = str.includes('°f') || str.includes('f');
  const toC = (f) => (f - 32) * 5/9;
  
  if (str.includes('higher') || str.includes('above') || str.includes('+') || str.includes('more')) {
    const m = str.match(/([-\d\.]+)/);
    if (!m) return false;
    let val = parseFloat(m[1]);
    if (isF) val = toC(val);
    const halfWidth = isF ? 0.28 : 0.5;
    return finalTempC >= (val - halfWidth); 
  }
  
  if (str.includes('lower') || str.includes('below') || str.includes('under')) {
    const m = str.match(/([-\d\.]+)/);
    if (!m) return false;
    let val = parseFloat(m[1]);
    if (isF) val = toC(val);
    const halfWidth = isF ? 0.28 : 0.5;
    return finalTempC < (val + halfWidth);
  }
  
  const rangeMatch = str.match(/([-\d\.]+)\s*(?:-|to)\s*([-\d\.]+)/);
  if (rangeMatch && !str.startsWith('-')) {
    let low = parseFloat(rangeMatch[1]);
    let high = parseFloat(rangeMatch[2]);
    if (isF) { low = toC(low); high = toC(high); }
    const halfWidth = isF ? 0.28 : 0.5;
    return finalTempC >= (low - halfWidth) && finalTempC < (high + halfWidth);
  }
  
  const exactMatch = str.match(/([-\d\.]+)/);
  if (exactMatch) {
    let val = parseFloat(exactMatch[1]);
    if (isF) val = toC(val);
    const halfWidth = isF ? 0.28 : 0.5;
    return finalTempC >= (val - halfWidth) && finalTempC < (val + halfWidth);
  }
  
  return false;
}

async function resolveDailyActuals() {
  const settings = getSettings();
  const today = new Date().toISOString().split('T')[0];
  const startDate = settings.start_date || today;

  // We want to fetch actuals for any date/city that has a daily_signal
  // but doesn't have a final_temp in daily_events yet.
  const allEvents = getAllDailyEvents();
  const allSignals = getAllSignals();
  
  const pendingByDateCity = new Map();
  for (const s of allSignals) {
    if (s.date < startDate) continue;
    // Skip if we already have a final_temp
    const ev = allEvents.find(e => e.date === s.date && e.city === s.city);
    if (ev && ev.final_temp != null) continue;

    const key = `${s.date}|${s.city}`;
    if (!pendingByDateCity.has(key)) pendingByDateCity.set(key, { date: s.date, city: s.city });
  }

  // Also resolve pending trades just in case (e.g. they traded but no signal for some reason)
  const trades = getAllTrades().filter(t => t.status === 'PENDING');
  for (const t of trades) {
    if (t.date < startDate) continue;
    const ev = allEvents.find(e => e.date === t.date && e.city === t.city);
    if (ev && ev.final_temp != null) continue;
    const key = `${t.date}|${t.city}`;
    if (!pendingByDateCity.has(key)) pendingByDateCity.set(key, { date: t.date, city: t.city });
  }

  for (const { date, city } of pendingByDateCity.values()) {
    // Never try to resolve future dates — weather hasn't happened yet
    if (date > today) continue;

    const cDb = Object.values(CITY_DATABASE).find(c => c.slug === city);
    if (!cDb) continue;

    let finalTemp = null;
    try {
      if (date < today) {
        const data = await getHistorical(cDb.lat, cDb.lon, date, date);
        finalTemp = data?.daily?.temperature_2m_max?.[0] ?? null;
      } else if (date === today) {
        const metar = await getStationMETAR(cDb.icao);
        finalTemp = metar?.maxToday ?? null;
      }
    } catch (e) { console.error(`Failed to get actuals for ${city} on ${date}:`, e.message); }

    if (finalTemp != null) {
      let winningBracket = null;
      // Look up signals for this specific date/city to find bracket names
      const sigs = allSignals.filter(s => s.date === date && s.city === city);
      if (sigs.length > 0 && sigs[0].probabilities_json?.length > 0) {
        for (const b of sigs[0].probabilities_json) {
          const bName = b.name || b.title;
          if (isWinningBracket(bName, finalTemp)) {
            winningBracket = bName;
            break;
          }
        }
      }
      
      // If we couldn't derive it from signals (e.g. no signals), check trades
      if (!winningBracket) {
        const cityTrades = trades.filter(t => t.date === date && t.city === city);
        for (const t of cityTrades) {
          if (isWinningBracket(t.bracket, finalTemp)) {
            winningBracket = t.bracket;
            break;
          }
        }
      }

      upsertDailyEvent({ date, city, final_temp: finalTemp, winning_bracket: winningBracket });
      
      const changed = resolveTrades(date, city, winningBracket);
      if (changed > 0) {
        console.log(`[PAPER-ENGINE] Resolved ${changed} trades for ${city} ${date}. Winner: ${winningBracket || 'OTHER'}`);
      }
    }
  }
}

/**
 * Cleanup: remove any trades/signals that were erroneously created for future dates.
 * This handles the bug where the engine previously used endDate-based arithmetic
 * which could allow early entry into markets days before the weather event.
 */
function cleanupFutureTrades() {
  const todayStr = new Date().toISOString().split('T')[0];
  const result = deleteFutureTrades(todayStr);
  const total = result.trades + result.signals + result.events;
  if (total > 0) {
    console.log(`[PAPER-ENGINE] Cleaned up future-dated entries: ${result.trades} trades, ${result.signals} signals, ${result.events} events`);
  }
}

async function evaluateAndTrade(city, date, fullMarket, settings) {
  try {
    const analysis = await analyzeMarket(fullMarket);
    if (analysis.error || !analysis.ensemble) return;

    // ── Compute trade timing metadata ──
    const nowUtc = new Date();
    const tradedAtUtc = nowUtc.toISOString();

    // Look up this city's timezone from the resolver database
    const cDb = Object.values(CITY_DATABASE).find(c => c.slug === city.slug);
    const cityTz = cDb?.tz || analysis.city?.tz || 'UTC';

    // Compute local time in the city's timezone
    let tradedAtLocal = null;
    let hoursBeforeEod = null;
    try {
      const localTimeStr = nowUtc.toLocaleString('en-GB', {
        timeZone: cityTz,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false
      });
      tradedAtLocal = localTimeStr;

      // Hours before midnight local time (end of weather observation day)
      const localParts = nowUtc.toLocaleString('en-US', {
        timeZone: cityTz, hour: 'numeric', minute: 'numeric', hour12: false
      });
      const [h, m] = localParts.split(':').map(Number);
      hoursBeforeEod = +((24 - h - m / 60)).toFixed(1);
    } catch {
      // Timezone conversion not available
    }

    // Extract context from analysis for trade metadata
    const netAdj = analysis.advancedFactors?.netAdjustment ?? null;
    const consensus = analysis.multiModel?.consensus?.weightedMedian ?? null;
    const stationTemp = analysis.liveWeather?.currentTemp ?? null;

    // 1. ENS (Stream 1 Ensemble KDE, bias-corrected)
    const ensBrackets = analysis.ensemble.rawBracketProbabilities || [];
    // 2. BMA (Blend before factors if factors exist, else final BMA)
    const bmaBrackets = analysis.ensemble.preFactorBracketProbabilities || analysis.ensemble.bracketProbabilities || [];
    // 3. ENS+PhD
    const ensPhdBrackets = analysis.ensemble.ensShiftedBrackets || ensBrackets;
    // 4. BMA+PhD (Final BMA with factors and METAR)
    const bmaPhdBrackets = analysis.ensemble.bracketProbabilities || [];

    const models = [
      { key: 'ENS', brackets: ensBrackets },
      { key: 'BMA', brackets: bmaBrackets },
      { key: 'ENS_PHD', brackets: ensPhdBrackets },
      { key: 'BMA_PHD', brackets: bmaPhdBrackets },
    ];

    for (const model of models) {
      if (!model.brackets || model.brackets.length === 0) continue;

      // Find the bracket with the highest forecast probability
      const valid = model.brackets.filter(b => b.forecastProb != null && b.marketPrice != null);
      if (valid.length === 0) continue;

      const topPick = [...valid].sort((a, b) => b.forecastProb - a.forecastProb)[0];
      const pickProb = topPick.forecastProb;
      const mktPrice = topPick.marketPrice; // format: 0.65 -> 65¢

      if (!topPick || mktPrice == null) continue;

      // Record this daily signal for analytics so we know what it picked roughly before execution ends
      upsertDailySignal({
        id: `${date}-${city.slug}-${model.key}`,
        date,
        city: city.slug,
        model_column: model.key,
        pick_bracket: topPick.name || topPick.title,
        pick_prob: pickProb,
        pick_price: mktPrice,
        probabilities_json: model.brackets.map(b => ({
          name: b.name || b.title,
          forecastProb: b.forecastProb,
          edge: b.edge,
          marketPrice: b.marketPrice
        }))
      });

      // Trade Rule: YES price < max_entry_price AND only buy YES
      if (mktPrice < settings.max_entry_price) {
        const safePrice = Math.max(mktPrice, 0.01);
        const cost = settings.capital * settings.trade_size_pct;
        const shares = cost / safePrice;
        const edge = pickProb - mktPrice;

        const tradeData = {
          id: `${date}-${city.slug}-${model.key}-YES`,
          date,
          city: city.slug,
          model_column: model.key,
          bracket: topPick.name || topPick.title,
          side: 'YES',
          entry_price: +safePrice.toFixed(4),
          shares: +shares.toFixed(2),
          cost: +cost.toFixed(2),
          status: 'PENDING',
          pnl: 0,
          // ── Trade metadata ──
          traded_at_utc: tradedAtUtc,
          traded_at_local: tradedAtLocal,
          hours_before_eod: hoursBeforeEod,
          city_tz: cityTz,
          forecast_prob: +pickProb.toFixed(4),
          market_price_at_entry: +safePrice.toFixed(4),
          edge_at_entry: +edge.toFixed(4),
          net_adjustment: netAdj != null ? +netAdj.toFixed(2) : null,
          model_consensus: consensus != null ? `${consensus.toFixed(1)}°C` : null,
          station_temp: stationTemp,
        };

        try {
          addTrade(tradeData);
          console.log(
            `[PAPER-TRADE] ${city.slug} ${date} [${model.key}] → ${tradeData.bracket} ` +
            `@ ${(safePrice * 100).toFixed(0)}¢ | prob=${(pickProb * 100).toFixed(0)}% ` +
            `edge=${(edge * 100).toFixed(0)}pp | ${hoursBeforeEod}h before EOD (${cityTz}) ` +
            `| station=${stationTemp != null ? stationTemp + '°C' : 'n/a'} ` +
            `| phd=${netAdj != null ? (netAdj > 0 ? '+' : '') + netAdj.toFixed(1) + '°C' : 'n/a'}`
          );
        } catch (dbErr) {
          // Unique constraint violation means we already traded it for this model, ignore.
        }
      }
    }

  } catch (err) {
    console.error(`[PAPER-ENGINE] Error evaluating ${city.slug} for ${date}:`, err.message);
  }
}

/**
 * Legacy Honda Civic trades export for the UI metrics
 */
export function getHondaCivicTrades(db, targetDate) {
  if (!db) return [];
  try {
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

    const redeems = db.prepare(`
      SELECT city, temperature, SUM(usdc_size) as redeemed
      FROM trades WHERE type='REDEEM' AND target_date = ?
      GROUP BY city, temperature
    `).all(targetDate);

    const redeemMap = {};
    for (const r of redeems) redeemMap[`${r.city}|${r.temperature}`] = r.redeemed;

    const byCity = {};
    for (const p of positions) {
      if (!byCity[p.city]) byCity[p.city] = { city: p.city, yesPositions: [], noPositions: [], totalCost: 0 };
      const cd = byCity[p.city];
      const netCost = p.buy_cost - p.sell_proceeds;
      const netShares = p.buy_shares - p.sell_shares;
      const label = p.temp_high && p.temp_high !== 999 ? `${p.temperature}-${p.temp_high}°${p.unit}` :
                    p.temp_high === 999 ? `${p.temperature}°${p.unit}+` : `${p.temperature}°${p.unit}`;

      const pos = { label, netCost: +netCost.toFixed(2), netShares: +netShares.toFixed(1), redeemed: redeemMap[`${p.city}|${p.temperature}`] || 0 };
      if (p.outcome === 'Yes') cd.yesPositions.push(pos);
      else cd.noPositions.push(pos);
    }
    for (const cd of Object.values(byCity)) {
       const costYes = cd.yesPositions.reduce((s,p)=>s+Math.max(0,p.netCost),0);
       const costNo = cd.noPositions.reduce((s,p)=>s+Math.max(0,p.netCost),0);
       cd.totalCost = costYes + costNo;
       const topYes = cd.yesPositions.sort((a,b) => b.netCost - a.netCost)[0];
       cd.mainYesBracket = topYes?.label || null;
    }
    return Object.values(byCity);
  } catch (err) {
    return [];
  }
}
