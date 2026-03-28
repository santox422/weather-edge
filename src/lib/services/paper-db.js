import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync, mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', '..', 'data');
if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = join(DATA_DIR, 'paper.db');
const db = new Database(DB_PATH);

// Enable WAL journal mode for better concurrency (important for Next.js app router + background loops)
db.pragma('journal_mode = WAL');

// ── SCHEMA DEFINITION ──────────────────────────────────────────

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS daily_events (
    date TEXT,
    city TEXT,
    final_temp REAL,
    winning_bracket TEXT,
    hc_data_json TEXT,
    created_at TEXT,
    PRIMARY KEY (date, city)
  );

  CREATE TABLE IF NOT EXISTS daily_signals (
    id TEXT PRIMARY KEY,
    date TEXT,
    city TEXT,
    model_column TEXT,
    pick_bracket TEXT,
    pick_prob REAL,
    pick_price REAL,
    probabilities_json TEXT,
    created_at TEXT,
    UNIQUE(date, city, model_column)
  );

  CREATE TABLE IF NOT EXISTS paper_trades (
    id TEXT PRIMARY KEY,
    date TEXT,
    city TEXT,
    model_column TEXT,
    bracket TEXT,
    side TEXT,
    entry_price REAL,
    shares REAL,
    cost REAL,
    status TEXT,
    pnl REAL,
    created_at TEXT,
    UNIQUE(date, city, model_column)
  );
`;

db.exec(SCHEMA);

// Migration: add trade metadata columns (idempotent — ignores if already exist)
const TRADE_META_COLUMNS = [
  ['traded_at_utc', 'TEXT'],       // ISO timestamp when trade was executed (UTC)
  ['traded_at_local', 'TEXT'],     // Local time in the city's timezone
  ['hours_before_eod', 'REAL'],    // Hours remaining before end of day in city timezone
  ['city_tz', 'TEXT'],             // IANA timezone of the city
  ['forecast_prob', 'REAL'],       // Model's predicted probability for this bracket
  ['market_price_at_entry', 'REAL'], // Market price (¢) when trade was placed
  ['edge_at_entry', 'REAL'],       // Edge = forecast_prob - market_price
  ['net_adjustment', 'REAL'],      // PhD factor net adjustment at time of trade
  ['model_consensus', 'TEXT'],     // Weighted median from multi-model comparison
  ['station_temp', 'REAL'],        // Live METAR temp at time of trade (if available)
];
for (const [col, type] of TRADE_META_COLUMNS) {
  try { db.exec(`ALTER TABLE paper_trades ADD COLUMN ${col} ${type}`); } catch {}
}

// Seed defaults
const seedStmt = db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`);
db.transaction(() => {
  seedStmt.run('capital', '10000');
  seedStmt.run('trade_size_pct', '0.02');
  seedStmt.run('scan_start_hours', '24');
  seedStmt.run('max_entry_price', '0.60');
  seedStmt.run('start_date', new Date().toISOString().split('T')[0]);
  seedStmt.run('allow_entries', 'true');
})();

// ── PUBLIC API ───────────────────────────────────────────────

/** Get all current settings as a parsed object */
export function getSettings() {
  const rows = db.prepare(`SELECT key, value FROM settings`).all();
  const s = {};
  for (const r of rows) {
    if (['capital', 'trade_size_pct', 'scan_start_hours', 'max_entry_price'].includes(r.key)) {
      s[r.key] = parseFloat(r.value);
    } else if (r.key === 'allow_entries') {
      s[r.key] = r.value === 'true';
    } else {
      s[r.key] = r.value;
    }
  }
  return s;
}

/** Update individual settings */
export function updateSettings(updates) {
  const stmt = db.prepare(`UPDATE settings SET value = ? WHERE key = ?`);
  db.transaction(() => {
    for (const [k, v] of Object.entries(updates)) {
      stmt.run(String(v), k);
    }
  })();
}

/** Add a new paper trade (throws if already exists due to UNIQUE constraint) */
export function addTrade(t) {
  const stmt = db.prepare(`
    INSERT INTO paper_trades (
      id, date, city, model_column, bracket, side,
      entry_price, shares, cost, status, pnl, created_at,
      traded_at_utc, traded_at_local, hours_before_eod, city_tz,
      forecast_prob, market_price_at_entry, edge_at_entry,
      net_adjustment, model_consensus, station_temp
    ) VALUES (
      @id, @date, @city, @model_column, @bracket, @side,
      @entry_price, @shares, @cost, @status, @pnl, @created_at,
      @traded_at_utc, @traded_at_local, @hours_before_eod, @city_tz,
      @forecast_prob, @market_price_at_entry, @edge_at_entry,
      @net_adjustment, @model_consensus, @station_temp
    )
  `);
  stmt.run({
    traded_at_utc: null,
    traded_at_local: null,
    hours_before_eod: null,
    city_tz: null,
    forecast_prob: null,
    market_price_at_entry: null,
    edge_at_entry: null,
    net_adjustment: null,
    model_consensus: null,
    station_temp: null,
    ...t,
    created_at: new Date().toISOString()
  });
}

export function getAllTrades() {
  return db.prepare(`SELECT * FROM paper_trades ORDER BY created_at DESC`).all();
}

/** Resolves pending trades for a date/city based on the winning bracket */
export function resolveTrades(date, city, winningBracket) {
  const pending = db.prepare(`SELECT * FROM paper_trades WHERE date = ? AND city = ? AND status = 'PENDING'`).all(date, city);
  const updateStmt = db.prepare(`UPDATE paper_trades SET status = @status, pnl = @pnl WHERE id = @id`);
  
  let changed = 0;
  db.transaction(() => {
    for (const t of pending) {
      if (t.side === 'YES') {
        const won = t.bracket === winningBracket;
        const status = won ? 'WON' : 'LOST';
        const pnl = won ? (t.shares * (1 - t.entry_price)) : -(t.cost);
        updateStmt.run({ id: t.id, status, pnl: +pnl.toFixed(2) });
        changed++;
      }
    }
  })();
  return changed;
}

/** Upsert a daily event (tracking the actual outcome and Honda's positions) */
export function upsertDailyEvent(e) {
  const stmt = db.prepare(`
    INSERT INTO daily_events (date, city, final_temp, winning_bracket, hc_data_json, created_at)
    VALUES (@date, @city, @final_temp, @winning_bracket, @hc_data_json, @created_at)
    ON CONFLICT(date, city) DO UPDATE SET
      final_temp = excluded.final_temp,
      winning_bracket = excluded.winning_bracket,
      hc_data_json = excluded.hc_data_json
  `);
  stmt.run({
    winning_bracket: null,
    hc_data_json: null,
    ...e,
    hc_data_json: e.hc_data_json ? JSON.stringify(e.hc_data_json) : null,
    created_at: new Date().toISOString()
  });
}

export function getDailyEvents(date) {
  const rows = db.prepare(`SELECT * FROM daily_events WHERE date = ?`).all(date);
  for (const r of rows) {
    if (r.hc_data_json) r.hc_data_json = JSON.parse(r.hc_data_json);
  }
  return rows;
}

export function getAllDailyEvents() {
  const rows = db.prepare(`SELECT * FROM daily_events ORDER BY date DESC, city`).all();
  for (const r of rows) {
    if (r.hc_data_json) r.hc_data_json = JSON.parse(r.hc_data_json);
  }
  return rows;
}

export function upsertDailySignal(s) {
  const stmt = db.prepare(`
    INSERT INTO daily_signals (id, date, city, model_column, pick_bracket, pick_prob, pick_price, probabilities_json, created_at)
    VALUES (@id, @date, @city, @model_column, @pick_bracket, @pick_prob, @pick_price, @probabilities_json, @created_at)
    ON CONFLICT(date, city, model_column) DO UPDATE SET
      pick_bracket = excluded.pick_bracket,
      pick_prob = excluded.pick_prob,
      pick_price = excluded.pick_price,
      probabilities_json = excluded.probabilities_json
  `);
  stmt.run({
    ...s,
    probabilities_json: s.probabilities_json ? JSON.stringify(s.probabilities_json) : null,
    created_at: new Date().toISOString()
  });
}

export function getAllSignals() {
  const rows = db.prepare(`SELECT * FROM daily_signals ORDER BY date DESC, city, model_column`).all();
  for (const r of rows) {
    if (r.probabilities_json) r.probabilities_json = JSON.parse(r.probabilities_json);
  }
  return rows;
}

/** 
 * Returns overall portfolio performance per model:
 * Uses starting capital, adds realized PnL, handles pending deployments.
 */
export function getModelPortfolios() {
  const settings = getSettings();
  const startCap = settings.capital;
  const models = ['ENS', 'BMA', 'ENS_PHD', 'BMA_PHD'];
  const trades = getAllTrades();

  const portfolios = {};
  for (const m of models) {
    const modelTrades = trades.filter(t => t.model_column === m);
    const resolved = modelTrades.filter(t => t.status !== 'PENDING');
    const pending = modelTrades.filter(t => t.status === 'PENDING');
    
    const wins = resolved.filter(t => t.status === 'WON');
    const losses = resolved.filter(t => t.status === 'LOST');
    
    const realizedPnl = resolved.reduce((s, t) => s + (t.pnl || 0), 0);
    const deployed = pending.reduce((s, t) => s + (t.cost || 0), 0);
    
    portfolios[m] = {
      model_column: m,
      startingCapital: startCap,
      balance: +(startCap + realizedPnl).toFixed(2),
      deployed: +deployed.toFixed(2),
      available: +(startCap + realizedPnl - deployed).toFixed(2),
      realizedPnl: +realizedPnl.toFixed(2),
      totalTrades: modelTrades.length,
      wins: wins.length,
      losses: losses.length,
      pending: pending.length,
      winRate: resolved.length > 0 ? +(wins.length / resolved.length * 100).toFixed(1) : 0,
    };
  }
  return portfolios;
}

/** Delete trades and signals for dates after today (cleanup for early-entry bug) */
export function deleteFutureTrades(todayStr) {
  const delTrades = db.prepare(`DELETE FROM paper_trades WHERE date > ?`);
  const delSignals = db.prepare(`DELETE FROM daily_signals WHERE date > ?`);
  const delEvents = db.prepare(`DELETE FROM daily_events WHERE date > ?`);
  
  const result = db.transaction(() => {
    const t = delTrades.run(todayStr);
    const s = delSignals.run(todayStr);
    const e = delEvents.run(todayStr);
    return { trades: t.changes, signals: s.changes, events: e.changes };
  })();
  
  return result;
}
