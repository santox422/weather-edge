/**
 * SQLite database layer for @HondaCivic strategy analysis.
 * Uses better-sqlite3 for synchronous, high-performance access.
 */

import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, 'hondacivic.db');

let _db = null;

export function getDb() {
  if (_db) return _db;
  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');
  _db.pragma('synchronous = NORMAL');
  initSchema(_db);
  return _db;
}

function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER NOT NULL,
      type TEXT NOT NULL,
      condition_id TEXT NOT NULL,
      event_slug TEXT NOT NULL,
      title TEXT NOT NULL,
      side TEXT,
      outcome TEXT,
      outcome_index INTEGER,
      price REAL,
      size REAL,
      usdc_size REAL,
      transaction_hash TEXT,
      asset TEXT,
      -- Parsed fields
      city TEXT,
      target_date TEXT,
      temperature INTEGER,
      temp_high INTEGER,
      unit TEXT,
      UNIQUE(transaction_hash)
    );

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_slug TEXT UNIQUE,
      city TEXT,
      target_date TEXT,
      unit TEXT,
      total_invested REAL DEFAULT 0,
      total_redeemed REAL DEFAULT 0,
      pnl REAL DEFAULT 0,
      trade_count INTEGER DEFAULT 0,
      is_resolved INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS positions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_slug TEXT,
      condition_id TEXT,
      temperature INTEGER,
      temp_high INTEGER,
      unit TEXT,
      total_yes_size REAL DEFAULT 0,
      total_no_size REAL DEFAULT 0,
      avg_yes_price REAL DEFAULT 0,
      avg_no_price REAL DEFAULT 0,
      total_yes_cost REAL DEFAULT 0,
      total_no_cost REAL DEFAULT 0,
      num_yes_trades INTEGER DEFAULT 0,
      num_no_trades INTEGER DEFAULT 0,
      UNIQUE(event_slug, condition_id)
    );

    CREATE INDEX IF NOT EXISTS idx_trades_city ON trades(city);
    CREATE INDEX IF NOT EXISTS idx_trades_date ON trades(target_date);
    CREATE INDEX IF NOT EXISTS idx_trades_timestamp ON trades(timestamp);
    CREATE INDEX IF NOT EXISTS idx_trades_event ON trades(event_slug);
    CREATE INDEX IF NOT EXISTS idx_events_city ON events(city);
    CREATE INDEX IF NOT EXISTS idx_events_date ON events(target_date);
    CREATE INDEX IF NOT EXISTS idx_positions_event ON positions(event_slug);

    CREATE TABLE IF NOT EXISTS scrape_meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);
}

// ─── Prepared Statements ─────────────────────────────────────────────

export function insertTrade(db, trade) {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO trades
      (timestamp, type, condition_id, event_slug, title, side, outcome,
       outcome_index, price, size, usdc_size, transaction_hash, asset,
       city, target_date, temperature, temp_high, unit)
    VALUES
      (@timestamp, @type, @condition_id, @event_slug, @title, @side, @outcome,
       @outcome_index, @price, @size, @usdc_size, @transaction_hash, @asset,
       @city, @target_date, @temperature, @temp_high, @unit)
  `);
  return stmt.run(trade);
}

export function upsertEvent(db, evt) {
  const stmt = db.prepare(`
    INSERT INTO events (event_slug, city, target_date, unit, total_invested, total_redeemed, pnl, trade_count, is_resolved)
    VALUES (@event_slug, @city, @target_date, @unit, @total_invested, @total_redeemed, @pnl, @trade_count, @is_resolved)
    ON CONFLICT(event_slug) DO UPDATE SET
      total_invested = @total_invested,
      total_redeemed = @total_redeemed,
      pnl = @pnl,
      trade_count = @trade_count,
      is_resolved = @is_resolved
  `);
  return stmt.run(evt);
}

export function upsertPosition(db, pos) {
  const stmt = db.prepare(`
    INSERT INTO positions
      (event_slug, condition_id, temperature, temp_high, unit,
       total_yes_size, total_no_size, avg_yes_price, avg_no_price,
       total_yes_cost, total_no_cost, num_yes_trades, num_no_trades)
    VALUES
      (@event_slug, @condition_id, @temperature, @temp_high, @unit,
       @total_yes_size, @total_no_size, @avg_yes_price, @avg_no_price,
       @total_yes_cost, @total_no_cost, @num_yes_trades, @num_no_trades)
    ON CONFLICT(event_slug, condition_id) DO UPDATE SET
      total_yes_size = @total_yes_size,
      total_no_size = @total_no_size,
      avg_yes_price = @avg_yes_price,
      avg_no_price = @avg_no_price,
      total_yes_cost = @total_yes_cost,
      total_no_cost = @total_no_cost,
      num_yes_trades = @num_yes_trades,
      num_no_trades = @num_no_trades
  `);
  return stmt.run(pos);
}

export function setMeta(db, key, value) {
  db.prepare('INSERT OR REPLACE INTO scrape_meta (key, value) VALUES (?, ?)').run(key, value);
}

export function getMeta(db, key) {
  const row = db.prepare('SELECT value FROM scrape_meta WHERE key = ?').get(key);
  return row ? row.value : null;
}

export function closeDb() {
  if (_db) {
    _db.close();
    _db = null;
  }
}
