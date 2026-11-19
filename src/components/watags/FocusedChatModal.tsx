import { useState, useEffect, useRef } from 'react';
import type { BaileysChatThread, BaileysChatMessage } from '../../types/llamrei';

interface Props {
  activeThread: BaileysChatThread | null;
  allThreads: BaileysChatThread[];
  isConnected?: boolean;
  pendingProposal?: { id: string; title: string; time: string; location?: string | null } | null;
  onSelectThread: (chatJid: string) => void;
  onSendMessage: (chatJid: string, text: string) => Promise<void>;
  onClose: () => void;
  onNavigateToQr?: () => void;
  onAcceptProposal?: (mentionId: string) => Promise<void>;
  onDeclineProposal?: (mentionId: string) => Promise<void>;
}

export function FocusedChatModal({
  activeThread,
  allThreads,
  isConnected = false,
  pendingProposal,
  onSelectThread,
  onSendMessage,
  onClose,
  onNavigateToQr,
  onAcceptProposal,
  onDeclineProposal,
}: Props) {
  const [inputText, setInputText] = useState('');
  const [newTargetJid, setNewTargetJid] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [sendSuccess, setSendSuccess] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Global Escape key listener to close modal immediately
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Auto-scroll to bottom on new message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeThread?.messages]);

  const handleSend = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!inputText.trim() || isSending) return;

    const targetJid = activeThread?.chatJid || newTargetJid.trim();
    if (!targetJid) return;

    const textToSend = inputText.trim();
    setInputText('');
    setSendError(null);
    setIsSending(true);
    try {
      await onSendMessage(targetJid, textToSend);
      setSendSuccess(true);
      setTimeout(() => setSendSuccess(false), 3000);
    } catch (err: unknown) {
      setSendError(err instanceof Error ? err.message : 'Gagal mengirim pesan');
      setInputText(textToSend); // preserve input so user doesn't lose their text
    } finally {
      setIsSending(false);
    }
  };

  // Honest state: If no chats have arrived/been sent yet
  if (!activeThread && allThreads.length === 0) {
    return (
      <div
        onClick={onClose}
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fade-in"
      >
        <div
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-lg rounded-2xl border flex flex-col shadow-2xl overflow-hidden p-6 text-center space-y-4"
          style={{
            background: 'linear-gradient(180deg, #0c1017 0%, #05070a 100%)',
            borderColor: 'rgba(0, 217, 146, 0.35)',
            boxShadow: '0 20px 50px rgba(0, 0, 0, 0.8), 0 0 30px rgba(0, 217, 146, 0.15)',
          }}
        >
          <div className="flex justify-between items-center w-full pb-2 border-b border-white/10">
            <div className="flex items-center gap-2">
              <span className="text-xl">💬</span>
              <h3 className="text-sm font-bold text-emerald-400 font-mono-num">
                WHATSAPP FOCUSED CHAT
              </h3>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="px-2.5 py-1 rounded-lg flex items-center gap-1.5 text-xs text-stone-300 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 transition cursor-pointer"
              title="Tutup Modal (Escape)"
            >
              <span>✕</span>
              <span>Tutup</span>
              <span className="text-[10px] text-stone-500 font-mono-num">(Esc)</span>
            </button>
          </div>

          <div className="py-4 space-y-2.5">
            <div
              className="w-12 h-12 mx-auto rounded-full flex items-center justify-center text-xl border"
              style={{
                background: isConnected ? 'rgba(0, 217, 146, 0.15)' : 'rgba(245, 158, 11, 0.15)',
                borderColor: isConnected ? 'rgba(0, 217, 146, 0.3)' : 'rgba(245, 158, 11, 0.3)',
                color: isConnected ? '#00d992' : '#f59e0b',
              }}
            >
              {isConnected ? '✓' : '⚡'}
            </div>
            <h4 className="text-base font-bold text-stone-100">
              {isConnected ? 'Belum Ada Pesan Masuk' : 'WhatsApp Belum Terhubung'}
            </h4>
            <p className="text-xs text-stone-400 max-w-md mx-auto leading-relaxed">
              {isConnected
                ? 'Sistem terhubung secara real ke WhatsApp Anda. Pesan asli akan langsung tampil di sini begitu ada chat masuk dari kontak atau grup.'
                : 'Tidak ada data chat tiruan atau rekayasa. Untuk memuat pesan asli WhatsApp Anda dan membalas langsung dari sini, silakan tautkan perangkat via QR Code.'}
            </p>
          </div>

          {sendError && (
            <div className="p-2 rounded-lg bg-red-900/40 border border-red-500/40 text-xs text-red-200 text-left">
              ⚠️ {sendError}
            </div>
          )}

          {!isConnected ? (
            <div className="pt-2 flex flex-col gap-2">
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onNavigateToQr?.();
                }}
                className="w-full py-2.5 rounded-xl text-xs font-bold font-mono-num cursor-pointer transition shadow-md"
                style={{ background: '#00D992', color: '#05070A' }}
              >
                ⚡ Buka Scan QR Code di Tab WhatsApp Tags ↗
              </button>
              <button
                type="button"
                onClick={onClose}
                className="w-full py-2 rounded-xl text-xs font-mono-num text-stone-400 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 transition cursor-pointer"
              >
                Tutup (Esc)
              </button>
            </div>
          ) : (
            <div className="p-3.5 rounded-xl bg-black/40 border border-white/10 text-left space-y-2.5">
              <div className="text-xs font-bold text-stone-300 font-mono-num">
                Kirim Chat ke Nomor Tujuan:
              </div>
              <input
                type="text"
                placeholder="Nomor HP WhatsApp (misal: 0812xxxxxx / 62812xxxxxx)..."
                value={newTargetJid}
                onChange={(e) => setNewTargetJid(e.target.value)}
                className="w-full px-3 py-2 rounded-lg text-xs bg-black/60 border border-white/10 text-stone-200 outline-none font-mono-num placeholder-stone-500"
              />
              <input
                type="text"
                placeholder="Tulis pesan asli..."
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleSend();
                }}
                className="w-full px-3 py-2 rounded-lg text-xs bg-black/60 border border-white/10 text-stone-200 outline-none placeholder-stone-500"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void handleSend()}
                  disabled={!newTargetJid.trim() || !inputText.trim() || isSending}
                  className="flex-1 py-2 rounded-lg text-xs font-bold font-mono-num cursor-pointer disabled:opacity-40 transition"
                  style={{ background: '#00D992', color: '#05070A' }}
                >
                  {isSending ? 'Mengirim...' : 'Kirim Pesan Real via WhatsApp ↗'}
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 rounded-lg text-xs font-mono-num text-stone-400 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 transition cursor-pointer"
                >
                  Tutup
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  const currentThread = activeThread ?? allThreads[0];

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fade-in"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-2xl border flex flex-col shadow-2xl overflow-hidden"
        style={{
          background: 'linear-gradient(180deg, #0c1017 0%, #05070a 100%)',
          borderColor: 'rgba(0, 217, 146, 0.35)',
          height: '620px',
          boxShadow: '0 20px 50px rgba(0, 0, 0, 0.8), 0 0 30px rgba(0, 217, 146, 0.15)',
        }}
      >
        {/* HEADER */}
        <div
          className="p-3.5 border-b flex items-center justify-between"
          style={{ borderColor: 'rgba(255, 255, 255, 0.08)', background: 'rgba(0, 0, 0, 0.3)' }}
        >
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full flex items-center justify-center bg-emerald-500/20 text-emerald-400 font-bold border border-emerald-500/40">
              💬
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-emerald-400 tracking-wide font-mono-num">
                  {currentThread.name}
                </h3>
                <span
                  className="text-[10px] px-1.5 py-0.2 rounded border font-mono-num"
                  style={{
                    background: isConnected ? 'rgba(0, 217, 146, 0.1)' : 'rgba(245, 158, 11, 0.1)',
                    borderColor: isConnected ? 'rgba(0, 217, 146, 0.3)' : 'rgba(245, 158, 11, 0.3)',
                    color: isConnected ? '#00d992' : '#f59e0b',
                  }}
                >
                  {isConnected ? 'WA Connected' : 'Offline / Local'}
                </span>
              </div>
              <p className="text-[11px] text-stone-400">
                Focused 1-chat reply • Real-time sync
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Thread selector dropdown if multiple */}
            {allThreads.length > 1 && (
              <select
                value={currentThread.chatJid}
                onChange={(e) => onSelectThread(e.target.value)}
                className="px-2 py-1 rounded text-xs bg-black/50 border border-white/10 text-stone-300 font-mono-num outline-none cursor-pointer"
              >
                {allThreads.map((t) => (
                  <option key={t.chatJid} value={t.chatJid}>
                    {t.name}
                  </option>
                ))}
              </select>
            )}
            <button
              type="button"
              onClick={onClose}
              className="px-2.5 py-1 rounded-lg flex items-center gap-1.5 text-xs text-stone-300 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 transition cursor-pointer"
              title="Tutup Modal (Escape)"
            >
              <span>✕</span>
              <span>Tutup</span>
              <span className="text-[10px] text-stone-500 font-mono-num">(Esc)</span>
            </button>
          </div>
        </div>

        {/* NOTIFICATION BANNERS */}
        {sendError && (
          <div className="px-3.5 py-1.5 bg-red-900/50 border-b border-red-500/40 text-[11px] text-red-200 flex items-center justify-between">
            <span>⚠️ {sendError}</span>
            <button
              type="button"
              onClick={() => setSendError(null)}
              className="text-stone-400 hover:text-white cursor-pointer"
            >
              ✕
            </button>
          </div>
        )}
        {sendSuccess && (
          <div className="px-3.5 py-1.5 bg-emerald-900/50 border-b border-emerald-500/40 text-[11px] text-emerald-200 flex items-center justify-between">
            <span>✓ Pesan berhasil terkirim ke WhatsApp!</span>
            <button
              type="button"
              onClick={() => setSendSuccess(false)}
              className="text-stone-400 hover:text-white cursor-pointer"
            >
              ✕
            </button>
          </div>
        )}

        {/* PENDING AGENDA PROPOSAL BANNER (ACCEPTANCE GATE) */}
        {pendingProposal && (
          <div
            className="px-3.5 py-2.5 border-b flex flex-wrap items-center justify-between gap-2 text-xs animate-fade-in"
            style={{
              background: 'linear-gradient(90deg, rgba(0, 217, 146, 0.15) 0%, rgba(59, 130, 246, 0.1) 100%)',
              borderColor: 'rgba(0, 217, 146, 0.3)',
            }}
          >
            <div className="flex items-center gap-2">
              <span className="text-base">📅</span>
              <div>
                <div className="font-bold text-emerald-300 font-mono-num text-[11px]">
                  USULAN AGENDA: {pendingProposal.title}
                </div>
                <div className="text-[10px] text-stone-300 font-mono-num">
                  ⏰ {pendingProposal.time} {pendingProposal.location ? `· 📍 ${pendingProposal.location}` : ''}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => void onAcceptProposal?.(pendingProposal.id)}
                className="px-2.5 py-1 rounded text-xs font-bold font-mono-num cursor-pointer shadow-sm transition"
                style={{ background: '#00D992', color: '#05070A' }}
              >
                ✓ Accept ke Kalender
              </button>
              <button
                type="button"
                onClick={() => void onDeclineProposal?.(pendingProposal.id)}
                className="px-2 py-1 rounded text-xs font-mono-num border border-white/10 text-stone-400 hover:text-white cursor-pointer"
              >
                ✕ Tolak
              </button>
            </div>
          </div>
        )}

        {/* CHAT MESSAGES STREAM */}
        <div className="flex-1 p-4 overflow-y-auto space-y-3 themed-scroll bg-black/20">
          {currentThread.messages.map((msg: BaileysChatMessage) => {
            const isMe = msg.isFromMe;
            return (
              <div
                key={msg.id}
                className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}
              >
                {/* Sender & Timestamp Header */}
                <div className="text-[10px] font-mono-num mb-1 px-1 flex items-center gap-1.5 text-stone-400">
                  <span className={isMe ? 'text-purple-300 font-semibold' : 'text-emerald-400 font-semibold'}>
                    {msg.senderName}
                  </span>
                  <span>•</span>
                  <span>{msg.timestamp}</span>
                </div>

                {/* Message Bubble */}
                <div
                  className={`max-w-[82%] px-3.5 py-2.5 rounded-2xl text-xs leading-relaxed shadow-md ${
                    isMe
                      ? 'rounded-tr-xs text-purple-100'
                      : 'rounded-tl-xs text-stone-200'
                  }`}
                  style={
                    isMe
                      ? {
                          background: 'linear-gradient(135deg, rgba(88, 28, 135, 0.45) 0%, rgba(59, 7, 100, 0.6) 100%)',
                          border: '1px solid rgba(168, 85, 247, 0.35)',
                        }
                      : {
                          background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.7) 0%, rgba(30, 41, 59, 0.5) 100%)',
                          border: '1px solid rgba(255, 255, 255, 0.12)',
                        }
                  }
                >
                  <p className="whitespace-pre-wrap break-words">{msg.text}</p>
                </div>
              </div>
            );
          })}
          <div ref={messagesEndRef} />
        </div>

        {/* BOTTOM INPUT & SEND FORM */}
        <form
          onSubmit={handleSend}
          className="p-3 border-t flex items-center gap-2 bg-black/40"
          style={{ borderColor: 'rgba(255, 255, 255, 0.08)' }}
        >
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void handleSend();
              }
            }}
            placeholder="Ketik balasan real... (Enter untuk kirim)"
            className="flex-1 px-3.5 py-2 rounded-xl text-xs bg-black/60 border border-white/10 text-stone-100 placeholder-stone-500 outline-none focus:border-emerald-500/50 transition font-sans"
            disabled={isSending}
            autoFocus
          />
          <button
            type="submit"
            disabled={!inputText.trim() || isSending}
            className="px-4 py-2 rounded-xl text-xs font-bold font-mono-num transition cursor-pointer flex items-center gap-1.5 shadow-md disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              background: '#00D992',
              color: '#05070A',
            }}
          >
            <span>{isSending ? 'Mengirim...' : 'Kirim'}</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-2 rounded-xl text-xs font-mono-num text-stone-300 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 transition cursor-pointer"
            title="Tutup Modal (Escape)"
          >
            Tutup
          </button>
        </form>
      </div>
    </div>
  );
}
