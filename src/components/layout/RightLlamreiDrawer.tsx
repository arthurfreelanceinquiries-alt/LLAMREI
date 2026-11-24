import { useEffect, useRef, useState } from 'react';
import { isVoiceRecognitionSupported, speakLlamreiReply, startVoiceDictation } from '../../lib/voice';
import type { ApprovalCard, AuditLogItem, ChatMessageItem } from '../../types/llamrei';

interface Props {
  messages: ChatMessageItem[];
  auditLogs: AuditLogItem[];
  pendingContext: Record<string, unknown> | null;
  onClearContext: () => void;
  onSendPrompt: (prompt: string, context?: Record<string, unknown> | null) => Promise<void>;
  onApproveAudit: (auditId: string) => Promise<void>;
  onUndoAudit: (auditId: string) => Promise<void>;
  onClose?: () => void;
}

export function RightLlamreiDrawer({
  messages,
  auditLogs,
  pendingContext,
  onClearContext,
  onSendPrompt,
  onApproveAudit,
  onUndoAudit,
  onClose,
}: Props) {
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [showAudit, setShowAudit] = useState(false);
  const [listening, setListening] = useState(false);
  const [ttsEnabled, setTtsEnabled] = useState(false);
  const [voiceNote, setVoiceNote] = useState<string | null>(null);
  const stopVoiceRef = useRef<(() => void) | null>(null);
  const lastSpokenIdRef = useRef<string | null>(null);

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
      await onSendPrompt(text.trim(), pendingContext);
      setInput('');
      if (pendingContext) onClearContext();
    } finally {
      setBusy(false);
    }
  };

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
            <div className="text-xs font-mono-num font-bold">LLAMREI // CO-COMMANDER</div>
            <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Approval Gate Active · Anti-Generic AI
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
              {log.status === 'approved_executed' && (
                <button
                  onClick={() => void onUndoAudit(log.id)}
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
                      {msg.role === 'user' ? 'ARTHUR → LLAMREI' : 'LLAMREI'}
                    </span>
                    {msg.model_used && <span>{msg.model_used}</span>}
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
                    <div className="flex items-center justify-between font-mono-num">
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
                            : '↶ UNDONE'}
                      </span>
                      <span style={{ color: 'var(--text-muted)' }}>{card.toolName}</span>
                    </div>
                    <div className="font-semibold">{card.title}</div>
                    <div className="whitespace-pre-wrap" style={{ color: 'var(--text-secondary)' }}>
                      {card.summary}
                    </div>
                    <div className="flex items-center gap-2 pt-1">
                      {card.status === 'pending_approval' && (
                        <button
                          onClick={() => void onApproveAudit(card.auditId)}
                          className="flex-1 py-1.5 px-2.5 rounded font-mono-num font-bold text-xs cursor-pointer"
                          style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
                        >
                          ✓ Approve & Jalankan
                        </button>
                      )}
                      {card.status === 'approved_executed' && (
                        <button
                          onClick={() => void onUndoAudit(card.auditId)}
                          className="py-1 px-2.5 rounded font-mono-num text-xs bg-rose-500/20 text-rose-300 border border-rose-500/30 cursor-pointer"
                        >
                          ↶ Undo
                        </button>
                      )}
                      {card.waMeUrl && (
                        <a
                          href={card.waMeUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="py-1.5 px-2.5 rounded font-mono-num text-xs border"
                          style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)', color: 'var(--accent-2)' }}
                        >
                          wa.me ↗
                        </a>
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
            'Jadwalkan chat ke Raka jam 19:00 soal slide',
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
