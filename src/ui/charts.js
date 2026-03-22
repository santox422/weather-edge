/**
 * Charts — ensemble forecast, multi-model comparison, historical base rate.
 */
import { $, esc } from './helpers.js';
import { state } from '../main.js';

export function drawEnsemble(data) {
  const canvas = $('chart-ensemble');
  if (state.ensembleChart) state.ensembleChart.destroy();
  const ens = data.ensemble;
  if (!ens?.timeSteps?.length) {
    canvas.parentElement.innerHTML = '<canvas id="chart-ensemble"></canvas><span class="text-[#333] text-[9px] block text-center py-4">No ensemble data</span>';
    return;
  }

  const steps = ens.timeSteps;
  const rate = Math.max(1, Math.floor(steps.length / 60));
  const s = steps.filter((_, i) => i % rate === 0);

  const labels = s.map((p) => {
    const d = new Date(p.time);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit' });
  });

  const ds = [
    { label: 'P90', data: s.map((p) => p.p90), borderColor: '#ff333380', backgroundColor: '#ff333308', fill: '+1', borderWidth: 1, pointRadius: 0, tension: 0.3 },
    { label: 'P75', data: s.map((p) => p.p75), borderColor: '#ff8c0060', backgroundColor: '#ff8c0010', fill: '+1', borderWidth: 1, pointRadius: 0, tension: 0.3 },
    { label: 'Median', data: s.map((p) => p.p50), borderColor: '#ff8c00', backgroundColor: 'transparent', borderWidth: 2, pointRadius: 0, tension: 0.3 },
    { label: 'P25', data: s.map((p) => p.p25), borderColor: '#ff8c0060', backgroundColor: '#ff8c0010', fill: '-1', borderWidth: 1, pointRadius: 0, tension: 0.3 },
    { label: 'P10', data: s.map((p) => p.p10), borderColor: '#00ff4180', backgroundColor: '#00ff4108', fill: '-1', borderWidth: 1, pointRadius: 0, tension: 0.3 },
  ];

  const thresholds = data.market?.thresholds || [];
  const uniqs = [...new Set(thresholds.map((t) => t.value))];
  const cols = ['#bb86fc', '#ff3333', '#00bcd4'];
  uniqs.slice(0, 3).forEach((v, i) => ds.push({ label: `${v}°`, data: s.map(() => v), borderColor: cols[i], borderWidth: 1.5, borderDash: [4, 3], pointRadius: 0, fill: false }));

  state.ensembleChart = new Chart(canvas, { type: 'line', data: { labels, datasets: ds }, options: terminalChartOpts('°') });
}

export function drawModels(data) {
  const el = $('model-bars');
  const mm = data.multiModel;
  if (!mm?.consensus) { el.innerHTML = '<span class="text-[#333] text-[9px]">No data</span>'; return; }

  const preds = (mm.consensus.predictions || []).filter((p) => p.maxTemp != null);
  if (preds.length === 0) { el.innerHTML = '<span class="text-[#333] text-[9px]">No data</span>'; return; }
  const maxT = Math.max(...preds.map((p) => p.maxTemp || 0), 1);

  el.innerHTML = preds.map((p) => {
    const pctVal = ((p.maxTemp || 0) / (maxT * 1.15)) * 100;
    const barBg = p.exceedsThreshold ? 'bg-[#00ff41]' : 'bg-[#ff3333]';
    const textCls = p.exceedsThreshold ? 'c-green' : 'c-red';
    const modelName = p.model.replace('_seamless','').replace('_ifs025',' IFS').replace('_aifs025',' AIFS').toUpperCase();
    const modelTip = p.model.includes('gfs') ? 'Global Forecast System (NOAA) — US primary weather model'
      : p.model.includes('ecmwf') && p.model.includes('aifs') ? 'ECMWF AIFS — AI-based forecast from European Centre'
      : p.model.includes('ecmwf') ? 'European Centre for Medium-Range Weather Forecasts — generally most accurate global model'
      : p.model.includes('icon') ? 'ICON (DWD) — German weather service high-resolution model'
      : p.model.includes('jma') ? 'JMA (Japan) — Japanese Meteorological Agency global model'
      : p.model.includes('gem') ? 'GEM (Canada) — Canadian Global Environmental Multiscale model'
      : p.model.includes('meteofrance') ? 'Météo-France — French national weather service model'
      : `${modelName} weather model prediction`;
    const threshTip = p.exceedsThreshold ? 'Exceeds the market threshold — supports YES' : 'Below the market threshold — supports NO';
    return `<div class="flex items-center gap-[6px] px-2 py-[2px]" title="${modelTip}">
      <span class="text-[8px] text-[#666] w-[60px] truncate font-semibold">${modelName}</span>
      <div class="flex-1 h-[6px] bg-[#111] overflow-hidden"><div class="${barBg} h-full transition-all" style="width:${pctVal}%" title="${threshTip}"></div></div>
      <span class="text-[10px] font-bold w-[45px] text-right ${textCls}" title="Max temperature prediction: ${p.maxTemp != null ? p.maxTemp.toFixed(1) + '°C' : 'N/A'}">${p.maxTemp != null ? p.maxTemp.toFixed(1) + '°C' : '--'}</span>
    </div>`;
  }).join('') + `<div class="text-[8px] text-[#444] text-center py-[3px] border-t border-[#111]" title="Percentage of models that agree on whether the temperature exceeds the primary threshold">
    ${(mm.consensus.agreementRatio * 100).toFixed(0)}% agreement ${mm.consensus.allAgree ? '│ UNANIMOUS' : '│ DIVERGENT'}
  </div>`;
}

export function drawHistory(data) {
  const canvas = $('chart-history');
  if (state.historyChart) state.historyChart.destroy();
  const br = data.baseRate;
  if (!br?.values?.length) {
    canvas.parentElement.style.display = 'none';
    $('baserate-text').textContent = br ? 'Rate limited — retry' : 'No base rate data';
    return;
  }
  canvas.parentElement.style.display = 'block';
  const thresh = data.market?.threshold;

  state.historyChart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: br.values.map((_, i) => `${i + 1}`),
      datasets: [{ label: 'Max Temp', data: br.values, backgroundColor: br.values.map((v) => thresh && v >= thresh ? '#00ff4199' : '#ff8c0066'), borderRadius: 0 }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { backgroundColor: '#111', titleColor: '#ff8c00', bodyColor: '#ccc', borderColor: '#333', borderWidth: 1, bodyFont: { family: "'JetBrains Mono'", size: 9 }, cornerRadius: 0 } },
      scales: {
        x: { grid: { display: false }, ticks: { display: false } },
        y: { grid: { color: '#111' }, ticks: { color: '#444', font: { family: "'JetBrains Mono'", size: 9 }, callback: (v) => v + '°' } }
      }
    },
  });

  $('baserate-text').innerHTML = `Historical: <strong class="text-[#ff8c00]">${br.rate != null ? (br.rate * 100).toFixed(0) + '%' : 'N/A'}</strong> exceeded threshold over <strong class="text-[#ccc]">${br.sampleSize}</strong> observations (~${br.years} years).`;
}

function terminalChartOpts(suffix) {
  return {
    responsive: true, maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: true, position: 'top', labels: { color: '#444', font: { family: "'JetBrains Mono'", size: 8 }, usePointStyle: true, pointStyle: 'line', padding: 8 } },
      tooltip: { backgroundColor: '#111', titleColor: '#ff8c00', bodyColor: '#888', borderColor: '#333', borderWidth: 1, bodyFont: { family: "'JetBrains Mono'", size: 9 }, padding: 6, cornerRadius: 0 },
    },
    scales: {
      x: { grid: { color: '#0a0a0a' }, ticks: { color: '#333', font: { family: "'JetBrains Mono'", size: 7 }, maxTicksLimit: 8, maxRotation: 0 } },
      y: { grid: { color: '#111' }, ticks: { color: '#444', font: { family: "'JetBrains Mono'", size: 9 }, callback: (v) => v + suffix } },
    },
  };
}
