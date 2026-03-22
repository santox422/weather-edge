/**
 * Trading strategy panel — Kelly Criterion position sizing.
 */
import { $, TOOLTIPS, mTile, esc, cc } from './helpers.js';

export function renderTradingStrategy(data) {
  const stratPanel = $('panel-strategy')?.parentElement;
  const panel = $('strategy-panel');
  const strat = data.strategy;

  if (!strat || (!strat.yesBets.length && !(strat.overpricedNoBets||[]).length && !strat.noBets.length && !strat.longshots.length)) {
    if (stratPanel) stratPanel.style.display = 'none';
    return;
  }
  if (stratPanel) stratPanel.style.display = '';

  const savedPortfolio = localStorage.getItem('we_portfolio_size');
  const portfolioSize = savedPortfolio ? parseFloat(savedPortfolio) : 1000;

  let html = '';

  html += `<div class="flex items-center justify-between px-2 py-[3px] bg-[#050505] border-b border-[#111]">
    <span class="text-[8px] font-bold text-[#ff8c00] uppercase tracking-[0.15em]" title="Your total trading bankroll in USD. Change this to see position sizes scaled to your capital.">PORTFOLIO</span>
    <span class="text-[11px] text-[#ccc] font-bold" title="Enter your portfolio size in USD">$<input type="number" id="portfolio-input" class="bg-transparent border-b border-[#333] text-[#ff8c00] text-[11px] font-bold w-[60px] outline-none text-right" value="${portfolioSize}" min="100" step="100" /></span>
    <span class="text-[8px] text-[#444]" title="Deploy: % of portfolio to use. Conf: signal confidence. Days: time to resolution.">Deploy ${strat.summary.totalDeployed.toFixed(1)}% │ ${strat.summary.confidence}% conf │ ${strat.summary.daysOut}d</span>
  </div>`;

  if (strat.arbitrage?.isArbitrage) {
    html += `<div class="px-2 py-[3px] text-[9px] text-[#00ff41] bg-[#00ff41]/5 border-b border-[#111] font-bold" title="Complete Set Arbitrage: all YES shares sum to less than $1.00. Buy one of each for a guaranteed profit regardless of outcome.">⚡ ARB — Sum $${strat.arbitrage.sumYesPrices.toFixed(3)} < $1.00 → +${strat.arbitrage.profitIfArb}¢ risk-free</div>`;
  }

  // YES
  if (strat.yesBets.length > 0) {
    html += `<div class="px-2 py-[2px] text-[8px] font-bold c-green uppercase tracking-[0.1em] border-b border-[#111]" title="Brackets where the market is underpricing the probability. Buy YES shares to profit if the temperature lands in this range.">▲ BUY YES — Conviction</div>`;
    html += stratTable(['BRACKET', 'ALLOC', 'AMT', 'ENTRY', 'FCST', 'EDGE', 'E[R]']);
    for (const b of strat.yesBets) {
      const amt = (portfolioSize * b.pctOfPortfolio / 100).toFixed(0);
      const hedge = b.isHedge ? ' <span class="text-[7px] text-[#ff8c00] border border-[#ff8c00] px-[2px] rounded-sm" title="This bet also serves as a hedge for adjacent brackets">H</span>' : '';
      html += stratRow('border-l-2 border-l-[#00ff41]', [
        `${esc(b.bracket)}${hedge}`,
        cc('c-cyan', `${b.pctOfPortfolio}%`), cc('c-white', `$${amt}`),
        cc('c-muted', `${b.entryPrice}¢`), cc('c-cyan', `${b.forecastProb}%`),
        cc('c-green', `+${b.edge}%`), cc('c-green', `+${b.expectedReturn}%`)
      ]);
    }
    html += `</div>`;
  }

  // FADE
  if ((strat.overpricedNoBets||[]).length > 0) {
    html += `<div class="px-2 py-[2px] text-[8px] font-bold c-purple uppercase tracking-[0.1em] border-b border-[#111]" title="Brackets where the market is overpricing YES. Buy NO shares to profit when the temperature doesn't land here.">▼ FADE — Overpriced (Buy NO)</div>`;
    html += stratTable(['BRACKET', 'ALLOC', 'AMT', 'MKT', 'NO+', 'OVER', 'RISK']);
    for (const b of strat.overpricedNoBets) {
      const amt = (portfolioSize * b.pctOfPortfolio / 100).toFixed(0);
      html += stratRow('border-l-2 border-l-[#bb86fc]', [
        esc(b.bracket),
        cc('c-cyan', `${b.pctOfPortfolio}%`), cc('c-white', `$${amt}`),
        cc('c-muted', `${b.marketYesPrice}¢`), cc('c-purple', `+${b.edgeNo}%`),
        cc('c-red', `${b.edge}%`), cc('c-red', `-${b.maxLoss}%`)
      ]);
    }
    html += `</div>`;
  }

  // NO
  if (strat.noBets.length > 0) {
    html += `<div class="px-2 py-[2px] text-[8px] font-bold c-red uppercase tracking-[0.1em] border-b border-[#111]" title="Brackets very unlikely to hit. Sell premium by buying NO shares — high win rate but limited upside.">▼ NO — Safe Premium</div>`;
    html += stratTable(['BRACKET', 'ALLOC', 'AMT', 'NO@', 'WIN%', 'PROFIT', 'RISK']);
    for (const b of strat.noBets) {
      const amt = (portfolioSize * b.pctOfPortfolio / 100).toFixed(0);
      html += stratRow('border-l-2 border-l-[#ff3333]', [
        esc(b.bracket),
        cc('c-cyan', `${b.pctOfPortfolio}%`), cc('c-white', `$${amt}`),
        cc('c-muted', `${b.entryPrice}¢`), cc('c-cyan', `${b.forecastProb}%`),
        cc('c-green', `${b.profitPerShare}¢`), cc('c-red', `-${b.maxLoss}%`)
      ]);
    }
    html += `</div>`;
  }

  // LONGSHOTS
  if (strat.longshots.length > 0) {
    html += `<div class="px-2 py-[2px] text-[8px] font-bold c-amber uppercase tracking-[0.1em] border-b border-[#111]" title="Low-probability brackets with massive upside. Small bets with potential for outsized returns.">◆ LONGSHOTS</div>`;
    html += stratTable(['BRACKET', 'ALLOC', 'AMT', 'ENTRY', 'FCST', 'EDGE', 'WIN']);
    for (const b of strat.longshots) {
      const amt = (portfolioSize * b.pctOfPortfolio / 100).toFixed(0);
      html += stratRow('border-l-2 border-l-[#ff8c00]', [
        esc(b.bracket),
        cc('c-cyan', `${b.pctOfPortfolio}%`), cc('c-white', `$${amt}`),
        cc('c-muted', `${b.entryPrice}¢`), cc('c-cyan', `${b.forecastProb}%`),
        cc('c-green', `+${b.edge}%`), cc('c-amber', `+${b.potentialReturn}%`)
      ]);
    }
    html += `</div>`;
  }

  // Summary
  html += `<div class="mt-[2px]"><div class="grid grid-cols-4 gap-[1px] bg-[#222] strat-summary-grid">
    ${mTile('WIN', `${strat.summary.winProbability}%`, strat.summary.winProbability > 70 ? 'c-green' : strat.summary.winProbability > 40 ? 'c-amber' : 'c-red')}
    ${mTile('E[R]', `${strat.summary.expectedReturn > 0 ? '+' : ''}${strat.summary.expectedReturn}%`, strat.summary.expectedReturn > 0 ? 'c-green' : 'c-red')}
    ${mTile('MAX↓', `-${strat.summary.maxDrawdown}%`, 'c-red')}
    ${mTile('DEPLOY', `${strat.summary.totalDeployed}%`, 'c-cyan')}
  </div>`;

  const fPct = strat.summary.totalFadePct || 0;
  const total = strat.summary.totalDeployed || 1;
  html += `<div class="flex h-[4px] mt-[3px] overflow-hidden" title="Visual breakdown of portfolio allocation across bet types">
    <div class="bg-[#00ff41]" style="width:${strat.summary.totalYesPct/total*100}%" title="YES ${strat.summary.totalYesPct}%"></div>
    <div class="bg-[#bb86fc]" style="width:${fPct/total*100}%" title="FADE ${fPct}%"></div>
    <div class="bg-[#ff3333]" style="width:${strat.summary.totalNoPct/total*100}%" title="NO ${strat.summary.totalNoPct}%"></div>
    <div class="bg-[#ff8c00]" style="width:${strat.summary.totalLongshotPct/total*100}%" title="LONG ${strat.summary.totalLongshotPct}%"></div>
  </div>`;
  html += `<div class="flex items-center gap-2 px-2 py-[3px] text-[8px] text-[#666] alloc-legend">
    <span class="c-green" title="Capital allocated to conviction YES bets">■</span> YES ${strat.summary.totalYesPct}%
    ${fPct > 0 ? `<span class="c-purple" title="Capital allocated to fading overpriced brackets">■</span> FADE ${fPct}%` : ''}
    <span class="c-red" title="Capital allocated to safe NO premium bets">■</span> NO ${strat.summary.totalNoPct}%
    <span class="c-amber" title="Capital allocated to low-probability high-reward longshots">■</span> LONG ${strat.summary.totalLongshotPct}%
    <span class="c-muted" title="Undeployed capital held as cash for risk management">■</span> CASH ${(100-strat.summary.totalDeployed).toFixed(1)}%
  </div></div>`;

  panel.innerHTML = html;

  const input = $('portfolio-input');
  if (input) {
    input.addEventListener('change', () => {
      const val = parseFloat(input.value) || 1000;
      localStorage.setItem('we_portfolio_size', val);
      renderTradingStrategy(data);
    });
  }
}

function stratTable(headers) {
  return `<div class="text-[8px] strat-table-wrap"><div class="grid grid-cols-7 gap-0 px-2 py-[2px] border-b border-[#111] min-w-[340px]">${headers.map(h => {
    const tip = TOOLTIPS[h] || '';
    const titleAttr = tip ? ` title="${tip}"` : '';
    return `<span class="${h === headers[0] ? 'text-left' : 'text-right'} text-[#333] font-bold uppercase"${titleAttr}>${h}</span>`;
  }).join('')}</div>`;
}

function stratRow(cls, cells) {
  return `<div class="grid grid-cols-7 gap-0 px-2 py-[1px] border-b border-[#0a0a0a] hover:bg-[#0a0a0a] transition-colors min-w-[340px] ${cls}">${cells.map((c, i) => `<span class="${i === 0 ? 'text-left text-[#ccc] truncate' : 'text-right'} text-[9px]">${c}</span>`).join('')}</div>`;
}
