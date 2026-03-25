'use client';

import { useMemo, useState, useCallback } from 'react';
import type { AnalysisData, City, Market, Outcome, BracketProbability, AdvancedFactor } from '@/types';
import { TOOLTIPS } from '@/lib/helpers';

// ── Panel components ──
import MetricTile from './panels/MetricTile';
import StrategyPanel from './panels/StrategyPanel';
import EnsembleChart from './panels/EnsembleChart';
import ModelBarsPanel from './panels/ModelBarsPanel';
import AdvancedFactorsPanel from './panels/AdvancedFactorsPanel';
import FactorShiftsPanel from './panels/FactorShiftsPanel';
import AtmosphericPanel from './panels/AtmosphericPanel';
import BaseRateChart from './panels/BaseRateChart';

// ── Utility functions ──
function edgeColor(v: number | null | undefined) {
  if (v == null) return 'text-[#555]';
  return v > 0 ? 'text-[#00ff41]' : v < 0 ? 'text-[#ff3333]' : 'text-[#555]';
}

function fmtEdge(v: number | string | null | undefined) {
  if (v == null) return '--';
  const n = typeof v === 'string' ? parseFloat(v) : v;
  if (isNaN(n)) return '--';
  return (n > 0 ? '+' : '') + (typeof v === 'string' ? v : n.toFixed(1)) + '%';
}

// ── Section header component ──
function SectionHeader({ title, badge, children, tip }: {
  title: string;
  badge?: React.ReactNode;
  children?: React.ReactNode;
  tip?: string;
}) {
  return (
    <div className="section-header px-2 py-1.5 text-[9px] font-bold text-[#ff8c00] uppercase tracking-[0.15em] bg-[#0a0a0a] border-b border-[#1a1a1a] border-l-2 border-l-[#ff8c00] flex items-center gap-2"
      data-tip={tip}>
      {title}
      {badge}
      {children}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
//  AnalysisView — orchestrator component
// ════════════════════════════════════════════════════════════════
export default function AnalysisView({ data, city, market: marketOverride }: {
  data: AnalysisData;
  city?: City;
  market?: Market | null;
}) {
  const e: any = data.edge || {};
  const div = data.modelDivergence || (e as any).modelDivergence;
  const polyUrl = data.market?.polymarketUrl || marketOverride?.polymarketUrl || '';

  // Station info
  const lw = data.liveWeather;
  const stationInfo = data.city;

  // ── Bracket probabilities ──
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
  const preFactorBp = (data.ensemble as any)?.preFactorBracketProbabilities as BracketProbability[] | undefined;
  const factorShifts = data.factorAdjustment?.perBracket as { name: string; shift: number }[] | undefined;

  // ── Toggleable Factor System ──
  const [disabledFactors, setDisabledFactors] = useState<Set<string>>(new Set());
  const toggleFactor = useCallback((factorName: string) => {
    setDisabledFactors(prev => {
      const next = new Set(prev);
      if (next.has(factorName)) next.delete(factorName);
      else next.add(factorName);
      return next;
    });
  }, []);

  const hasCustomToggles = disabledFactors.size > 0;

  // Recalculate bracket probabilities when factors are toggled
  const adjustedBp = useMemo(() => {
    if (!bp) return bp;
    if (!hasCustomToggles || !preFactorBp || !factorShifts) return bp;

    const factors = data.advancedFactors?.factors || [];
    const activeFx = factors.filter((f: AdvancedFactor) => Math.abs(f.adjustment) > 0.01 && f.confidence > 0.1);
    const enabledFx = activeFx.filter((f: AdvancedFactor) => !disabledFactors.has(f.factor));

    const totalWeight = activeFx.reduce((s: number, f: AdvancedFactor) => s + Math.abs(f.adjustment * f.confidence), 0);
    const enabledWeight = enabledFx.reduce((s: number, f: AdvancedFactor) => s + Math.abs(f.adjustment * f.confidence), 0);
    const scaleFactor = totalWeight > 0 ? enabledWeight / totalWeight : 0;

    return preFactorBp.map((pfb: BracketProbability) => {
      const shift = factorShifts.find((s: any) => s.name === pfb.name || s.name === (pfb as any).title);
      const scaledShift = shift ? shift.shift * scaleFactor : 0;
      const adjustedProb = Math.max(0, (pfb.forecastProb || 0) + scaledShift);
      return {
        ...pfb,
        forecastProb: adjustedProb,
        edge: adjustedProb - (pfb.marketPrice || 0),
      };
    });
  }, [bp, preFactorBp, factorShifts, disabledFactors, hasCustomToggles, data.advancedFactors]);

  // Custom net adjustment reflecting enabled factors only
  const customNetAdj = useMemo(() => {
    if (!hasCustomToggles || !data.advancedFactors) return null;
    const factors = data.advancedFactors.factors || [];
    const activeFx = factors.filter((f: AdvancedFactor) => Math.abs(f.adjustment) > 0.01 && f.confidence > 0.1);
    const enabledFx = activeFx.filter((f: AdvancedFactor) => !disabledFactors.has(f.factor));
    const totalConfWeight = enabledFx.reduce((s: number, f: AdvancedFactor) => s + f.confidence, 0);
    return totalConfWeight > 0
      ? enabledFx.reduce((s: number, f: AdvancedFactor) => s + f.adjustment * f.confidence, 0) / totalConfWeight
      : 0;
  }, [data.advancedFactors, disabledFactors, hasCustomToggles]);

  // Find best edge bracket
  const bestEdgeName = useMemo(() => {
    const probs = adjustedBp || bp;
    if (!probs) return null;
    let name: string | null = null;
    let bestEdge = -Infinity;
    for (const b of probs) {
      const edge = b.edge ?? ((b.forecastProb || 0) - (b.marketPrice || 0));
      if (edge > bestEdge) { bestEdge = edge; name = b.name || b.title || null; }
    }
    return name;
  }, [adjustedBp, bp]);

  // Find bracket names with highest ENS, BMA, and FINAL probability values
  const { maxEnsName, maxBmaName, maxFinalName } = useMemo(() => {
    let maxEns = -1, maxBma = -1, maxFinal = -1;
    let ensName: string | null = null, bmaName: string | null = null, finalName: string | null = null;
    const probs = adjustedBp || bp;
    for (const o of outcomes) {
      const name = o.name || o.title || '';
      const rb = rawBp?.find((p: BracketProbability) => p.name === name || p.title === name);
      const pfb = preFactorBp?.find((p: BracketProbability) => p.name === name || p.title === name);
      const b = probs?.find((p: BracketProbability) => p.name === name || p.title === name);
      const ensVal = rb?.forecastProb ?? -1;
      const bmaVal = pfb?.forecastProb ?? b?.forecastProb ?? -1;
      const finalVal = b?.forecastProb ?? -1;
      if (ensVal > maxEns) { maxEns = ensVal; ensName = name; }
      if (bmaVal > maxBma) { maxBma = bmaVal; bmaName = name; }
      if (finalVal > maxFinal) { maxFinal = finalVal; finalName = name; }
    }
    return { maxEnsName: ensName, maxBmaName: bmaName, maxFinalName: finalName };
  }, [outcomes, rawBp, preFactorBp, adjustedBp, bp]);

  // ════════════════════════════════════════════════════════════
  //  RENDER — Professional analysis flow
  // ════════════════════════════════════════════════════════════
  return (
    <div className="flex flex-col gap-[1px]" id="analysis-content">

      {/* ─── 1. Signal Hero + Station Header ─── */}
      <div className="bg-[#050505] border-b border-[#111] p-2" id="panel-signal">
        <div className="flex flex-col sm:flex-row items-start justify-between gap-[10px]">
          <div className="min-w-0">
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

      {/* ─── 2. Bracket Outcomes (full width) ─── */}
      <div className="bg-[#050505]" id="panel-brackets">
        <SectionHeader
          title="BRACKET OUTCOMES"
          tip="All temperature brackets showing probability at each analysis stage"
          badge={
            <>
              {data.factorAdjustment && (
                <span className={`text-[7px] font-bold ${data.factorAdjustment.shiftDirection === 'WARMING' ? 'text-[#ff3333]' : 'text-[#00bcd4]'}`}>
                  {data.factorAdjustment.shiftDirection} {data.factorAdjustment.effectiveShift > 0 ? '+' : ''}{data.factorAdjustment.effectiveShift.toFixed(2)}°C
                </span>
              )}
              {hasCustomToggles && (
                <span className="text-[7px] border border-[#ff8c00]/50 px-1.5 py-[1px] text-[#ff8c00] bg-[#ff8c00]/10 tracking-wider font-bold animate-pulse">
                  CUSTOM
                </span>
              )}
            </>
          }
        />
        {outcomes.length > 0 && (
          <div className="w-full text-[10px] px-2 pb-1.5 mobile-scroll-wrapper" id="outcomes-list">
            {/* Header */}
            <div className="grid grid-cols-[1fr_36px_36px_36px_36px_44px_32px_24px] sm:grid-cols-[1fr_40px_40px_40px_40px_48px_36px_28px] py-[4px] border-b border-[#333] text-[7px] text-[#555] uppercase tracking-[0.1em] font-bold min-w-[340px]">
              <span className="cursor-help" data-tip={TOOLTIPS['OUTCOME']}>OUTCOME</span>
              <span className="text-right cursor-help" data-tip={TOOLTIPS['MKT']}>MKT</span>
              <span className="text-right cursor-help" data-tip="Raw ensemble-only KDE probability">ENS</span>
              <span className="text-right cursor-help" data-tip="BMA-blended weighted model probability (before advanced factors)">BMA</span>
              <span className="text-right cursor-help" data-tip="Final probability after all factors (weighted models + PhD analysis)">FINAL</span>
              <span className="text-right cursor-help" data-tip={TOOLTIPS['EDGE']}>EDGE</span>
              <span className="text-right cursor-help" data-tip="Probability change from advanced factor adjustment">Δ</span>
              <span data-tip="Edge strength visualization"></span>
            </div>
            {/* Rows */}
            {outcomes.map((o: Outcome, rowIdx: number) => {
              const b = (adjustedBp || bp)?.find((p: BracketProbability) => p.name === o.name || p.title === o.title);
              const rb = rawBp?.find((p: BracketProbability) => p.name === o.name || p.title === o.title);
              const pfb = preFactorBp?.find((p: BracketProbability) => p.name === o.name || p.title === o.title);

              const mkt = (o.price * 100).toFixed(0);
              const ens = rb?.forecastProb != null ? (rb.forecastProb * 100).toFixed(0) : '--';
              const bmaProb = pfb?.forecastProb ?? b?.forecastProb ?? null;
              const bma = bmaProb != null ? (bmaProb * 100).toFixed(0) : '--';
              const finalProb = b?.forecastProb ?? null;
              const final_ = finalProb != null ? (finalProb * 100).toFixed(0) : '--';
              const hasDelta = pfb?.forecastProb != null && b?.forecastProb != null;
              const delta = hasDelta ? (b!.forecastProb! - pfb!.forecastProb!) * 100 : 0;
              const deltaStr = hasDelta ? (delta > 0 ? '+' : '') + delta.toFixed(1) : '--';
              const deltaColor = delta > 0.5 ? 'text-[#00ff41]' : delta < -0.5 ? 'text-[#ff3333]' : 'text-[#444]';

              const edg = b?.edge != null ? (b.edge * 100).toFixed(1) : (finalProb != null ? ((finalProb - o.price) * 100).toFixed(1) : '--');
              const edgVal = parseFloat(edg);
              const isBest = !!(bestEdgeName && (o.name === bestEdgeName || o.title === bestEdgeName));
              const absEdge = Math.min(Math.abs(edgVal) || 0, 30);
              const barWidth = (absEdge / 30 * 100).toFixed(0);
              const barColor = edgVal > 0 ? 'bg-[#00ff41]' : edgVal < 0 ? 'bg-[#ff3333]' : '';
              const bestBorder = isBest ? 'border-l-2 border-l-[#ff8c00] bg-[#ff8c00]/[0.05] pl-[2px]' : '';

              return (
                <div
                  key={o.tokenId || o.name}
                  className={`grid grid-cols-[1fr_36px_36px_36px_36px_44px_32px_24px] sm:grid-cols-[1fr_40px_40px_40px_40px_48px_36px_28px] py-[3px] border-b border-[#0a0a0a] items-center transition-colors hover:bg-[#111] min-w-[340px] ${bestBorder} ${rowIdx % 2 === 1 ? 'bg-[#060606]' : ''}`}
                  data-token-id={o.tokenId || ''}
                  data-tip={isBest ? 'Best trading opportunity based on edge size' : `${o.name || o.title} temperature bracket`}
                >
                  <span className="text-[#ccc] truncate text-[9px]">
                    {isBest && <span className="text-[#ff8c00] text-[7px] mr-[2px]">◆</span>}
                    {o.name || o.title}
                  </span>
                  <span className="font-semibold text-right text-[#555] price-cell text-[9px]" data-tip={`YES price: ${mkt}¢`}>
                    {mkt}¢
                  </span>
                  <span className={`font-semibold text-right text-[9px] ${(o.name || o.title) === maxEnsName ? 'text-[#bb86fc] bg-[#bb86fc]/15 px-[2px] rounded-sm font-bold' : 'text-[#bb86fc]'}`} data-tip={`Raw ensemble KDE: ${ens}%`}>
                    {ens}%
                  </span>
                  <span className={`font-semibold text-right text-[9px] ${(o.name || o.title) === maxBmaName ? 'text-[#00bcd4] bg-[#00bcd4]/15 px-[2px] rounded-sm font-bold' : 'text-[#00bcd4]'}`} data-tip={`BMA-blended (before factors): ${bma}%`}>
                    {bma}%
                  </span>
                  <span className={`font-bold text-right text-[9px] ${(o.name || o.title) === maxFinalName ? 'text-[#ff8c00] bg-[#ff8c00]/15 px-[2px] rounded-sm' : 'text-[#fff]'}`} data-tip={`Final (models + factors): ${final_}%`}>
                    {final_}%
                  </span>
                  <span className={`font-semibold text-right text-[8px] ${edgeColor(edgVal)}`}
                    data-tip={`Edge: FINAL (${final_}%) minus MKT (${mkt}%)`}>
                    {edgVal > 0 ? '+' : ''}{edg}%
                  </span>
                  <span className={`font-semibold text-right text-[8px] ${deltaColor}`}
                    data-tip={`Factor adjustment: ${deltaStr}%`}>
                    {deltaStr}%
                  </span>
                  <span className="px-[2px]">
                    <span className="block w-full h-[3px] bg-[#111] rounded-sm overflow-hidden">
                      <span className={`block h-full ${barColor} transition-all`} style={{ width: `${barWidth}%` }} />
                    </span>
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ─── 3. Trading Strategy (full width) ─── */}
      <StrategyPanel data={data} />

      {/* ─── 4. Ensemble + Multi-Model (side by side) ─── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-[1px]" id="panel-row-charts">
        <div className="bg-[#050505]">
          <SectionHeader title="ENSEMBLE FORECAST" tip="Temperature distribution from ensemble members">
            {data.ensemble?.bmaBlend && (
              <span className="text-[7px] text-[#555] ml-2 font-normal normal-case tracking-normal">
                BMA {data.ensemble.bmaBlend.ensFraction} ens / {data.ensemble.bmaBlend.detFraction} det
              </span>
            )}
          </SectionHeader>
          <EnsembleChart data={data} />
        </div>
        <div className="bg-[#050505]">
          <SectionHeader title="MULTI-MODEL COMPARISON" tip="Max temperature predictions from independent weather models">
            {data.modelConfig?.region && (
              <span className="text-[7px] text-[#444] ml-2 font-normal normal-case tracking-normal">
                {data.modelConfig.region.replace(/_/g, ' ')}
              </span>
            )}
          </SectionHeader>
          <ModelBarsPanel data={data} />
        </div>
      </div>

      {/* ─── 5. Advanced Factors ─── */}
      {data.advancedFactors && (
        <div className="bg-[#050505]" id="panel-factors">
          <SectionHeader title="ADVANCED FACTORS" tip="PhD-level weather analysis factors adjusting the forecast">
            <span className="text-[7px] border border-[#bb86fc]/40 px-1.5 py-[1px] text-[#bb86fc] bg-[#bb86fc]/5 tracking-wider font-bold">PhD</span>
            {data.advancedFactors.netAdjustment !== 0 && (
              <span className={`text-[8px] font-bold ${data.advancedFactors.netAdjustment > 0 ? 'text-[#ff3333]' : 'text-[#00bcd4]'}`}>
                NET {data.advancedFactors.netAdjustment > 0 ? '+' : ''}{data.advancedFactors.netAdjustment.toFixed(2)}°C
              </span>
            )}
            <span className="text-[7px] text-[#444] font-normal normal-case">
              {data.advancedFactors.activeFactorCount}/{data.advancedFactors.factors.length} active
            </span>
          </SectionHeader>
          <AdvancedFactorsPanel factors={data.advancedFactors} disabledFactors={disabledFactors} onToggle={toggleFactor} customNetAdj={customNetAdj} />
        </div>
      )}

      {/* ─── 6. Factor Probability Shifts ─── */}
      {data.factorAdjustment && (
        <div className="bg-[#050505]" id="panel-factor-shifts">
          <SectionHeader title="FACTOR PROBABILITY SHIFTS" tip="How advanced factors shifted bracket probabilities">
            <span className={`text-[8px] font-bold ${data.factorAdjustment.shiftDirection === 'WARMING' ? 'text-[#ff3333]' : 'text-[#00bcd4]'}`}>
              {data.factorAdjustment.shiftDirection} {data.factorAdjustment.effectiveShift > 0 ? '+' : ''}{data.factorAdjustment.effectiveShift.toFixed(2)}°C
            </span>
          </SectionHeader>
          <FactorShiftsPanel breakdown={data.factorAdjustment} />
        </div>
      )}

      {/* ─── 7. Atmospheric + Base Rate (side by side) ─── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-[1px]">
        {data.atmospheric && (
          <div className="bg-[#050505]" id="panel-atmospheric">
            <SectionHeader title="ATMOSPHERIC CONDITIONS" tip="Current atmospheric conditions used by the analysis" />
            <AtmosphericPanel atmospheric={data.atmospheric} airQuality={data.airQuality} />
          </div>
        )}
        <div className="bg-[#050505]">
          <SectionHeader title="HISTORICAL BASE RATE" tip="Historical temperature threshold exceedance rate" />
          <BaseRateChart data={data} />
        </div>
      </div>

      {/* ─── 8. Analysis Log (full width) ─── */}
      <div className="bg-[#050505]">
        <SectionHeader title="ANALYSIS LOG" tip="Detailed analysis reasoning log" />
        <pre className="reasoning-block">{e.reasoning || data.error || 'Analysis complete.'}</pre>
      </div>
    </div>
  );
}
