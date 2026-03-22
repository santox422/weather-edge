/**
 * Right-column panels: atmospheric, skill metrics, trajectory/bias, air quality.
 */
import { $, mTile } from './helpers.js';
import { getModelInfo } from '../analysis/model-registry.js';

export function renderAtmospheric(data) {
  const atm = data.atmospheric;
  if (!atm) { $('atmospheric-grid').innerHTML = '<span class="text-[#333] text-[9px]">No data</span>'; return; }
  $('atmospheric-grid').innerHTML = `<div class="grid grid-cols-4 gap-[1px] bg-[#222] mobile-grid-2">
    ${mTile('HUMIDITY', `${atm.humidity?.toFixed(0)??'--'}%`, 'c-cyan')}
    ${mTile('DEW PT', `${atm.dewPoint?.toFixed(1)??'--'}°C`, 'c-blue')}
    ${mTile('WIND', `${atm.windSpeed?.toFixed(0)??'--'} mph`, 'c-white')}
    ${mTile('GUSTS', `${atm.windGusts?.toFixed(0)??'--'} mph`, 'c-amber')}
    ${mTile('PRESSURE', `${atm.pressure?.toFixed(0)??'--'} hPa`, 'c-purple')}
    ${mTile('CLOUD', `${atm.cloudCover?.toFixed(0)??'--'}%`, 'c-muted')}
    ${mTile('VIS', `${atm.visibility!=null?(atm.visibility/1000).toFixed(1):'--'} km`, 'c-muted')}
    ${mTile('PRECIP', `${atm.precipProbability?.toFixed(0)??'--'}%`, atm.precipProbability > 50 ? 'c-blue' : 'c-muted')}
  </div>`;
}

export function renderSkillMetrics(data, edge) {
  const daysOut = data.daysUntilResolution;
  const spreadScore = data.spreadScore;
  const sk = getSkillDecayLabel(daysOut);
  const daysColor = daysOut <= 2 ? 'c-green' : daysOut <= 5 ? 'c-amber' : 'c-red';

  // Model count from multi-model data or modelConfig
  const modelCount = data.multiModel?.consensus?.modelCount
    || data.multiModel?.models?.length
    || data.modelConfig?.deterministicSlugs?.length
    || '--';
  const isWeighted = data.multiModel?.consensus?.isWeighted;

  $('skill-metrics').innerHTML = `<div class="grid grid-cols-3 gap-[1px] bg-[#222] mobile-grid-2">
    ${mTile('DAYS OUT', daysOut != null ? `${daysOut}d` : '--', daysColor)}
    ${mTile('SKILL', sk.pct, sk.cls)}
    ${mTile('GRADE', sk.grade, sk.cls)}
    ${mTile('ENS CAL', spreadScore?.score != null ? spreadScore.score.toFixed(2) : '--', spreadScore?.score >= 2 && spreadScore?.score <= 4 ? 'c-green' : spreadScore?.score < 2 ? 'c-amber' : 'c-red')}
    ${mTile('SPREAD', edge?.ensembleSpread != null ? `${edge.ensembleSpread.toFixed(1)}°C` : (data.ensemble?.averageSpread != null ? `${data.ensemble.averageSpread.toFixed(1)}°C` : '--'), 'c-muted')}
    ${mTile('MODELS', `${modelCount}${isWeighted ? 'w' : ''}`, 'c-cyan')}
  </div>`;
}

function getSkillDecayLabel(days) {
  if (days == null) return { pct: '--', grade: '--', cls: 'c-muted' };
  if (days <= 1) return { pct: '~95%', grade: 'A+', cls: 'c-green' };
  if (days <= 2) return { pct: '~90%', grade: 'A', cls: 'c-green' };
  if (days <= 3) return { pct: '~85%', grade: 'B+', cls: 'c-green' };
  if (days <= 5) return { pct: '~70%', grade: 'B', cls: 'c-amber' };
  if (days <= 7) return { pct: '~55%', grade: 'C+', cls: 'c-amber' };
  if (days <= 10) return { pct: '~40%', grade: 'C', cls: 'c-red' };
  if (days <= 14) return { pct: '~25%', grade: 'D', cls: 'c-red' };
  return { pct: '<20%', grade: 'F', cls: 'c-red' };
}

export function renderTrajectoryAndBias(data) {
  let html = '';

  const traj = data.trajectory;
  if (traj && traj.length > 0) {
    const sorted = [...traj].sort((a, b) => b.daysAgo - a.daysAgo);
    // Normalize: consume forecastedMaxTemp (new name) with fallback to maxTemp (legacy)
    const getTemp = (pt) => pt.forecastedMaxTemp ?? pt.maxTemp;
    const trend = sorted.length >= 2 ? getTemp(sorted[sorted.length - 1]) - getTemp(sorted[0]) : 0;
    const trendLabel = Math.abs(trend) < 0.3 ? 'STABLE' : trend > 0 ? `WARMING +${trend.toFixed(1)}°C` : `COOLING ${trend.toFixed(1)}°C`;
    const trendColor = Math.abs(trend) < 0.3 ? 'c-muted' : trend > 0 ? 'c-red' : 'c-blue';

    html += `<div class="px-2 py-1 text-[9px] font-bold text-[#ff8c00] uppercase tracking-[0.15em] bg-[#0a0a0a] border-b border-[#1a1a1a]" data-tip="How the GFS max temperature forecast has changed over recent model runs">FORECAST TRAJECTORY</div>`;
    html += `<div class="grid grid-cols-${Math.min(sorted.length + 1, 4)} gap-[1px] bg-[#222]">`;
    for (const pt of sorted) html += mTile(`${pt.daysAgo}D AGO`, `${getTemp(pt).toFixed(1)}°C`, 'c-muted');
    html += mTile('TREND', trendLabel, trendColor);
    html += `</div>`;
  }

  const bias = data.stationBias;
  if (bias && bias.sampleSize > 0) {
    const biasColor = !bias.reliable ? 'c-muted' : bias.direction === 'warm' ? 'c-red' : bias.direction === 'cold' ? 'c-blue' : 'c-green';
    html += `<div class="px-2 py-1 text-[9px] font-bold text-[#ff8c00] uppercase tracking-[0.15em] bg-[#0a0a0a] border-b border-[#1a1a1a] mt-[1px]" data-tip="Historical systematic error at the nearest weather station">STATION BIAS</div>`;
    html += `<div class="grid grid-cols-4 gap-[1px] bg-[#222] mobile-grid-2">
      ${mTile('BIAS', `${bias.bias > 0 ? '+' : ''}${bias.bias.toFixed(2)}°C`, biasColor)}
      ${mTile('STD', bias.stdDev != null ? `±${bias.stdDev.toFixed(2)}` : '--', 'c-muted')}
      ${mTile('N', `${bias.sampleSize}`, bias.reliable ? 'c-green' : 'c-amber')}
      ${mTile('STATUS', bias.reliable ? 'ACTIVE' : 'LOW', bias.reliable ? 'c-green' : 'c-amber')}
    </div>`;
  }

  // ── Ensemble KDE info ──
  if (data.ensemble?.memberCount) {
    const region = data.modelConfig?.region || '—';
    const ensembleCount = data.modelConfig?.ensemble?.length || '?';
    html += `<div class="px-2 py-1 text-[9px] font-bold text-[#ff8c00] uppercase tracking-[0.15em] bg-[#0a0a0a] border-b border-[#1a1a1a] mt-[1px]" data-tip="Ensemble model configuration and bracket probability method">ENSEMBLE KDE</div>`;
    html += `<div class="grid grid-cols-4 gap-[1px] bg-[#222] mobile-grid-2">
      ${mTile('MEMBERS', `${data.ensemble.memberCount}`, 'c-cyan')}
      ${mTile('SOURCES', `${ensembleCount}`, 'c-purple')}
      ${mTile('BW', '0.5°C', 'c-muted')}
      ${mTile('REGION', region.toUpperCase().replace(/_/g, ' '), 'c-amber')}
    </div>`;
  }

  // ── Model Weights — per-model display for current city ──
  const modelCfg = data.modelConfig;
  if (modelCfg?.deterministic?.length > 0) {
    html += `<div class="px-2 py-1 text-[9px] font-bold text-[#ff8c00] uppercase tracking-[0.15em] bg-[#0a0a0a] border-b border-[#1a1a1a] mt-[1px]" data-tip="Deterministic weather models used for this city with their consensus weights. ▲ = boosted (high-res local), ▽ = reduced (less relevant for this region).">MODEL WEIGHTS</div>`;
    html += `<div class="text-[8px]">`;
    // Header
    html += `<div class="grid grid-cols-[1fr_45px_35px_30px] gap-0 px-2 py-[2px] border-b border-[#111]">
      <span class="text-[#333] font-bold uppercase">MODEL</span>
      <span class="text-[#333] font-bold uppercase text-right">RES</span>
      <span class="text-[#333] font-bold uppercase text-right">WT</span>
      <span class="text-[#333] font-bold uppercase text-right">°C</span>
    </div>`;
    // Model rows — sorted by weight descending
    const sorted = [...modelCfg.deterministic].sort((a, b) => b.weight - a.weight);
    for (const m of sorted) {
      const info = getModelInfo(m.model);
      const wt = m.weight;
      const wtColor = wt >= 1.2 ? 'c-green' : wt >= 1.0 ? 'c-white' : 'c-muted';
      const wtLabel = wt >= 1.2 ? `▲${wt.toFixed(1)}` : wt < 1.0 ? `▽${wt.toFixed(1)}` : `${wt.toFixed(1)}`;
      // Find the model's max temp prediction if available
      const pred = data.multiModel?.consensus?.predictions?.find(p => p.model === m.model);
      const tempStr = pred?.maxTemp != null ? `${pred.maxTemp.toFixed(0)}` : '—';
      const tempColor = pred?.maxTemp != null ? 'c-cyan' : 'c-muted';

      html += `<div class="grid grid-cols-[1fr_45px_35px_30px] gap-0 px-2 py-[1px] border-b border-[#0a0a0a] hover:bg-[#0a0a0a] transition-colors" data-tip="${info.name} (${info.family}) — ${info.res} resolution, ${info.coverage} coverage. Weight: ${wt}x">
        <span class="text-[#ccc] truncate">${info.name}</span>
        <span class="text-right text-[#666]">${info.res}</span>
        <span class="text-right ${wtColor} font-semibold">${wtLabel}</span>
        <span class="text-right ${tempColor}">${tempStr}</span>
      </div>`;
    }
    html += `</div>`;
  }

  $('panel-trajectory').innerHTML = html || '<div class="px-2 py-1 text-[9px] font-bold text-[#ff8c00] uppercase tracking-[0.15em] bg-[#0a0a0a] border-b border-[#1a1a1a]">TRAJECTORY</div><span class="text-[#333] text-[9px] p-[4px_8px] block">No data</span>';
}

export function renderAirQuality(data) {
  const aq = data.airQuality;
  if (!aq) { $('airquality-grid').innerHTML = '<span class="text-[#333] text-[9px]">No data</span>'; return; }
  const aqiColor = aq.usAqi <= 50 ? 'c-green' : aq.usAqi <= 100 ? 'c-amber' : 'c-red';
  const uvColor = aq.uvIndex <= 2 ? 'c-green' : aq.uvIndex <= 5 ? 'c-amber' : 'c-red';
  $('airquality-grid').innerHTML = `<div class="grid grid-cols-4 gap-[1px] bg-[#222] mobile-grid-2">
    ${mTile('AQI', aq.usAqi!=null?aq.usAqi.toFixed(0):'--', aqiColor)}
    ${mTile('UV', aq.uvIndex!=null?aq.uvIndex.toFixed(1):'--', uvColor)}
    ${mTile('PM2.5', aq.pm25!=null?aq.pm25.toFixed(1):'--', 'c-muted')}
    ${mTile('O₃', aq.ozone!=null?aq.ozone.toFixed(0):'--', 'c-muted')}
  </div>`;
}
