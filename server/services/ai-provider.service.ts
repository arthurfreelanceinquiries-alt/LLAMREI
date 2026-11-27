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
  attempts: ProviderAttempt[];
}

export interface AiInvocationOptions {
  providerOverride?: AiProviderId;
  modelOverride?: string;
  isSensitiveWaContext?: boolean;
  fetchImpl?: typeof fetch;
  cliRunner?: (args: string[]) => Promise<{ stdout: string; stderr: string }>;
}

const OPENCODE_MODELS_CATALOG_URL = 'https://opencode.ai/zen/v1/models';
const OPENCODE_OPENAI_BASE = 'https://opencode.ai/inference/openai/v1';
const OPENROUTER_OPENAI_BASE = 'https://openrouter.ai/api/v1';
const GROQ_OPENAI_BASE = 'https://api.groq.com/openai/v1';

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
    paidBillingVerified: Boolean(readSetting<boolean>('paid_billing_verified', false)),
    allowCliFallback: Boolean(readSetting<boolean>('allow_opencode_cli_fallback', false)),
    fallbackChain: fallbackChain.length > 0 ? fallbackChain : defaultChain,
  };
}

export function parseOpenCodeCatalogJson(payload: unknown): AiModelOption[] {
  const data = (payload as { data?: unknown[] })?.data;
  if (!Array.isArray(data)) return [];
  const models: AiModelOption[] = [];

  for (const item of data) {
    const m = item as {
      id?: string;
      name?: string;
      type?: string;
      description?: string;
      capabilities?: { tools?: { supported?: boolean } };
      limit?: { context?: number };
      cost?: { text?: { input?: { price?: number }; output?: { price?: number } } };
    };
    if (!m.id || m.type !== 'chat') continue;
    const inPrice = m.cost?.text?.input?.price;
    const outPrice = m.cost?.text?.output?.price;
    const isFree = (inPrice === 0 && outPrice === 0) || m.id.endsWith('-free') || m.id === 'big-pickle';
    if (!isFree) continue;

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
  if (!forceRefresh && cachedOpenCodeFreeModels && Date.now() - cachedOpenCodeFreeModels.fetchedAt < 15 * 60_000) {
    return { models: cachedOpenCodeFreeModels.models, liveFetched: true };
  }
  try {
    const res = await fetchImpl(OPENCODE_MODELS_CATALOG_URL, { signal: AbortSignal.timeout(4000) });
    if (res.ok) {
      const json = await res.json();
      const parsed = parseOpenCodeCatalogJson(json);
      if (parsed.length > 0) {
        cachedOpenCodeFreeModels = { fetchedAt: Date.now(), models: parsed };
        return { models: parsed, liveFetched: true };
      }
    }
  } catch {
    // Offline or timeout — return curated list
  }
  return { models: FALLBACK_OPENCODE_FREE_MODELS, liveFetched: false };
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

  const cliModels: AiModelOption[] = openCodeRes.models.map((m) => ({
    ...m,
    provider: 'opencode_cli',
    note: `Via opencode run CLI (${m.id})`,
  }));

  return {
    activeProvider: cfg.provider,
    assistantPersona: cfg.assistantPersona,
    opencodeCliAvailable: cliAvail,
    providers: [
      {
        id: 'opencode_zen',
        label: 'OpenCode Zen (Free Models API)',
        configured: Boolean(getSecret('OPENCODE_API_KEY')),
        isFreePrimary: true,
        selectedModel: cfg.opencodeModel,
        models: openCodeRes.models,
      },
      {
        id: 'opencode_cli',
        label: 'OpenCode CLI Lokal (Gratis via CLI)',
        configured: cliAvail,
        isFreePrimary: true,
        selectedModel: cfg.opencodeModel,
        models: cliModels,
      },
      {
        id: 'openrouter',
        label: 'OpenRouter (:free Pool)',
        configured: Boolean(getSecret('OPENROUTER_API_KEY')),
        isFreePrimary: true,
        selectedModel: cfg.openrouterModel,
        models: CURATED_OPENROUTER_FREE_MODELS,
      },
      {
        id: 'groq',
        label: 'Groq LPU (Free Fast Tier)',
        configured: Boolean(getSecret('GROQ_API_KEY')),
        isFreePrimary: true,
        selectedModel: cfg.groqModel,
        models: CURATED_GROQ_FREE_MODELS,
      },
      {
        id: 'ollama',
        label: 'Ollama Lokal (Offline 100% Gratis)',
        configured: ollamaRes.online,
        isFreePrimary: true,
        selectedModel: cfg.ollamaModel,
        models: ollamaRes.models,
      },
      {
        id: 'gemini',
        label: 'Google Gemini (AI Studio)',
        configured: Boolean(getSecret('GEMINI_API_KEY')),
        isFreePrimary: true,
        selectedModel: cfg.geminiModel,
        models: CURATED_GEMINI_MODELS,
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
} {
  const db = getDb();
  const monthPrefix = todayWibIsoDate().slice(0, 7);
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(estimated_cost_usd), 0) AS spent, COUNT(*) AS cnt
       FROM ai_usage_ledger WHERE created_at LIKE ?`,
    )
    .get(`${monthPrefix}%`) as { spent: number; cnt: number };

  const monthlyCapUsd = Number(readSetting<number>('ai_monthly_budget_usd', 10.0));
  const monthlySpentUsd = Math.round(row.spent * 10000) / 10000;
  return {
    monthlySpentUsd,
    monthlyCapUsd,
    remainingUsd: Math.max(0, Math.round((monthlyCapUsd - monthlySpentUsd) * 10000) / 10000),
    blocked: monthlySpentUsd >= monthlyCapUsd,
    callsCount: row.cnt,
  };
}

export function recordAiUsage(
  provider: string,
  model: string,
  feature: string,
  promptTokens: number,
  completionTokens: number,
  isFreeTier: boolean,
): void {
  const db = getDb();
  let cost = 0;
  if (!isFreeTier && provider === 'gemini') {
    const isPro = model.includes('pro');
    const rateIn = isPro ? 0.00000125 : 0.00000015;
    const rateOut = isPro ? 0.000005 : 0.0000006;
    cost = promptTokens * rateIn + completionTokens * rateOut;
  }
  db.prepare(
    `INSERT INTO ai_usage_ledger (id, provider, model, feature, prompt_tokens, completion_tokens, estimated_cost_usd)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(`ai_${crypto.randomUUID().slice(0, 8)}`, provider, model, feature, promptTokens, completionTokens, cost);
}

function isModelFree(provider: Exclude<AiProviderId, 'auto' | 'local'>, model: string): boolean {
  if (provider === 'opencode_zen' || provider === 'opencode_cli' || provider === 'ollama' || provider === 'groq') {
    return true;
  }
  if (provider === 'openrouter') {
    return model.includes(':free');
  }
  return !model.includes('pro');
}

function normalizeSchemaForOpenAi(schema: Record<string, unknown>): Record<string, unknown> {
  const props = (schema.properties as Record<string, unknown> | undefined) ?? {};
  return {
    type: 'object',
    properties: props,
    ...(Array.isArray(schema.required) ? { required: schema.required } : {}),
  };
}

function convertSchemaTypeToGemini(raw: unknown): unknown {
  if (Array.isArray(raw)) return raw.map(convertSchemaTypeToGemini);
  if (!raw || typeof raw !== 'object') return raw;
  const obj = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k === 'additionalProperties' || k === '$schema' || k === 'default') continue;
    if (k === 'type' && typeof v === 'string') {
      out[k] = v.toUpperCase();
    } else {
      out[k] = convertSchemaTypeToGemini(v);
    }
  }
  return out;
}

async function callOpenAiCompatibleProvider(params: {
  provider: 'opencode_zen' | 'openrouter' | 'groq' | 'ollama';
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
    usage?: { prompt_tokens?: number; completion_tokens?: number };
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
    promptTokens: json.usage?.prompt_tokens ?? 250,
    completionTokens: json.usage?.completion_tokens ?? 120,
    isFreeTier: isModelFree(params.provider, params.model),
  };
}

async function callGeminiProvider(params: {
  apiKey: string;
  model: string;
  messages: UnifiedMessage[];
  tools: UnifiedToolDef[];
  fetchImpl: typeof fetch;
}): Promise<Omit<UnifiedModelResult, 'attempts'>> {
  const sysMsg = params.messages.find((m) => m.role === 'system')?.content ?? '';
  const contents: Array<Record<string, unknown>> = [];

  for (const m of params.messages) {
    if (m.role === 'system') continue;
    if (m.role === 'user') {
      contents.push({ role: 'user', parts: [{ text: m.content }] });
    } else if (m.role === 'assistant') {
      const parts: Array<Record<string, unknown>> = [];
      if (m.content) parts.push({ text: m.content });
      for (const tc of m.toolCalls ?? []) {
        parts.push({ functionCall: { name: tc.name, args: tc.args } });
      }
      if (parts.length > 0) contents.push({ role: 'model', parts });
    } else if (m.role === 'tool') {
      let respObj: unknown = m.content;
      try {
        respObj = JSON.parse(m.content);
      } catch {
        respObj = { result: m.content };
      }
      contents.push({
        role: 'user',
        parts: [
          {
            functionResponse: {
              name: m.toolName ?? 'tool',
              response: typeof respObj === 'object' && respObj !== null ? respObj : { result: respObj },
            },
          },
        ],
      });
    }
  }

  const body: Record<string, unknown> = {
    ...(sysMsg ? { systemInstruction: { parts: [{ text: sysMsg }] } } : {}),
    contents,
  };

  if (params.tools.length > 0) {
    body.tools = [
      {
        functionDeclarations: params.tools.map((t) => ({
          name: t.name,
          description: t.description.slice(0, 500),
          parameters: convertSchemaTypeToGemini(normalizeSchemaForOpenAi(t.parameters)),
        })),
      },
    ];
  }

  const res = await params.fetchImpl(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(params.model)}:generateContent?key=${encodeURIComponent(params.apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(18000),
    },
  );

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} (${errText.slice(0, 120)})`);
  }

  const data = (await res.json()) as {
    candidates?: Array<{
      content?: {
        parts?: Array<{
          text?: string;
          functionCall?: { name: string; args?: Record<string, unknown> };
        }>;
      };
    }>;
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  };

  const parts = data.candidates?.[0]?.content?.parts ?? [];
  const toolCalls: UnifiedToolCall[] = parts
    .filter((p) => Boolean(p.functionCall?.name))
    .map((p) => ({
      id: `gem_${crypto.randomUUID().slice(0, 8)}`,
      name: p.functionCall!.name,
      args: p.functionCall!.args ?? {},
    }));
  const text = parts
    .map((p) => p.text ?? '')
    .join('\n')
    .trim();

  return {
    text,
    toolCalls,
    providerUsed: 'gemini',
    modelUsed: params.model,
    promptTokens: data.usageMetadata?.promptTokenCount ?? 300,
    completionTokens: data.usageMetadata?.candidatesTokenCount ?? 150,
    isFreeTier: isModelFree('gemini', params.model),
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

async function callOpenCodeCliProvider(params: {
  model: string;
  messages: UnifiedMessage[];
  cliRunner?: (args: string[]) => Promise<{ stdout: string; stderr: string }>;
}): Promise<Omit<UnifiedModelResult, 'attempts'>> {
  const sysMsg = params.messages.find((m) => m.role === 'system')?.content ?? '';
  const transcript = params.messages
    .filter((m) => m.role !== 'system')
    .slice(-8)
    .map((m) => `[${m.role.toUpperCase()}]: ${m.content}`)
    .join('\n\n');
  const fullPrompt = `${sysMsg ? `${sysMsg}\n\n` : ''}${transcript}`;
  const modelFlag = params.model.includes('/') ? params.model : `opencode/${params.model}`;

  const runner =
    params.cliRunner ??
    ((args: string[]) => execFileAsync('opencode', args, { timeout: 25000, maxBuffer: 2 * 1024 * 1024 }));
  const { stdout } = await runner(['run', '--model', modelFlag, '--format', 'json', fullPrompt]);
  const text = parseOpenCodeCliJsonLines(stdout);
  if (!text) throw new Error('OpenCode CLI returned empty output');

  return {
    text,
    toolCalls: [],
    providerUsed: 'opencode_cli',
    modelUsed: modelFlag,
    promptTokens: Math.ceil(fullPrompt.length / 4),
    completionTokens: Math.ceil(text.length / 4),
    isFreeTier: true,
  };
}

export async function invokeAiWithFallback(
  messages: UnifiedMessage[],
  tools: UnifiedToolDef[],
  options: AiInvocationOptions = {},
): Promise<UnifiedModelResult | null> {
  const cfg = getAiSettingsSnapshot();
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const activeProvider = options.providerOverride ?? cfg.provider;
  const budget = getAiBudgetSummary();

  if (activeProvider === 'local') return null;

  const candidateOrder: Array<Exclude<AiProviderId, 'auto' | 'local'>> =
    activeProvider === 'auto'
      ? [...cfg.fallbackChain, ...(cfg.allowCliFallback && !cfg.fallbackChain.includes('opencode_cli') ? (['opencode_cli'] as const) : [])]
      : [activeProvider];

  const attempts: ProviderAttempt[] = [];

  for (const prov of candidateOrder) {
    // Privacy gate for WhatsApp context on cloud free-tier when paid_billing_verified is false
    if (options.isSensitiveWaContext && !cfg.paidBillingVerified && prov !== 'ollama') {
      attempts.push({
        provider: prov,
        model: '-',
        ok: false,
        reason: 'Blocked for WA context until paid_billing_verified is enabled (privacy guard)',
      });
      continue;
    }

    if (prov === 'gemini' && budget.blocked && !isModelFree('gemini', options.modelOverride ?? cfg.geminiModel)) {
      attempts.push({ provider: 'gemini', model: cfg.geminiModel, ok: false, reason: 'Monthly budget cap reached' });
      continue;
    }

    try {
      let result: Omit<UnifiedModelResult, 'attempts'> | null = null;
      const chosenModel = options.modelOverride && activeProvider !== 'auto' ? options.modelOverride : undefined;

      if (prov === 'opencode_zen') {
        const key = getSecret('OPENCODE_API_KEY');
        const model = chosenModel ?? cfg.opencodeModel;
        if (!key) {
          attempts.push({ provider: prov, model, ok: false, reason: 'OPENCODE_API_KEY not configured' });
          continue;
        }
        result = await callOpenAiCompatibleProvider({
          provider: 'opencode_zen',
          baseUrl: OPENCODE_OPENAI_BASE,
          apiKey: key,
          model,
          messages,
          tools,
          fetchImpl,
        });
      } else if (prov === 'openrouter') {
        const key = getSecret('OPENROUTER_API_KEY');
        const model = chosenModel ?? cfg.openrouterModel;
        if (!key) {
          attempts.push({ provider: prov, model, ok: false, reason: 'OPENROUTER_API_KEY not configured' });
          continue;
        }
        result = await callOpenAiCompatibleProvider({
          provider: 'openrouter',
          baseUrl: OPENROUTER_OPENAI_BASE,
          apiKey: key,
          model,
          messages,
          tools,
          extraHeaders: {
            'HTTP-Referer': 'http://localhost:5173',
            'X-Title': 'Llamrei Jarvis OS',
          },
          fetchImpl,
        });
      } else if (prov === 'groq') {
        const key = getSecret('GROQ_API_KEY');
        const model = chosenModel ?? cfg.groqModel;
        if (!key) {
          attempts.push({ provider: prov, model, ok: false, reason: 'GROQ_API_KEY not configured' });
          continue;
        }
        result = await callOpenAiCompatibleProvider({
          provider: 'groq',
          baseUrl: GROQ_OPENAI_BASE,
          apiKey: key,
          model,
          messages,
          tools,
          fetchImpl,
        });
      } else if (prov === 'ollama') {
        const model = chosenModel ?? cfg.ollamaModel;
        result = await callOpenAiCompatibleProvider({
          provider: 'ollama',
          baseUrl: cfg.ollamaBaseUrl,
          apiKey: null,
          model,
          messages,
          tools,
          fetchImpl,
        });
      } else if (prov === 'gemini') {
        const key = getSecret('GEMINI_API_KEY');
        const model = chosenModel ?? cfg.geminiModel;
        if (!key) {
          attempts.push({ provider: prov, model, ok: false, reason: 'GEMINI_API_KEY not configured' });
          continue;
        }
        result = await callGeminiProvider({
          apiKey: key,
          model,
          messages,
          tools,
          fetchImpl,
        });
      } else if (prov === 'opencode_cli') {
        const model = chosenModel ?? cfg.opencodeModel;
        if (!options.cliRunner && process.env.LLAMREI_DISABLE_CLI_AI === '1') {
          attempts.push({ provider: prov, model, ok: false, reason: 'CLI AI disabled in env' });
          continue;
        }
        result = await callOpenCodeCliProvider({
          model,
          messages,
          cliRunner: options.cliRunner,
        });
      }

      if (result && (result.text || result.toolCalls.length > 0)) {
        attempts.push({ provider: prov, model: result.modelUsed, ok: true });
        recordAiUsage(prov, result.modelUsed, 'agent', result.promptTokens, result.completionTokens, result.isFreeTier);
        return { ...result, attempts };
      }
      attempts.push({ provider: prov, model: chosenModel ?? '-', ok: false, reason: 'Empty response' });
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
