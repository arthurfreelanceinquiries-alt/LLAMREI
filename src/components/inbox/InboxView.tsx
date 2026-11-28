import { ArrowLeft, Clock, Inbox, RefreshCw, SendHorizontal } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { INBOX_SOURCES, type InboxDetail, type InboxReceipt, type InboxSnapshot, type InboxSource, type InboxThread } from '../../../shared/inbox';
import { apiErrorMessage, apiRequest } from '../../lib/api-client';
import { formatWibStamp, wibDateTimeInput, wibDateTimeToIso } from '../../lib/calendar-time';
import type { ContactItem } from '../../types/llamrei';
import { Control } from '../ui/Control';
import { DialogPanel } from '../ui/DialogPanel';

const sourceLabels: Record<InboxSource, string> = {
  whatsapp: 'WhatsApp', whatsapp_import: 'Impor WhatsApp', whatsapp_device: 'Notifikasi WhatsApp',
  telegram_device: 'Notifikasi Telegram', gmail: 'Gmail',
};
const receiptLabels: Record<InboxReceipt['state'], string> = {
  pending: 'Perlu persetujuan', queued: 'Terjadwal', sending: 'Sedang diproses', sent: 'Terkonfirmasi dikirim', manual: 'Dikonfirmasi pengguna',
  handoff: 'Pengingat / serah terima', cancelled: 'Dibatalkan', failed: 'Gagal', unknown: 'Hasil belum diketahui',
};

export function InboxView({ contacts, version, onOpenIntegrations, onOpenScheduled }: {
  contacts: ContactItem[]; version: number; onOpenIntegrations: () => void; onOpenScheduled: () => void;
}) {
  const [query, setQuery] = useState('');
  const [source, setSource] = useState<InboxSource | ''>('');
  const [filter, setFilter] = useState<'all' | 'unread' | 'followUp'>('all');
  const [snapshot, setSnapshot] = useState<InboxSnapshot>();
  const [selected, setSelected] = useState('');
  const [detail, setDetail] = useState<InboxDetail>();
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState('');
  const [detailError, setDetailError] = useState('');
  const [syncError, setSyncError] = useState('');
  const [syncing, setSyncing] = useState(false);
  const threadPanel = useRef<HTMLElement>(null);
  const lastThreadButton = useRef<HTMLButtonElement>(null);
  const searchField = useRef<HTMLInputElement>(null);
  const reload = () => setRefresh((value) => value + 1);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setListError('');
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ q: query, source });
      if (filter !== 'all') params.set(filter, '1');
      void apiRequest<InboxSnapshot>(`/api/inbox?${params}`, { signal: controller.signal }).then((result) => {
        if (!controller.signal.aborted) setSnapshot(result);
      }).catch((error) => { if (!controller.signal.aborted) setListError(apiErrorMessage(error, 'Inbox belum dapat dimuat.')); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, query ? 140 : 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query, source, filter, refresh, version]);

  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    setDetailError('');
    void apiRequest<InboxDetail>(`/api/inbox/threads/${selected}`, { signal: controller.signal }).then((result) => {
      if (!controller.signal.aborted) setDetail(result);
    }).catch((error) => {
      if (!controller.signal.aborted) {
        setDetail(undefined);
        setDetailError(apiErrorMessage(error, 'Percakapan belum dapat dibuka.'));
      }
    });
    return () => controller.abort();
  }, [selected, refresh, version]);

  useEffect(() => {
    if (selected) {
      threadPanel.current?.focus();
    } else if (lastThreadButton.current) {
      const target = lastThreadButton.current.isConnected ? lastThreadButton.current : searchField.current;
      lastThreadButton.current = null;
      target?.focus();
    }
  }, [selected]);

  async function syncMail() {
    if (syncing) return;
    setSyncing(true);
    setSyncError('');
    try {
      await apiRequest('/api/inbox/gmail/sync', { method: 'POST', body: {} });
    } catch (error) {
      setSyncError(apiErrorMessage(error, 'Gmail belum dapat disinkronkan.'));
    } finally {
      setSyncing(false);
      reload();
    }
  }

  const current = detail?.thread.id === selected ? detail : undefined;
  return (
    <div className="mx-auto min-w-0 max-w-[90rem] space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Inbox</h1><p className="mt-1 text-sm text-[var(--text-secondary)]">Tinjau pesan dan tindak lanjut kontak dari satu tempat.</p></div>
        <Control className="ds-control--outline" onClick={reload}><RefreshCw aria-hidden="true" /> Muat ulang</Control>
      </header>

      <section aria-label="Status sumber" className="themed-card flex flex-wrap items-center justify-between gap-2 p-3 sm:p-4">
        <div className="min-w-0 space-y-1 text-sm [overflow-wrap:anywhere]">
          {snapshot && <p className="font-medium">WhatsApp · {snapshot.whatsapp === 'connected' ? 'Terhubung' : 'Arsip lokal'}</p>}
          {snapshot && <p className="text-[var(--text-secondary)]">
            Gmail · {snapshot.gmail.lastSyncedAt ? `Disinkronkan ${formatWibStamp(snapshot.gmail.lastSyncedAt)}`
              : snapshot.gmail.state === 'ready' ? 'Siap disinkronkan' : 'Akun aktif diperlukan'}
            {snapshot.gmail.lastOutcome && snapshot.gmail.lastOutcome !== 'success' && ' · Percobaan terakhir belum terverifikasi'}
          </p>}
        </div>
        {snapshot && (snapshot.gmail.state === 'ready'
          ? <Control className="ds-control--outline" disabled={syncing} onClick={() => void syncMail()}>{syncing ? 'Menyinkronkan…' : 'Sinkronkan Gmail'}</Control>
          : <Control className="ds-control--outline" onClick={onOpenIntegrations}>Buka integrasi</Control>)}
        {syncError && <p role="alert" className="ds-note w-full">{syncError}</p>}
      </section>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,19rem)_minmax(0,1fr)]">
        <section aria-label="Daftar percakapan" className={`themed-card min-w-0 overflow-hidden ${selected ? 'hidden lg:block' : ''}`}>
          <div className="space-y-2 border-b border-[var(--border-subtle)] p-3">
            <input ref={searchField} type="search" aria-label="Cari percakapan" className="ds-field" maxLength={200} placeholder="Cari percakapan" value={query} onChange={(event) => setQuery(event.target.value)} />
            <label className="ds-label">Sumber<select className="ds-field" value={source} onChange={(event) => setSource(event.target.value as InboxSource | '')}>
              <option value="">Semua sumber</option>{INBOX_SOURCES.map((source) => <option key={source} value={source}>{sourceLabels[source]}</option>)}
            </select></label>
            <div role="group" aria-label="Filter percakapan" className="flex flex-wrap gap-1">
              <Control className="ds-segment" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>Semua</Control>
              <Control className="ds-segment" aria-pressed={filter === 'unread'} onClick={() => setFilter('unread')}>Belum dibaca</Control>
              <Control className="ds-segment" aria-pressed={filter === 'followUp'} onClick={() => setFilter('followUp')}>Tindak lanjut</Control>
            </div>
          </div>
          {loading && <p role="status" className="p-3 text-sm text-[var(--text-secondary)]">Memuat percakapan…</p>}
          {listError && <p role="alert" className="ds-note m-3">{listError}</p>}
          {!loading && !listError && !snapshot?.threads.length && <p className="p-4 text-sm text-[var(--text-secondary)]">Belum ada percakapan untuk filter ini.</p>}
          {snapshot?.threads.length ? (
            <ul className="divide-y divide-[var(--border-subtle)]">
              {snapshot.threads.map((thread) => (
                <li key={thread.id}>
                  <button type="button" aria-current={selected === thread.id ? 'true' : undefined} onClick={(event) => { lastThreadButton.current = event.currentTarget; setSelected(thread.id); }}
                    className="w-full space-y-1 px-3 py-3 text-left hover:bg-[var(--bg-elevated)] aria-current:bg-[var(--accent-soft)]">
                    <span className="block truncate text-sm font-semibold">{thread.title}</span>
                    <span className="block text-xs text-[var(--text-secondary)]">{sourceLabels[thread.source]}{thread.unread && ' · Belum dibaca'}</span>
                    <span className="block truncate text-sm text-[var(--text-secondary)]">{thread.preview || 'Isi pesan tidak tersedia'}</span>
                    {thread.followUpAt && <span className="block text-xs text-[var(--accent)]">Tindak lanjut {formatWibStamp(thread.followUpAt)}</span>}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
        <section ref={threadPanel} tabIndex={-1} aria-label="Percakapan terpilih" className={`themed-card min-w-0 ${!selected ? 'hidden lg:block' : ''}`}>
          {selected ? (
            <>
              <div className="p-2 lg:hidden"><Control className="ds-control--outline" onClick={() => setSelected('')}><ArrowLeft aria-hidden="true" /> Kembali ke inbox</Control></div>
              {detailError && <p role="alert" className="ds-note m-3">{detailError}</p>}
              {!current && !detailError && <p role="status" className="p-4 text-sm">Memuat isi percakapan…</p>}
              {current && <ThreadPanel key={selected} detail={current} contacts={contacts} onUpdated={(detail) => { setDetail(detail); reload(); }} onOpenScheduled={onOpenScheduled} />}
            </>
          ) : <div className="grid min-h-72 place-content-center gap-2 px-5 text-center text-sm text-[var(--text-secondary)]"><Inbox aria-hidden="true" className="mx-auto" /><p>Pilih percakapan untuk melihat pesan dan tindak lanjut.</p></div>}
        </section>
      </div>
    </div>
  );
}

function ThreadPanel({ detail, contacts, onUpdated, onOpenScheduled }: {
  detail: InboxDetail; contacts: ContactItem[]; onUpdated: (detail: InboxDetail) => void; onOpenScheduled: () => void;
}) {
  const { thread, messages, receipts } = detail;
  const [contactId, setContactId] = useState(thread.contactId ?? '');
  const [followUp, setFollowUp] = useState(thread.followUpAt ? wibDateTimeInput(thread.followUpAt) : '');
  const [note, setNote] = useState(thread.note);
  const [baseRevision, setBaseRevision] = useState(thread.revision);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [draftOpen, setDraftOpen] = useState(false);
  const contact = contacts.find(({ id }) => id === thread.contactId);
  const address = contact?.preferred_channel === 'telegram' ? contact.telegram_chat_id : contact?.phone_e164;

  async function update(fields: Record<string, unknown>, revision: number, message: string) {
    if (pending) return;
    setPending(true);
    setError('');
    setNotice('');
    try {
      const result = await apiRequest<InboxDetail>(`/api/inbox/threads/${thread.id}`, { method: 'PATCH', body: { ...fields, revision } });
      setBaseRevision((value) => value === revision ? result.thread.revision : value);
      setNotice(message);
      onUpdated(result);
    } catch (error) {
      setError(apiErrorMessage(error, 'Perubahan inbox belum dapat disimpan.'));
    } finally { setPending(false); }
  }

  return (
    <div className="min-w-0 space-y-4 p-3 sm:p-4">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-subtle)] pb-3">
        <div className="min-w-0 [overflow-wrap:anywhere]"><h2 className="text-lg font-semibold">{thread.title}</h2><p className="text-sm text-[var(--text-secondary)]">{sourceLabels[thread.source]}</p></div>
        {thread.unread && <Control disabled={pending} onClick={() => void update({ markRead: true, seenMessageId: messages.filter(({ outbound }) => !outbound).at(-1)?.id ?? null }, thread.revision, 'Percakapan ditandai dibaca di inbox.')}>Tandai dibaca</Control>}
      </header>
      <ol aria-label="Pesan" className="space-y-2">
        {messages.map((message) => <li key={message.id} className={`rounded-lg px-3 py-2 [overflow-wrap:anywhere] ${message.outbound ? 'ml-4 bg-[var(--accent-soft)]' : 'bg-[var(--bg-elevated)]'}`}>
          <div className="flex flex-wrap justify-between gap-1 text-xs text-[var(--text-secondary)]"><span className="font-medium">{message.outbound ? 'Pesan keluar' : message.sender}</span><time dateTime={message.at}>{formatWibStamp(message.at)}</time></div>
          <p className="mt-1 whitespace-pre-wrap text-sm">{message.text || 'Isi pesan tidak tersedia.'}</p>
        </li>)}
      </ol>
      <form className="space-y-3 border-t border-[var(--border-subtle)] pt-3" onSubmit={(event) => {
        event.preventDefault();
        void update({ contactId: contactId || null, followUpAt: followUp ? wibDateTimeToIso(followUp) : null, note }, baseRevision, 'Tindak lanjut disimpan.');
      }}>
        <h3 className="flex items-center gap-2 font-semibold"><Clock size={16} aria-hidden="true" /> Tindak lanjut</h3>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="ds-label">Kontak tertaut<select className="ds-field" value={contactId} onChange={(event) => setContactId(event.target.value)}>
            <option value="">Tanpa kontak</option>{contacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.name}</option>)}
          </select></label>
          <label className="ds-label">Jadwal tindak lanjut (WIB)<input className="ds-field" type="datetime-local" value={followUp} onChange={(event) => setFollowUp(event.target.value)} /></label>
        </div>
        <label className="ds-label">Catatan tindak lanjut<textarea className="ds-field resize-y" maxLength={1600} rows={2} value={note} onChange={(event) => setNote(event.target.value)} /></label>
        {error && <p role="alert" className="ds-note">{error}</p>}
        {notice && <p role="status" className="ds-note">{notice}</p>}
        <div className="flex flex-wrap gap-2">
          <Control type="submit" disabled={pending} className="ds-control--primary">{pending ? 'Menyimpan…' : 'Simpan tindak lanjut'}</Control>
          {contact && address && contact.preferred_channel !== 'email' && <Control className="ds-control--outline" onClick={() => setDraftOpen(true)}><SendHorizontal aria-hidden="true" /> Buat draf pesan</Control>}
        </div>
      </form>
      {!!receipts.length && <section className="space-y-2 border-t border-[var(--border-subtle)] pt-3" aria-label="Pengiriman kontak">
        <h3 className="font-semibold">Pengiriman kontak</h3>
        <ul className="space-y-1">{receipts.map((receipt) => <li key={receipt.id} className="rounded-lg bg-[var(--bg-elevated)] p-2 text-sm [overflow-wrap:anywhere]">
          <p className="line-clamp-2">{receipt.body}</p><p className="text-xs text-[var(--text-secondary)]">{receiptLabels[receipt.state]} · {formatWibStamp(receipt.sentAt ?? receipt.scheduledAt)}</p>
        </li>)}</ul>
        <Control onClick={onOpenScheduled}>Buka pesan terjadwal</Control>
      </section>}
      {draftOpen && contact && address && <DraftDialog thread={thread} contact={contact} address={address} onClose={() => setDraftOpen(false)} onOpenScheduled={onOpenScheduled} onUpdated={onUpdated} />}
    </div>
  );
}

function DraftDialog({ thread, contact, address, onClose, onOpenScheduled, onUpdated }: {
  thread: InboxThread; contact: ContactItem; address: string;
  onClose: () => void; onOpenScheduled: () => void; onUpdated: (detail: InboxDetail) => void;
}) {
  const [body, setBody] = useState('');
  const [date, setDate] = useState(() => wibDateTimeInput(new Date(Date.now() + 3_600_000)));
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || saved) return;
    setBusy(true);
    setError('');
    try {
      await apiRequest(`/api/inbox/threads/${thread.id}/drafts`, { method: 'POST', body: { requestId, revision: thread.revision, body, scheduledAt: wibDateTimeToIso(date) } });
      setSaved(true);
      const detail = await apiRequest<InboxDetail>(`/api/inbox/threads/${thread.id}`).catch(() => null);
      if (detail) onUpdated(detail);
    } catch (error) { setError(apiErrorMessage(error, 'Draf belum dapat dibuat.')); }
    finally { setBusy(false); }
  }
  return <DialogPanel label="Draf tindak lanjut" className="workspace-form-dialog" onClose={() => { if (!busy) onClose(); }}>
    <form className="space-y-3 p-4 sm:p-5" onSubmit={(event) => void save(event)}>
      <h2 className="text-lg font-semibold">Draf tindak lanjut</h2>
      <p className="rounded-lg bg-[var(--bg-elevated)] p-3 text-sm [overflow-wrap:anywhere]">{contact.name} · {address} · {contact.preferred_channel === 'telegram' ? 'Telegram' : 'WhatsApp'}</p>
      {saved ? <p role="status" className="ds-note">Draf tersimpan dan menunggu persetujuan di Pesan Terjadwal.</p> : <>
        <label className="ds-label">Isi draf<textarea className="ds-field resize-y" required rows={4} maxLength={5000} value={body} onChange={(event) => { setBody(event.target.value); setRequestId(crypto.randomUUID()); }} /></label>
        <label className="ds-label">Jadwal kirim (WIB)<input type="datetime-local" className="ds-field" required value={date} onChange={(event) => { setDate(event.target.value); setRequestId(crypto.randomUUID()); }} /></label>
      </>}
      {error && <p role="alert" className="ds-note">{error}</p>}
      <div className="flex flex-wrap justify-end gap-2 pt-2">
        <Control disabled={busy} onClick={onClose}>Tutup</Control>
        {saved ? <Control className="ds-control--primary" onClick={onOpenScheduled}>Tinjau di Pesan Terjadwal</Control> : <Control className="ds-control--primary" type="submit" disabled={busy}>{busy ? 'Menyimpan…' : 'Simpan draf'}</Control>}
      </div>
    </form>
  </DialogPanel>;
}
