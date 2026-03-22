import { fetchCryptoAnalysis } from './crypto-view.js';
import { subscribeToTokens } from './websocket.js';
import { state } from '../main.js';

function $(id) { return document.getElementById(id); }

let cryptoMarkets = [];
let activeTokenId = null;

export async function loadCryptoMarkets() {
  const container = $('tab-crypto').querySelector('aside > div:nth-child(2)');
  container.className = 'flex-1 overflow-y-auto'; // Ensure it's not permanently centered
  container.innerHTML = '<div class="flex items-center justify-center py-8 h-full"><span class="text-[#ff8c00] text-[10px] font-bold animate-pulse">[SCANNING BITCOIN MARKETS...]</span></div>';
  
  try {
    const res = await fetch('/api/crypto/markets');
    cryptoMarkets = await res.json();
    
    // Subscribe to live Polymarket CLOB ticks for these specific items
    subscribeToTokens({ market: { outcomes: cryptoMarkets } });
    
    renderCryptoList();
  } catch (e) {
    container.innerHTML = '<div class="text-[9px] text-red-500 p-2">Failed to load crypto markets</div>';
  }
}

function renderCryptoList() {
  const container = $('tab-crypto').querySelector('aside > div:nth-child(2)');
  container.className = 'flex-1 overflow-y-auto'; // Strip horizontal/centering formatting from HTML placeholder
  container.innerHTML = '';
  
  if (cryptoMarkets.length === 0) {
    container.innerHTML = '<div class="text-[9px] text-[#555] p-2">No active Bitcoin markets found.</div>';
    return;
  }

  // Automatically select the first market if none is selected
  if (!activeTokenId && cryptoMarkets.length > 0) {
    activeTokenId = cryptoMarkets[0].tokenId;
    fetchCryptoAnalysis(cryptoMarkets[0]);
  }

  cryptoMarkets.forEach(m => {
    const div = document.createElement('div');
    // Attach 'data-token-id' required for websocket DOM manipulation
    div.className = `p-2 border-b border-[#111] cursor-pointer hover:bg-[#111] transition-colors ${activeTokenId === m.tokenId ? 'bg-[#111] border-l-2 border-l-[#ff8c00]' : 'border-l-2 border-l-transparent'}`;
    div.setAttribute('data-token-id', m.tokenId);
    
    // Fallback display formatting for markets lacking group titles
    let displayTitle = m.groupItemTitle || m.question;
    // Highlight "BTC", "Bitcoin", etc.
    displayTitle = displayTitle.replace(/Bitcoin|BTC/gi, '<span class="text-[#f7931a]">$&</span>');
    
    div.innerHTML = `
      <div class="text-[10px] text-[#ddd] font-bold leading-tight line-clamp-2 mb-1" title="${m.question}">${displayTitle}</div>
      <div class="flex justify-between items-center px-1">
        <div class="text-[9px] text-[#888]">Vol: $${Math.round(m.volume).toLocaleString()}</div>
        <div class="text-[10px] font-bold price-cell ${m.price > 0.5 ? 'text-[#00ff41]' : 'text-[#ff3333]'}">${(m.price * 100).toFixed(1)}¢</div>
      </div>
    `;
    
    div.addEventListener('click', () => {
      activeTokenId = m.tokenId;
      state.currentCryptoMarket = m;
      renderCryptoList(); // visually highlight active tab
      fetchCryptoAnalysis(m);
    });
    
    container.appendChild(div);
  });
}
