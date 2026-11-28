import type { ProviderOutcome } from '../../shared/ai-protocol.ts';
import type { ModelUsage, UnifiedMessage, UnifiedToolCall, UnifiedToolDef } from './provider-types.ts';

export type CompatibleProvider = 'opencode_zen' | 'openrouter' | 'ollama';

export class ModelTransportError extends Error {
  readonly outcome: Exclude<ProviderOutcome, 'success' | 'cancelled'>;
  readonly retryAfterMs?: number;

  constructor(outcome: ModelTransportError['outcome'], retryAfterMs?: number) {
    super(outcome);
    this.outcome = outcome;
    this.retryAfterMs = retryAfterMs;
  }
}

const MAX_RESPONSE_BYTES = 512 * 1024;
const MAX_TOOL_CALLS = 8;
const MAX_TOOL_ARGUMENT_CHARS = 16_384;

function invalidResponse(): never {
  throw new ModelTransportError('invalid_response');
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return invalidResponse();
  }
}

function tokenCount(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function readUsage(value: unknown, provider: CompatibleProvider): ModelUsage {
  const usage = record(value);
  const usageCost = usage?.cost;
  const actualCostUsd = typeof usageCost === 'string' && /^\d+(?:\.\d+)?$/.test(usageCost) ? Number(usageCost) : usageCost;
  if (provider !== 'ollama' && usageCost != null &&
      !(typeof actualCostUsd === 'number' && Number.isFinite(actualCostUsd) && actualCostUsd >= 0)) return invalidResponse();
  return {
    promptTokens: tokenCount(usage?.prompt_tokens),
    completionTokens: tokenCount(usage?.completion_tokens),
    actualCostUsd: provider !== 'ollama' && typeof actualCostUsd === 'number' && Number.isFinite(actualCostUsd) && actualCostUsd >= 0
      ? actualCostUsd : undefined,
  };
}

function retryAfterMs(header: string | null): number | undefined {
  if (!header) return;
  const milliseconds = /^\d+(?:\.\d+)?$/.test(header) ? Number(header) * 1000 : Date.parse(header) - Date.now();
  return Number.isFinite(milliseconds) && milliseconds > 0 ? milliseconds : undefined;
}

function encodeMessage(message: UnifiedMessage) {
  if (message.role === 'tool') return { role: 'tool', tool_call_id: message.toolCallId, content: message.content };
  if (message.role !== 'assistant' || !message.toolCalls?.length) return { role: message.role, content: message.content };
  return {
    role: 'assistant',
    content: message.content || null,
    tool_calls: message.toolCalls.map(({ id, name, args }) => ({
      id, type: 'function', function: { name, arguments: JSON.stringify(args) },
    })),
  };
}

interface RawToolCall {
  id: string;
  name: string;
  args: string;
}

function parseToolCalls(calls: RawToolCall[]): UnifiedToolCall[] {
  if (calls.length > MAX_TOOL_CALLS) return invalidResponse();
  const ids = new Set<string>();
  return calls.map(({ id, name, args }) => {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(name) || !/^[A-Za-z0-9_.:-]{0,128}$/.test(id) || args.length > MAX_TOOL_ARGUMENT_CHARS) {
      return invalidResponse();
    }
    const parsed = record(parseJson(args));
    if (!parsed || (id && ids.has(id))) return invalidResponse();
    if (id) ids.add(id);
    return { id: id || `call_${crypto.randomUUID()}`, name, args: parsed };
  });
}

async function* decodeBody(response: Response, signal: AbortSignal): AsyncGenerator<string> {
  if (!response.body) return invalidResponse();
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0;
  try {
    for (;;) {
      signal.throwIfAborted();
      const chunk = await reader.read();
      signal.throwIfAborted();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) return invalidResponse();
      yield decoder.decode(chunk.value, { stream: true });
    }
    const tail = decoder.decode();
    if (tail) yield tail;
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

async function* sseData(response: Response, signal: AbortSignal): AsyncGenerator<string> {
  let pending = '';
  let data: string[] = [];
  for await (const chunk of decodeBody(response, signal)) {
    pending += chunk;
    let newline = pending.indexOf('\n');
    while (newline >= 0) {
      const line = pending.slice(0, newline).replace(/\r$/, '');
      pending = pending.slice(newline + 1);
      newline = pending.indexOf('\n');
      if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
      if (!line && data.length) {
        yield data.join('\n');
        data = [];
      }
    }
  }
  if (data.length || pending.trim()) invalidResponse();
}

function assertFinish(reason: unknown): void {
  if (reason !== 'stop' && reason !== 'tool_calls') invalidResponse();
}

function stringPart(value: unknown): string {
  if (value == null) return '';
  return typeof value === 'string' ? value : invalidResponse();
}

function extendToolCalls(calls: Map<number, RawToolCall>, value: unknown): void {
  if (value == null) return;
  if (!Array.isArray(value) || value.length > MAX_TOOL_CALLS) return invalidResponse();
  for (const item of value) {
    const fragment = record(item);
    const index = fragment?.index;
    if (!fragment || typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= MAX_TOOL_CALLS) return invalidResponse();
    const current = calls.get(index) ?? { id: '', name: '', args: '' };
    const fn = record(fragment.function);
    const id = stringPart(fragment.id);
    if (id && current.id && id !== current.id) return invalidResponse();
    current.id ||= id;
    current.name += stringPart(fn?.name);
    current.args += stringPart(fn?.arguments);
    if (current.args.length > MAX_TOOL_ARGUMENT_CHARS) return invalidResponse();
    calls.set(index, current);
  }
}

async function readCompletionStream(
  response: Response,
  signal: AbortSignal,
  provider: CompatibleProvider,
  onDelta: NonNullable<CompatibleCall['onDelta']>,
  onUsage: (value: unknown) => void,
): Promise<{ text: string; toolCalls: UnifiedToolCall[] }> {
  let text = '';
  let finish: 'stop' | 'tool_calls' | undefined;
  let done = false;
  const calls = new Map<number, RawToolCall>();
  for await (const data of sseData(response, signal)) {
    signal.throwIfAborted();
    if (data === '[DONE]') {
      done = true;
      break;
    }
    const frame = record(parseJson(data));
    if (!frame || frame.error) throw new ModelTransportError('provider_error');
    if (frame.usage) onUsage(frame.usage);
    if (!Array.isArray(frame.choices)) continue;
    const choice = record(frame.choices[0]);
    if (!choice) continue;
    if (finish) return invalidResponse();
    const delta = record(choice.delta);
    const part = stringPart(delta?.content);
    if (part) {
      text += part;
      onDelta(part);
    }
    extendToolCalls(calls, delta?.tool_calls);
    if (choice.finish_reason != null) {
      assertFinish(choice.finish_reason);
      finish = choice.finish_reason as 'stop' | 'tool_calls';
    }
  }
  if (!finish || (!done && provider !== 'ollama') || (finish === 'tool_calls' && calls.size === 0)) return invalidResponse();
  return { text: text.trim(), toolCalls: parseToolCalls([...calls.entries()].sort(([a], [b]) => a - b).map(([, call]) => call)) };
}

async function readJsonCompletion(response: Response, signal: AbortSignal, onUsage: (value: unknown) => void) {
  let text = '';
  for await (const chunk of decodeBody(response, signal)) text += chunk;
  const frame = record(parseJson(text));
  if (!frame || frame.error) throw new ModelTransportError('provider_error');
  if (frame.usage) onUsage(frame.usage);
  const choice = Array.isArray(frame.choices) ? record(frame.choices[0]) : undefined;
  if (choice?.finish_reason != null) assertFinish(choice.finish_reason);
  const message = record(choice?.message);
  const calls = Array.isArray(message?.tool_calls) ? message.tool_calls : [];
  return {
    text: stringPart(message?.content).trim(),
    toolCalls: parseToolCalls(calls.map((call: unknown) => {
      const tc = record(call);
      const fn = record(tc?.function);
      return { id: stringPart(tc?.id), name: stringPart(fn?.name), args: stringPart(fn?.arguments) };
    })),
  };
}

interface CompatibleCall {
  provider: CompatibleProvider;
  baseUrl: string;
  apiKey?: string;
  model: string;
  messages: UnifiedMessage[];
  tools: UnifiedToolDef[];
  maxTokens: number;
  fetchImpl: typeof fetch;
  signal: AbortSignal;
  onDelta?: (delta: string) => void;
  onUsage: (usage: ModelUsage) => void;
}

export async function callOpenAiCompatibleProvider(params: CompatibleCall) {
  const payload: Record<string, unknown> = {
    model: params.model,
    messages: params.messages.map(encodeMessage),
    temperature: 0.3,
    max_tokens: params.maxTokens,
    ...(params.onDelta && { stream: true, stream_options: { include_usage: true } }),
  };
  if (params.provider === 'openrouter') {
    payload.provider = {
      allow_fallbacks: false,
      max_price: { prompt: '0', completion: '0', request: '0', image: '0', audio: '0' },
      ...(params.tools.length && { require_parameters: true }),
    };
  }
  if (params.tools.length) {
    payload.tools = params.tools.map(({ name, description, parameters }) => ({
      type: 'function', function: { name, description: description.slice(0, 500), parameters },
    }));
    payload.tool_choice = 'auto';
  }

  const response = await params.fetchImpl(`${params.baseUrl}/chat/completions`, {
    method: 'POST',
    redirect: 'error',
    headers: {
      'Content-Type': 'application/json',
      ...(params.apiKey && { Authorization: `Bearer ${params.apiKey}` }),
      ...(params.provider === 'openrouter' && { 'HTTP-Referer': 'http://localhost:5173', 'X-Title': 'Llamrei Jarvis OS' }),
    },
    body: JSON.stringify(payload),
    signal: params.signal,
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new ModelTransportError(response.status === 429 ? 'rate_limited' : 'provider_error', retryAfterMs(response.headers.get('retry-after')));
  }

  const onUsage = (value: unknown) => params.onUsage(readUsage(value, params.provider));
  return params.onDelta && response.headers.get('content-type')?.toLowerCase().includes('text/event-stream')
    ? readCompletionStream(response, params.signal, params.provider, params.onDelta, onUsage)
    : readJsonCompletion(response, params.signal, onUsage);
}
