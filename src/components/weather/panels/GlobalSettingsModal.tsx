'use client';

import React, { useState } from 'react';
import type { AnalysisData, PerModelBracket, AdvancedFactor } from '@/types';
import Toggle from '@/components/ui/Toggle';
import { getModelColor, FACTOR_ICONS, FACTOR_LABELS } from '@/lib/analysis/constants';
import { formatModelLabel } from './bracket/model-helpers';

interface GlobalSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  data: AnalysisData;
  enforceMetar: boolean;
  setEnforceMetar: (val: boolean) => void;
  disabledModels: Set<string>;
  onToggleModel: (model: string) => void;
  weightOverrides: Record<string, number>;
  onSetWeight: (model: string, weight: number) => void;
  disabledFactors: Set<string>;
  onToggleFactor: (factor: string) => void;
  onResetAll: () => void;
}

export default function GlobalSettingsModal({
  isOpen, onClose, data,
  enforceMetar, setEnforceMetar,
  disabledModels, onToggleModel,
  weightOverrides, onSetWeight,
  disabledFactors, onToggleFactor,
  onResetAll
}: GlobalSettingsModalProps) {
  const [activeTab, setActiveTab] = useState<'CONSTRAINTS' | 'MODELS' | 'FACTORS'>('CONSTRAINTS');

  if (!isOpen) return null;

  const perModel = data.perModelBrackets || [];
  const factors = data.advancedFactors?.factors || [];

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#000]/80 backdrop-blur-sm p-4">
      <div className="bg-[#050505] border border-[#333] w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
        
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#333] px-4 py-3 bg-[#0a0a0a]">
          <h2 className="text-[#eee] text-[12px] font-bold uppercase tracking-widest flex items-center gap-2">
            <span className="text-[#00bcd4]">⚙️</span> ANALYSIS Pipeline Settings
          </h2>
          <button onClick={onClose} className="text-[#888] hover:text-[#fff] text-[14px]">✕</button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-[#222]">
          {(['CONSTRAINTS', 'MODELS', 'FACTORS'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 py-2 text-[9px] font-bold tracking-widest uppercase transition-colors ${
                activeTab === tab 
                  ? 'bg-[#111] text-[#fff] border-b-2 border-b-[#00bcd4]' 
                  : 'bg-[#050505] text-[#555] hover:bg-[#0a0a0a] hover:text-[#aaa]'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-4 mobile-scroll-wrapper bg-[#030303]">
          
          {/* CONSTRAINTS TAB */}
          {activeTab === 'CONSTRAINTS' && (
            <div className="flex flex-col gap-4">
              <div className="p-4 border border-[#222] bg-[#0a0a0a] flex flex-col gap-3">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-[#eee] text-[10px] font-bold uppercase tracking-widest">Enforce Live METAR Limits</h3>
                    <p className="text-[#888] text-[9px] mt-1 max-w-sm">
                      Forces the probability distribution to mathematically acknowledge the maximum temperature reached so far today. 
                      If the live temperature hits 11°C, this setting immediately truncates the probability of 10°C, 9°C, and 8°C down to exactly 0%.
                    </p>
                  </div>
                  <Toggle 
                    on={enforceMetar} 
                    onToggle={() => setEnforceMetar(!enforceMetar)} 
                    color="#00bcd4" 
                    label={enforceMetar ? 'ON' : 'OFF'}
                  />
                </div>
                {!enforceMetar && (
                  <div className="mt-2 text-[#ff8c00] text-[8px] border border-[#ff8c00]/30 bg-[#ff8c00]/10 p-2">
                    ⚠ Warning: With METAR enforcement OFF, probabilities will biologically spread downwards into physically impossible brackets. Use this for testing Base Rate/NWP alignment only!
                  </div>
                )}
              </div>
            </div>
          )}

          {/* MODELS TAB */}
          {activeTab === 'MODELS' && (
            <div className="flex flex-col gap-2">
              <div className="text-[8px] text-[#555] uppercase tracking-widest border-b border-[#222] pb-2 mb-2">
                Toggle models on/off and adjust Bayesian weights
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {perModel.map(pm => {
                  const off = disabledModels.has(pm.model);
                  const w = weightOverrides[pm.model] ?? pm.weight;
                  const color = getModelColor(pm.model);
                  
                  return (
                    <div key={pm.model} className={`flex items-center justify-between border p-2 transition-all ${off ? 'border-[#111] bg-[#050505] opacity-50' : 'border-[#222] bg-[#0a0a0a]'}`}>
                      <div className="flex items-center gap-2">
                        <Toggle on={!off} onToggle={() => onToggleModel(pm.model)} color={color} size="sm" label=""/>
                        <div className="flex flex-col">
                          <span className="text-[9px] font-bold" style={{ color: off ? '#555' : color }}>
                            {pm.isEnsemble ? `ENS KDE (${pm.memberCount}m)` : formatModelLabel(pm)}
                          </span>
                          {pm.maxTemp != null && <span className="text-[7px] text-[#666]">max {pm.maxTemp.toFixed(1)}°C</span>}
                        </div>
                      </div>
                      
                      {!off && (
                        <div className="flex items-center gap-1 border border-[#333] bg-[#000] rounded-sm shrink-0">
                          <button onClick={() => onSetWeight(pm.model, Math.max(0.1, w - 0.1))} className="w-5 h-5 text-[10px] text-[#888] hover:text-[#fff] hover:bg-[#222] flex items-center justify-center">−</button>
                          <span className="text-[8px] font-bold text-[#ccc] w-6 text-center">{w.toFixed(1)}</span>
                          <button onClick={() => onSetWeight(pm.model, Math.min(3, w + 0.1))} className="w-5 h-5 text-[10px] text-[#888] hover:text-[#fff] hover:bg-[#222] flex items-center justify-center">+</button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* FACTORS TAB */}
          {activeTab === 'FACTORS' && (
            <div className="flex flex-col gap-2">
              <div className="text-[8px] text-[#555] uppercase tracking-widest border-b border-[#222] pb-2 mb-2">
                Toggle Advanced PhD Meteorological Factors
              </div>
              <div className="grid grid-cols-1 gap-2">
                {factors.map((f: AdvancedFactor) => {
                  const icon = FACTOR_ICONS[f.factor] || '⚡';
                  const label = FACTOR_LABELS[f.factor] || f.factor.toUpperCase();
                  const off = disabledFactors.has(f.factor);
                  
                  return (
                    <div key={f.factor} className={`flex items-start gap-3 border p-2 transition-all ${off ? 'border-[#111] bg-[#050505] opacity-40' : 'border-[#222] bg-[#0a0a0a]'}`}>
                      <Toggle on={!off} onToggle={() => onToggleFactor(f.factor)} color="#ff8c00" size="sm" label=""/>
                      <div className="flex flex-col flex-1">
                        <div className="flex justify-between items-center">
                          <span className={`text-[9px] font-bold uppercase tracking-widest ${off ? 'text-[#555]' : 'text-[#ccc]'}`}>{icon} {label}</span>
                          <span className={`text-[9px] font-bold ${off ? 'text-[#333]' : f.adjustment > 0 ? 'text-[#ff3333]' : f.adjustment < 0 ? 'text-[#00bcd4]' : 'text-[#555]'}`}>
                            {f.adjustment !== 0 ? `${f.adjustment > 0 ? '+' : ''}${f.adjustment.toFixed(2)}°C` : '—'}
                          </span>
                        </div>
                        {!off && f.reasoning && (
                          <div className="text-[8px] text-[#666] mt-1 leading-relaxed">
                            {f.reasoning.replace(/^[🌙☁️🌱📊🌧️💨🌍⚡]\s*/, '')}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

        </div>

        {/* Footer Actions */}
        <div className="border-t border-[#333] p-3 bg-[#0a0a0a] flex items-center justify-between">
          <button 
            onClick={onResetAll}
            className="text-[8px] font-bold px-3 py-1.5 border border-[#ff3333]/30 text-[#ff3333] hover:bg-[#ff3333]/10 tracking-widest transition-colors"
          >
            RESET TO DEFAULTS
          </button>
          <button 
            onClick={onClose}
            className="text-[9px] font-bold px-5 py-1.5 bg-[#00bcd4] text-[#000] hover:bg-[#00a0b4] tracking-widest transition-colors cursor-pointer"
          >
            APPLY & CLOSE
          </button>
        </div>
      </div>
    </div>
  );
}
