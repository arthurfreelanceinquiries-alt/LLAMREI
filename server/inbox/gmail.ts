import type { InboxRemoteStatus } from '../../shared/inbox.ts';
import { getDb } from '../db/connection.ts';
import { HttpBadRequestError } from '../lib/http.ts';
import { executeBoundComposioRead, getActiveComposioTarget, listToolkitTools } from '../services/composio.service.ts';
import { getSecret } from '../services/secret.service.ts';

const gmailTool = 'GMAIL_FETCH_EMAILS';
const activeSyncs = new Set<string>();

interface GmailMessage {
  id: string;
  threadId: string;
  subject: string;
  sender: string;
  body: string;
  at: string;
  unread: boolean;
}

type SyncRow = { last_synced_at: string | null; last_attempt_at: string; last_outcome: InboxRemoteStatus['lastOutcome'] };

export function gmailSyncStatus(): InboxRemoteStatus {
  const target = getActiveComposioTarget('gmail');
  const row = target ? getDb().prepare('SELECT * FROM inbox_gmail_sync WHERE account_id = ?').get(target.accountId) as unknown as SyncRow | undefined : undefined;
  return {
    state: target ? 'ready' : getSecret('COMPOSIO_API_KEY') ? 'unavailable' : 'unconfigured',
    lastSyncedAt: row?.last_synced_at ?? null, lastAttemptAt: row?.last_attempt_at ?? null, lastOutcome: row?.last_outcome ?? null,
  };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function firstString(...variants: unknown[]): string {
  return variants.find((value): value is string => typeof value === 'string' && Boolean(value.trim()))?.trim() ?? '';
}

function receivedDate(value: unknown): string | null {
  const time = typeof value === 'number' || typeof value === 'string' && /^\d{13}$/.test(value)
    ? Number(value) : typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(time) && time > 0 && time < 253402300799000 ? new Date(time).toISOString() : null;
}

function normalize(result: unknown): GmailMessage[] | null {
  const payload = record(record(result)?.data);
  const items = payload?.messages ?? payload?.emails;
  if (!Array.isArray(items) || items.length > 100) return null;
  const dedup = new Map<string, GmailMessage>();
  for (const item of items) {
    const row = record(item);
    if (!row) return null;
    const id = firstString(row.id, row.messageId, row.message_id);
    const threadId = firstString(row.threadId, row.thread_id, id);
    const headers = record(row.payload)?.headers;
    const header = (name: string) => Array.isArray(headers) ? headers.find((entry) => String(entry?.name).toLowerCase() === name)?.value : undefined;
    const from = record(row.from);
    const at = receivedDate(row.internalDate ?? row.internal_date ?? row.date ?? row.received_at ?? header('date'));
    const sender = firstString(row.sender, row.from, from?.email, from?.name, header('from'));
    if (!id || id.length > 196 || !threadId || threadId.length > 196 || !at || !sender) return null;
    const labels = row.labelIds ?? row.label_ids;
    dedup.set(id, {
      id, threadId, sender: sender.slice(0, 200), at,
      subject: firstString(row.subject, header('subject'), 'Email tanpa subjek').slice(0, 220),
      body: firstString(row.snippet, row.body_text, row.preview, row.body).slice(0, 12_000),
      unread: row.unread === true || (Array.isArray(labels) && labels.includes('UNREAD')),
    });
  }
  return [...dedup.values()];
}

function saveSync(accountId: string, attempt: string, outcome: 'success' | 'failed' | 'unknown', rows: GmailMessage[] = []) {
  const db = getDb();
  db.exec('SAVEPOINT gmail_snapshot');
  try {
    const add = db.prepare(`INSERT INTO inbox_gmail_messages
      (account_id, message_id, thread_id, subject, sender, body, received_at, unread) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(account_id, message_id) DO UPDATE SET thread_id = excluded.thread_id, subject = excluded.subject,
        sender = excluded.sender, body = excluded.body, received_at = excluded.received_at, unread = excluded.unread`);
    for (const row of rows) add.run(accountId, row.id, row.threadId, row.subject, row.sender, row.body, row.at, Number(row.unread));
    db.prepare(`INSERT INTO inbox_gmail_sync (account_id, last_synced_at, last_attempt_at, last_outcome) VALUES (?, ?, ?, ?)
      ON CONFLICT(account_id) DO UPDATE SET last_synced_at = COALESCE(excluded.last_synced_at, inbox_gmail_sync.last_synced_at),
        last_attempt_at = excluded.last_attempt_at, last_outcome = excluded.last_outcome`)
      .run(accountId, outcome === 'success' ? attempt : null, attempt, outcome);
    db.exec('RELEASE gmail_snapshot');
  } catch (error) {
    db.exec('ROLLBACK TO gmail_snapshot; RELEASE gmail_snapshot');
    throw error;
  }
}

export async function syncInboxGmail(signal: AbortSignal, fetchImpl: typeof fetch = globalThis.fetch) {
  const target = getActiveComposioTarget('gmail');
  if (!target) throw new HttpBadRequestError(409, 'Aktifkan satu akun Gmail dan izinkan toolkit untuk membaca inbox.');
  if (activeSyncs.has(target.accountId)) throw new HttpBadRequestError(409, 'Sinkronisasi Gmail sedang berjalan.');
  activeSyncs.add(target.accountId);
  const current = () => getActiveComposioTarget('gmail')?.accountId === target.accountId;
  const now = new Date().toISOString();
  try {
    const definition = (await listToolkitTools('gmail', 30, fetchImpl, signal)).find(({ slug, readOnly }) => slug === gmailTool && readOnly);
    const properties = record(definition?.inputParameters.properties);
    const key = Object.hasOwn(properties ?? {}, 'max_results') ? 'max_results' : 'count';
    const limitSchema = record(properties?.[key]);
    if (!definition || !limitSchema || !current()) {
      saveSync(target.accountId, now, 'failed');
      throw new HttpBadRequestError(409, 'Alat baca Gmail dengan batas hasil belum tersedia untuk akun ini.');
    }
    const limit = typeof limitSchema.maximum === 'number' ? Math.min(20, Math.floor(limitSchema.maximum)) : 20;
    if (limit < 1) throw new HttpBadRequestError(409, 'Batas hasil Gmail tidak didukung.');
    const result = await executeBoundComposioRead(gmailTool, { [key]: limit }, target, current, signal, fetchImpl);
    signal.throwIfAborted();
    const rows = result.ok && current() ? normalize(result.data) : null;
    if (!rows) {
      saveSync(target.accountId, now, result.outcome === 'denied' || result.outcome === 'failed' ? 'failed' : 'unknown');
      throw new HttpBadRequestError(502, 'Hasil sinkronisasi Gmail belum terverifikasi.');
    }
    saveSync(target.accountId, now, 'success', rows);
    return { count: rows.length, status: gmailSyncStatus() };
  } finally {
    activeSyncs.delete(target.accountId);
  }
}
