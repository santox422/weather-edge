/**
 * Custom server — boots Next.js + Express + WebSocket on a single port.
 * Handles all API routes through Next.js App Router while providing
 * WebSocket support for live Polymarket CLOB price updates.
 */

import { createServer } from 'http';
import { parse } from 'url';
import next from 'next';
import { WebSocketServer } from 'ws';
// @ts-ignore — JS module
import { PriceFeed } from './src/lib/services/ws-price-feed.js';
// @ts-ignore — JS module
import { startBinanceWS } from './src/lib/services/crypto-ws.js';

const dev = process.env.NODE_ENV !== 'production';
const hostname = '0.0.0.0';
const port = parseInt(process.env.PORT || '3001', 10);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url!, true);
    handle(req, res, parsedUrl);
  });

  // ── WebSocket Server — only handle /ws path ──
  const wss = new WebSocketServer({ noServer: true });
  const priceFeed = new PriceFeed();
  priceFeed.connect();

  // Binance L2 Orderbook WS → pipe OFI ticks to browser clients
  startBinanceWS((ofi: number) => {
    priceFeed.broadcastMessage({ type: 'ofi_update', ofi, timestamp: Date.now() });
  });

  // Handle upgrade manually: /ws → our WS, everything else → Next.js HMR
  server.on('upgrade', (req, socket, head) => {
    const { pathname } = parse(req.url!, true);
    if (pathname === '/ws') {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
    } else {
      // Let Next.js handle HMR WebSocket upgrades (/_next/webpack-hmr)
      // The Next.js app handle will deal with this via its own upgrade handler
      if (dev) {
        // In dev mode, Next.js internal server handles HMR upgrades automatically
        // through the app's getUpgradeHandler — we just don't intercept it
        const upgradeHandler = (app as any).getUpgradeHandler?.();
        if (upgradeHandler) {
          upgradeHandler(req, socket, head);
        }
      }
    }
  });

  // Handle browser WS connections
  wss.on('connection', (ws: any) => {
    console.log('[WS] Browser client connected');
    priceFeed.addListener(ws);

    ws.on('message', (raw: any) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'subscribe' && Array.isArray(msg.tokens)) {
          priceFeed.subscribe(msg.tokens);
        }
      } catch {}
    });

    ws.on('close', () => {
      console.log('[WS] Browser client disconnected');
    });
  });

  // Make WS state available to API routes via global
  (globalThis as any).__wss = wss;
  (globalThis as any).__priceFeed = priceFeed;

  server.listen(port, () => {
    console.log(`\n[Weather Edge] http://localhost:${port}`);
    console.log(`[WebSocket] ws://${hostname}:${port}/ws`);
    console.log(`[Mode] ${dev ? 'development' : 'production'}\n`);
  });
});
