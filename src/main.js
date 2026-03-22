/**
 * WEATHER EDGE — Bloomberg Terminal Frontend
 * Entry point: global state, imports, and DOMContentLoaded init.
 */
import './style.css';
import { $ } from './ui/helpers.js';
import { initTooltips } from './ui/tooltip.js';
import { connectWebSocket } from './ui/websocket.js';
import { loadMultiDay, refreshAnalysis } from './ui/city-list.js';
import { loadCryptoMarkets } from './ui/crypto-list.js';

// ─── Shared state ─────────────────────────────────────────────
export const state = {
  multiDayData: null,
  selectedDate: null,
  currentAnalysis: null,
  lastAnalysisData: null,
  currentCryptoMarket: null, // Track active crypto tab item
  ensembleChart: null,
  historyChart: null,
  priceFeedWs: null,
  tokenMap: new Map(),
};

// ─── Init ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  $('btn-refresh').addEventListener('click', () => {
    loadMultiDay();
    if (state.currentAnalysis) refreshAnalysis();
  });
  
  // Tab Switcher Logic
  let isCryptoLoaded = false;

  $('tab-btn-weather').addEventListener('click', () => {
    $('tab-weather').style.display = 'grid';
    $('tab-crypto').style.display = 'none';
    $('tab-btn-weather').className = 'px-4 flex items-center h-full border-b-2 border-[#ff8c00] text-[#ff8c00] hover:bg-[#111] transition-colors';
    $('tab-btn-crypto').className = 'px-4 flex items-center h-full border-b-2 border-transparent text-[#555] hover:text-[#ccc] hover:bg-[#111] transition-colors';
  });
  
  $('tab-btn-crypto').addEventListener('click', () => {
    $('tab-crypto').style.display = 'grid';
    $('tab-weather').style.display = 'none';
    $('tab-btn-crypto').className = 'px-4 flex items-center h-full border-b-2 border-[#ff8c00] text-[#ff8c00] hover:bg-[#111] transition-colors';
    $('tab-btn-weather').className = 'px-4 flex items-center h-full border-b-2 border-transparent text-[#555] hover:text-[#ccc] hover:bg-[#111] transition-colors';
    
    if (!isCryptoLoaded) {
      loadCryptoMarkets();
      isCryptoLoaded = true;
    }
  });

  loadMultiDay();
  connectWebSocket();
  initTooltips();

  // ── Mobile sidebar toggle ──────────────────────────────────
  const sidebar = $('col-left');
  const overlay = $('mobile-overlay');
  const openSidebar = () => { sidebar.classList.add('open'); overlay.classList.remove('hidden'); };
  const closeSidebar = () => { sidebar.classList.remove('open'); overlay.classList.add('hidden'); };

  $('btn-mobile-menu').addEventListener('click', openSidebar);
  $('btn-close-sidebar').addEventListener('click', closeSidebar);
  overlay.addEventListener('click', closeSidebar);

  // Auto-close sidebar when a city is tapped on mobile
  $('city-list').addEventListener('click', (e) => {
    if (e.target.closest('.city-row') && window.innerWidth < 768) closeSidebar();
  });

  setInterval(() => { if (state.currentAnalysis) refreshAnalysis(); }, 120000);
});
