export const AI_PROVIDER_IDS = [
  'auto', 'opencode_zen', 'opencode_cli', 'openrouter', 'groq', 'ollama', 'gemini', 'local',
] as const;

export type AiProviderId = typeof AI_PROVIDER_IDS[number];
export type ModelProvider = Exclude<AiProviderId, 'auto' | 'local'>;

export type ProviderOutcome = 'success' | 'cancelled' | 'rate_limited' | 'timeout' |
  'transport_error' | 'provider_error' | 'invalid_response' | 'empty_response' | 'unexpected_cost';

export type RouteDecision = ProviderOutcome | 'privacy' | 'credentials' | 'unverified_price' |
  'unsupported_tool' | 'context_limit' | 'circuit_open';

export interface ProviderAttempt {
  provider: ModelProvider;
  model: string;
  ok: boolean;
  code: RouteDecision;
  reason?: string;
}

export interface ModelLatency {
  provider: ModelProvider;
  model: string;
  attempts: number;
  successes: number;
  streamedSamples: number;
  firstTokenP50Ms: number | null;
  firstTokenP95Ms: number | null;
}

export const MAX_AGENT_PROMPT_CHARS = 8_000;

export interface AgentSource {
  id: string;
  label: string;
  memoryId?: string;
}

export type AgentProgress =
  | { type: 'state'; stage: 'routing' }
  | { type: 'state'; stage: 'answering'; provider: ModelProvider; model: string }
  | { type: 'state'; stage: 'tools'; label: string }
  | { type: 'delta'; text: string };

export type AgentFrame<T> = AgentProgress | { type: 'complete'; result: T } | { type: 'error'; message: string };
