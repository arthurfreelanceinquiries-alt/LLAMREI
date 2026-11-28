import type { MemoryEntry, MemorySearchResult } from '../../shared/memory.ts';
import { memoryIndexStatus, memoryQueryVector, similarity } from './embeddings.ts';
import { getMemory, keywordMemory, listMemoryEntries, memoryVectorCandidates, type MemoryFilter } from './store.ts';

interface SearchOptions extends MemoryFilter {
  limit: number;
  keywordOnly?: boolean;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

function mergeRanks(lexical: MemoryEntry[], semantic: MemoryEntry[]): MemoryEntry[] {
  const ranks = new Map<string, { item: MemoryEntry; score: number }>();
  lexical.forEach((item, index) => ranks.set(item.id, { item, score: 1.25 / (10 + index) }));
  semantic.forEach((item, index) => {
    const rank = ranks.get(item.id) ?? { item, score: 0 };
    rank.score += 1 / (10 + index);
    ranks.set(item.id, rank);
  });
  return [...ranks.values()].sort((a, b) => b.score - a.score).map(({ item }) => item);
}

async function rankedMemory(query: string, options: SearchOptions): Promise<{ items: MemoryEntry[]; mode: MemorySearchResult['mode'] }> {
  const input = query.trim();
  if (!input) return { items: listMemoryEntries(options, options.limit), mode: 'keyword' };
  const lexical = () => keywordMemory(input, options, options.limit);
  const index = options.keywordOnly ? null : memoryIndexStatus();
  if (!index?.enabled || !index.indexed) return { items: lexical(), mode: 'keyword' };
  const candidates = memoryVectorCandidates(index.model, options, 240);
  if (!candidates.length) return { items: lexical(), mode: 'keyword' };
  const queryVector = await memoryQueryVector(input, index.model, options);
  options.signal?.throwIfAborted();
  if (!queryVector) return { items: lexical(), mode: 'keyword' };

  const semantic = candidates.flatMap(({ item, vector }) => {
    const score = similarity(queryVector, vector);
    if (!Number.isFinite(score) || score < 0.38) return [];
    const fresh = getMemory(item.id);
    return fresh?.revision === item.revision ? [{ item: fresh, score }] : [];
  }).sort((a, b) => b.score - a.score).slice(0, options.limit).map(({ item }) => item);
  return { items: mergeRanks(lexical(), semantic), mode: 'hybrid' };
}

export async function searchMemory(query: string, options: SearchOptions): Promise<MemorySearchResult> {
  const result = await rankedMemory(query, { ...options, limit: options.limit + 1 });
  return {
    items: result.items.slice(0, options.limit).map(({ body, ...item }) => ({ ...item, excerpt: body.slice(0, 180) })),
    more: result.items.length > options.limit,
    mode: result.mode,
  };
}

export async function retrieveAssistantMemory(prompt: string, options: Pick<SearchOptions, 'signal' | 'fetchImpl'>): Promise<MemoryEntry[]> {
  const result = await rankedMemory(prompt, { ...options, assistantOnly: true, limit: 4 });
  return result.items.slice(0, 4);
}
