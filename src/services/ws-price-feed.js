/**
 * WebSocket Price Feed — connects to Polymarket CLOB WebSocket
 * and streams live price updates to browser clients.
 *
 * Polymarket WS endpoint: wss://ws-subscriptions-clob.polymarket.com/ws/market
 * No auth required for market data.
 * Requires PING heartbeat every 10s.
 */

import WebSocket from 'ws';

const CLOB_WS_URL = 'wss://ws-subscriptions-clob.polymarket.com/ws/market';
const HEARTBEAT_INTERVAL = 10000; // 10 seconds
const RECONNECT_BASE_DELAY = 2000;
const MAX_RECONNECT_DELAY = 30000;

export class PriceFeed {
  constructor() {
    this.ws = null;
    this.heartbeatTimer = null;
    this.reconnectAttempts = 0;
    this.subscribedTokens = new Map(); // tokenId → { name, conditionId }
    this.lastPrices = new Map(); // tokenId → price
    this.listeners = new Set(); // browser WS clients
    this.connected = false;
    this._destroyed = false;
  }

  /**
   * Subscribe to price updates for a set of market tokens.
   * @param {Array<{tokenId: string, name: string, conditionId: string}>} tokens
   */
  subscribe(tokens) {
    for (const t of tokens) {
      if (t.tokenId) {
        this.subscribedTokens.set(t.tokenId, { name: t.name, conditionId: t.conditionId });
      }
    }

    // If already connected, send subscription message
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this._sendSubscription();
    }
  }

  /**
   * Unsubscribe all tokens and clear state.
   */
  unsubscribeAll() {
    this.subscribedTokens.clear();
    this.lastPrices.clear();
  }

  /**
   * Add a browser WebSocket client to receive price updates.
   */
  addListener(ws) {
    this.listeners.add(ws);
    ws.on('close', () => this.listeners.delete(ws));

    // Send current prices immediately
    if (this.lastPrices.size > 0) {
      const snapshot = {};
      for (const [tokenId, price] of this.lastPrices) {
        const meta = this.subscribedTokens.get(tokenId);
        snapshot[tokenId] = { price, name: meta?.name || tokenId };
      }
      try {
        ws.send(JSON.stringify({ type: 'price_snapshot', prices: snapshot }));
      } catch {}
    }

    // Send connection status
    try {
      ws.send(JSON.stringify({ type: 'ws_status', connected: this.connected, tokens: this.subscribedTokens.size }));
    } catch {}
  }

  /**
   * Connect to Polymarket CLOB WebSocket.
   */
  connect() {
    if (this._destroyed) return;
    if (this.ws) {
      try { this.ws.close(); } catch {}
    }

    console.log('[WS] Connecting to Polymarket CLOB...');

    this.ws = new WebSocket(CLOB_WS_URL);

    this.ws.on('open', () => {
      console.log('[WS] Connected to Polymarket CLOB');
      this.connected = true;
      this.reconnectAttempts = 0;
      this._broadcast({ type: 'ws_status', connected: true, tokens: this.subscribedTokens.size });

      // Subscribe to tokens
      this._sendSubscription();

      // Start heartbeat
      this._startHeartbeat();
    });

    this.ws.on('message', (raw) => {
      try {
        const data = JSON.parse(raw.toString());
        this._handleMessage(data);
      } catch {}
    });

    this.ws.on('close', (code) => {
      console.log(`[WS] Disconnected (code: ${code})`);
      this.connected = false;
      this._stopHeartbeat();
      this._broadcast({ type: 'ws_status', connected: false });
      this._scheduleReconnect();
    });

    this.ws.on('error', (err) => {
      console.error('[WS] Error:', err.message);
    });
  }

  /**
   * Destroy the price feed — close connection, stop timers.
   */
  destroy() {
    this._destroyed = true;
    this._stopHeartbeat();
    if (this.ws) {
      try { this.ws.close(); } catch {}
    }
    this.listeners.clear();
  }

  // ─── Private ─────────────────────────────────────────────────

  _sendSubscription() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (this.subscribedTokens.size === 0) return;

    const assetIds = [...this.subscribedTokens.keys()];
    const msg = {
      type: 'market',
      assets_ids: assetIds,
      custom_feature_enabled: true, // enables best_bid_ask events
    };

    console.log(`[WS] Subscribing to ${assetIds.length} tokens`);
    this.ws.send(JSON.stringify(msg));
  }

  _handleMessage(data) {
    if (Array.isArray(data)) {
      for (const item of data) this._handleMessage(item);
      return;
    }

    const eventType = data.event_type || data.type;

    if (eventType === 'price_change') {
      if (Array.isArray(data.price_changes)) {
        for (const change of data.price_changes) this._handlePriceChangeItem(change);
      } else {
        // Fallback for isolated price_change object
        this._handlePriceChangeItem(data);
      }
    } else if (eventType === 'last_trade_price' || eventType === 'best_bid_ask') {
      this._handlePriceChangeItem(data);
    } else if (eventType === 'book') {
      this._handleBookSnapshot(data);
    }
  }

  _handlePriceChangeItem(item) {
    const tokenId = item.asset_id;
    if (!tokenId || !this.subscribedTokens.has(tokenId)) return;

    let price = NaN;
    const bid = item.best_bid !== undefined ? parseFloat(item.best_bid) : NaN;
    const ask = item.best_ask !== undefined ? parseFloat(item.best_ask) : NaN;

    if (item.price != null && item.price !== "") {
      price = parseFloat(item.price);
    } else if (!isNaN(bid) || !isNaN(ask)) {
      price = !isNaN(bid) && !isNaN(ask) ? (bid + ask) / 2 : (!isNaN(bid) ? bid : ask);
    }

    if (isNaN(price)) return;

    const prevPrice = this.lastPrices.get(tokenId) || price;
    this.lastPrices.set(tokenId, price);

    const meta = this.subscribedTokens.get(tokenId);
    this._broadcast({
      type: 'price_update',
      tokenId,
      name: meta?.name || '',
      price,
      prevPrice,
      bid: !isNaN(bid) ? bid : null,
      ask: !isNaN(ask) ? ask : null,
      change: price - prevPrice,
      timestamp: item.timestamp || Date.now(),
    });
  }

  _handleBookSnapshot(data) {
    // Extract the first bid/ask from a book snapshot
    const tokenId = data.asset_id;
    if (!tokenId || !this.subscribedTokens.has(tokenId)) return;

    const bids = data.bids || [];
    const asks = data.asks || [];
    const bestBid = bids.length > 0 ? parseFloat(bids[0].price) : NaN;
    const bestAsk = asks.length > 0 ? parseFloat(asks[0].price) : NaN;

    if (!isNaN(bestBid) || !isNaN(bestAsk)) {
      const price = !isNaN(bestBid) && !isNaN(bestAsk) ? (bestBid + bestAsk) / 2 :
                    !isNaN(bestBid) ? bestBid : bestAsk;
      this.lastPrices.set(tokenId, price);

      const meta = this.subscribedTokens.get(tokenId);
      this._broadcast({
        type: 'price_update',
        tokenId,
        name: meta?.name || '',
        price,
        prevPrice: price, // initial snapshot, no change yet
        bid: !isNaN(bestBid) ? bestBid : null,
        ask: !isNaN(bestAsk) ? bestAsk : null,
        change: 0,
        timestamp: Date.now(),
      });
    }
  }

  _broadcast(msg) {
    const payload = JSON.stringify(msg);
    for (const client of this.listeners) {
      if (client.readyState === WebSocket.OPEN) {
        try { client.send(payload); } catch {}
      }
    }
  }

  /**
   * Allows external modules to inject arbitrary payloads into the broadcast stream.
   * Useful for multiplexing data (e.g., Binance OFI ticks) over the same socket.
   */
  broadcastMessage(msg) {
    this._broadcast(msg);
  }

  _startHeartbeat() {
    this._stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.ping();
      }
    }, HEARTBEAT_INTERVAL);
  }

  _stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  _scheduleReconnect() {
    if (this._destroyed) return;
    const delay = Math.min(
      RECONNECT_BASE_DELAY * Math.pow(2, this.reconnectAttempts),
      MAX_RECONNECT_DELAY
    );
    this.reconnectAttempts++;
    console.log(`[WS] Reconnecting in ${delay / 1000}s (attempt ${this.reconnectAttempts})...`);
    setTimeout(() => this.connect(), delay);
  }
}
