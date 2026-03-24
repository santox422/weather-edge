'use client';

import { useMemo, useState, useEffect } from 'react';
import type { AnalysisData, City, Market, Outcome, BracketProbability, StrategyBet } from '@/types';
import { esc, TOOLTIPS } from '@/lib/helpers';

interface AnalysisViewProps {
  data: AnalysisData;
  city?: City;
  market?: Market | null;
}

function MetricTile({ label, value, colorClass = 'text-[#ccc]' }: { label: string; value: string; colorClass?: string }) {
  const tip = TOOLTIPS[label] || '';
  return (
    <div className="bg-[#0a0a0a] p-[4px_6px] cursor-help" title={tip} data-tip={tip}>
      <div className="text-[7px] text-[#444] uppercase tracking-[0.12em] font-semibold">{label}</div>
      <div className={`text-[11px] font-bold mt-[1px] ${colorClass}`}>{value}</div>
    </div>
  );
}

function edgeColor(v: number | null | undefined) {
  if (v == null) return 'text-[#555]';
  return v > 0 ? 'text-[#00ff41]' : v < 0 ? 'text-[#ff3333]' : 'text-[#555]';
}

function signalColor(s: string | undefined) {
  if (!s) return 'text-[#555]';
  if (s.includes('STRONG') && s.includes('NO')) return 'text-[#ff3333]';
  if (s.includes('STRONG')) return 'text-[#00ff41]';
  if (s.includes('NO')) return 'text-[#ff3333]';
  if (s.includes('BUY')) return 'text-[#00ff41]';
  return 'text-[#555]';
}

function fmtEdge(v: number | string | null | undefined) {
  if (v == null) return '--';
  const n = typeof v === 'string' ? parseFloat(v) : v;
  if (isNaN(n)) return '--';
  return (n > 0 ? '+' : '') + (typeof v === 'string' ? v : n.toFixed(1)) + '%';
}

export default function AnalysisView({ data, city, market: marketOverride }: AnalysisViewProps) {
  const e: any = data.edge || {};
  const div = data.modelDivergence || (e as any).modelDivergence;
  const polyUrl = data.market?.polymarketUrl || marketOverride?.polymarketUrl || '';

  // Station info
  const lw = data.liveWeather;
  const stationInfo = data.city;

  // Signal hero
  const bracketName = e.bestBracketTitle || e.bestBracket || null;
  const signal = e.signal || '';
  const isBuyNo = signal.includes('NO');
  const isBuy = signal.includes('BUY');
  const isHold = signal === 'HOLD' || signal === 'NO_DATA' || signal === 'NO_FORECAST' || signal === 'INSUFFICIENT_DATA';

  let heroAction = 'HOLD — NO CLEAR EDGE';
  let heroColor = 'text-[#555]';
  if (!isHold && bracketName) {
    if (isBuyNo) { heroAction = `>>> FADE "${bracketName}" <<<`; heroColor = 'text-[#ff3333]'; }
    else if (isBuy) { heroAction = `>>> BUY "${bracketName}" YES <<<`; heroColor = 'text-[#00ff41]'; }
  }
  const heroSubtitle = e.marketProbability != null && e.forecastProbability != null
    ? `MKT ${(e.marketProbability * 100).toFixed(0)}% │ FCST ${(e.forecastProbability * 100).toFixed(0)}% │ EDGE ${fmtEdge(e.edgePercent)}`
    : e.reasoning?.split('\n')[0] || '';

  // Bracket probabilities
  const rawOutcomes = data.market?.outcomes || marketOverride?.outcomes || [];
  const outcomes = useMemo(() => [...rawOutcomes].sort((a: Outcome, b: Outcome) => {
    if (a.threshold?.type === 'below') return -1;
    if (b.threshold?.type === 'below') return 1;
    if (a.threshold?.type === 'above') return 1;
    if (b.threshold?.type === 'above') return -1;
    return (a.threshold?.value ?? 999) - (b.threshold?.value ?? 999);
  }), [rawOutcomes]);

  const bp: BracketProbability[] | undefined = e.bracketProbabilities;
  const rawBp: BracketProbability[] | undefined = data.ensemble?.rawBracketProbabilities;

  // Find best edge bracket (not just highest forecast)
  const bestEdgeName = useMemo(() => {
    if (!bp) return null;
    let name: string | null = null;
    let bestEdge = -Infinity;
    for (const b of bp) {
      const edge = b.edge ?? ((b.forecastProb || 0) - (b.marketPrice || 0));
      if (edge > bestEdge) { bestEdge = edge; name = b.name || b.title || null; }
    }
    return name;
  }, [bp]);

  return (
    <div className="flex flex-col gap-[1px]">
      {/* Signal Hero + Station Header */}
      <div className="bg-[#050505] border-b border-[#111] p-2" id="panel-signal">
        <div className="flex flex-col sm:flex-row items-start justify-between gap-[10px]">
          <div className="min-w-0">
            {/* Station info */}
            {stationInfo && (
              <div className="text-[8px] text-[#444] mt-1">
                ◉ {stationInfo.station} <span className="text-[#333]">({stationInfo.icao})</span>
                {lw?.wundergroundUrl && (
                  <a href={lw.wundergroundUrl} target="_blank" rel="noopener noreferrer" className="text-[#ff8c00] no-underline hover:underline ml-1">WU ↗</a>
                )}
                {data.stationBias?.reliable && (
                  <span className="text-[#555] ml-1">
                    │ BIAS: {data.stationBias.bias > 0 ? '+' : ''}{data.stationBias.bias.toFixed(2)}°C {data.stationBias.direction === 'warm' ? '⬆' : data.stationBias.direction === 'cold' ? '⬇' : '●'} (n={data.stationBias.sampleSize})
                  </span>
                )}
              </div>
            )}
            {/* Live METAR */}
            {lw?.currentTemp != null && (
              <div className="flex items-center gap-3 mt-[2px]">
                <div className="text-[10px] text-[#00ff41] font-bold tracking-wide">
                  LIVE TEMP: {lw.currentTemp.toFixed(1)}°C
                </div>
                <span className="text-[#555] text-[10px]">│</span>
                <div className="text-[10px] text-[#ff8c00] font-bold">
                  TODAY MAX: {lw.maxToday.toFixed(1)}°C
                </div>
                {lw.lastUpdated && (
                  <div className="text-[8px] text-[#333]">
                    {new Date(lw.lastUpdated).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })} UTC
                  </div>
                )}
              </div>
            )}
          </div>
          {polyUrl && (
            <a href={polyUrl} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1 border border-[#ff8c00] text-[#ff8c00] text-[9px] font-bold px-[10px] py-1 no-underline whitespace-nowrap tracking-wider transition-all hover:bg-[#ff8c00]/10 hover:shadow-[0_0_8px_rgba(255,140,0,0.25)] shrink-0 cursor-pointer"
              id="btn-polymarket">TRADE ON POLYMARKET ↗</a>
          )}
        </div>

        {/* Divergence Warning */}
        {div?.isDivergent && (
          <div className="mt-[6px] p-2 border border-[#ff333344] bg-[#ff333308]">
            <div className="text-[9px] font-bold text-[#ff3333] uppercase tracking-wider">⚠ MODEL DIVERGENCE</div>
            <div className="text-[9px] text-[#888] mt-[2px]">{div.summary || `GFS/ECMWF disagree by ${div.difference?.toFixed(1)}°C`}</div>
            <div className="grid grid-cols-4 gap-[1px] bg-[#222] mobile-grid-2 mt-[4px]">
              <MetricTile label="GFS" value={`${div.gfsTemp?.toFixed(1) || '--'}°C`} colorClass="text-[#4488ff]" />
              <MetricTile label="ECMWF" value={`${div.ecmwfTemp?.toFixed(1) || '--'}°C`} colorClass="text-[#00bcd4]" />
              <MetricTile label="DELTA" value={`${div.difference?.toFixed(1) || '--'}°C`} colorClass="text-[#ff8c00]" />
              <MetricTile label="WARMER" value={div.warmerModel || '--'} />
            </div>
          </div>
        )}
      </div>

      {/* Brackets + Strategy */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-[1px]" id="panel-row-data">
        {/* Bracket Outcomes — with EDGE column */}
        <div className="bg-[#050505]" id="panel-brackets">
          <div className="px-2 py-1 text-[9px] font-bold text-[#ff8c00] uppercase tracking-[0.15em] bg-[#0a0a0a] border-b border-[#1a1a1a]"
            data-tip="All temperature brackets with forecast vs. market probabilities">
            BRACKET OUTCOMES
          </div>
          {outcomes.length > 0 && (
            <div className="w-full text-[10px] px-2 pb-1.5 overflow-x-auto" id="outcomes-list">
              {/* Header */}
              <div className="grid grid-cols-[1fr_40px_40px_40px_50px_30px] sm:grid-cols-[1fr_44px_44px_44px_52px_36px] py-[3px] border-b border-[#333] text-[8px] text-[#444] uppercase tracking-[0.1em] font-bold min-w-0">
                <span title="Temperature bracket">OUTCOME</span>
                <span className="text-right" title="Current market YES price (cents)">MKT</span>
                <span className="text-right" title="Raw ensemble-only probability (no weight blending)">RAW</span>
                <span className="text-right" title="Blended forecast probability (ensemble + deterministic BMA)">FCST</span>
                <span className="text-right" title="Forecast minus market price. Positive = underpriced">EDGE</span>
                <span title="Edge strength visualization"></span>
              </div>
              {/* Rows */}
              {outcomes.map((o: Outcome) => {
                const b = bp?.find((p: BracketProbability) => p.name === o.name || p.title === o.title);
                const rb = rawBp?.find((p: BracketProbability) => p.name === o.name || p.title === o.title);
                const mkt = (o.price * 100).toFixed(0);
                const raw = rb?.forecastProb != null ? (rb.forecastProb * 100).toFixed(0) : '--';
                const fc = b?.forecastProb != null ? (b.forecastProb * 100).toFixed(0) : '--';
                const edg = b?.edge != null ? (b.edge * 100).toFixed(1) : '--';
                const edgVal = parseFloat(edg);
                const isBest = !!(bestEdgeName && (o.name === bestEdgeName || o.title === bestEdgeName));
                const absEdge = Math.min(Math.abs(edgVal) || 0, 30);
                const barWidth = (absEdge / 30 * 100).toFixed(0);
                const barColor = edgVal > 0 ? 'bg-[#00ff41]' : edgVal < 0 ? 'bg-[#ff3333]' : '';
                const bestBorder = isBest ? 'border-l-2 border-l-[#ff8c00] bg-[#ff8c00]/[0.05] pl-[2px]' : '';

                return (
                  <div
                    key={o.tokenId || o.name}
                    className={`grid grid-cols-[1fr_40px_40px_40px_50px_30px] sm:grid-cols-[1fr_44px_44px_44px_52px_36px] py-[2px] border-b border-[#0a0a0a] items-center transition-colors hover:bg-[#0a0a0a] min-w-0 ${bestBorder}`}
                    data-token-id={o.tokenId || ''}
                    title={isBest ? 'Best trading opportunity based on edge size' : `${o.name || o.title} temperature bracket`}
                  >
                    <span className="text-[#ccc] truncate text-[10px]">
                      {isBest && <span className="text-[#ff8c00] text-[7px]">◆</span>}{' '}
                      {o.name || o.title}
                    </span>
                    <span className="font-semibold text-right text-[#555] price-cell" title={`YES price: ${mkt}¢`}>
                      {mkt}¢
                    </span>
                    <span className="font-semibold text-right text-[#bb86fc]" title={`Raw ensemble-only: ${raw}%`}>
                      {raw}%
                    </span>
                    <span className="font-semibold text-right text-[#00bcd4]" title={`Blended BMA: ${fc}%`}>
                      {fc}%
                    </span>
                    <span className={`font-semibold text-right text-[9px] ${edgeColor(edgVal)}`}
                      title={`Edge: forecast (${fc}%) minus market (${mkt}%)`}>
                      {edgVal > 0 ? '+' : ''}{edg}%
                    </span>
                    <span className="px-[3px]">
                      <span className="block w-full h-[3px] bg-[#111] overflow-hidden">
                        <span className={`block h-full ${barColor} transition-all`} style={{ width: `${barWidth}%` }} />
                      </span>
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Strategy */}
        <StrategyPanel data={data} />
      </div>

      {/* Charts — ensemble + models */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-[1px]" id="panel-row-charts">
        <div className="bg-[#050505]">
          <div className="px-2 py-1 text-[9px] font-bold text-[#ff8c00] uppercase tracking-[0.15em] bg-[#0a0a0a] border-b border-[#1a1a1a]"
            data-tip="Temperature distribution from ensemble members">
            ENSEMBLE FORECAST
            {data.ensemble?.bmaBlend && (
              <span className="text-[7px] text-[#555] ml-2 font-normal normal-case tracking-normal">
                BMA {data.ensemble.bmaBlend.ensFraction} ens / {data.ensemble.bmaBlend.detFraction} det
              </span>
            )}
          </div>
          <EnsembleChart data={data} />
        </div>
        <div className="bg-[#050505]">
          <div className="px-2 py-1 text-[9px] font-bold text-[#ff8c00] uppercase tracking-[0.15em] bg-[#0a0a0a] border-b border-[#1a1a1a]"
            data-tip="Max temperature predictions from independent weather models">
            MULTI-MODEL COMPARISON
            {data.modelConfig?.region && (
              <span className="text-[7px] text-[#444] ml-2 font-normal normal-case tracking-normal">
                {data.modelConfig.region.replace(/_/g, ' ')}
              </span>
            )}
          </div>
          <ModelBars data={data} />
        </div>
      </div>

      {/* Base Rate + Reasoning */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-[1px]">
        <div className="bg-[#050505]">
          <div className="px-2 py-1 text-[9px] font-bold text-[#ff8c00] uppercase tracking-[0.15em] bg-[#0a0a0a] border-b border-[#1a1a1a]"
            data-tip="Historical temperature threshold exceedance rate">
            HISTORICAL BASE RATE
          </div>
          <BaseRateChart data={data} />
        </div>
        <div className="bg-[#050505]">
          <div className="px-2 py-1 text-[9px] font-bold text-[#ff8c00] uppercase tracking-[0.15em] bg-[#0a0a0a] border-b border-[#1a1a1a]"
            data-tip="Detailed analysis reasoning log">
            ANALYSIS LOG
          </div>
          <pre className="reasoning-block">{e.reasoning || data.error || 'Analysis complete.'}</pre>
        </div>
      </div>
    </div>
  );
}

// ── Ensemble Chart — bracket probability bars ──
function EnsembleChart({ data }: { data: AnalysisData }) {
  const bp = data.ensemble?.bracketProbabilities || (data.edge as any)?.bracketProbabilities;
  if (!bp || bp.length === 0) return <div className="p-2 text-[9px] text-[#333]">No ensemble data</div>;

  const maxProb = Math.max(...bp.map((b: BracketProbability) => Math.max(b.forecastProb || 0, b.marketPrice || 0)), 0.01);
  const memberCount = data.ensemble?.memberCount;
  const spread = data.ensemble?.averageSpread;

  return (
    <div className="px-2 py-1">
      {bp.map((b: BracketProbability, i: number) => {
        const fcPct = ((b.forecastProb || 0) / maxProb) * 100;
        const mktPct = ((b.marketPrice || 0) / maxProb) * 100;
        const edge = (b.forecastProb || 0) - (b.marketPrice || 0);
        const isPositiveEdge = edge > 0.02;
        const isNegativeEdge = edge < -0.02;
        const name = b.name || b.title || `Bracket ${i}`;
        return (
          <div key={name} className="flex items-center gap-[4px] py-[2px]">
            <span className={`text-[7px] w-[45px] truncate font-semibold ${isPositiveEdge ? 'text-[#00ff41]' : isNegativeEdge ? 'text-[#ff3333]' : 'text-[#555]'}`}>{name}</span>
            <div className="flex-1 flex flex-col gap-[1px]">
              <div className="h-[4px] bg-[#111] overflow-hidden" title={`Forecast: ${((b.forecastProb || 0) * 100).toFixed(1)}%`}>
                <div className="h-full bg-[#00bcd4] transition-all" style={{ width: `${fcPct}%` }} />
              </div>
              <div className="h-[3px] bg-[#111] overflow-hidden" title={`Market: ${((b.marketPrice || 0) * 100).toFixed(1)}%`}>
                <div className="h-full bg-[#ff8c00]/50 transition-all" style={{ width: `${mktPct}%` }} />
              </div>
            </div>
            <span className={`text-[8px] font-bold w-[32px] text-right ${isPositiveEdge ? 'text-[#00ff41]' : isNegativeEdge ? 'text-[#ff3333]' : 'text-[#444]'}`}>
              {((b.forecastProb || 0) * 100).toFixed(0)}%
            </span>
          </div>
        );
      })}
      <div className="flex items-center gap-3 mt-1 pt-1 border-t border-[#111]">
        <span className="text-[7px] text-[#444]">■ <span className="text-[#00bcd4]">FCST</span> ■ <span className="text-[#ff8c00]">MKT</span></span>
        {memberCount != null && <span className="text-[7px] text-[#444]">{memberCount} members</span>}
        {spread != null && <span className="text-[7px] text-[#444]">σ {spread.toFixed(1)}°C</span>}
      </div>
    </div>
  );
}

// ── Base Rate Chart — historical temp distribution ──
function BaseRateChart({ data }: { data: AnalysisData }) {
  const br = data.baseRate;
  if (!br?.values?.length) return <div className="h-[120px] p-2 flex items-center justify-center text-[9px] text-[#333]">No historical data</div>;

  const values = br.values.filter((v: number) => v != null).sort((a: number, b: number) => a - b);
  const min = Math.floor(values[0]);
  const max = Math.ceil(values[values.length - 1]);
  const range = max - min || 1;
  const bucketCount = Math.min(range + 1, 30);
  const bucketSize = range / bucketCount;
  const buckets: number[] = new Array(bucketCount).fill(0);
  for (const v of values) { const idx = Math.min(Math.floor((v - min) / bucketSize), bucketCount - 1); buckets[idx]++; }
  const maxBucket = Math.max(...buckets, 1);
  const median = values[Math.floor(values.length / 2)];

  const BAR_H = 80; // container height in px

  return (
    <div className="px-2 py-1">
      <div className="flex items-end gap-[1px]" style={{ height: BAR_H }}>
        {buckets.map((count: number, i: number) => {
          const pct = count / maxBucket;
          const barH = count > 0 ? Math.max(pct * BAR_H, 2) : 0;
          const temp = min + i * bucketSize;
          return (
            <div key={i} className="flex-1 flex flex-col justify-end h-full" title={`${temp.toFixed(0)}–${(temp + bucketSize).toFixed(0)}°C: ${count} obs`}>
              <div className="bg-[#ff8c00]/60 hover:bg-[#ff8c00] transition-colors w-full"
                style={{ height: `${barH}px` }} />
            </div>
          );
        })}
      </div>
      <div className="flex justify-between text-[7px] text-[#444] mt-1">
        <span>{min}°C</span><span>MED {median.toFixed(1)}°C</span><span>{max}°C</span>
      </div>
      {br.rate != null && (
        <p className="text-[9px] text-[#888] mt-1">
          <strong className="text-[#ff8c00]">{(br.rate * 100).toFixed(0)}%</strong> exceeded threshold │{' '}
          <strong className="text-[#ccc]">{br.sampleSize}</strong> obs │ ~{br.years}y
        </p>
      )}
    </div>
  );
}

// ── Model Bars — with weights ──
function ModelBars({ data }: { data: AnalysisData }) {
  const mm = data.multiModel;
  if (!mm?.consensus?.predictions) return <div className="p-2 text-[9px] text-[#333]">No data</div>;
  const preds = mm.consensus.predictions.filter((p: any) => p.maxTemp != null);
  if (preds.length === 0) return <div className="p-2 text-[9px] text-[#333]">No data</div>;
  const maxT = Math.max(...preds.map((p: any) => p.maxTemp || 0), 1);
  const sorted = [...preds].sort((a: any, b: any) => (b.weight || 1) - (a.weight || 1));

  return (
    <div>
      {sorted.map((p: any) => {
        const pctVal = ((p.maxTemp || 0) / (maxT * 1.15)) * 100;
        const modelName = p.model.replace('_seamless','').replace('_ifs025',' IFS').replace('_aifs025',' AIFS').toUpperCase();
        const wt = p.weight ?? 1;
        const wtColor = wt >= 1.3 ? 'text-[#00ff41] border-[#00ff41]/30' : wt >= 1.0 ? 'text-[#ff8c00] border-[#ff8c00]/30' : 'text-[#555] border-[#333]';
        return (
          <div key={p.model} className="flex items-center gap-[4px] px-2 py-[2px]">
            <span className="text-[8px] text-[#666] w-[55px] truncate font-semibold">{modelName}</span>
            <span className={`text-[7px] font-bold w-[22px] text-center border px-[2px] py-[0px] ${wtColor}`}
              title={`Weight: ${wt.toFixed(1)}x`}>{wt.toFixed(1)}</span>
            <div className="flex-1 h-[6px] bg-[#111] overflow-hidden">
              <div className={`h-full transition-all ${p.exceedsThreshold ? 'bg-[#00ff41]' : 'bg-[#ff3333]'}`} style={{ width: `${pctVal}%` }} />
            </div>
            <span className={`text-[10px] font-bold w-[45px] text-right ${p.exceedsThreshold ? 'text-[#00ff41]' : 'text-[#ff3333]'}`}>
              {p.maxTemp != null ? `${p.maxTemp.toFixed(1)}°C` : '--'}
            </span>
          </div>
        );
      })}
      <div className="text-[8px] text-[#444] text-center py-[3px] border-t border-[#111]">
        {mm.consensus.isWeighted ? 'WEIGHTED ' : ''}{(mm.consensus.agreementRatio * 100).toFixed(0)}% consensus {mm.consensus.allAgree ? '│ UNANIMOUS' : '│ DIVERGENT'}
        {mm.consensus.medianTemp != null && ` │ MED ${mm.consensus.medianTemp.toFixed(1)}°C`}
      </div>
    </div>
  );
}

// ── Strategy header row ──
function StratHeader({ headers }: { headers: string[] }) {
  return (
    <div className="grid grid-cols-7 gap-0 px-2 py-[2px] border-b border-[#111] min-w-[340px]">
      {headers.map((h, i) => (
        <span key={h} className={`${i === 0 ? 'text-left' : 'text-right'} text-[#333] text-[7px] font-bold uppercase`}
          title={TOOLTIPS[h] || ''}>{h}</span>
      ))}
    </div>
  );
}

// ── Strategy Panel — full restoration ──
function StrategyPanel({ data }: { data: AnalysisData }) {
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
    <div className="bg-[#050505]" id="panel-strategy">
      <div className="px-2 py-1 text-[9px] font-bold text-[#ff8c00] uppercase tracking-[0.15em] bg-[#0a0a0a] border-b border-[#1a1a1a] flex items-center gap-1.5"
        data-tip="Kelly Criterion position sizing">
        TRADING STRATEGY <span className="text-[7px] border border-[#ff8c00] px-1 py-[1px] text-[#ff8c00]">KELLY</span>
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
      )}

      {/* FADE — Overpriced (Buy NO) */}
      {(strat.overpricedNoBets || []).length > 0 && (
        <div className="text-[8px]">
          <div className="px-2 py-[2px] font-bold text-[#bb86fc] uppercase tracking-[0.1em] border-b border-[#111]">▼ FADE — Overpriced (Buy NO)</div>
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
      )}

      {/* NO — Safe Premium */}
      {strat.noBets.length > 0 && (
        <div className="text-[8px]">
          <div className="px-2 py-[2px] font-bold text-[#ff3333] uppercase tracking-[0.1em] border-b border-[#111]">▼ NO — Safe Premium</div>
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
      )}

      {/* LONGSHOTS */}
      {strat.longshots.length > 0 && (
        <div className="text-[8px]">
          <div className="px-2 py-[2px] font-bold text-[#ff8c00] uppercase tracking-[0.1em] border-b border-[#111]">◆ LONGSHOTS</div>
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
        <div className="flex h-[4px] mt-[3px] overflow-hidden" title="Portfolio allocation breakdown">
          <div className="bg-[#00ff41]" style={{ width: `${strat.summary.totalYesPct / totalDeployed * 100}%` }} />
          <div className="bg-[#bb86fc]" style={{ width: `${fadePct / totalDeployed * 100}%` }} />
          <div className="bg-[#ff3333]" style={{ width: `${strat.summary.totalNoPct / totalDeployed * 100}%` }} />
          <div className="bg-[#ff8c00]" style={{ width: `${strat.summary.totalLongshotPct / totalDeployed * 100}%` }} />
        </div>
        <div className="flex items-center gap-2 px-2 py-[3px] text-[8px] text-[#666] flex-wrap">
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
