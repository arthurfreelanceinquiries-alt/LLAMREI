export const MEMORY_KINDS = ['working', 'episodic', 'semantic', 'preference', 'procedural', 'prospective'] as const;
export const MAX_MEMORY_TITLE = 160;
export const MAX_MEMORY_BODY = 32_000;
export type MemoryKind = typeof MEMORY_KINDS[number];

export interface MemoryReference {
  id: string;
  revision: number;
}

export interface MemoryEntry extends MemoryReference {
  kind: MemoryKind;
  title: string;
  body: string;
  tags: string[];
  usableByAssistant: boolean;
  expiresAt: string | null;
  updatedAt: string;
  source: { kind: 'manual' } | { kind: 'document'; id: string; title: string; capturedAt: string };
}

export interface MemoryMatch extends Omit<MemoryEntry, 'body'> {
  excerpt: string;
}

export interface MemorySearchResult {
  items: MemoryMatch[];
  more: boolean;
  mode: 'keyword' | 'hybrid';
}

export interface MemoryIndexStatus {
  enabled: boolean;
  model: string;
  indexed: number;
  total: number;
}
