/**
 * Polymarket Service — finds weather markets for tracked cities.
 *
 * Fetches market structure from Gamma API, then gets LIVE prices
 * from the CLOB (order book) API for accurate trading data.
 *
 * Polymarket slug pattern: "highest-temperature-in-{city}-on-{month}-{day}-{year}"
 */

const GAMMA_API = 'https://gamma-api.polymarket.com';
const CLOB_API = 'https://clob.polymarket.com';

const MONTHS = ['january','february','march','april','may','june','july','august','september','october','november','december'];

// Tracked 16 trading cities
export const HONDA_CITIES = [
  { name: 'Ankara',         slug: 'ankara',       country: 'TR' },
  { name: 'Atlanta',        slug: 'atlanta',      country: 'US' },
  { name: 'Buenos Aires',   slug: 'buenos-aires', country: 'AR' },
  { name: 'Chicago',        slug: 'chicago',      country: 'US' },
  { name: 'Dallas',         slug: 'dallas',       country: 'US' },
  { name: 'London',         slug: 'london',       country: 'GB' },
  { name: 'Miami',          slug: 'miami',        country: 'US' },
  { name: 'Milan',          slug: 'milan',        country: 'IT' },
  { name: 'Munich',         slug: 'munich',       country: 'DE' },
  { name: 'New York City',  slug: 'nyc',          country: 'US' },
  { name: 'Paris',          slug: 'paris',        country: 'FR' },
  { name: 'Sao Paulo',      slug: 'sao-paulo',    country: 'BR' },
  { name: 'Seattle',        slug: 'seattle',      country: 'US' },
  { name: 'Seoul',          slug: 'seoul',        country: 'KR' },
  { name: 'Toronto',        slug: 'toronto',      country: 'CA' },
  { name: 'Wellington',     slug: 'wellington',   country: 'NZ' },
];

/**
 * Build the Polymarket event slug for a city + date.
 */
function buildEventSlug(citySlug, date) {
  const month = MONTHS[date.getMonth()];
  const day = date.getDate();
  const year = date.getFullYear();
  return `highest-temperature-in-${citySlug}-on-${month}-${day}-${year}`;
}

/**
 * Fetch live price from CLOB API for a single token
 */
async function fetchClobPrice(tokenId) {
  try {
    const res = await fetch(`${CLOB_API}/price?token_id=${tokenId}&side=buy`);
    if (!res.ok) return null;
    const data = await res.json();
    return parseFloat(data.price) || null;
  } catch {
    return null;
  }
}

/**
 * Fetch live prices for multiple tokens in parallel
 */
async function fetchClobPrices(tokenIds) {
  const results = await Promise.allSettled(
    tokenIds.map((id) => fetchClobPrice(id))
  );
  return results.map((r) => r.status === 'fulfilled' ? r.value : null);
}

/**
 * Get markets for all cities.
 */
export async function getCityMarkets() {
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  console.log(`[SCAN] Fetching markets for ${HONDA_CITIES.length} cities...`);

  const results = await Promise.all(
    HONDA_CITIES.map(async (city) => {
      const todaySlug = buildEventSlug(city.slug, today);
      const tomorrowSlug = buildEventSlug(city.slug, tomorrow);

      let market = await fetchMarketBySlug(todaySlug);
      let slug = todaySlug;

      if (!market) {
        market = await fetchMarketBySlug(tomorrowSlug);
        slug = tomorrowSlug;
      }

      const polymarketUrl = `https://polymarket.com/event/${slug}`;

      if (market) {
        return { ...city, activeMarket: market, polymarketUrl, hasApiData: true };
      }

      return {
        ...city,
        activeMarket: null,
        polymarketUrl: `https://polymarket.com/event/${todaySlug}`,
        tomorrowUrl: `https://polymarket.com/event/${tomorrowSlug}`,
        hasApiData: false,
      };
    })
  );

  const found = results.filter((r) => r.hasApiData).length;
  console.log(`[OK] ${found}/${HONDA_CITIES.length} cities have confirmed markets`);

  return results;
}

/**
 * Fetch a weather event by its slug using the Gamma /events endpoint,
 * then enrich with LIVE prices from the CLOB API.
 */
async function fetchMarketBySlug(eventSlug) {
  try {
    const res = await fetch(`${GAMMA_API}/events?slug=${eventSlug}`);
    if (!res.ok) return null;

    const events = await res.json();
    if (!Array.isArray(events) || events.length === 0) return null;

    const event = events[0];
    const markets = event.markets || [];
    if (markets.length === 0) return null;

    // Only keep temperature-related market outcomes
    const tempMarkets = markets.filter((m) => {
      const q = (m.question || '').toLowerCase();
      return q.includes('temperature') || q.includes('°f') || q.includes('°c');
    });

    if (tempMarkets.length === 0) return null;

    // Collect all YES token IDs for CLOB price fetching
    const tokenIds = [];
    const marketData = [];

    for (const m of tempMarkets) {
      const threshold = extractThreshold(m.question);
      const clobTokenIds = safeJSON(m.clobTokenIds, []);
      const yesTokenId = clobTokenIds[0] || null;

      tokenIds.push(yesTokenId);
      marketData.push({ m, threshold, yesTokenId });
    }

    // Fetch ALL live prices from CLOB in parallel
    const livePrices = await fetchClobPrices(tokenIds);

    const outcomes = [];
    const thresholds = [];

    for (let i = 0; i < marketData.length; i++) {
      const { m, threshold, yesTokenId } = marketData[i];
      const livePrice = livePrices[i];

      // Use CLOB live price, fallback to Gamma outcomePrices
      let price;
      if (livePrice != null) {
        price = livePrice;
      } else {
        const outcomePrices = safeJSON(m.outcomePrices, []);
        price = parseFloat(outcomePrices[0]) || 0;
      }

      outcomes.push({
        name: m.groupItemTitle || m.question,
        title: m.question,
        conditionId: m.conditionId,
        tokenId: yesTokenId,
        price,
        noPrice: 1 - price,
        threshold,
        volume: parseFloat(m.volumeNum || 0),
        closed: m.closed,
      });

      if (threshold) thresholds.push(threshold);
    }

    return {
      eventSlug,
      title: event.title,
      endDate: event.endDate || tempMarkets[0]?.endDate,
      polymarketUrl: `https://polymarket.com/event/${eventSlug}`,
      outcomes,
      thresholds,
    };
  } catch (err) {
    return null;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────

export function extractThreshold(title) {
  if (!title) return null;

  const rangeMatch = title.match(/between\s+(\d+)[-–](\d+)\s*°\s*(F|C)/i);
  if (rangeMatch) return { value: parseInt(rangeMatch[1]), high: parseInt(rangeMatch[2]), unit: rangeMatch[3].toUpperCase(), type: 'range' };

  const belowMatch = title.match(/(\d+)\s*°\s*(C|F)\s+or\s+below/i);
  if (belowMatch) return { value: parseInt(belowMatch[1]), unit: belowMatch[2].toUpperCase(), type: 'below' };

  const aboveMatch = title.match(/(\d+)\s*°\s*(C|F)\s+or\s+(?:higher|above)/i);
  if (aboveMatch) return { value: parseInt(aboveMatch[1]), unit: aboveMatch[2].toUpperCase(), type: 'above' };

  const exactMatch = title.match(/be\s+(\d+)\s*°\s*(C|F)/i);
  if (exactMatch) return { value: parseInt(exactMatch[1]), unit: exactMatch[2].toUpperCase(), type: 'exact' };

  // Handle range like "74-75°F"
  const dashRange = title.match(/(\d+)-(\d+)\s*°\s*(F|C)/i);
  if (dashRange) return { value: parseInt(dashRange[1]), high: parseInt(dashRange[2]), unit: dashRange[3].toUpperCase(), type: 'range' };

  return null;
}

function safeJSON(val, fallback) {
  if (Array.isArray(val)) return val;
  try { return JSON.parse(val); } catch { return fallback; }
}

/**
 * Get markets for all cities across multiple future days.
 */
export async function getCityMarketsMultiDay(daysAhead = 14) {
  const dates = [];
  const today = new Date();
  for (let i = -1; i <= daysAhead; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    dates.push(d);
  }
  const dateStrings = dates.map((d) => d.toISOString().split('T')[0]);

  console.log(`[SCAN] Multi-day: ${HONDA_CITIES.length} cities x ${dates.length} days (${dateStrings[0]} -> ${dateStrings[dateStrings.length - 1]})...`);

  const results = await Promise.all(
    HONDA_CITIES.map(async (city) => {
      const marketsByDate = {};
      const dayResults = await Promise.all(
        dates.map(async (date) => {
          const slug = buildEventSlug(city.slug, date);
          const market = await fetchMarketBySlug(slug);
          return { dateStr: date.toISOString().split('T')[0], market, slug };
        })
      );
      for (const { dateStr, market, slug } of dayResults) {
        marketsByDate[dateStr] = market
          ? { ...market, polymarketUrl: `https://polymarket.com/event/${slug}` }
          : null;
      }
      return { ...city, marketsByDate };
    })
  );

  const totalMarkets = results.reduce((sum, c) => sum + Object.values(c.marketsByDate).filter(Boolean).length, 0);
  console.log(`[OK] Found ${totalMarkets} total markets across all cities/dates`);

  return { dates: dateStrings, cities: results };
}
