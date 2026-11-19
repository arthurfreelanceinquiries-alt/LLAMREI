import { execFileSync, spawn } from 'node:child_process';
import { getDb } from '../db/connection.ts';
import { sseBus } from '../lib/sse.ts';
import { createTask, type TaskRow } from './workspace.service.ts';

export type RecurrenceRule = 'none' | 'daily' | 'weekdays' | 'weekly' | 'monthly';

export const VALID_RECURRENCE_RULES = new Set<RecurrenceRule>(['none', 'daily', 'weekdays', 'weekly', 'monthly']);

export interface TaskTemplateRow {
  id: string;
  name: string;
  category: string;
  tasks_json: string;
}

export interface AppLauncherRow {
  id: string;
  label: string;
  command_key: string;
  icon: string;
  description: string | null;
}

function getWibWeekday(date: Date): number {
  const shifted = new Date(date.getTime() + 7 * 3600_000);
  return shifted.getUTCDay();
}

function advanceIsoDate(isoStr: string | null, rule: RecurrenceRule): string | null {
  if (!isoStr || rule === 'none') return null;
  const d = new Date(isoStr);
  if (Number.isNaN(d.getTime())) return null;

  if (rule === 'daily') {
    d.setUTCDate(d.getUTCDate() + 1);
  } else if (rule === 'weekdays') {
    do {
      d.setUTCDate(d.getUTCDate() + 1);
    } while (getWibWeekday(d) === 0 || getWibWeekday(d) === 6);
  } else if (rule === 'weekly') {
    d.setUTCDate(d.getUTCDate() + 7);
  } else if (rule === 'monthly') {
    const shifted = new Date(d.getTime() + 7 * 3600_000);
    const origDay = shifted.getUTCDate();
    const targetMonth = shifted.getUTCMonth() + 1;
    const targetYear = shifted.getUTCFullYear() + Math.floor(targetMonth / 12);
    const normMonth = targetMonth % 12;
    const daysInTargetMonth = new Date(Date.UTC(targetYear, normMonth + 1, 0)).getUTCDate();
    shifted.setUTCFullYear(targetYear, normMonth, Math.min(origDay, daysInTargetMonth));
    return new Date(shifted.getTime() - 7 * 3600_000).toISOString();
  }
  return d.toISOString();
}

/**
 * Generates the next occurrence of a recurring ClickUp task when marked Done (FR-15),
 * preserving custom fields, checklist items (unchecked), and Hard Alarm offset.
 */
export function spawnNextRecurrenceIfNeeded(completedTask: TaskRow & { recurrence_rule?: RecurrenceRule }): TaskRow | null {
  const rule = completedTask.recurrence_rule ?? 'none';
  if (completedTask.status !== 'Done' || rule === 'none' || completedTask.parent_task_id) {
    return null;
  }

  const nextStart = advanceIsoDate(completedTask.start_at, rule);
  const nextDue = advanceIsoDate(completedTask.due_at ?? completedTask.start_at, rule);
  const nextHardAt = advanceIsoDate(completedTask.hard_alarm_at ?? completedTask.start_at ?? completedTask.due_at, rule);

  const created = createTask({
    listId: completedTask.list_id,
    goalId: completedTask.goal_id,
    title: completedTask.title,
    descriptionMd: completedTask.description_md,
    status: 'To Do',
    priority: completedTask.priority,
    startAt: nextStart,
    dueAt: nextDue,
    reminderOffsets: JSON.parse(completedTask.reminder_offsets_json || '[15]') as number[],
    hardAlarmEnabled: completedTask.hard_alarm_enabled === 1,
    hardAlarmAt: nextHardAt,
    timeEstimateMinutes: completedTask.time_estimate_minutes,
    tags: JSON.parse(completedTask.tags_json || '[]') as string[],
  });

  const db = getDb();
  const prevChecklist = JSON.parse(completedTask.checklist_json || '[]') as Array<{ id: string; text: string; done: boolean }>;
  const resetChecklist = prevChecklist.map((c) => ({ ...c, done: false }));
  db.prepare('UPDATE tasks SET recurrence_rule = ?, custom_fields_json = ?, checklist_json = ? WHERE id = ?').run(
    rule,
    completedTask.custom_fields_json || '{}',
    JSON.stringify(resetChecklist),
    created.id,
  );

  sseBus.emit('workspace:update', { recurringCreatedId: created.id });
  return db.prepare('SELECT * FROM tasks WHERE id = ?').get(created.id) as unknown as TaskRow;
}

export function setTaskRecurrenceAndCustomFields(
  taskId: string,
  patch: { recurrenceRule?: RecurrenceRule; customFields?: Record<string, unknown> },
): { ok: boolean; error?: string } {
  const db = getDb();
  if (patch.recurrenceRule !== undefined) {
    if (!VALID_RECURRENCE_RULES.has(patch.recurrenceRule)) {
      return { ok: false, error: `Invalid recurrenceRule: ${String(patch.recurrenceRule)}` };
    }
    db.prepare('UPDATE tasks SET recurrence_rule = ? WHERE id = ?').run(patch.recurrenceRule, taskId);
  }
  if (patch.customFields && typeof patch.customFields === 'object' && !Array.isArray(patch.customFields)) {
    const clean: Record<string, unknown> = Object.create(null);
    for (const [k, v] of Object.entries(patch.customFields)) {
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
      clean[k] = v;
    }
    db.prepare('UPDATE tasks SET custom_fields_json = ? WHERE id = ?').run(JSON.stringify(clean), taskId);
  }
  sseBus.emit('workspace:update', { taskId });
  return { ok: true };
}

export function listTaskTemplates(): TaskTemplateRow[] {
  const db = getDb();
  return db.prepare('SELECT * FROM task_templates ORDER BY name ASC').all() as unknown as TaskTemplateRow[];
}

export function applyTaskTemplateToList(templateId: string, listId: string): TaskRow[] {
  const db = getDb();
  const tpl = db.prepare('SELECT * FROM task_templates WHERE id = ?').get(templateId) as unknown as TaskTemplateRow | undefined;
  const listExists = db.prepare('SELECT 1 FROM lists WHERE id = ?').get(listId);
  if (!tpl || !listExists) return [];

  const defs = JSON.parse(tpl.tasks_json) as Array<{
    title: string;
    priority?: TaskRow['priority'];
    estimate?: number;
    hardAlarm?: boolean;
  }>;

  const created: TaskRow[] = [];
  let offsetMin = 60;
  for (const d of defs) {
    const dueIso = new Date(Date.now() + offsetMin * 60_000).toISOString();
    created.push(
      createTask({
        listId,
        title: d.title,
        priority: d.priority ?? 'normal',
        dueAt: dueIso,
        hardAlarmEnabled: Boolean(d.hardAlarm),
        timeEstimateMinutes: d.estimate ?? 30,
      }),
    );
    offsetMin += 45;
  }
  return created;
}

export function listAppLaunchers(): AppLauncherRow[] {
  const db = getDb();
  return db.prepare('SELECT * FROM app_launchers ORDER BY label ASC').all() as unknown as AppLauncherRow[];
}

const ALLOWED_COMMANDS: Record<string, string[]> = {
  antigravity: ['antigravity'],
  'x-terminal-emulator': ['x-terminal-emulator'],
  nectarlink: ['nectarlink'],
  obsidian: ['obsidian'],
};

function commandExistsInPath(cmd: string): boolean {
  try {
    execFileSync('which', [cmd], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export function launchWhitelistedApp(launcherId: string): { ok: boolean; launched: string; note: string } {
  const db = getDb();
  const row = db.prepare('SELECT * FROM app_launchers WHERE id = ?').get(launcherId) as unknown as AppLauncherRow | undefined;
  if (!row || !ALLOWED_COMMANDS[row.command_key]) {
    return { ok: false, launched: launcherId, note: 'Aplikasi tidak ada dalam allowlist peluncur aman.' };
  }

  const [cmd, ...args] = ALLOWED_COMMANDS[row.command_key];
  if (!commandExistsInPath(cmd)) {
    return { ok: false, launched: row.label, note: `Aplikasi "${cmd}" belum terpasang di PATH sistem.` };
  }

  try {
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
    // Always attach error listener to prevent unhandled async ENOENT crashes
    child.on('error', (err) => {
      console.warn(`[launcher] failed to spawn ${cmd}:`, err.message);
    });
    child.unref();
    return { ok: true, launched: row.label, note: `Membuka jendela ${row.label} secara terpisah.` };
  } catch (err) {
    return {
      ok: false,
      launched: row.label,
      note: `Gagal membuka "${cmd}": ${err instanceof Error ? err.message : 'error'}`,
    };
  }
}
