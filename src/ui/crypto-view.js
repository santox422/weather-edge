/**
 * Renders the ML Bitcoin Feature Analysis
 */

function $(id) { return document.getElementById(id); }

export async function fetchCryptoAnalysis(market) {
  const centerCol = $('tab-crypto').querySelector('section');
  centerCol.innerHTML = `
    <div class="flex flex-col items-center justify-center h-full gap-2 text-center">
      <span class="text-[14px] text-[#ff8c00] font-bold tracking-[0.2em] uppercase animate-pulse">EXTRACTING 1M FEATURES...</span>
      <span class="text-[9px] text-[#555]">Calculating EMA Spreads, Supertrend, and Volatility...</span>
    </div>
  `;
  
  try {
    const targetIsAbove = market.question.toLowerCase().includes('above') || market.question.toLowerCase().includes('higher') || market.question.toLowerCase().includes('up');
    const res = await fetch(`/api/crypto/analyze/${market.tokenId}?price=${market.price * 100}&above=${targetIsAbove}`);
    
    if (!res.ok) throw new Error('Failed to fetch analysis');
    
    const data = await res.json();
    renderCryptoAnalysis(market, data);
  } catch (e) {
    centerCol.innerHTML = '<div class="text-red-500 text-[10px]">Analysis Error: Check Backend Terminal</div>';
  }
}

export function renderCryptoAnalysis(market, data) {
  const centerCol = $('tab-crypto').querySelector('section');
  const { features, probability, evaluation } = data;
  
  centerCol.innerHTML = `
    <div class="flex flex-col gap-[1px] w-full h-full justify-start p-[1px]">
      
      <!-- HERO SIGNAL -->
      <div class="bg-[#050505] p-3">
        <div class="flex items-center justify-between border-b border-[#222] pb-2 mb-2">
            <div class="text-[9px] font-bold text-[#f7931a] uppercase tracking-widest bg-[#f7931a22] px-2 py-1 rounded-sm">XGBoost 5M ENGINE</div>
            <a href="${market.polymarketUrl}" target="_blank" class="text-[9px] text-[#555] hover:text-white tracking-wider uppercase">Open in Polymarket ↗</a>
        </div>
        <div class="text-[10px] text-[#888] mb-1 truncate">${market.title}</div>
        <div class="text-[14px] font-bold text-white mb-3">${market.question}</div>
        
        <div class="flex justify-between items-end border border-[#222] bg-black p-3 mx-1">
           <div>
             <div class="text-[9px] text-[#555] tracking-widest uppercase mb-1" data-tip="Model Probability / Edge">FORECAST PROB</div>
             <div class="text-[20px] font-bold ${(probability/100) > market.price ? 'text-[#00ff41]' : 'text-[#ff3333]'}">${(probability).toFixed(1)}% <span class="text-[10px] text-[#555] tracking-wider ml-1 border border-[#333] px-1 py-[1px]">MKT ${(market.price * 100).toFixed(1)}¢</span></div>
           </div>
           <div class="text-right">
             <div class="text-[9px] text-[#555] tracking-widest uppercase mb-1">Execution Signal</div>
             <div class="text-[16px] font-black tracking-wider ${
               evaluation.signal.includes('BUY') ? 'text-[#00ff41]' : 
               evaluation.signal === 'PRICED_IN' ? 'text-[#ff8c00]' : 'text-[#ff3333]'
             }">${evaluation.signal}</div>
           </div>
        </div>
        
        <div class="text-[10px] mt-3 mx-1 text-[#aaa] border-l-2 ${evaluation.signal.includes('BUY') ? 'border-[#00ff41]' : 'border-[#444]'} bg-[#111] p-2 leading-relaxed h-[40px] flex items-center">
            ${evaluation.executionReasoning}
        </div>
      </div>

      <!-- FEATURE MATRIX -->
      <div class="grid grid-cols-2 gap-[1px]">
        <div class="bg-[#050505] p-3">
           <div class="text-[9px] font-bold text-[#ff8c00] uppercase tracking-[0.15em] mb-3 border-b border-[#1a1a1a] pb-1">1M Trend Features</div>
           <div class="flex justify-between items-center mb-1.5"><span class="text-[9px] text-[#888]">Binance Last Price</span> <span class="text-[11px] font-bold text-[#f7931a]">$${features.rawPrice.toFixed(2)}</span></div>
           <div class="flex justify-between items-center mb-1.5"><span class="text-[9px] text-[#888]">8 EMA</span> <span class="text-[10px] text-white">${features.ema8.toFixed(2)}</span></div>
           <div class="flex justify-between items-center mb-1.5"><span class="text-[9px] text-[#888]">55 EMA</span> <span class="text-[10px] text-white">${features.ema55.toFixed(2)}</span></div>
           <div class="flex justify-between items-center"><span class="text-[9px] text-[#888]">Spread (8/55)</span> <span class="text-[10px] font-bold ${features.emaSpreadPct > 0 ? 'text-[#00ff41]' : 'text-[#ff3333]'}">${features.emaSpreadPct > 0 ? '+' : ''}${(features.emaSpreadPct).toFixed(3)}%</span></div>
        </div>
        <div class="bg-[#050505] p-3">
           <div class="text-[9px] font-bold text-[#ff8c00] uppercase tracking-[0.15em] mb-3 border-b border-[#1a1a1a] pb-1">Volatility Features</div>
           <div class="flex justify-between items-center mb-1.5"><span class="text-[9px] text-[#888]">Deribit BTC-DVOL</span> <span class="text-[10px] text-white">${features.dvol.toFixed(2)}</span></div>
           <div class="flex justify-between items-center mb-1.5"><span class="text-[9px] text-[#888]">DVOL Percentile</span> <span class="text-[10px] text-white">${features.dvolPercentile}th</span></div>
           <div class="flex justify-between items-center"><span class="text-[9px] text-[#888]">Regime</span> <span class="text-[9px] px-1 py-[1px] font-bold border ${features.dvolPercentile > 70 ? 'text-[#ff3333] border-[#ff333344] bg-[#ff333311]' : 'text-[#aa55ff] border-[#aa55ff44] bg-[#aa55ff11]'}">${features.dvolPercentile > 70 ? 'HIGH VOLATILITY' : 'RANGE BOUND'}</span></div>
        </div>
      </div>
      
      <!-- EXPLANATION BLOCK -->
      <div class="bg-[#050505] p-3 flex-1 flex flex-col pt-4">
        <div class="text-[9px] font-bold text-[#f7931a] uppercase tracking-[0.15em] mb-2 border-b border-[#1a1a1a] pb-1">XGBoost Structural Analysis & Boundaries</div>
        <p class="text-[9px] text-[#777] leading-relaxed mb-1">Per the recent ResearchGate structural analysis, Complex ML algorithms (e.g. XGBoost) strictly natively max out at <span class="text-[#f7931a] font-bold">59.4% accuracy</span> when forecasting 5-minute volatility internals.</p>
        <p class="text-[9px] text-[#777] leading-relaxed mb-1">Our dynamic confidence is explicitly bounded to this ceiling, while execution models explicitly enforce a <span class="font-bold">52¢ Maximum Call Traps</span> to prevent margin edge erosion.</p>
      </div>
      
    </div>
  `;
}
