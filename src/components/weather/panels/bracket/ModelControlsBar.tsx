'use client';

import React from 'react';
import type { PerModelBracket } from '@/types';
import Toggle from '@/components/ui/Toggle';
import { getModelColor, BRACKET_TIPS } from '@/lib/analysis/constants';
import { formatModelLabel } from './model-helpers';

/**
 * ModelControlsBar — the row of model cards shown when the MODELS toggle is ON.
 *
 * Each card shows:
 *   - Toggle on/off to include/exclude the model from BMA
 *   - +/- weight adjustment buttons
 *   - Model name and max temperature prediction
 *
 * Previously embedded as lines 287-325 of BracketAnalysisPanel.
 */

interface ModelControlsBarProps {
  perModel: PerModelBracket[];
  disabledModels: Set<string>;
  weightOverrides: Record<string, number>;
  onToggleModel: (model: string) => void;
  onSetWeight: (model: string, weight: number) => void;
}

export default function ModelControlsBar({
  perModel,
  disabledModels,
  weightOverrides,
  onToggleModel,
  onSetWeight,
}: ModelControlsBarProps) {
  return (
    <div className="border-b border-[#111] bg-[#030303]">
      <div
        className="px-2 pt-1 pb-0.5 text-[7px] font-bold text-[#555] uppercase tracking-widest"
        data-tip="Toggle individual models on/off and adjust their BMA weights. Disabled models are excluded from the BMA calculation."
      >
        MODEL CONTROLS{' '}
        <span className="font-normal normal-case text-[#333]">
          toggle models on/off • adjust weights
        </span>
      </div>
      <div className="overflow-x-auto pb-1.5 px-1">
        <div className="flex gap-1" style={{ minWidth: 'max-content' }}>
          {perModel.map((pm) => {
            const off = disabledModels.has(pm.model);
            const w = weightOverrides[pm.model] ?? pm.weight;
            const color = getModelColor(pm.model);
            const label = formatModelLabel(pm);
            const tip = pm.isEnsemble
              ? `${label} — pooled ensemble KDE probability. Weight: ${w.toFixed(1)}. ${off ? 'DISABLED' : 'Enabled'}.`
              : `${label} — max ${pm.maxTemp?.toFixed(1) ?? '?'}°C. BMA weight: ${w.toFixed(1)}. ${off ? 'DISABLED' : 'Enabled'}.`;

            return (
              <div
                key={pm.model}
                className={`border p-1 min-w-16 max-w-20 shrink-0 transition-opacity ${off ? 'border-[#111] opacity-30' : 'border-[#1a1a1a]'}`}
                data-tip={tip}
              >
                <div className="flex items-center gap-1 mb-0.5">
                  <Toggle
                    on={!off}
                    onToggle={() => onToggleModel(pm.model)}
                    label=""
                    color={color}
                    size="xs"
                  />
                  <span
                    className="text-[7px] font-bold truncate"
                    style={{ color: off ? '#444' : color }}
                  >
                    {pm.isEnsemble ? `ENS KDE (${pm.memberCount}m)` : formatModelShort(pm)}
                  </span>
                </div>
                {!off && (
                  <div
                    className="flex items-center gap-0.5"
                    data-tip={`Weight: ${w.toFixed(1)}. Tap +/- to adjust`}
                  >
                    <button
                      onClick={() => onSetWeight(pm.model, Math.max(0.1, w - 0.1))}
                      className="text-[8px] text-[#555] w-4 h-4 flex items-center justify-center border border-[#222] bg-transparent cursor-pointer active:bg-[#222]"
                    >
                      −
                    </button>
                    <span className="text-[7px] font-bold flex-1 text-center text-[#888]">
                      {w.toFixed(1)}
                    </span>
                    <button
                      onClick={() => onSetWeight(pm.model, Math.min(3, w + 0.1))}
                      className="text-[8px] text-[#555] w-4 h-4 flex items-center justify-center border border-[#222] bg-transparent cursor-pointer active:bg-[#222]"
                    >
                      +
                    </button>
                  </div>
                )}
                {pm.maxTemp != null && !off && (
                  <div
                    className="text-[6px] text-[#555] text-center mt-0.5"
                    data-tip={BRACKET_TIPS.MAX_T}
                  >
                    max {pm.maxTemp.toFixed(1)}°C
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Local helper: short model name for card header ──
function formatModelShort(pm: PerModelBracket): string {
  if (pm.isEnsemble) return 'ENS';
  const name = formatModelLabel(pm);
  const map: Record<string, string> = {
    GFS: 'GFS', 'ECMWF IFS025': 'ECMW', 'ECMWF IFS': 'ECMW',
    ICON: 'ICON', 'ICON EU': 'I-EU', 'ICON D2': 'I-D2',
    JMA: 'JMA', GEM: 'GEM', UKMO: 'UKMO',
    AROME: 'ARM', METEOFRANCE: 'METE',
  };
  return map[name] || name.slice(0, 4);
}
