'use client';

import type { AnalysisData } from '@/types';
import { TOOLTIPS } from '@/lib/helpers';

// Model catalog — mirrors server-side model-registry.js for display purposes
const MODEL_CATALOG: Record<string, { name: string; res: string; family: string; coverage: string }> = {
  gfs_seamless:              { name: 'GFS',           res: '25km',  family: 'NOAA',         coverage: 'global' },
  ecmwf_ifs025:              { name: 'ECMWF IFS',     res: '25km',  family: 'ECMWF',        coverage: 'global' },
  icon_seamless:             { name: 'ICON',          res: '13km',  family: 'DWD',          coverage: 'global' },
  jma_seamless:              { name: 'JMA',           res: '20km',  family: 'JMA',          coverage: 'global' },
  gem_seamless:              { name: 'GEM',           res: '25km',  family: 'ECCC',         coverage: 'global' },
  meteofrance_seamless:      { name: 'MétéoFrance',   res: '10km',  family: 'MétéoFrance',  coverage: 'global' },
  ukmo_seamless:             { name: 'UKMO',          res: '10km',  family: 'MetOffice',    coverage: 'global' },
  icon_eu:                   { name: 'ICON-EU',       res: '7km',   family: 'DWD',          coverage: 'europe' },
  icon_d2:                   { name: 'ICON-D2',       res: '2km',   family: 'DWD',          coverage: 'central_europe' },
  meteofrance_arome_france:  { name: 'AROME',         res: '1.5km', family: 'MétéoFrance',  coverage: 'france' },
};

function getModelInfo(slug: string) {
  return MODEL_CATALOG[slug] || { name: slug, res: '?', family: '?', coverage: '?' };
}

function Tile({ label, value, colorClass = 'text-[#ccc]' }: { label: string; value: string; colorClass?: string }) {
  const tip = TOOLTIPS[label] || '';
  return (
    <div className="bg-[#0a0a0a] p-[4px_6px] cursor-help" title={tip} data-tip={tip}>
      <div className="text-[7px] text-[#444] uppercase tracking-[0.12em] font-semibold">{label}</div>
      <div className={`text-[11px] font-bold mt-[1px] ${colorClass}`}>{value}</div>
    </div>
  );
}

function getSkillDecay(days: number | null | undefined) {
  if (days == null) return { pct: '--', grade: '--', cls: 'text-[#555]' };
  if (days <= 1) return { pct: '~95%', grade: 'A+', cls: 'text-[#00ff41]' };
  if (days <= 2) return { pct: '~90%', grade: 'A', cls: 'text-[#00ff41]' };
  if (days <= 3) return { pct: '~85%', grade: 'B+', cls: 'text-[#00ff41]' };
  if (days <= 5) return { pct: '~70%', grade: 'B', cls: 'text-[#ff8c00]' };
  if (days <= 7) return { pct: '~55%', grade: 'C+', cls: 'text-[#ff8c00]' };
  if (days <= 10) return { pct: '~40%', grade: 'C', cls: 'text-[#ff3333]' };
  if (days <= 14) return { pct: '~25%', grade: 'D', cls: 'text-[#ff3333]' };
  return { pct: '<20%', grade: 'F', cls: 'text-[#ff3333]' };
}

export default function RightPanel({ data, wsStatus = 'offline' }: { data: AnalysisData; wsStatus?: 'offline' | 'connecting' | 'online' }) {
  const e: any = data.edge || {};
  const atm = data.atmospheric;
  const aq = data.airQuality;
  const daysOut = data.daysUntilResolution;
  const spScore = data.spreadScore;
  const sk = getSkillDecay(daysOut);
  const daysColor = daysOut != null ? (daysOut <= 2 ? 'text-[#00ff41]' : daysOut <= 5 ? 'text-[#ff8c00]' : 'text-[#ff3333]') : 'text-[#555]';

  const modelCount = data.multiModel?.consensus?.modelCount || data.multiModel?.consensus?.predictions?.length || '--';
  const isWeighted = data.multiModel?.consensus?.isWeighted;

  const traj = data.trajectory;
  const bias = data.stationBias;
  const modelCfg = data.modelConfig;

  return (
    <aside className="flex flex-col overflow-y-auto border-l border-[#111] md:border-t-0 border-t border-t-[#222] bg-[#050505]" id="col-right">
      {/* Forecast Metrics */}
      <div>
        <div className="px-2 py-1 text-[9px] font-bold text-[#ff8c00] uppercase tracking-[0.15em] bg-[#0a0a0a] border-b border-[#1a1a1a]">FORECAST METRICS</div>
        <div className="grid grid-cols-3 gap-[1px] bg-[#222] mobile-grid-2">
          <Tile label="DAYS OUT" value={daysOut != null ? `${daysOut}d` : '--'} colorClass={daysColor} />
          <Tile label="SKILL" value={sk.pct} colorClass={sk.cls} />
          <Tile label="GRADE" value={sk.grade} colorClass={sk.cls} />
          <Tile label="ENS CAL" value={spScore?.score != null ? spScore.score.toFixed(2) : '--'}
            colorClass={spScore?.score != null && spScore.score >= 2 && spScore.score <= 4 ? 'text-[#00ff41]' : spScore?.score != null && spScore.score < 2 ? 'text-[#ff8c00]' : 'text-[#ff3333]'} />
          <Tile label="SPREAD" value={e.ensembleSpread != null ? `${e.ensembleSpread.toFixed(1)}°C` : (data.ensemble?.averageSpread != null ? `${data.ensemble.averageSpread.toFixed(1)}°C` : '--')} colorClass="text-[#555]" />
          <Tile label="MODELS" value={`${modelCount}${isWeighted ? 'w' : ''}`} colorClass="text-[#00bcd4]" />
        </div>
      </div>

      {/* Atmospheric */}
      <div>
        <div className="px-2 py-1 text-[9px] font-bold text-[#ff8c00] uppercase tracking-[0.15em] bg-[#0a0a0a] border-b border-[#1a1a1a]">ATMOSPHERIC</div>
        {atm ? (
          <div className="grid grid-cols-4 gap-[1px] bg-[#222] mobile-grid-2">
            <Tile label="HUMIDITY" value={`${atm.humidity?.toFixed(0) ?? '--'}%`} colorClass="text-[#00bcd4]" />
            <Tile label="DEW PT" value={`${atm.dewPoint?.toFixed(1) ?? '--'}°C`} colorClass="text-[#4488ff]" />
            <Tile label="WIND" value={`${atm.windSpeed?.toFixed(0) ?? '--'} mph`} />
            <Tile label="GUSTS" value={`${atm.windGusts?.toFixed(0) ?? '--'} mph`} colorClass="text-[#ff8c00]" />
            <Tile label="PRESSURE" value={`${atm.pressure?.toFixed(0) ?? '--'} hPa`} colorClass="text-[#bb86fc]" />
            <Tile label="CLOUD" value={`${atm.cloudCover?.toFixed(0) ?? '--'}%`} colorClass="text-[#555]" />
            <Tile label="VIS" value={`${atm.visibility != null ? (atm.visibility / 1000).toFixed(1) : '--'} km`} colorClass="text-[#555]" />
            <Tile label="PRECIP" value={`${atm.precipProbability?.toFixed(0) ?? '--'}%`} colorClass={(atm.precipProbability ?? 0) > 50 ? 'text-[#4488ff]' : 'text-[#555]'} />
          </div>
        ) : <span className="text-[#333] text-[9px] p-2 block">No data</span>}
      </div>

      {/* Trajectory */}
      {traj && traj.length > 0 && (
        <div>
          <div className="px-2 py-1 text-[9px] font-bold text-[#ff8c00] uppercase tracking-[0.15em] bg-[#0a0a0a] border-b border-[#1a1a1a]"
            title="How the GFS max temperature forecast has changed over recent model runs">FORECAST TRAJECTORY</div>
          <div className={`grid grid-cols-${Math.min(traj.length + 1, 4)} gap-[1px] bg-[#222]`}>
            {[...traj].sort((a, b) => b.daysAgo - a.daysAgo).map(pt => {
              const temp = pt.forecastedMaxTemp ?? pt.maxTemp ?? 0;
              return <Tile key={pt.daysAgo} label={`${pt.daysAgo}D AGO`} value={`${temp.toFixed(1)}°C`} colorClass="text-[#555]" />;
            })}
            {(() => {
              const sorted = [...traj].sort((a, b) => b.daysAgo - a.daysAgo);
              const getT = (p: any) => p.forecastedMaxTemp ?? p.maxTemp ?? 0;
              const trend = sorted.length >= 2 ? getT(sorted[sorted.length - 1]) - getT(sorted[0]) : 0;
              const label = Math.abs(trend) < 0.3 ? 'STABLE' : trend > 0 ? `WARMING +${trend.toFixed(1)}°C` : `COOLING ${trend.toFixed(1)}°C`;
              const cls = Math.abs(trend) < 0.3 ? 'text-[#555]' : trend > 0 ? 'text-[#ff3333]' : 'text-[#4488ff]';
              return <Tile label="TREND" value={label} colorClass={cls} />;
            })()}
          </div>
        </div>
      )}

      {/* Station Bias */}
      {bias && bias.sampleSize > 0 && (
        <div>
          <div className="px-2 py-1 text-[9px] font-bold text-[#ff8c00] uppercase tracking-[0.15em] bg-[#0a0a0a] border-b border-[#1a1a1a] mt-[1px]"
            title="Historical systematic error at the nearest weather station">STATION BIAS</div>
          <div className="grid grid-cols-4 gap-[1px] bg-[#222] mobile-grid-2">
            <Tile label="BIAS" value={`${bias.bias > 0 ? '+' : ''}${bias.bias.toFixed(2)}°C`}
              colorClass={!bias.reliable ? 'text-[#555]' : bias.direction === 'warm' ? 'text-[#ff3333]' : bias.direction === 'cold' ? 'text-[#4488ff]' : 'text-[#00ff41]'} />
            <Tile label="STD" value={bias.stdDev != null ? `±${bias.stdDev.toFixed(2)}` : '--'} colorClass="text-[#555]" />
            <Tile label="N" value={`${bias.sampleSize}`} colorClass={bias.reliable ? 'text-[#00ff41]' : 'text-[#ff8c00]'} />
            <Tile label="STATUS" value={bias.reliable ? 'ACTIVE' : 'LOW'} colorClass={bias.reliable ? 'text-[#00ff41]' : 'text-[#ff8c00]'} />
          </div>
        </div>
      )}

      {/* Ensemble KDE Info */}
      {data.ensemble?.memberCount && (
        <div>
          <div className="px-2 py-1 text-[9px] font-bold text-[#ff8c00] uppercase tracking-[0.15em] bg-[#0a0a0a] border-b border-[#1a1a1a] mt-[1px]"
            title="Ensemble model configuration and bracket probability method">ENSEMBLE KDE</div>
          <div className="grid grid-cols-4 gap-[1px] bg-[#222] mobile-grid-2">
            <Tile label="MEMBERS" value={`${data.ensemble.memberCount}`} colorClass="text-[#00bcd4]" />
            <Tile label="SOURCES" value={`${modelCfg?.ensemble?.length || '?'}`} colorClass="text-[#bb86fc]" />
            <Tile label="BW" value="0.5°C" colorClass="text-[#555]" />
            <Tile label="REGION" value={(modelCfg?.region || '—').toUpperCase().replace(/_/g, ' ')} colorClass="text-[#ff8c00]" />
          </div>
        </div>
      )}

      {/* Model Weights — per-city detailed table */}
      {modelCfg?.deterministic && modelCfg.deterministic.length > 0 && (
        <div>
          <div className="px-2 py-1 text-[9px] font-bold text-[#ff8c00] uppercase tracking-[0.15em] bg-[#0a0a0a] border-b border-[#1a1a1a] mt-[1px]"
            title="Deterministic models with weighted consensus for this city">MODEL WEIGHTS</div>
          <div className="text-[8px]">
            {/* Header */}
            <div className="grid grid-cols-[1fr_45px_35px_30px] gap-0 px-2 py-[2px] border-b border-[#111]">
              <span className="text-[#333] font-bold uppercase">MODEL</span>
              <span className="text-[#333] font-bold uppercase text-right">RES</span>
              <span className="text-[#333] font-bold uppercase text-right">WT</span>
              <span className="text-[#333] font-bold uppercase text-right">°C</span>
            </div>
            {/* Model rows — sorted by weight desc */}
            {[...modelCfg.deterministic].sort((a, b) => b.weight - a.weight).map(m => {
              const info = getModelInfo(m.model);
              const wt = m.weight;
              const wtColor = wt >= 1.2 ? 'text-[#00ff41]' : wt >= 1.0 ? 'text-[#ccc]' : 'text-[#555]';
              const wtLabel = wt >= 1.2 ? `▲${wt.toFixed(1)}` : wt < 1.0 ? `▽${wt.toFixed(1)}` : `${wt.toFixed(1)}`;
              const pred = data.multiModel?.consensus?.predictions?.find((p: any) => p.model === m.model);
              const tempStr = pred?.maxTemp != null ? `${pred.maxTemp.toFixed(0)}` : '—';
              const tempColor = pred?.maxTemp != null ? 'text-[#00bcd4]' : 'text-[#555]';
              return (
                <div key={m.model} className="grid grid-cols-[1fr_45px_35px_30px] gap-0 px-2 py-[1px] border-b border-[#0a0a0a] hover:bg-[#0a0a0a] transition-colors"
                  title={`${info.name} (${info.family}) — ${info.res} resolution, ${info.coverage} coverage. Weight: ${wt}x`}>
                  <span className="text-[#ccc] truncate">{info.name}</span>
                  <span className="text-right text-[#666]">{info.res}</span>
                  <span className={`text-right ${wtColor} font-semibold`}>{wtLabel}</span>
                  <span className={`text-right ${tempColor}`}>{tempStr}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Air Quality */}
      <div>
        <div className="px-2 py-1 text-[9px] font-bold text-[#ff8c00] uppercase tracking-[0.15em] bg-[#0a0a0a] border-b border-[#1a1a1a]">AIR QUALITY / UV</div>
        {aq ? (
          <div className="grid grid-cols-4 gap-[1px] bg-[#222] mobile-grid-2">
            <Tile label="AQI" value={aq.usAqi != null ? aq.usAqi.toFixed(0) : '--'}
              colorClass={aq.usAqi != null ? (aq.usAqi <= 50 ? 'text-[#00ff41]' : aq.usAqi <= 100 ? 'text-[#ff8c00]' : 'text-[#ff3333]') : 'text-[#555]'} />
            <Tile label="UV" value={aq.uvIndex != null ? aq.uvIndex.toFixed(1) : '--'}
              colorClass={aq.uvIndex != null ? (aq.uvIndex <= 2 ? 'text-[#00ff41]' : aq.uvIndex <= 5 ? 'text-[#ff8c00]' : 'text-[#ff3333]') : 'text-[#555]'} />
            <Tile label="PM2.5" value={aq.pm25 != null ? aq.pm25.toFixed(1) : '--'} colorClass="text-[#555]" />
            <Tile label="O₃" value={aq.ozone != null ? aq.ozone.toFixed(0) : '--'} colorClass="text-[#555]" />
          </div>
        ) : <span className="text-[#333] text-[9px] p-2 block">No data</span>}
      </div>

      {/* Live Prices ticker */}
      <div className="flex-1 flex flex-col min-h-0">
        <div className="px-2 py-1 text-[9px] font-bold text-[#ff8c00] uppercase tracking-[0.15em] bg-[#0a0a0a] border-b border-[#1a1a1a] flex items-center gap-1">
          LIVE PRICES
          <span className={`ws-live-dot ${wsStatus}`} />
          <span className="text-[7px] text-[#444] font-normal normal-case tracking-normal ml-auto">
            {wsStatus === 'online' ? 'CONNECTED' : wsStatus === 'connecting' ? 'CONNECTING...' : 'OFFLINE'}
          </span>
        </div>
        <div className="flex-1 overflow-y-auto px-2 py-1 text-[9px]">
          {data.market?.outcomes && data.market.outcomes.length > 0 ? (
            <>
              {data.market.outcomes.map((o: any) => {
                const price = (o.price * 100).toFixed(0);
                return (
                  <div key={o.tokenId || o.name}
                    className="flex items-center justify-between py-[1px] border-b border-[#0a0a0a] hover:bg-[#0a0a0a]"
                    data-token-id={o.tokenId || ''}>
                    <span className="text-[#888] truncate mr-2">{o.name || o.title}</span>
                    <span className="font-bold text-[#ccc] price-cell whitespace-nowrap">{price}¢</span>
                  </div>
                );
              })}
              <div className="flex items-center justify-between pt-1 mt-1 border-t border-[#222] text-[8px]">
                <span className="text-[#444]">SUM YES</span>
                <span className={`font-bold ${data.market.outcomes.reduce((s: number, o: any) => s + (o.price || 0), 0) < 1 ? 'text-[#00ff41]' : 'text-[#ff3333]'}`}>
                  ${data.market.outcomes.reduce((s: number, o: any) => s + (o.price || 0), 0).toFixed(3)}
                </span>
              </div>
            </>
          ) : (
            <span className="text-[#333] text-[9px]">No market data</span>
          )}
        </div>
      </div>
    </aside>
  );
}
