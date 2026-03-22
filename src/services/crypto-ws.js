import WebSocket from 'ws';

const BINANCE_WS_URL = 'wss://stream.binance.com:9443/ws/btcusdt@depth10@100ms';

let currentOFI = 0;
let ws = null;
let reconnectTimer = null;

/**
 * Starts the Binance Level-2 Orderbook WebSocket.
 * Computes Order Flow Imbalance (OFI) 10x per second.
 * @param {Function} onTick Callback fired whenever a new OFI is calculated
 */
export function startBinanceWS(onTick) {
  if (ws) return;
  console.log('[CRYPTO-WS] Connecting to Binance L2 Orderbook...');

  ws = new WebSocket(BINANCE_WS_URL);

  ws.on('open', () => {
    console.log('[CRYPTO-WS] Connected to Binance Depth Stream.');
    if (reconnectTimer) clearTimeout(reconnectTimer);
  });

  ws.on('message', (data) => {
    try {
      const payload = JSON.parse(data.toString());
      if (!payload.bids || !payload.asks) return;

      const totalBids = payload.bids.reduce((sum, level) => sum + parseFloat(level[1]), 0);
      const totalAsks = payload.asks.reduce((sum, level) => sum + parseFloat(level[1]), 0);

      const totalDepth = totalBids + totalAsks;
      if (totalDepth > 0) {
        currentOFI = (totalBids - totalAsks) / totalDepth;
        if (onTick) {
          onTick(currentOFI);
        }
      }
    } catch (err) {
      // Ignore parse errors on high frequency ticks
    }
  });

  ws.on('close', () => {
    console.log('[CRYPTO-WS] Binance WS Disconnected. Reconnecting in 3s...');
    ws = null;
    reconnectTimer = setTimeout(() => startBinanceWS(onTick), 3000);
  });

  ws.on('error', (err) => {
    console.error('[CRYPTO-WS] Error:', err.message);
  });
}

/**
 * Returns the latest synchronous snapshot of the Order Flow Imbalance.
 */
export function getCurrentOFI() {
  return currentOFI;
}
