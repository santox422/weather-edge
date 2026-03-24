/**
 * Signal Logger — persists analysis signals to disk as JSONL for
 * Brier Score backtesting and retrieval.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SIGNALS_DIR = path.resolve(__dirname, '../../.cache/signals');
if (!fs.existsSync(SIGNALS_DIR)) fs.mkdirSync(SIGNALS_DIR, { recursive: true });

/**
 * Log every analysis signal to disk for Brier Score backtesting.
 * Signals are written as JSONL to .cache/signals/YYYY-MM-DD.jsonl
 */
export function logSignal(analysis) {
  try {
    const edge = analysis.edge;
    if (!edge || !analysis.city || !analysis.market) return;

    const best = edge.bracketProbabilities?.reduce((best, b) => {
      if (!b.edge || !best) return best || b;
      return Math.abs(b.edge) > Math.abs(best.edge) ? b : best;
    }, null);

    const signal = {
      timestamp: new Date().toISOString(),
      city: analysis.city.matchedKey,
      date: analysis.market.endDate?.split('T')[0] || null,
      bestBracket: best?.name || null,
      forecastProb: best?.forecastProb || null,
      marketPrice: best?.marketPrice || null,
      edge: best?.edge || null,
      signal: edge.signal,
      confidence: parseFloat(edge.confidence) || null,
      adjustedEdge: parseFloat(edge.adjustedEdge) || null,
      stationBias: analysis.stationBias?.bias || 0,
      memberCount: analysis.ensemble?.memberCount || 0,
      // Fields for post-resolution verification
      resolved: false,
      actualTemp: null,
      outcome: null,
      brierScore: null,
    };

    const dateStr = new Date().toISOString().split('T')[0];
    const logFile = path.join(SIGNALS_DIR, `${dateStr}.jsonl`);
    fs.appendFileSync(logFile, JSON.stringify(signal) + '\n', 'utf-8');
  } catch {
    // Signal logging should never break the analysis pipeline
  }
}

/**
 * Get historical signal logs for backtesting dashboard display
 */
export function getSignalLogs(daysBack = 7) {
  const logs = [];
  for (let i = 0; i < daysBack; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split('T')[0];
    const logFile = path.join(SIGNALS_DIR, `${dateStr}.jsonl`);
    try {
      if (fs.existsSync(logFile)) {
        const lines = fs.readFileSync(logFile, 'utf-8').trim().split('\n');
        for (const line of lines) {
          try { logs.push(JSON.parse(line)); } catch { /* skip bad lines */ }
        }
      }
    } catch { /* skip */ }
  }
  return logs;
}
