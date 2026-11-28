import type { MemoryEntry, MemoryReference } from '../../shared/memory.ts';
import { currentAssistantMemory } from './store.ts';

export interface HistoryRow {
  role: 'user' | 'assistant';
  content: string;
  memory_refs_json: string | null;
}

function readReferences(raw: string): MemoryReference[] | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value) || value.length > 48 || !value.every((ref) =>
      typeof ref?.id === 'string' && Number.isSafeInteger(ref.revision) && ref.revision > 0,
    )) return null;
    return value as MemoryReference[];
  } catch {
    return null;
  }
}

export function memoryAwareHistory(rows: HistoryRow[], recalled: MemoryEntry[], enabled: boolean): { history: HistoryRow[]; references: MemoryReference[] } {
  const references = new Map<string, MemoryReference>(recalled.map(({ id, revision }) => [id, { id, revision }]));
  const history = rows.filter(({ memory_refs_json }) => {
    if (!memory_refs_json) return true;
    if (!enabled) return false;
    const refs = readReferences(memory_refs_json);
    if (!refs || refs.filter(({ id }) => !references.has(id)).length + references.size > 48 || !refs.every(currentAssistantMemory)) return false;
    for (const ref of refs) references.set(ref.id, ref);
    return true;
  });
  return { history: history.reverse(), references: [...references.values()] };
}
