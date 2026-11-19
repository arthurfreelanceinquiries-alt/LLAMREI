-- Fase 3 Migration: Trading Journal (with Tilt Guard Correlation) & Linked Workspace Docs

CREATE TABLE IF NOT EXISTS trading_journal_entries (
    id TEXT PRIMARY KEY,
    symbol TEXT NOT NULL,
    direction TEXT NOT NULL CHECK (direction IN ('buy', 'sell')),
    session TEXT NOT NULL CHECK (session IN ('sydney', 'tokyo', 'london', 'new_york')),
    entry_price REAL NOT NULL,
    exit_price REAL,
    stop_loss REAL,
    take_profit REAL,
    r_multiple REAL NOT NULL DEFAULT 0,
    pnl_usd REAL NOT NULL DEFAULT 0,
    outcome TEXT NOT NULL DEFAULT 'open' CHECK (outcome IN ('win', 'loss', 'breakeven', 'open')),
    emotion TEXT NOT NULL DEFAULT 'calm' CHECK (emotion IN ('calm', 'focused', 'fomo', 'revenge', 'hesitant', 'tilted')),
    setup_reason TEXT NOT NULL DEFAULT '',
    evaluation_note TEXT NOT NULL DEFAULT '',
    checkin_date_wib TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_journal_created ON trading_journal_entries(created_at DESC);

CREATE TABLE IF NOT EXISTS workspace_docs (
    id TEXT PRIMARY KEY,
    space_id TEXT REFERENCES spaces(id) ON DELETE CASCADE,
    linked_task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    content_md TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_docs_task ON workspace_docs(linked_task_id);

-- Seed initial realistic journal entries
INSERT OR IGNORE INTO trading_journal_entries
  (id, symbol, direction, session, entry_price, exit_price, stop_loss, take_profit, r_multiple, pnl_usd, outcome, emotion, setup_reason, evaluation_note, checkin_date_wib)
VALUES
  ('jrn_1', 'XAUUSD', 'buy', 'london', 2628.5, 2641.5, 2622.0, 2641.5, 2.0, 200.0, 'win', 'focused', 'Liquidity sweep Asian Low + FVG M15', 'Eksekusi sesuai trading plan tanpa geser SL.', date('now')),
  ('jrn_2', 'EURUSD', 'sell', 'new_york', 1.0610, 1.0630, 1.0630, 1.0570, -1.0, -100.0, 'loss', 'fomo', 'Entry terburu-buru sebelum rilis news USD', 'Pelajaran: tunggu candle close M15 setelah rilis berita.', date('now'));

