/**
 * Paper Trade Store — persistent JSON file storage for paper trades.
 * Survives server restarts by writing to data/ directory.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', '..', 'data');
const TRADES_FILE = join(DATA_DIR, 'paper-trades.json');
const PORTFOLIO_FILE = join(DATA_DIR, 'paper-portfolio.json');

const STARTING_BALANCE = 10000;

// Ensure data directory exists
function ensureDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

// ── Read / Write helpers ────────────────────────────────────────────

function readJSON(filepath, fallback) {
  try {
    if (!existsSync(filepath)) return fallback;
    return JSON.parse(readFileSync(filepath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJSON(filepath, data) {
  ensureDir();
  writeFileSync(filepath, JSON.stringify(data, null, 2));
}

// ── Trades ──────────────────────────────────────────────────────────

export function getAllTrades() {
  return readJSON(TRADES_FILE, []);
}

export function saveTrades(trades) {
  writeJSON(TRADES_FILE, trades);
}

/**
 * Add paper trades for a city/date event.
 * Deduplicates by city+date+bracket+side combo.
 */
export function addTrades(newTrades) {
  const existing = getAllTrades();
  const keys = new Set(existing.map(t => `${t.city}|${t.date}|${t.bracket}|${t.side}`));

  let added = 0;
  for (const t of newTrades) {
    const key = `${t.city}|${t.date}|${t.bracket}|${t.side}`;
    if (!keys.has(key)) {
      existing.push(t);
      keys.add(key);
      added++;
    }
  }

  if (added > 0) {
    saveTrades(existing);
    updatePortfolioFromTrades(existing);
  }
  return { added, total: existing.length };
}

/**
 * Get trades filtered by criteria.
 */
export function getTrades({ date, city, status } = {}) {
  let trades = getAllTrades();
  if (date) trades = trades.filter(t => t.date === date);
  if (city) trades = trades.filter(t => t.city === city);
  if (status) trades = trades.filter(t => t.status === status);
  return trades;
}

/**
 * Resolve an event — mark all trades for that city/date as won or lost.
 * @param {string} city
 * @param {string} date
 * @param {number} actualTemp — the actual temperature reported by Wunderground
 */
export function resolveEvent(city, date, actualTemp) {
  const trades = getAllTrades();
  let changed = false;

  for (const t of trades) {
    if (t.city !== city || t.date !== date || t.status !== 'PENDING') continue;

    const winningBracket = `${actualTemp}°C`;
    changed = true;

    if (t.side === 'YES') {
      if (t.bracket === winningBracket) {
        t.status = 'WON';
        t.pnl = +(t.shares * (1 - t.entryPrice)).toFixed(2);
      } else {
        t.status = 'LOST';
        t.pnl = +(-(t.shares * t.entryPrice)).toFixed(2);
      }
    } else {
      // NO bet
      if (t.bracket !== winningBracket) {
        t.status = 'WON';
        t.pnl = +(t.shares * (1 - t.entryPrice)).toFixed(2);
      } else {
        t.status = 'LOST';
        t.pnl = +(-(t.shares * t.entryPrice)).toFixed(2);
      }
    }
  }

  if (changed) {
    saveTrades(trades);
    updatePortfolioFromTrades(trades);
  }
  return changed;
}

// ── Portfolio ───────────────────────────────────────────────────────

export function getPortfolio() {
  return readJSON(PORTFOLIO_FILE, {
    startingBalance: STARTING_BALANCE,
    balance: STARTING_BALANCE,
    deployed: 0,
    realizedPnl: 0,
    unrealizedPnl: 0,
    totalTrades: 0,
    wins: 0,
    losses: 0,
    pending: 0,
    winRate: 0,
    dailySnapshots: [],
  });
}

function updatePortfolioFromTrades(trades) {
  const resolved = trades.filter(t => t.status !== 'PENDING');
  const pending = trades.filter(t => t.status === 'PENDING');
  const wins = resolved.filter(t => t.status === 'WON');
  const losses = resolved.filter(t => t.status === 'LOST');
  const realizedPnl = resolved.reduce((s, t) => s + (t.pnl || 0), 0);
  const deployed = pending.reduce((s, t) => s + (t.cost || 0), 0);

  // Balance = starting capital + realized PnL (deployed is capital at risk, not spent)
  const portfolio = {
    startingBalance: STARTING_BALANCE,
    balance: +(STARTING_BALANCE + realizedPnl).toFixed(2),
    deployed: +deployed.toFixed(2),
    available: +(STARTING_BALANCE + realizedPnl - deployed).toFixed(2),
    realizedPnl: +realizedPnl.toFixed(2),
    unrealizedPnl: 0,
    totalTrades: trades.length,
    wins: wins.length,
    losses: losses.length,
    pending: pending.length,
    winRate: resolved.length > 0 ? +(wins.length / resolved.length * 100).toFixed(1) : 0,
    events: [...new Set(trades.map(t => `${t.city}|${t.date}`))].length,
  };

  writeJSON(PORTFOLIO_FILE, portfolio);
  return portfolio;
}
