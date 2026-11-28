import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { AI_PROVIDER_IDS, type AiProviderId, type ModelProvider, type ProviderAttempt, type ProviderOutcome, type RouteDecision } from '../../shared/ai-protocol.ts';
import { callOpenAiCompatibleProvider, ModelTransportError, type CompatibleProvider } from '../ai/openai-compatible.ts';
import { ProviderCircuitBreaker } from '../ai/provider-health.ts';
import { recordProviderAttempt } from '../ai/provider-metrics.ts';
import type { AiInvocationOptions, ModelUsage, UnifiedMessage, UnifiedModelResult, UnifiedToolDef } from '../ai/provider-types.ts';
import { getDb, todayWibIsoDate } from '../db/connection.ts';
import { getSecret } from './secret.service.ts';

const execFileAsync = promisify(execFile);
export type { AiProviderId, ProviderAttempt } from '../../shared/ai-protocol.ts';
export type { AiInvocationOptions, UnifiedMessage, UnifiedModelResult, UnifiedToolCall, UnifiedToolDef } from '../ai/provider-types.ts';

export interface AiModelOption {
  id: string;
  name: string;
  provider: ModelProvider;
  isFree: boolean;
  supportsTools?: boolean;
  contextLimit?: number;
  note?: string;
}

const OPENCODE_MODELS_CATALOG_URL = 'https://opencode.ai/zen/v1/models';
const OPENCODE_OPENAI_BASE = 'https://opencode.ai/zen/v1';
const OPENROUTER_OPENAI_BASE = 'https://openrouter.ai/api/v1';
const MAX_OUTPUT_TOKENS = 2048;
const providerCircuits = new WeakMap<typeof fetch, ProviderCircuitBreaker>();

const FALLBACK_OPENCODE_FREE_MODELS: AiModelOption[] = [
  { id: 'big-pickle', name: 'Big Pickle (Free)', provider: 'opencode_zen', isFree: true, supportsTools: true, contextLimit: 200000, note: 'Reasoning & tool use gratis' },
  { id: 'deepseek-v4.1-flash-free', name: 'DeepSeek V4.1 Flash Free', provider: 'opencode_zen', isFree: true, supportsTools: true, contextLimit: 200000, note: 'Cepat, coding & agentic gratis' },
  { id: 'mimo-v2.6-flash-free', name: 'MiMo-V2.6-Flash Free', provider: 'opencode_zen', isFree: true, supportsTools: true, contextLimit: 200000, note: 'Multimodal & tool calling gratis' },
  { id: 'seaglass-alpha-free', name: 'Seaglass Alpha Free', provider: 'opencode_zen', isFree: true, supportsTools: true, contextLimit: 1048576, note: '1M context reasoning gratis' },
  { id: 'nemotron-3.5-lightning-free', name: 'Nemotron 3.5 Lightning Free', provider: 'opencode_zen', isFree: true, supportsTools: true, note: 'Latensi rendah gratis' },
  { id: 'flint-40b-free', name: 'Flint 40B Free', provider: 'opencode_zen', isFree: true, supportsTools: true, note: 'OpenCode free tier' },
];

const CURATED_OPENROUTER_FREE_MODELS: AiModelOption[] = [
  { id: 'meta-llama/llama-3.3-70b-instruct:free', name: 'Llama 3.3 70B Instruct (:free)', provider: 'openrouter', isFree: true, supportsTools: true, note: '50 req/hari gratis' },
  { id: 'qwen/qwen3-coder:free', name: 'Qwen3 Coder (:free)', provider: 'openrouter', isFree: true, supportsTools: true, note: 'Coding & tool calling gratis' },
  { id: 'google/gemma-3-27b-it:free', name: 'Gemma 3 27B IT (:free)', provider: 'openrouter', isFree: true, supportsTools: false, note: 'Chat & ringkasan gratis' },
  { id: 'mistralai/mistral-small-3.1-24b-instruct:free', name: 'Mistral Small 3.1 24B (:free)', provider: 'openrouter', isFree: true, supportsTools: true, note: 'Tool calling cepat gratis' },
];

const CURATED_GROQ_FREE_MODELS: AiModelOption[] = [
  { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B Versatile (Groq)', provider: 'groq', isFree: true, supportsTools: true, note: 'LPU super cepat gratis' },
  { id: 'qwen/qwen3-32b', name: 'Qwen3 32B (Groq)', provider: 'groq', isFree: true, supportsTools: true, note: 'Reasoning & tools cepat' },
  { id: 'llama-3.1-8b-instant', name: 'Llama 3.1 8B Instant (Groq)', provider: 'groq', isFree: true, supportsTools: true, note: 'Ultra hemat token' },
];

const CURATED_GEMINI_MODELS: AiModelOption[] = [
  { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', provider: 'gemini', isFree: true, supportsTools: true, note: 'Free Tier AI Studio / Pay-as-you-go' },
  { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', provider: 'gemini', isFree: false, supportsTools: true, note: 'Penalaran kompleks (berbayar)' },
];

const CURATED_OLLAMA_MODELS: AiModelOption[] = [
  { id: 'qwen2.5:7b', name: 'Qwen 2.5 7B (Ollama Lokal)', provider: 'ollama', isFree: true, supportsTools: true, note: '100% offline & privat' },
  { id: 'llama3.1:8b', name: 'Llama 3.1 8B (Ollama Lokal)', provider: 'ollama', isFree: true, supportsTools: true, note: '100% offline & privat' },
];

let cachedOpenCodeFreeModels: { fetchedAt: number; models: AiModelOption[] } | null = null;
let cachedOpenRouterFreeModels: { fetchedAt: number; models: AiModelOption[] } | null = null;
let cachedOllamaModels: { fetchedAt: number; baseUrl: string; models: AiModelOption[] } | null = null;

function readSetting<T>(key: string, fallback: T): T {
  try {
    const db = getDb();
    const row = db.prepare('SELECT value_json FROM app_settings WHERE key = ?').get(key) as
      | { value_json: string }
      | undefined;
    if (!row) return fallback;
    return JSON.parse(row.value_json) as T;
  } catch {
    return fallback;
  }
}

function readTextSetting(key: string, fallback: string): string {
  const stored = readSetting<unknown>(key, fallback);
  return typeof stored === 'string' && stored.trim() && stored.length <= 256 ? stored.trim() : fallback;
}

export function getAiSettingsSnapshot(): {
  provider: AiProviderId;
  assistantPersona: 'jarvis' | 'llamrei';
  opencodeModel: string;
  openrouterModel: string;
  groqModel: string;
  ollamaBaseUrl: string;
  ollamaModel: string;
  geminiModel: string;
  paidBillingVerified: boolean;
  allowCloudChatContext: boolean;
  allowCliFallback: boolean;
  fallbackChain: ModelProvider[];
} {
  const rawProvider = readSetting<string>('ai_provider', 'auto');
  const provider: AiProviderId = AI_PROVIDER_IDS.includes(rawProvider as AiProviderId)
    ? (rawProvider as AiProviderId)
    : 'auto';

  const rawPersona = readSetting<string>('assistant_persona', 'jarvis');
  const assistantPersona = rawPersona === 'llamrei' ? 'llamrei' : 'jarvis';

  const defaultChain: ModelProvider[] = [
    'opencode_zen',
    'openrouter',
    'groq',
    'ollama',
    'gemini',
  ];
  const savedChain = readSetting<unknown>('ai_free_fallback_chain', defaultChain);
  const fallbackChain = (Array.isArray(savedChain) ? savedChain : []).filter((p): p is ModelProvider =>
    AI_PROVIDER_IDS.includes(p) && p !== 'auto' && p !== 'local',
  );

  return {
    provider,
    assistantPersona,
    opencodeModel: readTextSetting('opencode_model', 'big-pickle'),
    openrouterModel: readTextSetting('openrouter_model', 'meta-llama/llama-3.3-70b-instruct:free'),
    groqModel: readTextSetting('groq_model', 'llama-3.3-70b-versatile'),
    ollamaBaseUrl: readTextSetting('ollama_base_url', 'http://127.0.0.1:11434/v1').replace(/\/+$/, ''),
    ollamaModel: readTextSetting('ollama_model', 'qwen2.5:7b'),
    geminiModel: readTextSetting('ai_model', 'gemini-2.5-flash'),
    paidBillingVerified: readSetting<boolean>('paid_billing_verified', false) === true,
    allowCloudChatContext: readSetting<boolean>('ai_allow_cloud_chat_context', false) === true,
    allowCliFallback: Boolean(readSetting<boolean>('allow_opencode_cli_fallback', false)),
    fallbackChain: fallbackChain.length > 0 ? [...new Set(fallbackChain)] : defaultChain,
  };
}

export function parseOpenCodeCatalogJson(payload: unknown): AiModelOption[] {
  const data = (payload as { data?: unknown[] })?.data;
  if (!Array.isArray(data)) return [];
  const models: AiModelOption[] = [];
  const duplicateIds = getDuplicateModelIds(data);

  for (const item of data) {
    if (!item || typeof item !== 'object') continue;
    const m = item as {
      id?: string;
      name?: string;
      type?: string;
      description?: string;
      capabilities?: { tools?: { supported?: boolean } };
      limit?: { context?: number };
      cost?: Record<string, Record<string, { price?: number }>>;
    };
    if (typeof m.id !== 'string' || !m.id || m.id.length > 256 || m.type !== 'chat' || duplicateIds.has(m.id)) continue;
    const inPrice = m.cost?.text?.input?.price;
    const outPrice = m.cost?.text?.output?.price;
    if (inPrice !== 0 || outPrice !== 0) continue;
    const hasVerifiedCost = Object.values(m.cost ?? {}).every((category) =>
      category && typeof category === 'object' && !Array.isArray(category) &&
      Object.values(category).every((meter) => meter?.price === 0),
    );
    if (!hasVerifiedCost) continue;

    models.push({
      id: m.id,
      name: typeof m.name === 'string' ? m.name.slice(0, 160) : m.id,
      provider: 'opencode_zen',
      isFree: true,
      supportsTools: typeof m.capabilities?.tools?.supported === 'boolean' ? m.capabilities.tools.supported : undefined,
      contextLimit: positiveInteger(m.limit?.context),
      note: typeof m.description === 'string' ? m.description.slice(0, 72) : 'OpenCode Free Tier',
    });
  }

  return models;
}

export async function fetchLiveOpenCodeFreeModels(
  forceRefresh = false,
  fetchImpl: typeof fetch = globalThis.fetch,
  signal?: AbortSignal,
): Promise<{ models: AiModelOption[]; liveFetched: boolean }> {
  if (!forceRefresh && fetchImpl === globalThis.fetch && cachedOpenCodeFreeModels &&
      Date.now() - cachedOpenCodeFreeModels.fetchedAt < 60_000) {
    return { models: cachedOpenCodeFreeModels.models, liveFetched: true };
  }
  if (forceRefresh && fetchImpl === globalThis.fetch) cachedOpenCodeFreeModels = null;
  try {
    const res = await fetchImpl(OPENCODE_MODELS_CATALOG_URL, {
      redirect: 'error',
      signal: timeoutSignal(4000, signal),
    });
    if (res.ok) {
      const json = await res.json();
      const parsed = parseOpenCodeCatalogJson(json);
      if (parsed.length > 0) {
        if (fetchImpl === globalThis.fetch) cachedOpenCodeFreeModels = { fetchedAt: Date.now(), models: parsed };
        return { models: parsed, liveFetched: true };
      }
    }
  } catch {
    signal?.throwIfAborted();
    // Offline or timeout — return curated list
  }
  return openCodeUnverified();
}

export async function fetchLiveOllamaModels(
  baseUrl: string,
  forceRefresh = false,
  fetchImpl: typeof fetch = globalThis.fetch,
  signal?: AbortSignal,
): Promise<{ models: AiModelOption[]; online: boolean }> {
  const cleanUrl = baseUrl.replace(/\/+$/, '');
  const endpoint = ollamaNativeEndpoint(cleanUrl, 'tags');
  if (!endpoint) return { models: [], online: false };
  if (
    !forceRefresh &&
    fetchImpl === globalThis.fetch &&
    cachedOllamaModels &&
    cachedOllamaModels.baseUrl === cleanUrl &&
    Date.now() - cachedOllamaModels.fetchedAt < 15_000
  ) {
    return { models: cachedOllamaModels.models, online: true };
  }
  if (forceRefresh && fetchImpl === globalThis.fetch) cachedOllamaModels = null;
  try {
    const res = await fetchImpl(endpoint, { redirect: 'error', signal: timeoutSignal(1200, signal) });
    if (res.ok) {
      const json = (await res.json()) as {
        models?: Array<{ name?: string; model?: string; remote_host?: unknown; remote_model?: unknown }>;
      };
      if (!Array.isArray(json?.models)) return { models: CURATED_OLLAMA_MODELS, online: false };
      const list = json.models
        .filter((m) => !m?.remote_host && !m?.remote_model)
        .map((m) => m?.model ?? m?.name)
        .filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 256 && !isOllamaCloudName(id))
        .map((id) => ({
          id,
          name: `${id} (Ollama Lokal)`,
          provider: 'ollama' as const,
          isFree: true,
          note: 'Terdeteksi aktif di mesin lokal',
        }));
      if (fetchImpl === globalThis.fetch) cachedOllamaModels = { fetchedAt: Date.now(), baseUrl: cleanUrl, models: list };
      return { models: list, online: true };
    }
  } catch {
    signal?.throwIfAborted();
  }
  return { models: CURATED_OLLAMA_MODELS, online: false };
}

export async function isOpenCodeCliAvailable(): Promise<boolean> {
  if (process.env.LLAMREI_DISABLE_CLI_AI === '1') return false;
  try {
    await execFileAsync('opencode', ['--version'], { timeout: 2500 });
    return true;
  } catch {
    return false;
  }
}

export interface AiProviderCatalogSummary {
  activeProvider: AiProviderId;
  assistantPersona: 'jarvis' | 'llamrei';
  opencodeCliAvailable: boolean;
  providers: Array<{
    id: Exclude<AiProviderId, 'auto' | 'local'>;
    label: string;
    configured: boolean;
    isFreePrimary: boolean;
    selectedModel: string;
    models: AiModelOption[];
  }>;
}

export async function getAiProvidersCatalog(
  forceRefresh = false,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<AiProviderCatalogSummary> {
  const cfg = getAiSettingsSnapshot();
  const openCodeConfigured = Boolean(getSecret('OPENCODE_API_KEY'));
  const openRouterConfigured = Boolean(getSecret('OPENROUTER_API_KEY'));
  const [openCodeRes, openRouterModels, ollamaRes, cliAvail] = await Promise.all([
    openCodeConfigured || forceRefresh ? fetchLiveOpenCodeFreeModels(forceRefresh, fetchImpl) : openCodeUnverified(),
    openRouterConfigured || forceRefresh ? fetchOpenRouterFreeModels(forceRefresh, fetchImpl) : [],
    fetchLiveOllamaModels(cfg.ollamaBaseUrl, forceRefresh, fetchImpl),
    isOpenCodeCliAvailable(),
  ]);

  const unverifiedPricing = (models: AiModelOption[]): AiModelOption[] =>
    models.map((model) => ({ ...model, isFree: false, note: 'Harga belum diverifikasi' }));
  const cliModels = unverifiedPricing(openCodeRes.models).map(
    (model): AiModelOption => ({ ...model, provider: 'opencode_cli' }),
  );

  return {
    activeProvider: cfg.provider,
    assistantPersona: cfg.assistantPersona,
    opencodeCliAvailable: cliAvail,
    providers: [
      {
        id: 'opencode_zen',
        label: 'OpenCode Zen (Free Models API)',
        configured: openCodeConfigured,
        isFreePrimary: openCodeRes.models.some((model) => model.id === cfg.opencodeModel && model.isFree) && !reportedCharge('opencode_zen', cfg.opencodeModel),
        selectedModel: cfg.opencodeModel,
        models: openCodeRes.models,
      },
      {
        id: 'opencode_cli',
        label: 'OpenCode CLI (Harga Belum Terverifikasi)',
        configured: cliAvail,
        isFreePrimary: false,
        selectedModel: cfg.opencodeModel,
        models: cliModels,
      },
      {
        id: 'openrouter',
        label: 'OpenRouter',
        configured: openRouterConfigured,
        isFreePrimary: openRouterModels.some((model) => model.id === cfg.openrouterModel) && !reportedCharge('openrouter', cfg.openrouterModel),
        selectedModel: cfg.openrouterModel,
        models: [...openRouterModels, ...unverifiedPricing(CURATED_OPENROUTER_FREE_MODELS).filter(
          ({ id }) => !openRouterModels.some((model) => model.id === id),
        )],
      },
      {
        id: 'groq',
        label: 'Groq LPU (Harga Belum Terverifikasi)',
        configured: Boolean(getSecret('GROQ_API_KEY')),
        isFreePrimary: false,
        selectedModel: cfg.groqModel,
        models: unverifiedPricing(CURATED_GROQ_FREE_MODELS),
      },
      {
        id: 'ollama',
        label: 'Ollama Lokal',
        configured: ollamaRes.online,
        isFreePrimary: ollamaRes.online && ollamaRes.models.some(({ id }) => sameOllamaModel(id, cfg.ollamaModel)),
        selectedModel: cfg.ollamaModel,
        models: ollamaRes.online ? ollamaRes.models : unverifiedPricing(ollamaRes.models),
      },
      {
        id: 'gemini',
        label: 'Google Gemini (AI Studio)',
        configured: Boolean(getSecret('GEMINI_API_KEY')),
        isFreePrimary: false,
        selectedModel: cfg.geminiModel,
        models: unverifiedPricing(CURATED_GEMINI_MODELS),
      },
    ],
  };
}

export function getAiBudgetSummary(): {
  monthlySpentUsd: number;
  monthlyCapUsd: number;
  remainingUsd: number;
  blocked: boolean;
  callsCount: number;
  actualSpentUsd: number;
  estimatedSpentUsd: number;
} {
  const db = getDb();
  const monthPrefix = todayWibIsoDate().slice(0, 7);
  const row = db.prepare(
    `SELECT COALESCE(SUM(actual_cost_usd), 0) AS actual,
            COALESCE(SUM(CASE WHEN actual_cost_usd IS NULL THEN estimated_cost_usd ELSE 0 END), 0) AS estimated,
            COUNT(*) AS cnt
     FROM ai_usage_ledger WHERE strftime('%Y-%m', created_at, '+7 hours') = ?`,
  ).get(monthPrefix) as { actual: number; estimated: number; cnt: number };

  const cap = readSetting<unknown>('ai_monthly_budget_usd', 10.0);
  const monthlyCapUsd = typeof cap === 'number' && Number.isFinite(cap) && cap >= 0 ? cap : 0;
  const spent = row.actual + row.estimated;
  return {
    monthlySpentUsd: Number(spent.toFixed(4)),
    monthlyCapUsd,
    remainingUsd: Math.max(0, Number((monthlyCapUsd - spent).toFixed(4))),
    blocked: spent >= monthlyCapUsd,
    callsCount: row.cnt,
    actualSpentUsd: row.actual,
    estimatedSpentUsd: row.estimated,
  };
}

function recordAiUsage(provider: CompatibleProvider, model: string, usage: ModelUsage): void {
  getDb().prepare(
    `INSERT INTO ai_usage_ledger
       (id, provider, model, feature, prompt_tokens, completion_tokens, estimated_cost_usd, actual_cost_usd)
     VALUES (?, ?, ?, 'agent', ?, ?, 0, ?)`,
  ).run(`ai_${crypto.randomUUID()}`, provider, model, usage.promptTokens, usage.completionTokens, usage.actualCostUsd ?? null);
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function acceptsZeroUsd(value: unknown): boolean {
  return value === 0 || (typeof value === 'string' && /^0(?:\.0+)?$/.test(value));
}

function timeoutSignal(milliseconds: number, signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(milliseconds);
  return signal ? AbortSignal.any([timeout, signal]) : timeout;
}

function getDuplicateModelIds(data: unknown[]): Set<string> {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const item of data) {
    if (!item || typeof item !== 'object' || !('id' in item) || typeof item.id !== 'string') continue;
    if (seen.has(item.id)) duplicates.add(item.id);
    seen.add(item.id);
  }
  return duplicates;
}

function openCodeUnverified() {
  return { models: FALLBACK_OPENCODE_FREE_MODELS.map((model) => ({
    ...model,
    isFree: false,
    note: 'Harga belum diverifikasi',
  })), liveFetched: false };
}

async function fetchOpenRouterFreeModels(
  forceRefresh: boolean, fetchImpl: typeof fetch, signal?: AbortSignal,
): Promise<AiModelOption[]> {
  if (!forceRefresh && fetchImpl === globalThis.fetch && cachedOpenRouterFreeModels &&
      Date.now() - cachedOpenRouterFreeModels.fetchedAt < 60_000) {
    return cachedOpenRouterFreeModels.models;
  }
  if (forceRefresh && fetchImpl === globalThis.fetch) cachedOpenRouterFreeModels = null;

  try {
    const res = await fetchImpl(`${OPENROUTER_OPENAI_BASE}/models`, {
      redirect: 'error',
      signal: timeoutSignal(4000, signal),
    });
    if (!res.ok) return [];
    const payload = await res.json() as {
      data?: Array<{
        id?: string;
        name?: string;
        context_length?: number;
        supported_parameters?: string[];
        pricing?: Record<string, unknown>;
      } | null>;
    };
    if (!Array.isArray(payload?.data)) return [];
    const duplicates = getDuplicateModelIds(payload.data);
    const models: AiModelOption[] = [];
    for (const item of payload.data) {
      if (!item || typeof item.id !== 'string' || item.id.length > 256 || !item.id.endsWith(':free') || duplicates.has(item.id)) continue;
      const pricing = item.pricing;
      if (!pricing || !acceptsZeroUsd(pricing.prompt) || !acceptsZeroUsd(pricing.completion) ||
          !Object.entries(pricing).every(([meter, value]) =>
            meter === 'overrides' ? Array.isArray(value) && value.length === 0 : acceptsZeroUsd(value))) continue;
      models.push({
        id: item.id,
        name: typeof item.name === 'string' ? item.name.slice(0, 160) : item.id,
        provider: 'openrouter', isFree: true,
        supportsTools: Array.isArray(item.supported_parameters) ? item.supported_parameters.includes('tools') : undefined,
        contextLimit: positiveInteger(item.context_length),
      });
    }
    if (fetchImpl === globalThis.fetch) cachedOpenRouterFreeModels = { fetchedAt: Date.now(), models };
    return models;
  } catch {
    signal?.throwIfAborted();
    return [];
  }
}

function reportedCharge(provider: CompatibleProvider, model: string): boolean {
  return Boolean(getDb().prepare(
    'SELECT 1 FROM ai_usage_ledger WHERE provider = ? AND model = ? AND actual_cost_usd > 0 LIMIT 1',
  ).get(provider, model));
}

export function parseOpenCodeCliJsonLines(stdout: string): string {
  const texts: string[] = [];
  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith('{')) continue;
    try {
      const ev = JSON.parse(line) as { type?: string; part?: { type?: string; text?: string }; text?: string };
      if (ev.type === 'text' && ev.part?.text) {
        texts.push(ev.part.text);
      } else if (ev.text) {
        texts.push(ev.text);
      }
    } catch {
      // Ignore non-JSON log lines
    }
  }
  return texts.join('\n').trim() || stdout.trim();
}

function isLoopbackModelEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    return (url.protocol === 'http:' || url.protocol === 'https:') &&
      !url.username && !url.password && !url.search && !url.hash &&
      ['127.0.0.1', '[::1]'].includes(url.hostname);
  } catch {
    return false;
  }
}

export function ollamaNativeEndpoint(baseUrl: string, path: 'tags' | 'embed'): string | null {
  if (!isLoopbackModelEndpoint(baseUrl)) return null;
  const url = new URL(baseUrl);
  url.pathname = `${url.pathname.replace(/\/$/, '').replace(/\/v1$/, '')}/api/${path}`;
  return url.href;
}

function isOllamaCloudName(model: string): boolean {
  return /(?:-cloud|:cloud)(?:$|:)/i.test(model);
}

function sameOllamaModel(installed: string, selected: string): boolean {
  return installed === selected || installed === `${selected}:latest`;
}

const routeReasons: Record<Exclude<RouteDecision, 'success'>, string> = {
  privacy: 'Private conversation context requires loopback Ollama or cloud consent',
  credentials: 'Provider key not configured',
  unverified_price: 'No verified zero-cost route',
  unsupported_tool: 'Model catalog does not support tools',
  context_limit: 'Model context window is too small',
  circuit_open: 'Provider is cooling down after errors',
  rate_limited: 'Provider rate limited the request',
  timeout: 'Provider request timed out',
  transport_error: 'Provider connection failed',
  provider_error: 'Provider rejected the request',
  invalid_response: 'Provider response was incomplete or invalid',
  empty_response: 'Provider returned no answer or tool call',
  unexpected_cost: 'Provider reported an unexpected charge',
  cancelled: 'Request cancelled',
};

function transportOutcome(error: unknown, signal: AbortSignal, caller?: AbortSignal): ProviderOutcome {
  if (caller?.aborted) return 'cancelled';
  if (signal.aborted) return 'timeout';
  return error instanceof ModelTransportError ? error.outcome : 'transport_error';
}

async function getRouteModels(
  provider: CompatibleProvider, model: string, baseUrl: string, fetchImpl: typeof fetch, signal?: AbortSignal,
): Promise<AiModelOption[]> {
  if (provider === 'opencode_zen') return (await fetchLiveOpenCodeFreeModels(false, fetchImpl, signal)).models;
  if (provider === 'openrouter') return fetchOpenRouterFreeModels(false, fetchImpl, signal);
  if (isOllamaCloudName(model)) return [];
  const local = await fetchLiveOllamaModels(baseUrl, false, fetchImpl, signal);
  return local.online ? local.models : [];
}

export async function invokeAiWithFallback(
  messages: UnifiedMessage[],
  tools: UnifiedToolDef[],
  options: AiInvocationOptions = {},
): Promise<UnifiedModelResult | null> {
  const cfg = getAiSettingsSnapshot();
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const activeProvider = options.providerOverride ?? cfg.provider;
  options.signal?.throwIfAborted();
  if (activeProvider === 'local') return null;
  const providerCircuit = providerCircuits.get(fetchImpl) ?? new ProviderCircuitBreaker();
  providerCircuits.set(fetchImpl, providerCircuit);

  const candidateOrder: ModelProvider[] = activeProvider === 'auto'
    ? [...new Set<ModelProvider>([...cfg.fallbackChain, ...(cfg.allowCliFallback ? ['opencode_cli'] as const : [])])]
    : [activeProvider];
  const configuredModels: Record<ModelProvider, string> = {
    opencode_zen: cfg.opencodeModel,
    opencode_cli: cfg.opencodeModel,
    openrouter: cfg.openrouterModel,
    groq: cfg.groqModel,
    ollama: cfg.ollamaModel,
    gemini: cfg.geminiModel,
  };
  const estimatedInput = Math.ceil(Buffer.byteLength(JSON.stringify({ messages, tools })) / 3) + 32;
  const attempts: ProviderAttempt[] = [];

  function report(provider: ModelProvider, model: string, code: RouteDecision): void {
    const attempt: ProviderAttempt = { provider, model, code, ok: code === 'success', reason: code === 'success' ? undefined : routeReasons[code] };
    attempts.push(attempt);
    options.onAttempt?.(attempt);
  }

  for (const provider of candidateOrder) {
    const model = (activeProvider !== 'auto' && options.modelOverride) || configuredModels[provider];
    const loopback = provider === 'ollama' && isLoopbackModelEndpoint(cfg.ollamaBaseUrl);
    const permitsPrivateContext = () => !options.containsPrivateContext || loopback ||
      readSetting<unknown>('ai_allow_cloud_chat_context', false) === true;
    if (!permitsPrivateContext()) {
      report(provider, model, 'privacy');
      continue;
    }
    if (!loopback && provider !== 'opencode_zen' && provider !== 'openrouter') {
      report(provider, model, 'unverified_price');
      continue;
    }
    const compatibleProvider = provider as CompatibleProvider;
    const baseUrl = provider === 'opencode_zen' ? OPENCODE_OPENAI_BASE
      : provider === 'openrouter' ? OPENROUTER_OPENAI_BASE : cfg.ollamaBaseUrl;
    if (!loopback && reportedCharge(compatibleProvider, model)) {
      report(provider, model, 'unexpected_cost');
      continue;
    }
    const apiKey = loopback ? undefined : getSecret(provider === 'opencode_zen' ? 'OPENCODE_API_KEY' : 'OPENROUTER_API_KEY');
    if (!loopback && !apiKey) {
      report(provider, model, 'credentials');
      continue;
    }

    const catalog = await getRouteModels(compatibleProvider, model, baseUrl, fetchImpl, options.signal);
    options.signal?.throwIfAborted();
    const modelInfo = catalog.find((item) => item.isFree && (loopback ? sameOllamaModel(item.id, model) : item.id === model));
    if (!modelInfo) {
      report(provider, model, 'unverified_price');
      continue;
    }
    if (!permitsPrivateContext()) {
      report(provider, model, 'privacy');
      continue;
    }
    if (!loopback && reportedCharge(compatibleProvider, model)) {
      report(provider, model, 'unexpected_cost');
      continue;
    }
    if (tools.length > 0 && modelInfo.supportsTools === false) {
      report(provider, model, 'unsupported_tool');
      continue;
    }
    const maxTokens = modelInfo.contextLimit ? Math.min(MAX_OUTPUT_TOKENS, modelInfo.contextLimit - estimatedInput) : MAX_OUTPUT_TOKENS;
    if (maxTokens < 128) {
      report(provider, model, 'context_limit');
      continue;
    }

    const routeKey = JSON.stringify([provider, model, baseUrl]);
    const claim = providerCircuit.claim(routeKey);
    if (!claim) {
      report(provider, model, 'circuit_open');
      continue;
    }

    const signal = timeoutSignal(20_000, options.signal);
    const started = performance.now();
    let firstTokenMs: number | null = null;
    let usage: ModelUsage | undefined;
    let completion: Awaited<ReturnType<typeof callOpenAiCompatibleProvider>> | undefined;
    let outcome: ProviderOutcome;
    let retryAfterMs: number | undefined;
    try {
      options.onStart?.(provider, model);
      completion = await callOpenAiCompatibleProvider({
        provider: compatibleProvider, baseUrl, apiKey: apiKey ?? undefined, model, messages, tools, maxTokens, fetchImpl, signal,
        onDelta: options.onDelta && ((delta) => {
          if (firstTokenMs === null && delta.trim()) firstTokenMs = Math.round(performance.now() - started);
          options.onDelta?.(delta);
        }),
        onUsage: (next) => {
          usage = next;
          if (next.actualCostUsd && next.actualCostUsd > 0) throw new ModelTransportError('unexpected_cost');
        },
      });
      signal.throwIfAborted();
      outcome = completion.text || completion.toolCalls.length > 0 ? 'success' : 'empty_response';
    } catch (error) {
      outcome = transportOutcome(error, signal, options.signal);
      if (error instanceof ModelTransportError) retryAfterMs = error.retryAfterMs;
    }

    providerCircuit.finish(routeKey, claim, outcome, retryAfterMs);
    recordProviderAttempt(provider, model, outcome, Math.round(performance.now() - started), firstTokenMs);
    if (completion || usage) recordAiUsage(compatibleProvider, model, usage ?? { promptTokens: 0, completionTokens: 0 });
    options.signal?.throwIfAborted();
    report(provider, model, outcome);
    if (outcome === 'success' && completion) {
      return {
        ...completion, providerUsed: provider, modelUsed: model, isFreeTier: true, attempts,
        ...(usage ?? { promptTokens: 0, completionTokens: 0 }),
      };
    }
  }

  return null;
}
