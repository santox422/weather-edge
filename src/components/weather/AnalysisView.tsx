'use client';

import { useState, useCallback } from 'react';
import WeatherMapWrapper from './panels/WeatherMapWrapper';
import type { AnalysisData, City, Market, AdvancedFactor } from '@/types';
import { computeNetAdjustment } from '@/lib/analysis/constants';

// ── Panel components ──
import MetricTile from './panels/MetricTile';
import StrategyPanel from './panels/StrategyPanel';
import EnsembleChart from './panels/EnsembleChart';
import ModelBarsPanel from './panels/ModelBarsPanel';
import AdvancedFactorsPanel from './panels/AdvancedFactorsPanel';
import FactorShiftsPanel from './panels/FactorShiftsPanel';
import GlobalSettingsModal from './panels/GlobalSettingsModal';
import AtmosphericPanel from './panels/AtmosphericPanel';
import BaseRateChart from './panels/BaseRateChart';
import BracketAnalysisPanel from './panels/BracketAnalysisPanel';
import DiurnalCurvePanel from './panels/DiurnalCurvePanel';

// ── Section header component — enhanced with visual weight ──
function SectionHeader({ title, badge, children, tip, accent = 'orange' }: {
  title: string;
  badge?: React.ReactNode;
  children?: React.ReactNode;
  tip?: string;
  accent?: 'orange' | 'cyan' | 'purple' | 'green';
}) {
  const accentColors: Record<string, string> = {
    orange: '#ff8c00',
    cyan: '#00bcd4',
    purple: '#bb86fc',
    green: '#00ff41',
  };
  const color = accentColors[accent] || accentColors.orange;

  return (
    <div
      className="section-header"
      style={{ borderLeftColor: color }}
      data-tip={tip}
    >
      <span style={{ color }}>{title}</span>
      {badge}
      {children}
    </div>
  );
}

// ── Section wrapper for consistent card styling ──
function AnalysisSection({ children, id }: { children: React.ReactNode; id?: string }) {
  return (
    <div className="analysis-card" id={id}>
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
  const e = data.edge || {};
  const div = data.modelDivergence || e.modelDivergence;
  const polyUrl = data.market?.polymarketUrl || marketOverride?.polymarketUrl || '';

  // Station info
  const lw = data.liveWeather;
  const stationInfo = data.city;

  // ── Map toggle ──
  const [showMap, setShowMap] = useState(false);

  // ── Global Analysis Settings State ──
  const [showSettings, setShowSettings] = useState(false);
  const [enforceMetar, setEnforceMetar] = useState(false); // Default: OFF per new design
  const [disabledFactors, setDisabledFactors] = useState<Set<string>>(new Set());
  const [disabledModels, setDisabledModels] = useState<Set<string>>(new Set());
  const [weightOverrides, setWeightOverrides] = useState<Record<string, number>>({});

  const toggleFactor = useCallback((f: string) => {
    setDisabledFactors(p => { const s = new Set(p); s.has(f) ? s.delete(f) : s.add(f); return s; });
  }, []);
  const toggleModel = useCallback((m: string) => {
    setDisabledModels(p => { const s = new Set(p); s.has(m) ? s.delete(m) : s.add(m); return s; });
  }, []);
  const setWeight = useCallback((m: string, w: number) => {
    setWeightOverrides(p => ({ ...p, [m]: w }));
  }, []);
  const resetAllSettings = useCallback(() => {
    setDisabledFactors(new Set());
    setDisabledModels(new Set());
    setWeightOverrides({});
    setEnforceMetar(false);
  }, []);

  // Custom net adjustment for standalone Advanced Factors panel
  const customNetAdj = (() => {
    if (disabledFactors.size === 0 || !data.advancedFactors) return null;
    return computeNetAdjustment(data.advancedFactors.factors, disabledFactors);
  })();

  // ════════════════════════════════════════════════════════════
  //  RENDER — Redesigned analysis flow with clear hierarchy
  // ════════════════════════════════════════════════════════════
  return (
    <div className="analysis-view" id="analysis-content">

      {/* ─── 1. Signal Hero + Station Header ─── */}
      <AnalysisSection id="panel-signal">
        <div className="signal-hero">
          <div className="min-w-0 flex-1">
            {stationInfo && (
              <div className="station-info-bar">
                <span className="station-dot" />
                <span className="text-[#666]">{stationInfo.station}</span>
                <span className="text-[#333]">({stationInfo.icao})</span>
                {lw?.wundergroundUrl && (
                  <a href={lw.wundergroundUrl} target="_blank" rel="noopener noreferrer" className="text-[#ff8c00] no-underline hover:underline ml-1">WU ↗</a>
                )}
                {data.stationBias?.reliable && (
                  <span className="text-[#555] ml-2">
                    BIAS: {data.stationBias.bias > 0 ? '+' : ''}{data.stationBias.bias.toFixed(2)}°C {data.stationBias.direction === 'warm' ? '⬆' : data.stationBias.direction === 'cold' ? '⬇' : '●'} (n={data.stationBias.sampleSize})
                  </span>
                )}
              </div>
            )}
            {lw?.currentTemp != null && (
              <div className="live-temp-row">
                <div className="live-temp-badge">
                  <span className="live-temp-label">LIVE</span>
                  <span className="live-temp-value">{lw.currentTemp.toFixed(1)}°C</span>
                  <span className="live-temp-sub">/ {(lw.currentTemp * 9/5 + 32).toFixed(1)}°F</span>
                </div>
                <span className="temp-divider">│</span>
                <div className="max-temp-badge">
                  <span className="max-temp-label">MAX</span>
                  <span className="max-temp-value">{lw.maxToday.toFixed(1)}°C</span>
                  <span className="max-temp-sub">/ {(lw.maxToday * 9/5 + 32).toFixed(1)}°F</span>
                </div>
                {lw.lastUpdated && (
                  <div className="text-[8px] text-[#333] ml-auto">
                    {new Date(lw.lastUpdated).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })} UTC
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              className={`analysis-btn ${showMap ? 'active' : ''}`}
              onClick={() => setShowMap(!showMap)}
              data-tip={showMap ? 'Hide station map' : 'Show station map'}
            >
              {showMap ? '◉ MAP' : '○ MAP'}
            </button>
            <button
              className="analysis-btn" style={{ borderColor: '#00bcd4', color: '#00bcd4' }}
              onClick={() => setShowSettings(true)}
              data-tip="Customize Analysis Pipeline (Models, Factors, Constraints)"
            >
              ⚙️ SETTINGS
            </button>
            {polyUrl && (
              <a href={polyUrl} target="_blank" rel="noopener noreferrer"
                className="analysis-btn primary"
                id="btn-polymarket">TRADE ON POLYMARKET ↗</a>
            )}
          </div>
        </div>

        {/* Divergence Warning */}
        {div?.isDivergent && (
          <div className="divergence-alert">
            <div className="text-[9px] font-bold text-[#ff3333] uppercase tracking-wider">⚠ MODEL DIVERGENCE</div>
            <div className="text-[9px] text-[#888] mt-[2px]">{div.summary || `GFS/ECMWF disagree by ${div.difference?.toFixed(1)}°C`}</div>
            <div className="grid grid-cols-4 gap-px bg-[#222] mobile-grid-2 mt-0.5">
              <MetricTile label="GFS" value={`${div.gfsTemp?.toFixed(1) || '--'}°C`} colorClass="text-[#4488ff]" />
              <MetricTile label="ECMWF" value={`${div.ecmwfTemp?.toFixed(1) || '--'}°C`} colorClass="text-[#00bcd4]" />
              <MetricTile label="DELTA" value={`${div.difference?.toFixed(1) || '--'}°C`} colorClass="text-[#ff8c00]" />
              <MetricTile label="WARMER" value={div.warmerModel || '--'} />
            </div>
          </div>
        )}
      </AnalysisSection>

      {/* ─── 1.5. Weather Station Map (collapsible) ─── */}
      {showMap && (
        <AnalysisSection id="panel-map">
          <SectionHeader title="STATION MAP" tip="Interactive map showing weather station location and data">
            <span className="text-[7px] text-[#444] font-normal normal-case tracking-normal ml-2">
              {stationInfo?.station || 'Unknown'}
            </span>
          </SectionHeader>
          <WeatherMapWrapper data={data} />
        </AnalysisSection>
      )}

      {/* ─── 2. Bracket Outcomes — Core Trading Data ─── */}
      <BracketAnalysisPanel 
        data={data} 
        enforceMetar={enforceMetar} 
        disabledModels={disabledModels} 
        weightOverrides={weightOverrides} 
      />

      {/* ─── 3. Trading Strategy ─── */}
      <StrategyPanel data={data} />

      {/* ─── 4. Ensemble + Multi-Model (side by side) ─── */}
      <div className="analysis-grid-2" id="panel-row-charts">
        <AnalysisSection>
          <SectionHeader title="ENSEMBLE FORECAST" accent="purple" tip="Temperature distribution from ensemble members">
            {data.ensemble?.bmaBlend && (
              <span className="text-[7px] text-[#555] ml-2 font-normal normal-case tracking-normal">
                BMA {data.ensemble.bmaBlend.ensFraction} ens / {data.ensemble.bmaBlend.detFraction} det
              </span>
            )}
          </SectionHeader>
          <EnsembleChart data={data} />
        </AnalysisSection>
        <AnalysisSection>
          <SectionHeader title="MULTI-MODEL COMPARISON" accent="cyan" tip="Max temperature predictions from independent weather models">
            {data.modelConfig?.region && (
              <span className="text-[7px] text-[#444] ml-2 font-normal normal-case tracking-normal">
                {data.modelConfig.region.replace(/_/g, ' ')}
              </span>
            )}
          </SectionHeader>
          <ModelBarsPanel data={data} />
        </AnalysisSection>
      </div>

      {/* ─── 5. Advanced Factors ─── */}
      {data.advancedFactors && (
        <AnalysisSection id="panel-factors">
          <SectionHeader title="ADVANCED FACTORS" accent="purple" tip="PhD-level weather analysis factors adjusting the forecast">
            <span className="phd-badge">PhD</span>
            {data.advancedFactors.netAdjustment !== 0 && (
              <span className={`text-[8px] font-bold ${data.advancedFactors.netAdjustment > 0 ? 'text-[#ff3333]' : 'text-[#00bcd4]'}`}>
                NET {(data.factorAdjustment?.effectiveShift ?? data.advancedFactors.netAdjustment) > 0 ? '+' : ''}{(data.factorAdjustment?.effectiveShift ?? data.advancedFactors.netAdjustment).toFixed(2)}°C
                {data.factorAdjustment?.effectiveShift != null && Math.abs(data.factorAdjustment.effectiveShift - data.advancedFactors.netAdjustment) > 0.05 && (
                  <span className="text-[6px] text-[#555] font-normal ml-1">(raw: {data.advancedFactors.netAdjustment > 0 ? '+' : ''}{data.advancedFactors.netAdjustment.toFixed(2)})</span>
                )}
              </span>
            )}
            <span className="text-[7px] text-[#444] font-normal normal-case">
              {data.advancedFactors.activeFactorCount}/{data.advancedFactors.factors.length} active
            </span>
          </SectionHeader>
          <AdvancedFactorsPanel factors={data.advancedFactors} disabledFactors={disabledFactors} customNetAdj={customNetAdj} effectiveShift={data.factorAdjustment?.effectiveShift ?? null} />
        </AnalysisSection>
      )}

      {/* ─── 6. Factor Probability Shifts ─── */}
      {data.factorAdjustment && (
        <AnalysisSection id="panel-factor-shifts">
          <SectionHeader title="FACTOR PROBABILITY SHIFTS" accent="purple" tip="How advanced factors shifted bracket probabilities">
            <span className={`text-[8px] font-bold ${data.factorAdjustment.shiftDirection === 'WARMING' ? 'text-[#ff3333]' : 'text-[#00bcd4]'}`}>
              {data.factorAdjustment.shiftDirection} {data.factorAdjustment.effectiveShift > 0 ? '+' : ''}{data.factorAdjustment.effectiveShift.toFixed(2)}°C
            </span>
          </SectionHeader>
          <FactorShiftsPanel breakdown={data.factorAdjustment} />
        </AnalysisSection>
      )}

      {/* ─── 7. Atmospheric + Base Rate (side by side) ─── */}
      <div className="analysis-grid-2">
        {data.atmospheric && (
          <AnalysisSection id="panel-atmospheric">
            <SectionHeader title="ATMOSPHERIC CONDITIONS" accent="cyan" tip="Current atmospheric conditions used by the analysis" />
            <AtmosphericPanel atmospheric={data.atmospheric} airQuality={data.airQuality} />
          </AnalysisSection>
        )}
        <AnalysisSection>
          <SectionHeader title="HOURLY TEMPERATURE CURVE" accent="orange" tip="Diurnal heating curve showing peak temperature timing" />
          <DiurnalCurvePanel data={data} />
        </AnalysisSection>
      </div>

      {/* ─── 7.5 Historical Base Rate ─── */}
      <AnalysisSection>
        <SectionHeader title="HISTORICAL BASE RATE" accent="orange" tip="Historical temperature threshold exceedance rate" />
        <BaseRateChart data={data} />
      </AnalysisSection>

      {/* ─── 8. Analysis Log ─── */}
      <AnalysisSection>
        <SectionHeader title="ANALYSIS LOG" tip="Detailed analysis reasoning log" />
        <pre className="reasoning-block">{e.reasoning || data.error || 'Analysis complete.'}</pre>
      </AnalysisSection>

      {/* ─── 9. Global Settings Modal ─── */}
      <GlobalSettingsModal
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        data={data}
        enforceMetar={enforceMetar}
        setEnforceMetar={setEnforceMetar}
        disabledModels={disabledModels}
        onToggleModel={toggleModel}
        weightOverrides={weightOverrides}
        onSetWeight={setWeight}
        disabledFactors={disabledFactors}
        onToggleFactor={toggleFactor}
        onResetAll={resetAllSettings}
      />
    </div>
  );
}
