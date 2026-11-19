import { useState } from 'react';
import type { BaileysChatThread, BaileysStatus, PhoneNotificationItem, WaTagMentionItem } from '../../types/llamrei';

interface Props {
  mentions: WaTagMentionItem[];
  liveWaNotifs: PhoneNotificationItem[];
  baileys?: BaileysStatus;
  baileysThreads?: BaileysChatThread[];
  onConnectBaileys?: () => Promise<void>;
  onDisconnectBaileys?: () => Promise<void>;
  onOpenFocusedChat?: (chatJid?: string) => void;
  onAcceptProposal?: (mentionId: string) => Promise<void>;
  onDeclineProposal?: (mentionId: string) => Promise<void>;
  onImportExportFile: (input: { groupName: string; fileName: string; contentBase64?: string; rawText?: string; aliases?: string[] }) => Promise<{
    totalParsedMessages: number;
    matchedTags: number;
    insertedNew: number;
    skippedDuplicates: number;
  }>;
  onUpdateMentionStatus: (id: string, repliedStatus: WaTagMentionItem['replied_status']) => Promise<void>;
  onCreateTaskFromMention: (mention: WaTagMentionItem) => Promise<void>;
  onCreateCalendarEventFromMention: (mention: WaTagMentionItem) => Promise<void>;
  onScheduleReplyForMention: (mention: WaTagMentionItem) => void;
  onReplyLiveNotification: (notifId: string, replyText: string) => Promise<void>;
}

export function WaTagInboxView({
  mentions,
  liveWaNotifs,
  baileys,
  baileysThreads = [],
  onConnectBaileys,
  onDisconnectBaileys,
  onOpenFocusedChat,
  onAcceptProposal,
  onDeclineProposal,
  onImportExportFile,
  onUpdateMentionStatus,
  onCreateTaskFromMention,
  onCreateCalendarEventFromMention,
  onScheduleReplyForMention,
  onReplyLiveNotification,
}: Props) {
  const [groupName, setGroupName] = useState('Grup Skripsi & BEM FEB');
  const [aliasesText, setAliasesText] = useState('Arthur, @Arthur, Reezan, 312023002');
  const [pasteText, setPasteText] = useState('');
  const [filterStatus, setFilterStatus] = useState<'ALL' | 'unreplied' | 'replied' | 'ignored'>('ALL');
  const [topicFilter, setTopicFilter] = useState<'ALL' | 'proposals_pending' | 'tugas_kuliah' | 'skripsi' | 'rapat_organisasi' | 'ajakan_pergi'>('ALL');
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [liveReplies, setLiveReplies] = useState<Record<string, string>>({});

  const parseAliases = () =>
    aliasesText
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const inputEl = e.target;
    const file = inputEl.files?.[0];
    if (!file) return;
    setErrorMsg(null);
    try {
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = '';
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const res = await onImportExportFile({
        groupName: groupName.trim() || file.name,
        fileName: file.name,
        contentBase64: btoa(binary),
        aliases: parseAliases(),
      });
      setImportResult(
        `Terurai ${res.totalParsedMessages} pesan · ${res.matchedTags} tag ditemukan · ${res.insertedNew} baru · ${res.skippedDuplicates} duplikat dilewati.`,
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal mengimpor file ekspor WhatsApp');
    } finally {
      inputEl.value = '';
    }
  };

  const handlePasteImport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pasteText.trim()) return;
    setErrorMsg(null);
    try {
      const res = await onImportExportFile({
        groupName: groupName.trim() || 'Paste Export',
        fileName: 'pasted.txt',
        rawText: pasteText,
        aliases: parseAliases(),
      });
      setImportResult(
        `Terurai ${res.totalParsedMessages} pesan · ${res.matchedTags} tag ditemukan · ${res.insertedNew} baru · ${res.skippedDuplicates} duplikat dilewati.`,
      );
      setPasteText('');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal mengurai teks ekspor chat');
    }
  };

  const getTopicBadge = (topic?: string) => {
    switch (topic) {
      case 'skripsi':
        return { label: '📚 SKRIPSI S1', bg: 'rgba(168, 85, 247, 0.15)', text: '#c084fc', border: 'rgba(168, 85, 247, 0.3)' };
      case 'rapat_organisasi':
        return { label: '🏛️ RAPAT & ORGANISASI', bg: 'rgba(59, 130, 246, 0.15)', text: '#60a5fa', border: 'rgba(59, 130, 246, 0.3)' };
      case 'tugas_kuliah':
        return { label: '🎓 TUGAS KULIAH', bg: 'rgba(245, 158, 11, 0.15)', text: '#fbbf24', border: 'rgba(245, 158, 11, 0.3)' };
      case 'ajakan_pergi':
        return { label: '☕ AJAKAN PERGI / HANGOUT', bg: 'rgba(236, 72, 153, 0.15)', text: '#f472b6', border: 'rgba(236, 72, 153, 0.3)' };
      default:
        return { label: '📢 UMUM', bg: 'rgba(255, 255, 255, 0.06)', text: '#a1a1aa', border: 'rgba(255, 255, 255, 0.1)' };
    }
  };

  const pendingProposalsCount = mentions.filter((m) => m.has_event_proposal === 1 && m.proposal_status === 'pending').length;

  const filtered = mentions.filter((m) => {
    const matchReply = filterStatus === 'ALL' || m.replied_status === filterStatus;
    if (!matchReply) return false;
    if (topicFilter === 'ALL') return true;
    if (topicFilter === 'proposals_pending') return m.has_event_proposal === 1 && m.proposal_status === 'pending';
    return m.topic_category === topicFilter;
  });
  const liveMentions = liveWaNotifs.filter((n) => n.is_mention_tag === 1);

  return (
    <div className="space-y-3">
      <div className="pb-2 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
        <div className="text-xs font-mono-num" style={{ color: 'var(--accent)' }}>
          WHATSAPP TAG INBOX // IMPOR EKSPOR CHAT (.TXT / .ZIP) & LIVE NECTARLINK STREAM (FR-27..32)
        </div>
        <h1 className="text-sm font-bold">Deteksi Mention Grup WhatsApp, Klasifikasi Urgensi & Tindak Lanjut</h1>
      </div>

      {/* BAILEYS DIRECT WHATSAPP LINKED DEVICE & FOCUSED 1-CHAT CARD */}
      <div
        className="themed-card p-3.5 space-y-3 border rounded-xl"
        style={{
          borderColor: baileys?.status === 'connected' ? 'rgba(0, 217, 146, 0.4)' : 'rgba(255, 255, 255, 0.1)',
          background: baileys?.status === 'connected'
            ? 'linear-gradient(135deg, rgba(0, 217, 146, 0.05) 0%, rgba(0, 0, 0, 0.4) 100%)'
            : 'var(--bg-card)',
        }}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center font-bold text-base shrink-0"
              style={{
                background: baileys?.status === 'connected' ? 'rgba(0, 217, 146, 0.2)' : 'rgba(255, 255, 255, 0.05)',
                color: baileys?.status === 'connected' ? '#00d992' : '#a1a1aa',
              }}
            >
              💬
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-xs font-bold font-mono-num tracking-wide">
                  WHATSAPP LINKED DEVICE ENGINE (BAILEYS)
                </h3>
                <span
                  className="text-[10px] font-mono-num px-1.5 py-0.5 rounded border"
                  style={{
                    background:
                      baileys?.status === 'connected'
                        ? 'rgba(0, 217, 146, 0.15)'
                        : baileys?.status === 'awaiting_qr'
                          ? 'rgba(245, 158, 11, 0.15)'
                          : 'rgba(255, 255, 255, 0.05)',
                    color:
                      baileys?.status === 'connected'
                        ? '#00d992'
                        : baileys?.status === 'awaiting_qr'
                          ? '#f59e0b'
                          : '#a1a1aa',
                    borderColor:
                      baileys?.status === 'connected'
                        ? 'rgba(0, 217, 146, 0.3)'
                        : baileys?.status === 'awaiting_qr'
                          ? 'rgba(245, 158, 11, 0.3)'
                          : 'var(--border-subtle)',
                  }}
                >
                  {baileys?.status === 'connected'
                    ? '● TERHUBUNG'
                    : baileys?.status === 'awaiting_qr'
                      ? '⚡ SCAN QR CODE'
                      : baileys?.status === 'connecting'
                        ? '⏳ MENGHUBUNGKAN...'
                        : '○ TIDAK TERHUBUNG'}
                </span>
              </div>
              <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                Koneksi langsung tanpa tab browser WhatsApp Web. Hemat jutaan token AI & aman tanpa risiko blokir.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {baileys?.status === 'connected' ? (
              <>
                <button
                  onClick={() => onOpenFocusedChat?.()}
                  className="px-3 py-1.5 rounded text-xs font-mono-num font-bold flex items-center gap-1.5 cursor-pointer shadow-sm"
                  style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
                >
                  💬 Buka Focused Chat ({baileysThreads.length})
                </button>
                <button
                  onClick={() => void onDisconnectBaileys?.()}
                  className="px-2.5 py-1.5 rounded text-xs font-mono-num border border-rose-500/30 text-rose-300 hover:bg-rose-500/10 cursor-pointer"
                >
                  Putuskan
                </button>
              </>
            ) : baileys?.status === 'connecting' ? (
              <button disabled className="px-3 py-1.5 rounded text-xs font-mono-num opacity-60 cursor-not-allowed border">
                Menghubungkan...
              </button>
            ) : baileys?.status === 'awaiting_qr' ? (
              <button
                onClick={() => void onDisconnectBaileys?.()}
                className="px-2.5 py-1.5 rounded text-xs font-mono-num border border-white/20 hover:bg-white/10 cursor-pointer"
              >
                Batal
              </button>
            ) : (
              <button
                onClick={() => void onConnectBaileys?.()}
                className="px-3 py-1.5 rounded text-xs font-mono-num font-bold flex items-center gap-1.5 cursor-pointer"
                style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
              >
                ⚡ Hubungkan WhatsApp (Scan QR)
              </button>
            )}
          </div>
        </div>

        {/* QR Code Display when awaiting_qr */}
        {baileys?.status === 'awaiting_qr' && baileys.qrDataUrl && (
          <div className="p-4 rounded-xl bg-black/40 border border-amber-500/30 flex flex-col sm:flex-row items-center gap-4 animate-fade-in">
            <div className="bg-white p-2.5 rounded-xl shrink-0 shadow-lg border border-white/20">
              <img
                src={baileys.qrDataUrl}
                alt="WhatsApp QR Code"
                className="w-48 h-48 block rounded"
              />
            </div>
            <div className="space-y-2 text-xs">
              <div className="font-bold text-amber-300 text-sm">
                Langkah Menautkan WhatsApp Arthur:
              </div>
              <ol className="list-decimal list-inside space-y-1 text-stone-300 leading-relaxed font-mono-num">
                <li>Buka WhatsApp di HP (Infinix / HP utama Anda)</li>
                <li>Ketuk menu titik tiga (Android) atau Pengaturan (iOS)</li>
                <li>Pilih <strong className="text-white">Perangkat Tertaut (Linked Devices)</strong></li>
                <li>Ketuk <strong className="text-emerald-400">Tautkan Perangkat</strong> lalu arahkan kamera ke QR Code di samping</li>
                <li>Sesi tersimpan lokal di laptop Arthur (<code className="text-[10px] bg-black/50 px-1 rounded">data/wa_baileys_auth/</code>)</li>
              </ol>
              <div className="text-[11px] text-stone-400 pt-1">
                QR code diperbarui otomatis via SSE jika kedaluwarsa.
              </div>
            </div>
          </div>
        )}

        {/* Connected Info & Active Threads Quick Bar */}
        {baileys?.status === 'connected' && (
          <div className="pt-2 border-t border-white/5 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-stone-400">
                Pengguna Terhubung: <strong className="text-emerald-400">{baileys.userName ?? 'Arthur'}</strong> ({baileys.userJid})
              </span>
              <span className="font-mono-num text-[11px] text-stone-400">
                {baileysThreads.length} Thread Aktif di-Cache
              </span>
            </div>

            {baileysThreads.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 pt-1">
                {baileysThreads.slice(0, 6).map((thread) => {
                  const lastMsg = thread.messages[thread.messages.length - 1];
                  return (
                    <div
                      key={thread.chatJid}
                      onClick={() => onOpenFocusedChat?.(thread.chatJid)}
                      className="p-2.5 rounded-lg border bg-black/25 hover:bg-black/40 hover:border-emerald-500/40 transition cursor-pointer flex flex-col justify-between gap-1 text-xs"
                      style={{ borderColor: 'var(--border-subtle)' }}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className="font-bold text-stone-200 truncate">
                          {thread.name}
                        </span>
                        {thread.unreadCount > 0 && (
                          <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-emerald-500 text-black font-bold">
                            {thread.unreadCount}
                          </span>
                        )}
                      </div>
                      {lastMsg && (
                        <p className="text-[11px] text-stone-400 truncate">
                          <span className="text-stone-300 font-medium">{lastMsg.senderName}:</span> {lastMsg.text}
                        </p>
                      )}
                      <div className="text-[10px] font-mono-num text-stone-400 flex items-center justify-between pt-1">
                        <span>{thread.lastTimestamp}</span>
                        <span className="text-emerald-400 hover:underline">💬 Balas</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Importer Card */}
      <div className="themed-card p-3 space-y-2.5 text-xs">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <label className="space-y-1">
            <span style={{ color: 'var(--text-muted)' }}>Nama Grup WhatsApp</span>
            <input
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded border outline-none"
              style={{ background: 'var(--bg-void)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
            />
          </label>
          <label className="space-y-1">
            <span style={{ color: 'var(--text-muted)' }}>Alias / Nama / NIM Penanda Tag</span>
            <input
              value={aliasesText}
              onChange={(e) => setAliasesText(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded border outline-none"
              style={{ background: 'var(--bg-void)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
            />
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <label className="px-3 py-1.5 rounded font-mono-num font-bold cursor-pointer" style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}>
            📂 Pilih File Ekspor WA (.txt / .zip)
            <input type="file" accept=".txt,.zip" onChange={(e) => void handleFileChange(e)} className="hidden" />
          </label>
          <span style={{ color: 'var(--text-muted)' }}>Nomor telepon disamarkan otomatis sebelum analisis AI.</span>
        </div>

        <form onSubmit={(e) => void handlePasteImport(e)} className="space-y-1.5">
          <textarea
            rows={2}
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder="Atau tempel teks Ekspor Chat WhatsApp di sini (contoh: [19/11/26, 08.15] Raka: @Arthur tolong cek Bab 4 sebelum jam 17:00)..."
            className="w-full p-2 rounded border outline-none font-mono-num"
            style={{ background: 'var(--bg-void)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
          />
          <button type="submit" className="px-3 py-1 rounded border font-mono-num cursor-pointer" style={{ borderColor: 'var(--border-subtle)' }}>
            Analisis Teks Tempelan
          </button>
        </form>

        {errorMsg && <div className="p-2 rounded bg-rose-500/20 text-rose-300 font-mono-num">⚠ {errorMsg}</div>}
        {importResult && (
          <div className="p-2 rounded font-mono-num" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
            ✓ {importResult}
          </div>
        )}
      </div>

      {/* Live Mentions from NectarLink with 1-Click Direct Reply */}
      {liveMentions.length > 0 && (
        <div className="themed-card p-3 space-y-2 text-xs">
          <div className="font-mono-num font-bold text-cyan-400">
            📡 LIVE MENTION DARI NECTARLINK ANDROID ({liveMentions.length})
          </div>
          {liveMentions.map((n) => (
            <div key={n.id} className="bg-black/25 p-2 rounded space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span>
                  <strong>{n.sender_or_title}</strong> ({n.conversation_group ?? 'Chat'}): {n.body_text}
                </span>
                <span className="font-mono-num text-amber-300 shrink-0">{n.ai_intent ?? 'tag'}</span>
              </div>
              {n.replied_text && (
                <div className="font-mono-num" style={{ color: 'var(--accent)' }}>
                  ✓ Dibalas via NectarLink: "{n.replied_text}"
                </div>
              )}
              {n.can_reply === 1 && (
                <div className="flex gap-1.5">
                  <input
                    value={liveReplies[n.id] ?? ''}
                    onChange={(e) => setLiveReplies((p) => ({ ...p, [n.id]: e.target.value }))}
                    placeholder="Balas langsung lewat HP (NectarLink)..."
                    className="flex-1 px-2 py-1 rounded border outline-none"
                    style={{ background: 'var(--bg-void)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
                  />
                  <button
                    onClick={async () => {
                      const txt = (liveReplies[n.id] ?? '').trim();
                      if (!txt) return;
                      await onReplyLiveNotification(n.id, txt);
                      setLiveReplies((p) => ({ ...p, [n.id]: '' }));
                    }}
                    className="px-2.5 py-1 rounded font-mono-num font-bold cursor-pointer"
                    style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
                  >
                    Balas NectarLink ↗
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Filter & Tag Mentions List with Topic Filter Pills */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2">
            <span className="font-mono-num font-bold" style={{ color: 'var(--text-secondary)' }}>
              TAG WA PERLU TINDAK LANJUT ({filtered.length})
            </span>
            {pendingProposalsCount > 0 && (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold font-mono-num bg-amber-500/20 text-amber-300 border border-amber-500/40 animate-pulse">
                ⚡ {pendingProposalsCount} Usulan Agenda Pending Accept
              </span>
            )}
          </div>

          {/* Status Filter */}
          <div className="flex gap-1">
            {(['ALL', 'unreplied', 'replied', 'ignored'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setFilterStatus(s)}
                className="px-2 py-0.5 rounded text-[11px] font-mono-num border cursor-pointer"
                style={
                  filterStatus === s
                    ? { background: 'var(--accent-soft)', color: 'var(--accent)', borderColor: 'var(--border-accent)' }
                    : { background: 'var(--bg-card)', borderColor: 'var(--border-subtle)', color: 'var(--text-muted)' }
                }
              >
                {s.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        {/* Topic Category Filter Pills */}
        <div className="flex flex-wrap gap-1.5 text-xs">
          <button
            onClick={() => setTopicFilter('ALL')}
            className="px-2.5 py-1 rounded-lg text-xs font-mono-num border cursor-pointer transition"
            style={
              topicFilter === 'ALL'
                ? { background: 'var(--accent)', color: 'var(--accent-fg)', borderColor: 'var(--accent)' }
                : { background: 'var(--bg-card)', borderColor: 'var(--border-subtle)', color: 'var(--text-muted)' }
            }
          >
            Semua Topik ({mentions.length})
          </button>
          {pendingProposalsCount > 0 && (
            <button
              onClick={() => setTopicFilter('proposals_pending')}
              className="px-2.5 py-1 rounded-lg text-xs font-mono-num border cursor-pointer transition"
              style={
                topicFilter === 'proposals_pending'
                  ? { background: 'rgba(245, 158, 11, 0.25)', color: '#fbbf24', borderColor: '#f59e0b' }
                  : { background: 'rgba(245, 158, 11, 0.1)', borderColor: 'rgba(245, 158, 11, 0.3)', color: '#fbbf24' }
              }
            >
              📅 Pending Accept ({pendingProposalsCount})
            </button>
          )}
          <button
            onClick={() => setTopicFilter('tugas_kuliah')}
            className="px-2.5 py-1 rounded-lg text-xs font-mono-num border cursor-pointer transition"
            style={
              topicFilter === 'tugas_kuliah'
                ? { background: 'rgba(245, 158, 11, 0.25)', color: '#fbbf24', borderColor: '#f59e0b' }
                : { background: 'var(--bg-card)', borderColor: 'var(--border-subtle)', color: 'var(--text-muted)' }
            }
          >
            🎓 Tugas Kuliah
          </button>
          <button
            onClick={() => setTopicFilter('skripsi')}
            className="px-2.5 py-1 rounded-lg text-xs font-mono-num border cursor-pointer transition"
            style={
              topicFilter === 'skripsi'
                ? { background: 'rgba(168, 85, 247, 0.25)', color: '#c084fc', borderColor: '#a855f7' }
                : { background: 'var(--bg-card)', borderColor: 'var(--border-subtle)', color: 'var(--text-muted)' }
            }
          >
            📚 Skripsi S1
          </button>
          <button
            onClick={() => setTopicFilter('rapat_organisasi')}
            className="px-2.5 py-1 rounded-lg text-xs font-mono-num border cursor-pointer transition"
            style={
              topicFilter === 'rapat_organisasi'
                ? { background: 'rgba(59, 130, 246, 0.25)', color: '#60a5fa', borderColor: '#3b82f6' }
                : { background: 'var(--bg-card)', borderColor: 'var(--border-subtle)', color: 'var(--text-muted)' }
            }
          >
            🏛️ Rapat & Organisasi
          </button>
          <button
            onClick={() => setTopicFilter('ajakan_pergi')}
            className="px-2.5 py-1 rounded-lg text-xs font-mono-num border cursor-pointer transition"
            style={
              topicFilter === 'ajakan_pergi'
                ? { background: 'rgba(236, 72, 153, 0.25)', color: '#f472b6', borderColor: '#ec4899' }
                : { background: 'var(--bg-card)', borderColor: 'var(--border-subtle)', color: 'var(--text-muted)' }
            }
          >
            ☕ Ajakan Pergi / Hangout
          </button>
        </div>
      </div>

      <div className="space-y-2">
        {filtered.length === 0 ? (
          <div className="themed-card p-4 text-xs text-center" style={{ color: 'var(--text-muted)' }}>
            Belum ada tag pada filter ini.
          </div>
        ) : (
          filtered.map((m) => {
            const topicBadge = getTopicBadge(m.topic_category);
            return (
              <div key={m.id} className="themed-card p-3 space-y-2.5 text-xs">
                {/* Header: Sender, Group, Topic Badge & Urgency */}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-stone-100">{m.sender_display}</span>
                    <span
                      className="px-2 py-0.5 rounded font-mono-num text-[11px] border"
                      style={{
                        background: m.group_name === 'Personal Chat' ? 'rgba(255,255,255,0.05)' : 'rgba(0, 217, 146, 0.1)',
                        borderColor: m.group_name === 'Personal Chat' ? 'var(--border-subtle)' : 'rgba(0, 217, 146, 0.25)',
                        color: m.group_name === 'Personal Chat' ? 'var(--text-muted)' : 'var(--accent)',
                      }}
                    >
                      {m.group_name === 'Personal Chat' ? '👤 Chat Personal' : `👥 Grup: ${m.group_name}`}
                    </span>
                    <span className="font-mono-num text-stone-500 text-[10px]">
                      · {m.message_timestamp}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5 font-mono-num flex-wrap">
                    {/* Topic Badge */}
                    <span
                      className="px-2 py-0.5 rounded text-[10px] font-bold border"
                      style={{
                        background: topicBadge.bg,
                        color: topicBadge.text,
                        borderColor: topicBadge.border,
                      }}
                    >
                      {topicBadge.label}
                    </span>

                    {/* Urgency Badge */}
                    <span
                      className="px-1.5 py-0.5 rounded text-[10px] font-bold"
                      style={{
                        background: m.ai_urgency === 'high' ? 'rgba(239,68,68,0.2)' : 'rgba(245,158,11,0.18)',
                        color: m.ai_urgency === 'high' ? '#f87171' : '#fbbf24',
                      }}
                    >
                      {m.ai_urgency.toUpperCase()}
                    </span>

                    <span className="px-1.5 py-0.5 rounded text-[10px] bg-white/5 font-mono-num">
                      {m.replied_status}
                    </span>
                  </div>
                </div>

                {m.context_before && (
                  <div className="text-xs px-2 py-1 rounded bg-black/20 whitespace-pre-wrap" style={{ color: 'var(--text-muted)' }}>
                    Konteks sebelum: {m.context_before}
                  </div>
                )}

                {/* Quoted Message */}
                <div className="bg-black/30 p-2.5 rounded-lg border-l-2 border-emerald-400 whitespace-pre-wrap leading-relaxed text-stone-200">
                  {m.quoted_message}
                </div>

                {m.context_after && (
                  <div className="text-xs px-2 py-1 rounded bg-black/20 whitespace-pre-wrap" style={{ color: 'var(--text-muted)' }}>
                    Konteks sesudah: {m.context_after}
                  </div>
                )}

                {/* INTERACTIVE EVENT PROPOSAL CARD (STRICT APPROVAL GATE) */}
                {m.has_event_proposal === 1 && (
                  <div className="mt-1">
                    {m.proposal_status === 'pending' ? (
                      <div
                        className="p-3 rounded-xl border space-y-2 animate-fade-in"
                        style={{
                          background: 'linear-gradient(135deg, rgba(0, 217, 146, 0.08) 0%, rgba(0, 0, 0, 0.3) 100%)',
                          borderColor: 'rgba(0, 217, 146, 0.4)',
                        }}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5 font-bold font-mono-num text-xs text-emerald-400">
                            <span>📅 USULAN AGENDA TERDETEKSI (PERLU PERSETUJUAN ARTHUR)</span>
                          </div>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30 font-mono-num font-bold">
                            PENDING ACCEPT
                          </span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                          <div>
                            <span className="text-stone-400 text-[11px]">Nama Usulan Acara:</span>
                            <div className="font-bold text-stone-100">{m.proposed_event_title}</div>
                          </div>
                          <div>
                            <span className="text-stone-400 text-[11px]">Waktu Usulan:</span>
                            <div className="font-mono-num text-emerald-300 font-semibold">
                              {m.proposed_event_start
                                ? new Date(m.proposed_event_start).toLocaleString('id-ID', {
                                    dateStyle: 'medium',
                                    timeStyle: 'short',
                                    timeZone: 'Asia/Jakarta',
                                  })
                                : '-'}{' '}
                              WIB
                            </div>
                          </div>
                        </div>
                        {m.proposed_event_location && (
                          <div className="text-xs text-stone-300">
                            <span className="text-stone-400 text-[11px]">Lokasi:</span> 📍 {m.proposed_event_location}
                          </div>
                        )}
                        <div className="flex items-center gap-2 pt-2 border-t border-white/5">
                          <button
                            onClick={async () => {
                              setAcceptingId(m.id);
                              try {
                                await onAcceptProposal?.(m.id);
                              } finally {
                                setAcceptingId(null);
                              }
                            }}
                            disabled={acceptingId === m.id}
                            className="px-3 py-1.5 rounded-lg text-xs font-bold font-mono-num cursor-pointer transition shadow-md flex items-center gap-1.5 disabled:opacity-40"
                            style={{ background: '#00D992', color: '#05070A' }}
                          >
                            <span>{acceptingId === m.id ? 'Memproses...' : '✓ Accept & Masukkan ke Kalender'}</span>
                          </button>
                          <button
                            onClick={() => void onDeclineProposal?.(m.id)}
                            className="px-2.5 py-1.5 rounded-lg text-xs font-mono-num border border-white/10 text-stone-400 hover:text-white hover:bg-white/5 cursor-pointer"
                          >
                            ✕ Tolak / Abaikan
                          </button>
                        </div>
                      </div>
                    ) : m.proposal_status === 'accepted' ? (
                      <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-xs flex items-center justify-between">
                        <span className="text-emerald-300 font-mono-num font-semibold">
                          ✓ Acara telah Anda terima dan masuk ke Kalender & Alarm ({m.proposed_event_title})
                        </span>
                        <span className="text-[10px] text-emerald-400 font-mono-num">
                          {m.proposed_event_start
                            ? new Date(m.proposed_event_start).toLocaleTimeString('id-ID', {
                                hour: '2-digit',
                                minute: '2-digit',
                                timeZone: 'Asia/Jakarta',
                              })
                            : ''}{' '}
                          WIB
                        </span>
                      </div>
                    ) : (
                      <div className="p-1.5 rounded bg-black/20 text-stone-400 text-xs font-mono-num">
                        ✕ Usulan agenda ditolak / tidak dimasukkan ke kalender.
                      </div>
                    )}
                  </div>
                )}

                {/* Actions Bar */}
                <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-white/5">
                  <button
                    onClick={() => void onCreateTaskFromMention(m)}
                    className="px-2.5 py-1 rounded font-mono-num font-bold cursor-pointer"
                    style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
                  >
                    + Jadi Tugas ClickUp
                  </button>
                  <button
                    onClick={() => void onCreateCalendarEventFromMention(m)}
                    className="px-2.5 py-1 rounded font-mono-num border cursor-pointer"
                    style={{ borderColor: 'var(--border-subtle)', color: '#c084fc' }}
                  >
                    📅 Buat Acara Kalender Manual
                  </button>
                  <button
                    onClick={() => onScheduleReplyForMention(m)}
                    className="px-2.5 py-1 rounded font-mono-num border cursor-pointer"
                    style={{ borderColor: 'var(--border-subtle)', color: 'var(--accent-2)' }}
                  >
                    💬 Jadwalkan Balasan
                  </button>
                  {m.replied_status !== 'replied' && (
                    <button
                      onClick={() => void onUpdateMentionStatus(m.id, 'replied')}
                      className="px-2 py-1 rounded font-mono-num border cursor-pointer"
                      style={{ borderColor: 'var(--border-subtle)' }}
                    >
                      ✓ Sudah Dibalas
                    </button>
                  )}
                  {m.replied_status !== 'ignored' && (
                    <button
                      onClick={() => void onUpdateMentionStatus(m.id, 'ignored')}
                      className="px-2 py-1 rounded font-mono-num border cursor-pointer"
                      style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-muted)' }}
                    >
                      Abaikan
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
