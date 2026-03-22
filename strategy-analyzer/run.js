/**
 * @HondaCivic Weather Strategy Analyzer — Main Entry Point
 *
 * Usage:
 *   node strategy-analyzer/run.js           # Full pipeline (scrape → analyze → report)
 *   node strategy-analyzer/run.js --force   # Force re-scrape even if DB exists
 *   node strategy-analyzer/run.js --skip    # Skip scraping, just re-analyze
 */

import { scrapeAll } from './scraper.js';
import { runFullAnalysis } from './analyzer.js';
import { closeDb } from './db.js';

const args = process.argv.slice(2);
const force = args.includes('--force');
const skipScrape = args.includes('--skip');

async function main() {
  try {
    console.log('╔══════════════════════════════════════════════════════╗');
    console.log('║  @HondaCivic Weather Strategy Analyzer              ║');
    console.log('║  Polymarket Weather Markets — Full Strategy Scan    ║');
    console.log('╚══════════════════════════════════════════════════════╝\n');

    // Step 1: Scrape trade data from /activity
    if (!skipScrape) {
      console.log('━━━ Step 1: Data Collection (trades) ━━━━━━━━━━━━━━━━━');
      const result = await scrapeAll({ force });
      if (!result.skipped) {
        console.log(`\n  ✓ Scraped ${result.weatherTrades} weather trades\n`);
      }
    } else {
      console.log('━━━ Step 1: Skipped (--skip flag) ━━━━━━━━━━━━━━━━━━━');
    }

    // Step 2: Full analysis (trades DB + positions API for real PnL)
    console.log('\n━━━ Step 2: Full Strategy Analysis ━━━━━━━━━━━━━━━━━━━');
    await runFullAnalysis();

  } catch (err) {
    console.error('\n[FATAL ERROR]', err);
    process.exit(1);
  } finally {
    closeDb();
  }
}

main();
