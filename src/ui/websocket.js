/**
 * WebSocket client for live Polymarket CLOB prices.
 */
import { state } from '../main.js';
import { $, esc } from './helpers.js';
import { computeEdgeScore } from '../analysis/edge-scoring.js';
import { computeTradingStrategy } from '../analysis/trading-strategy.js';
import { renderAnalysis } from './analysis-view.js';
import { fetchCryptoAnalysis } from './crypto-view.js';

let _recalcTimer = null;
let _recalcCryptoTimer = null;
const RECALC_DEBOUNCE_MS = 2000;

export function connectWebSocket() {
  const wsUrl = `ws://${window.location.hostname}:3001/ws`;
  console.log('[WS] Connecting to', wsUrl);
  updateWsStatus('connecting');

  try {
    state.priceFeedWs = new WebSocket(wsUrl);
  } catch (e) {
    console.error('[WS] Failed to connect:', e);
    updateWsStatus('offline');
    setTimeout(connectWebSocket, 5000);
    return;
  }

  state.priceFeedWs.onopen = () => {
    console.log('[WS] Connected');
    updateWsStatus('online');
    if (state.lastAnalysisData) subscribeToTokens(state.lastAnalysisData);
  };

  state.priceFeedWs.onmessage = (event) => {
    try { handleWsMessage(JSON.parse(event.data)); } catch {}
  };

  state.priceFeedWs.onclose = () => {
    console.log('[WS] Disconnected');
    updateWsStatus('offline');
    setTimeout(connectWebSocket, 3000);
  };

  state.priceFeedWs.onerror = () => updateWsStatus('offline');
}

function updateWsStatus(status) {
  const dot = $('ws-dot');
  const label = $('ws-label');
  const tickerDot = $('ticker-dot');
  if (!dot) return;
  dot.className = 'ws-dot ' + status;
  label.textContent = status === 'online' ? 'LIVE' : status === 'connecting' ? 'CONNECTING' : 'WS OFF';
  label.style.color = status === 'online' ? '#00ff41' : '#555';
  if (tickerDot) tickerDot.className = 'ws-live-dot' + (status === 'online' ? ' active' : '');
}

export function subscribeToTokens(data) {
  if (!state.priceFeedWs || state.priceFeedWs.readyState !== WebSocket.OPEN) return;
  const outcomes = data.market?.outcomes || [];
  const tokens = outcomes.filter((o) => o.tokenId).map((o) => ({
    tokenId: o.tokenId,
    name: o.name || o.title,
    conditionId: o.conditionId,
  }));
  if (tokens.length > 0) {
    state.priceFeedWs.send(JSON.stringify({ type: 'subscribe', tokens }));
    for (const t of tokens) state.tokenMap.set(t.tokenId, { name: t.name, price: null });
  }
}

function handleWsMessage(msg) {
  if (msg.type === 'price_update') {
    handleLivePriceUpdate(msg);
  } else if (msg.type === 'price_snapshot') {
    for (const [tokenId, data] of Object.entries(msg.prices)) {
      state.tokenMap.set(tokenId, { name: data.name, price: data.price });
    }
  } else if (msg.type === 'ws_status') {
    updateWsStatus(msg.connected ? 'online' : 'offline');
  } else if (msg.type === 'ofi_update') {
    handleOFIUpdate(msg);
  }
}

function handleOFIUpdate(msg) {
  const { ofi } = msg;

  const placeholder = $('ofi-placeholder');
  const container = $('ofi-container');
  const valueEl = $('ofi-value');
  const barBid = $('ofi-bar-bid');
  const barAsk = $('ofi-bar-ask');
  
  if (placeholder) placeholder.style.display = 'none';
  if (container) container.style.display = 'flex';
  
  if (valueEl) {
    valueEl.textContent = (ofi > 0 ? '+' : '') + ofi.toFixed(3);
    valueEl.className = `text-[12px] font-black ${ofi > 0 ? 'text-[#00ff41]' : 'text-[#ff3333]'}`;
  }
  
  if (barBid && barAsk) {
    // OFI ranges from -1 to 1. 0 = exactly 50/50 balanced depth.
    // +1 means 100% Bids. -1 means 100% Asks.
    let bidPct = ((ofi + 1) / 2) * 100;
    // clamp just in case of bizarre floating math
    if (bidPct < 0) bidPct = 0;
    if (bidPct > 100) bidPct = 100;
    
    const askPct = 100 - bidPct;
    barBid.style.width = `${bidPct}%`;
    barAsk.style.width = `${askPct}%`;
  }
}

function handleLivePriceUpdate(msg) {
  const { tokenId, name, price, change, bid, ask } = msg;
  state.tokenMap.set(tokenId, { name, price });

  const priceCell = document.querySelector(`[data-token-id="${tokenId}"] .price-cell`);
  if (priceCell) {
    const newMkt = (price * 100).toFixed(0);
    if (priceCell.textContent !== `${newMkt}¢`) {
      priceCell.textContent = `${newMkt}¢`;
      priceCell.classList.remove('price-up', 'price-down');
      void priceCell.offsetWidth;
      priceCell.classList.add(change >= 0 ? 'price-up' : 'price-down');
    }
  }

  addTickerItem(name, price, change, bid, ask);

  // Weather tab recalculation logic
  if (state.lastAnalysisData) {
    updateEdgeFromLivePrice(tokenId, price);
  }
}

function addTickerItem(name, price, change, bid, ask) {
  const feed = $('ticker-feed');
  if (!feed) return;

  const placeholder = feed.querySelector('.ticker-placeholder');
  if (placeholder) placeholder.remove();

  const changeClass = change >= 0 ? 'up' : 'down';
  const changeStr = change >= 0 ? `+${(change * 100).toFixed(1)}` : (change * 100).toFixed(1);
  const time = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const spreadStr = bid != null && ask != null ? ` B:${(bid*100).toFixed(0)} A:${(ask*100).toFixed(0)}` : '';

  const item = document.createElement('div');
  item.className = 'flex items-center justify-between py-[2px] border-b border-[#111] text-[9px]';
  item.innerHTML = `
    <span class="text-[#888] truncate max-w-[100px]">${esc(name?.substring(0, 20) || '—')}</span>
    <span class="c-white font-semibold">${(price * 100).toFixed(1)}¢</span>
    <span class="${changeClass === 'up' ? 'c-green' : 'c-red'} text-[8px]">${changeStr}¢${spreadStr}</span>
    <span class="text-[#333] text-[7px]">${time}</span>
  `;

  feed.insertBefore(item, feed.firstChild);
  while (feed.children.length > 50) feed.removeChild(feed.lastChild);
}

function updateEdgeFromLivePrice(tokenId, newPrice) {
  const data = state.lastAnalysisData;
  const bp = data?.edge?.bracketProbabilities;
  if (!bp) return;

  const outcomes = data.market?.outcomes || [];
  const outcome = outcomes.find((o) => o.tokenId === tokenId);
  if (!outcome) return;

  const bracket = bp.find((b) => b.name === outcome.name || b.title === outcome.title);
  if (!bracket) return;

  // Update the bracket's market price in the outcomes array too
  bracket.marketPrice = newPrice;
  bracket.edge = bracket.forecastProb - newPrice;
  outcome.price = newPrice;

  // Immediately update the UI cell for this bracket
  const row = document.querySelector(`[data-token-id="${tokenId}"]`);
  if (row) {
    const edgeCell = row.querySelector('.edge-cell');
    if (edgeCell) {
      const edgVal = (bracket.edge * 100).toFixed(1);
      edgeCell.textContent = `${bracket.edge > 0 ? '+' : ''}${edgVal}%`;
      edgeCell.className = `t-cell mono edge-cell ${bracket.edge > 0 ? 'c-green' : bracket.edge < 0 ? 'c-red' : 'c-muted'}`;
    }
  }

  // ── Debounced full recalculation ──
  // Recalculate edge signal + trading strategy from updated prices.
  // Debounced to avoid thrashing on rapid price ticks.
  scheduleRecalculation();
}

function scheduleRecalculation() {
  if (_recalcTimer) clearTimeout(_recalcTimer);
  _recalcTimer = setTimeout(() => {
    _recalcTimer = null;
    recalculateFromLivePrices();
  }, RECALC_DEBOUNCE_MS);
}

function recalculateFromLivePrices() {
  const data = state.lastAnalysisData;
  if (!data) return;

  try {
    // Recompute edge score with updated bracket market prices
    const newEdge = computeEdgeScore(data);
    data.edge = newEdge;

    // Recompute trading strategy with new edge
    const newStrategy = computeTradingStrategy(data);
    data.strategy = newStrategy;

    // Re-render only price-dependent panels (hero signal, outcomes, strategy)
    // Skip static weather panels (ensemble chart, models, history, atmospheric, etc.)
    renderAnalysis(data, data.city, data.market, { priceUpdateOnly: true });

    console.log('[WS] Recalculated strategy from live prices. Win: ' +
      (newStrategy?.summary?.winProbability || '--') + '%, Signal: ' + (newEdge?.signal || '--'));
  } catch (err) {
    console.error('[WS] Recalculation error:', err);
  }
}

