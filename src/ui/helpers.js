/**
 * Shared helpers, TOOLTIPS, and utility functions.
 */

export const $ = (id) => document.getElementById(id);

// ─── Tooltip Definitions ──────────────────────────────────────
export const TOOLTIPS = {
  'ADJ. EDGE': 'Edge adjusted for forecast skill decay, model uncertainty, and confidence level. This is the edge you should actually trade on.',
  'CONFIDENCE': 'Overall confidence in the signal (0-100%). Factors: model agreement, ensemble spread, forecast horizon, and station bias reliability.',
  'SIGNAL': 'Trading signal: STRONG BUY = high conviction long, BUY = moderate long, STRONG BUY NO = high conviction fade, HOLD = no clear edge.',
  'GFS': 'Global Forecast System (NOAA) — primary US weather model prediction for max temperature.',
  'ECMWF': 'European Centre for Medium-Range Weather Forecasts — generally considered the most accurate global model.',
  'DELTA': 'Temperature difference between the two leading models (GFS vs ECMWF).',
  'WARMER': 'Which model is predicting a higher max temperature.',
  'DAYS OUT': 'Days until market resolution. Shorter lead time = higher forecast accuracy.',
  'SKILL': 'Estimated forecast accuracy percentage based on lead time. Decays with longer horizons.',
  'GRADE': 'Forecast reliability grade from A+ (1d out, ~95% accurate) to F (14d+, <20% accurate).',
  'ENS CAL': 'Ensemble Calibration Score. Measures ensemble spread quality. 2-4 = well-calibrated (green), <2 = suspiciously tight/overconfident (amber), >4 = wide/uncertain (red).',
  'SPREAD': 'Average spread across ensemble members. Higher spread = more uncertainty in the forecast.',
  'CONSENSUS': 'Percentage of independent weather models agreeing on which bracket the temperature falls in.',
  'HUMIDITY': 'Relative humidity (%) at the forecast location. High humidity can suppress max temperature.',
  'DEW PT': 'Dew point temperature (°C). Indicates moisture content; affects how hot it actually feels.',
  'WIND': 'Sustained wind speed in miles per hour. Strong winds can mix atmosphere and affect temperature.',
  'GUSTS': 'Maximum wind gusts (mph). Brief peaks in wind speed.',
  'PRESSURE': 'Sea-level atmospheric pressure in hectopascals (hPa). Low = stormy, High = stable/clear.',
  'CLOUD': 'Cloud cover percentage. More cloud = less solar heating = lower max temperature.',
  'VIS': 'Visibility in kilometers. Low visibility may indicate fog or haze.',
  'PRECIP': 'Precipitation probability (%). Rain or snow can significantly suppress max temperature.',
  'BIAS': 'Systematic forecast error at this weather station. Negative = forecasts run warm (actual temps lower). Used to correct predictions.',
  'STD': 'Standard deviation of the bias correction. Smaller = more consistent and reliable correction.',
  'N': 'Number of historical observations used to calculate the station bias. More samples = more reliable.',
  'STATUS': 'Whether enough historical samples exist to reliably correct for station bias. ACTIVE = reliable (n≥30).',
  'MEMBERS': 'Number of ensemble members (individual model runs with perturbed initial conditions) used for probability estimation.',
  'METHOD': 'Kernel Density Estimation — converts discrete ensemble member temperatures into a smooth probability distribution across brackets.',
  'BW': 'Kernel bandwidth (°C). Controls smoothing of the probability distribution. 0.5°C balances precision vs. noise.',
  'AQI': 'US Air Quality Index. 0-50 = Good (green), 51-100 = Moderate (amber), 101+ = Unhealthy (red).',
  'UV': 'UV Index. 0-2 = Low risk, 3-5 = Moderate, 6-7 = High, 8+ = Very High.',
  'PM2.5': 'Fine particulate matter (μg/m³). Particles ≤2.5 microns diameter. Higher = worse air quality.',
  'O₃': 'Ground-level ozone concentration (μg/m³). A secondary pollutant formed by sunlight + vehicle emissions.',
  'WIN': 'Overall probability that the combined strategy (all bets together) ends up profitable.',
  'E[R]': 'Expected return — the probability-weighted average return across all possible outcomes.',
  'MAX↓': 'Maximum drawdown — the worst-case portfolio loss if all bets lose.',
  'DEPLOY': 'Total percentage of portfolio deployed across all bets. Remainder stays as cash.',
  'BRACKET': 'Temperature bracket being traded on Polymarket.',
  'ALLOC': 'Kelly Criterion allocation — optimal bet size as a percentage of your portfolio, adjusted for confidence.',
  'AMT': 'Dollar amount to wager based on your portfolio size and the recommended allocation.',
  'ENTRY': 'Entry price in cents — what you pay per YES share.',
  'FCST': 'Forecast probability from weather models (ensemble + multi-model consensus).',
  'EDGE': 'Your edge — the difference between the forecast probability and the current market price. Positive = underpriced.',
  'MKT': 'Current market YES price in cents — what Polymarket is pricing this bracket at.',
  'NO+': 'Edge from buying NO on this bracket: (1 - forecast prob) - NO price. Higher = more profitable fade.',
  'OVER': 'How overpriced the YES contract is relative to the forecast. Larger negative = more overpriced.',
  'RISK': 'Maximum potential loss on this single trade as a percentage of the position.',
  'NO@': 'NO contract entry price in cents.',
  'WIN%': 'Probability of this individual NO trade being profitable.',
  'PROFIT': 'Profit per share (in cents) if the NO bet wins.',
  'PORTFOLIO': 'Your total trading bankroll in USD. Adjust this to see position sizes for your capital.',
  'TREND': 'Direction and magnitude of forecast changes over recent model runs. Cooling = temperature dropping, Warming = rising.',
};

// ─── HTML helpers ─────────────────────────────────────────────
export function mTile(label, value, colorClass = 'c-white') {
  const tip = TOOLTIPS[label] || '';
  const titleAttr = tip ? ` data-tip="${tip}"` : '';
  return `<div class="bg-[#0a0a0a] p-[4px_6px] cursor-help"${titleAttr}><div class="text-[7px] text-[#444] uppercase tracking-[0.12em] font-semibold">${label}</div><div class="text-[11px] font-bold mt-[1px] ${colorClass}">${value}</div></div>`;
}

export function metricCell(label, value, colorClass = 'c-white') {
  const tip = TOOLTIPS[label] || '';
  const titleAttr = tip ? ` data-tip="${tip}"` : '';
  return `<div class="bg-[#0a0a0a] p-[4px_6px] cursor-help"${titleAttr}><div class="text-[7px] text-[#444] uppercase tracking-[0.15em]">${label}</div><div class="text-[12px] font-bold mt-[1px] ${colorClass}">${value}</div></div>`;
}

export function setStatus(st, text) {
  const dot = $('status-indicator').querySelector('.status-dot');
  dot.className = 'status-dot ' + (st === 'live' ? 'live' : st === 'error' ? 'error' : 'loading');
  $('status-indicator').querySelector('.status-text').textContent = text;
}

export function pct(v) { return (v * 100).toFixed(0) + '%'; }
export function fmtEdge(v) { if (!v && v !== 0) return '--'; const n = parseFloat(v); return (n > 0 ? '+' : '') + v + '%'; }
export function edgeColor(v) { const n = parseFloat(v); return n > 0 ? 'c-green' : n < 0 ? 'c-red' : 'c-muted'; }
export function signalColor(s) {
  if (!s) return 'c-muted';
  if (s.includes('STRONG') && s.includes('NO')) return 'c-red';
  if (s.includes('STRONG')) return 'c-green';
  if (s.includes('NO')) return 'c-red';
  if (s.includes('BUY')) return 'c-green';
  return 'c-muted';
}

export function fmtDateLabel(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  const today = new Date().toISOString().split('T')[0];
  if (dateStr === today) return 'TODAY';
  const yd = new Date(); yd.setDate(yd.getDate() - 1);
  if (dateStr === yd.toISOString().split('T')[0]) return 'YESTERDAY';
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase();
}

export function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

export function cc(cls, text) { return `<span class="${cls}">${text}</span>`; }

export function isoToFlag(code) {
  if (!code) return '';
  return String.fromCodePoint(...code.toUpperCase().split('').map((c) => 0x1F1E6 + c.charCodeAt(0) - 65));
}
