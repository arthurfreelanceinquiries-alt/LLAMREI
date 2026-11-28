import type { MemoryEntry, MemoryIndexStatus } from '../../shared/memory.ts';
import { redactAiText } from '../ai/agent-context.ts';
import { getDb } from '../db/connection.ts';
import { HttpBadRequestError } from '../lib/http.ts';
import { fetchLiveOllamaModels, getAiSettingsSnapshot, ollamaNativeEndpoint } from '../services/ai-provider.service.ts';
import { memoryEntriesToIndex } from './store.ts';

const defaultModel = 'nomic-embed-text:latest';
const INDEX_BATCH = 12;
const dimensionLimit = 4096;

interface IndexOptions {
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

function config(): { enabled: boolean; model: string } {
  const rows = getDb().prepare(`SELECT key, value_json FROM app_settings WHERE key IN ('memory_embeddings_enabled','memory_embedding_model')`)
    .all() as Array<{ key: string; value_json: string }>;
  let enabled = false;
  let model = defaultModel;
  for (const row of rows) {
    try {
      const value: unknown = JSON.parse(row.value_json);
      if (row.key === 'memory_embeddings_enabled') enabled = value === true;
      if (row.key === 'memory_embedding_model' && typeof value === 'string' && validModel(value)) model = value;
    } catch {
      // Retain safe defaults for malformed legacy preferences.
    }
  }
  return { enabled, model };
}

function validModel(model: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/.test(model);
}

export function memoryIndexStatus(): MemoryIndexStatus {
  const { enabled, model } = config();
  const now = new Date().toISOString();
  const counts = getDb().prepare(`
    SELECT count(*) AS total, count(e.entry_id) AS indexed FROM memory_entries m
    LEFT JOIN memory_embeddings e ON e.entry_id = m.id AND e.revision = m.revision AND e.model = ?
    WHERE m.expires_at IS NULL OR m.expires_at > ?
  `).get(model, now) as { total: number; indexed: number };
  return { enabled, model, ...counts };
}

export function configureMemoryIndex(raw: unknown): MemoryIndexStatus {
  const input = raw as Partial<MemoryIndexStatus> | null;
  if (typeof input?.enabled !== 'boolean' || typeof input?.model !== 'string' || !validModel(input.model.trim())) {
    throw new HttpBadRequestError(400, 'Aktivasi dan nama model embedding harus valid.');
  }
  const db = getDb();
  const prior = config();
  const model = input.model.trim();
  db.exec('SAVEPOINT memory_index_config');
  try {
    const set = db.prepare(`INSERT INTO app_settings (key, value_json) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json`);
    set.run('memory_embeddings_enabled', JSON.stringify(input.enabled));
    set.run('memory_embedding_model', JSON.stringify(model));
    if (!input.enabled || model !== prior.model) db.exec('DELETE FROM memory_embeddings');
    db.exec('RELEASE memory_index_config');
  } catch (error) {
    db.exec('ROLLBACK TO memory_index_config; RELEASE memory_index_config');
    throw error;
  }
  return memoryIndexStatus();
}

function normalize(vector: unknown): Float32Array | null {
  if (!Array.isArray(vector) || vector.length < 2 || vector.length > dimensionLimit ||
      vector.some((value) => typeof value !== 'number' || !Number.isFinite(value))) return null;
  const length = Math.hypot(...vector);
  if (!Number.isFinite(length) || length === 0) return null;
  return Float32Array.from(vector, (value) => value / length);
}

async function embed(model: string, inputs: string[], options: IndexOptions): Promise<Float32Array[] | null> {
  const active = config();
  if (!active.enabled || active.model !== model || !inputs.length) return null;
  const baseUrl = getAiSettingsSnapshot().ollamaBaseUrl;
  const endpoint = ollamaNativeEndpoint(baseUrl, 'embed');
  if (!endpoint) return null;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const timeout = AbortSignal.timeout(2500);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  try {
    const installed = await fetchLiveOllamaModels(baseUrl, false, fetchImpl, signal);
    const current = config();
    if (!installed.online || !installed.models.some(({ id }) => id === model || id === `${model}:latest`) ||
        !current.enabled || current.model !== model) return null;
    signal.throwIfAborted();
    const response = await fetchImpl(endpoint, {
      method: 'POST', redirect: 'error', signal,
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, input: inputs, truncate: true }),
    });
    if (!response.ok) return null;
    const data = await response.json() as { embeddings?: unknown[] };
    signal.throwIfAborted();
    if (!Array.isArray(data?.embeddings) || data.embeddings.length !== inputs.length) return null;
    const vectors = data.embeddings.map(normalize);
    const dimension = vectors[0]?.length;
    return vectors.every((vector) => vector && vector.length === dimension) ? vectors as Float32Array[] : null;
  } catch {
    options.signal?.throwIfAborted();
    return null;
  }
}

function encode(vector: Float32Array): Uint8Array {
  const bytes = new Uint8Array(vector.length * 4);
  const view = new DataView(bytes.buffer);
  vector.forEach((value, index) => view.setFloat32(index * 4, value, true));
  return bytes;
}

export function similarity(vector: Float32Array, bytes: Uint8Array): number {
  if (bytes.byteLength !== vector.length * 4) return -1;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return vector.reduce((sum, value, index) => sum + value * view.getFloat32(index * 4, true), 0);
}

export async function memoryQueryVector(query: string, model: string, options: IndexOptions): Promise<Float32Array | null> {
  return (await embed(model, [redactAiText(query).slice(0, 1200)], options))?.[0] ?? null;
}

export async function indexMemoryEntries(entries: MemoryEntry[], options: IndexOptions = {}): Promise<number> {
  const { enabled, model } = config();
  if (!enabled || !entries.length) return 0;
  const inputs = entries.map((item) => redactAiText(`${item.title}\n${item.tags.join(' ')}\n${item.body}`).slice(0, 6000));
  const vectors = await embed(model, inputs, options);
  const current = config();
  if (!vectors || !current.enabled || current.model !== model) return 0;
  const insert = getDb().prepare(`
    INSERT INTO memory_embeddings (entry_id, revision, model, vector)
    SELECT id, revision, ?, ? FROM memory_entries WHERE id = ? AND revision = ? AND (expires_at IS NULL OR expires_at > ?)
    ON CONFLICT(entry_id) DO UPDATE SET revision = excluded.revision, model = excluded.model, vector = excluded.vector
  `);
  const now = new Date().toISOString();
  return entries.reduce((sum, item, index) => sum + Number(insert.run(model, encode(vectors[index]), item.id, item.revision, now).changes), 0);
}

export async function indexPendingMemory(options: IndexOptions = {}): Promise<{ built: number; status: MemoryIndexStatus }> {
  const { model, enabled } = config();
  const built = enabled ? await indexMemoryEntries(memoryEntriesToIndex(model, INDEX_BATCH), options) : 0;
  return { built, status: memoryIndexStatus() };
}
