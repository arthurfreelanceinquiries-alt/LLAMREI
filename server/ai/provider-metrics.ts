import type { ModelLatency, ModelProvider, ProviderOutcome } from '../../shared/ai-protocol.ts';
import { getDb } from '../db/connection.ts';

const MAX_SAMPLES = 2048;
const WINDOW = '-7 days';

export function recordProviderAttempt(
  provider: ModelProvider, model: string, outcome: ProviderOutcome, durationMs: number, firstTokenMs: number | null,
): void {
  const db = getDb();
  const { lastInsertRowid } = db.prepare(`
    INSERT INTO ai_provider_attempts (provider, model, outcome, duration_ms, first_token_ms) VALUES (?, ?, ?, ?, ?)
  `).run(provider, model, outcome, durationMs, firstTokenMs);
  db.prepare(`DELETE FROM ai_provider_attempts WHERE id <= ? OR created_at < datetime('now', ?)`).run(
    Number(lastInsertRowid) - MAX_SAMPLES, WINDOW,
  );
}

function percentile(sorted: number[], fraction: number): number | null {
  return sorted[Math.ceil(sorted.length * fraction) - 1] ?? null;
}

export function getModelLatency(): ModelLatency[] {
  const rows = getDb().prepare(`
    SELECT provider, model, outcome, first_token_ms FROM ai_provider_attempts
    WHERE created_at >= datetime('now', ?) ORDER BY id DESC LIMIT ?
  `).all(WINDOW, MAX_SAMPLES) as Array<{
    provider: ModelProvider; model: string; outcome: ProviderOutcome; first_token_ms: number | null;
  }>;

  const groups = new Map<string, { provider: ModelProvider; model: string; attempts: number; successes: number; tokens: number[] }>();
  for (const row of rows) {
    const key = JSON.stringify([row.provider, row.model]);
    const group = groups.get(key) ?? { provider: row.provider, model: row.model, attempts: 0, successes: 0, tokens: [] };
    group.attempts++;
    if (row.outcome === 'success') {
      group.successes++;
      if (row.first_token_ms !== null) group.tokens.push(row.first_token_ms);
    }
    groups.set(key, group);
  }

  return [...groups.values()].map(({ tokens, ...group }) => {
    tokens.sort((a, b) => a - b);
    return {
      ...group,
      streamedSamples: tokens.length,
      firstTokenP50Ms: percentile(tokens, 0.50),
      firstTokenP95Ms: percentile(tokens, 0.95),
    };
  });
}
