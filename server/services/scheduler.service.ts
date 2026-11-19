import { getDb } from '../db/connection.ts';
import { sseBus } from '../lib/sse.ts';
import { processDueAlarmsTick } from './alarm-calendar.service.ts';
import { buildWaMeUrl, dispatchApprovedMessage, type OutboundChannel } from './gateway.service.ts';

export interface ContactRow {
  id: string;
  name: string;
  aliases_json: string;
  phone_e164: string;
  telegram_chat_id: string | null;
  email: string | null;
  timezone: string;
  active_hours_note: string | null;
  preferred_channel: OutboundChannel;
}

export interface ScheduledMessageRow {
  id: string;
  contact_id: string | null;
  recipient_name: string;
  recipient_address: string;
  channel: OutboundChannel;
  purpose: string;
  message_body: string;
  scheduled_at: string;
  status:
    | 'pending_approval'
    | 'approved'
    | 'sending'
    | 'sent_auto'
    | 'reminded_fallback'
    | 'sent_manual_confirmed'
    | 'cancelled'
    | 'failed';
  approved_at: string | null;
  sent_at: string | null;
  gateway_response_json: string | null;
  linked_task_id: string | null;
  linked_event_id: string | null;
  created_by_prompt: string | null;
  created_at: string;
}

export function listContacts(): ContactRow[] {
  const db = getDb();
  return db.prepare('SELECT * FROM contacts ORDER BY name ASC').all() as unknown as ContactRow[];
}

export function createContact(input: {
  name: string;
  aliases?: string[];
  phoneE164: string;
  telegramChatId?: string | null;
  email?: string | null;
  timezone?: string;
  activeHoursNote?: string | null;
  preferredChannel?: OutboundChannel;
}): ContactRow {
  const db = getDb();
  const id = `cnt_${crypto.randomUUID().slice(0, 8)}`;
  db.prepare(
    `INSERT INTO contacts (id, name, aliases_json, phone_e164, telegram_chat_id, email, timezone, active_hours_note, preferred_channel)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.name,
    JSON.stringify(input.aliases ?? []),
    input.phoneE164.replace(/[^\d]/g, ''),
    input.telegramChatId ?? null,
    input.email ?? null,
    input.timezone ?? 'Asia/Jakarta',
    input.activeHoursNote ?? null,
    input.preferredChannel ?? 'nectarlink_bridge',
  );
  return db.prepare('SELECT * FROM contacts WHERE id = ?').get(id) as unknown as ContactRow;
}

export function findContactByNameOrAlias(query: string): ContactRow | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  const all = listContacts();
  for (const c of all) {
    if (c.name.toLowerCase().includes(q)) return c;
    const aliases = JSON.parse(c.aliases_json || '[]') as string[];
    if (aliases.some((a) => a.toLowerCase().includes(q) || q.includes(a.toLowerCase()))) {
      return c;
    }
  }
  return null;
}

export function listScheduledMessages(): Array<ScheduledMessageRow & { waMeUrl: string }> {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM scheduled_messages ORDER BY scheduled_at ASC').all() as unknown as ScheduledMessageRow[];
  return rows.map((r) => ({
    ...r,
    waMeUrl: buildWaMeUrl(r.recipient_address, r.message_body),
  }));
}

export function createScheduledMessageDraft(input: {
  contactId?: string | null;
  recipientName: string;
  recipientAddress: string;
  channel?: OutboundChannel;
  purpose: string;
  messageBody: string;
  scheduledAt: string;
  linkedTaskId?: string | null;
  createdByPrompt?: string | null;
}): ScheduledMessageRow & { waMeUrl: string } {
  const db = getDb();
  const id = `msg_${crypto.randomUUID().slice(0, 8)}`;
  db.prepare(
    `INSERT INTO scheduled_messages (id, contact_id, recipient_name, recipient_address, channel, purpose, message_body, scheduled_at, status, linked_task_id, created_by_prompt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending_approval', ?, ?)`,
  ).run(
    id,
    input.contactId ?? null,
    input.recipientName,
    input.recipientAddress,
    input.channel ?? 'nectarlink_bridge',
    input.purpose,
    input.messageBody,
    input.scheduledAt,
    input.linkedTaskId ?? null,
    input.createdByPrompt ?? null,
  );
  const row = db.prepare('SELECT * FROM scheduled_messages WHERE id = ?').get(id) as unknown as ScheduledMessageRow;
  const enriched = { ...row, waMeUrl: buildWaMeUrl(row.recipient_address, row.message_body) };
  sseBus.emit('chat:update', enriched);
  return enriched;
}

export function approveScheduledMessage(
  msgId: string,
  edits?: { messageBody?: string; scheduledAt?: string; channel?: OutboundChannel },
): (ScheduledMessageRow & { waMeUrl: string }) | null {
  const db = getDb();
  const prev = db.prepare('SELECT * FROM scheduled_messages WHERE id = ?').get(msgId) as unknown as ScheduledMessageRow | undefined;
  if (!prev) return null;

  db.prepare(
    `UPDATE scheduled_messages
     SET status = 'approved',
         approved_at = datetime('now'),
         message_body = ?,
         scheduled_at = ?,
         channel = ?
     WHERE id = ?`,
  ).run(
    edits?.messageBody ?? prev.message_body,
    edits?.scheduledAt ?? prev.scheduled_at,
    edits?.channel ?? prev.channel,
    msgId,
  );

  const row = db.prepare('SELECT * FROM scheduled_messages WHERE id = ?').get(msgId) as unknown as ScheduledMessageRow;
  const enriched = { ...row, waMeUrl: buildWaMeUrl(row.recipient_address, row.message_body) };
  sseBus.emit('chat:update', enriched);
  return enriched;
}

export function updateScheduledMessageStatus(
  msgId: string,
  status: 'sent_manual_confirmed' | 'cancelled' | 'pending_approval',
): (ScheduledMessageRow & { waMeUrl: string }) | null {
  const db = getDb();
  db.prepare(
    `UPDATE scheduled_messages
     SET status = ?,
         sent_at = CASE WHEN ? = 'sent_manual_confirmed' THEN datetime('now') ELSE sent_at END
     WHERE id = ?`,
  ).run(status, status, msgId);
  const row = db.prepare('SELECT * FROM scheduled_messages WHERE id = ?').get(msgId) as unknown as ScheduledMessageRow | undefined;
  if (!row) return null;
  const enriched = { ...row, waMeUrl: buildWaMeUrl(row.recipient_address, row.message_body) };
  sseBus.emit('chat:update', enriched);
  return enriched;
}

/**
 * Only executes messages explicitly marked `approved` whose `scheduled_at <= now`.
 * Messages in `pending_approval` are strictly skipped by the approval gate.
 */
export async function processDueScheduledMessagesTick(now = new Date()): Promise<ScheduledMessageRow[]> {
  const db = getDb();
  const nowMs = now.getTime();
  const approved = db
    .prepare("SELECT * FROM scheduled_messages WHERE status = 'approved'")
    .all() as unknown as ScheduledMessageRow[];

  const processed: ScheduledMessageRow[] = [];
  for (const msg of approved) {
    const schedMs = Date.parse(msg.scheduled_at);
    if (Number.isNaN(schedMs) || schedMs > nowMs) continue;

    db.prepare("UPDATE scheduled_messages SET status = 'sending' WHERE id = ?").run(msg.id);
    const dispatch = await dispatchApprovedMessage({
      recipientName: msg.recipient_name,
      recipientAddress: msg.recipient_address,
      channel: msg.channel,
      messageBody: msg.message_body,
    });

    db.prepare(
      `UPDATE scheduled_messages
       SET status = ?,
           sent_at = CASE WHEN ? = 'sent_auto' THEN datetime('now') ELSE NULL END,
           gateway_response_json = ?
       WHERE id = ?`,
    ).run(dispatch.finalStatus, dispatch.finalStatus, JSON.stringify(dispatch.detail), msg.id);

    const updated = db.prepare('SELECT * FROM scheduled_messages WHERE id = ?').get(msg.id) as unknown as ScheduledMessageRow;
    processed.push(updated);
    sseBus.emit('chat:dispatched', { ...updated, waMeUrl: dispatch.waMeUrl });
  }

  return processed;
}

let schedulerInterval: NodeJS.Timeout | null = null;
let tickCounter = 0;

export function startBackgroundDaemons(): void {
  if (schedulerInterval) return;
  schedulerInterval = setInterval(() => {
    tickCounter++;
    void processDueAlarmsTick();
    if (tickCounter % 15 === 0) {
      void processDueScheduledMessagesTick();
    }
  }, 1000);
}

export function stopBackgroundDaemons(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
}
