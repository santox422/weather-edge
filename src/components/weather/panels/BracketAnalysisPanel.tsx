'use client';

/**
 * BracketAnalysisPanel — the core bracket probability table.
 *
 * ═══════════════════════════════════════════════════════════════
 *  PROBABILITY PIPELINE (columns left to right)
 * ═══════════════════════════════════════════════════════════════
 *
 *  OUTCOME │ MKT │ ENS │ BMA │ [per-model] │ ENS+PhD │ BMA+PhD │ EDGE │ BAR
 *
 *  ENS      = Raw ensemble KDE (Gaussian kernel density over member maxima)
 *  BMA      = Bayesian Model Averaging (ensemble KDE + deterministic models)
 *  ENS+PhD  = ENS after PhD factor adjustment via Re-KDE
 *  BMA+PhD  = BMA after PhD factor adjustment + METAR constraint (final)
 *  EDGE     = BMA+PhD − MKT (trading opportunity)
 *
 * ═══════════════════════════════════════════════════════════════
 *  DECOMPOSITION
 * ═══════════════════════════════════════════════════════════════
 *
 *  This component composes:
 *    - useBracketRecalculation  — client-side BMA recalc for custom overrides
 *    - useBracketHighlights     — peak/best-edge bracket detection
 *    - ModelControlsBar         — model toggle/weight cards
 *    - BracketExpandedDrawer    — per-model + factor detail row
 *    - Toggle (shared UI)       — compact on/off switch
 *    - constants.ts             — shared tooltips, colors, factor metadata
 *    - model-helpers.ts         — model name formatting, ENS member counting
 */

import React, { useMemo, useState, useCallback } from 'react';
import type {
  AnalysisData, Outcome, BracketProbability, PerModelBracket, PerModelBracketProb,
} from '@/types';
import { useBracketRecalculation } from './bracket/useBracketRecalculation';
import { useBracketHighlights } from './bracket/useBracketHighlights';
import BracketExpandedDrawer from './bracket/BracketExpandedDrawer';
import { edgeColorClass, getModelColor, BRACKET_TIPS } from '@/lib/analysis/constants';

// ════════════════════════════════════════════════════════════════
//  BracketAnalysisPanel
// ════════════════════════════════════════════════════════════════
export default function BracketAnalysisPanel({ 
  data, 
  enforceMetar, 
  disabledModels, 
  weightOverrides 
}: { 
  data: AnalysisData, 
  enforceMetar: boolean, 
  disabledModels: Set<string>, 
  weightOverrides: Record<string, number> 
}) {
  const e = data.edge || {};

  /* ── Sorted outcomes ── */
  const rawOutcomes = data.market?.outcomes || [];
  const outcomes = useMemo(() => [...rawOutcomes].sort((a: Outcome, b: Outcome) => {
    if (a.threshold?.type === 'below') return -1;
    if (b.threshold?.type === 'below') return 1;
    if (a.threshold?.type === 'above') return 1;
    if (b.threshold?.type === 'above') return -1;
    return (a.threshold?.value ?? 999) - (b.threshold?.value ?? 999);
  }), [rawOutcomes]);

  /* ── Data layers from server ── */
  const rawBp: BracketProbability[] | undefined = data.ensemble?.rawBracketProbabilities;
  const perModel: PerModelBracket[] = data.perModelBrackets || [];
  const factorShifts = data.factorAdjustment?.perBracket;

  /* ── State — expand/collapse ── */
  const [expandedBrackets, setExpandedBrackets] = useState<Set<string>>(new Set());

  const toggleExpand = useCallback((n: string) => {
    setExpandedBrackets(p => { const s = new Set(p); s.has(n) ? s.delete(n) : s.add(n); return s; });
  }, []);

  const hasCustomModels = disabledModels.size > 0 || Object.keys(weightOverrides).length > 0;

  /* ── Client-side recalculation (custom overrides only) ── */
  const {
    displayNetAdj, ensPhd, displayBma, displayBmaPhd,
  } = useBracketRecalculation({
    data, outcomes, perModel, disabledModels, weightOverrides, hasCustomModels, enforceMetar
  });

  /* ── Highlight peaks ── */
  const { maxEnsName, maxBmaName, maxEnsPhdName, maxBmaPhdName, bestEdgeName } = useBracketHighlights({
    outcomes, rawBp, displayBma, ensPhd, displayBmaPhd,
  });

  /* ── Derived display values ── */
  const shiftDir = displayNetAdj > 0.01 ? 'WARMING' : displayNetAdj < -0.01 ? 'COOLING' : null;
  const hasPhd = !!data.advancedFactors && (!!factorShifts || !!ensPhd || !!data.factorAdjustment);
  const baseColCount = 4 + (hasPhd ? 2 : 0) + 2;
  const totalCols = baseColCount;
  const minW = '520px';

  if (outcomes.length === 0) return null;

  /* ════════════════════════════════════════════════════════════
     RENDER
     ════════════════════════════════════════════════════════════ */
  return (
    <div className="analysis-card" id="panel-brackets-v2">

      {/* ━━━ HEADER ━━━ */}
      <div className="section-header"
        data-tip="Probability pipeline: Raw ENS KDE → BMA blend (weighted models) → PhD factor shifts → METAR constraints. All stages shown as separate columns.">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span>BRACKET OUTCOMES</span>
          {shiftDir && (
            <span className={`text-[7px] font-bold ${shiftDir === 'WARMING' ? 'text-[#ff3333]' : 'text-[#00bcd4]'}`}
              data-tip={`PhD factors shift: ${displayNetAdj > 0 ? '+' : ''}${displayNetAdj.toFixed(2)}°C. ${shiftDir === 'WARMING' ? 'Pushes probability toward higher brackets' : 'Pushes probability toward lower brackets'}.`}>
              {shiftDir} {displayNetAdj > 0 ? '+' : ''}{displayNetAdj.toFixed(2)}°C
            </span>
          )}
          {hasCustomModels && (
            <span className="text-[7px] border border-[#ff8c00]/50 px-1 py-0 text-[#ff8c00] bg-[#ff8c00]/10 tracking-wider font-bold animate-pulse leading-3.5"
              data-tip={BRACKET_TIPS.CUSTOM}>CUSTOM</span>
          )}
        </div>
      </div>

      {/* ━━━ PROBABILITY TABLE ━━━ */}
      <div className="overflow-x-auto mobile-scroll-wrapper" id="bracket-scroll">
        <table className="w-full text-[9px] border-collapse" style={{ tableLayout: 'fixed', minWidth: minW }}>
          <colgroup>
            <col style={{ width: '22%' }} />
            <col style={{ width: '10%' }} />
            <col style={{ width: '10%' }} />
            <col style={{ width: '10%' }} />
            {hasPhd && <col style={{ width: '11%' }} />}
            {hasPhd && <col style={{ width: '11%' }} />}
            <col style={{ width: '11%' }} />
            <col style={{ width: '7%' }} />
          </colgroup>

          {/* ── Table header ── */}
          <thead>
            <tr className="border-b border-[#333] text-[7px] text-[#555] uppercase tracking-widest font-bold">
              <th className="text-left py-1.5 px-2" data-tip={BRACKET_TIPS.BRACKET}>OUTCOME</th>
              <th className="text-right py-1.5 px-2" data-tip={BRACKET_TIPS.MKT}>MKT</th>
              <th className="text-right py-1.5 px-2" data-tip={BRACKET_TIPS.ENS_RAW}>ENS</th>
              <th className="text-right py-1.5 px-2" data-tip={BRACKET_TIPS.BMA}>BMA</th>
              {hasPhd && <th className="text-right py-1.5 px-2" data-tip={BRACKET_TIPS.ENS_PHD}><span className="text-[#bb86fc]/70">ENS</span><span className="text-[#bb86fc]">+PhD</span></th>}
              {hasPhd && <th className="text-right py-1.5 px-2 font-extrabold" data-tip={BRACKET_TIPS.BMA_PHD}><span className="text-[#00bcd4]/70">BMA</span><span className="text-[#00bcd4]">+PhD</span></th>}
              <th className="text-right py-1.5 px-2" data-tip={BRACKET_TIPS.EDGE}>EDGE</th>
              <th className="py-1.5 px-1" data-tip={BRACKET_TIPS.BAR} />
            </tr>
          </thead>

          {/* ── Table body: one row per bracket outcome ── */}
          <tbody>
            {outcomes.map((o: Outcome, ri: number) => {
              const name = o.name || o.title || '';

              /* Look up each probability layer */
              const rb = rawBp?.find(p => p.name === name || p.title === name);
              const bma = displayBma?.find(p => p.name === name || p.title === name);
              const ep = ensPhd?.find(p => p.name === name || p.title === name);
              const bp = displayBmaPhd?.find(p => p.name === name || p.title === name);

              /* Format display values */
              const mkt = (o.price * 100).toFixed(0);
              const ens = rb?.forecastProb != null ? (rb.forecastProb * 100).toFixed(0) : '--';
              const bmaVal = bma?.forecastProb != null ? (bma.forecastProb * 100).toFixed(0) : '--';
              const ensPhdVal = ep?.forecastProb != null ? (ep.forecastProb * 100).toFixed(0) : '--';
              const bmaPhdVal = bp?.forecastProb != null ? (bp.forecastProb * 100).toFixed(0) : '--';

              /* Edge = BMA+PhD − MKT (the most complete probability) */
              const bmaPhdP = bp?.forecastProb ?? null;
              const edg = bp?.edge != null ? (bp.edge * 100).toFixed(1) : (bmaPhdP != null ? ((bmaPhdP - o.price) * 100).toFixed(1) : '--');
              const ev = parseFloat(edg);
              const isBest = bestEdgeName === name;
              const absE = Math.min(Math.abs(ev) || 0, 30);
              const barW = (absE / 30 * 100).toFixed(0);
              const barC = ev > 0 ? '#00ff41' : ev < 0 ? '#ff3333' : '#222';
              const isExp = expandedBrackets.has(name);
              const rowBg = isBest ? 'bg-[#ff8c00]/4' : ri % 2 === 1 ? 'bg-[#060606]' : '';
              const rowBorder = isBest ? 'border-l-2 border-l-[#ff8c00]' : '';

              return (
                <React.Fragment key={o.tokenId || name}>
                  <tr
                    className={`cursor-pointer transition-colors active:bg-[#1a1a1a] ${rowBg} ${rowBorder}`}
                    onClick={() => toggleExpand(name)}
                    data-tip={`${name}${isBest ? ' ◆ best edge' : ''} — click to expand`}
                  >
                    {/* OUTCOME */}
                    <td className="text-left py-1.5 px-2 whitespace-nowrap overflow-hidden text-ellipsis">
                      <span className="flex items-center gap-1.5">
                        <span className={`text-[7px] transition-transform inline-block ${isExp ? 'rotate-90' : ''}`}>▶</span>
                        {isBest && <span className="text-[#ff8c00] text-[7px]">◆</span>}
                        <span className="text-[#ccc] text-[9px]">{name}</span>
                      </span>
                    </td>
                    {/* MKT */}
                    <td className="text-right py-1.5 px-2 text-[#555] text-[9px] font-medium">{mkt}¢</td>
                    {/* ENS */}
                    <td className={`text-right py-1.5 px-2 text-[9px] font-semibold ${name === maxEnsName ? 'text-[#bb86fc] font-bold' : 'text-[#bb86fc]/70'}`}>{ens}%</td>
                    {/* BMA */}
                    <td className={`text-right py-1.5 px-2 text-[9px] font-semibold ${name === maxBmaName ? 'text-[#00bcd4] font-bold' : 'text-[#00bcd4]/70'}`}>{bmaVal}%</td>
                    {/* ENS+PhD */}
                    {hasPhd && (
                      <td className={`text-right py-1.5 px-2 text-[9px] font-semibold ${name === maxEnsPhdName ? 'text-[#bb86fc] font-bold' : 'text-[#9966cc]/70'}`}>{ensPhdVal}%</td>
                    )}
                    {/* BMA+PhD */}
                    {hasPhd && (
                      <td className={`text-right py-1.5 px-2 text-[10px] font-bold ${name === maxBmaPhdName ? 'text-[#ff8c00]' : 'text-[#eee]'}`}>{bmaPhdVal}%</td>
                    )}
                    {/* EDGE */}
                    <td className={`text-right py-1.5 px-2 text-[9px] font-bold ${edgeColorClass(ev)}`}>{ev > 0 ? '+' : ''}{edg}%</td>
                    {/* Bar */}
                    <td className="py-1.5 px-1">
                      <span className="block w-full h-1 bg-[#111] rounded-sm overflow-hidden">
                        <span className="block h-full rounded-sm transition-all" style={{ width: `${barW}%`, backgroundColor: barC }} />
                      </span>
                    </td>
                  </tr>

                  {/* ── Expanded detail drawer ── */}
                  {isExp && (
                    <tr>
                      <td colSpan={totalCols} className="p-0 border-b border-[#111]">
                        <BracketExpandedDrawer
                          name={name}
                          bmaVal={bmaVal}
                          data={data}
                          perModel={perModel}
                          disabledModels={disabledModels}
                          weightOverrides={weightOverrides}
                          displayNetAdj={displayNetAdj}
                          hasPhd={hasPhd}
                          outcome={o}
                        />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ━━━ FOOTER ━━━ */}
      <div className="px-2 py-1 bg-[#030303] border-t border-[#1a1a1a] flex items-center gap-2 flex-wrap text-[7px] text-[#555]"
        data-tip="Pipeline summary: models contributing to BMA, ensemble members, blend ratio, and active PhD factors.">
        <span className="font-bold uppercase tracking-wider">{perModel.filter(pm => !disabledModels.has(pm.model)).length}/{perModel.length} models</span>
        {data.ensemble?.memberMaxes && <span>{data.ensemble.memberMaxes.length} ENS</span>}
        {data.ensemble?.bmaBlend && <span>BMA {data.ensemble.bmaBlend.ensFraction}/{data.ensemble.bmaBlend.detFraction}</span>}
        {data.advancedFactors && <span className="text-[#bb86fc]">{data.advancedFactors.activeFactorCount}/{data.advancedFactors.factors.length} fx</span>}
      </div>
    </div>
  );
}
