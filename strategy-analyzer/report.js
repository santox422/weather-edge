/**
 * Report generator for @HondaCivic strategy analysis.
 *
 * Produces rich terminal output + saves JSON report.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Formatting Helpers ───────────────────────────────────────────────

const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  white: '\x1b[37m',
  bgGreen: '\x1b[42m',
  bgRed: '\x1b[41m',
};

function money(v) {
  if (v == null || isNaN(v)) return '$0.00';
  const prefix = v >= 0 ? '+' : '';
  return `${prefix}$${Math.abs(v).toFixed(2)}`;
}

function moneyColor(v) {
  if (v >= 0) return `${C.green}${money(v)}${C.reset}`;
  return `${C.red}${money(v)}${C.reset}`;
}

function pct(v) { return `${v.toFixed(1)}%`; }
function bar(value, maxValue, width = 30) {
  const filled = Math.round((value / Math.max(maxValue, 1)) * width);
  return '█'.repeat(Math.min(filled, width)) + '░'.repeat(Math.max(width - filled, 0));
}

function line() { console.log('─'.repeat(70)); }
function header(title) {
  console.log(`\n${C.bold}${C.cyan}┌${'─'.repeat(68)}┐${C.reset}`);
  console.log(`${C.bold}${C.cyan}│${C.reset} ${C.bold}${title.padEnd(67)}${C.cyan}│${C.reset}`);
  console.log(`${C.bold}${C.cyan}└${'─'.repeat(68)}┘${C.reset}`);
}

// ─── Report Sections ──────────────────────────────────────────────────

function printExecutiveSummary(summary) {
  header('📊 EXECUTIVE SUMMARY');
  console.log(`
  ${C.bold}Total Events Traded:${C.reset}  ${summary.totalEvents}  (${summary.resolvedEvents} resolved, ${summary.openEvents} open)
  ${C.bold}Total Trades:${C.reset}         ${summary.totalTrades}
  ${C.bold}Date Range:${C.reset}           ${summary.dateRange.firstMarketDate} → ${summary.dateRange.lastMarketDate}
  ${C.bold}First Trade:${C.reset}          ${summary.dateRange.firstTradeTimestamp}
  ${C.bold}Last Trade:${C.reset}           ${summary.dateRange.lastTradeTimestamp}

  ${C.bold}Total Capital Deployed:${C.reset} ${C.yellow}$${Math.abs(summary.totalInvested).toFixed(2)}${C.reset}
  ${C.bold}Total Redeemed:${C.reset}        ${C.yellow}$${summary.totalRedeemed.toFixed(2)}${C.reset}
  ${C.bold}Realized P&L:${C.reset}          ${moneyColor(summary.totalPnl)}
  ${C.bold}ROI:${C.reset}                   ${summary.roi >= 0 ? C.green : C.red}${pct(summary.roi)}${C.reset}

  ${C.bold}Win Rate:${C.reset}              ${summary.winRate}% (${summary.winCount}W / ${summary.lossCount}L)
`);
}

function printCityPerformance(cities) {
  header('🏙️  CITY PERFORMANCE');
  if (!cities.length) { console.log('  No resolved city data'); return; }

  const maxInvested = Math.max(...cities.map(c => c.total_invested));
  console.log(`\n  ${'City'.padEnd(18)} ${'Events'.padEnd(8)} ${'PnL'.padEnd(14)} ${'ROI'.padEnd(10)} ${'Win Rate'.padEnd(10)} Volume`);
  line();

  for (const c of cities) {
    const cityName = (c.city || 'unknown').padEnd(18);
    const events = String(c.event_count).padEnd(8);
    const pnlStr = moneyColor(c.total_pnl).padEnd(14 + 9); // +9 for ANSI codes
    const roi = `${pct(c.roi)}`.padEnd(10);
    const wr = `${pct(c.winRate)}`.padEnd(10);
    const vol = `$${c.total_invested.toFixed(0)}`;
    console.log(`  ${cityName} ${events} ${pnlStr} ${roi} ${wr} ${vol}`);
  }
  console.log();
}

function printSpreadAnalysis(spreads) {
  header('🎯 SPREAD STRATEGY ANALYSIS');

  // Show a few representative examples
  const examples = spreads.slice(0, 8);
  for (const spread of examples) {
    console.log(`\n  ${C.bold}${spread.city}${C.reset} — ${spread.date}  |  PnL: ${moneyColor(spread.pnl)}  |  ROI: ${pct(spread.roi)}`);
    console.log(`  Invested: $${spread.totalInvested.toFixed(2)} → Redeemed: $${spread.totalRedeemed.toFixed(2)}`);
    console.log(`  Brackets: ${spread.bracketCount} total  |  ${C.green}${spread.yesCount} YES${C.reset}  |  ${C.red}${spread.noCount} NO${C.reset}`);

    if (spread.yesTemps.length > 0) {
      console.log(`  ${C.green}YES positions:${C.reset}`);
      for (const y of spread.yesTemps) {
        console.log(`    ${y.temp}°${y.unit}  →  ${y.trades} trades, ${y.size.toFixed(1)} shares @ avg ${y.avgPrice.toFixed(3)}, cost $${y.cost.toFixed(2)}`);
      }
    }
    if (spread.noTemps.length > 0) {
      console.log(`  ${C.red}NO positions:${C.reset}`);
      for (const n of spread.noTemps) {
        console.log(`    ${n.temp}°${n.unit}  →  ${n.trades} trades, ${n.size.toFixed(1)} shares @ avg ${n.avgPrice.toFixed(3)}, cost $${n.cost.toFixed(2)}`);
      }
    }
  }

  // Aggregate spread statistics
  if (spreads.length > 0) {
    const avgYes = spreads.reduce((s, sp) => s + sp.yesCount, 0) / spreads.length;
    const avgNo = spreads.reduce((s, sp) => s + sp.noCount, 0) / spreads.length;
    const avgBrackets = spreads.reduce((s, sp) => s + sp.bracketCount, 0) / spreads.length;

    console.log(`\n  ${C.bold}Spread Statistics (across ${spreads.length} resolved events):${C.reset}`);
    console.log(`    Avg brackets per event: ${avgBrackets.toFixed(1)}`);
    console.log(`    Avg YES brackets: ${avgYes.toFixed(1)}`);
    console.log(`    Avg NO brackets: ${avgNo.toFixed(1)}`);
    console.log(`    Ratio YES:NO = ${(avgYes / Math.max(avgNo, 0.01)).toFixed(2)}`);
  }
}

function printTimingAnalysis(timing) {
  header('⏰ TIMING ANALYSIS');

  console.log(`\n  ${C.bold}Total trades:${C.reset} ${timing.totalTrades}`);
  console.log(`  ${C.bold}Avg hours before resolution:${C.reset} ${timing.avgHoursBeforeResolution.toFixed(1)}h`);
  console.log(`  ${C.bold}Median hours before resolution:${C.reset} ${timing.medianHoursBeforeResolution.toFixed(1)}h`);

  // Timing bucket distribution
  console.log(`\n  ${C.bold}When does HondaCivic enter positions?${C.reset}`);
  const maxBucket = Math.max(...Object.values(timing.timingBuckets));
  for (const [label, count] of Object.entries(timing.timingBuckets)) {
    const pctVal = timing.totalTrades > 0 ? (count / timing.totalTrades * 100) : 0;
    console.log(`    ${label.padEnd(16)} ${bar(count, maxBucket, 25)} ${count} (${pctVal.toFixed(1)}%)`);
  }

  // Hour of day
  console.log(`\n  ${C.bold}Hour of day (UTC) distribution:${C.reset}`);
  const maxHour = Math.max(...timing.hourOfDayUTC);
  for (let h = 0; h < 24; h++) {
    const count = timing.hourOfDayUTC[h];
    if (count > 0) {
      console.log(`    ${String(h).padStart(2, '0')}:00  ${bar(count, maxHour, 20)} ${count}`);
    }
  }

  // Day of week
  console.log(`\n  ${C.bold}Day of week distribution:${C.reset}`);
  const maxDow = Math.max(...timing.dayOfWeek);
  for (let d = 0; d < 7; d++) {
    console.log(`    ${timing.dayOfWeekLabels[d]}  ${bar(timing.dayOfWeek[d], maxDow, 20)} ${timing.dayOfWeek[d]}`);
  }
}

function printPriceAnalysis(thresholds) {
  header('💰 PRICE THRESHOLD ANALYSIS');

  for (const [label, data] of [['YES', thresholds.yes], ['NO', thresholds.no]]) {
    if (!data) { console.log(`  ${label}: No data`); continue; }

    const color = label === 'YES' ? C.green : C.red;
    console.log(`\n  ${C.bold}${color}${label} Positions:${C.reset}`);
    console.log(`    Trades: ${data.count}`);
    console.log(`    Avg price: ${data.avgPrice.toFixed(4)} ($${(data.avgPrice * 100).toFixed(1)}¢)`);
    console.log(`    Volume-weighted avg: ${data.weightedAvgPrice.toFixed(4)}`);
    console.log(`    Median price: ${data.medianPrice.toFixed(4)}`);
    console.log(`    Range: ${data.minPrice.toFixed(4)} → ${data.maxPrice.toFixed(4)}`);
    console.log(`    Total volume: $${data.totalVolume.toFixed(2)}`);

    // Price distribution
    console.log(`    ${C.dim}Price distribution:${C.reset}`);
    const maxDist = Math.max(...Object.values(data.priceDistribution));
    const sortedBuckets = Object.entries(data.priceDistribution)
      .sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]));
    for (const [price, count] of sortedBuckets) {
      console.log(`      ${parseFloat(price).toFixed(2)}  ${bar(count, maxDist, 15)} ${count}`);
    }
  }
}

function printPositionSizing(sizing) {
  header('📐 POSITION SIZING');

  console.log(`\n  ${C.bold}Per-Trade:${C.reset}`);
  console.log(`    Average: $${sizing.avgTradeSize}`);
  console.log(`    Median:  $${sizing.medianTradeSize}`);
  console.log(`    Range:   $${sizing.minTradeSize} → $${sizing.maxTradeSize}`);

  console.log(`\n  ${C.bold}Per-Event (capital deployed):${C.reset}`);
  console.log(`    Average: $${sizing.avgEventCapital}`);

  if (sizing.topEventsByCapital.length > 0) {
    console.log(`\n  ${C.bold}Top 10 Events by Capital:${C.reset}`);
    for (const evt of sizing.topEventsByCapital) {
      console.log(`    ${(evt.city || '?').padEnd(16)} ${evt.target_date}  $${evt.total_invested.toFixed(0).padStart(8)}  PnL: ${moneyColor(evt.pnl)}`);
    }
  }
}

function printReplicationGuide(analysis) {
  header('🔑 STRATEGY REPLICATION PARAMETERS');

  const { summary, priceThresholds, timing, spreads, cityPerformance } = analysis;

  console.log(`
  Based on analysis of ${summary.resolvedEvents} resolved events:

  ${C.bold}1. POSITION STRUCTURE${C.reset}
     • Trade ${cityPerformance.length} cities simultaneously
     • Cover ~${spreads.length > 0 ? (spreads.reduce((s, sp) => s + sp.bracketCount, 0) / spreads.length).toFixed(0) : '?'} brackets per city/day event
     • Buy YES on ~${spreads.length > 0 ? (spreads.reduce((s, sp) => s + sp.yesCount, 0) / spreads.length).toFixed(1) : '?'} brackets (likely temperatures)
     • Buy NO on ~${spreads.length > 0 ? (spreads.reduce((s, sp) => s + sp.noCount, 0) / spreads.length).toFixed(1) : '?'} brackets (unlikely temperatures)

  ${C.bold}2. ENTRY PRICES${C.reset}
     • YES entries: avg ~${priceThresholds.yes ? (priceThresholds.yes.avgPrice * 100).toFixed(0) : '?'}¢ (range ${priceThresholds.yes ? (priceThresholds.yes.minPrice * 100).toFixed(0) : '?'}-${priceThresholds.yes ? (priceThresholds.yes.maxPrice * 100).toFixed(0) : '?'}¢)
     • NO entries: avg ~${priceThresholds.no ? (priceThresholds.no.avgPrice * 100).toFixed(0) : '?'}¢ (range ${priceThresholds.no ? (priceThresholds.no.minPrice * 100).toFixed(0) : '?'}-${priceThresholds.no ? (priceThresholds.no.maxPrice * 100).toFixed(0) : '?'}¢)

  ${C.bold}3. TIMING${C.reset}
     • Median entry: ${timing.medianHoursBeforeResolution.toFixed(0)}h before resolution
     • Most active window: ${Object.entries(timing.timingBuckets).sort((a, b) => b[1] - a[1])[0]?.[0] || 'N/A'}

  ${C.bold}4. CAPITAL ALLOCATION${C.reset}
     • Avg capital per event: ~$${analysis.sizing.avgEventCapital}
     • Avg trade size: ~$${analysis.sizing.avgTradeSize}

  ${C.bold}5. EXPECTED RETURNS${C.reset}
     • Overall ROI: ${pct(summary.roi)}
     • Win rate: ${pct(summary.winRate)}
`);
}

// ─── Main Report ──────────────────────────────────────────────────────

export function generateReport(analysis) {
  console.log('\n' + '═'.repeat(70));
  console.log(`${C.bold}${C.magenta}  @HondaCivic Weather Strategy — Full Analysis Report${C.reset}`);
  console.log(`${C.dim}  Wallet: 0x15ceffed7bf820cd2d90f90ea24ae9909f5cd5fa${C.reset}`);
  console.log(`${C.dim}  Generated: ${new Date().toISOString()}${C.reset}`);
  console.log('═'.repeat(70));

  printExecutiveSummary(analysis.summary);
  printCityPerformance(analysis.cityPerformance);
  printSpreadAnalysis(analysis.spreads);
  printTimingAnalysis(analysis.timing);
  printPriceAnalysis(analysis.priceThresholds);
  printPositionSizing(analysis.sizing);
  printReplicationGuide(analysis);

  // Save JSON report
  const reportPath = path.join(__dirname, 'report.json');
  fs.writeFileSync(reportPath, JSON.stringify(analysis, null, 2));
  console.log(`\n${C.green}[SAVED]${C.reset} Full report JSON → ${reportPath}`);

  console.log('\n' + '═'.repeat(70));
  console.log(`${C.bold}${C.magenta}  Analysis Complete!${C.reset}`);
  console.log('═'.repeat(70) + '\n');
}
