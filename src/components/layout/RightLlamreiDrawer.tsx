import { Bot, History, Mic, Send, Settings2, Square, Volume2, VolumeX, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { MAX_AGENT_PROMPT_CHARS, type AgentProgress, type AgentSource } from '../../../shared/ai-protocol';
import { aiProviderLabels } from '../../lib/ai-provider-options';
import type { AgentReply, AgentRequest, AgentRequestControls } from '../../lib/agent-client';
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
  onClearContext: (expected?: Record<string, unknown>) => void;
  onSendPrompt: (request: AgentRequest, controls: AgentRequestControls) => Promise<AgentReply>;
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

function readSources(raw?: string | null): AgentSource[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((entry): entry is AgentSource =>
      typeof entry?.id === 'string' && /^S\d+$/.test(entry.id) && typeof entry.label === 'string',
    ) : [];
  } catch {
    return [];
  }
}

function stageLabel(stage: Extract<AgentProgress, { type: 'state' }>): string {
  if (stage.stage === 'tools') return `Membaca ${stage.label}…`;
  if (stage.stage === 'answering') return `Menyusun balasan · ${aiProviderLabels[stage.provider]}`;
  return 'Menyiapkan balasan…';
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
  const [pending, setPending] = useState<{ prompt: string; text: string; label: string }>();
  const [feedback, setFeedback] = useState<{ text: string; error?: boolean }>();
  const [retryPrompt, setRetryPrompt] = useState<{ prompt: string; requestId: string }>();
  const stopVoice = useRef<(() => void) | null>(null);
  const activeRequest = useRef<AbortController | null>(null);
  const lastSpoken = useRef<string | null>(messages.at(-1)?.id ?? null);
  const scroller = useRef<HTMLDivElement>(null);
  const followLatest = useRef(true);
  const composer = useRef<HTMLTextAreaElement>(null);
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
    setFeedback(undefined);
    setView('chat');
    composer.current?.focus();
    onDraftLoaded();
  }, [draft, onDraftLoaded]);

  useEffect(() => {
    if (view === 'chat' && scroller.current && followLatest.current) scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [lastMessage?.id, view, pending]);

  useEffect(() => {
    if (!ttsEnabled || lastMessage?.role !== 'assistant' || lastSpoken.current === lastMessage.id) return;
    lastSpoken.current = lastMessage.id;
    speakLlamreiReply(lastMessage.content);
  }, [ttsEnabled, lastMessage]);

  useEffect(() => () => {
    activeRequest.current?.abort();
    stopVoice.current?.();
    window.speechSynthesis?.cancel();
  }, []);

  async function submitPrompt() {
    const prompt = input.trim();
    if (!prompt || activeRequest.current) return;
    if (prompt.length > MAX_AGENT_PROMPT_CHARS) {
      setFeedback({ error: true, text: `Pesan dapat memuat hingga ${MAX_AGENT_PROMPT_CHARS} karakter.` });
      return;
    }
    const request = new AbortController();
    const requestId = retryPrompt?.prompt === prompt ? retryPrompt.requestId : crypto.randomUUID();
    activeRequest.current = request;
    followLatest.current = true;
    setFeedback(undefined);
    setPending({ prompt, text: '', label: 'Menyiapkan balasan…' });
    try {
      const result = await onSendPrompt({
        prompt, requestId, contextAttachment: pendingContext, providerOverride: selectedProvider, modelOverride: selectedModel || undefined,
      }, {
        signal: request.signal,
        onProgress(progress) {
          if (request.signal.aborted) return;
          setPending((current) => {
            if (!current) return current;
            return progress.type === 'delta'
              ? { ...current, text: current.text + progress.text }
              : { ...current, text: '', label: stageLabel(progress) };
          });
        },
      });
      setInput((current) => current.trim() === prompt ? '' : current);
      if (pendingContext) onClearContext(pendingContext);
      setRetryPrompt(undefined);
      if (result.providerUsed === 'local' && result.attempts.length) {
        setFeedback({ text: 'Balasan dibuat dalam mode lokal.' });
      }
    } catch (error) {
      setRetryPrompt({ prompt, requestId });
      setFeedback(request.signal.aborted
        ? { text: 'Balasan dihentikan. Pesan siap dikirim ulang.' }
        : { error: true, text: error instanceof Error && !(error instanceof TypeError || error instanceof SyntaxError)
            ? error.message : 'Balasan terhenti. Periksa koneksi dan coba lagi.' });
    } finally {
      activeRequest.current = null;
      setPending(undefined);
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
      <div ref={scroller} role="region" aria-label={view === 'audit' ? 'Riwayat aksi' : 'Pesan percakapan'} tabIndex={0}
        className="themed-scroll min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3 focus-visible:outline-offset-[-2px]"
        onScroll={(event) => {
          const { scrollHeight, scrollTop, clientHeight } = event.currentTarget;
          if (view === 'chat') followLatest.current = scrollHeight - scrollTop - clientHeight < 64;
        }}
      >
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
            {!messages.length && !pending && <p className="py-4 text-sm text-[var(--text-secondary)]">Belum ada percakapan.</p>}
            {messages.map((message) => {
              const card = readApproval(message.approval_card_json);
              const sources = readSources(message.source_refs_json);
              const fromUser = message.role === 'user';
              return (
                <div key={message.id} className="space-y-2">
                  <article className={`space-y-1 rounded-lg px-3 py-2 [overflow-wrap:anywhere] ${fromUser ? 'ml-4 bg-[var(--accent-soft)]' : 'border border-[var(--border-subtle)] bg-[var(--bg-card)]'}`}>
                    <div className="flex flex-wrap items-baseline justify-between gap-x-2 text-xs text-[var(--text-muted)]">
                      <span className="font-semibold text-[var(--text-secondary)]">{fromUser ? 'Anda' : message.role === 'assistant' ? assistantName : 'Sistem'}</span>
                      {message.model_used && <span>{message.model_used}</span>}
                    </div>
                    <p className="whitespace-pre-wrap text-sm leading-relaxed">{message.content}</p>
                    {!!sources.length && (
                      <ul aria-label="Sumber balasan" className="flex flex-wrap gap-1 pt-1">
                        {sources.map(({ id, label }) => (
                          <li key={id} className="rounded-md bg-[var(--bg-elevated)] px-2 py-1 text-xs text-[var(--text-secondary)]">{id} · {label}</li>
                        ))}
                      </ul>
                    )}
                  </article>

                  {card && (
                    <section aria-label={card.title} className="themed-card space-y-2 p-3 [overflow-wrap:anywhere]">
                      <p className={`text-xs font-semibold ${card.status === 'pending_approval' ? 'text-[var(--warning)]' : 'text-[var(--text-secondary)]'}`}>{statusText(card)}</p>
                      <h3 className="text-sm font-semibold">{card.title}</h3>
                      <p className="whitespace-pre-wrap text-sm text-[var(--text-secondary)]">{card.summary}</p>
                      {card.status === 'pending_approval' && card.args && (card.toolName === 'create_clickup_task' || card.toolName === 'set_task_alarm_and_calendar') && (
                        <details>
                          <summary className="flex min-h-11 cursor-pointer items-center text-xs font-medium text-[var(--text-secondary)]">Parameter aksi</summary>
                          <pre className="whitespace-pre-wrap rounded bg-[var(--bg-elevated)] p-2 text-xs [overflow-wrap:anywhere]">{JSON.stringify(card.args, null, 2)}</pre>
                        </details>
                      )}
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
            {pending && (
              <div className="space-y-2 [overflow-wrap:anywhere]">
                <article className="ml-4 space-y-1 rounded-lg bg-[var(--accent-soft)] px-3 py-2">
                  <p className="text-xs font-semibold text-[var(--text-secondary)]">Anda</p>
                  <p className="whitespace-pre-wrap text-sm">{pending.prompt}</p>
                </article>
                <article aria-label="Balasan sementara" className="space-y-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2">
                  <p role="status" className="text-xs font-medium text-[var(--text-secondary)]">{pending.label}</p>
                  {pending.text && <p className="whitespace-pre-wrap text-sm leading-relaxed">{pending.text}</p>}
                </article>
              </div>
            )}
          </>
        )}
      </div>

      {view === 'chat' && (
        <div className="shrink-0 space-y-2 border-t border-[var(--border-subtle)] p-3">
          {pendingContext && (
            <div className="flex items-center justify-between gap-2 rounded-lg bg-[var(--accent-soft)] pl-3 text-xs">
              <span className="min-w-0 truncate">Konteks: {String(pendingContext.title ?? pendingContext.event_name ?? 'Item terpilih')}</span>
              <Control aria-label="Lepas konteks" onClick={() => onClearContext()}><X aria-hidden="true" /></Control>
            </div>
          )}
          {!input && !pending && (
            <div className="flex flex-wrap gap-1">
              <Control className="ds-control--outline" onClick={() => { setInput('Briefing pagi'); composer.current?.focus(); }}>Briefing pagi</Control>
              <Control className="ds-control--outline" onClick={() => { setInput('Auto schedule hari ini'); composer.current?.focus(); }}>Susun jadwal</Control>
            </div>
          )}
          {voiceNote && <p className="ds-note" role="status">{voiceNote}</p>}
          {feedback && <p className="ds-note" role={feedback.error ? 'alert' : 'status'}>{feedback.text}</p>}
          <form className="space-y-2" onSubmit={(event) => { event.preventDefault(); void submitPrompt(); }}>
            <textarea
              ref={composer}
              aria-label="Pesan ke asisten"
              className="ds-field min-h-16 resize-y"
              rows={2}
              maxLength={MAX_AGENT_PROMPT_CHARS}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder={`Tanya ${assistantName}…`}
            />
            <div className="flex justify-between">
              <Control aria-label={listening ? 'Hentikan dikte' : 'Dikte pesan'} aria-pressed={listening} title="Dikte pesan" disabled={!isVoiceRecognitionSupported()} onClick={toggleMic}>
                {listening ? <Square aria-hidden="true" /> : <Mic aria-hidden="true" />}
              </Control>
              {pending ? (
                <Control key="stop" className="ds-control--outline" onClick={(event) => {
                  event.preventDefault();
                  activeRequest.current?.abort();
                }}><Square aria-hidden="true" /> Hentikan balasan</Control>
              ) : (
                <Control key="send" type="submit" className="ds-control--primary" disabled={!input.trim()}>
                  <Send aria-hidden="true" /> {input.trim() === retryPrompt?.prompt ? 'Kirim ulang' : 'Kirim'}
                </Control>
              )}
            </div>
          </form>
        </div>
      )}
    </aside>
  );
}
