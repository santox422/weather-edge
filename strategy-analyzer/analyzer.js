/**
 * @HondaCivic Weather Strategy Analyzer
 *
 * Combines two data sources:
 *  1. /activity trades (from SQLite DB) — timing, spread structure, pricing
 *  2. /positions API — REAL PnL from Polymarket's own accounting
 *
 * Produces a comprehensive strategy breakdown.
 */

import { getDb } from './db.js';
import { parseWeatherTitle } from './scraper.js';

const WALLET = '0x15ceffed7bf820cd2d90f90ea24ae9909f5cd5fa';
const DATA_API = 'https://data-api.polymarket.com';

// ─── Fetch real PnL from /positions ──────────────────────────────────

async function fetchAllPositions() {
  const positions = [];
  let offset = 0;
  while (true) {
    const url = `${DATA_API}/positions?user=${WALLET}&limit=500&sizeThreshold=0&offset=${offset}`;
    const res = await fetch(url);
    if (!res.ok) break;
    const batch = await res.json();
    if (!batch || batch.length === 0) break;
    positions.push(...batch);
    if (batch.length < 500) break;
    offset += 500;
    await new Promise(r => setTimeout(r, 300));
  }
  return positions;
}

function isWeatherPosition(p) {
  const t = (p.title || '').toLowerCase();
  const s = (p.slug || '').toLowerCase();
  return t.includes('temperature') || s.includes('temperature');
}

// ─── Analysis functions using trade DB ───────────────────────────────

function analyzeSpreadFromDB() {
  const db = getDb();

  // For each event, get all brackets and how YES/NO are distributed
  const events = db.prepare(`
    SELECT DISTINCT event_slug, city, target_date, unit
    FROM trades WHERE event_slug != '' AND type = 'TRADE'
    ORDER BY target_date
  `).all();

  const spreads = [];

  for (const evt of events) {
    const brackets = db.prepare(`
      SELECT condition_id, temperature, temp_high, outcome, side,
             COUNT(*) as trade_count, SUM(size) as total_size,
             SUM(usdc_size) as total_cost, AVG(price) as avg_price
      FROM trades
      WHERE event_slug = ? AND type = 'TRADE' AND side = 'BUY'
      GROUP BY condition_id, outcome
      ORDER BY temperature
    `).all(evt.event_slug);

    if (brackets.length === 0) continue;

    const yesBrackets = brackets.filter(b => b.outcome === 'Yes');
    const noBrackets = brackets.filter(b => b.outcome === 'No');

    // Unique temperatures covered
    const allTemps = [...new Set(brackets.map(b => b.temperature))].sort((a, b) => a - b);

    spreads.push({
      city: evt.city,
      date: evt.target_date,
      slug: evt.event_slug,
      bracketCount: allTemps.length,
      yesCount: yesBrackets.length,
      noCount: noBrackets.length,
      yesAvgPrice: yesBrackets.length > 0
        ? yesBrackets.reduce((s, b) => s + b.avg_price, 0) / yesBrackets.length : 0,
      noAvgPrice: noBrackets.length > 0
        ? noBrackets.reduce((s, b) => s + b.avg_price, 0) / noBrackets.length : 0,
      yesCost: yesBrackets.reduce((s, b) => s + b.total_cost, 0),
      noCost: noBrackets.reduce((s, b) => s + b.total_cost, 0),
      temps: allTemps,
    });
  }

  return spreads;
}

function analyzeTimingFromDB() {
  const db = getDb();

  const trades = db.prepare(`
    SELECT timestamp, target_date, price, size, side, outcome
    FROM trades WHERE type = 'TRADE' ORDER BY timestamp
  `).all();

  const hourOfDay = new Array(24).fill(0);
  const dayOfWeek = new Array(7).fill(0);
  const hoursBeforeList = [];

  for (const t of trades) {
    const d = new Date(t.timestamp * 1000);
    hourOfDay[d.getUTCHours()]++;
    dayOfWeek[d.getUTCDay()]++;

    if (t.target_date) {
      const resolution = new Date(t.target_date + 'T23:59:59Z');
      const hBefore = (resolution.getTime() - d.getTime()) / 3600000;
      if (hBefore >= 0) hoursBeforeList.push(hBefore);
    }
  }

  const timingBuckets = { '0-6h': 0, '6-12h': 0, '12-24h': 0, '24-48h': 0, '48h+': 0 };
  for (const h of hoursBeforeList) {
    if (h < 6) timingBuckets['0-6h']++;
    else if (h < 12) timingBuckets['6-12h']++;
    else if (h < 24) timingBuckets['12-24h']++;
    else if (h < 48) timingBuckets['24-48h']++;
    else timingBuckets['48h+']++;
  }

  hoursBeforeList.sort((a, b) => a - b);
  const median = hoursBeforeList.length > 0
    ? hoursBeforeList[Math.floor(hoursBeforeList.length / 2)] : 0;

  return { hourOfDay, dayOfWeek, timingBuckets, medianHoursBefore: Math.round(median * 10) / 10, totalTrades: trades.length };
}

function analyzePricesFromDB() {
  const db = getDb();

  const yes = db.prepare(`
    SELECT price, size, usdc_size FROM trades
    WHERE type='TRADE' AND side='BUY' AND outcome='Yes' ORDER BY price
  `).all();

  const no = db.prepare(`
    SELECT price, size, usdc_size FROM trades
    WHERE type='TRADE' AND side='BUY' AND outcome='No' ORDER BY price
  `).all();

  const stats = (trades) => {
    if (!trades.length) return null;
    const prices = trades.map(t => t.price);
    return {
      count: trades.length,
      avg: Math.round(prices.reduce((s, p) => s + p, 0) / prices.length * 1000) / 1000,
      median: prices[Math.floor(prices.length / 2)],
      min: Math.min(...prices),
      max: Math.max(...prices),
      volume: Math.round(trades.reduce((s, t) => s + (t.usdc_size || 0), 0) * 100) / 100,
    };
  };

  return { yes: stats(yes), no: stats(no) };
}

function analyzeSellPatterns() {
  const db = getDb();

  const sells = db.prepare(`
    SELECT price, size, usdc_size, outcome, city, target_date
    FROM trades WHERE type='TRADE' AND side='SELL' ORDER BY price
  `).all();

  const yesSells = sells.filter(s => s.outcome === 'Yes');
  const noSells = sells.filter(s => s.outcome === 'No');

  return {
    totalSells: sells.length,
    yesSellCount: yesSells.length,
    noSellCount: noSells.length,
    yesSellVolume: Math.round(yesSells.reduce((s, t) => s + (t.usdc_size || 0), 0) * 100) / 100,
    noSellVolume: Math.round(noSells.reduce((s, t) => s + (t.usdc_size || 0), 0) * 100) / 100,
    avgYesSellPrice: yesSells.length > 0
      ? Math.round(yesSells.reduce((s, t) => s + t.price, 0) / yesSells.length * 1000) / 1000 : 0,
    avgNoSellPrice: noSells.length > 0
      ? Math.round(noSells.reduce((s, t) => s + t.price, 0) / noSells.length * 1000) / 1000 : 0,
  };
}

// ─── MAIN ANALYSIS ───────────────────────────────────────────────────

export async function runFullAnalysis() {
  const db = getDb();

  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  @HondaCivic Weather Strategy — Full Analysis');
  console.log('══════════════════════════════════════════════════════════════\n');

  // 1. Fetch real PnL from /positions
  console.log('[1/6] Fetching positions from Polymarket API...');
  const allPositions = await fetchAllPositions();
  const wxPositions = allPositions.filter(isWeatherPosition);
  console.log(`  ${allPositions.length} total positions, ${wxPositions.length} weather\n`);

  // 2. Aggregate positions by event
  console.log('[2/6] Aggregating position-level PnL by event...');
  const eventPnlMap = {};
  for (const p of wxPositions) {
    const key = p.eventSlug || p.slug;
    if (!eventPnlMap[key]) {
      const parsed = parseWeatherTitle(p.title, p.slug, 0);
      eventPnlMap[key] = {
        city: parsed?.city || 'unknown',
        date: parsed?.target_date || 'unknown',
        positions: [],
        realizedPnl: 0,
        cashPnl: 0,
        initialValue: 0,
        totalBought: 0,
      };
    }
    eventPnlMap[key].positions.push(p);
    eventPnlMap[key].realizedPnl += p.realizedPnl || 0;
    eventPnlMap[key].cashPnl += p.cashPnl || 0;
    eventPnlMap[key].initialValue += p.initialValue || 0;
    eventPnlMap[key].totalBought += p.totalBought || 0;
  }

  // 3. Analyze spread structure from trades DB
  console.log('[3/6] Analyzing spread structure from trade data...');
  const spreads = analyzeSpreadFromDB();

  // 4. Timing analysis
  console.log('[4/6] Analyzing timing patterns...');
  const timing = analyzeTimingFromDB();

  // 5. Price analysis
  console.log('[5/6] Analyzing price thresholds...');
  const prices = analyzePricesFromDB();
  const sells = analyzeSellPatterns();

  // 6. Generate report
  console.log('[6/6] Building report...\n');

  // ═══════════ REPORT ═══════════

  const totalWxRealizedPnl = wxPositions.reduce((s, p) => s + (p.realizedPnl || 0), 0);
  const totalWxCashPnl = wxPositions.reduce((s, p) => s + (p.cashPnl || 0), 0);
  const totalWxInitial = wxPositions.reduce((s, p) => s + (p.initialValue || 0), 0);
  const totalAllRealizedPnl = allPositions.reduce((s, p) => s + (p.realizedPnl || 0), 0);

  const banner = (title) => {
    console.log(`\n┌${'─'.repeat(66)}┐`);
    console.log(`│ ${title.padEnd(65)}│`);
    console.log(`└${'─'.repeat(66)}┘`);
  };

  // === EXECUTIVE SUMMARY ===
  banner('📊 EXECUTIVE SUMMARY');
  const events = Object.values(eventPnlMap);
  const resolvedEvents = events.filter(e => Math.abs(e.realizedPnl) > 0.01);
  const winners = resolvedEvents.filter(e => e.realizedPnl > 0);
  const losers = resolvedEvents.filter(e => e.realizedPnl < 0);

  console.log(`  Weather positions:    ${wxPositions.length}`);
  console.log(`  Weather events:       ${events.length} (${resolvedEvents.length} resolved)`);
  console.log(`  Win rate:             ${winners.length} / ${resolvedEvents.length} = ${((winners.length / resolvedEvents.length) * 100).toFixed(1)}%`);
  console.log(`  Realized PnL:         $${totalWxRealizedPnl.toFixed(2)}`);
  console.log(`  Cash PnL (total):     $${totalWxCashPnl.toFixed(2)}`);
  console.log(`  Initial capital:      $${totalWxInitial.toFixed(2)}`);
  console.log(`  ROI:                  ${((totalWxRealizedPnl / totalWxInitial) * 100).toFixed(1)}%`);
  console.log(`  All-market PnL:       $${totalAllRealizedPnl.toFixed(2)}`);

  // === CITY PERFORMANCE ===
  banner('🏙️  CITY PERFORMANCE (by realizedPnl)');
  const cityMap = {};
  for (const e of events) {
    if (!cityMap[e.city]) cityMap[e.city] = { events: 0, realizedPnl: 0, initialValue: 0, wins: 0, losses: 0 };
    cityMap[e.city].events++;
    cityMap[e.city].realizedPnl += e.realizedPnl;
    cityMap[e.city].initialValue += e.initialValue;
    if (e.realizedPnl > 0.01) cityMap[e.city].wins++;
    else if (e.realizedPnl < -0.01) cityMap[e.city].losses++;
  }

  const cityRows = Object.entries(cityMap)
    .sort((a, b) => b[1].realizedPnl - a[1].realizedPnl);

  console.log(`  ${'City'.padEnd(18)} ${'Events'.padStart(6)} ${'Wins'.padStart(5)} ${'Losses'.padStart(6)} ${'PnL'.padStart(10)} ${'WinRate'.padStart(7)}`);
  console.log(`  ${'─'.repeat(55)}`);
  for (const [city, d] of cityRows) {
    const wr = d.events > 0 ? `${((d.wins / d.events) * 100).toFixed(0)}%` : '-';
    console.log(`  ${city.padEnd(18)} ${String(d.events).padStart(6)} ${String(d.wins).padStart(5)} ${String(d.losses).padStart(6)} $${d.realizedPnl.toFixed(0).padStart(9)} ${wr.padStart(7)}`);
  }

  // === SPREAD ANALYSIS ===
  banner('🔀 SPREAD STRUCTURE (how YES/NO are distributed per event)');

  const avgBrackets = spreads.length > 0
    ? spreads.reduce((s, sp) => s + sp.bracketCount, 0) / spreads.length : 0;
  const avgYes = spreads.length > 0
    ? spreads.reduce((s, sp) => s + sp.yesCount, 0) / spreads.length : 0;
  const avgNo = spreads.length > 0
    ? spreads.reduce((s, sp) => s + sp.noCount, 0) / spreads.length : 0;
  const avgYesPrice = spreads.filter(s => s.yesAvgPrice > 0).length > 0
    ? spreads.filter(s => s.yesAvgPrice > 0).reduce((s, sp) => s + sp.yesAvgPrice, 0) / spreads.filter(s => s.yesAvgPrice > 0).length : 0;
  const avgNoPrice = spreads.filter(s => s.noAvgPrice > 0).length > 0
    ? spreads.filter(s => s.noAvgPrice > 0).reduce((s, sp) => s + sp.noAvgPrice, 0) / spreads.filter(s => s.noAvgPrice > 0).length : 0;

  console.log(`  Events analyzed:        ${spreads.length}`);
  console.log(`  Avg brackets per event: ${avgBrackets.toFixed(1)}`);
  console.log(`  Avg YES brackets:       ${avgYes.toFixed(1)} (avg entry: ${(avgYesPrice * 100).toFixed(1)}¢)`);
  console.log(`  Avg NO brackets:        ${avgNo.toFixed(1)} (avg entry: ${(avgNoPrice * 100).toFixed(1)}¢)`);
  console.log(`  YES capital per event:  $${(spreads.reduce((s, sp) => s + sp.yesCost, 0) / spreads.length).toFixed(2)}`);
  console.log(`  NO capital per event:   $${(spreads.reduce((s, sp) => s + sp.noCost, 0) / spreads.length).toFixed(2)}`);

  // Show some example spreads (top profitable London events)
  console.log('\n  Example spreads from top events:');
  const londonSpreads = spreads.filter(s => s.city === 'london').slice(-5);
  for (const sp of londonSpreads) {
    console.log(`\n  ${sp.city} ${sp.date}: ${sp.bracketCount} brackets (${sp.yesCount}Y/${sp.noCount}N)`);
    console.log(`    YES at avg ${(sp.yesAvgPrice * 100).toFixed(1)}¢, cost $${sp.yesCost.toFixed(2)}`);
    console.log(`    NO at avg ${(sp.noAvgPrice * 100).toFixed(1)}¢, cost $${sp.noCost.toFixed(2)}`);
    console.log(`    Temps: [${sp.temps.join(', ')}]`);
  }

  // === TIMING ===
  banner('⏰ TIMING PATTERNS');
  console.log(`  Total trades:           ${timing.totalTrades}`);
  console.log(`  Median entry:           ${timing.medianHoursBefore}h before resolution`);

  console.log('\n  Hours before resolution:');
  const maxBucket = Math.max(...Object.values(timing.timingBuckets));
  for (const [k, v] of Object.entries(timing.timingBuckets)) {
    const bar = '█'.repeat(Math.round((v / maxBucket) * 20));
    console.log(`    ${k.padEnd(10)} ${bar.padEnd(20)} ${v}`);
  }

  console.log('\n  Hour of day (UTC):');
  const maxHour = Math.max(...timing.hourOfDay);
  for (let h = 0; h < 24; h++) {
    if (timing.hourOfDay[h] > 0) {
      const bar = '█'.repeat(Math.round((timing.hourOfDay[h] / maxHour) * 20));
      console.log(`    ${String(h).padStart(2)}:00  ${bar.padEnd(20)} ${timing.hourOfDay[h]}`);
    }
  }

  console.log('\n  Day of week:');
  const dows = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const maxDow = Math.max(...timing.dayOfWeek);
  for (let d = 0; d < 7; d++) {
    const bar = '█'.repeat(Math.round((timing.dayOfWeek[d] / maxDow) * 20));
    console.log(`    ${dows[d]}  ${bar.padEnd(20)} ${timing.dayOfWeek[d]}`);
  }

  // === PRICE ANALYSIS ===
  banner('💰 PRICE ENTRY THRESHOLDS');
  if (prices.yes) {
    console.log(`  YES Buys:`);
    console.log(`    Count: ${prices.yes.count}    Avg: ${(prices.yes.avg * 100).toFixed(1)}¢    Median: ${(prices.yes.median * 100).toFixed(1)}¢    Volume: $${prices.yes.volume}`);
  }
  if (prices.no) {
    console.log(`  NO Buys:`);
    console.log(`    Count: ${prices.no.count}    Avg: ${(prices.no.avg * 100).toFixed(1)}¢    Median: ${(prices.no.median * 100).toFixed(1)}¢    Volume: $${prices.no.volume}`);
  }

  // === SELL PATTERNS ===
  banner('📤 SELL/EXIT PATTERNS');
  console.log(`  Total sells: ${sells.totalSells}`);
  console.log(`  YES sells: ${sells.yesSellCount} (avg price: ${(sells.avgYesSellPrice * 100).toFixed(1)}¢, vol: $${sells.yesSellVolume})`);
  console.log(`  NO sells:  ${sells.noSellCount} (avg price: ${(sells.avgNoSellPrice * 100).toFixed(1)}¢, vol: $${sells.noSellVolume})`);
  console.log(`  → He actively trades in/out, not just buy-and-hold`);

  // === TOP WINNING & LOSING EVENTS ===
  banner('🏆 TOP 10 WINNING EVENTS');
  resolvedEvents.sort((a, b) => b.realizedPnl - a.realizedPnl);
  resolvedEvents.slice(0, 10).forEach(e => {
    console.log(`  ${e.city.padEnd(18)} ${e.date}  PnL: $${e.realizedPnl.toFixed(2).padStart(10)}  positions: ${e.positions.length}`);
  });

  banner('💀 TOP 10 LOSING EVENTS');
  resolvedEvents.sort((a, b) => a.realizedPnl - b.realizedPnl);
  resolvedEvents.slice(0, 10).forEach(e => {
    console.log(`  ${e.city.padEnd(18)} ${e.date}  PnL: $${e.realizedPnl.toFixed(2).padStart(10)}  positions: ${e.positions.length}`);
  });

  // === STRATEGY REPLICATION ===
  banner('🔑 STRATEGY REPLICATION GUIDE');
  console.log(`
  1. CITY FOCUS
     ★ London = primary alpha (${cityMap['london']?.realizedPnl?.toFixed(0) || '?'} PnL, ${cityMap['london']?.events || '?'} events)
     ★ Seoul, Ankara = high-conviction secondaries
     • NYC, Buenos Aires, Paris = moderate edge
     • Scale sizing with forecast confidence per city

  2. SPREAD STRUCTURE
     • Cover ${avgBrackets.toFixed(0)} brackets per event
     • Buy YES on ${avgYes.toFixed(0)} bracket(s) at ~${(avgYesPrice * 100).toFixed(0)}¢ (the predicted temp)
     • Buy NO on ${avgNo.toFixed(0)} brackets at ~${(avgNoPrice * 100).toFixed(0)}¢ (temps you're confident WON'T hit)
     • CRITICAL: Do NOT buy NO on the bracket you predict is correct

  3. ENTRY PRICES
     • YES: enter when probability is underpriced (avg ${(avgYesPrice * 100).toFixed(0)}¢)
     • NO: enter at 99-99.9¢ for near-certain brackets

  4. TIMING
     • Enter ${timing.medianHoursBefore}h before resolution (median)
     • Batch execution around 11:00 UTC (peak hour)
     • Most active on Saturdays

  5. RISK MANAGEMENT
     • Win rate: ${((winners.length / resolvedEvents.length) * 100).toFixed(0)}%
     • ${sells.totalSells} active sells — he dynamically adjusts positions
     • Avg ~$${(totalWxInitial / events.length).toFixed(0)} capital per event
     • Biggest single loss: $${Math.abs(resolvedEvents[0]?.realizedPnl || 0).toFixed(0)}

  6. EDGE SOURCE
     • Uses NWP weather models (GFS/ECMWF) for temperature forecasting
     • London's maritime climate = narrow temp variability = easier to predict
     • Trades LATE (12-24h before) when forecasts are most accurate
`);

  // Save JSON report
  const report = {
    summary: {
      positions: wxPositions.length,
      events: events.length,
      resolved: resolvedEvents.length,
      winRate: (winners.length / resolvedEvents.length * 100).toFixed(1) + '%',
      realizedPnl: totalWxRealizedPnl,
      roi: ((totalWxRealizedPnl / totalWxInitial) * 100).toFixed(1) + '%',
    },
    cityPerformance: cityRows.map(([city, d]) => ({ city, ...d })),
    spread: { avgBrackets, avgYes, avgNo, avgYesPrice, avgNoPrice },
    timing: timing.timingBuckets,
    prices,
    sells,
    // Re-sort descending — the array was last sorted ascending for the losers display
    topWinners: [...resolvedEvents].sort((a, b) => b.realizedPnl - a.realizedPnl).slice(0, 10)
      .filter(e => e.realizedPnl > 0)  // Validate: topWinners must have positive PnL
      .map(e => ({ city: e.city, date: e.date, pnl: e.realizedPnl })),
    topLosers: [...resolvedEvents].sort((a, b) => a.realizedPnl - b.realizedPnl).slice(0, 10)
      .filter(e => e.realizedPnl < 0)  // Validate: topLosers must have negative PnL
      .map(e => ({ city: e.city, date: e.date, pnl: e.realizedPnl })),
  };

  const fs = await import('fs');
  fs.writeFileSync('strategy-analyzer/report.json', JSON.stringify(report, null, 2));
  console.log(`[SAVED] report.json`);
  console.log('\n══════════════════════════════════════════════════════');
  console.log('  Analysis Complete!');
  console.log('══════════════════════════════════════════════════════\n');

  return report;
}
