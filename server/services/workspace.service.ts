import { getDb } from '../db/connection.ts';
import { sseBus } from '../lib/sse.ts';
import { syncTaskToCalendarAndAlarms } from './alarm-calendar.service.ts';
import { setPhoneDndForDeepWork } from './nectarlink.service.ts';
import { spawnNextRecurrenceIfNeeded, type RecurrenceRule } from './phase2-productivity.service.ts';

export interface MacroGoalRow {
  id: string;
  title: string;
  category: 'academic' | 'trading' | 'organization' | 'personal' | 'financial';
  target_date: string | null;
  target_metric_label: string | null;
  progress_percent: number;
  status: 'active' | 'achieved' | 'paused';
}

export interface SpaceRow {
  id: string;
  name: string;
  color: string;
  icon: string;
  sort_order: number;
}

export interface FolderRow {
  id: string;
  space_id: string;
  name: string;
  sort_order: number;
}

export interface ListRow {
  id: string;
  space_id: string;
  folder_id: string | null;
  name: string;
  statuses_json: string;
  sort_order: number;
}

export interface TaskRow {
  id: string;
  list_id: string;
  parent_task_id: string | null;
  goal_id: string | null;
  title: string;
  description_md: string;
  status: string;
  priority: 'urgent' | 'high' | 'normal' | 'low';
  start_at: string | null;
  due_at: string | null;
  reminder_offsets_json: string;
  hard_alarm_enabled: number;
  hard_alarm_at: string | null;
  time_estimate_minutes: number;
  time_spent_seconds: number;
  postponed_count: number;
  recurrence_rule: RecurrenceRule;
  auto_scheduled_block_start: string | null;
  auto_scheduled_block_end: string | null;
  tags_json: string;
  checklist_json: string;
  custom_fields_json: string;
  attachments_json: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface ActiveTimerRow {
  id: string;
  task_id: string;
  task_title: string;
  started_at: string;
}

export function getWorkspaceSnapshot(): {
  goals: MacroGoalRow[];
  spaces: SpaceRow[];
  folders: FolderRow[];
  lists: ListRow[];
  tasks: TaskRow[];
  dependencies: Array<{ task_id: string; depends_on_task_id: string }>;
  activeTimer: ActiveTimerRow | null;
} {
  const db = getDb();
  const goals = db.prepare('SELECT * FROM macro_goals ORDER BY created_at ASC').all() as unknown as MacroGoalRow[];
  const spaces = db.prepare('SELECT * FROM spaces ORDER BY sort_order ASC, created_at ASC').all() as unknown as SpaceRow[];
  const folders = db.prepare('SELECT * FROM folders ORDER BY sort_order ASC, created_at ASC').all() as unknown as FolderRow[];
  const lists = db.prepare('SELECT * FROM lists ORDER BY sort_order ASC, created_at ASC').all() as unknown as ListRow[];
  const tasks = db
    .prepare('SELECT * FROM tasks ORDER BY sort_order ASC, created_at DESC')
    .all() as unknown as TaskRow[];
  const dependencies = db.prepare('SELECT task_id, depends_on_task_id FROM task_dependencies').all() as Array<{
    task_id: string;
    depends_on_task_id: string;
  }>;
  const activeTimer = db
    .prepare(
      `SELECT te.id, te.task_id, t.title AS task_title, te.started_at
       FROM task_time_entries te
       JOIN tasks t ON t.id = te.task_id
       WHERE te.ended_at IS NULL
       ORDER BY te.started_at DESC
       LIMIT 1`,
    )
    .get() as unknown as ActiveTimerRow | undefined;

  return { goals, spaces, folders, lists, tasks, dependencies, activeTimer: activeTimer ?? null };
}

export function recomputeGoalProgress(goalId: string | null | undefined): void {
  if (!goalId) return;
  const db = getDb();
  const stats = db
    .prepare(
      `SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'Done' THEN 1 ELSE 0 END) AS done_cnt
       FROM tasks WHERE goal_id = ? AND parent_task_id IS NULL`,
    )
    .get(goalId) as { total: number; done_cnt: number | null };
  if (stats.total > 0) {
    const pct = Math.round(((stats.done_cnt ?? 0) / stats.total) * 100);
    db.prepare('UPDATE macro_goals SET progress_percent = ? WHERE id = ?').run(pct, goalId);
  }
}

export function createSpace(name: string, color = '#00d992', icon = 'Briefcase'): SpaceRow {
  const db = getDb();
  const id = `space_${crypto.randomUUID().slice(0, 8)}`;
  db.prepare('INSERT INTO spaces (id, name, color, icon) VALUES (?, ?, ?, ?)').run(id, name, color, icon);
  sseBus.emit('workspace:update', { spaceId: id });
  return db.prepare('SELECT * FROM spaces WHERE id = ?').get(id) as unknown as SpaceRow;
}

export function createFolder(spaceId: string, name: string): FolderRow {
  const db = getDb();
  const id = `folder_${crypto.randomUUID().slice(0, 8)}`;
  db.prepare('INSERT INTO folders (id, space_id, name) VALUES (?, ?, ?)').run(id, spaceId, name);
  sseBus.emit('workspace:update', { folderId: id });
  return db.prepare('SELECT * FROM folders WHERE id = ?').get(id) as unknown as FolderRow;
}

export function createList(spaceId: string, name: string, folderId: string | null = null): ListRow {
  const db = getDb();
  const id = `list_${crypto.randomUUID().slice(0, 8)}`;
  db.prepare('INSERT INTO lists (id, space_id, folder_id, name) VALUES (?, ?, ?, ?)').run(id, spaceId, folderId, name);
  sseBus.emit('workspace:update', { listId: id });
  return db.prepare('SELECT * FROM lists WHERE id = ?').get(id) as unknown as ListRow;
}

export function createMacroGoal(params: {
  title: string;
  category: MacroGoalRow['category'];
  targetDate?: string | null;
  targetMetricLabel?: string | null;
}): MacroGoalRow {
  const db = getDb();
  const id = `goal_${crypto.randomUUID().slice(0, 8)}`;
  db.prepare(
    `INSERT INTO macro_goals (id, title, category, target_date, target_metric_label)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(id, params.title, params.category, params.targetDate ?? null, params.targetMetricLabel ?? null);
  sseBus.emit('workspace:update', { goalId: id });
  return db.prepare('SELECT * FROM macro_goals WHERE id = ?').get(id) as unknown as MacroGoalRow;
}

export interface CreateTaskInput {
  id?: string;
  listId: string;
  parentTaskId?: string | null;
  goalId?: string | null;
  title: string;
  descriptionMd?: string;
  status?: string;
  priority?: TaskRow['priority'];
  startAt?: string | null;
  dueAt?: string | null;
  reminderOffsets?: number[];
  hardAlarmEnabled?: boolean;
  hardAlarmAt?: string | null;
  timeEstimateMinutes?: number;
  tags?: string[];
  subtasks?: string[];
}

export function createTask(input: CreateTaskInput): TaskRow {
  const db = getDb();
  const id = input.id ?? `task_${crypto.randomUUID().slice(0, 8)}`;
  const startAt = input.startAt ?? input.dueAt ?? null;
  const hardAlarmAt = input.hardAlarmEnabled ? (input.hardAlarmAt ?? startAt) : null;

  db.prepare(
    `INSERT INTO tasks (
      id, list_id, parent_task_id, goal_id, title, description_md, status, priority,
      start_at, due_at, reminder_offsets_json, hard_alarm_enabled, hard_alarm_at,
      time_estimate_minutes, tags_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.listId,
    input.parentTaskId ?? null,
    input.goalId ?? null,
    input.title,
    input.descriptionMd ?? '',
    input.status ?? 'To Do',
    input.priority ?? 'normal',
    startAt,
    input.dueAt ?? null,
    JSON.stringify(input.reminderOffsets ?? [15]),
    input.hardAlarmEnabled ? 1 : 0,
    hardAlarmAt,
    input.timeEstimateMinutes ?? 30,
    JSON.stringify(input.tags ?? []),
  );

  if (input.subtasks?.length) {
    for (const subTitle of input.subtasks) {
      const subId = `task_${crypto.randomUUID().slice(0, 8)}`;
      db.prepare(
        `INSERT INTO tasks (id, list_id, parent_task_id, goal_id, title, status, priority, due_at)
         VALUES (?, ?, ?, ?, ?, 'To Do', ?, ?)`,
      ).run(subId, input.listId, id, input.goalId ?? null, subTitle, input.priority ?? 'normal', input.dueAt ?? null);
    }
  }

  syncTaskToCalendarAndAlarms(id);
  recomputeGoalProgress(input.goalId);
  sseBus.emit('workspace:update', { taskId: id });
  return db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as unknown as TaskRow;
}

export interface UpdateTaskPatch {
  title?: string;
  descriptionMd?: string;
  status?: string;
  priority?: TaskRow['priority'];
  goalId?: string | null;
  startAt?: string | null;
  dueAt?: string | null;
  reminderOffsets?: number[];
  hardAlarmEnabled?: boolean;
  hardAlarmAt?: string | null;
  tags?: string[];
  checklist?: Array<{ id: string; text: string; done: boolean }>;
  autoScheduledBlockStart?: string | null;
  autoScheduledBlockEnd?: string | null;
}

export function updateTask(taskId: string, patch: UpdateTaskPatch): TaskRow | null {
  const db = getDb();
  const prev = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as unknown as TaskRow | undefined;
  if (!prev) return null;

  let postponedIncrement = 0;
  if (patch.dueAt && prev.due_at) {
    const prevMs = Date.parse(prev.due_at);
    const nextMs = Date.parse(patch.dueAt);
    if (!Number.isNaN(prevMs) && !Number.isNaN(nextMs) && nextMs > prevMs + 60_000) {
      postponedIncrement = 1;
    }
  }

  const nextStart = patch.startAt !== undefined ? patch.startAt : prev.start_at;
  const nextDue = patch.dueAt !== undefined ? patch.dueAt : prev.due_at;
  const nextHardEnabled = patch.hardAlarmEnabled !== undefined ? (patch.hardAlarmEnabled ? 1 : 0) : prev.hard_alarm_enabled;
  const timeChanged = patch.startAt !== undefined || patch.dueAt !== undefined;
  const nextHardAt =
    patch.hardAlarmAt !== undefined
      ? patch.hardAlarmAt
      : nextHardEnabled
        ? (timeChanged ? (nextStart ?? nextDue) : (prev.hard_alarm_at ?? nextStart ?? nextDue))
        : null;

  db.prepare(
    `UPDATE tasks SET
      title = ?,
      description_md = ?,
      status = ?,
      priority = ?,
      goal_id = ?,
      start_at = ?,
      due_at = ?,
      reminder_offsets_json = ?,
      hard_alarm_enabled = ?,
      hard_alarm_at = ?,
      tags_json = ?,
      checklist_json = ?,
      auto_scheduled_block_start = ?,
      auto_scheduled_block_end = ?,
      postponed_count = postponed_count + ?,
      updated_at = datetime('now')
     WHERE id = ?`,
  ).run(
    patch.title ?? prev.title,
    patch.descriptionMd ?? prev.description_md,
    patch.status ?? prev.status,
    patch.priority ?? prev.priority,
    patch.goalId !== undefined ? patch.goalId : prev.goal_id,
    nextStart,
    nextDue,
    patch.reminderOffsets ? JSON.stringify(patch.reminderOffsets) : prev.reminder_offsets_json,
    nextHardEnabled,
    nextHardAt,
    patch.tags ? JSON.stringify(patch.tags) : prev.tags_json,
    patch.checklist ? JSON.stringify(patch.checklist) : prev.checklist_json,
    patch.autoScheduledBlockStart !== undefined ? patch.autoScheduledBlockStart : prev.auto_scheduled_block_start,
    patch.autoScheduledBlockEnd !== undefined ? patch.autoScheduledBlockEnd : prev.auto_scheduled_block_end,
    postponedIncrement,
    taskId,
  );

  syncTaskToCalendarAndAlarms(taskId, {
    reopen: prev.status === 'Done' && patch.status !== undefined && patch.status !== 'Done',
    enableHardAlarm: !prev.hard_alarm_enabled && patch.hardAlarmEnabled === true,
  });
  recomputeGoalProgress(prev.goal_id);
  if (patch.goalId && patch.goalId !== prev.goal_id) {
    recomputeGoalProgress(patch.goalId);
  }
  const updated = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as unknown as TaskRow;
  if (prev.status !== 'Done' && updated.status === 'Done') {
    spawnNextRecurrenceIfNeeded(updated);
  }
  sseBus.emit('workspace:update', { taskId });
  return updated;
}

export function deleteTask(taskId: string): boolean {
  const db = getDb();
  const prev = db.prepare('SELECT goal_id FROM tasks WHERE id = ?').get(taskId) as { goal_id: string | null } | undefined;
  const info = db.prepare('DELETE FROM tasks WHERE id = ?').run(taskId);
  if (prev?.goal_id) recomputeGoalProgress(prev.goal_id);
  sseBus.emit('workspace:update', { deletedTaskId: taskId });
  return info.changes > 0;
}

export function addTaskDependency(taskId: string, dependsOnTaskId: string): void {
  if (taskId === dependsOnTaskId) return;
  const db = getDb();
  db.prepare('INSERT OR IGNORE INTO task_dependencies (task_id, depends_on_task_id) VALUES (?, ?)').run(taskId, dependsOnTaskId);
  sseBus.emit('workspace:update', { taskId });
}

export async function startTaskTimer(taskId: string): Promise<ActiveTimerRow | null> {
  const db = getDb();
  // Stop any currently running timer first
  const running = db.prepare('SELECT task_id FROM task_time_entries WHERE ended_at IS NULL').all() as Array<{ task_id: string }>;
  for (const r of running) {
    await stopTaskTimer(r.task_id);
  }

  const task = db.prepare('SELECT id, title FROM tasks WHERE id = ?').get(taskId) as { id: string; title: string } | undefined;
  if (!task) return null;

  const entryId = `te_${crypto.randomUUID().slice(0, 8)}`;
  const startedAt = new Date().toISOString();
  db.prepare('INSERT INTO task_time_entries (id, task_id, started_at) VALUES (?, ?, ?)').run(entryId, taskId, startedAt);

  // Deep Work Auto-DND Hook via NectarLink (FR-56)
  await setPhoneDndForDeepWork(true);

  const row: ActiveTimerRow = { id: entryId, task_id: task.id, task_title: task.title, started_at: startedAt };
  sseBus.emit('timer:update', row);
  return row;
}

export async function stopTaskTimer(taskId: string): Promise<{ durationSeconds: number }> {
  const db = getDb();
  const entry = db
    .prepare('SELECT id, started_at FROM task_time_entries WHERE task_id = ? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1')
    .get(taskId) as { id: string; started_at: string } | undefined;

  if (!entry) return { durationSeconds: 0 };

  const endedAt = new Date().toISOString();
  const durationSeconds = Math.max(1, Math.round((Date.parse(endedAt) - Date.parse(entry.started_at)) / 1000));
  db.prepare('UPDATE task_time_entries SET ended_at = ?, duration_seconds = ? WHERE id = ?').run(endedAt, durationSeconds, entry.id);
  db.prepare("UPDATE tasks SET time_spent_seconds = time_spent_seconds + ?, updated_at = datetime('now') WHERE id = ?").run(
    durationSeconds,
    taskId,
  );

  await setPhoneDndForDeepWork(false);
  sseBus.emit('timer:update', null);
  sseBus.emit('workspace:update', { taskId });
  return { durationSeconds };
}

export function getWeeklyBottleneckReport(): {
  postponedTasks: Array<{ id: string; title: string; postponed_count: number; status: string; priority: string }>;
  spaceTimeBreakdown: Array<{ space_name: string; color: string; total_minutes: number; task_count: number; done_count: number }>;
  summaryAdvice: string;
} {
  const db = getDb();
  const postponedTasks = db
    .prepare(
      `SELECT id, title, postponed_count, status, priority
       FROM tasks
       WHERE postponed_count >= 1 AND status != 'Done'
       ORDER BY postponed_count DESC
       LIMIT 10`,
    )
    .all() as Array<{ id: string; title: string; postponed_count: number; status: string; priority: string }>;

  const spaceTimeBreakdown = db
    .prepare(
      `SELECT s.name AS space_name, s.color,
              COALESCE(SUM(t.time_spent_seconds), 0) / 60 AS total_minutes,
              COUNT(t.id) AS task_count,
              SUM(CASE WHEN t.status = 'Done' THEN 1 ELSE 0 END) AS done_count
       FROM spaces s
       LEFT JOIN lists l ON l.space_id = s.id
       LEFT JOIN tasks t ON t.list_id = l.id AND t.parent_task_id IS NULL
       GROUP BY s.id
       ORDER BY total_minutes DESC`,
    )
    .all() as Array<{ space_name: string; color: string; total_minutes: number; task_count: number; done_count: number }>;

  const topBottleneck = postponedTasks[0];
  const summaryAdvice = topBottleneck
    ? `Terdeteksi bottleneck: "${topBottleneck.title}" sudah ditunda ${topBottleneck.postponed_count}x. Pecah menjadi subtugas 25 menit atau pasang Hard Alarm pagi hari.`
    : 'Tidak ada tugas yang sering tertunda minggu ini. Pertahankan ritme eksekusi Anda.';

  return { postponedTasks, spaceTimeBreakdown, summaryAdvice };
}
