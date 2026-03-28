'use client';

import React from 'react';
import type {
  AnalysisData, PerModelBracket, PerModelBracketProb, AdvancedFactor,
} from '@/types';
import {
  getModelColor, FACTOR_ICONS, FACTOR_SHORT, FACTOR_TIPS, BRACKET_TIPS,
} from '@/lib/analysis/constants';
import { formatModelLabel, countEnsembleMembersInBracket } from './model-helpers';

/**
 * BracketExpandedDrawer — the expandable detail row shown when a user
 * clicks a bracket in the probability table.
 *
 * Contains three sections:
 *   1. Per-model probability breakdown with toggle and weight display
 *   2. Factor impact (PhD factor contribution to this bracket)
 *   3. Ensemble member count in this bracket
 *
 * Previously embedded as lines 443-571 of BracketAnalysisPanel.
 */

interface DrawerProps {
  name: string;
  bmaVal: string;
  data: AnalysisData;
  perModel: PerModelBracket[];
  disabledModels: Set<string>;
  weightOverrides: Record<string, number>;
  displayNetAdj: number;
  hasPhd: boolean;
  outcome: { threshold?: { type: string; value: number; high?: number } | null };
}

export default function BracketExpandedDrawer({
  name,
  bmaVal,
  data,
  perModel,
  disabledModels,
  weightOverrides,
  displayNetAdj,
  hasPhd,
  outcome,
}: DrawerProps) {
  return (
    <div className="bg-[#020202] border-l-2 border-l-[#1a1a1a]">
      {/* ── 1. Per-model probability breakdown ── */}
      {perModel.length > 0 && (
        <div className="px-2 pt-1.5 pb-1">
          <div
            className="text-[7px] font-bold text-[#555] uppercase tracking-widest mb-1"
            data-tip="Individual model probabilities for this bracket. Each model's max temp is run through a Gaussian CDF (σ=0.7°C for 1-day lead) to get bracket probability. Toggle to include/exclude from BMA."
          >
            PER-MODEL PROBABILITIES
          </div>
          {perModel.map((pm) => {
            const br = pm.brackets?.find((x: PerModelBracketProb) => x.name === name);
            const p = br?.prob;
            const pStr = p != null ? (p * 100).toFixed(1) : '--';
            const w = weightOverrides[pm.model] ?? pm.weight;
            const off = disabledModels.has(pm.model);
            const allP = perModel
              .filter((m) => !disabledModels.has(m.model))
              .map((m) => m.brackets?.find((x: PerModelBracketProb) => x.name === name)?.prob || 0);
            const maxP = allP.length > 0 ? Math.max(...allP) : 0;
            const isMax = !off && p != null && p > 0 && Math.abs(p - maxP) < 0.001;
            const color = getModelColor(pm.model);

            return (
              <div
                key={pm.model}
                className={`flex items-center gap-1 py-0.75 ${off ? 'opacity-25' : isMax ? 'bg-[#00ff41]/3' : ''}`}
                data-tip={`${formatModelLabel(pm)}: prob=${pStr}%, weight=${w.toFixed(1)}, max=${pm.maxTemp?.toFixed(1) ?? '?'}°C. ${off ? 'DISABLED from BMA' : isMax ? '← Highest probability model' : ''}`}
              >
                <span className="text-[7px] font-bold w-[52px] truncate" style={{ color: off ? '#444' : color }}>
                  {pm.isEnsemble && '⚡'}{formatModelLabel(pm)}
                </span>
                <span className="text-[6px] w-[24px] text-right text-[#555]" data-tip={`BMA weight: ${w.toFixed(1)}`}>
                  {w.toFixed(1)}
                </span>
                <span className="text-[7px] text-[#666] w-[30px] text-right" data-tip={BRACKET_TIPS.MAX_T}>
                  {pm.maxTemp?.toFixed(1) ?? '—'}°
                </span>
                <span className={`text-[8px] font-semibold w-[32px] text-right ${off ? 'text-[#333]' : isMax ? 'text-[#00ff41] font-bold' : p != null && p > 0.15 ? 'text-[#ccc]' : 'text-[#555]'}`}>
                  {pStr}%
                </span>
                <div className="flex-1 h-0.75 bg-[#0a0a0a] rounded-sm overflow-hidden ml-1">
                  <div
                    className="h-full rounded-sm transition-all"
                    style={{
                      width: `${Math.min((p || 0) * 100, 100)}%`,
                      backgroundColor: off ? '#222' : isMax ? '#00ff41' : color,
                      opacity: off ? 0.3 : 0.6,
                    }}
                  />
                </div>
              </div>
            );
          })}
          <div
            className="flex items-center gap-1 pt-1 mt-0.5 border-t border-[#111] text-[7px]"
            data-tip={`BMA for ${name}: weighted avg of enabled models.`}
          >
            <span className="font-bold text-[#555] uppercase tracking-wider">→ BMA</span>
            <span className="text-[#00bcd4] font-bold">{bmaVal}%</span>
            <span className="text-[#333]">(weighted)</span>
          </div>
        </div>
      )}

      {/* ── 2. Factor impact ── */}
      {data.advancedFactors && hasPhd && (
        <div className="px-2 pt-1 pb-1.5 border-t border-[#0a0a0a]">
          <div
            className="text-[7px] font-bold text-[#555] uppercase tracking-widest mb-0.5"
            data-tip="PhD factor adjustments for this bracket. Each factor contributes adjustment°C × confidence to the net shift. The net shift is applied via Re-KDE."
          >
            FACTOR IMPACT <span className="text-[#bb86fc] font-normal">PhD</span>
          </div>
          {data.advancedFactors.factors
            .filter((f: AdvancedFactor) => Math.abs(f.adjustment) > 0.01 || f.confidence > 0.2)
            .map((f: AdvancedFactor) => {
              const icon = FACTOR_ICONS[f.factor] || '⚡';
              const short = FACTOR_SHORT[f.factor] || f.factor;
              const contribution = f.adjustment * f.confidence;
              return (
                <div
                  key={f.factor}
                  className="flex items-center gap-1 py-0.5"
                  data-tip={FACTOR_TIPS[f.factor] || `${short}: ${f.adjustment.toFixed(2)}°C × ${Math.round(f.confidence * 100)}% = ${contribution.toFixed(3)}°C`}
                >
                  <span className="text-[8px] w-3.5">{icon}</span>
                  <span className="text-[7px] font-bold w-11 truncate text-[#888]">{short}</span>
                  <span className={`text-[7px] font-bold w-10 text-right ${f.adjustment > 0.01 ? 'text-[#ff3333]' : f.adjustment < -0.01 ? 'text-[#00bcd4]' : 'text-[#444]'}`}>
                    {f.adjustment !== 0 ? `${f.adjustment > 0 ? '+' : ''}${f.adjustment.toFixed(2)}°` : '—'}
                  </span>
                  <span className="text-[6px] text-[#555]">×</span>
                  <span className={`text-[7px] font-bold w-5 text-right ${f.confidence > 0.5 ? 'text-[#00ff41]' : f.confidence > 0.25 ? 'text-[#ff8c00]' : 'text-[#555]'}`}>
                    {Math.round(f.confidence * 100)}%
                  </span>
                  <span className="text-[6px] text-[#333]">=</span>
                  <span className={`text-[7px] font-bold w-10 text-right ${contribution > 0.01 ? 'text-[#ff3333]' : contribution < -0.01 ? 'text-[#00bcd4]' : 'text-[#444]'}`}>
                    {`${contribution > 0 ? '+' : ''}${contribution.toFixed(3)}°`}
                  </span>
                  <div className="flex-1 h-0.5 bg-[#111] rounded-sm overflow-hidden ml-0.5">
                    <div
                      className="h-full rounded-sm transition-all"
                      style={{
                        width: `${Math.min(Math.abs(contribution) / 0.8 * 100, 100)}%`,
                        backgroundColor: contribution > 0 ? '#ff3333' : '#00bcd4',
                        opacity: 0.6,
                      }}
                    />
                  </div>
                </div>
              );
            })}
          <div
            className="flex items-center gap-1 pt-1 mt-0.5 border-t border-[#111] text-[7px]"
            data-tip={`Net PhD shift: ${displayNetAdj.toFixed(2)}°C via Re-KDE over ${data.ensemble?.memberMaxes?.length ?? '~170'} members.`}
          >
            <span className="font-bold text-[#555] uppercase tracking-wider">→ NET</span>
            <span className={`font-bold ${displayNetAdj > 0 ? 'text-[#ff3333]' : displayNetAdj < 0 ? 'text-[#00bcd4]' : 'text-[#555]'}`}>
              {displayNetAdj > 0 ? '+' : ''}{displayNetAdj.toFixed(2)}°C
            </span>
          </div>
        </div>
      )}

      {/* ── 3. Ensemble member count ── */}
      {data.ensemble?.memberMaxes && outcome.threshold && (
        <div className="px-2 py-1 border-t border-[#0a0a0a] flex items-center gap-1.5 text-[7px] text-[#555]" data-tip={BRACKET_TIPS.ENS_COUNT}>
          <span className="font-bold uppercase tracking-wider">ENS MEMBERS</span>
          {(() => {
            const result = countEnsembleMembersInBracket(
              data.ensemble!.memberMaxes!,
              outcome.threshold!,
            );
            return (
              <>
                <span className="text-[#bb86fc] font-bold">{result.count}/{result.total}</span>
                <span>in bracket</span>
                <span className="text-[#bb86fc]">({result.pct}%)</span>
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
}
