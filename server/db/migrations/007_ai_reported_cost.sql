-- Existing rows retain their original estimates and have no reported cost.
ALTER TABLE ai_usage_ledger ADD COLUMN actual_cost_usd REAL CHECK (actual_cost_usd >= 0);
