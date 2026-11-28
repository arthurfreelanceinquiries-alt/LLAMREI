import type { AgentFrame, AgentProgress, ModelProvider, ProviderAttempt } from '../../shared/ai-protocol';
import type { AiProviderId, ChatMessageItem } from '../types/llamrei';
import { notifyApiSessionRequired } from './api-client';

export interface AgentRequest {
  prompt: string;
  requestId: string;
  contextAttachment: Record<string, unknown> | null;
  providerOverride: AiProviderId;
  modelOverride?: string;
  useMemory?: boolean;
}

export interface AgentReply {
  userMessage: ChatMessageItem;
  assistantMessage: ChatMessageItem;
  providerUsed: ModelProvider | 'local';
  attempts: ProviderAttempt[];
}

export interface AgentRequestControls {
  signal: AbortSignal;
  onProgress: (progress: AgentProgress) => void;
}

export async function streamAgentReply(request: AgentRequest, { signal, onProgress }: AgentRequestControls): Promise<AgentReply> {
  const url = '/api/agent/prompt/stream';
  const response = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' },
    body: JSON.stringify(request), signal,
  });
  if (!response.ok) {
    notifyApiSessionRequired(url, response.status);
    const error: unknown = await response.json().catch(() => null);
    const message = error && typeof error === 'object' && 'error' in error ? error.error : undefined;
    throw new Error(typeof message === 'string' && message.length <= 240 ? message : `Permintaan gagal (HTTP ${response.status}).`);
  }
  if (!response.body || !response.headers.get('Content-Type')?.includes('application/x-ndjson')) {
    throw new Error('Aliran balasan tidak tersedia.');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let pending = '';
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      pending += decoder.decode(chunk.value, { stream: true });
      if (pending.length > 1024 * 1024) throw new Error('Ukuran balasan melebihi batas.');
      let newline = pending.indexOf('\n');
      while (newline !== -1) {
        signal.throwIfAborted();
        const frame = JSON.parse(pending.slice(0, newline)) as AgentFrame<AgentReply>;
        pending = pending.slice(newline + 1);
        newline = pending.indexOf('\n');
        if (frame.type === 'complete' && frame.result?.assistantMessage?.id && frame.result?.userMessage?.id) return frame.result;
        if (frame.type === 'error') throw new Error(frame.message);
        if ((frame.type === 'delta' && typeof frame.text === 'string') || frame.type === 'state') onProgress(frame);
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  throw new Error('Aliran balasan terputus sebelum selesai.');
}
