import type { MemoryKind, MemorySearchResult } from '../../shared/memory';
import { apiRequest } from './api-client';

export const memoryKindLabels: Record<MemoryKind, string> = {
  working: 'Catatan aktif', episodic: 'Pengalaman', semantic: 'Pengetahuan',
  preference: 'Preferensi', procedural: 'Prosedur', prospective: 'Rencana',
};

export function findMemory(query: string, { kind, limit, keywordOnly, signal }: {
  kind?: MemoryKind; limit: number; keywordOnly?: boolean; signal?: AbortSignal;
}) {
  const params = new URLSearchParams({ q: query.trim().slice(0, 300), limit: String(limit) });
  if (kind) params.set('kind', kind);
  if (keywordOnly) params.set('mode', 'keyword');
  return apiRequest<MemorySearchResult>(`/api/memory?${params}`, { signal });
}

export function memoryError(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  try {
    const data: unknown = JSON.parse(error.message);
    return data && typeof data === 'object' && 'error' in data && typeof data.error === 'string' && data.error.length < 240
      ? data.error : fallback;
  } catch {
    return fallback;
  }
}
