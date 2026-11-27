import { shiftCalendarEnd } from '../../shared/calendar-range.ts';
import { getDb } from '../db/connection.ts';
import { sseBus } from '../lib/sse.ts';
import { pushPhoneNotification, ringPhone } from './nectarlink.service.ts';

export type AlarmKind = 'soft_reminder' | 'hard_alarm';
export type SoundPreset = 'tactical_pulse' | 'siren_urgent' | 'zen_chime' | 'bell_classic';

export interface AlarmReminderRow {
  id: string;
  task_id: string | null;
  calendar_event_id: string | null;
  title: string;
  subtitle: string | null;
  kind: AlarmKind;
  trigger_at: string;
  offset_minutes: number;
  sound_preset: SoundPreset;
  ring_phone_nectarlink: number;
  enabled: number;
  status: 'armed' | 'ringing' | 'snoozed' | 'dismissed' | 'completed';
  snooze_count: number;
  snoozed_until: string | null;
  last_triggered_at: string | null;
  dismissed_from: string | null;
  created_at: string;
}

export interface CalendarEventRow {
  id: string;
  source: 'clickup_task' | 'notion' | 'google' | 'scheduled_chat' | 'local';
  linked_task_id: string | null;
  external_id: string | null;
  title: string;
  start_at: string;
  end_at: string | null;
  all_day: number;
  color: string;
  has_hard_alarm: number;
  location: string | null;
  notes: string | null;
  synced_at: string;
}

export function listCalendarEvents(): CalendarEventRow[] {
  const db = getDb();
  return db.prepare('SELECT * FROM calendar_events ORDER BY julianday(start_at), id').all() as unknown as CalendarEventRow[];
}

export function listAlarmsAndReminders(): AlarmReminderRow[] {
  const db = getDb();
  return db
    .prepare('SELECT * FROM task_alarms_reminders ORDER BY julianday(trigger_at), id')
    .all() as unknown as AlarmReminderRow[];
}

export function getNextArmedAlarm(): AlarmReminderRow | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT * FROM task_alarms_reminders
       WHERE enabled = 1 AND status IN ('armed', 'snoozed', 'ringing')
       ORDER BY CASE WHEN status = 'ringing' THEN 0 ELSE 1 END,
                julianday(COALESCE(snoozed_until, trigger_at)) ASC
       LIMIT 1`,
    )
    .get() as unknown as AlarmReminderRow | undefined;
  return row ?? null;
}

/**
 * Projects a ClickUp task's time onto the Website Calendar and updates its
 * two-tier Soft Reminder (H-offset) + Hard Alarm records atomically.
 */
export function syncTaskToCalendarAndAlarms(taskId: string, options?: { reopen?: boolean; enableHardAlarm?: boolean }): void {
  const db = getDb();
  const task = db
    .prepare(
      `SELECT t.*, l.name AS list_name, s.name AS space_name, s.color AS space_color
       FROM tasks t
       JOIN lists l ON l.id = t.list_id
       JOIN spaces s ON s.id = l.space_id
       WHERE t.id = ?`,
    )
    .get(taskId) as
    | {
        id: string;
        title: string;
        status: string;
        priority: string;
        start_at: string | null;
        due_at: string | null;
        auto_scheduled_block_start: string | null;
        auto_scheduled_block_end: string | null;
        reminder_offsets_json: string;
        hard_alarm_enabled: number;
        hard_alarm_at: string | null;
        space_name: string;
        space_color: string;
      }
    | undefined;

  if (!task) return;

  const anchorStart = task.auto_scheduled_block_start ?? task.start_at ?? task.due_at ??
    (task.hard_alarm_enabled ? task.hard_alarm_at : null);
  const anchorEnd = task.auto_scheduled_block_end ?? task.due_at ?? anchorStart;
  const calId = `cal_task_${task.id}`;

  if (!anchorStart) {
    db.prepare('DELETE FROM calendar_events WHERE id = ?').run(calId);
    db.prepare("DELETE FROM task_alarms_reminders WHERE task_id = ? AND status = 'armed'").run(task.id);
    return;
  }

  db.prepare(
    `INSERT INTO calendar_events (id, source, linked_task_id, title, start_at, end_at, color, has_hard_alarm, notes, synced_at)
     VALUES (?, 'clickup_task', ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET
       title = excluded.title,
       start_at = excluded.start_at,
       end_at = excluded.end_at,
       color = excluded.color,
       has_hard_alarm = excluded.has_hard_alarm,
       notes = excluded.notes,
       synced_at = datetime('now')`,
  ).run(
    calId,
    task.id,
    task.title,
    anchorStart,
    anchorEnd,
    task.space_color || '#00d992',
    task.hard_alarm_enabled ? 1 : 0,
    `${task.space_name} · ${task.priority.toUpperCase()} · ${task.status}`,
  );

  // If task is Done, mark its armed reminders/alarms as completed
  if (task.status === 'Done') {
    db.prepare("UPDATE task_alarms_reminders SET status = 'completed', enabled = 0 WHERE task_id = ?").run(task.id);
    sseBus.emit('alarm:update', { taskId: task.id });
    return;
  }

  const offsets = [...new Set(JSON.parse(task.reminder_offsets_json || '[15]') as number[])]
    .filter((offset) => Number.isFinite(offset) && offset >= 0);
  db.prepare(
    `DELETE FROM task_alarms_reminders WHERE task_id = ? AND kind = 'soft_reminder'
     AND status IN ('armed','snoozed') AND offset_minutes NOT IN (SELECT value FROM json_each(?))`,
  ).run(task.id, JSON.stringify(offsets));

  // Preserve delivery history on edits that leave the alarm instant unchanged.
  const rearm = `(julianday(task_alarms_reminders.trigger_at) IS NOT julianday(excluded.trigger_at)
    OR ($rearm AND task_alarms_reminders.enabled = 0))`;
  const updateTiming = `
    trigger_at = excluded.trigger_at,
    enabled = CASE WHEN ${rearm} THEN 1 ELSE task_alarms_reminders.enabled END,
    status = CASE WHEN ${rearm} THEN 'armed' ELSE task_alarms_reminders.status END,
    snoozed_until = CASE WHEN ${rearm} THEN NULL ELSE task_alarms_reminders.snoozed_until END`;
  const baseMs = Date.parse(anchorStart);
  if (Number.isFinite(baseMs)) {
    const existingReminder = db.prepare(
      `SELECT id FROM task_alarms_reminders WHERE task_id = ? AND kind = 'soft_reminder'
       AND offset_minutes = ? ORDER BY id = ? DESC, created_at DESC LIMIT 1`,
    );
    const upsertReminder = db.prepare(
      `INSERT INTO task_alarms_reminders (id, task_id, calendar_event_id, title, subtitle, kind, trigger_at, offset_minutes, sound_preset, ring_phone_nectarlink, enabled, status)
       VALUES (?, ?, ?, ?, ?, 'soft_reminder', ?, ?, 'zen_chime', 1, 1, 'armed')
       ON CONFLICT(id) DO UPDATE SET title = excluded.title, subtitle = excluded.subtitle,
         calendar_event_id = excluded.calendar_event_id, ${updateTiming}`,
    );
    for (const offset of offsets) {
      const trigger = new Date(baseMs - offset * 60_000);
      if (!Number.isFinite(trigger.valueOf())) continue;
      const defaultId = `alm_soft_${task.id}_${offset}`;
      const existing = existingReminder.get(task.id, offset, defaultId) as { id: string } | undefined;
      upsertReminder.run(
        { $rearm: Number(!!options?.reopen) },
        existing?.id ?? defaultId,
        task.id,
        calId,
        `Reminder: ${task.title} (H-${offset}m)`,
        `${task.space_name} · ${task.priority.toUpperCase()}`,
        trigger.toISOString(),
        offset,
      );
    }
  }

  const hardId = `alm_hard_${task.id}`;
  if (task.hard_alarm_enabled) {
    const hardTime = task.hard_alarm_at ?? anchorStart;
    db.prepare(
      `INSERT INTO task_alarms_reminders (id, task_id, calendar_event_id, title, subtitle, kind, trigger_at, offset_minutes, sound_preset, ring_phone_nectarlink, enabled, status)
       VALUES (?, ?, ?, ?, ?, 'hard_alarm', ?, 0, 'tactical_pulse', 1, 1, 'armed')
       ON CONFLICT(id) DO UPDATE SET
         title = CASE WHEN task_alarms_reminders.subtitle = 'Hard Alarm Tugas ClickUp'
           THEN task_alarms_reminders.title ELSE excluded.title END,
         calendar_event_id = excluded.calendar_event_id,
         ${updateTiming}`,
    ).run({ $rearm: Number(!!(options?.reopen || options?.enableHardAlarm)) },
      hardId, task.id, calId, task.title, `Hard Alarm · ${task.space_name}`, hardTime);

  } else {
    db.prepare(
      `UPDATE task_alarms_reminders SET enabled = 0, status = 'dismissed', snoozed_until = NULL
       WHERE id = ? AND enabled = 1`,
    ).run(hardId);
  }

  sseBus.emit('alarm:update', { taskId: task.id });
}

/**
 * Bi-directional calendar move: moving a ClickUp task block on the Website Calendar
 * updates the task's start_at / due_at and re-arms its reminders & hard alarm (FR-60).
 */
export function moveCalendarEvent(eventId: string, newStartAt: string, newEndAt?: string | null): CalendarEventRow | null {
  const db = getDb();
  const ev = db.prepare('SELECT * FROM calendar_events WHERE id = ?').get(eventId) as unknown as CalendarEventRow | undefined;
  if (!ev) return null;

  const endAt = newEndAt ?? shiftCalendarEnd(ev.start_at, ev.end_at, newStartAt);
  db.exec('SAVEPOINT move_calendar_event');
  try {
    db.prepare("UPDATE calendar_events SET start_at = ?, end_at = ?, synced_at = datetime('now') WHERE id = ?").run(
      newStartAt, endAt, eventId,
    );

    if (ev.linked_task_id) {
      // A focus block is a calendar projection. Moving one preserves the task's deadline.
      db.prepare(
        `UPDATE tasks SET
           start_at = CASE WHEN auto_scheduled_block_start IS NULL THEN ? ELSE start_at END,
           due_at = CASE WHEN auto_scheduled_block_start IS NULL AND (due_at IS NOT NULL OR ? IS NOT NULL) THEN ? ELSE due_at END,
           auto_scheduled_block_end = CASE WHEN auto_scheduled_block_start IS NOT NULL THEN ? ELSE auto_scheduled_block_end END,
           auto_scheduled_block_start = CASE WHEN auto_scheduled_block_start IS NOT NULL THEN ? END,
           hard_alarm_at = CASE WHEN hard_alarm_enabled = 1 THEN ? ELSE hard_alarm_at END,
           updated_at = datetime('now')
         WHERE id = ?`,
      ).run(newStartAt, newEndAt ?? null, endAt, endAt, newStartAt, newStartAt, ev.linked_task_id);
      syncTaskToCalendarAndAlarms(ev.linked_task_id);
    } else {
      db.prepare(
        `UPDATE task_alarms_reminders
         SET trigger_at = ?, status = CASE WHEN enabled = 1 THEN 'armed' ELSE status END, snoozed_until = NULL
         WHERE calendar_event_id = ? AND kind = 'hard_alarm' AND julianday(trigger_at) IS NOT julianday(?)`,
      ).run(newStartAt, eventId, newStartAt);
    }
    db.exec('RELEASE move_calendar_event');
  } catch (error) {
    db.exec('ROLLBACK TO move_calendar_event; RELEASE move_calendar_event');
    throw error;
  }

  if (ev.linked_task_id) sseBus.emit('workspace:update', { taskId: ev.linked_task_id });
  sseBus.emit('calendar:update', { eventId });
  return db.prepare('SELECT * FROM calendar_events WHERE id = ?').get(eventId) as unknown as CalendarEventRow;
}

export function createStandaloneCalendarEvent(params: {
  title: string;
  startAt: string;
  endAt?: string | null;
  source?: 'notion' | 'google' | 'local';
  color?: string;
  notes?: string;
  withHardAlarm?: boolean;
  ringPhone?: boolean;
}): CalendarEventRow {
  const db = getDb();
  const id = `cal_${crypto.randomUUID().slice(0, 8)}`;
  db.prepare(
    `INSERT INTO calendar_events (id, source, title, start_at, end_at, color, has_hard_alarm, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    params.source ?? 'local',
    params.title,
    params.startAt,
    params.endAt ?? null,
    params.color ?? '#06b6d4',
    params.withHardAlarm ? 1 : 0,
    params.notes ?? null,
  );

  if (params.withHardAlarm) {
    db.prepare(
      `INSERT INTO task_alarms_reminders (id, calendar_event_id, title, subtitle, kind, trigger_at, offset_minutes, sound_preset, ring_phone_nectarlink, enabled, status)
       VALUES (?, ?, ?, ?, 'hard_alarm', ?, 0, 'tactical_pulse', ?, 1, 'armed')`,
    ).run(`alm_cal_${id}`, id, params.title, 'Kalender Hard Alarm', params.startAt, params.ringPhone === false ? 0 : 1);
  }
  sseBus.emit('alarm:update', { calendarEventId: id });
  return db.prepare('SELECT * FROM calendar_events WHERE id = ?').get(id) as unknown as CalendarEventRow;
}

export function createOrUpdateHardAlarm(params: {
  taskId?: string | null;
  title: string;
  triggerAt: string;
  soundPreset?: SoundPreset;
  ringPhone?: boolean;
}): AlarmReminderRow {
  const db = getDb();
  const id = params.taskId ? `alm_hard_${params.taskId}` : `alm_hard_${crypto.randomUUID().slice(0, 8)}`;
  db.prepare(
    `INSERT INTO task_alarms_reminders (id, task_id, title, subtitle, kind, trigger_at, offset_minutes, sound_preset, ring_phone_nectarlink, enabled, status)
     VALUES (?, ?, ?, ?, 'hard_alarm', ?, 0, ?, ?, 1, 'armed')
     ON CONFLICT(id) DO UPDATE SET
       title = excluded.title,
       subtitle = excluded.subtitle,
       trigger_at = excluded.trigger_at,
       sound_preset = excluded.sound_preset,
       ring_phone_nectarlink = excluded.ring_phone_nectarlink,
       enabled = 1,
       status = 'armed',
       snoozed_until = NULL`,
  ).run(
    id,
    params.taskId ?? null,
    params.title,
    params.taskId ? 'Hard Alarm Tugas ClickUp' : 'Custom Hard Alarm',
    params.triggerAt,
    params.soundPreset ?? 'tactical_pulse',
    params.ringPhone === false ? 0 : 1,
  );

  if (params.taskId) {
    db.prepare("UPDATE tasks SET hard_alarm_enabled = 1, hard_alarm_at = ?, updated_at = datetime('now') WHERE id = ?").run(
      params.triggerAt,
      params.taskId,
    );
    syncTaskToCalendarAndAlarms(params.taskId);
  }
  const row = db.prepare('SELECT * FROM task_alarms_reminders WHERE id = ?').get(id) as unknown as AlarmReminderRow;
  sseBus.emit('alarm:update', row);
  return row;
}

export function toggleAlarmEnabled(alarmId: string, enabled: boolean): AlarmReminderRow | null {
  const db = getDb();
  const alarm = db.prepare('SELECT * FROM task_alarms_reminders WHERE id = ?').get(alarmId) as unknown as AlarmReminderRow | undefined;
  if (!alarm) return null;

  db.prepare("UPDATE task_alarms_reminders SET enabled = ?, status = CASE WHEN ? = 1 THEN 'armed' ELSE 'dismissed' END, snoozed_until = NULL WHERE id = ?").run(
    enabled ? 1 : 0,
    enabled ? 1 : 0,
    alarmId,
  );
  if (alarm.kind === 'hard_alarm') {
    if (alarm.task_id) {
      db.prepare('UPDATE tasks SET hard_alarm_enabled = ? WHERE id = ?').run(enabled ? 1 : 0, alarm.task_id);
    }
    if (alarm.calendar_event_id) {
      db.prepare('UPDATE calendar_events SET has_hard_alarm = ? WHERE id = ?').run(enabled ? 1 : 0, alarm.calendar_event_id);
    }
  }
  const updated = db.prepare('SELECT * FROM task_alarms_reminders WHERE id = ?').get(alarmId) as unknown as AlarmReminderRow;
  sseBus.emit('alarm:update', updated);
  return updated;
}

const dueAlarmCondition = `enabled = 1 AND (
  (status = 'armed' AND julianday(trigger_at) <= julianday(?))
  OR (status = 'snoozed' AND julianday(snoozed_until) <= julianday(?))
)`;

async function triggerDueAlarm(alarmId: string, nowIso: string): Promise<AlarmReminderRow | null> {
  const alarm = getDb().prepare(
    `UPDATE task_alarms_reminders
     SET status = CASE kind WHEN 'hard_alarm' THEN 'ringing' ELSE 'completed' END,
         snoozed_until = NULL, last_triggered_at = ?
     WHERE id = ? AND ${dueAlarmCondition}
     RETURNING *`,
  ).get(nowIso, alarmId, nowIso, nowIso) as unknown as AlarmReminderRow | undefined;
  if (!alarm) return null;

  if (alarm.kind === 'hard_alarm') {
    sseBus.emit('alarm:ring', alarm);
    if (alarm.ring_phone_nectarlink) {
      await pushPhoneNotification({ title: `⏰ ALARM: ${alarm.title}`, body: alarm.subtitle ?? 'Waktunya eksekusi tugas di Llamrei!' });
      await ringPhone();
    }
  } else {
    sseBus.emit('alarm:soft_reminder', alarm);
    if (alarm.ring_phone_nectarlink) {
      await pushPhoneNotification({ title: `🔔 ${alarm.title}`, body: alarm.subtitle ?? 'Pengingat tugas Llamrei' });
    }
  }
  return alarm;
}

export async function testHardAlarm(alarmId?: string): Promise<AlarmReminderRow> {
  const db = getDb();
  let alarm = alarmId
    ? (db.prepare('SELECT * FROM task_alarms_reminders WHERE id = ?').get(alarmId) as unknown as AlarmReminderRow | undefined)
    : (db.prepare("SELECT * FROM task_alarms_reminders WHERE kind = 'hard_alarm' LIMIT 1").get() as unknown as AlarmReminderRow | undefined);

  if (!alarm) {
    alarm = createOrUpdateHardAlarm({
      title: 'Test Hard Alarm Llamrei',
      triggerAt: new Date().toISOString(),
      soundPreset: 'tactical_pulse',
      ringPhone: false,
    });
  }
  db.prepare("UPDATE task_alarms_reminders SET status = 'ringing', enabled = 1, last_triggered_at = ? WHERE id = ?").run(
    new Date().toISOString(),
    alarm.id,
  );
  const ringing = db.prepare('SELECT * FROM task_alarms_reminders WHERE id = ?').get(alarm.id) as unknown as AlarmReminderRow;
  sseBus.emit('alarm:ring', ringing);
  return ringing;
}

export function snoozeAlarm(
  alarmId: string,
  minutes = 10,
  source: 'web' | 'android_widget' | 'llamrei_agent' = 'web',
): AlarmReminderRow | null {
  const db = getDb();
  const alarm = db.prepare('SELECT * FROM task_alarms_reminders WHERE id = ?').get(alarmId) as unknown as AlarmReminderRow | undefined;
  if (!alarm) return null;

  const until = new Date(Date.now() + minutes * 60_000).toISOString();
  db.prepare(
    `UPDATE task_alarms_reminders
     SET status = 'snoozed', snoozed_until = ?, snooze_count = snooze_count + 1, dismissed_from = ?
     WHERE id = ?`,
  ).run(until, source, alarmId);
  const updated = db.prepare('SELECT * FROM task_alarms_reminders WHERE id = ?').get(alarmId) as unknown as AlarmReminderRow;
  sseBus.emit('alarm:update', updated);
  return updated;
}

export function dismissAlarm(
  alarmId: string,
  source: 'web' | 'android_widget' | 'llamrei_agent' = 'web',
): AlarmReminderRow | null {
  const db = getDb();
  const alarm = db.prepare('SELECT * FROM task_alarms_reminders WHERE id = ?').get(alarmId) as unknown as AlarmReminderRow | undefined;
  if (!alarm) return null;

  db.prepare("UPDATE task_alarms_reminders SET status = 'dismissed', enabled = 0, snoozed_until = NULL, dismissed_from = ? WHERE id = ?").run(
    source,
    alarmId,
  );
  const updated = db.prepare('SELECT * FROM task_alarms_reminders WHERE id = ?').get(alarmId) as unknown as AlarmReminderRow;
  sseBus.emit('alarm:update', updated);
  return updated;
}

export async function processDueAlarmsTick(now = new Date()): Promise<AlarmReminderRow[]> {
  const nowIso = now.toISOString();
  const due = getDb()
    .prepare(`SELECT id FROM task_alarms_reminders WHERE ${dueAlarmCondition}`)
    .all(nowIso, nowIso) as { id: string }[];
  const triggered: AlarmReminderRow[] = [];
  for (const { id } of due) {
    const alarm = await triggerDueAlarm(id, nowIso);
    if (alarm) triggered.push(alarm);
  }
  return triggered;
}
