// @ts-nocheck
import { NextResponse } from 'next/server';
import { getCityMarkets, getCityMarketsMultiDay } from '@/lib/services/polymarket-service.js';
import { analyzeMarket } from '@/lib/analysis/analysis-engine.js';

const cache = new Map();
const TTL = 90_000;
function cached(k: string) { const e = cache.get(k); return e && Date.now() - e.ts < TTL ? e.data : null; }
function setCache(k: string, d: any) { cache.set(k, { data: d, ts: Date.now() }); }

export async function GET(request: Request, { params }: { params: Promise<{ slug: string[] }> }) {
  const segments = (await params).slug;
  const citySlug = segments[0];
  const dateStr = segments[1]; // optional
  
  try {
    if (dateStr) {
      // /api/analyze/:citySlug/:dateStr
      const { searchParams } = new URL(request.url);
      const fresh = searchParams.get('fresh') === '1';
      const cacheKey = `analysis_${citySlug}_${dateStr}`;
      const c = fresh ? null : cached(cacheKey);
      if (c) return NextResponse.json(c);

      let multiData = cached('cities_multi_14');
      if (!multiData) {
        multiData = await getCityMarketsMultiDay(14);
        setCache('cities_multi_14', multiData);
      }

      const city = multiData.cities.find(c => c.slug === citySlug);
      if (!city) return NextResponse.json({ error: 'City not found' }, { status: 404 });

      const am = city.marketsByDate?.[dateStr];
      console.log(`[ANALYZE] ${city.name} for ${dateStr}...`);

      const market = {
        ...(am || {}),
        title: am?.title || `Highest temperature in ${city.name} on ${dateStr}`,
        city: citySlug,
        marketType: 'temperature',
        threshold: am?.thresholds?.[0]?.value || null,
        unit: am?.thresholds?.[0]?.unit || 'F',
        endDate: am?.endDate || new Date(dateStr + 'T23:59:59Z').toISOString(),
        polymarketUrl: am?.polymarketUrl || `https://polymarket.com/event/highest-temperature-in-${citySlug}-on-${dateStr}`,
      };

      const analysis = await analyzeMarket(market);
      const result = { ...analysis, cityInfo: city, targetDate: dateStr };
      setCache(cacheKey, result);
      return NextResponse.json(result);
    } else {
      // /api/analyze/:citySlug (today)
      const c = cached(`analysis_${citySlug}`);
      if (c) return NextResponse.json(c);

      let cities = cached('cities');
      if (!cities) {
        cities = await getCityMarkets();
        setCache('cities', cities);
      }

      const city = cities.find(c => c.slug === citySlug);
      if (!city) return NextResponse.json({ error: 'City not found' }, { status: 404 });

      console.log(`[ANALYZE] ${city.name}...`);
      const am = city.activeMarket;
      const market = {
        ...(am || {}),
        title: am?.title || `Highest temperature in ${city.name}`,
        city: citySlug,
        marketType: 'temperature',
        threshold: am?.thresholds?.[0]?.value || null,
        unit: am?.thresholds?.[0]?.unit || 'F',
        endDate: am?.endDate || new Date().toISOString(),
        polymarketUrl: city.polymarketUrl,
      };

      const analysis = await analyzeMarket(market);
      const result = { ...analysis, cityInfo: city };
      setCache(`analysis_${citySlug}`, result);
      return NextResponse.json(result);
    }
  } catch (err) {
    console.error('[ERROR] Analysis:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
