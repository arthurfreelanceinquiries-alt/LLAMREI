import { Bot, KeyRound, Palette, RefreshCw, ShieldCheck, X } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { aiProviderLabels } from '../../lib/ai-provider-options';
import { usePendingAction } from '../../lib/use-pending-action';
import { THEME_META, useTheme } from '../../theme/ThemeContext';
import type { AiProviderCatalogSummary, AiProviderId, BootstrapPayload, ThemeId } from '../../types/llamrei';
import { Control } from '../ui/Control';
import { DialogPanel } from '../ui/DialogPanel';
import { ModelLatencyPanel } from './ModelLatencyPanel';

interface Props {
  open: boolean;
  onClose: () => void;
  settings: Record<string, unknown>;
  secretStatus: Record<string, { configured: boolean; masked: string | null }>;
  aiProviders?: AiProviderCatalogSummary;
  aiBudget: BootstrapPayload['aiBudget'];
  onSaveSettings: (patch: Record<string, unknown>) => Promise<void>;
  onSaveSecret: (key: string, value: string) => Promise<void>;
  onRefreshProviders?: () => Promise<void>;
}

const secretFields = {
  OPENCODE_API_KEY: 'OpenCode Zen',
  OPENROUTER_API_KEY: 'OpenRouter',
  GROQ_API_KEY: 'Groq',
  GEMINI_API_KEY: 'Google Gemini',
  COMPOSIO_API_KEY: 'Composio',
  NOTION_TOKEN: 'Notion',
  FINNHUB_API_KEY: 'Finnhub',
  WA_GATEWAY_WEBHOOK_URL: 'URL webhook WhatsApp',
  WA_GATEWAY_TOKEN: 'Token gateway WhatsApp',
  TELEGRAM_BOT_TOKEN: 'Token bot Telegram',
};

const sections = [
  { id: 'appearance', title: 'Tampilan', icon: Palette },
  { id: 'models', title: 'Asisten & biaya', icon: Bot },
  { id: 'privacy', title: 'Privasi', icon: ShieldCheck },
  { id: 'keys', title: 'Integrasi & kunci', icon: KeyRound },
] as const;

const modelFields = [
  { provider: 'opencode_zen', key: 'opencode_model', label: 'Model OpenCode' },
  { provider: 'openrouter', key: 'openrouter_model', label: 'Model OpenRouter' },
  { provider: 'ollama', key: 'ollama_model', label: 'Model Ollama' },
  { provider: 'groq', key: 'groq_model', label: 'Model Groq' },
  { provider: 'gemini', key: 'ai_model', label: 'Model Gemini' },
] as const;

function initialPreferences(settings: Props['settings'], theme: ThemeId) {
  const read = (key: string, fallback: string) => typeof settings[key] === 'string' ? settings[key] : fallback;
  const provider = String(read('ai_provider', 'auto'));
  return {
    theme,
    assistant_persona: settings.assistant_persona === 'llamrei' ? 'llamrei' : 'jarvis',
    ai_provider: Object.hasOwn(aiProviderLabels, provider) ? provider as AiProviderId : 'auto',
    opencode_model: String(read('opencode_model', 'big-pickle')),
    openrouter_model: String(read('openrouter_model', 'meta-llama/llama-3.3-70b-instruct:free')),
    groq_model: String(read('groq_model', 'llama-3.3-70b-versatile')),
    ollama_model: String(read('ollama_model', 'qwen2.5:7b')),
    ollama_base_url: String(read('ollama_base_url', 'http://127.0.0.1:11434/v1')),
    ai_model: String(read('ai_model', 'gemini-2.5-flash')),
    ai_monthly_budget_usd: String(settings.ai_monthly_budget_usd ?? 10),
    allow_opencode_cli_fallback: settings.allow_opencode_cli_fallback === true,
    paid_billing_verified: settings.paid_billing_verified === true,
    ai_allow_cloud_chat_context: settings.ai_allow_cloud_chat_context === true,
    notion_database_id: String(read('notion_database_id', '')),
    composio_user_id: String(read('composio_user_id', 'llamrei_local')),
  };
}

const usd = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'USD', maximumFractionDigits: 4 });

export function SettingsModal({
  open, onClose, settings, secretStatus, aiProviders, aiBudget, onSaveSettings, onSaveSecret, onRefreshProviders,
}: Props) {
  const { theme, setTheme } = useTheme();
  const [section, setSection] = useState<(typeof sections)[number]['id']>('appearance');
  const [draft, setDraft] = useState(() => initialPreferences(settings, theme));
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState('');
  const [validation, setValidation] = useState('');
  const action = usePendingAction();
  if (!open) return null;

  function update<K extends keyof typeof draft>(key: K, value: (typeof draft)[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    setNotice('');
    setValidation('');
  }

  async function saveSettings(event: FormEvent) {
    event.preventDefault();
    const budget = draft.ai_monthly_budget_usd.trim() ? Number(draft.ai_monthly_budget_usd) : NaN;
    if (!Number.isFinite(budget) || budget < 0) {
      setSection('models');
      setValidation('Masukkan anggaran bulanan mulai dari USD 0.');
      return;
    }
    setNotice('');
    const next = {
      ...draft,
      ai_monthly_budget_usd: budget,
      notion_database_id: draft.notion_database_id.trim(),
      composio_user_id: draft.composio_user_id.trim() || 'llamrei_local',
      ollama_base_url: draft.ollama_base_url.trim() || 'http://127.0.0.1:11434/v1',
    };
    for (const { key } of modelFields) next[key] = draft[key].trim() || initialPreferences({}, theme)[key];

    if (await action.run('settings', () => onSaveSettings(next), 'Pengaturan belum dapat disimpan. Periksa koneksi dan coba lagi.')) {
      setTheme(draft.theme);
      setNotice('Pengaturan tersimpan.');
    }
  }

  async function saveSecrets() {
    setNotice('');
    if (await action.run('secrets', async () => {
      for (const [key, value] of Object.entries(secrets)) {
        if (!value.trim()) continue;
        await onSaveSecret(key, value.trim());
        setSecrets((current) => ({ ...current, [key]: '' }));
      }
    }, 'Sebagian kunci mungkin sudah tersimpan. Periksa status dan simpan kembali kolom yang masih terisi.')) {
      setNotice('Kunci yang diisi sudah tersimpan.');
    }
  }

  async function refreshModels() {
    if (!onRefreshProviders) return;
    setNotice('');
    if (await action.run('catalog', onRefreshProviders, 'Katalog penyedia belum dapat diperbarui.')) {
      setNotice('Pemeriksaan katalog selesai.');
    }
  }

  return (
    <DialogPanel label="Pengaturan" className="workspace-settings-dialog" onClose={() => { if (!action.pending) onClose(); }}>
      <header className="sticky top-0 z-10 space-y-2 border-b border-[var(--border-subtle)] bg-[var(--bg-panel)] px-3 py-2 sm:px-5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">Pengaturan</h2>
          <Control disabled={!!action.pending} aria-label="Tutup pengaturan" onClick={onClose}><X aria-hidden="true" /></Control>
        </div>
        <div role="group" aria-label="Bagian pengaturan" className="flex flex-wrap gap-1">
          {sections.map(({ id, title, icon: Icon }) => (
            <Control key={id} className="ds-segment" aria-pressed={section === id} disabled={!!action.pending} onClick={() => {
              setSection(id);
              setNotice('');
              setValidation('');
            }}><Icon aria-hidden="true" /> {title}</Control>
          ))}
        </div>
      </header>

      <form onSubmit={(event) => void saveSettings(event)}>
        <fieldset disabled={!!action.pending} className="min-w-0 space-y-4 p-3 sm:p-5">
          {section === 'appearance' && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold">Tema antarmuka</h3>
              <div role="group" aria-label="Tema antarmuka" className="grid gap-2 sm:grid-cols-2">
                {(Object.keys(THEME_META) as ThemeId[]).map((id) => (
                  <button
                    type="button" key={id} aria-pressed={draft.theme === id} onClick={() => update('theme', id)}
                    className="themed-card min-h-14 space-y-1 p-3 text-left hover:bg-[var(--bg-elevated)] aria-pressed:border-[var(--border-accent)] aria-pressed:bg-[var(--accent-soft)]"
                  >
                    <span className="block text-sm font-semibold">{THEME_META[id].label}</span>
                    <span className="block text-xs text-[var(--text-secondary)]">{THEME_META[id].tagline}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {section === 'models' && (
            <>
              <div className="themed-card grid gap-3 p-3 sm:grid-cols-3">
                <div><p className="text-xs text-[var(--text-secondary)]">Biaya dilaporkan</p><p className="font-semibold">{usd.format(aiBudget.actualSpentUsd ?? 0)}</p></div>
                <div><p className="text-xs text-[var(--text-secondary)]">Estimasi historis</p><p className="font-semibold">{usd.format(aiBudget.estimatedSpentUsd ?? 0)}</p></div>
                <div><p className="text-xs text-[var(--text-secondary)]">Batas tersimpan</p><p className="font-semibold">{usd.format(aiBudget.monthlyCapUsd)}</p></div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-[var(--text-secondary)]">Eksekusi cloud memerlukan biaya nol yang terverifikasi.</p>
                {onRefreshProviders && <Control className="ds-control--outline" onClick={() => void refreshModels()}><RefreshCw aria-hidden="true" /> {action.pending === 'catalog' ? 'Memeriksa…' : 'Periksa katalog'}</Control>}
              </div>
              <ModelLatencyPanel />
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="ds-label">Identitas asisten
                  <select className="ds-field" value={draft.assistant_persona} onChange={(event) => update('assistant_persona', event.target.value)}>
                    <option value="jarvis">JARVIS</option><option value="llamrei">LLAMREI</option>
                  </select>
                </label>
                <label className="ds-label">Penyedia utama
                  <select className="ds-field" value={draft.ai_provider} onChange={(event) => update('ai_provider', event.target.value as AiProviderId)}>
                    {Object.entries(aiProviderLabels).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                  </select>
                </label>
                {modelFields.map(({ provider, key, label }) => {
                  const models = aiProviders?.providers.find(({ id }) => id === provider)?.models ?? [];
                  return (
                    <label key={key} className="ds-label">{label}
                      <input className="ds-field" list={`settings-${key}`} value={draft[key]} onChange={(event) => update(key, event.target.value)} />
                      <datalist id={`settings-${key}`}>
                        {models.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
                      </datalist>
                    </label>
                  );
                })}
                <label className="ds-label">Alamat Ollama<input className="ds-field" type="url" value={draft.ollama_base_url} onChange={(event) => update('ollama_base_url', event.target.value)} /><span className="text-xs text-[var(--text-secondary)]">Gunakan alamat loopback dan model yang terpasang secara lokal.</span></label>
                <label className="ds-label">Anggaran AI bulanan (USD)<input className="ds-field" type="number" min="0" step="0.01" value={draft.ai_monthly_budget_usd} onChange={(event) => update('ai_monthly_budget_usd', event.target.value)} /></label>
              </div>
              <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={draft.allow_opencode_cli_fallback} onChange={(event) => update('allow_opencode_cli_fallback', event.target.checked)} /> Izinkan cadangan OpenCode CLI setelah harga terverifikasi</label>
            </>
          )}

          {section === 'privacy' && (
            <>
              <div className="themed-card space-y-2 p-3">
                <h3 className="text-sm font-semibold">Konteks percakapan</h3>
                <label className="flex min-h-11 items-center gap-2 text-sm">
                  <input type="checkbox" checked={draft.ai_allow_cloud_chat_context} onChange={(event) => update('ai_allow_cloud_chat_context', event.target.checked)} />
                  Izinkan penyedia cloud memproses konteks
                </label>
                <p className="text-sm text-[var(--text-secondary)]">Izin ini mencakup percakapan, riwayat, lampiran, dan hasil alat. Llamrei mencoba menyamarkan nomor telepon, email, dan kode verifikasi yang terdeteksi.</p>
              </div>
              <div className="themed-card space-y-2 p-3">
                <h3 className="text-sm font-semibold">Penagihan penyedia</h3>
                <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={draft.paid_billing_verified} onChange={(event) => update('paid_billing_verified', event.target.checked)} /> Saya sudah memeriksa pengaturan tagihan penyedia AI</label>
                <p className="text-sm text-[var(--text-secondary)]">Konfirmasi penagihan dan izin konteks cloud disimpan secara terpisah.</p>
              </div>
            </>
          )}

          {section === 'keys' && (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="ds-label">ID database Notion<input className="ds-field" value={draft.notion_database_id} onChange={(event) => update('notion_database_id', event.target.value)} /></label>
                <label className="ds-label">ID pengguna Composio<input className="ds-field" value={draft.composio_user_id} onChange={(event) => update('composio_user_id', event.target.value)} /></label>
              </div>
              <div className="border-t border-[var(--border-subtle)] pt-3">
                <h3 className="text-sm font-semibold">Kunci akses</h3>
                <p className="mt-1 text-sm text-[var(--text-secondary)]">Isi hanya kunci yang ingin diperbarui. Nilainya disimpan di penyimpanan rahasia lokal.</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {Object.entries(secretFields).map(([key, label]) => (
                  <label className="ds-label" key={key}>
                    <span className="flex flex-wrap items-center justify-between gap-1">{label}
                      <span className="text-xs font-normal text-[var(--text-muted)]">{secretStatus[key]?.configured ? 'Terkonfigurasi' : 'Belum diatur'}</span>
                    </span>
                    <input className="ds-field" type="password" autoComplete="new-password" value={secrets[key] ?? ''} onChange={(event) => {
                      setSecrets((current) => ({ ...current, [key]: event.target.value }));
                      setNotice('');
                    }} />
                  </label>
                ))}
              </div>
              <Control className="ds-control--outline" disabled={!Object.values(secrets).some((value) => value.trim())} onClick={() => void saveSecrets()}>
                {action.pending === 'secrets' ? 'Menyimpan kunci…' : 'Simpan kunci yang diisi'}
              </Control>
            </>
          )}
        </fieldset>
        <footer className="sticky bottom-0 space-y-2 border-t border-[var(--border-subtle)] bg-[var(--bg-panel)] px-3 py-2 sm:px-5">
          {(validation || action.error) && <p role="alert" className="ds-note">{validation || action.error}</p>}
          {notice && <p role="status" className="text-sm text-[var(--success)]">{notice}</p>}
          <div className="flex flex-wrap justify-end gap-2">
            <Control disabled={!!action.pending} onClick={onClose}>Tutup</Control>
            <Control type="submit" className="ds-control--primary" disabled={!!action.pending}>{action.pending === 'settings' ? 'Menyimpan…' : 'Simpan pengaturan'}</Control>
          </div>
        </footer>
      </form>
    </DialogPanel>
  );
}
