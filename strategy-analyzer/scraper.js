/**
 * Polymarket Data API scraper for @HondaCivic weather trades.
 *
 * Uses DAILY time windows to ensure complete data capture.
 * For each day from account creation to now, fetches ALL activity
 * with offset pagination within that day. This avoids the API's
 * offset limit (~3400) and prevents record skipping at boundaries.
 */

import { getDb, insertTrade, setMeta, getMeta } from './db.js';

const WALLET = '0x15ceffed7bf820cd2d90f90ea24ae9909f5cd5fa';
const DATA_API = 'https://data-api.polymarket.com';
const PAGE_SIZE = 500;
const RATE_LIMIT_MS = 300;
const ACCOUNT_CREATED = new Date('2026-01-29');

// ─── Title Parser ─────────────────────────────────────────────────────

export function parseWeatherTitle(title, slug, timestamp) {
  slug = slug || '';
  title = title || '';

  // Handle "or higher" slug variant
  const slugOrHigher = slug.match(
    /highest-temperature-in-(.+?)-on-([a-z]+)-(\d+)-(\d{4})-(\d+)([cf])orhigher/i
  );
  if (slugOrHigher) {
    const [, citySlug, month, day, year, temp, unit] = slugOrHigher;
    const monthNum = monthToNum(month);
    if (!monthNum) return null;
    return {
      city: citySlug.replace(/-/g, ' '),
      target_date: `${year}-${monthNum}-${day.padStart(2, '0')}`,
      temperature: parseInt(temp),
      temp_high: 999,
      unit: unit.toUpperCase(),
    };
  }

  // Standard slug: highest-temperature-in-{city}-on-{month}-{day}-{year}-{temp}(-{temp2})?{unit}
  const slugMatch = slug.match(
    /highest-temperature-in-(.+?)-on-([a-z]+)-(\d+)-(\d{4})-(\d+)(?:-(\d+))?([cf])/i
  );
  if (slugMatch) {
    const [, citySlug, month, day, year, tempLow, tempHigh, unit] = slugMatch;
    const monthNum = monthToNum(month);
    if (!monthNum) return null;
    return {
      city: citySlug.replace(/-/g, ' '),
      target_date: `${year}-${monthNum}-${day.padStart(2, '0')}`,
      temperature: parseInt(tempLow),
      temp_high: tempHigh ? parseInt(tempHigh) : null,
      unit: unit.toUpperCase(),
    };
  }

  // Fallback: parse from title
  const titleMatch = title.match(
    /temperature in (.+?) be (?:between )?(\d+)(?:[°]?[CF])?(?:\s*-\s*(\d+))?[°]?([CF])\s+(?:or higher\s+)?on\s+(\w+)\s+(\d+)/i
  );
  if (titleMatch) {
    const [, city, tempLow, tempHigh, unit, monthName, day] = titleMatch;
    const date = new Date(timestamp * 1000);
    const year = date.getFullYear();
    // Reject dates before 2024 — prevents epoch-derived dates like "1970-02-01"
    // when timestamp is 0 or otherwise invalid
    if (year < 2024) return null;
    const monthNum = monthToNum(monthName);
    if (!monthNum) return null;
    const isOrHigher = title.toLowerCase().includes('or higher');
    return {
      city: city.toLowerCase(),
      target_date: `${year}-${monthNum}-${day.padStart(2, '0')}`,
      temperature: parseInt(tempLow),
      temp_high: isOrHigher ? 999 : (tempHigh ? parseInt(tempHigh) : null),
      unit: unit.toUpperCase(),
    };
  }

  return null;
}

function monthToNum(name) {
  const m = {
    january: '01', february: '02', march: '03', april: '04',
    may: '05', june: '06', july: '07', august: '08',
    september: '09', october: '10', november: '11', december: '12'
  };
  return m[name.toLowerCase()] || null;
}

function isWeatherTrade(record) {
  const t = (record.title || '').toLowerCase();
  const s = (record.slug || '').toLowerCase();
  return t.includes('temperature') || s.includes('temperature');
}

// ─── Scraper ──────────────────────────────────────────────────────────

async function fetchPage(startTs, endTs, offset) {
  const url = `${DATA_API}/activity?user=${WALLET}&limit=${PAGE_SIZE}&offset=${offset}&start=${startTs}&end=${endTs}`;
  const res = await fetch(url);
  if (!res.ok) {
    if (res.status === 400) return null; // offset limit
    throw new Error(`API error ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function daysBetween(start, end) {
  const days = [];
  const d = new Date(start);
  while (d <= end) {
    days.push(new Date(d));
    d.setDate(d.getDate() + 1);
  }
  return days;
}

export async function scrapeAll(options = {}) {
  const db = getDb();
  const { force = false } = options;

  const lastScrape = getMeta(db, 'last_scrape');
  if (lastScrape && !force) {
    const tradeCount = db.prepare('SELECT COUNT(*) as c FROM trades').get().c;
    console.log(`[SCRAPER] DB already has ${tradeCount} trades (last scrape: ${lastScrape})`);
    console.log('[SCRAPER] Use --force to re-scrape');
    return { totalFetched: 0, weatherTrades: 0, skipped: true };
  }

  const today = new Date();
  today.setHours(23, 59, 59, 999);
  const days = daysBetween(ACCOUNT_CREATED, today);

  console.log(`[SCRAPER] Starting daily-window scrape for wallet ${WALLET}`);
  console.log(`[SCRAPER] Date range: ${days[0].toISOString().slice(0,10)} → ${days[days.length-1].toISOString().slice(0,10)} (${days.length} days)\n`);

  let totalFetched = 0;
  let weatherCount = 0;
  let nonWeatherCount = 0;
  let duplicateCount = 0;

  const insertMany = db.transaction((records) => {
    for (const record of records) {
      if (!isWeatherTrade(record)) {
        nonWeatherCount++;
        continue;
      }

      const parsed = parseWeatherTitle(record.title, record.slug, record.timestamp);
      if (!parsed) {
        continue; // silently skip unparseable
      }

      const trade = {
        timestamp: record.timestamp,
        type: record.type || 'TRADE',
        condition_id: record.conditionId || '',
        event_slug: record.eventSlug || '',
        title: record.title || '',
        side: record.side || null,
        outcome: record.outcome || null,
        outcome_index: record.outcomeIndex ?? null,
        price: record.price ?? null,
        size: record.size ?? null,
        usdc_size: record.usdcSize ?? null,
        transaction_hash: record.transactionHash || `gen_${record.timestamp}_${Math.random().toString(36).slice(2)}`,
        asset: record.asset || null,
        city: parsed.city,
        target_date: parsed.target_date,
        temperature: parsed.temperature,
        temp_high: parsed.temp_high,
        unit: parsed.unit,
      };

      const result = insertTrade(db, trade);
      if (result.changes > 0) {
        weatherCount++;
      } else {
        duplicateCount++;
      }
    }
  });

  for (let i = 0; i < days.length; i++) {
    const dayStart = new Date(days[i]);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(days[i]);
    dayEnd.setHours(23, 59, 59, 999);

    const startTs = Math.floor(dayStart.getTime() / 1000);
    const endTs = Math.floor(dayEnd.getTime() / 1000);
    const dateLabel = dayStart.toISOString().slice(0, 10);

    let dayFetched = 0;
    let offset = 0;

    while (true) {
      let records;
      try {
        records = await fetchPage(startTs, endTs, offset);
      } catch (err) {
        console.error(`  [ERROR] ${dateLabel} offset=${offset}: ${err.message}`);
        await sleep(2000);
        try {
          records = await fetchPage(startTs, endTs, offset);
        } catch (_) {
          break;
        }
      }

      if (!records || records.length === 0) break;

      dayFetched += records.length;
      totalFetched += records.length;
      insertMany(records);

      if (records.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
      await sleep(RATE_LIMIT_MS);
    }

    if (dayFetched > 0) {
      process.stdout.write(`  ${dateLabel}: ${dayFetched} records (weather: ${weatherCount} total)\n`);
    }

    // Small delay between days
    if (dayFetched > 0) await sleep(RATE_LIMIT_MS);
  }

  setMeta(db, 'last_scrape', new Date().toISOString());
  setMeta(db, 'total_fetched', String(totalFetched));
  setMeta(db, 'weather_trades', String(weatherCount));

  console.log(`\n[SCRAPER] Complete!`);
  console.log(`  Total API records fetched: ${totalFetched}`);
  console.log(`  Weather trades stored: ${weatherCount}`);
  console.log(`  Non-weather skipped: ${nonWeatherCount}`);
  console.log(`  Duplicates skipped: ${duplicateCount}`);

  return { totalFetched, weatherTrades: weatherCount, nonWeatherCount, duplicateCount, skipped: false };
}
