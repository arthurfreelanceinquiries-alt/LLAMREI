import type { AiProviderId, ModelProvider, ProviderAttempt } from '../../shared/ai-protocol.ts';

export interface UnifiedToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface UnifiedToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface UnifiedMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCallId?: string;
  toolName?: string;
  toolCalls?: UnifiedToolCall[];
}

export interface ModelUsage {
  promptTokens: number;
  completionTokens: number;
  actualCostUsd?: number;
}

export interface UnifiedModelResult extends ModelUsage {
  text: string;
  toolCalls: UnifiedToolCall[];
  providerUsed: ModelProvider;
  modelUsed: string;
  isFreeTier: boolean;
  attempts: ProviderAttempt[];
}

export interface AiInvocationOptions {
  providerOverride?: AiProviderId;
  modelOverride?: string;
  containsPrivateContext?: boolean;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  onStart?: (provider: ModelProvider, model: string) => void;
  onDelta?: (delta: string) => void;
  onAttempt?: (attempt: ProviderAttempt) => void;
}
