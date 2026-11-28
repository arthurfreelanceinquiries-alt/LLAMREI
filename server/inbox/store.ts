import { createHash } from 'node:crypto';
import type { SQLInputValue } from 'node:sqlite';
import { INBOX_SOURCES, type InboxDetail, type InboxMessage, type InboxReceipt, type InboxSource, type InboxThread } from '../../shared/inbox.ts';
import { getDb } from '../db/connection.ts';
import { HttpBadRequestError } from '../lib/http.ts';
import { getActiveComposioTarget } from '../services/composio.service.ts';
import { createScheduledMessageDraft, type ContactRow, type ScheduledMessageRow } from '../services/scheduler.service.ts';

interface RawMessage {
  thread_key: string;
  message_id: string;
  title: string;
  sender: string;
  body: string;
  at: string;
  outbound: number;
  unread: number;
}

interface ThreadState {
  id: string;
  seen_message_id: string | null;
  contact_id: string | null;
  follow_up_at: string | null;
  note: string;
  revision: number;
}

function threadId(source: InboxSource, key: string): string {
  return Buffer.from(JSON.stringify([source, key])).toString('base64url');
}

function parseThreadId(id: string): [InboxSource, string] {
  if (/^[a-zA-Z0-9_-]{1,1800}$/.test(id)) {
    try {
      const value: unknown = JSON.parse(Buffer.from(id, 'base64url').toString('utf8'));
      if (Array.isArray(value) && value.length === 2 && INBOX_SOURCES.includes(value[0]) && typeof value[1] === 'string' && threadId(value[0], value[1]) === id) {
        return [value[0], value[1]];
      }
    } catch { /* Reject invalid locators below. */ }
  }
  throw new HttpBadRequestError(400, 'Percakapan tidak valid.');
}

export function normalizeInboxDate(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:[T ]|$)/.test(value)) return null;
  const utc = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? `${value.replace(' ', 'T')}Z` : value;
  const time = Date.parse(utc);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function messages(source: InboxSource, key?: string): RawMessage[] {
  const db = getDb();
  let statement: string;
  let params: SQLInputValue[] = [];
  if (source === 'whatsapp') {
    statement = `SELECT t.chat_jid AS thread_key, m.id AS message_id, t.name AS title, m.sender_name AS sender,
      m.text AS body, COALESCE(CASE WHEN m.timestamp GLOB '????-??-??*' THEN strftime('%Y-%m-%dT%H:%M:%fZ', m.timestamp) END,
        strftime('%Y-%m-%dT%H:%M:%fZ', m.created_at)) AS at,
      m.is_from_me AS outbound, t.unread_count AS unread
      FROM wa_chat_messages m JOIN wa_chat_threads t ON t.chat_jid = m.chat_jid WHERE 1 = 1`;
    if (key !== undefined) { statement += ' AND t.chat_jid = ?'; params.push(key); }
  } else if (source === 'whatsapp_import') {
    statement = `SELECT group_name AS thread_key, id AS message_id, group_name AS title, sender_display AS sender,
      quoted_message AS body, COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ', message_timestamp), strftime('%Y-%m-%dT%H:%M:%fZ', created_at)) AS at, 0 AS outbound,
      replied_status = 'unreplied' AS unread FROM wa_tag_mentions WHERE replied_status != 'ignored'`;
    if (key !== undefined) { statement += ' AND group_name = ?'; params.push(key); }
  } else if (source === 'gmail') {
    const target = getActiveComposioTarget('gmail');
    if (!target) return [];
    statement = `SELECT json_array(account_id, thread_id) AS thread_key, message_id, subject AS title, sender, body, received_at AS at, 0 AS outbound, unread
      FROM inbox_gmail_messages WHERE account_id = ?`;
    params = [target.accountId];
    if (key !== undefined) { statement += ' AND json_array(account_id, thread_id) = ?'; params.push(key); }
  } else {
    const keyField = "json_array(COALESCE(device_id,''), app_package, COALESCE(NULLIF(conversation_group,''), sender_or_title))";
    statement = `SELECT ${keyField} AS thread_key, id AS message_id, COALESCE(NULLIF(conversation_group,''), sender_or_title) AS title,
      sender_or_title AS sender, body_text AS body, strftime('%Y-%m-%dT%H:%M:%fZ', received_at) AS at,
      0 AS outbound, replied_at IS NULL AS unread FROM phone_notifications
      WHERE dismissed = 0 AND COALESCE(otp_code,'') = '' AND lower(app_package) LIKE ?`;
    params = [source === 'telegram_device' ? 'org.telegram.%' : 'com.whatsapp%'];
    if (key !== undefined) { statement += ` AND ${keyField} = ?`; params.push(key); }
  }
  return db.prepare(`${statement} ORDER BY at DESC, message_id DESC LIMIT ?`)
    .all(...params, key === undefined ? 180 : 80) as unknown as RawMessage[];
}

function summary(source: InboxSource, rows: RawMessage[], state?: ThreadState): InboxThread {
  const latest = rows[0];
  const inbound = rows.find((row) => row.outbound === 0);
  return {
    id: threadId(source, latest.thread_key), source, title: latest.title, preview: latest.body.slice(0, 180), updatedAt: latest.at,
    unread: Boolean(inbound && (state?.seen_message_id == null ? rows.some(({ unread }) => unread > 0) : state.seen_message_id !== inbound.message_id)),
    contactId: state?.contact_id ?? null, followUpAt: state?.follow_up_at ?? null, note: state?.note ?? '', revision: state?.revision ?? 0,
  };
}

export function listInboxThreads(filter: { source?: InboxSource; query: string; unread: boolean; followUp: boolean }): InboxThread[] {
  const lookup = getDb().prepare('SELECT * FROM inbox_thread_state WHERE id = ?');
  const query = filter.query.trim().toLowerCase();
  const sources = filter.source ? [filter.source] : INBOX_SOURCES;
  const threads = sources.flatMap((source) => {
    const groups = new Map<string, RawMessage[]>();
    for (const row of messages(source)) {
      const group = groups.get(row.thread_key) ?? [];
      group.push(row);
      groups.set(row.thread_key, group);
    }
    return [...groups.values()].map((rows) => summary(source, rows, lookup.get(threadId(source, rows[0].thread_key)) as unknown as ThreadState | undefined));
  });
  return threads.filter((thread) => (!filter.unread || thread.unread) && (!filter.followUp || thread.followUpAt) &&
    (!query || `${thread.title} ${thread.preview} ${thread.note}`.toLowerCase().includes(query)))
    .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '')).slice(0, 120);
}

function receipt(row: ScheduledMessageRow): InboxReceipt {
  const statuses = {
    pending_approval: 'pending', approved: 'queued', sending: 'sending', sent_auto: 'sent', reminded_fallback: 'handoff',
    sent_manual_confirmed: 'manual', cancelled: 'cancelled', failed: 'failed',
  } as const;
  let outcome: unknown;
  try { outcome = JSON.parse(row.gateway_response_json ?? '{}')?.outcome; } catch { /* Legacy receipt text. */ }
  return {
    id: row.id, body: row.message_body, scheduledAt: row.scheduled_at, sentAt: row.sent_at,
    state: row.status === 'failed' && outcome === 'unknown' || row.status === 'sent_auto' && outcome !== 'sent'
      ? 'unknown' : statuses[row.status],
  };
}

function findThread(id: string) {
  const [source, key] = parseThreadId(id);
  const rows = messages(source, key);
  if (!rows.length) throw new HttpBadRequestError(404, 'Percakapan tidak ditemukan.');
  const state = getDb().prepare('SELECT * FROM inbox_thread_state WHERE id = ?').get(id) as unknown as ThreadState | undefined;
  return { rows, state, thread: summary(source, rows, state) };
}

export function getInboxThread(id: string): InboxDetail {
  const { rows, thread } = findThread(id);
  const receipts = thread.contactId ? getDb().prepare(`SELECT * FROM scheduled_messages WHERE contact_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 12`)
    .all(thread.contactId) as unknown as ScheduledMessageRow[] : [];
  const items: InboxMessage[] = rows.reverse().map((row) => ({
    id: row.message_id, sender: row.sender, text: row.body.slice(0, 12_000), at: row.at, outbound: row.outbound === 1,
  }));
  return { thread, messages: items, receipts: receipts.map(receipt) };
}

function inputObject(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new HttpBadRequestError(400, 'Data tindak lanjut tidak valid.');
  return raw as Record<string, unknown>;
}

export function updateInboxThread(id: string, raw: unknown): InboxDetail {
  const input = inputObject(raw);
  const { rows, state, thread } = findThread(id);
  const revision = state?.revision ?? 0;
  if (input.revision !== revision) throw new HttpBadRequestError(409, 'Percakapan berubah. Buka ulang untuk memuat data terbaru.');
  const contact = input.contactId === undefined ? thread.contactId : input.contactId;
  const note = input.note === undefined ? thread.note : input.note;
  const followUp = input.followUpAt === undefined ? thread.followUpAt : input.followUpAt;
  const read = input.markRead;
  if ((contact !== null && (typeof contact !== 'string' || !getDb().prepare('SELECT 1 FROM contacts WHERE id = ?').get(contact))) ||
      typeof note !== 'string' || note.length > 1600 || (followUp !== null && !normalizeInboxDate(followUp)) ||
      (read !== undefined && typeof read !== 'boolean')) throw new HttpBadRequestError(400, 'Tindak lanjut, kontak, atau status baca tidak valid.');
  const latestInbound = rows.find((row) => !row.outbound)?.message_id ?? null;
  if (read === true && input.seenMessageId !== latestInbound) throw new HttpBadRequestError(409, 'Pesan baru masuk. Buka ulang sebelum menandai dibaca.');
  const seen = read === true ? latestInbound : state?.seen_message_id ?? null;
  const db = getDb();
  const params = [seen, contact, normalizeInboxDate(followUp), note.trim()];
  const result = revision === 0
    ? db.prepare('INSERT INTO inbox_thread_state (id, seen_message_id, contact_id, follow_up_at, note) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING').run(id, ...params)
    : db.prepare('UPDATE inbox_thread_state SET seen_message_id = ?, contact_id = ?, follow_up_at = ?, note = ?, revision = revision + 1 WHERE id = ? AND revision = ?').run(...params, id, revision);
  if (!result.changes) throw new HttpBadRequestError(409, 'Tindak lanjut sudah berubah.');
  return getInboxThread(id);
}

export function createInboxDraft(id: string, raw: unknown) {
  const input = inputObject(raw);
  const { thread } = findThread(id);
  if (!thread.contactId || thread.revision !== input.revision) throw new HttpBadRequestError(409, 'Simpan kontak penerima sebelum membuat draf.');
  const contact = getDb().prepare('SELECT * FROM contacts WHERE id = ?').get(thread.contactId) as unknown as ContactRow | undefined;
  const scheduledAt = normalizeInboxDate(input.scheduledAt);
  if (typeof input.body !== 'string' || !input.body.trim() || input.body.length > 5000 || !scheduledAt ||
      typeof input.requestId !== 'string' || !/^[a-f0-9-]{36}$/i.test(input.requestId)) {
    throw new HttpBadRequestError(400, 'Isi pesan dan jadwal mendatang harus valid.');
  }
  const channel = contact?.preferred_channel;
  const address = channel === 'telegram' ? contact?.telegram_chat_id : contact?.phone_e164;
  if (!contact || !address || channel === 'email') throw new HttpBadRequestError(400, 'Kontak memerlukan tujuan WhatsApp atau Telegram yang tersimpan.');
  const body = input.body.trim();
  const requestId = input.requestId;
  const hash = createHash('sha256').update(JSON.stringify([id, contact.id, contact.name, address, channel, body, scheduledAt])).digest('hex');
  const db = getDb();
  function existing() {
    const row = db.prepare(`SELECT r.payload_hash, m.id, m.status FROM inbox_draft_requests r
      JOIN scheduled_messages m ON r.scheduled_id = m.id WHERE r.request_id = ?`).get(requestId) as
      { payload_hash: string; id: string; status: ScheduledMessageRow['status'] } | undefined;
    if (row && row.payload_hash !== hash) throw new HttpBadRequestError(409, 'Isi draf telah berubah. Buat permintaan baru.');
    return row ? { id: row.id, status: row.status } : null;
  }
  const prior = existing();
  if (prior) return prior;
  if (Date.parse(scheduledAt) <= Date.now()) throw new HttpBadRequestError(400, 'Jadwal draf harus berada di masa depan.');
  db.exec('SAVEPOINT inbox_draft');
  try {
    const draft = createScheduledMessageDraft({ contactId: contact.id, recipientName: contact.name, recipientAddress: address,
      channel, purpose: 'Tindak lanjut inbox', messageBody: body, scheduledAt });
    db.prepare('INSERT INTO inbox_draft_requests (request_id, payload_hash, scheduled_id) VALUES (?, ?, ?)').run(requestId, hash, draft.id);
    db.exec('RELEASE inbox_draft');
    return { id: draft.id, status: draft.status };
  } catch (error) {
    db.exec('ROLLBACK TO inbox_draft; RELEASE inbox_draft');
    const replay = existing();
    if (replay) return replay;
    throw error;
  }
}
