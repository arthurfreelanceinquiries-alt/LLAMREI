CREATE TABLE ai_provider_attempts (
  id INTEGER PRIMARY KEY,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  outcome TEXT NOT NULL,
  duration_ms INTEGER NOT NULL CHECK (duration_ms >= 0),
  first_token_ms INTEGER CHECK (first_token_ms >= 0 AND first_token_ms <= duration_ms),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
