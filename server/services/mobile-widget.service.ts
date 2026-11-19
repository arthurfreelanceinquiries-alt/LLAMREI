import { getDb, todayWibIsoDate } from '../db/connection.ts';
import { sseBus } from '../lib/sse.ts';
import {
  dismissAlarm,
  getNextArmedAlarm,
  listAlarmsAndReminders,
  listCalendarEvents,
  snoozeAlarm,
  toggleAlarmEnabled,
} from './alarm-calendar.service.ts';
import { createTask, updateTask } from './workspace.service.ts';

export interface MobileMutationItem {
  mutationId: string;
  deviceId: string;
  actionType: 'task_toggle_done' | 'task_quick_create' | 'alarm_dismiss' | 'alarm_snooze' | 'alarm_toggle';
  targetId: string;
  payload?: {
    done?: boolean;
    minutes?: number;
    enabled?: boolean;
    title?: string;
    listId?: string;
    hardAlarm?: boolean;
    dueAt?: string;
  };
  clientTimestamp: string;
}

export function getMobileWidgetSnapshot() {
  const db = getDb();
  const today = todayWibIsoDate();
  const tasks = db
    .prepare(
      `SELECT t.id, t.title, t.status, t.priority, t.due_at, t.hard_alarm_enabled, s.name AS space_name, s.color AS space_color
       FROM tasks t
       JOIN lists l ON l.id = t.list_id
       JOIN spaces s ON s.id = l.space_id
       WHERE t.parent_task_id IS NULL
       ORDER BY CASE WHEN t.status = 'Done' THEN 1 ELSE 0 END,
                CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
                t.due_at ASC
       LIMIT 12`,
    )
    .all();

  const alarms = listAlarmsAndReminders().filter((a) => a.kind === 'hard_alarm');
  const reminders = listAlarmsAndReminders().filter((a) => a.kind === 'soft_reminder' && a.status !== 'completed');
  const nextAlarm = getNextArmedAlarm();
  const calendar = listCalendarEvents().filter((e) => e.start_at.startsWith(today)).slice(0, 8);

  return {
    generatedAt: new Date().toISOString(),
    todayWib: today,
    nextAlarm,
    tasks,
    alarms,
    reminders,
    todayCalendar: calendar,
  };
}

/**
 * Idempotent delta reconciliation endpoint for Android Home Screen Widgets
 * and Mobile Offline Outbox Queue (FR-65, FR-68).
 */
export function reconcileMobileMutations(mutations: MobileMutationItem[]): {
  applied: number;
  skippedDuplicate: number;
  snapshot: ReturnType<typeof getMobileWidgetSnapshot>;
} {
  const db = getDb();
  let applied = 0;
  let skippedDuplicate = 0;

  for (const m of mutations) {
    const exists = db.prepare('SELECT 1 FROM mobile_sync_mutations WHERE mutation_id = ?').get(m.mutationId);
    if (exists) {
      skippedDuplicate++;
      continue;
    }

    switch (m.actionType) {
      case 'task_toggle_done': {
        const nextStatus = m.payload?.done === false ? 'To Do' : 'Done';
        updateTask(m.targetId, { status: nextStatus });
        break;
      }
      case 'task_quick_create': {
        const defaultList = db.prepare('SELECT id FROM lists ORDER BY sort_order ASC LIMIT 1').get() as
          | { id: string }
          | undefined;
        if (defaultList && m.payload?.title) {
          createTask({
            listId: m.payload.listId ?? defaultList.id,
            title: m.payload.title,
            priority: 'high',
            dueAt: m.payload.dueAt ?? new Date(Date.now() + 3_600_000).toISOString(),
            hardAlarmEnabled: Boolean(m.payload.hardAlarm),
          });
        }
        break;
      }
      case 'alarm_dismiss': {
        dismissAlarm(m.targetId, 'android_widget');
        break;
      }
      case 'alarm_snooze': {
        snoozeAlarm(m.targetId, m.payload?.minutes ?? 10, 'android_widget');
        break;
      }
      case 'alarm_toggle': {
        toggleAlarmEnabled(m.targetId, Boolean(m.payload?.enabled));
        break;
      }
    }

    db.prepare(
      `INSERT INTO mobile_sync_mutations (mutation_id, device_id, action_type, target_id, payload_json, client_timestamp)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(m.mutationId, m.deviceId, m.actionType, m.targetId, JSON.stringify(m.payload ?? {}), m.clientTimestamp);
    applied++;
  }

  sseBus.emit('mobile:reconciled', { applied, skippedDuplicate });
  return {
    applied,
    skippedDuplicate,
    snapshot: getMobileWidgetSnapshot(),
  };
}
