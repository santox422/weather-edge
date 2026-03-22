/**
 * Express server — serves weather trading cities,
 * their active Polymarket markets, forecast analysis,
 * and live WebSocket price updates from the CLOB.
 */

import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { getCityMarkets, getCityMarketsMultiDay, HONDA_CITIES } from './src/services/polymarket-service.js';
import { analyzeMarket, getSignalLogs } from './src/analysis/analysis-engine.js';
import { getForecast, getEnsemble, getHistorical, getHistoricalBaseRate, getAtmosphericData, getAirQuality, getForecastTrajectory, getStationBias } from './src/services/weather-service.js';
import { getBitcoinMarkets } from './src/services/crypto-service.js';
import { extractCryptoFeatures, deriveProbability, evaluateCryptoTrade } from './src/analysis/crypto-engine.js';
import { PriceFeed } from './src/services/ws-price-feed.js';
import { startBinanceWS } from './src/services/crypto-ws.js';

const app = express();
const PORT = process.env.PORT || 3001;

// Serve built Vite frontend in production
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
app.use(express.static(join(__dirname, 'dist')));

app.use(cors());
app.use(express.json());

// ─── HTTP Server + WebSocket ──────────────────────────────────────────
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
const priceFeed = new PriceFeed();

// Connect to Polymarket CLOB WS
priceFeed.connect();

// Connect to Binance L2 Orderbook WS & pipe ticks to clients
startBinanceWS((ofi) => {
  priceFeed.broadcastMessage({ type: 'ofi_update', ofi, timestamp: Date.now() });
});

// Handle browser WS connections
wss.on('connection', (ws) => {
  console.log('[WS] Browser client connected');
  priceFeed.addListener(ws);

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());

      // Browser can request subscription for specific tokens
      if (msg.type === 'subscribe' && Array.isArray(msg.tokens)) {
        priceFeed.subscribe(msg.tokens);
      }
    } catch {}
  });

  ws.on('close', () => {
    console.log('[WS] Browser client disconnected');
  });
});

// ─── Cache ────────────────────────────────────────────────────────────────
const cache = new Map();
const CACHE_TTL = 90 * 1000; // 90 seconds — keep prices fresh

function cached(key) {
  const e = cache.get(key);
  if (e && Date.now() - e.ts < CACHE_TTL) return e.data;
  return null;
}
function setCache(key, data) { cache.set(key, { data, ts: Date.now() }); }

// ─── Routes ───────────────────────────────────────────────────────────────

/** GET /api/cities — 16 cities + their active Polymarket markets */
app.get('/api/cities', async (req, res) => {
  try {
    const c = cached('cities');
    if (c) return res.json(c);

    console.log('[INFO] Fetching city markets...');
    const cities = await getCityMarkets();
    console.log(`[OK] ${cities.filter((c) => c.activeMarket).length}/${cities.length} cities have active markets`);

    setCache('cities', cities);
    res.json(cities);
  } catch (err) {
    console.error('[ERROR]', err);
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/cities-multiday — All cities x next 14 days of markets */
app.get('/api/cities-multiday', async (req, res) => {
  try {
    const days = parseInt(req.query.days || '14');
    const key = `cities_multi_${days}`;
    const c = cached(key);
    if (c) return res.json(c);

    console.log(`[INFO] Fetching multi-day markets (${days} days)...`);
    const data = await getCityMarketsMultiDay(days);
    console.log('[OK] Multi-day scan complete');

    setCache(key, data);
    res.json(data);
  } catch (err) {
    console.error('[ERROR] Multi-day:', err);
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/analyze/:citySlug — Run forecast analysis for a city's active market (today) */
app.get('/api/analyze/:citySlug', async (req, res) => {
  try {
    const { citySlug } = req.params;
    const c = cached(`analysis_${citySlug}`);
    if (c) return res.json(c);

    let cities = cached('cities');
    if (!cities) {
      cities = await getCityMarkets();
      setCache('cities', cities);
    }

    const city = cities.find((c) => c.slug === citySlug);
    if (!city) return res.status(404).json({ error: 'City not found' });

    console.log(`[ANALYZE] ${city.name}...`);

    const am = city.activeMarket;
    const market = {
      ...(am || {}),
      title: am?.title || `Highest temperature in ${city.name}`,
      city: city.slug,
      marketType: 'temperature',
      threshold: am?.thresholds?.[0]?.value || null,
      unit: am?.thresholds?.[0]?.unit || 'F',
      endDate: am?.endDate || new Date().toISOString(),
      polymarketUrl: city.polymarketUrl,
    };

    const analysis = await analyzeMarket(market);
    const result = { ...analysis, cityInfo: city };

    setCache(`analysis_${citySlug}`, result);
    res.json(result);
  } catch (err) {
    console.error('[ERROR] Analysis:', err);
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/analyze/:citySlug/:dateStr — Run analysis for a city on a specific date */
app.get('/api/analyze/:citySlug/:dateStr', async (req, res) => {
  try {
    const { citySlug, dateStr } = req.params;
    const cacheKey = `analysis_${citySlug}_${dateStr}`;
    const fresh = req.query.fresh === '1';
    const c = fresh ? null : cached(cacheKey);
    if (c) return res.json(c);

    let multiData = cached('cities_multi_14');
    if (!multiData) {
      multiData = await getCityMarketsMultiDay(14);
      setCache('cities_multi_14', multiData);
    }

    const city = multiData.cities.find((c) => c.slug === citySlug);
    if (!city) return res.status(404).json({ error: 'City not found' });

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
    res.json(result);
  } catch (err) {
    console.error('[ERROR] Analysis:', err);
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/forecast/:lat/:lon */
app.get('/api/forecast/:lat/:lon', async (req, res) => {
  try {
    const { lat, lon } = req.params;
    const days = parseInt(req.query.days || '7');
    const key = `f_${lat}_${lon}_${days}`;
    const c = cached(key);
    if (c) return res.json(c);
    const data = await getForecast(parseFloat(lat), parseFloat(lon), days);
    setCache(key, data);
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/** GET /api/ensemble/:lat/:lon */
app.get('/api/ensemble/:lat/:lon', async (req, res) => {
  try {
    const { lat, lon } = req.params;
    const key = `e_${lat}_${lon}`;
    const c = cached(key);
    if (c) return res.json(c);
    const data = await getEnsemble(parseFloat(lat), parseFloat(lon));
    setCache(key, data);
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/** GET /api/atmospheric/:lat/:lon */
app.get('/api/atmospheric/:lat/:lon', async (req, res) => {
  try {
    const { lat, lon } = req.params;
    const days = parseInt(req.query.days || '3');
    const key = `atm_${lat}_${lon}_${days}`;
    const c = cached(key);
    if (c) return res.json(c);
    const data = await getAtmosphericData(parseFloat(lat), parseFloat(lon), days);
    setCache(key, data);
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/** GET /api/airquality/:lat/:lon */
app.get('/api/airquality/:lat/:lon', async (req, res) => {
  try {
    const { lat, lon } = req.params;
    const key = `aq_${lat}_${lon}`;
    const c = cached(key);
    if (c) return res.json(c);
    const data = await getAirQuality(parseFloat(lat), parseFloat(lon));
    setCache(key, data);
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/** GET /api/historical/:lat/:lon */
app.get('/api/historical/:lat/:lon', async (req, res) => {
  try {
    const { lat, lon } = req.params;
    const { start, end } = req.query;
    if (!start || !end) return res.status(400).json({ error: 'start/end required' });
    const key = `h_${lat}_${lon}_${start}_${end}`;
    const c = cached(key);
    if (c) return res.json(c);
    const data = await getHistorical(parseFloat(lat), parseFloat(lon), start, end);
    setCache(key, data);
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/** GET /api/baserate/:lat/:lon */
app.get('/api/baserate/:lat/:lon', async (req, res) => {
  try {
    const { lat, lon } = req.params;
    const month = parseInt(req.query.month || new Date().getMonth() + 1);
    const day = parseInt(req.query.day || new Date().getDate());
    const key = `b_${lat}_${lon}_${month}_${day}`;
    const c = cached(key);
    if (c) return res.json(c);
    const data = await getHistoricalBaseRate(parseFloat(lat), parseFloat(lon), month, day);
    setCache(key, data);
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/** GET /api/signals — Backtesting signal logs */
app.get('/api/signals', (req, res) => {
  try {
    const days = parseInt(req.query.days || '7');
    const logs = getSignalLogs(days);
    res.json({ count: logs.length, signals: logs });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/** GET /api/crypto/markets — BTC Up/Down Watchlist */
app.get('/api/crypto/markets', async (req, res) => {
  try {
    const c = cached('crypto_markets');
    if (c) return res.json(c);
    console.log('[CRYPTO] Fetching BTC Polymarket events...');
    const markets = await getBitcoinMarkets();
    setCache('crypto_markets', markets);
    res.json(markets);
  } catch (err) {
    console.error('[CRYPTO] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/crypto/analyze/:tokenId — Feature extraction and Probability engine */
app.get('/api/crypto/analyze/:tokenId', async (req, res) => {
  try {
    const { tokenId } = req.params;
    const cacheKey = `crypto_analyze_${tokenId}`;
    const c = cached(cacheKey);
    if (c) return res.json(c);
    
    // We pass market conditions via query to calculate exact execution spread EV
    const priceCents = parseFloat(req.query.price || 50);
    const targetIsAbove = req.query.above !== 'false';

    const features = await extractCryptoFeatures();
    const probability = deriveProbability(features, targetIsAbove);
    const evaluation = evaluateCryptoTrade(probability, priceCents);

    const result = { features, probability, evaluation };
    
    // Cache for 30 seconds since 1m candles update relatively frequently 
    setCache(cacheKey, result);
    res.json(result);
  } catch (err) {
    console.error('[CRYPTO] Engine Error:', err);
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/ws-status — WebSocket connection health */
app.get('/api/ws-status', (req, res) => {
  res.json({
    connected: priceFeed.connected,
    subscribedTokens: priceFeed.subscribedTokens.size,
    browserClients: wss.clients.size,
    lastPricesCount: priceFeed.lastPrices.size,
  });
});

// SPA catch-all — serve index.html for any non-API route
app.get('*', (req, res) => {
  res.sendFile(join(__dirname, 'dist', 'index.html'));
});

// Use server.listen instead of app.listen for WebSocket support
server.listen(PORT, () => {
  console.log(`\n[Weather Edge] Running on port ${PORT}`);
  console.log(`[WebSocket] ws://0.0.0.0:${PORT}/ws`);
  console.log(`[Cities] ${HONDA_CITIES.length}: ${HONDA_CITIES.map((c) => c.name).join(', ')}\n`);
});
