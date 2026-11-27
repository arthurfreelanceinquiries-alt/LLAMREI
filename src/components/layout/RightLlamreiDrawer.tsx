import { useEffect, useRef, useState } from 'react';
import { isVoiceRecognitionSupported, speakLlamreiReply, startVoiceDictation } from '../../lib/voice';
import type {
  AiProviderCatalogSummary,
  AiProviderId,
  ApprovalCard,
  AuditLogItem,
  ChatMessageItem,
} from '../../types/llamrei';

interface Props {
  messages: ChatMessageItem[];
  auditLogs: AuditLogItem[];
  aiProviders?: AiProviderCatalogSummary;
  connectedAppsCount?: number;
  pendingContext: Record<string, unknown> | null;
  onClearContext: () => void;
  onSendPrompt: (
    prompt: string,
    context?: Record<string, unknown> | null,
    aiOverride?: { providerOverride?: AiProviderId; modelOverride?: string },
  ) => Promise<void>;
  onApproveAudit: (auditId: string) => Promise<void>;
  onUndoAudit: (auditId: string) => Promise<void>;
  onOpenIntegrations?: () => void;
  onClose?: () => void;
}

function hasUndoAction(payload: string | null | undefined): boolean {
  if (!payload) return false;
  try {
    const { kind } = JSON.parse(payload) as { kind?: string };
    return ['revert_scheduled_message', 'delete_task', 'delete_created_event', 'restore_task_alarm', 'restore_schedule']
      .some((action) => action === kind);
  } catch {
    return false;
  }
}

export function RightLlamreiDrawer({
  messages,
  auditLogs,
  aiProviders,
  connectedAppsCount = 0,
  pendingContext,
  onClearContext,
  onSendPrompt,
  onApproveAudit,
  onUndoAudit,
  onOpenIntegrations,
  onClose,
}: Props) {
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [auditBusy, setAuditBusy] = useState<string | null>(null);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [showAudit, setShowAudit] = useState(false);
  const [listening, setListening] = useState(false);
  const [ttsEnabled, setTtsEnabled] = useState(false);
  const [voiceNote, setVoiceNote] = useState<string | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<AiProviderId>(aiProviders?.activeProvider ?? 'auto');
  const [selectedModel, setSelectedModel] = useState<string>('');
  const stopVoiceRef = useRef<(() => void) | null>(null);
  const lastSpokenIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (aiProviders?.activeProvider) {
      setSelectedProvider(aiProviders.activeProvider);
    }
  }, [aiProviders?.activeProvider]);

  const activeProviderMeta = aiProviders?.providers.find((p) => p.id === selectedProvider);
  const availableModels = activeProviderMeta?.models ?? [];

  useEffect(() => {
    if (activeProviderMeta) {
      setSelectedModel(activeProviderMeta.selectedModel);
    } else {
      setSelectedModel('');
    }
  }, [selectedProvider, activeProviderMeta?.selectedModel]);

  useEffect(() => {
    if (!ttsEnabled || messages.length === 0) return;
    const latest = messages[messages.length - 1];
    if (latest.role === 'assistant' && latest.id !== lastSpokenIdRef.current) {
      lastSpokenIdRef.current = latest.id;
      speakLlamreiReply(latest.content);
    }
  }, [messages, ttsEnabled]);

  const toggleMic = () => {
    if (listening) {
      stopVoiceRef.current?.();
      setListening(false);
      return;
    }
    setVoiceNote(null);
    setListening(true);
    stopVoiceRef.current = startVoiceDictation(
      (transcript) => {
        setInput(transcript);
        void submitPrompt(transcript);
      },
      (err) => setVoiceNote(err),
      () => setListening(false),
    );
  };

  const submitPrompt = async (text: string) => {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      await onSendPrompt(text.trim(), pendingContext, {
        providerOverride: selectedProvider,
        modelOverride: selectedModel || undefined,
      });
      setInput('');
      if (pendingContext) onClearContext();
    } finally {
      setBusy(false);
    }
  };

  const submitAudit = async (auditId: string, run: (id: string) => Promise<void>) => {
    if (auditBusy) return;
    setAuditBusy(auditId);
    setAuditError(null);
    try {
      await run(auditId);
    } catch {
      setAuditError('Status aksi berubah atau permintaan gagal. Muat ulang sebelum mencoba lagi.');
    } finally {
      setAuditBusy(null);
    }
  };

  const titleLabel =
    aiProviders?.assistantPersona === 'llamrei' ? 'LLAMREI // JARVIS OS' : 'JARVIS // LLAMREI CO-COMMANDER';

  return (
    <aside
      className="w-full lg:w-96 shrink-0 border-t lg:border-t-0 lg:border-l p-3 flex flex-col justify-between gap-2 max-h-[680px] lg:max-h-none"
      style={{ background: 'var(--bg-panel)', borderColor: 'var(--border-subtle)' }}
    >
      {/* Header */}
      <div className="flex items-center justify-between pb-2 border-b shrink-0" style={{ borderColor: 'var(--border-subtle)' }}>
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full animate-pulse" style={{ background: 'var(--accent)' }} />
          <div>
            <div className="text-xs font-mono-num font-bold">{titleLabel}</div>
            <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Multi-Provider Gratis · Memory & Approval Gate
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setTtsEnabled((v) => !v)}
            className="px-2 py-1 rounded text-xs font-mono-num border cursor-pointer"
            style={
              ttsEnabled
                ? { background: 'var(--accent-soft)', borderColor: 'var(--border-accent)', color: 'var(--accent)' }
                : { background: 'var(--bg-card)', borderColor: 'var(--border-subtle)', color: 'var(--text-muted)' }
            }
            title="Mode Suara Balasan Llamrei (FR-09)"
          >
            {ttsEnabled ? '🔊' : '🔇'}
          </button>
          <button
            onClick={() => setShowAudit((v) => !v)}
            className="px-2 py-1 rounded text-xs font-mono-num border cursor-pointer hover:bg-white/5"
            style={{ background: 'var(--bg-card)', borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
          >
            {showAudit ? '💬 Chat' : `📜 Audit (${auditLogs.length})`}
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="p-1 rounded text-xs hover:bg-white/10 transition cursor-pointer text-white/50 hover:text-white"
              title="Tutup Panel Copilot (⌘J)"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Compact Free Model & Composio Bar */}
      <div className="flex flex-wrap items-center gap-1.5 text-[11px] shrink-0">
        <select
          value={selectedProvider}
          onChange={(e) => setSelectedProvider(e.target.value as AiProviderId)}
          className="px-1.5 py-1 rounded border font-mono-num flex-1 min-w-[125px]"
          style={{ background: 'var(--bg-card)', borderColor: 'var(--border-subtle)', color: 'var(--accent)' }}
          title="Pilih provider AI (model gratis & fallback)"
        >
          <option value="auto">⚡ Auto Gratis</option>
          <option value="opencode_zen">🟢 OpenCode Zen</option>
          <option value="opencode_cli">💻 OpenCode CLI</option>
          <option value="openrouter">🌐 OpenRouter :free</option>
          <option value="groq">⚡ Groq Free</option>
          <option value="ollama">🏠 Ollama Lokal</option>
          <option value="gemini">✨ Gemini</option>
          <option value="local">🛡️ Rule Router</option>
        </select>

        {availableModels.length > 0 && (
          <select
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            className="px-1.5 py-1 rounded border font-mono-num flex-1 min-w-[120px] truncate"
            style={{ background: 'var(--bg-card)', borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
            title="Pilih model gratis aktif"
          >
            {availableModels.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        )}

        {onOpenIntegrations && (
          <button
            onClick={onOpenIntegrations}
            className="px-2 py-1 rounded border font-mono-num cursor-pointer hover:bg-white/5"
            style={{ background: 'var(--bg-card)', borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
            title="Kelola koneksi 150+ aplikasi via Composio"
          >
            🔌 {connectedAppsCount} Apps
          </button>
        )}
      </div>

      {auditError && <p className="text-xs text-rose-300" role="alert">{auditError}</p>}

      {/* Feed or Audit History */}
      {showAudit ? (
        <div className="flex-1 overflow-y-auto themed-scroll space-y-2 pr-1">
          {auditLogs.map((log) => (
            <div key={log.id} className="themed-card p-2.5 space-y-1 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-mono-num font-semibold" style={{ color: 'var(--accent)' }}>
                  {log.tool_name}
                </span>
                <span className="font-mono-num px-1.5 py-0.5 rounded bg-white/5">{log.status}</span>
              </div>
              <div style={{ color: 'var(--text-secondary)' }}>{log.user_command}</div>
              {log.status === 'approved_executed' && hasUndoAction(log.undo_payload_json) && (
                <button
                  disabled={auditBusy !== null}
                  onClick={() => void submitAudit(log.id, onUndoAudit)}
                  className="text-xs font-mono-num px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/30 cursor-pointer"
                >
                  ↶ Undo Aksi Ini
                </button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto themed-scroll space-y-2.5 pr-1">
          {messages.map((msg) => {
            const card: ApprovalCard | null = msg.approval_card_json
              ? (JSON.parse(msg.approval_card_json) as ApprovalCard)
              : null;

            return (
              <div key={msg.id} className="space-y-1.5">
                <div
                  className="themed-card p-2.5 text-xs space-y-1"
                  style={
                    msg.role === 'user'
                      ? { background: 'var(--bg-elevated)' }
                      : { borderColor: 'var(--border-accent)' }
                  }
                >
                  <div className="flex items-center justify-between font-mono-num" style={{ color: 'var(--text-muted)' }}>
                    <span style={{ color: msg.role === 'user' ? 'var(--accent-2)' : 'var(--accent)' }}>
                      {msg.role === 'user'
                        ? 'ARTHUR → JARVIS'
                        : aiProviders?.assistantPersona === 'llamrei'
                          ? 'LLAMREI'
                          : 'JARVIS // LLAMREI'}
                    </span>
                    {msg.model_used && <span className="truncate max-w-[180px]">{msg.model_used}</span>}
                  </div>
                  <div className="whitespace-pre-wrap leading-relaxed" style={{ color: 'var(--text-primary)' }}>
                    {msg.content}
                  </div>
                </div>

                {card && (
                  <div
                    className="rounded-lg p-2.5 border space-y-2 text-xs"
                    style={{
                      background: 'var(--bg-card)',
                      borderColor:
                        card.status === 'pending_approval'
                          ? 'rgba(245, 158, 11, 0.55)'
                          : card.status === 'approved_executed'
                            ? 'var(--border-accent)'
                            : 'var(--border-subtle)',
                    }}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-x-2 font-mono-num">
                      <span
                        className="font-bold"
                        style={{
                          color:
                            card.status === 'pending_approval'
                              ? '#fbbf24'
                              : card.status === 'approved_executed'
                                ? 'var(--accent)'
                                : '#f87171',
                        }}
                      >
                        {card.status === 'pending_approval'
                          ? '⚠ MENUNGGU APPROVAL'
                          : card.status === 'approved_executed'
                            ? '✓ APPROVED & DIEKSEKUSI'
                            : card.status === 'failed'
                              ? card.executionOutcome === 'unknown'
                                ? 'HASIL TIDAK TERKONFIRMASI'
                                : card.executionOutcome === 'denied'
                                  ? 'EKSEKUSI DITOLAK'
                                  : 'EKSEKUSI GAGAL'
                              : card.status === 'rejected'
                                ? 'DITOLAK'
                                : '↶ UNDONE'}
                      </span>
                      <span style={{ color: 'var(--text-muted)' }}>{card.toolName}</span>
                    </div>
                    <div className="font-semibold">{card.title}</div>
                    <div className="whitespace-pre-wrap break-words" style={{ color: 'var(--text-secondary)' }}>
                      {card.summary}
                    </div>
                    {card.executionNote && <p role="status">{card.executionNote}</p>}
                    <div className="flex items-center gap-2 pt-1">
                      {card.status === 'pending_approval' && (
                        <button
                          disabled={auditBusy !== null}
                          onClick={() => void submitAudit(card.auditId, onApproveAudit)}
                          className="flex-1 py-1.5 px-2.5 rounded font-mono-num font-bold text-xs cursor-pointer"
                          style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
                        >
                          ✓ Approve & Jalankan
                        </button>
                      )}
                      {card.status === 'approved_executed' && hasUndoAction(auditLogs.find(({ id }) => id === card.auditId)?.undo_payload_json) && (
                        <button
                          disabled={auditBusy !== null}
                          onClick={() => void submitAudit(card.auditId, onUndoAudit)}
                          className="py-1 px-2.5 rounded font-mono-num text-xs bg-rose-500/20 text-rose-300 border border-rose-500/30 cursor-pointer"
                        >
                          ↶ Undo
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Context Pill + Quick Commands + Prompt Form */}
      <div className="pt-2 border-t space-y-2 shrink-0" style={{ borderColor: 'var(--border-subtle)' }}>
        {pendingContext && (
          <div
            className="px-2 py-1 rounded text-xs flex items-center justify-between border"
            style={{ background: 'var(--accent-soft)', borderColor: 'var(--border-accent)' }}
          >
            <span className="truncate">
              📌 Konteks: {String(pendingContext.title ?? pendingContext.event_name ?? 'Item')}
            </span>
            <button onClick={onClearContext} className="ml-2 text-xs font-bold cursor-pointer">
              ✕
            </button>
          </div>
        )}

        <div className="flex gap-1 overflow-x-auto pb-0.5">
          {[
            'Briefing pagi',
            'Jadwalkan chat ke kontak saya jam 19:00 soal slide',
            'Auto schedule hari ini',
            'Pasang alarm jam 20:00 evaluasi market',
          ].map((preset) => (
            <button
              key={preset}
              onClick={() => void submitPrompt(preset)}
              className="shrink-0 px-2 py-1 rounded text-xs border cursor-pointer"
              style={{ background: 'var(--bg-card)', borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
            >
              ⚡ {preset.slice(0, 26)}
            </button>
          ))}
        </div>

        {voiceNote && <div className="text-xs text-amber-300 font-mono-num">{voiceNote}</div>}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submitPrompt(input);
          }}
          className="flex gap-1.5"
        >
          <button
            type="button"
            onClick={toggleMic}
            title={isVoiceRecognitionSupported() ? 'Perintah Suara (id-ID)' : 'Voice Mode (Web Speech API)'}
            className="px-2.5 py-1.5 rounded text-xs font-mono-num border cursor-pointer"
            style={
              listening
                ? { background: '#ef4444', color: '#ffffff', borderColor: '#ef4444' }
                : { background: 'var(--bg-card)', borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }
            }
          >
            {listening ? '⏹' : '🎤'}
          </button>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={busy ? 'Llamrei memproses...' : 'Suruh Llamrei (tugas, alarm, chat)...'}
            className="flex-1 min-w-0 px-2.5 py-1.5 rounded text-xs border outline-none"
            style={{ background: 'var(--bg-void)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
          />
          <button
            type="submit"
            disabled={busy}
            className="px-3 py-1.5 rounded text-xs font-mono-num font-bold cursor-pointer disabled:opacity-50"
            style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
          >
            KIRIM
          </button>
        </form>
      </div>
    </aside>
  );
}
