/**
 * Analysis view — signal hero, divergence, and outcomes table.
 */
import { $, mTile, metricCell, pct, fmtEdge, edgeColor, signalColor, esc } from './helpers.js';
import { renderAtmospheric, renderSkillMetrics, renderTrajectoryAndBias, renderAirQuality } from './right-panel.js';
import { renderTradingStrategy } from './strategy-view.js';
import { drawEnsemble, drawModels, drawHistory } from './charts.js';

export function renderAnalysis(data, city, marketOverride, { priceUpdateOnly = false } = {}) {
  const e = data.edge || {};
  const div = data.modelDivergence || e.modelDivergence;
  const polyUrl = data.market?.polymarketUrl || marketOverride?.polymarketUrl || '';

  // Divergence — only depends on weather model data, skip on price updates
  if (!priceUpdateOnly) {
    if (div?.isDivergent) {
      $('card-divergence').style.display = 'block';
      $('divergence-text').textContent = div.summary || `GFS/ECMWF disagree by ${div.difference?.toFixed(1)}°C`;
      $('div-grid').innerHTML = `<div class="grid grid-cols-4 gap-[1px] bg-[#222] mobile-grid-2">
        ${mTile('GFS', `${div.gfsTemp?.toFixed(1)||'--'}°C`, 'c-blue')}
        ${mTile('ECMWF', `${div.ecmwfTemp?.toFixed(1)||'--'}°C`, 'c-cyan')}
        ${mTile('DELTA', `${div.difference?.toFixed(1)||'--'}°C`, 'c-amber')}
        ${mTile('WARMER', div.warmerModel||'--', 'c-white')}
      </div>`;
    } else {
      $('card-divergence').style.display = 'none';
    }
  }

  // Signal Hero
  const bracketName = e.bestBracketTitle || e.bestBracket || null;
  const signal = e.signal || '';
  const isBuyNo = signal.includes('NO');
  const isBuy = signal.includes('BUY');
  const isHold = signal === 'HOLD' || signal === 'NO_DATA' || signal === 'NO_FORECAST' || signal === 'INSUFFICIENT_DATA';

  let heroAction = '', heroColorCls = 'text-[#555]';
  if (isHold || !bracketName) {
    heroAction = 'HOLD — NO CLEAR EDGE';
  } else if (isBuyNo) {
    heroAction = `>>> FADE "${bracketName}" <<<`;
    heroColorCls = 'text-[#ff3333]';
  } else if (isBuy) {
    heroAction = `>>> BUY "${bracketName}" YES <<<`;
    heroColorCls = 'text-[#00ff41]';
  }

  const heroSubtitle = e.marketProbability != null && e.forecastProbability != null
    ? `MKT ${pct(e.marketProbability)} │ FCST ${pct(e.forecastProbability)} │ EDGE ${fmtEdge(e.edgePercent)}`
    : e.reasoning?.split('\n')[0] || '';

  const polyBtnHtml = polyUrl
    ? `<a href="${polyUrl}" target="_blank" rel="noopener" class="inline-flex items-center gap-1 border border-[#ff8c00] text-[#ff8c00] text-[9px] font-bold px-[10px] py-1 no-underline whitespace-nowrap tracking-wider transition-all hover:bg-[#ff8c00]/10 hover:shadow-[0_0_8px_rgba(255,140,0,0.25)] shrink-0 cursor-pointer" id="btn-polymarket" data-tip="Open this market on Polymarket to trade">TRADE ON POLYMARKET ↗</a>`
    : '';

  $('edge-grid').innerHTML = `
    <div class="flex flex-col sm:flex-row items-start justify-between gap-[10px]">
      <div class="min-w-0">
        <div class="text-[13px] font-extrabold tracking-[0.02em] ${heroColorCls} break-words" data-tip="Primary trading signal: BUY YES = market is underpriced, FADE = market is overpriced (buy NO), HOLD = no clear edge">${heroAction}</div>
        <div class="text-[10px] text-[#888] mt-[2px] break-words" data-tip="MKT = current Polymarket price, FCST = forecast probability from weather models, EDGE = forecast minus market price">${heroSubtitle}</div>
      </div>
      ${polyBtnHtml}
    </div>
    <div class="grid grid-cols-3 gap-[1px] mt-[6px] bg-[#222] mobile-grid-2">
      ${metricCell('ADJ. EDGE', fmtEdge(e.adjustedEdge), edgeColor(e.adjustedEdge))}
      ${metricCell('CONFIDENCE', `${e.confidence || '--'}%`, 'c-amber')}
      ${metricCell('SIGNAL', (e.signal || '--').replace(/_/g, ' '), signalColor(e.signal))}
    </div>
    ${data.city ? `<div class="text-[8px] text-[#444] mt-1" data-tip="Weather observation station used for this city. Bias correction adjusts forecasts based on historical station-specific errors.">◉ ${data.city.station}${data.stationBias?.reliable ? ` │ BIAS: ${data.stationBias.bias > 0 ? '+' : ''}${data.stationBias.bias.toFixed(2)}°C ${data.stationBias.direction === 'warm' ? '⬆' : data.stationBias.direction === 'cold' ? '⬇' : '●'} (n=${data.stationBias.sampleSize})` : ''}</div>` : ''}
    ${data.liveWeather?.currentTemp != null ? `<div class="text-[10px] text-[#00ff41] font-bold mt-[2px] tracking-wide" data-tip="Current real-time temperature and highest recorded temperature today (so far) from Open-Meteo">LIVE TEMP: ${data.liveWeather.currentTemp.toFixed(1)}°C <span class="text-[#555] mx-1">│</span> TODAY MAX: ${data.liveWeather.maxToday.toFixed(1)}°C</div>` : ''}
  `;

  // Outcomes
  const rawOutcomes = data.market?.outcomes || marketOverride?.outcomes || [];
  const outcomes = [...rawOutcomes].sort((a, b) => {
    const av = a.threshold?.value ?? 999;
    const bv = b.threshold?.value ?? 999;
    if (a.threshold?.type === 'below') return -1;
    if (b.threshold?.type === 'below') return 1;
    if (a.threshold?.type === 'above') return 1;
    if (b.threshold?.type === 'above') return -1;
    return av - bv;
  });
  const bp = e.bracketProbabilities;
  const rawBp = data.ensemble?.rawBracketProbabilities;
  const bestBracket = bracketName;

  if (outcomes.length > 0) {
    $('outcomes-list').innerHTML = `<div class="w-full text-[10px] px-2 pb-1.5 overflow-x-auto">
      <div class="grid grid-cols-[1fr_36px_36px_36px_46px_26px] sm:grid-cols-[1fr_44px_44px_44px_54px_36px] py-0.75 border-b border-[#333] text-[8px] text-[#444] uppercase tracking-widest font-bold min-w-0">
        <span data-tip="Temperature bracket being traded on Polymarket">OUTCOME</span>
        <span class="text-right" data-tip="Current market YES price on Polymarket (in cents per share)">MKT</span>
        <span class="text-right" data-tip="Raw ensemble probability (169 members from GFS/ECMWF/ICON-EPS, no deterministic weighting)">ENS</span>
        <span class="text-right" data-tip="Blended forecast probability (ensemble + weighted high-res deterministic models)">FCST</span>
        <span class="text-right" data-tip="Blended forecast probability minus market price. Positive = underpriced opportunity">EDGE</span>
        <span data-tip="Visual strength of the edge"></span>
      </div>
      ${outcomes.map((o) => {
        const b = bp?.find((p) => p.name === o.name || p.title === o.title);
        const rb = rawBp?.find((p) => p.name === o.name || p.title === o.title);
        const mkt = (o.price * 100).toFixed(0);
        const rawFc = rb?.forecastProb != null ? (rb.forecastProb * 100).toFixed(0) : '--';
        const fc = b?.forecastProb != null ? (b.forecastProb * 100).toFixed(0) : '--';
        
        const kdeBlend = data.ensemble?.kdeBlending;
        const ensTip = `Raw ensemble probability: ${rawFc}% (${kdeBlend?.ensembleMembers || '?'} members, no deterministic weighting)`;
        const fcTip = kdeBlend 
          ? `Blended probability: ${fc}% (ensemble + ${kdeBlend.pseudoMembers} weighted pseudo-members at ${kdeBlend.scale.toFixed(1)}x scale)`
          : `Forecast probability: ${fc}%`;
          
        const edg = b?.edge != null ? (b.edge * 100).toFixed(1) : '--';
        const edgVal = parseFloat(edg);
        const isBest = (o.name === bestBracket || o.title === bestBracket);
        const absEdge = Math.min(Math.abs(edgVal), 30);
        const barWidth = (absEdge / 30 * 100).toFixed(0);
        const barColor = edgVal > 0 ? 'bg-[#00ff41]' : edgVal < 0 ? 'bg-[#ff3333]' : '';
        const bestBorder = isBest ? 'border-l-2 border-l-[#ff8c00] bg-[#ff8c00]/5 pl-[2px]' : '';
        const rowTip = isBest ? 'Best trading opportunity based on edge size' : `${esc(o.name || o.title)} temperature bracket`;
        return `<div class="grid grid-cols-[1fr_36px_36px_36px_46px_26px] sm:grid-cols-[1fr_44px_44px_44px_54px_36px] py-0.5 border-b border-[#0a0a0a] items-center transition-colors hover:bg-[#0a0a0a] ${bestBorder} min-w-0" data-token-id="${o.tokenId || ''}" data-tip="${rowTip}">
          <span class="text-[#ccc] truncate text-[10px]">${isBest ? '<span class="text-[#ff8c00] text-[7px]">◆</span> ' : ''}${esc(o.name || o.title)}</span>
          <span class="font-semibold text-right c-muted price-cell" data-tip="Polymarket YES price: ${mkt}¢ per share">${mkt}¢</span>
          <span class="font-semibold text-right text-[#888]" data-tip="${ensTip}">${rawFc}%</span>
          <span class="font-semibold text-right c-cyan" data-tip="${fcTip}">${fc}%</span>
          <span class="font-semibold text-right edge-cell ${edgeColor(edg)}" data-tip="Edge: forecast (${fc}%) minus market (${mkt}%). ${edgVal > 0 ? 'Positive = underpriced opportunity' : edgVal < 0 ? 'Negative = overpriced, consider fading' : 'No edge'}">${edgVal > 0 ? '+' : ''}${edg}%</span>
          <span class="px-0.75" data-tip="Edge strength visualization"><span class="block w-full h-0.75 bg-[#111] overflow-hidden"><span class="block h-full ${barColor} transition-[width] duration-300" style="width:${barWidth}%"></span></span></span>
        </div>`;
      }).join('')}
    </div>`;
  }

  // Delegate to other panels
  // On price-only updates (WebSocket ticks), skip redrawing static weather panels
  // that don't depend on market prices — avoids flickering and wasted renders.
  if (!priceUpdateOnly) {
    renderAtmospheric(data);
    renderSkillMetrics(data, e);
    renderTrajectoryAndBias(data);
    renderAirQuality(data);
    drawEnsemble(data);
    drawModels(data);
    drawHistory(data);
  }
  renderTradingStrategy(data);

  $('reasoning-text').textContent = e.reasoning || data.error || 'Analysis complete.';
}
