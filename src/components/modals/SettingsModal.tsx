import { useState } from 'react';
import { THEME_META, useTheme } from '../../theme/ThemeContext';
import type { AiProviderCatalogSummary, AiProviderId, ThemeId } from '../../types/llamrei';

interface Props {
  open: boolean;
  onClose: () => void;
  settings: Record<string, unknown>;
  secretStatus: Record<string, { configured: boolean; masked: string | null }>;
  aiProviders?: AiProviderCatalogSummary;
  onSaveSettings: (patch: Record<string, unknown>) => Promise<void>;
  onSaveSecret: (key: string, value: string) => Promise<void>;
  onRefreshProviders?: () => Promise<void>;
}

const SECRET_FIELDS = [
  { key: 'OPENCODE_API_KEY', label: 'OpenCode Zen API Key (Model Gratis OpenCode)', placeholder: 'sk-...' },
  { key: 'OPENROUTER_API_KEY', label: 'OpenRouter API Key (Model :free Pool)', placeholder: 'sk-or-v1-...' },
  { key: 'GROQ_API_KEY', label: 'Groq API Key (LPU Cepat Gratis)', placeholder: 'gsk_...' },
  { key: 'COMPOSIO_API_KEY', label: 'Composio API Key (150+ App Integrations)', placeholder: 'ak_...' },
  { key: 'GEMINI_API_KEY', label: 'Google Gemini API Key (AI Studio)', placeholder: 'AIza...' },
  { key: 'NOTION_TOKEN', label: 'Notion Integration Token (Kalender)', placeholder: 'secret_...' },
  { key: 'FINNHUB_API_KEY', label: 'Finnhub API Key (Berita & Forex)', placeholder: 'finnhub token...' },
  { key: 'WA_GATEWAY_WEBHOOK_URL', label: 'Approved WA Gateway Webhook URL (Opsional)', placeholder: 'https://...' },
  { key: 'TELEGRAM_BOT_TOKEN', label: 'Telegram Bot Token (Opsional)', placeholder: '123456:ABC...' },
];

export function SettingsModal({
  open,
  onClose,
  settings,
  secretStatus,
  aiProviders,
  onSaveSettings,
  onSaveSecret,
  onRefreshProviders,
}: Props) {
  const { theme, setTheme } = useTheme();
  const [persona, setPersona] = useState<'jarvis' | 'llamrei'>(
    settings.assistant_persona === 'llamrei' ? 'llamrei' : 'jarvis',
  );
  const [aiProvider, setAiProvider] = useState<AiProviderId>(
    (settings.ai_provider as AiProviderId) ?? 'auto',
  );
  const [opencodeModel, setOpencodeModel] = useState(String(settings.opencode_model ?? 'big-pickle'));
  const [openrouterModel, setOpenrouterModel] = useState(
    String(settings.openrouter_model ?? 'meta-llama/llama-3.3-70b-instruct:free'),
  );
  const [groqModel, setGroqModel] = useState(String(settings.groq_model ?? 'llama-3.3-70b-versatile'));
  const [ollamaBaseUrl, setOllamaBaseUrl] = useState(String(settings.ollama_base_url ?? 'http://127.0.0.1:11434/v1'));
  const [ollamaModel, setOllamaModel] = useState(String(settings.ollama_model ?? 'qwen2.5:7b'));
  const [aiModel, setAiModel] = useState(String(settings.ai_model ?? 'gemini-2.5-flash'));
  const [allowCliFallback, setAllowCliFallback] = useState(Boolean(settings.allow_opencode_cli_fallback));
  const [budgetCap, setBudgetCap] = useState(String(settings.ai_monthly_budget_usd ?? 10));
  const [notionDbId, setNotionDbId] = useState(String(settings.notion_database_id ?? ''));
  const [composioUserId, setComposioUserId] = useState(String(settings.composio_user_id ?? 'arthur_reezan'));
  const [paidBilling, setPaidBilling] = useState(Boolean(settings.paid_billing_verified));
  const [secretInputs, setSecretInputs] = useState<Record<string, string>>({});
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [refreshingModels, setRefreshingModels] = useState(false);

  if (!open) return null;

  const opencodeModels = aiProviders?.providers.find((p) => p.id === 'opencode_zen')?.models ?? [];
  const openrouterModels = aiProviders?.providers.find((p) => p.id === 'openrouter')?.models ?? [];
  const groqModels = aiProviders?.providers.find((p) => p.id === 'groq')?.models ?? [];
  const ollamaModels = aiProviders?.providers.find((p) => p.id === 'ollama')?.models ?? [];

  const handleSaveAll = async () => {
    await onSaveSettings({
      theme,
      assistant_persona: persona,
      ai_provider: aiProvider,
      opencode_model: opencodeModel.trim() || 'big-pickle',
      openrouter_model: openrouterModel.trim() || 'meta-llama/llama-3.3-70b-instruct:free',
      groq_model: groqModel.trim() || 'llama-3.3-70b-versatile',
      ollama_base_url: ollamaBaseUrl.trim() || 'http://127.0.0.1:11434/v1',
      ollama_model: ollamaModel.trim() || 'qwen2.5:7b',
      ai_model: aiModel,
      allow_opencode_cli_fallback: allowCliFallback,
      ai_monthly_budget_usd: Number(budgetCap) || 10,
      notion_database_id: notionDbId.trim(),
      composio_user_id: composioUserId.trim() || 'arthur_reezan',
      paid_billing_verified: paidBilling,
    });
    for (const [k, v] of Object.entries(secretInputs)) {
      if (v.trim()) {
        await onSaveSecret(k, v.trim());
      }
    }
    setSecretInputs({});
    setStatusMsg('Pengaturan Jarvis/Llamrei & kunci aman tersimpan (libsecret / AES-256 vault).');
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="w-full max-w-2xl rounded-xl border p-5 space-y-4 max-h-[88vh] overflow-y-auto themed-scroll"
        style={{ background: 'var(--bg-panel)', borderColor: 'var(--border-subtle)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b pb-2" style={{ borderColor: 'var(--border-subtle)' }}>
          <h2 className="text-base font-bold">⚙️ Pengaturan Jarvis × Llamrei, Model Gratis & Composio</h2>
          <button onClick={onClose} className="px-2 py-1 rounded text-xs bg-white/5 cursor-pointer">
            Tutup
          </button>
        </div>

        {/* Theme Switcher */}
        <div className="space-y-1.5">
          <div className="text-xs font-semibold">Tema Antarmuka (4 Pilihan)</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {(Object.keys(THEME_META) as ThemeId[]).map((id) => (
              <button
                key={id}
                onClick={() => setTheme(id)}
                className="text-left p-2.5 rounded-lg border text-xs cursor-pointer"
                style={
                  theme === id
                    ? { background: 'var(--accent-soft)', borderColor: 'var(--border-accent)', color: 'var(--accent)' }
                    : { background: 'var(--bg-card)', borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }
                }
              >
                <div className="font-bold">{THEME_META[id].label}</div>
                <div style={{ color: 'var(--text-muted)' }}>{THEME_META[id].tagline}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Multi-Provider AI (Free Models & Auto Fallback) */}
        <div className="space-y-2.5 border-t pt-3 text-xs" style={{ borderColor: 'var(--border-subtle)' }}>
          <div className="flex items-center justify-between">
            <span className="font-bold" style={{ color: 'var(--accent)' }}>
              🤖 Otak Jarvis × Llamrei (Multi-Provider Model Gratis)
            </span>
            {onRefreshProviders && (
              <button
                onClick={async () => {
                  setRefreshingModels(true);
                  try {
                    await onRefreshProviders();
                  } finally {
                    setRefreshingModels(false);
                  }
                }}
                className="px-2 py-0.5 rounded border font-mono-num cursor-pointer"
                style={{ background: 'var(--bg-card)', borderColor: 'var(--border-subtle)', color: 'var(--accent)' }}
              >
                {refreshingModels ? 'Memuat...' : '↻ Refresh Katalog Gratis'}
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="space-y-1 block">
              <span className="font-semibold">Identitas Co-Commander</span>
              <select
                value={persona}
                onChange={(e) => setPersona(e.target.value === 'llamrei' ? 'llamrei' : 'jarvis')}
                className="w-full px-2.5 py-1.5 rounded border"
                style={{ background: 'var(--bg-card)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
              >
                <option value="jarvis">JARVIS (Co-Commander LLAMREI)</option>
                <option value="llamrei">LLAMREI (Co-Commander)</option>
              </select>
            </label>

            <label className="space-y-1 block">
              <span className="font-semibold">Provider AI Utama</span>
              <select
                value={aiProvider}
                onChange={(e) => setAiProvider(e.target.value as AiProviderId)}
                className="w-full px-2.5 py-1.5 rounded border"
                style={{ background: 'var(--bg-card)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
              >
                <option value="auto">⚡ Auto-Fallback Gratis (OpenCode → OpenRouter → Groq → Ollama → Gemini)</option>
                <option value="opencode_zen">🟢 OpenCode Zen (Free Models API)</option>
                <option value="opencode_cli">💻 OpenCode CLI Lokal ({aiProviders?.opencodeCliAvailable ? 'Terdeteksi' : 'Belum di PATH'})</option>
                <option value="openrouter">🌐 OpenRouter (:free Models)</option>
                <option value="groq">⚡ Groq LPU (Free Fast Tier)</option>
                <option value="ollama">🏠 Ollama Lokal (Offline 100% Gratis)</option>
                <option value="gemini">✨ Google Gemini (AI Studio)</option>
                <option value="local">🛡️ Offline Deterministic Router (Tanpa LLM)</option>
              </select>
            </label>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="space-y-1 block">
              <span className="font-semibold">Model OpenCode Free</span>
              <select
                value={opencodeModel}
                onChange={(e) => setOpencodeModel(e.target.value)}
                className="w-full px-2.5 py-1.5 rounded border"
                style={{ background: 'var(--bg-card)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
              >
                {(opencodeModels.length > 0
                  ? opencodeModels
                  : [
                      { id: 'big-pickle', name: 'Big Pickle (Free)' },
                      { id: 'deepseek-v4.1-flash-free', name: 'DeepSeek V4.1 Flash Free' },
                      { id: 'mimo-v2.6-flash-free', name: 'MiMo-V2.6-Flash Free' },
                      { id: 'seaglass-alpha-free', name: 'Seaglass Alpha Free' },
                    ]
                ).map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-1 block">
              <span className="font-semibold">Model OpenRouter (:free)</span>
              <select
                value={openrouterModel}
                onChange={(e) => setOpenrouterModel(e.target.value)}
                className="w-full px-2.5 py-1.5 rounded border"
                style={{ background: 'var(--bg-card)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
              >
                {(openrouterModels.length > 0
                  ? openrouterModels
                  : [
                      { id: 'meta-llama/llama-3.3-70b-instruct:free', name: 'Llama 3.3 70B (:free)' },
                      { id: 'qwen/qwen3-coder:free', name: 'Qwen3 Coder (:free)' },
                    ]
                ).map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-1 block">
              <span className="font-semibold">Model Groq Free</span>
              <select
                value={groqModel}
                onChange={(e) => setGroqModel(e.target.value)}
                className="w-full px-2.5 py-1.5 rounded border"
                style={{ background: 'var(--bg-card)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
              >
                {(groqModels.length > 0
                  ? groqModels
                  : [
                      { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B Versatile' },
                      { id: 'qwen/qwen3-32b', name: 'Qwen3 32B' },
                      { id: 'llama-3.1-8b-instant', name: 'Llama 3.1 8B Instant' },
                    ]
                ).map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-1 block">
              <span className="font-semibold">Model Ollama Lokal</span>
              <input
                value={ollamaModel}
                onChange={(e) => setOllamaModel(e.target.value)}
                list="ollama-models-list"
                className="w-full px-2.5 py-1.5 rounded border"
                style={{ background: 'var(--bg-card)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
              />
              <datalist id="ollama-models-list">
                {ollamaModels.map((m) => (
                  <option key={m.id} value={m.id} />
                ))}
              </datalist>
            </label>

            <label className="space-y-1 block">
              <span className="font-semibold">Ollama Base URL</span>
              <input
                value={ollamaBaseUrl}
                onChange={(e) => setOllamaBaseUrl(e.target.value)}
                className="w-full px-2.5 py-1.5 rounded border"
                style={{ background: 'var(--bg-card)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
              />
            </label>

            <label className="space-y-1 block">
              <span className="font-semibold">Model Gemini (Cadangan / Berbayar)</span>
              <select
                value={aiModel}
                onChange={(e) => setAiModel(e.target.value)}
                className="w-full px-2.5 py-1.5 rounded border"
                style={{ background: 'var(--bg-card)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
              >
                <option value="gemini-2.5-flash">gemini-2.5-flash (Cepat & Hemat)</option>
                <option value="gemini-2.5-pro">gemini-2.5-pro (Penalaran Kompleks)</option>
              </select>
            </label>

            <label className="space-y-1 block">
              <span className="font-semibold">Hard Cap Anggaran AI Berbayar (USD)</span>
              <input
                type="number"
                step="1"
                value={budgetCap}
                onChange={(e) => setBudgetCap(e.target.value)}
                className="w-full px-2.5 py-1.5 rounded border"
                style={{ background: 'var(--bg-card)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
              />
            </label>

            <label className="space-y-1 block">
              <span className="font-semibold">Composio User ID</span>
              <input
                value={composioUserId}
                onChange={(e) => setComposioUserId(e.target.value)}
                placeholder="arthur_reezan"
                className="w-full px-2.5 py-1.5 rounded border"
                style={{ background: 'var(--bg-card)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
              />
            </label>
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={allowCliFallback} onChange={(e) => setAllowCliFallback(e.target.checked)} />
            <span>Izinkan fallback ke OpenCode CLI lokal saat mode Auto jika API key belum diisi</span>
          </label>

          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={paidBilling} onChange={(e) => setPaidBilling(e.target.checked)} />
            <span>Izinkan kirim potongan konteks chat WA ke provider cloud (non-lokal)</span>
          </label>
        </div>

        {/* Notion DB ID */}
        <label className="space-y-1 block text-xs">
          <span className="font-semibold">Notion Calendar Database ID</span>
          <input
            value={notionDbId}
            onChange={(e) => setNotionDbId(e.target.value)}
            placeholder="Contoh: 1a2b3c4d..."
            className="w-full px-2.5 py-1.5 rounded border"
            style={{ background: 'var(--bg-card)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
          />
        </label>

        {/* Secure Keys */}
        <div className="space-y-2 border-t pt-3" style={{ borderColor: 'var(--border-subtle)' }}>
          <div className="text-xs font-semibold">API Keys (Disimpan di libsecret / AES-256 Vault, bukan SQLite)</div>
          {SECRET_FIELDS.map((f) => {
            const st = secretStatus[f.key];
            return (
              <div key={f.key} className="space-y-1 text-xs">
                <div className="flex items-center justify-between">
                  <span style={{ color: 'var(--text-secondary)' }}>{f.label}</span>
                  <span className="font-mono-num" style={{ color: st?.configured ? 'var(--accent)' : 'var(--text-muted)' }}>
                    {st?.configured ? `Configured (${st.masked})` : 'Belum diatur'}
                  </span>
                </div>
                <input
                  type="password"
                  value={secretInputs[f.key] ?? ''}
                  onChange={(e) => setSecretInputs((prev) => ({ ...prev, [f.key]: e.target.value }))}
                  placeholder={f.placeholder}
                  className="w-full px-2.5 py-1.5 rounded border"
                  style={{ background: 'var(--bg-void)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
                />
              </div>
            );
          })}
        </div>

        {statusMsg && (
          <div className="p-2 rounded text-xs font-mono-num" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
            {statusMsg}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded text-xs border cursor-pointer"
            style={{ background: 'var(--bg-card)', borderColor: 'var(--border-subtle)' }}
          >
            Batal
          </button>
          <button
            onClick={() => void handleSaveAll()}
            className="px-4 py-1.5 rounded text-xs font-bold cursor-pointer"
            style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
          >
            Simpan Pengaturan
          </button>
        </div>
      </div>
    </div>
  );
}
