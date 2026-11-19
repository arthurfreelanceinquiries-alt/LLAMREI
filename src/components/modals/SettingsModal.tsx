import { useState } from 'react';
import { THEME_META, useTheme } from '../../theme/ThemeContext';
import type { ThemeId } from '../../types/llamrei';

interface Props {
  open: boolean;
  onClose: () => void;
  settings: Record<string, unknown>;
  secretStatus: Record<string, { configured: boolean; masked: string | null }>;
  onSaveSettings: (patch: Record<string, unknown>) => Promise<void>;
  onSaveSecret: (key: string, value: string) => Promise<void>;
}

const SECRET_FIELDS = [
  { key: 'GEMINI_API_KEY', label: 'Google Gemini API Key (Otak Llamrei)', placeholder: 'AIza...' },
  { key: 'NOTION_TOKEN', label: 'Notion Integration Token (Kalender)', placeholder: 'secret_...' },
  { key: 'FINNHUB_API_KEY', label: 'Finnhub API Key (Berita & Forex)', placeholder: 'finnhub token...' },
  { key: 'WA_GATEWAY_WEBHOOK_URL', label: 'Approved WA Gateway Webhook URL (Opsional)', placeholder: 'https://...' },
  { key: 'TELEGRAM_BOT_TOKEN', label: 'Telegram Bot Token (Opsional)', placeholder: '123456:ABC...' },
];

export function SettingsModal({ open, onClose, settings, secretStatus, onSaveSettings, onSaveSecret }: Props) {
  const { theme, setTheme } = useTheme();
  const [aiModel, setAiModel] = useState(String(settings.ai_model ?? 'gemini-2.5-flash'));
  const [budgetCap, setBudgetCap] = useState(String(settings.ai_monthly_budget_usd ?? 10));
  const [notionDbId, setNotionDbId] = useState(String(settings.notion_database_id ?? ''));
  const [paidBilling, setPaidBilling] = useState(Boolean(settings.paid_billing_verified));
  const [secretInputs, setSecretInputs] = useState<Record<string, string>>({});
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  if (!open) return null;

  const handleSaveAll = async () => {
    await onSaveSettings({
      theme,
      ai_model: aiModel,
      ai_monthly_budget_usd: Number(budgetCap) || 10,
      notion_database_id: notionDbId.trim(),
      paid_billing_verified: paidBilling,
    });
    for (const [k, v] of Object.entries(secretInputs)) {
      if (v.trim()) {
        await onSaveSecret(k, v.trim());
      }
    }
    setSecretInputs({});
    setStatusMsg('Pengaturan & kunci aman tersimpan (libsecret / AES-256 vault).');
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="w-full max-w-2xl rounded-xl border p-5 space-y-4 max-h-[88vh] overflow-y-auto themed-scroll"
        style={{ background: 'var(--bg-panel)', borderColor: 'var(--border-subtle)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b pb-2" style={{ borderColor: 'var(--border-subtle)' }}>
          <h2 className="text-base font-bold">⚙️ Pengaturan Llamrei & Penyimpanan Kunci Aman</h2>
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

        {/* AI Model & Budget */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          <label className="space-y-1 block">
            <span className="font-semibold">Model Gemini Aktif</span>
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
            <span className="font-semibold">Hard Cap Anggaran AI Bulanan (USD)</span>
            <input
              type="number"
              step="1"
              value={budgetCap}
              onChange={(e) => setBudgetCap(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded border"
              style={{ background: 'var(--bg-card)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
            />
          </label>
        </div>

        <label className="flex items-center gap-2 text-xs cursor-pointer">
          <input type="checkbox" checked={paidBilling} onChange={(e) => setPaidBilling(e.target.checked)} />
          <span>Proyek Gemini API memakai penagihan aktif (wajib sebelum mengirim potongan chat WA ke AI)</span>
        </label>

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
