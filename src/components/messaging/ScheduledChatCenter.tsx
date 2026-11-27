import { useState } from 'react';
import type { ContactItem, ScheduledMessageItem } from '../../types/llamrei';

interface Props {
  messages: ScheduledMessageItem[];
  contacts: ContactItem[];
  onCreateDraft: (input: {
    contactId?: string | null;
    recipientName: string;
    recipientAddress: string;
    channel: ScheduledMessageItem['channel'];
    purpose: string;
    messageBody: string;
    scheduledAt: string;
  }) => Promise<void>;
  onApproveMessage: (msgId: string, edits?: { messageBody?: string; scheduledAt?: string }) => Promise<void>;
  onUpdateMessageStatus: (msgId: string, status: 'sent_manual_confirmed' | 'cancelled') => Promise<void>;
  onCreateContact: (input: { name: string; phoneE164: string; activeHoursNote?: string }) => Promise<void>;
}

export function ScheduledChatCenter({
  messages,
  contacts,
  onCreateDraft,
  onApproveMessage,
  onUpdateMessageStatus,
  onCreateContact,
}: Props) {
  const [selectedContactId, setSelectedContactId] = useState(contacts[0]?.id ?? '');
  const [purpose, setPurpose] = useState('');
  const [messageBody, setMessageBody] = useState('');
  const [scheduledTime, setScheduledTime] = useState('');
  const [channel, setChannel] = useState<ScheduledMessageItem['channel']>('nectarlink_bridge');

  const [newContactName, setNewContactName] = useState('');
  const [newContactPhone, setNewContactPhone] = useState('');
  const [newContactHours, setNewContactHours] = useState('');

  const handleCompose = async (e: React.FormEvent) => {
    e.preventDefault();
    const contact = contacts.find((c) => c.id === selectedContactId);
    if (!contact || !messageBody.trim() || !scheduledTime) return;
    await onCreateDraft({
      contactId: contact.id,
      recipientName: contact.name,
      recipientAddress: contact.phone_e164,
      channel,
      purpose: purpose.trim() || 'Pesan Terjadwal',
      messageBody: messageBody.trim(),
      scheduledAt: new Date(scheduledTime).toISOString(),
    });
    setPurpose('');
    setMessageBody('');
  };

  return (
    <div className="space-y-3">
      <div className="pb-2 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
        <div className="text-xs font-mono-num" style={{ color: '#fbbf24' }}>
          OUTBOUND GATEKEEPER // APPROVE-THEN-AUTO-SEND (FR-22..26)
        </div>
        <h1 className="text-sm font-bold">Penjadwalan Chat Otomatis & Buku Kontak</h1>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-3">
        {/* Compose + Queue */}
        <div className="xl:col-span-8 space-y-3">
          <form onSubmit={(e) => void handleCompose(e)} className="themed-card p-3 space-y-2 text-xs">
            <div className="font-mono-num font-bold" style={{ color: 'var(--text-secondary)' }}>
              + BUAT JADWAL CHAT BARU (MASUK PENDING APPROVAL)
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <select
                value={selectedContactId}
                onChange={(e) => setSelectedContactId(e.target.value)}
                className="px-2 py-1.5 rounded border"
                style={{ background: 'var(--bg-void)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
              >
                {contacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.phone_e164})
                  </option>
                ))}
              </select>
              <input
                type="datetime-local"
                value={scheduledTime}
                onChange={(e) => setScheduledTime(e.target.value)}
                className="px-2 py-1.5 rounded border font-mono-num"
                style={{ background: 'var(--bg-void)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
              />
              <select
                value={channel}
                onChange={(e) => setChannel(e.target.value as ScheduledMessageItem['channel'])}
                className="px-2 py-1.5 rounded border"
                style={{ background: 'var(--bg-void)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
              >
                <option value="nectarlink_bridge">NectarLink Bridge + wa.me</option>
                <option value="wa_gateway">WA Gateway Webhook (Auto)</option>
                <option value="telegram">Telegram Bot API (Auto)</option>
                <option value="wa_me_manual">wa.me Manual 1-Klik</option>
              </select>
            </div>
            <input
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              placeholder="Tujuan pesan (mis. Konfirmasi revisi slide)..."
              className="w-full px-2.5 py-1.5 rounded border outline-none"
              style={{ background: 'var(--bg-void)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
            />
            <textarea
              rows={2}
              value={messageBody}
              onChange={(e) => setMessageBody(e.target.value)}
              placeholder="Isi draf pesan..."
              className="w-full px-2.5 py-1.5 rounded border outline-none"
              style={{ background: 'var(--bg-void)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
            />
            <button type="submit" className="px-3 py-1.5 rounded font-mono-num font-bold cursor-pointer" style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}>
              Simpan Draf ke Antrean Approval
            </button>
          </form>

          {/* Messages Queue */}
          <div className="space-y-2">
            {messages.map((m) => {
              const isPending = m.status === 'pending_approval';
              const isApproved = m.status === 'approved';
              const isFallbackReady = m.status === 'reminded_fallback';
              const hasUnconfirmedOutcome = m.status === 'failed';
              return (
                <div key={m.id} className="themed-card p-3 space-y-2 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <span className="font-bold text-sm">{m.recipient_name}</span>{' '}
                      <span className="font-mono-num" style={{ color: 'var(--text-muted)' }}>
                        · {new Date(m.scheduled_at).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'short', timeStyle: 'short' })} WIB
                      </span>
                    </div>
                    <span
                      className="px-2 py-0.5 rounded font-mono-num font-bold border"
                      style={
                        isPending
                          ? { background: 'rgba(245,158,11,0.18)', color: '#fbbf24', borderColor: 'rgba(245,158,11,0.4)' }
                          : isApproved
                            ? { background: 'var(--accent-soft)', color: 'var(--accent)', borderColor: 'var(--border-accent)' }
                            : { background: 'var(--bg-elevated)', color: 'var(--text-secondary)', borderColor: 'var(--border-subtle)' }
                      }
                    >
                      {hasUnconfirmedOutcome ? 'PENGIRIMAN BELUM TERKONFIRMASI' : m.status.toUpperCase()}
                    </span>
                  </div>

                  <div className="bg-black/25 p-2 rounded italic" style={{ color: 'var(--text-secondary)' }}>
                    "{m.message_body}"
                  </div>
                  {hasUnconfirmedOutcome && (
                    <p style={{ color: 'var(--text-secondary)' }}>
                      Periksa kanal pengiriman sebelum mengirim ulang atau menandai pesan sebagai terkirim.
                    </p>
                  )}

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                    <span className="font-mono-num" style={{ color: 'var(--text-muted)' }}>
                      Channel: {m.channel} · Tujuan: {m.purpose}
                    </span>
                    <div className="flex items-center gap-2">
                      {isPending && (
                        <button
                          onClick={() => void onApproveMessage(m.id)}
                          className="px-2.5 py-1 rounded font-mono-num font-bold cursor-pointer"
                          style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
                        >
                          ✓ Approve & Jadwalkan
                        </button>
                      )}
                      {(isPending || isFallbackReady) && (
                        <a
                          href={m.waMeUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="px-2.5 py-1 rounded font-mono-num border"
                          style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)', color: 'var(--accent-2)' }}
                        >
                          Fallback wa.me ↗
                        </a>
                      )}
                      {(isPending || isApproved || isFallbackReady || hasUnconfirmedOutcome) && (
                        <button
                          onClick={() => void onUpdateMessageStatus(m.id, 'sent_manual_confirmed')}
                          className="px-2 py-1 rounded font-mono-num border cursor-pointer"
                          style={{ borderColor: 'var(--border-subtle)' }}
                        >
                          Tandai Terkirim
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Contact Book */}
        <div className="xl:col-span-4 themed-card p-3 space-y-3 text-xs h-fit">
          <div className="font-mono-num font-bold" style={{ color: 'var(--text-secondary)' }}>
            📒 BUKU KONTAK & JAM AKTIF ({contacts.length})
          </div>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!newContactName.trim() || !newContactPhone.trim()) return;
              await onCreateContact({
                name: newContactName.trim(),
                phoneE164: newContactPhone.trim(),
                activeHoursNote: newContactHours.trim() || undefined,
              });
              setNewContactName('');
              setNewContactPhone('');
              setNewContactHours('');
            }}
            className="space-y-1.5 bg-black/25 p-2 rounded"
          >
            <input
              value={newContactName}
              onChange={(e) => setNewContactName(e.target.value)}
              placeholder="Nama kontak..."
              className="w-full px-2 py-1 rounded border outline-none"
              style={{ background: 'var(--bg-void)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
            />
            <input
              value={newContactPhone}
              onChange={(e) => setNewContactPhone(e.target.value)}
              placeholder="Nomor WA (mis. 62812...)"
              className="w-full px-2 py-1 rounded border font-mono-num outline-none"
              style={{ background: 'var(--bg-void)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
            />
            <input
              value={newContactHours}
              onChange={(e) => setNewContactHours(e.target.value)}
              placeholder="Catatan jam aktif (mis. 08:00-20:00 WIB)"
              className="w-full px-2 py-1 rounded border outline-none"
              style={{ background: 'var(--bg-void)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
            />
            <button type="submit" className="w-full py-1 rounded font-bold cursor-pointer" style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}>
              + Tambah Kontak
            </button>
          </form>

          <div className="space-y-1.5">
            {contacts.map((c) => (
              <div key={c.id} className="bg-black/25 p-2 rounded space-y-0.5">
                <div className="font-semibold">{c.name}</div>
                <div className="font-mono-num" style={{ color: 'var(--accent-2)' }}>
                  +{c.phone_e164}
                </div>
                {c.active_hours_note && <div style={{ color: 'var(--text-muted)' }}>Jam aktif: {c.active_hours_note}</div>}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
