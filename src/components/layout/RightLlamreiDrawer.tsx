import { Bot, History, Mic, Send, Settings2, Square, Volume2, VolumeX, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { aiProviderLabels } from '../../lib/ai-provider-options';
import { formatWibStamp } from '../../lib/calendar-time';
import { usePendingAction } from '../../lib/use-pending-action';
import { isVoiceRecognitionSupported, speakLlamreiReply, startVoiceDictation } from '../../lib/voice';
import type { AiProviderCatalogSummary, AiProviderId, ApprovalCard, AuditLogItem, ChatMessageItem } from '../../types/llamrei';
import { Control } from '../ui/Control';

export interface CopilotDraft {
  prompt: string;
}

interface Props {
  messages: ChatMessageItem[];
  auditLogs: AuditLogItem[];
  aiProviders?: AiProviderCatalogSummary;
  connectedAppsCount?: number;
  allowCloudContext: boolean;
  pendingContext: Record<string, unknown> | null;
  draft?: CopilotDraft | null;
  onDraftLoaded: () => void;
  onClearContext: () => void;
  onSendPrompt: (
    prompt: string,
    context?: Record<string, unknown> | null,
    aiOverride?: { providerOverride?: AiProviderId; modelOverride?: string },
  ) => Promise<void>;
  onApproveAudit: (auditId: string) => Promise<void>;
  onUndoAudit: (auditId: string) => Promise<void>;
  onOpenIntegrations: () => void;
  onClose: () => void;
}

const undoKinds = new Set(['revert_scheduled_message', 'delete_task', 'delete_created_event', 'restore_task_alarm', 'restore_schedule']);
const actionStatus: Record<string, string> = {
  pending_approval: 'Perlu persetujuan',
  executing: 'Sedang diproses',
  approved_executed: 'Dijalankan',
  rejected: 'Ditolak',
  undone: 'Dibatalkan',
  failed: 'Perlu diperiksa',
};

function canUndo(log?: AuditLogItem): boolean {
  if (!log?.undo_payload_json || log.status !== 'approved_executed') return false;
  try {
    return undoKinds.has(JSON.parse(log.undo_payload_json)?.kind);
  } catch {
    return false;
  }
}

function readApproval(raw: string | null): ApprovalCard | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    return typeof value?.auditId === 'string' && typeof value?.title === 'string' && typeof value?.summary === 'string'
      ? value as ApprovalCard : null;
  } catch {
    return null;
  }
}

function statusText(card: ApprovalCard): string {
  if (card.executionOutcome === 'unknown') return 'Hasil belum terkonfirmasi';
  if (card.executionOutcome === 'denied') return 'Eksekusi ditolak';
  if (card.status === 'failed') return 'Eksekusi gagal';
  return actionStatus[card.status] ?? 'Status belum diketahui';
}

export function RightLlamreiDrawer({
  messages, auditLogs, aiProviders, connectedAppsCount = 0, allowCloudContext,
  pendingContext, draft, onDraftLoaded, onClearContext, onSendPrompt, onApproveAudit, onUndoAudit,
  onOpenIntegrations, onClose,
}: Props) {
  const [input, setInput] = useState(() => draft?.prompt ?? '');
  const [view, setView] = useState<'chat' | 'audit'>('chat');
  const [configOpen, setConfigOpen] = useState(false);
  const [listening, setListening] = useState(false);
  const [ttsEnabled, setTtsEnabled] = useState(false);
  const [voiceNote, setVoiceNote] = useState('');
  const [providerOverride, setProviderOverride] = useState<AiProviderId>();
  const [modelOverride, setModelOverride] = useState('');
  const stopVoice = useRef<(() => void) | null>(null);
  const lastSpoken = useRef<string | null>(messages.at(-1)?.id ?? null);
  const scroller = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const send = usePendingAction();
  const audit = usePendingAction();
  const selectedProvider = providerOverride ?? aiProviders?.activeProvider ?? 'auto';
  const provider = aiProviders?.providers.find((item) => item.id === selectedProvider);
  const models = provider?.models ?? [];
  const selectedModel = modelOverride || provider?.selectedModel || '';
  const lastMessage = messages.at(-1);
  const assistantName = aiProviders?.assistantPersona === 'llamrei' ? 'LLAMREI' : 'JARVIS';

  useEffect(() => {
    if (!draft) return;
    setInput(draft.prompt);
    setView('chat');
    composer.current?.focus();
    onDraftLoaded();
  }, [draft, onDraftLoaded]);

  useEffect(() => {
    if (view === 'chat' && scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [lastMessage?.id, view, send.pending]);

  useEffect(() => {
    if (!ttsEnabled || lastMessage?.role !== 'assistant' || lastSpoken.current === lastMessage.id) return;
    lastSpoken.current = lastMessage.id;
    speakLlamreiReply(lastMessage.content);
  }, [ttsEnabled, lastMessage]);

  useEffect(() => () => {
    stopVoice.current?.();
    window.speechSynthesis?.cancel();
  }, []);

  async function submitPrompt() {
    const prompt = input.trim();
    if (!prompt) return;
    if (await send.run('prompt', () => onSendPrompt(prompt, pendingContext, {
      providerOverride: selectedProvider,
      modelOverride: selectedModel || undefined,
    }), 'Balasan belum diterima. Periksa percakapan sebelum mengirim ulang.')) {
      setInput((current) => current.trim() === prompt ? '' : current);
      if (pendingContext) onClearContext();
    }
  }

  function toggleMic() {
    if (listening) {
      stopVoice.current?.();
      return;
    }
    setVoiceNote('');
    setListening(true);
    try {
      stopVoice.current = startVoiceDictation((transcript) => setInput(transcript), setVoiceNote, () => {
        setListening(false);
        stopVoice.current = null;
        composer.current?.focus();
      });
    } catch {
      setListening(false);
      setVoiceNote('Dikte belum dapat dimulai.');
    }
  }

  function runAudit(id: string, action: (auditId: string) => Promise<void>) {
    void audit.run(id, () => action(id), 'Perubahan belum terkonfirmasi. Periksa riwayat aksi sebelum mengulangi.');
  }

  return (
    <aside aria-label={assistantName} className="flex h-full min-h-0 w-full flex-col border-l border-[var(--border-subtle)] bg-[var(--bg-panel)]">
      <header className="shrink-0 border-b border-[var(--border-subtle)] px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent)]"><Bot size={20} aria-hidden="true" /></span>
          <div className="min-w-0 flex-1">
            <h2 className="font-semibold">{assistantName}</h2>
            <p className="text-xs text-[var(--text-secondary)]">{allowCloudContext ? 'Akses konteks cloud diizinkan' : 'Konteks lokal'}</p>
          </div>
          <Control aria-label="Bacakan balasan" title="Bacakan balasan" aria-pressed={ttsEnabled} onClick={() => {
            if (ttsEnabled) window.speechSynthesis?.cancel();
            setTtsEnabled(!ttsEnabled);
          }}>{ttsEnabled ? <Volume2 aria-hidden="true" /> : <VolumeX aria-hidden="true" />}</Control>
          <Control aria-label="Tutup JARVIS" onClick={onClose}><X aria-hidden="true" /></Control>
        </div>
        <div className="mt-2 flex flex-wrap gap-1">
          <Control className="ds-segment" aria-pressed={view === 'chat'} onClick={() => setView('chat')}>Percakapan</Control>
          <Control className="ds-segment" aria-pressed={view === 'audit'} onClick={() => setView('audit')}><History aria-hidden="true" /> Riwayat aksi</Control>
          <Control aria-label="Pilihan model" aria-expanded={configOpen} title="Pilihan model" onClick={() => setConfigOpen(!configOpen)}><Settings2 aria-hidden="true" /></Control>
        </div>
        {configOpen && (
          <div className="mt-2 space-y-2 rounded-lg bg-[var(--bg-elevated)] p-3">
            <label className="ds-label">Penyedia
              <select className="ds-field" value={selectedProvider} onChange={(event) => {
                setProviderOverride(event.target.value as AiProviderId);
                setModelOverride('');
              }}>
                {Object.entries(aiProviderLabels).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
            </label>
            {models.length > 0 && (
              <label className="ds-label">Model
                <select className="ds-field" value={selectedModel} onChange={(event) => setModelOverride(event.target.value)}>
                  {selectedModel && !models.some(({ id }) => id === selectedModel) && <option value={selectedModel}>{selectedModel}</option>}
                  {models.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
                </select>
              </label>
            )}
            <Control className="ds-control--outline" onClick={onOpenIntegrations}>Integrasi ({connectedAppsCount})</Control>
          </div>
        )}
      </header>

      {audit.error && <p className="ds-note mx-3 mt-2" role="alert">{audit.error}</p>}
      <div ref={scroller} role="region" aria-label={view === 'audit' ? 'Riwayat aksi' : 'Pesan percakapan'} tabIndex={0} className="themed-scroll min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3 focus-visible:outline-offset-[-2px]">
        {view === 'audit' ? (
          <>
            {!auditLogs.length && <p className="py-4 text-sm text-[var(--text-secondary)]">Belum ada aksi.</p>}
            {auditLogs.map((log) => (
              <article key={log.id} className="themed-card space-y-2 p-3 [overflow-wrap:anywhere]">
                <div className="flex flex-wrap justify-between gap-1 text-xs text-[var(--text-secondary)]">
                  <span className="font-semibold">{actionStatus[log.status] ?? log.status}</span>
                  <time dateTime={log.created_at}>{formatWibStamp(log.created_at)}</time>
                </div>
                <p className="text-sm">{log.user_command}</p>
                <p className="text-xs text-[var(--text-muted)]">{log.tool_name}</p>
                {canUndo(log) && <Control className="ds-control--outline" disabled={!!audit.pending} onClick={() => runAudit(log.id, onUndoAudit)}>Batalkan aksi</Control>}
              </article>
            ))}
          </>
        ) : (
          <>
            {!messages.length && <p className="py-4 text-sm text-[var(--text-secondary)]">Belum ada percakapan.</p>}
            {messages.map((message) => {
              const card = readApproval(message.approval_card_json);
              const fromUser = message.role === 'user';
              return (
                <div key={message.id} className="space-y-2">
                  <article className={`space-y-1 rounded-lg px-3 py-2 [overflow-wrap:anywhere] ${fromUser ? 'ml-4 bg-[var(--accent-soft)]' : 'border border-[var(--border-subtle)] bg-[var(--bg-card)]'}`}>
                    <div className="flex flex-wrap items-baseline justify-between gap-x-2 text-xs text-[var(--text-muted)]">
                      <span className="font-semibold text-[var(--text-secondary)]">{fromUser ? 'Anda' : message.role === 'assistant' ? assistantName : 'Sistem'}</span>
                      {message.model_used && <span>{message.model_used}</span>}
                    </div>
                    <p className="whitespace-pre-wrap text-sm leading-relaxed">{message.content}</p>
                  </article>

                  {card && (
                    <section aria-label={card.title} className="themed-card space-y-2 p-3 [overflow-wrap:anywhere]">
                      <p className={`text-xs font-semibold ${card.status === 'pending_approval' ? 'text-[var(--warning)]' : 'text-[var(--text-secondary)]'}`}>{statusText(card)}</p>
                      <h3 className="text-sm font-semibold">{card.title}</h3>
                      <p className="whitespace-pre-wrap text-sm text-[var(--text-secondary)]">{card.summary}</p>
                      {card.executionNote && <p className="ds-note">{card.executionNote}</p>}
                      {card.status === 'pending_approval' && (
                        <Control className="ds-control--primary" disabled={!!audit.pending} onClick={() => runAudit(card.auditId, onApproveAudit)}>
                          {audit.pending === card.auditId ? 'Memproses…' : 'Setujui dan jalankan'}
                        </Control>
                      )}
                      {canUndo(auditLogs.find(({ id }) => id === card.auditId)) && (
                        <Control className="ds-control--outline" disabled={!!audit.pending} onClick={() => runAudit(card.auditId, onUndoAudit)}>Batalkan aksi</Control>
                      )}
                    </section>
                  )}
                </div>
              );
            })}
            {send.pending && <p role="status" className="text-sm text-[var(--text-secondary)]">Menunggu balasan…</p>}
          </>
        )}
      </div>

      {view === 'chat' && (
        <div className="shrink-0 space-y-2 border-t border-[var(--border-subtle)] p-3">
          {pendingContext && (
            <div className="flex items-center justify-between gap-2 rounded-lg bg-[var(--accent-soft)] pl-3 text-xs">
              <span className="min-w-0 truncate">Konteks: {String(pendingContext.title ?? pendingContext.event_name ?? 'Item terpilih')}</span>
              <Control aria-label="Lepas konteks" onClick={onClearContext}><X aria-hidden="true" /></Control>
            </div>
          )}
          {!input && !send.pending && (
            <div className="flex flex-wrap gap-1">
              <Control className="ds-control--outline" onClick={() => { setInput('Briefing pagi'); composer.current?.focus(); }}>Briefing pagi</Control>
              <Control className="ds-control--outline" onClick={() => { setInput('Auto schedule hari ini'); composer.current?.focus(); }}>Susun jadwal</Control>
            </div>
          )}
          {voiceNote && <p className="ds-note" role="status">{voiceNote}</p>}
          {send.error && <p className="ds-note" role="alert">{send.error}</p>}
          <form className="space-y-2" onSubmit={(event) => { event.preventDefault(); void submitPrompt(); }}>
            <textarea
              ref={composer}
              aria-label="Pesan ke asisten"
              className="ds-field min-h-16 resize-y"
              rows={2}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder={`Tanya ${assistantName}…`}
            />
            <div className="flex justify-between">
              <Control aria-label={listening ? 'Hentikan dikte' : 'Dikte pesan'} aria-pressed={listening} title="Dikte pesan" disabled={!isVoiceRecognitionSupported()} onClick={toggleMic}>
                {listening ? <Square aria-hidden="true" /> : <Mic aria-hidden="true" />}
              </Control>
              <Control type="submit" className="ds-control--primary" disabled={!input.trim() || !!send.pending}><Send aria-hidden="true" /> Kirim</Control>
            </div>
          </form>
        </div>
      )}
    </aside>
  );
}
