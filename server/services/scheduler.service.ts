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
  if (edits?.messageBody !== undefined && (typeof edits.messageBody !== 'string' || !edits.messageBody.trim())) return null;
  if (edits?.scheduledAt !== undefined && (typeof edits.scheduledAt !== 'string' || !Number.isFinite(Date.parse(edits.scheduledAt)))) return null;
  if (edits?.channel !== undefined && !['wa_gateway', 'nectarlink_bridge', 'wa_me_manual', 'telegram', 'email'].includes(edits.channel)) return null;

  const db = getDb();
  const row = db.prepare(
    `UPDATE scheduled_messages
     SET status = 'approved',
         approved_at = datetime('now'),
         message_body = COALESCE(?, message_body),
         scheduled_at = COALESCE(?, scheduled_at),
         channel = COALESCE(?, channel)
     WHERE id = ? AND status = 'pending_approval'
     RETURNING *`,
  ).get(
    edits?.messageBody ?? null,
    edits?.scheduledAt ?? null,
    edits?.channel ?? null,
    msgId,
  ) as unknown as ScheduledMessageRow | undefined;

  if (!row) return null;
  const enriched = { ...row, waMeUrl: buildWaMeUrl(row.recipient_address, row.message_body) };
  sseBus.emit('chat:update', enriched);
  return enriched;
}

export function updateScheduledMessageStatus(
  msgId: string,
  status: 'sent_manual_confirmed' | 'cancelled' | 'pending_approval',
): (ScheduledMessageRow & { waMeUrl: string }) | null {
  const db = getDb();
  const allowedTransitions = {
    pending_approval: ['approved'],
    cancelled: ['pending_approval', 'approved', 'reminded_fallback'],
    sent_manual_confirmed: ['pending_approval', 'approved', 'reminded_fallback', 'failed'],
  };
  if (!Object.hasOwn(allowedTransitions, status)) return null;
  const row = db.prepare(
    `UPDATE scheduled_messages
     SET status = ?,
         approved_at = CASE WHEN ? = 'pending_approval' THEN NULL ELSE approved_at END,
         sent_at = CASE WHEN ? = 'sent_manual_confirmed' THEN datetime('now') ELSE sent_at END
     WHERE id = ? AND status IN (SELECT value FROM json_each(?))
     RETURNING *`,
  ).get(status, status, status, msgId, JSON.stringify(allowedTransitions[status])) as unknown as ScheduledMessageRow | undefined;
  if (!row) return null;
  const enriched = { ...row, waMeUrl: buildWaMeUrl(row.recipient_address, row.message_body) };
  sseBus.emit('chat:update', enriched);
  return enriched;
}

const activeDispatchTicks = new WeakSet<ReturnType<typeof getDb>>();
const STALE_DISPATCH_MS = 60_000;

/**
 * A conditional claim is committed before dispatch. After interruption the result
 * is unknown, so an expired claim is retained as a failed attempt without retrying.
 */
export async function processDueScheduledMessagesTick(now = new Date()): Promise<ScheduledMessageRow[]> {
  const db = getDb();
  if (activeDispatchTicks.has(db)) return [];
  activeDispatchTicks.add(db);

  try {
    const cutoff = new Date(Date.now() - STALE_DISPATCH_MS).toISOString();
    const interrupted = db.prepare(
      `UPDATE scheduled_messages
       SET status = 'failed', sent_at = NULL,
           gateway_response_json = json_object(
             'outcome', 'unknown', 'reason', 'interrupted_dispatch',
             'attemptId', CASE WHEN json_valid(gateway_response_json) THEN json_extract(gateway_response_json, '$.attemptId') END,
             'claimedAt', CASE WHEN json_valid(gateway_response_json) THEN json_extract(gateway_response_json, '$.claimedAt') END
           )
       WHERE status = 'sending' AND CASE
         WHEN json_valid(gateway_response_json) THEN
           COALESCE(julianday(json_extract(gateway_response_json, '$.claimedAt')) > julianday(?), 0) = 0
         ELSE 1 END
       RETURNING *`,
    ).all(cutoff) as unknown as ScheduledMessageRow[];
    for (const msg of interrupted) sseBus.emit('chat:update', msg);

    const approved = db.prepare(
      "SELECT id, scheduled_at FROM scheduled_messages WHERE status = 'approved' AND approved_at IS NOT NULL ORDER BY scheduled_at",
    ).all() as Array<{ id: string; scheduled_at: string }>;
    const claim = db.prepare(
      `UPDATE scheduled_messages SET status = 'sending', sent_at = NULL, gateway_response_json = ?
       WHERE id = ? AND status = 'approved' AND approved_at IS NOT NULL AND scheduled_at = ?
       RETURNING *`,
    );
    const complete = db.prepare(
      `UPDATE scheduled_messages
       SET status = ?,
           sent_at = CASE WHEN ? = 'sent_auto' THEN datetime('now') ELSE NULL END,
           gateway_response_json = ?
       WHERE id = ? AND status = 'sending' AND gateway_response_json = ?
       RETURNING *`,
    );

    const nowMs = now.getTime();
    const processed: ScheduledMessageRow[] = [];
    for (const candidate of approved) {
      if (!(Date.parse(candidate.scheduled_at) <= nowMs)) continue;
      const attempt = { attemptId: crypto.randomUUID(), claimedAt: new Date().toISOString() };
      const claimJson = JSON.stringify(attempt);
      const msg = claim.get(claimJson, candidate.id, candidate.scheduled_at) as unknown as ScheduledMessageRow | undefined;
      if (!msg) continue;
      sseBus.emit('chat:update', msg);

      let status: ScheduledMessageRow['status'];
      let detail: Record<string, unknown>;
      let waMeUrl: string | undefined;
      try {
        const dispatch = await dispatchApprovedMessage({
          recipientName: msg.recipient_name,
          recipientAddress: msg.recipient_address,
          channel: msg.channel,
          messageBody: msg.message_body,
          attemptId: attempt.attemptId,
        });
        status = dispatch.finalStatus;
        detail = dispatch.detail;
        if (status === 'reminded_fallback') waMeUrl = dispatch.waMeUrl;
      } catch {
        status = 'failed';
        detail = { outcome: 'unknown', reason: 'dispatch_error' };
      }

      const result = JSON.stringify({ ...detail, ...attempt });
      const updated = complete.get(status, status, result, msg.id, claimJson) as unknown as ScheduledMessageRow | undefined;
      if (!updated) continue;
      processed.push(updated);
      if (status === 'failed') sseBus.emit('chat:update', updated);
      else sseBus.emit('chat:dispatched', { ...updated, waMeUrl });
    }
    return processed;
  } finally {
    activeDispatchTicks.delete(db);
  }
}

let schedulerInterval: NodeJS.Timeout | null = null;
let tickCounter = 0;

export function startBackgroundDaemons(): void {
  if (schedulerInterval) return;
  tickCounter = 0;
  const processScheduledMessages = () => {
    void processDueScheduledMessagesTick().catch(() => console.error('[scheduler] Scheduled message tick failed'));
  };
  schedulerInterval = setInterval(() => {
    tickCounter++;
    void processDueAlarmsTick().catch(() => console.error('[scheduler] Alarm tick failed'));
    if (tickCounter === 1 || tickCounter % 15 === 0) processScheduledMessages();
  }, 1000);
}

export function stopBackgroundDaemons(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
}
