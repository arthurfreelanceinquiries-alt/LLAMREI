import { useMemo, useState } from 'react';
import type { BaileysChatThread, BaileysStatus, PhoneNotificationItem, WaTagMentionItem } from '../../types/llamrei';

interface Props {
  mentions: WaTagMentionItem[];
  liveWaNotifs: PhoneNotificationItem[];
  baileys?: BaileysStatus;
  baileysThreads?: BaileysChatThread[];
  onConnectBaileys?: () => Promise<void>;
  onDisconnectBaileys?: () => Promise<void>;
  onSyncBaileysGroups?: () => Promise<void>;
  onSendBaileysMessage?: (chatJid: string, text: string) => Promise<void>;
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
  onSyncBaileysGroups,
  onSendBaileysMessage,
  onAcceptProposal,
  onDeclineProposal,
  onImportExportFile,
  onUpdateMentionStatus,
  onCreateTaskFromMention,
  onCreateCalendarEventFromMention,
  onScheduleReplyForMention,
}: Props) {
  // Navigation / view states
  const [activeTab, setActiveTab] = useState<'chats' | 'mentions' | 'proposals'>('chats');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedChatJid, setSelectedChatJid] = useState<string | null>(() => {
    return baileysThreads[0]?.chatJid ?? null;
  });
  const [selectedMentionId, setSelectedMentionId] = useState<string | null>(null);

  // Chat message composition state
  const [replyText, setReplyText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  // Import drawer/modal state
  const [showImportModal, setShowImportModal] = useState(false);
  const [groupName, setGroupName] = useState('Grup BEM FEB / Skripsi');
  const [aliasesText, setAliasesText] = useState('Arthur, @Arthur, Reezan, 312023002');
  const [pasteText, setPasteText] = useState('');
  const [importResult, setImportResult] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Categorization badge helper
  const getTopicBadge = (topic?: string) => {
    switch (topic) {
      case 'skripsi':
        return { label: '📚 Skripsi S1', bg: 'rgba(168, 85, 247, 0.15)', text: '#c084fc', border: 'rgba(168, 85, 247, 0.3)' };
      case 'rapat_organisasi':
        return { label: '🏛️ BEM FEB', bg: 'rgba(59, 130, 246, 0.15)', text: '#60a5fa', border: 'rgba(59, 130, 246, 0.3)' };
      case 'tugas_kuliah':
        return { label: '🎓 Tugas Kuliah', bg: 'rgba(245, 158, 11, 0.15)', text: '#fbbf24', border: 'rgba(245, 158, 11, 0.3)' };
      case 'ajakan_pergi':
        return { label: '☕ Hangout', bg: 'rgba(236, 72, 153, 0.15)', text: '#f472b6', border: 'rgba(236, 72, 153, 0.3)' };
      default:
        return { label: '📢 Umum', bg: 'rgba(255, 255, 255, 0.06)', text: '#94a3b8', border: 'rgba(255, 255, 255, 0.1)' };
    }
  };

  const pendingProposals = useMemo(
    () => mentions.filter((m) => m.has_event_proposal === 1 && m.proposal_status === 'pending'),
    [mentions],
  );

  const totalMentionsCount = useMemo(() => {
    const liveCount = liveWaNotifs.filter((n) => n.is_mention_tag === 1).length;
    return mentions.length + liveCount;
  }, [mentions, liveWaNotifs]);

  // Active chat thread computation
  const activeThread = useMemo(() => {
    if (!selectedChatJid) return baileysThreads[0] ?? null;
    return baileysThreads.find((t) => t.chatJid === selectedChatJid) ?? null;
  }, [selectedChatJid, baileysThreads]);

  // Active mention computation
  const activeMention = useMemo(() => {
    if (!selectedMentionId) return mentions[0] ?? null;
    return mentions.find((m) => m.id === selectedMentionId) ?? null;
  }, [selectedMentionId, mentions]);

  // Filtered threads
  const filteredThreads = useMemo(() => {
    if (!searchQuery.trim()) return baileysThreads;
    const q = searchQuery.toLowerCase();
    return baileysThreads.filter(
      (t) => t.name.toLowerCase().includes(q) || t.lastMessage.toLowerCase().includes(q) || t.chatJid.toLowerCase().includes(q),
    );
  }, [baileysThreads, searchQuery]);

  // Filtered mentions
  const filteredMentions = useMemo(() => {
    if (!searchQuery.trim()) return mentions;
    const q = searchQuery.toLowerCase();
    return mentions.filter(
      (m) =>
        m.group_name.toLowerCase().includes(q) ||
        m.sender_display.toLowerCase().includes(q) ||
        m.quoted_message.toLowerCase().includes(q),
    );
  }, [mentions, searchQuery]);

  // Matching proposal for the active chat thread
  const matchingProposal = useMemo(() => {
    if (!activeThread) return null;
    return mentions.find(
      (m) =>
        m.has_event_proposal === 1 &&
        m.proposal_status === 'pending' &&
        (activeThread.name.toLowerCase().includes(m.group_name.toLowerCase()) ||
          m.quoted_message.toLowerCase().includes(activeThread.name.toLowerCase())),
    );
  }, [activeThread, mentions]);

  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!replyText.trim() || isSending || !activeThread || !onSendBaileysMessage) return;

    setIsSending(true);
    try {
      await onSendBaileysMessage(activeThread.chatJid, replyText.trim());
      setReplyText('');
    } finally {
      setIsSending(false);
    }
  };

  const handleSyncGroups = async () => {
    if (!onSyncBaileysGroups || isSyncing) return;
    setIsSyncing(true);
    try {
      await onSyncBaileysGroups();
    } finally {
      setIsSyncing(false);
    }
  };

  const handleImportSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pasteText.trim()) return;
    setErrorMsg(null);
    try {
      const res = await onImportExportFile({
        groupName: groupName.trim() || 'Arsip Chat WhatsApp',
        fileName: 'paste.txt',
        rawText: pasteText,
        aliases: aliasesText.split(',').map((s) => s.trim()).filter(Boolean),
      });
      setImportResult(`✓ Sukses terurai ${res.totalParsedMessages} pesan · ${res.matchedTags} mention ditemukan · ${res.insertedNew} baru.`);
      setPasteText('');
      setTimeout(() => setShowImportModal(false), 2000);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal mengimpor file ekspor chat');
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-4.25rem)] gap-3 pb-2">
      {/* TOP STATUS HEADER BAR */}
      <div
        className="p-3 rounded-xl border flex flex-wrap items-center justify-between gap-3 shrink-0 backdrop-blur-md"
        style={{ background: 'var(--bg-card)', borderColor: 'var(--border-subtle)' }}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center font-bold text-lg shrink-0 shadow-sm"
            style={{
              background: baileys?.status === 'connected' ? 'rgba(0, 217, 146, 0.15)' : 'rgba(255, 255, 255, 0.05)',
              color: baileys?.status === 'connected' ? '#00d992' : '#94a3b8',
              border: `1px solid ${baileys?.status === 'connected' ? 'rgba(0, 217, 146, 0.3)' : 'rgba(255, 255, 255, 0.08)'}`,
            }}
          >
            💬
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold tracking-tight">Pusat Komunikasi WhatsApp</h2>
              <span
                className="text-[10px] font-mono-num font-semibold px-2 py-0.5 rounded-full border flex items-center gap-1.5"
                style={{
                  background:
                    baileys?.status === 'connected'
                      ? 'rgba(0, 217, 146, 0.12)'
                      : baileys?.status === 'awaiting_qr'
                        ? 'rgba(245, 158, 11, 0.15)'
                        : 'rgba(255, 255, 255, 0.05)',
                  color:
                    baileys?.status === 'connected'
                      ? '#00d992'
                      : baileys?.status === 'awaiting_qr'
                        ? '#f59e0b'
                        : '#94a3b8',
                  borderColor:
                    baileys?.status === 'connected'
                      ? 'rgba(0, 217, 146, 0.3)'
                      : baileys?.status === 'awaiting_qr'
                        ? 'rgba(245, 158, 11, 0.3)'
                        : 'var(--border-subtle)',
                }}
              >
                <span
                  className="w-1.5 h-1.5 rounded-full"
                  style={{
                    background:
                      baileys?.status === 'connected'
                        ? '#00d992'
                        : baileys?.status === 'awaiting_qr'
                          ? '#f59e0b'
                          : '#64748b',
                  }}
                />
                {baileys?.status === 'connected'
                  ? `TERHUBUNG: ${baileys.userName ?? 'Arthur Reezan'}`
                  : baileys?.status === 'awaiting_qr'
                    ? 'SCAN QR CODE DIPERLUKAN'
                    : baileys?.status === 'connecting'
                      ? 'SEDANG MENGHUBUNGKAN...'
                      : 'TERPUTUS'}
              </span>
            </div>
            <p className="text-xs text-[var(--text-muted)]">
              Driver socket Baileys background aktif · Riwayat tersimpan lokal di SQLite · Balas langsung tanpa buka HP
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {baileys?.status === 'connected' ? (
            <>
              <button
                onClick={handleSyncGroups}
                disabled={isSyncing}
                className="px-2.5 py-1.5 rounded-lg text-xs font-medium border flex items-center gap-1.5 hover:bg-white/5 transition cursor-pointer"
                style={{ background: 'var(--bg-void)', borderColor: 'var(--border-subtle)' }}
                title="Sinkronisasi ulang daftar grup WhatsApp yang Anda ikuti"
              >
                <span>{isSyncing ? '⏳' : '🔄'}</span>
                <span>{isSyncing ? 'Menyinkronkan...' : 'Sinkronkan Grup'}</span>
              </button>
              <button
                onClick={() => onDisconnectBaileys?.()}
                className="px-2.5 py-1.5 rounded-lg text-xs font-medium border border-rose-500/30 text-rose-400 hover:bg-rose-500/10 transition cursor-pointer"
              >
                Putuskan
              </button>
            </>
          ) : (
            <button
              onClick={() => onConnectBaileys?.()}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold border flex items-center gap-1.5 shadow-sm transition cursor-pointer"
              style={{
                background: 'var(--accent)',
                color: 'var(--accent-fg)',
                borderColor: 'var(--accent)',
              }}
            >
              <span>⚡</span>
              <span>Hubungkan WhatsApp Sekarang</span>
            </button>
          )}

          <button
            onClick={() => setShowImportModal(true)}
            className="px-2.5 py-1.5 rounded-lg text-xs font-medium border hover:bg-white/5 transition cursor-pointer"
            style={{ background: 'var(--bg-void)', borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
            title="Impor arsip riwayat WhatsApp .txt atau .zip"
          >
            📥 Impor Arsip Chat
          </button>
        </div>
      </div>

      {/* QR CODE PAIRING BANNER (If awaiting scan) */}
      {baileys?.status === 'awaiting_qr' && baileys.qrDataUrl && (
        <div
          className="p-4 rounded-xl border flex flex-col md:flex-row items-center gap-4 animate-in fade-in"
          style={{ background: 'rgba(0, 217, 146, 0.05)', borderColor: 'rgba(0, 217, 146, 0.3)' }}
        >
          <img
            src={baileys.qrDataUrl}
            alt="WhatsApp Pairing QR"
            className="w-40 h-40 rounded-lg border p-1 shadow-md shrink-0 bg-black"
            style={{ borderColor: 'var(--border-accent)' }}
          />
          <div className="space-y-2 text-center md:text-left">
            <h3 className="text-sm font-bold text-emerald-400">Pindai Kode QR WhatsApp</h3>
            <ol className="text-xs space-y-1 text-slate-300 list-decimal list-inside font-medium">
              <li>Buka WhatsApp di HP Android Anda</li>
              <li>Ketuk Menu titik tiga (⋮) atau Pengaturan ➔ <strong>Perangkat Tertaut (Linked Devices)</strong></li>
              <li>Ketuk <strong>Tautkan Perangkat</strong> dan arahkan kamera HP ke kode QR ini</li>
            </ol>
            <p className="text-[11px] text-slate-400">
              Koneksi terenkripsi langsung antara browser/server lokal Anda dan jaringan WhatsApp.
            </p>
          </div>
        </div>
      )}

      {/* MAIN 2-COLUMN MESSENGER INTERFACE */}
      <div className="flex-1 min-h-0 flex flex-col md:flex-row gap-3 overflow-hidden">
        {/* LEFT COLUMN: Chat & Mention Feed (w-full md:w-80 shrink-0) */}
        <div
          className="w-full md:w-84 shrink-0 rounded-xl border flex flex-col overflow-hidden"
          style={{ background: 'var(--bg-card)', borderColor: 'var(--border-subtle)' }}
        >
          {/* Segmented Filter Tabs */}
          <div className="p-2 border-b flex items-center gap-1 shrink-0" style={{ borderColor: 'var(--border-subtle)' }}>
            <button
              onClick={() => setActiveTab('chats')}
              className="flex-1 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer flex items-center justify-center gap-1.5"
              style={
                activeTab === 'chats'
                  ? { background: 'var(--accent)', color: 'var(--accent-fg)' }
                  : { background: 'transparent', color: 'var(--text-secondary)' }
              }
            >
              <span>Obrolan</span>
              {baileysThreads.length > 0 && (
                <span
                  className="px-1.5 py-0.2 rounded-full text-[10px] font-mono-num"
                  style={{
                    background: activeTab === 'chats' ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.08)',
                  }}
                >
                  {baileysThreads.length}
                </span>
              )}
            </button>

            <button
              onClick={() => setActiveTab('mentions')}
              className="flex-1 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer flex items-center justify-center gap-1.5"
              style={
                activeTab === 'mentions'
                  ? { background: 'var(--accent)', color: 'var(--accent-fg)' }
                  : { background: 'transparent', color: 'var(--text-secondary)' }
              }
            >
              <span>Mentions</span>
              {totalMentionsCount > 0 && (
                <span
                  className="px-1.5 py-0.2 rounded-full text-[10px] font-mono-num"
                  style={{
                    background: activeTab === 'mentions' ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.08)',
                  }}
                >
                  {totalMentionsCount}
                </span>
              )}
            </button>

            <button
              onClick={() => setActiveTab('proposals')}
              className="flex-1 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer flex items-center justify-center gap-1.5"
              style={
                activeTab === 'proposals'
                  ? { background: 'var(--accent)', color: 'var(--accent-fg)' }
                  : { background: 'transparent', color: 'var(--text-secondary)' }
              }
            >
              <span>Agenda</span>
              {pendingProposals.length > 0 && (
                <span className="px-1.5 py-0.2 rounded-full text-[10px] font-mono-num font-bold bg-amber-500 text-black animate-pulse">
                  {pendingProposals.length}
                </span>
              )}
            </button>
          </div>

          {/* Search bar */}
          <div className="p-2 border-b shrink-0" style={{ borderColor: 'var(--border-subtle)' }}>
            <div className="relative">
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Cari obrolan / pesan..."
                className="w-full pl-7 pr-2.5 py-1.5 rounded-lg text-xs border outline-none transition"
                style={{
                  background: 'var(--bg-void)',
                  borderColor: 'var(--border-subtle)',
                  color: 'var(--text-primary)',
                }}
              />
              <span className="absolute left-2.5 top-2 text-xs opacity-40">🔍</span>
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-1.5 text-xs text-white/40 hover:text-white"
                >
                  ✕
                </button>
              )}
            </div>
          </div>

          {/* Scrollable list */}
          <div className="flex-1 overflow-y-auto themed-scroll divide-y divide-white/5">
            {activeTab === 'chats' && (
              <>
                {filteredThreads.length === 0 ? (
                  <div className="p-6 text-center text-xs text-[var(--text-muted)] space-y-2">
                    <span className="text-2xl block">💬</span>
                    <p className="font-medium">Belum ada obrolan WhatsApp yang tercatat.</p>
                    <p className="text-[11px] opacity-75">
                      Klik tombol <strong>Sinkronkan Grup</strong> di atas untuk memuat daftar grup Anda.
                    </p>
                  </div>
                ) : (
                  filteredThreads.map((thread) => {
                    const isSelected = activeThread?.chatJid === thread.chatJid;
                    return (
                      <button
                        key={thread.chatJid}
                        onClick={() => setSelectedChatJid(thread.chatJid)}
                        className="w-full text-left p-3 flex items-start gap-2.5 transition cursor-pointer hover:bg-white/5"
                        style={
                          isSelected
                            ? {
                                background: 'var(--accent-soft)',
                                borderLeft: '3px solid var(--accent)',
                              }
                            : {}
                        }
                      >
                        <div
                          className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs shrink-0 mt-0.5"
                          style={{
                            background: thread.chatJid.endsWith('@g.us') ? 'rgba(59, 130, 246, 0.2)' : 'rgba(0, 217, 146, 0.2)',
                            color: thread.chatJid.endsWith('@g.us') ? '#60a5fa' : '#00d992',
                          }}
                        >
                          {thread.chatJid.endsWith('@g.us') ? '👥' : '👤'}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-1">
                            <span className="font-semibold text-xs truncate" style={{ color: 'var(--text-primary)' }}>
                              {thread.name}
                            </span>
                            <span className="text-[10px] font-mono-num text-[var(--text-muted)] shrink-0">
                              {thread.lastTimestamp}
                            </span>
                          </div>
                          <p className="text-xs text-[var(--text-secondary)] truncate mt-0.5">
                            {thread.lastMessage || 'Tidak ada pesan'}
                          </p>
                        </div>
                      </button>
                    );
                  })
                )}
              </>
            )}

            {activeTab === 'mentions' && (
              <>
                {filteredMentions.length === 0 ? (
                  <div className="p-6 text-center text-xs text-[var(--text-muted)] space-y-1">
                    <span className="text-2xl block">🏷️</span>
                    <p>Tidak ada mention baru.</p>
                  </div>
                ) : (
                  filteredMentions.map((mention) => {
                    const badge = getTopicBadge(mention.topic_category);
                    const isSelected = activeMention?.id === mention.id;
                    return (
                      <button
                        key={mention.id}
                        onClick={() => setSelectedMentionId(mention.id)}
                        className="w-full text-left p-3 flex flex-col gap-1.5 transition cursor-pointer hover:bg-white/5"
                        style={
                          isSelected
                            ? {
                                background: 'var(--accent-soft)',
                                borderLeft: '3px solid var(--accent)',
                              }
                            : {}
                        }
                      >
                        <div className="flex items-center justify-between gap-1">
                          <span className="font-semibold text-xs truncate" style={{ color: 'var(--text-primary)' }}>
                            {mention.sender_display}
                          </span>
                          <span
                            className="text-[10px] px-1.5 py-0.2 rounded font-semibold"
                            style={{ background: badge.bg, color: badge.text }}
                          >
                            {badge.label}
                          </span>
                        </div>
                        <div className="text-[11px] text-[var(--text-muted)] truncate">
                          Grup: {mention.group_name}
                        </div>
                        <p className="text-xs text-[var(--text-secondary)] line-clamp-2">
                          "{mention.quoted_message}"
                        </p>
                      </button>
                    );
                  })
                )}
              </>
            )}

            {activeTab === 'proposals' && (
              <>
                {pendingProposals.length === 0 ? (
                  <div className="p-6 text-center text-xs text-[var(--text-muted)] space-y-1">
                    <span className="text-2xl block">📅</span>
                    <p>Semua usulan agenda kalender telah diproses.</p>
                  </div>
                ) : (
                  pendingProposals.map((prop) => (
                    <div
                      key={prop.id}
                      className="p-3 flex flex-col gap-2 bg-amber-500/5 border-l-3 border-amber-500"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-amber-300">
                          {prop.proposed_event_title || 'Usulan Rapat / Agenda'}
                        </span>
                        <span className="text-[10px] font-mono-num text-amber-200/60 font-semibold">
                          {prop.group_name}
                        </span>
                      </div>
                      <p className="text-xs text-slate-300 italic">
                        "{prop.quoted_message}"
                      </p>
                      <div className="text-[11px] font-mono-num text-amber-200">
                        ⏰ {prop.proposed_event_start ? new Date(prop.proposed_event_start).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Jakarta' }) : '-'} WIB
                        {prop.proposed_event_location ? ` · 📍 ${prop.proposed_event_location}` : ''}
                      </div>
                      <div className="flex items-center gap-2 pt-1">
                        <button
                          onClick={() => onAcceptProposal?.(prop.id)}
                          className="flex-1 py-1 rounded text-xs font-semibold bg-emerald-500 hover:bg-emerald-400 text-black transition cursor-pointer"
                        >
                          ✓ Terima
                        </button>
                        <button
                          onClick={() => onDeclineProposal?.(prop.id)}
                          className="px-3 py-1 rounded text-xs font-medium border border-white/10 hover:bg-white/10 transition cursor-pointer"
                        >
                          Tolak
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </>
            )}
          </div>
        </div>

        {/* RIGHT COLUMN: Active Chat Conversation & Actions (flex-1) */}
        <div
          className="flex-1 min-w-0 rounded-xl border flex flex-col overflow-hidden"
          style={{ background: 'var(--bg-panel)', borderColor: 'var(--border-subtle)' }}
        >
          {activeTab === 'chats' && activeThread ? (
            <>
              {/* Chat Header */}
              <div
                className="p-3 border-b flex items-center justify-between gap-2 shrink-0 backdrop-blur-sm"
                style={{ background: 'var(--bg-card)', borderColor: 'var(--border-subtle)' }}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <div
                    className="w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm shrink-0"
                    style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
                  >
                    {activeThread.chatJid.endsWith('@g.us') ? '👥' : '👤'}
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-bold text-sm truncate" style={{ color: 'var(--text-primary)' }}>
                      {activeThread.name}
                    </h3>
                    <p className="text-[11px] font-mono-num text-[var(--text-muted)] truncate">
                      {activeThread.chatJid}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <a
                    href={`https://wa.me/${activeThread.chatJid.replace(/[^0-9]/g, '')}`}
                    target="_blank"
                    rel="noreferrer"
                    className="px-2.5 py-1 rounded-lg text-xs font-medium border hover:bg-white/5 transition"
                    style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
                    title="Buka langsung di WhatsApp Web / App"
                  >
                    wa.me ↗
                  </a>
                </div>
              </div>

              {/* Event Proposal Banner (if this chat contains a pending event) */}
              {matchingProposal && (
                <div className="p-3 m-3 rounded-xl border border-amber-500/40 bg-amber-500/10 flex flex-wrap items-center justify-between gap-2 shrink-0 animate-in fade-in">
                  <div className="space-y-0.5">
                    <div className="text-xs font-bold text-amber-300 flex items-center gap-1.5">
                      <span>📅 Usulan Agenda Kalender Terdeteksi</span>
                    </div>
                    <div className="text-xs text-amber-100 font-medium">
                      "{matchingProposal.proposed_event_title || 'Agenda Baru'}"
                    </div>
                    <div className="text-[11px] font-mono-num text-amber-200/80">
                      Waktu: {matchingProposal.proposed_event_start ? new Date(matchingProposal.proposed_event_start).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Jakarta' }) : '-'} WIB
                      {matchingProposal.proposed_event_location ? ` · Ruang: ${matchingProposal.proposed_event_location}` : ''}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => onAcceptProposal?.(matchingProposal.id)}
                      className="px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-500 hover:bg-emerald-400 text-black shadow-sm transition cursor-pointer"
                    >
                      ✓ Terima & Masukkan ke Kalender
                    </button>
                    <button
                      onClick={() => onDeclineProposal?.(matchingProposal.id)}
                      className="px-2.5 py-1.5 rounded-lg text-xs font-medium border border-white/20 hover:bg-white/10 transition cursor-pointer"
                    >
                      Tolak
                    </button>
                  </div>
                </div>
              )}

              {/* Messages Stream */}
              <div className="flex-1 overflow-y-auto themed-scroll p-4 space-y-3">
                {activeThread.messages.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center p-6 text-[var(--text-muted)] space-y-2">
                    <span className="text-3xl">💬</span>
                    <p className="text-xs font-medium">Belum ada riwayat pesan langsung di thread ini.</p>
                    <p className="text-[11px] opacity-70 max-w-xs">
                      Pesan baru yang dikirim atau diterima melalui WhatsApp akan otomatis tampil di sini secara real-time.
                    </p>
                  </div>
                ) : (
                  activeThread.messages.map((msg) => {
                    const isMe = msg.isFromMe;
                    return (
                      <div
                        key={msg.id}
                        className={`flex flex-col ${isMe ? 'items-end' : 'items-start'} animate-in fade-in`}
                      >
                        <div className="text-[10px] font-mono-num text-[var(--text-muted)] px-1 mb-0.5">
                          {isMe ? 'Anda (Arthur)' : msg.senderName} · {msg.timestamp}
                        </div>
                        <div
                          className="max-w-[85%] md:max-w-[70%] p-3 rounded-2xl text-xs leading-relaxed break-words shadow-sm"
                          style={
                            isMe
                              ? {
                                  background: 'var(--accent)',
                                  color: 'var(--accent-fg)',
                                  borderBottomRightRadius: '4px',
                                }
                              : {
                                  background: 'var(--bg-elevated)',
                                  color: 'var(--text-primary)',
                                  border: '1px solid var(--border-subtle)',
                                  borderBottomLeftRadius: '4px',
                                }
                          }
                        >
                          {msg.text}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Message Composer Bar */}
              <form
                onSubmit={handleSendMessage}
                className="p-3 border-t flex items-center gap-2 shrink-0 backdrop-blur-md"
                style={{ background: 'var(--bg-card)', borderColor: 'var(--border-subtle)' }}
              >
                <input
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  placeholder={`Ketik pesan WhatsApp ke ${activeThread.name}...`}
                  disabled={isSending}
                  className="flex-1 min-w-0 px-3.5 py-2 rounded-xl text-xs border outline-none transition"
                  style={{
                    background: 'var(--bg-void)',
                    borderColor: 'var(--border-subtle)',
                    color: 'var(--text-primary)',
                  }}
                />
                <button
                  type="submit"
                  disabled={isSending || !replyText.trim()}
                  className="px-4 py-2 rounded-xl text-xs font-bold transition cursor-pointer flex items-center gap-1.5 shadow-sm disabled:opacity-40"
                  style={{
                    background: 'var(--accent)',
                    color: 'var(--accent-fg)',
                  }}
                >
                  <span>{isSending ? '⏳' : 'Kirim'}</span>
                  <span>↗</span>
                </button>
              </form>
            </>
          ) : activeTab === 'mentions' && activeMention ? (
            /* Mention Detail & 1-Click Action View */
            <div className="flex-1 flex flex-col p-5 overflow-y-auto themed-scroll space-y-4">
              <div className="flex items-center justify-between pb-3 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
                <div>
                  <h3 className="text-sm font-bold text-[var(--text-primary)]">
                    Pesan dari {activeMention.sender_display}
                  </h3>
                  <p className="text-xs text-[var(--text-muted)] font-mono-num">
                    Grup: {activeMention.group_name} · {new Date(activeMention.message_timestamp).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' })} WIB
                  </p>
                </div>
                <span
                  className="px-2.5 py-1 rounded-full text-xs font-semibold"
                  style={getTopicBadge(activeMention.topic_category)}
                >
                  {getTopicBadge(activeMention.topic_category).label}
                </span>
              </div>

              {/* Quoted Message Card */}
              <div className="p-4 rounded-xl border border-white/10 bg-white/5 space-y-2">
                <div className="text-xs text-[var(--text-muted)] font-mono-num uppercase">Kutipan Pesan:</div>
                <p className="text-sm leading-relaxed text-[var(--text-primary)] whitespace-pre-wrap font-sans">
                  "{activeMention.quoted_message}"
                </p>
              </div>

              {/* 1-Click Actions Grid */}
              <div className="space-y-2">
                <div className="text-xs font-mono-num text-[var(--text-muted)] uppercase tracking-wider">
                  Tindakan Cepat (1-Klik):
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <button
                    onClick={() => onCreateTaskFromMention(activeMention)}
                    className="p-3 rounded-xl border text-left hover:border-emerald-500/50 transition cursor-pointer bg-black/20"
                    style={{ borderColor: 'var(--border-subtle)' }}
                  >
                    <div className="text-sm">🗂️ Buat Tugas ClickUp</div>
                    <div className="text-[11px] text-[var(--text-muted)] mt-1">
                      Jadikan tugas bertenggat di list aktif
                    </div>
                  </button>

                  <button
                    onClick={() => onCreateCalendarEventFromMention(activeMention)}
                    className="p-3 rounded-xl border text-left hover:border-cyan-500/50 transition cursor-pointer bg-black/20"
                    style={{ borderColor: 'var(--border-subtle)' }}
                  >
                    <div className="text-sm">📅 Masukkan Kalender</div>
                    <div className="text-[11px] text-[var(--text-muted)] mt-1">
                      Jadwalkan agenda di kalender Llamrei
                    </div>
                  </button>

                  <button
                    onClick={() => onScheduleReplyForMention(activeMention)}
                    className="p-3 rounded-xl border text-left hover:border-purple-500/50 transition cursor-pointer bg-black/20"
                    style={{ borderColor: 'var(--border-subtle)' }}
                  >
                    <div className="text-sm">⏱️ Jadwalkan Balasan</div>
                    <div className="text-[11px] text-[var(--text-muted)] mt-1">
                      Llamrei susun draf balasan terjadwal
                    </div>
                  </button>
                </div>
              </div>

              {/* Mark Status */}
              <div className="pt-3 border-t flex items-center justify-between" style={{ borderColor: 'var(--border-subtle)' }}>
                <span className="text-xs text-[var(--text-muted)]">Status Tanggapan:</span>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => onUpdateMentionStatus(activeMention.id, 'replied')}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-500/30 transition cursor-pointer"
                  >
                    ✓ Tandai Sudah Ditanggapi
                  </button>
                  <button
                    onClick={() => onUpdateMentionStatus(activeMention.id, 'ignored')}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium border border-white/10 hover:bg-white/10 transition cursor-pointer"
                  >
                    Abaikan
                  </button>
                </div>
              </div>
            </div>
          ) : (
            /* Empty State */
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-[var(--text-muted)] space-y-3">
              <div className="w-16 h-16 rounded-2xl flex items-center justify-center text-3xl bg-white/5 border border-white/10">
                💬
              </div>
              <h3 className="text-base font-bold text-[var(--text-primary)]">
                Pilih Obrolan atau Mention WhatsApp
              </h3>
              <p className="text-xs max-w-sm">
                Pilih obrolan aktif dari panel sebelah kiri untuk membaca riwayat, melihat usulan agenda, dan membalas langsung secara real-time.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* IMPORT CHAT ARCHIVE MODAL (Collapsible overlay) */}
      {showImportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4 animate-in fade-in">
          <div
            className="w-full max-w-lg rounded-2xl border p-5 space-y-4 shadow-2xl"
            style={{ background: 'var(--bg-panel)', borderColor: 'var(--border-subtle)' }}
          >
            <div className="flex items-center justify-between pb-3 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
              <div className="flex items-center gap-2">
                <span className="text-lg">📥</span>
                <h3 className="text-sm font-bold text-[var(--text-primary)]">Impor Riwayat Ekspor WhatsApp (.txt / .zip)</h3>
              </div>
              <button
                onClick={() => setShowImportModal(false)}
                className="text-white/50 hover:text-white p-1 text-sm cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleImportSubmit} className="space-y-3">
              <div>
                <label className="text-xs font-mono-num text-[var(--text-muted)] block mb-1">
                  Nama Grup / Obrolan:
                </label>
                <input
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                  placeholder="Contoh: Grup Skripsi & BEM FEB"
                  className="w-full px-3 py-1.5 rounded-lg text-xs border outline-none"
                  style={{ background: 'var(--bg-void)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
                />
              </div>

              <div>
                <label className="text-xs font-mono-num text-[var(--text-muted)] block mb-1">
                  Alias Panggilan Arthur (pisahkan koma):
                </label>
                <input
                  value={aliasesText}
                  onChange={(e) => setAliasesText(e.target.value)}
                  placeholder="Arthur, @Arthur, Reezan, 312023002"
                  className="w-full px-3 py-1.5 rounded-lg text-xs border outline-none"
                  style={{ background: 'var(--bg-void)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
                />
              </div>

              <div>
                <label className="text-xs font-mono-num text-[var(--text-muted)] block mb-1">
                  Tempel Teks Ekspor WhatsApp (.txt):
                </label>
                <textarea
                  value={pasteText}
                  onChange={(e) => setPasteText(e.target.value)}
                  rows={4}
                  placeholder="Tempel beberapa baris atau seluruh teks hasil ekspor chat WhatsApp di sini..."
                  className="w-full px-3 py-2 rounded-lg text-xs border outline-none font-mono-num"
                  style={{ background: 'var(--bg-void)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
                />
              </div>

              {importResult && (
                <div className="p-2.5 rounded-lg text-xs font-mono-num bg-emerald-500/10 text-emerald-300 border border-emerald-500/30">
                  {importResult}
                </div>
              )}
              {errorMsg && (
                <div className="p-2.5 rounded-lg text-xs font-mono-num bg-rose-500/10 text-rose-300 border border-rose-500/30">
                  {errorMsg}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                <button
                  type="button"
                  onClick={() => setShowImportModal(false)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium border hover:bg-white/5 cursor-pointer"
                  style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={!pasteText.trim()}
                  className="px-4 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer disabled:opacity-40"
                  style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
                >
                  Urai & Simpan ke Inbox
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
