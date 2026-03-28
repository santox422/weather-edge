'use client';

import { useState, useEffect } from 'react';
import type { AnalysisData, StrategyBet } from '@/types';
import { TOOLTIPS } from '@/lib/helpers';
import MetricTile from './MetricTile';

interface StrategyPanelProps {
  data: AnalysisData;
}

function StratHeader({ headers }: { headers: string[] }) {
  return (
    <div className="grid grid-cols-7 gap-0 px-2 py-[3px] border-b border-[#222] min-w-[340px] bg-[#080808]">
      {headers.map((h, i) => (
        <span key={h} className={`${i === 0 ? 'text-left' : 'text-right'} text-[#555] text-[7px] font-bold uppercase cursor-help`}
          data-tip={TOOLTIPS[h] || ''}>{h}</span>
      ))}
    </div>
  );
}

export default function StrategyPanel({ data }: StrategyPanelProps) {
  const strat = data.strategy;
  if (!strat || (!strat.yesBets.length && !strat.noBets.length && !strat.longshots.length && !(strat.overpricedNoBets || []).length)) {
    return <div className="bg-[#050505]" id="panel-strategy" />;
  }

  const [portfolioSize, setPortfolioSize] = useState(1000);
  useEffect(() => {
    const saved = typeof window !== 'undefined' ? localStorage.getItem('we_portfolio_size') : null;
    if (saved) setPortfolioSize(parseFloat(saved) || 1000);
  }, []);

  const handlePortfolioChange = (val: string) => {
    const n = parseFloat(val) || 1000;
    setPortfolioSize(n);
    if (typeof window !== 'undefined') localStorage.setItem('we_portfolio_size', String(n));
  };

  const fadePct = strat.summary.totalFadePct || 0;
  const totalDeployed = strat.summary.totalDeployed || 1;

  return (
    <div className="analysis-card" id="panel-strategy">
      <div className="section-header"
        data-tip="Kelly Criterion position sizing">
        TRADING STRATEGY <span className="text-[7px] border border-[#ff8c00]/40 px-1.5 py-[1px] text-[#ff8c00] bg-[#ff8c00]/5 tracking-wider">KELLY</span>
      </div>

      {/* Portfolio header with editable input */}
      <div className="px-2 py-[3px] bg-[#050505] border-b border-[#111] flex items-center justify-between">
        <span className="text-[8px] font-bold text-[#ff8c00] uppercase tracking-[0.15em]">PORTFOLIO</span>
        <span className="text-[11px] text-[#ccc] font-bold">$
          <input
            type="number" min={100} step={100}
            className="bg-transparent border-b border-[#333] text-[#ff8c00] text-[11px] font-bold w-[60px] outline-none text-right"
            value={portfolioSize}
            onChange={(ev) => handlePortfolioChange(ev.target.value)}
          />
        </span>
        <span className="text-[8px] text-[#444]">Deploy {strat.summary.totalDeployed.toFixed(1)}% │ {strat.summary.confidence}% conf │ {strat.summary.daysOut}d</span>
      </div>

      {/* Arbitrage alert */}
      {strat.arbitrage?.isArbitrage && (
        <div className="px-2 py-[3px] text-[9px] text-[#00ff41] bg-[#00ff41]/5 border-b border-[#111] font-bold">
          ⚡ ARB — Sum ${strat.arbitrage.sumYesPrices.toFixed(3)} &lt; $1.00 → +{strat.arbitrage.profitIfArb}¢ risk-free
        </div>
      )}

      {/* YES Bets */}
      {strat.yesBets.length > 0 && (
        <div className="text-[8px]">
          <div className="px-2 py-[2px] font-bold text-[#00ff41] uppercase tracking-[0.1em] border-b border-[#111]">▲ BUY YES — Conviction</div>
          <div className="strat-table-wrap">
            <StratHeader headers={['BRACKET', 'ALLOC', 'AMT', 'ENTRY', 'FCST', 'EDGE', 'E[R]']} />
            {strat.yesBets.map((b: StrategyBet) => (
              <div key={b.bracket} className="grid grid-cols-7 gap-0 px-2 py-[1px] border-b border-[#0a0a0a] hover:bg-[#0a0a0a] transition-colors min-w-[340px] border-l-2 border-l-[#00ff41] text-[9px]">
                <span className="text-left text-[#ccc] truncate">{b.bracket}{b.isHedge ? ' ↺' : ''}</span>
                <span className="text-right text-[#00bcd4]">{b.pctOfPortfolio}%</span>
                <span className="text-right text-[#ccc]">${(portfolioSize * b.pctOfPortfolio / 100).toFixed(0)}</span>
                <span className="text-right text-[#555]">{b.entryPrice}¢</span>
                <span className="text-right text-[#00bcd4]">{b.forecastProb}%</span>
                <span className="text-right text-[#00ff41]">+{b.edge}%</span>
                <span className="text-right text-[#00ff41]">+{b.expectedReturn}%</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* FADE — Overpriced (Buy NO) */}
      {(strat.overpricedNoBets || []).length > 0 && (
        <div className="text-[8px]">
          <div className="px-2 py-[2px] font-bold text-[#bb86fc] uppercase tracking-[0.1em] border-b border-[#111]">▼ FADE — Overpriced (Buy NO)</div>
          <div className="strat-table-wrap">
            <StratHeader headers={['BRACKET', 'ALLOC', 'AMT', 'MKT', 'NO+', 'OVER', 'RISK']} />
            {(strat.overpricedNoBets || []).map((b: StrategyBet) => (
              <div key={b.bracket} className="grid grid-cols-7 gap-0 px-2 py-[1px] border-b border-[#0a0a0a] hover:bg-[#0a0a0a] transition-colors min-w-[340px] border-l-2 border-l-[#bb86fc] text-[9px]">
                <span className="text-left text-[#ccc] truncate">{b.bracket}</span>
                <span className="text-right text-[#00bcd4]">{b.pctOfPortfolio}%</span>
                <span className="text-right text-[#ccc]">${(portfolioSize * b.pctOfPortfolio / 100).toFixed(0)}</span>
                <span className="text-right text-[#555]">{b.marketYesPrice}¢</span>
                <span className="text-right text-[#bb86fc]">+{b.edgeNo}%</span>
                <span className="text-right text-[#ff3333]">{b.edge}%</span>
                <span className="text-right text-[#ff3333]">-{b.maxLoss}%</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* NO — Safe Premium */}
      {strat.noBets.length > 0 && (
        <div className="text-[8px]">
          <div className="px-2 py-[2px] font-bold text-[#ff3333] uppercase tracking-[0.1em] border-b border-[#111]">▼ NO — Safe Premium</div>
          <div className="strat-table-wrap">
            <StratHeader headers={['BRACKET', 'ALLOC', 'AMT', 'NO@', 'WIN%', 'PROFIT', 'RISK']} />
            {strat.noBets.map((b: StrategyBet) => (
              <div key={b.bracket} className="grid grid-cols-7 gap-0 px-2 py-[1px] border-b border-[#0a0a0a] hover:bg-[#0a0a0a] transition-colors min-w-[340px] border-l-2 border-l-[#ff3333] text-[9px]">
                <span className="text-left text-[#ccc] truncate">{b.bracket}</span>
                <span className="text-right text-[#00bcd4]">{b.pctOfPortfolio}%</span>
                <span className="text-right text-[#ccc]">${(portfolioSize * b.pctOfPortfolio / 100).toFixed(0)}</span>
                <span className="text-right text-[#555]">{b.entryPrice}¢</span>
                <span className="text-right text-[#00bcd4]">{b.forecastProb}%</span>
                <span className="text-right text-[#00ff41]">{b.profitPerShare}¢</span>
                <span className="text-right text-[#ff3333]">-{b.maxLoss}%</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* LONGSHOTS */}
      {strat.longshots.length > 0 && (
        <div className="text-[8px]">
          <div className="px-2 py-[2px] font-bold text-[#ff8c00] uppercase tracking-[0.1em] border-b border-[#111]">◆ LONGSHOTS</div>
          <div className="strat-table-wrap">
            <StratHeader headers={['BRACKET', 'ALLOC', 'AMT', 'ENTRY', 'FCST', 'EDGE', 'WIN']} />
            {strat.longshots.map((b: StrategyBet) => (
              <div key={b.bracket} className="grid grid-cols-7 gap-0 px-2 py-[1px] border-b border-[#0a0a0a] hover:bg-[#0a0a0a] transition-colors min-w-[340px] border-l-2 border-l-[#ff8c00] text-[9px]">
                <span className="text-left text-[#ccc] truncate">{b.bracket}</span>
                <span className="text-right text-[#00bcd4]">{b.pctOfPortfolio}%</span>
                <span className="text-right text-[#ccc]">${(portfolioSize * b.pctOfPortfolio / 100).toFixed(0)}</span>
                <span className="text-right text-[#555]">{b.entryPrice}¢</span>
                <span className="text-right text-[#00bcd4]">{b.forecastProb}%</span>
                <span className="text-right text-[#00ff41]">+{b.edge}%</span>
                <span className="text-right text-[#ff8c00]">+{b.potentialReturn}%</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Summary */}
      <div className="mt-[2px]">
        <div className="grid grid-cols-4 gap-[1px] bg-[#222] strat-summary-grid">
          <MetricTile label="WIN" value={`${strat.summary.winProbability}%`} colorClass={strat.summary.winProbability > 70 ? 'text-[#00ff41]' : strat.summary.winProbability > 40 ? 'text-[#ff8c00]' : 'text-[#ff3333]'} />
          <MetricTile label="E[R]" value={`${strat.summary.expectedReturn > 0 ? '+' : ''}${strat.summary.expectedReturn}%`} colorClass={strat.summary.expectedReturn > 0 ? 'text-[#00ff41]' : 'text-[#ff3333]'} />
          <MetricTile label="MAX↓" value={`-${strat.summary.maxDrawdown}%`} colorClass="text-[#ff3333]" />
          <MetricTile label="DEPLOY" value={`${strat.summary.totalDeployed}%`} colorClass="text-[#00bcd4]" />
        </div>
        {/* Allocation bar */}
        <div className="flex h-[5px] mt-[3px] overflow-hidden rounded-sm" data-tip="Portfolio allocation breakdown">
          <div className="bg-[#00ff41] transition-all" style={{ width: `${strat.summary.totalYesPct / totalDeployed * 100}%` }} />
          <div className="bg-[#bb86fc] transition-all" style={{ width: `${fadePct / totalDeployed * 100}%` }} />
          <div className="bg-[#ff3333] transition-all" style={{ width: `${strat.summary.totalNoPct / totalDeployed * 100}%` }} />
          <div className="bg-[#ff8c00] transition-all" style={{ width: `${strat.summary.totalLongshotPct / totalDeployed * 100}%` }} />
        </div>
        <div className="flex items-center gap-2 px-2 py-[3px] text-[8px] text-[#666] flex-wrap alloc-legend">
          <span><span className="text-[#00ff41]">■</span> YES {strat.summary.totalYesPct}%</span>
          {fadePct > 0 && <span><span className="text-[#bb86fc]">■</span> FADE {fadePct}%</span>}
          <span><span className="text-[#ff3333]">■</span> NO {strat.summary.totalNoPct}%</span>
          <span><span className="text-[#ff8c00]">■</span> LONG {strat.summary.totalLongshotPct}%</span>
          <span><span className="text-[#555]">■</span> CASH {(100 - strat.summary.totalDeployed).toFixed(1)}%</span>
        </div>
      </div>
    </div>
  );
}
