import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getDb, todayWibIsoDate } from '../db/connection.ts';
import { getSecret } from './secret.service.ts';

const execFileAsync = promisify(execFile);

export type AiProviderId =
  | 'auto'
  | 'opencode_zen'
  | 'opencode_cli'
  | 'openrouter'
  | 'groq'
  | 'ollama'
  | 'gemini'
  | 'local';

export interface AiModelOption {
  id: string;
  name: string;
  provider: Exclude<AiProviderId, 'auto' | 'local'>;
  isFree: boolean;
  supportsTools: boolean;
  contextLimit?: number;
  note?: string;
}

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

export interface ProviderAttempt {
  provider: Exclude<AiProviderId, 'auto' | 'local'>;
  model: string;
  ok: boolean;
  reason?: string;
}

export interface UnifiedModelResult {
  text: string;
  toolCalls: UnifiedToolCall[];
  providerUsed: Exclude<AiProviderId, 'auto' | 'local'>;
  modelUsed: string;
  promptTokens: number;
  completionTokens: number;
  isFreeTier: boolean;
  actualCostUsd?: number;
  attempts: ProviderAttempt[];
}

export interface AiInvocationOptions {
  providerOverride?: AiProviderId;
  modelOverride?: string;
  containsPrivateContext?: boolean;
  fetchImpl?: typeof fetch;
}

const OPENCODE_MODELS_CATALOG_URL = 'https://opencode.ai/zen/v1/models';
const OPENCODE_OPENAI_BASE = 'https://opencode.ai/zen/v1';
const OPENROUTER_OPENAI_BASE = 'https://openrouter.ai/api/v1';

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
  fallbackChain: Array<Exclude<AiProviderId, 'auto' | 'local'>>;
} {
  const rawProvider = readSetting<string>('ai_provider', 'auto');
  const validProviders = new Set<AiProviderId>([
    'auto',
    'opencode_zen',
    'opencode_cli',
    'openrouter',
    'groq',
    'ollama',
    'gemini',
    'local',
  ]);
  const provider: AiProviderId = validProviders.has(rawProvider as AiProviderId)
    ? (rawProvider as AiProviderId)
    : 'auto';

  const rawPersona = readSetting<string>('assistant_persona', 'jarvis');
  const assistantPersona = rawPersona === 'llamrei' ? 'llamrei' : 'jarvis';

  const defaultChain: Array<Exclude<AiProviderId, 'auto' | 'local'>> = [
    'opencode_zen',
    'openrouter',
    'groq',
    'ollama',
    'gemini',
  ];
  const savedChain = readSetting<string[]>('ai_free_fallback_chain', defaultChain);
  const allowedChainSet = new Set<Exclude<AiProviderId, 'auto' | 'local'>>([
    'opencode_zen',
    'opencode_cli',
    'openrouter',
    'groq',
    'ollama',
    'gemini',
  ]);
  const fallbackChain = savedChain.filter((p): p is Exclude<AiProviderId, 'auto' | 'local'> =>
    allowedChainSet.has(p as Exclude<AiProviderId, 'auto' | 'local'>),
  );

  return {
    provider,
    assistantPersona,
    opencodeModel: readSetting<string>('opencode_model', 'big-pickle'),
    openrouterModel: readSetting<string>('openrouter_model', 'meta-llama/llama-3.3-70b-instruct:free'),
    groqModel: readSetting<string>('groq_model', 'llama-3.3-70b-versatile'),
    ollamaBaseUrl: readSetting<string>('ollama_base_url', 'http://127.0.0.1:11434/v1').replace(/\/+$/, ''),
    ollamaModel: readSetting<string>('ollama_model', 'qwen2.5:7b'),
    geminiModel: readSetting<string>('ai_model', 'gemini-2.5-flash'),
    paidBillingVerified: readSetting<boolean>('paid_billing_verified', false) === true,
    allowCloudChatContext: readSetting<boolean>('ai_allow_cloud_chat_context', false) === true,
    allowCliFallback: Boolean(readSetting<boolean>('allow_opencode_cli_fallback', false)),
    fallbackChain: fallbackChain.length > 0 ? fallbackChain : defaultChain,
  };
}

export function parseOpenCodeCatalogJson(payload: unknown): AiModelOption[] {
  const data = (payload as { data?: unknown[] })?.data;
  if (!Array.isArray(data)) return [];
  const models: AiModelOption[] = [];

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
    if (typeof m.id !== 'string' || !m.id || m.type !== 'chat') continue;
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
      name: m.name || m.id,
      provider: 'opencode_zen',
      isFree: true,
      supportsTools: Boolean(m.capabilities?.tools?.supported),
      contextLimit: m.limit?.context,
      note: m.description?.slice(0, 72) || 'OpenCode Free Tier',
    });
  }

  return models;
}

export async function fetchLiveOpenCodeFreeModels(
  forceRefresh = false,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<{ models: AiModelOption[]; liveFetched: boolean }> {
  if (!forceRefresh && fetchImpl === globalThis.fetch && cachedOpenCodeFreeModels &&
      Date.now() - cachedOpenCodeFreeModels.fetchedAt < 60_000) {
    return { models: cachedOpenCodeFreeModels.models, liveFetched: true };
  }
  try {
    const res = await fetchImpl(OPENCODE_MODELS_CATALOG_URL, {
      redirect: 'error',
      signal: AbortSignal.timeout(4000),
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
    // Offline or timeout — return curated list
  }
  return { models: FALLBACK_OPENCODE_FREE_MODELS.map((model) => ({
    ...model,
    isFree: false,
    note: 'Harga belum diverifikasi',
  })), liveFetched: false };
}

export async function fetchLiveOllamaModels(
  baseUrl: string,
  forceRefresh = false,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<{ models: AiModelOption[]; online: boolean }> {
  const cleanUrl = baseUrl.replace(/\/+$/, '');
  if (
    !forceRefresh &&
    cachedOllamaModels &&
    cachedOllamaModels.baseUrl === cleanUrl &&
    Date.now() - cachedOllamaModels.fetchedAt < 60_000
  ) {
    return { models: cachedOllamaModels.models, online: true };
  }
  try {
    const res = await fetchImpl(`${cleanUrl}/models`, { signal: AbortSignal.timeout(1200) });
    if (res.ok) {
      const json = (await res.json()) as { data?: Array<{ id?: string }> };
      const list = (json.data ?? [])
        .filter((m) => Boolean(m.id))
        .map((m) => ({
          id: m.id!,
          name: `${m.id!} (Ollama Lokal)`,
          provider: 'ollama' as const,
          isFree: true,
          supportsTools: true,
          note: 'Terdeteksi aktif di mesin lokal',
        }));
      const finalModels = list.length > 0 ? list : CURATED_OLLAMA_MODELS;
      cachedOllamaModels = { fetchedAt: Date.now(), baseUrl: cleanUrl, models: finalModels };
      return { models: finalModels, online: true };
    }
  } catch {
    // Ollama not running locally
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
  const [openCodeRes, ollamaRes, cliAvail] = await Promise.all([
    fetchLiveOpenCodeFreeModels(forceRefresh, fetchImpl),
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
        configured: Boolean(getSecret('OPENCODE_API_KEY')),
        isFreePrimary: openCodeRes.liveFetched && openCodeRes.models.some((model) => model.id === cfg.opencodeModel),
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
        label: 'OpenRouter (:free Pool)',
        configured: Boolean(getSecret('OPENROUTER_API_KEY')),
        isFreePrimary: false,
        selectedModel: cfg.openrouterModel,
        models: unverifiedPricing(CURATED_OPENROUTER_FREE_MODELS),
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
        label: 'Ollama Lokal (Offline 100% Gratis)',
        configured: ollamaRes.online,
        isFreePrimary: isLoopbackModelEndpoint(cfg.ollamaBaseUrl),
        selectedModel: cfg.ollamaModel,
        models: isLoopbackModelEndpoint(cfg.ollamaBaseUrl) ? ollamaRes.models : unverifiedPricing(ollamaRes.models),
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

function recordAiUsage(result: Omit<UnifiedModelResult, 'attempts'>): void {
  getDb().prepare(
    `INSERT INTO ai_usage_ledger
       (id, provider, model, feature, prompt_tokens, completion_tokens, estimated_cost_usd, actual_cost_usd)
     VALUES (?, ?, ?, 'agent', ?, ?, 0, ?)`,
  ).run(
    `ai_${crypto.randomUUID()}`,
    result.providerUsed,
    result.modelUsed,
    result.promptTokens,
    result.completionTokens,
    result.actualCostUsd ?? null,
  );
}

function acceptsZeroUsd(value: unknown): boolean {
  return value === 0 || (typeof value === 'string' && /^0(?:\.0+)?$/.test(value));
}

async function hasVerifiedFreeOpenRouterModel(model: string, fetchImpl: typeof fetch): Promise<boolean> {
  if (!model.endsWith(':free')) return false;
  const res = await fetchImpl(`${OPENROUTER_OPENAI_BASE}/models`, {
    redirect: 'error',
    signal: AbortSignal.timeout(4000),
  });
  if (!res.ok) return false;
  const payload = await res.json() as { data?: Array<{ id?: string; pricing?: Record<string, unknown> }> };
  if (!Array.isArray(payload?.data)) return false;
  const matches = payload.data.filter((item) => item?.id === model);
  if (matches.length !== 1) return false;
  const pricing = matches[0].pricing;
  if (!pricing || !acceptsZeroUsd(pricing.prompt) || !acceptsZeroUsd(pricing.completion)) return false;
  return Object.entries(pricing).every(([meter, value]) =>
    meter === 'overrides' ? Array.isArray(value) && value.length === 0 : acceptsZeroUsd(value),
  );
}

function providerTokenCount(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function normalizeSchemaForOpenAi(schema: Record<string, unknown>): Record<string, unknown> {
  const props = (schema.properties as Record<string, unknown> | undefined) ?? {};
  return {
    type: 'object',
    properties: props,
    ...(Array.isArray(schema.required) ? { required: schema.required } : {}),
  };
}

async function callOpenAiCompatibleProvider(params: {
  provider: 'opencode_zen' | 'openrouter' | 'ollama';
  baseUrl: string;
  apiKey: string | null;
  model: string;
  messages: UnifiedMessage[];
  tools: UnifiedToolDef[];
  extraHeaders?: Record<string, string>;
  fetchImpl: typeof fetch;
}): Promise<Omit<UnifiedModelResult, 'attempts'>> {
  const openAiMessages = params.messages.map((m) => {
    if (m.role === 'tool') {
      return {
        role: 'tool',
        tool_call_id: m.toolCallId ?? 'call_0',
        content: m.content,
      };
    }
    if (m.role === 'assistant' && m.toolCalls?.length) {
      return {
        role: 'assistant',
        content: m.content || null,
        tool_calls: m.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: JSON.stringify(tc.args) },
        })),
      };
    }
    return { role: m.role, content: m.content };
  });

  const payload: Record<string, unknown> = {
    model: params.model,
    messages: openAiMessages,
    temperature: 0.3,
  };

  if (params.provider === 'openrouter') {
    payload.provider = {
      allow_fallbacks: false,
      max_price: { prompt: '0', completion: '0', request: '0', image: '0', audio: '0' },
    };
  }

  if (params.tools.length > 0) {
    payload.tools = params.tools.map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description.slice(0, 500),
        parameters: normalizeSchemaForOpenAi(t.parameters),
      },
    }));
    payload.tool_choice = 'auto';
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(params.apiKey ? { Authorization: `Bearer ${params.apiKey}` } : {}),
    ...(params.extraHeaders ?? {}),
  };

  const res = await params.fetchImpl(`${params.baseUrl}/chat/completions`, {
    method: 'POST',
    redirect: 'error',
    headers,
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20000),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} (${errBody.slice(0, 120)})`);
  }

  const json = (await res.json()) as {
    choices?: Array<{
      message?: {
        content?: string | null;
        tool_calls?: Array<{
          id?: string;
          function?: { name?: string; arguments?: string };
        }>;
      };
    }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
  };

  const msg = json.choices?.[0]?.message;
  const toolCalls: UnifiedToolCall[] = [];
  for (const tc of msg?.tool_calls ?? []) {
    const name = tc.function?.name;
    if (!name) continue;
    let parsedArgs: Record<string, unknown> = {};
    if (tc.function?.arguments) {
      try {
        parsedArgs = JSON.parse(tc.function.arguments) as Record<string, unknown>;
      } catch {
        parsedArgs = {};
      }
    }
    toolCalls.push({
      id: tc.id ?? `call_${crypto.randomUUID().slice(0, 8)}`,
      name,
      args: parsedArgs,
    });
  }

  return {
    text: (msg?.content ?? '').trim(),
    toolCalls,
    providerUsed: params.provider,
    modelUsed: params.model,
    promptTokens: providerTokenCount(json.usage?.prompt_tokens),
    completionTokens: providerTokenCount(json.usage?.completion_tokens),
    isFreeTier: true,
    actualCostUsd: params.provider === 'openrouter' && typeof json.usage?.cost === 'number' &&
      Number.isFinite(json.usage.cost) && json.usage.cost >= 0 ? json.usage.cost : undefined,
  };
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
      !url.username && !url.password &&
      ['127.0.0.1', '[::1]'].includes(url.hostname);
  } catch {
    return false;
  }
}

export async function invokeAiWithFallback(
  messages: UnifiedMessage[],
  tools: UnifiedToolDef[],
  options: AiInvocationOptions = {},
): Promise<UnifiedModelResult | null> {
  const cfg = getAiSettingsSnapshot();
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const activeProvider = options.providerOverride ?? cfg.provider;

  if (activeProvider === 'local') return null;

  const candidateOrder: Array<Exclude<AiProviderId, 'auto' | 'local'>> =
    activeProvider === 'auto'
      ? [...cfg.fallbackChain, ...(cfg.allowCliFallback && !cfg.fallbackChain.includes('opencode_cli') ? (['opencode_cli'] as const) : [])]
      : [activeProvider];

  const attempts: ProviderAttempt[] = [];

  for (const prov of candidateOrder) {
    if (options.containsPrivateContext && !cfg.allowCloudChatContext &&
        (prov !== 'ollama' || !isLoopbackModelEndpoint(cfg.ollamaBaseUrl))) {
      attempts.push({
        provider: prov,
        model: '-',
        ok: false,
        reason: 'Private conversation context requires local Ollama or explicit cloud consent',
      });
      continue;
    }

    const configuredModel = {
      opencode_zen: cfg.opencodeModel,
      opencode_cli: cfg.opencodeModel,
      openrouter: cfg.openrouterModel,
      groq: cfg.groqModel,
      ollama: cfg.ollamaModel,
      gemini: cfg.geminiModel,
    }[prov];
    const model = (activeProvider !== 'auto' && options.modelOverride) || configuredModel;

    try {
      let result: Omit<UnifiedModelResult, 'attempts'>;
      if (prov === 'opencode_zen') {
        const key = getSecret('OPENCODE_API_KEY');
        if (!key) {
          attempts.push({ provider: prov, model, ok: false, reason: 'OPENCODE_API_KEY not configured' });
          continue;
        }
        const catalog = await fetchLiveOpenCodeFreeModels(false, fetchImpl);
        if (!catalog.liveFetched || !catalog.models.some((item) => item.id === model)) {
          attempts.push({ provider: prov, model, ok: false, reason: 'OpenCode catalog did not verify zero cost' });
          continue;
        }
        result = await callOpenAiCompatibleProvider({
          provider: prov,
          baseUrl: OPENCODE_OPENAI_BASE,
          apiKey: key,
          model,
          messages,
          tools,
          fetchImpl,
        });
      } else if (prov === 'openrouter') {
        const key = getSecret('OPENROUTER_API_KEY');
        if (!key) {
          attempts.push({ provider: prov, model, ok: false, reason: 'OPENROUTER_API_KEY not configured' });
          continue;
        }
        const unexpectedCost = getDb().prepare(
          'SELECT 1 FROM ai_usage_ledger WHERE provider = ? AND model = ? AND actual_cost_usd > 0 LIMIT 1',
        ).get(prov, model);
        if (unexpectedCost || !await hasVerifiedFreeOpenRouterModel(model, fetchImpl)) {
          attempts.push({ provider: prov, model, ok: false, reason: 'OpenRouter route did not verify zero cost' });
          continue;
        }
        result = await callOpenAiCompatibleProvider({
          provider: prov,
          baseUrl: OPENROUTER_OPENAI_BASE,
          apiKey: key,
          model,
          messages,
          tools,
          extraHeaders: { 'HTTP-Referer': 'http://localhost:5173', 'X-Title': 'Llamrei Jarvis OS' },
          fetchImpl,
        });
      } else if (prov === 'ollama' && isLoopbackModelEndpoint(cfg.ollamaBaseUrl)) {
        result = await callOpenAiCompatibleProvider({
          provider: prov,
          baseUrl: cfg.ollamaBaseUrl,
          apiKey: null,
          model,
          messages,
          tools,
          fetchImpl,
        });
      } else {
        attempts.push({ provider: prov, model, ok: false, reason: 'No verified zero-cost route' });
        continue;
      }

      recordAiUsage(result);
      if (result.actualCostUsd && result.actualCostUsd > 0) {
        attempts.push({ provider: prov, model, ok: false, reason: 'Provider reported an unexpected charge' });
        continue;
      }
      if (result.text || result.toolCalls.length > 0) {
        attempts.push({ provider: prov, model: result.modelUsed, ok: true });
        return { ...result, attempts };
      }
      attempts.push({ provider: prov, model, ok: false, reason: 'Empty response' });
    } catch (err) {
      attempts.push({
        provider: prov,
        model: options.modelOverride ?? '-',
        ok: false,
        reason: err instanceof Error ? err.message : 'Provider call failed',
      });
    }
  }

  return null;
}
