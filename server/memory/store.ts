import type { SQLInputValue } from 'node:sqlite';
import { MAX_MEMORY_BODY, MAX_MEMORY_TITLE, MEMORY_KINDS, type MemoryEntry, type MemoryKind, type MemoryReference } from '../../shared/memory.ts';
import { getDb } from '../db/connection.ts';
import { HttpBadRequestError } from '../lib/http.ts';

interface MemoryRow {
  id: string;
  kind: MemoryKind;
  title: string;
  body: string;
  tags_json: string;
  usable_by_assistant: number;
  expires_at: string | null;
  updated_at: string;
  revision: number;
  source_document_id: string | null;
  source_title: string | null;
  source_captured_at: string | null;
}

export interface MemoryFilter {
  kind?: MemoryKind;
  assistantOnly?: boolean;
}

export function isMemoryKind(value: unknown): value is MemoryKind {
  return MEMORY_KINDS.includes(value as MemoryKind);
}

function entry(row: MemoryRow): MemoryEntry {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    body: row.body,
    tags: JSON.parse(row.tags_json) as string[],
    usableByAssistant: row.usable_by_assistant === 1,
    expiresAt: row.expires_at,
    updatedAt: row.updated_at,
    revision: row.revision,
    source: row.source_document_id && row.source_title && row.source_captured_at
      ? { kind: 'document', id: row.source_document_id, title: row.source_title, capturedAt: row.source_captured_at }
      : { kind: 'manual' },
  };
}

function filters({ kind, assistantOnly }: MemoryFilter): { clause: string; args: SQLInputValue[] } {
  const clauses = ['(m.expires_at IS NULL OR m.expires_at > ?)'];
  const args: SQLInputValue[] = [new Date().toISOString()];
  if (kind) {
    clauses.push('m.kind = ?');
    args.push(kind);
  }
  if (assistantOnly) clauses.push('m.usable_by_assistant = 1');
  return { clause: clauses.join(' AND '), args };
}

export function getMemory(id: string): MemoryEntry | null {
  const query = filters({});
  const row = getDb().prepare(`SELECT m.* FROM memory_entries AS m WHERE m.id = ? AND ${query.clause}`)
    .get(id, ...query.args) as unknown as MemoryRow | undefined;
  return row ? entry(row) : null;
}

export function purgeExpiredMemory(now = new Date()): number {
  return Number(getDb().prepare('DELETE FROM memory_entries WHERE expires_at <= ?').run(now.toISOString()).changes);
}

function trimText(value: unknown, limit: number, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > limit) {
    throw new HttpBadRequestError(400, `${label} harus berisi 1–${limit} karakter.`);
  }
  return value.trim();
}

function inputRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpBadRequestError(400, 'Data memori tidak valid.');
  return value as Record<string, unknown>;
}

function inputExpiry(value: unknown): string | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !(Date.parse(value) > Date.now())) {
    throw new HttpBadRequestError(400, 'Kedaluwarsa harus berada di masa depan.');
  }
  return new Date(value).toISOString();
}

function editableFields(input: Record<string, unknown>) {
  if (!isMemoryKind(input.kind)) throw new HttpBadRequestError(400, 'Jenis memori tidak valid.');
  const rawTags = input.tags ?? [];
  if (!Array.isArray(rawTags) || rawTags.length > 10 || rawTags.some((tag) => typeof tag !== 'string' || tag.length > 32)) {
    throw new HttpBadRequestError(400, 'Gunakan hingga 10 tag dengan maksimal 32 karakter per tag.');
  }
  if (input.usableByAssistant !== undefined && typeof input.usableByAssistant !== 'boolean') {
    throw new HttpBadRequestError(400, 'Pilihan akses JARVIS tidak valid.');
  }
  const tags = [...new Set(rawTags.map((tag: string) => tag.trim()).filter(Boolean))];
  return { kind: input.kind, tags, usable: input.usableByAssistant === true ? 1 : 0, expiresAt: inputExpiry(input.expiresAt) };
}

export function createMemory(raw: unknown): MemoryEntry {
  const input = inputRecord(raw);
  const { kind, tags, expiresAt, usable } = editableFields(input);
  let source: { id: string; title: string; content_md: string } | undefined;
  if (input.sourceDocumentId !== undefined) {
    const id = trimText(input.sourceDocumentId, 128, 'Dokumen sumber');
    source = getDb().prepare('SELECT id, title, content_md FROM workspace_docs WHERE id = ?').get(id) as typeof source;
    if (!source) throw new HttpBadRequestError(404, 'Dokumen sumber tidak ditemukan.');
  }
  const title = trimText(source?.title ?? input.title, MAX_MEMORY_TITLE, 'Judul');
  const body = trimText(source?.content_md ?? input.body, MAX_MEMORY_BODY, 'Isi catatan');
  const id = `mem_${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  getDb().prepare(`
    INSERT INTO memory_entries (id, kind, title, body, tags_json, usable_by_assistant, expires_at, updated_at,
      source_document_id, source_title, source_captured_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, kind, title, body, JSON.stringify(tags), usable, expiresAt, now,
    source?.id ?? null, source?.title ?? null, source ? now : null);
  return getMemory(id)!;
}

function requireRevision(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new HttpBadRequestError(400, 'Versi memori tidak valid.');
  }
  return value;
}

function memoryChanged(id: string): never {
  if (!getMemory(id)) throw new HttpBadRequestError(404, 'Memori tidak ditemukan atau sudah kedaluwarsa.');
  throw new HttpBadRequestError(409, 'Memori sudah berubah. Muat ulang untuk melihat versi terbaru.');
}

export function updateMemory(id: string, raw: unknown): MemoryEntry {
  const input = inputRecord(raw);
  const revision = requireRevision(input.revision);
  const { kind, tags, expiresAt, usable } = editableFields(input);
  const title = trimText(input.title, MAX_MEMORY_TITLE, 'Judul');
  const body = trimText(input.body, MAX_MEMORY_BODY, 'Isi catatan');
  const now = new Date().toISOString();
  const changed = getDb().prepare(`
    UPDATE memory_entries SET kind = ?, title = ?, body = ?, tags_json = ?, usable_by_assistant = ?,
      expires_at = ?, updated_at = ?, revision = revision + 1
    WHERE id = ? AND revision = ? AND (expires_at IS NULL OR expires_at > ?)
  `).run(kind, title, body, JSON.stringify(tags), usable, expiresAt, now, id, revision, now);
  if (!changed.changes) return memoryChanged(id);
  return getMemory(id)!;
}

export function deleteMemory(id: string, revision: unknown): void {
  const changed = getDb().prepare('DELETE FROM memory_entries WHERE id = ? AND revision = ?').run(id, requireRevision(revision));
  if (!changed.changes) memoryChanged(id);
}

export function currentAssistantMemory(ref: MemoryReference): boolean {
  return Boolean(getDb().prepare(`
    SELECT 1 FROM memory_entries WHERE id = ? AND revision = ? AND usable_by_assistant = 1
    AND (expires_at IS NULL OR expires_at > ?)
  `).get(ref.id, ref.revision, new Date().toISOString()));
}

export function listMemoryEntries(filter: MemoryFilter, limit: number): MemoryEntry[] {
  const query = filters(filter);
  const rows = getDb().prepare(`SELECT m.* FROM memory_entries AS m WHERE ${query.clause} ORDER BY m.updated_at DESC, m.id LIMIT ?`)
    .all(...query.args, limit) as unknown as MemoryRow[];
  return rows.map(entry);
}

const fillerWords = new Set(['apa', 'apakah', 'aku', 'saya', 'ini', 'itu', 'di', 'yang', 'dan', 'tolong', 'bisa', 'bagaimana', 'tentang', 'saat', 'untuk', 'the', 'my', 'about', 'is']);

export function keywordMemory(text: string, filter: MemoryFilter, limit: number): MemoryEntry[] {
  const tokens = [...new Set(text.toLowerCase().match(/[\p{L}\p{N}]{2,32}/gu) ?? [])].filter((word) => !fillerWords.has(word)).slice(0, 12);
  if (!tokens.length) return [];
  const expression = tokens.map((word) => `"${word}"*`).join(' OR ');
  const query = filters(filter);
  const rows = getDb().prepare(`
    SELECT m.* FROM memory_search JOIN memory_entries AS m ON m.rowid = memory_search.rowid
    WHERE memory_search MATCH ? AND ${query.clause}
    ORDER BY bm25(memory_search, 3, 1, 2.0), m.updated_at DESC LIMIT ?
  `).all(expression, ...query.args, limit) as unknown as MemoryRow[];
  return rows.map(entry);
}

export function memoryVectorCandidates(model: string, filter: MemoryFilter, limit: number): Array<{ item: MemoryEntry; vector: Uint8Array }> {
  const query = filters(filter);
  const rows = getDb().prepare(`
    SELECT m.*, e.vector FROM memory_embeddings AS e JOIN memory_entries AS m ON m.id = e.entry_id AND m.revision = e.revision
    WHERE e.model = ? AND ${query.clause} ORDER BY m.updated_at DESC LIMIT ?
  `).all(model, ...query.args, limit) as unknown as Array<MemoryRow & { vector: Uint8Array }>;
  return rows.map((row) => ({ item: entry(row), vector: row.vector }));
}

export function memoryEntriesToIndex(model: string, limit: number): MemoryEntry[] {
  const query = filters({});
  const rows = getDb().prepare(`
    SELECT m.* FROM memory_entries AS m WHERE ${query.clause} AND NOT EXISTS (
      SELECT 1 FROM memory_embeddings e WHERE e.entry_id = m.id AND e.revision = m.revision AND e.model = ?
    ) ORDER BY m.updated_at DESC, m.id LIMIT ?
  `).all(...query.args, model, limit) as unknown as MemoryRow[];
  return rows.map(entry);
}
