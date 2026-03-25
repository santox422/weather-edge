// Tooltip definitions used across the terminal UI
export const TOOLTIPS: Record<string, string> = {
  'OUTCOME': 'Temperature bracket name. Each bracket covers a specific temperature range for the forecast day.',
  'RAW': 'Raw ensemble-only probability before Bayesian Model Averaging (BMA) blending with deterministic models.',
  'ADJ. EDGE': 'Edge adjusted for forecast skill decay, model uncertainty, and confidence level.',
  'CONFIDENCE': 'Overall confidence in the signal (0-100%). Factors: model agreement, ensemble spread, forecast horizon, and station bias reliability.',
  'SIGNAL': 'Trading signal: STRONG BUY = high conviction long, BUY = moderate long, STRONG BUY NO = high conviction fade, HOLD = no clear edge.',
  'GFS': 'Global Forecast System (NOAA) — primary US weather model prediction for max temperature.',
  'ECMWF': 'European Centre for Medium-Range Weather Forecasts — generally considered the most accurate global model.',
  'DELTA': 'Temperature difference between the two leading models (GFS vs ECMWF).',
  'WARMER': 'Which model is predicting a higher max temperature.',
  'DAYS OUT': 'Days until market resolution. Shorter lead time = higher forecast accuracy.',
  'SKILL': 'Estimated forecast accuracy percentage based on lead time. Decays with longer horizons.',
  'GRADE': 'Forecast reliability grade from A+ to F.',
  'ENS CAL': 'Ensemble Calibration Score. 2-4 = well-calibrated, <2 = overconfident, >4 = wide/uncertain.',
  'SPREAD': 'Average spread across ensemble members. Higher spread = more uncertainty.',
  'CONSENSUS': 'Percentage of independent weather models agreeing on which bracket the temperature falls in.',
  'HUMIDITY': 'Relative humidity (%) at the forecast location.',
  'DEW PT': 'Dew point temperature (°C). Indicates moisture content.',
  'WIND': 'Sustained wind speed in miles per hour.',
  'GUSTS': 'Maximum wind gusts (mph).',
  'PRESSURE': 'Sea-level atmospheric pressure in hectopascals.',
  'CLOUD': 'Cloud cover percentage.',
  'VIS': 'Visibility in kilometers.',
  'PRECIP': 'Precipitation probability (%).',
  'BIAS': 'Systematic forecast error at this weather station.',
  'STD': 'Standard deviation of the bias correction.',
  'N': 'Number of historical observations used to calculate the station bias.',
  'STATUS': 'Whether enough historical samples exist to reliably correct for station bias.',
  'MEMBERS': 'Number of ensemble members used for probability estimation.',
  'METHOD': 'Kernel Density Estimation — converts discrete ensemble member temperatures into a smooth probability distribution.',
  'BW': 'Kernel bandwidth (°C). Controls smoothing.',
  'AQI': 'US Air Quality Index. 0-50 = Good, 51-100 = Moderate, 101+ = Unhealthy.',
  'UV': 'UV Index. 0-2 = Low risk, 3-5 = Moderate, 6-7 = High, 8+ = Very High.',
  'PM2.5': 'Fine particulate matter (μg/m³).',
  'O₃': 'Ground-level ozone concentration (μg/m³).',
  'WIN': 'Overall probability that the combined strategy ends up profitable.',
  'E[R]': 'Expected return — the probability-weighted average return.',
  'MAX↓': 'Maximum drawdown — the worst-case portfolio loss.',
  'DEPLOY': 'Total percentage of portfolio deployed across all bets.',
  'BRACKET': 'Temperature bracket being traded on Polymarket.',
  'ALLOC': 'Kelly Criterion allocation — optimal bet size as a percentage of your portfolio.',
  'AMT': 'Dollar amount to wager based on your portfolio size and the recommended allocation.',
  'ENTRY': 'Entry price in cents — what you pay per YES share.',
  'FCST': 'Forecast probability from weather models.',
  'EDGE': 'Your edge — the difference between the forecast probability and the current market price.',
  'MKT': 'Current market YES price in cents.',
  'NO+': 'Edge from buying NO on this bracket.',
  'OVER': 'How overpriced the YES contract is relative to the forecast.',
  'RISK': 'Maximum potential loss on this single trade.',
  'NO@': 'NO contract entry price in cents.',
  'WIN%': 'Probability of this individual NO trade being profitable.',
  'PROFIT': 'Profit per share (in cents) if the NO bet wins.',
  'PORTFOLIO': 'Your total trading bankroll in USD.',
  'TREND': 'Direction and magnitude of forecast changes over recent model runs.',
  'MODELS': 'Number of deterministic weather models used for consensus.',
};

export function esc(s: string): string {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

export function fmtDateLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  const today = new Date().toISOString().split('T')[0];
  if (dateStr === today) return 'TODAY';
  const yd = new Date();
  yd.setDate(yd.getDate() - 1);
  if (dateStr === yd.toISOString().split('T')[0]) return 'YESTERDAY';
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase();
}

export function isoToFlag(code: string): string {
  if (!code) return '';
  return String.fromCodePoint(...code.toUpperCase().split('').map((c) => 0x1F1E6 + c.charCodeAt(0) - 65));
}

export function pct(v: number): string { return (v * 100).toFixed(0) + '%'; }
export function fmtEdge(v: any): string { if (!v && v !== 0) return '--'; const n = parseFloat(v); return (n > 0 ? '+' : '') + v + '%'; }
export function edgeColor(v: any): string { const n = parseFloat(v); return n > 0 ? 'text-[#00ff41]' : n < 0 ? 'text-[#ff3333]' : 'text-[#555]'; }
