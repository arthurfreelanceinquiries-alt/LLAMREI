import { getDb, todayWibIsoDate } from '../db/connection.ts';
import { sseBus } from '../lib/sse.ts';
import { createTask, type TaskRow } from './workspace.service.ts';

export interface WorkspaceDocRow {
  id: string;
  space_id: string | null;
  linked_task_id: string | null;
  title: string;
  content_md: string;
  updated_at: string;
  created_at: string;
}

export function listWorkspaceDocs(taskId?: string): WorkspaceDocRow[] {
  const db = getDb();
  if (taskId) {
    return db
      .prepare('SELECT * FROM workspace_docs WHERE linked_task_id = ? ORDER BY updated_at DESC')
      .all(taskId) as unknown as WorkspaceDocRow[];
  }
  return db.prepare('SELECT * FROM workspace_docs ORDER BY updated_at DESC').all() as unknown as WorkspaceDocRow[];
}

export function createOrUpdateWorkspaceDoc(input: {
  id?: string;
  spaceId?: string | null;
  linkedTaskId?: string | null;
  title: string;
  contentMd: string;
}): WorkspaceDocRow {
  const db = getDb();
  const id = input.id ?? `doc_${crypto.randomUUID().slice(0, 8)}`;
  db.prepare(
    `INSERT INTO workspace_docs (id, space_id, linked_task_id, title, content_md, updated_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET
       title = excluded.title,
       content_md = excluded.content_md,
       linked_task_id = COALESCE(excluded.linked_task_id, workspace_docs.linked_task_id),
       updated_at = datetime('now')`,
  ).run(id, input.spaceId ?? null, input.linkedTaskId ?? null, input.title.trim() || 'Untitled Doc', input.contentMd);

  const row = db.prepare('SELECT * FROM workspace_docs WHERE id = ?').get(id) as unknown as WorkspaceDocRow;
  sseBus.emit('docs:update', row);
  return row;
}

export function deleteWorkspaceDoc(id: string): boolean {
  const db = getDb();
  const info = db.prepare('DELETE FROM workspace_docs WHERE id = ?').run(id);
  sseBus.emit('docs:update', { deletedId: id });
  return Number(info.changes) > 0;
}

/**
 * Neutralizes CSV formula-injection characters (=, +, -, @, tab, CR) and quotes cell safely.
 */
function csvCell(val: unknown): string {
  let str = String(val ?? '');
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }
  return `"${str.replace(/"/g, '""')}"`;
}

export function exportWorkspaceAsCsv(listId?: string): string {
  const db = getDb();
  const rows = (
    listId
      ? db.prepare('SELECT * FROM tasks WHERE list_id = ? AND parent_task_id IS NULL ORDER BY sort_order ASC').all(listId)
      : db.prepare('SELECT * FROM tasks WHERE parent_task_id IS NULL ORDER BY created_at DESC').all()
  ) as unknown as TaskRow[];

  const header = ['id', 'list_id', 'title', 'status', 'priority', 'start_at', 'due_at', 'time_estimate_minutes', 'hard_alarm_enabled'];
  const lines = [header.join(',')];
  for (const t of rows) {
    lines.push(
      [
        csvCell(t.id),
        csvCell(t.list_id),
        csvCell(t.title),
        csvCell(t.status),
        csvCell(t.priority),
        csvCell(t.start_at ?? ''),
        csvCell(t.due_at ?? ''),
        csvCell(t.time_estimate_minutes),
        csvCell(t.hard_alarm_enabled),
      ].join(','),
    );
  }
  return lines.join('\n');
}

export function exportWorkspaceAsMarkdown(listId?: string): string {
  const db = getDb();
  const rows = (
    listId
      ? db.prepare('SELECT * FROM tasks WHERE list_id = ? AND parent_task_id IS NULL ORDER BY sort_order ASC').all(listId)
      : db.prepare('SELECT * FROM tasks WHERE parent_task_id IS NULL ORDER BY created_at DESC').all()
  ) as unknown as TaskRow[];

  const lines = [`# Llamrei Tasks Export (${todayWibIsoDate()})`, ''];
  for (const t of rows) {
    const check = t.status === 'Done' ? 'x' : ' ';
    const alarmTag = t.hard_alarm_enabled ? ' ⏰' : '';
    const dueStr = t.due_at ? ` *(Due: ${t.due_at})*` : '';
    lines.push(`- [${check}] **[${t.priority.toUpperCase()}]** ${t.title}${alarmTag}${dueStr}`);
  }
  return lines.join('\n');
}

function parseCsvRow(line: string): string[] {
  const cells: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      cells.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  cells.push(cur);
  return cells;
}

export function importTasksIntoList(params: {
  listId: string;
  format: 'csv' | 'markdown';
  content: string;
}): { ok: boolean; importedCount: number; error?: string } {
  const db = getDb();
  const listExists = db.prepare('SELECT 1 FROM lists WHERE id = ?').get(params.listId);
  if (!listExists) return { ok: false, importedCount: 0, error: 'List tujuan tidak ditemukan' };

  const lines = params.content.replace(/\r\n/g, '\n').split('\n').filter((l) => l.trim().length > 0);
  let importedCount = 0;

  if (params.format === 'csv') {
    const header = parseCsvRow(lines[0] ?? '').map((h) => h.trim().toLowerCase());
    const titleIdx = header.indexOf('title');
    const prioIdx = header.indexOf('priority');
    const statusIdx = header.indexOf('status');
    const dueIdx = header.indexOf('due_at');
    const startIdx = titleIdx === -1 ? 0 : 1;

    for (let i = startIdx; i < lines.length; i++) {
      const cols = parseCsvRow(lines[i]);
      const title = (titleIdx >= 0 ? cols[titleIdx] : cols[0])?.replace(/^'/, '').trim();
      if (!title) continue;
      const rawPrio = (prioIdx >= 0 ? cols[prioIdx] : 'normal')?.toLowerCase();
      const priority = rawPrio === 'urgent' || rawPrio === 'high' || rawPrio === 'low' ? rawPrio : 'normal';
      const status = (statusIdx >= 0 ? cols[statusIdx] : 'To Do')?.trim() || 'To Do';
      const dueAt = dueIdx >= 0 && cols[dueIdx]?.trim() ? cols[dueIdx].trim() : null;
      createTask({ listId: params.listId, title, priority, status, dueAt });
      importedCount++;
    }
  } else {
    for (const line of lines) {
      const m = line.match(/^-\s*\[([ xX])\]\s*(?:\*\*\[(\w+)\]\*\*\s*)?(.+?)$/);
      if (!m) continue;
      const done = m[1].toLowerCase() === 'x';
      const rawPrio = (m[2] ?? 'normal').toLowerCase();
      const priority = rawPrio === 'urgent' || rawPrio === 'high' || rawPrio === 'low' ? rawPrio : 'normal';
      const cleanTitle = m[3].replace(/⏰/g, '').replace(/\*\(Due:.*?\)\*/g, '').trim();
      if (!cleanTitle) continue;
      createTask({ listId: params.listId, title: cleanTitle, status: done ? 'Done' : 'To Do', priority });
      importedCount++;
    }
  }

  return { ok: true, importedCount };
}

export function getGanttAndWorkloadSummary(): {
  timelineTasks: Array<{
    id: string;
    title: string;
    status: string;
    priority: string;
    startAt: string;
    endAt: string;
    estimateMinutes: number;
  }>;
  weeklyWorkload: Array<{ dateWib: string; taskCount: number; estimatedMinutes: number }>;
} {
  const db = getDb();
  const tasks = db
    .prepare(
      `SELECT id, title, status, priority, start_at, due_at, auto_scheduled_block_start, auto_scheduled_block_end, time_estimate_minutes
       FROM tasks WHERE parent_task_id IS NULL ORDER BY COALESCE(start_at, due_at, created_at) ASC`,
    )
    .all() as Array<{
    id: string;
    title: string;
    status: string;
    priority: string;
    start_at: string | null;
    due_at: string | null;
    auto_scheduled_block_start: string | null;
    auto_scheduled_block_end: string | null;
    time_estimate_minutes: number;
  }>;

  const dayMap = new Map<string, { taskCount: number; estimatedMinutes: number }>();
  const timelineTasks = tasks.flatMap((task) => {
    const startAt = task.auto_scheduled_block_start ?? task.start_at ?? task.due_at;
    if (!startAt || !Number.isFinite(Date.parse(startAt))) return [];
    const endAt = task.auto_scheduled_block_end ?? task.due_at ?? startAt;
    const dateKey = todayWibIsoDate(new Date(startAt));
    const estimateMinutes = Math.max(0, task.time_estimate_minutes);
    if (task.status !== 'Done') {
      const load = dayMap.get(dateKey) ?? { taskCount: 0, estimatedMinutes: 0 };
      load.taskCount += 1;
      load.estimatedMinutes += estimateMinutes;
      dayMap.set(dateKey, load);
    }
    return [{
      id: task.id,
      title: task.title,
      status: task.status,
      priority: task.priority,
      startAt,
      endAt: Date.parse(endAt) >= Date.parse(startAt) ? endAt : startAt,
      estimateMinutes,
    }];
  }).sort((left, right) => Date.parse(left.startAt) - Date.parse(right.startAt));

  const now = Date.now();
  const weeklyWorkload = Array.from({ length: 7 }, (_, offset) => {
    const dateWib = todayWibIsoDate(new Date(now + offset * 86_400_000));
    return { dateWib, ...(dayMap.get(dateWib) ?? { taskCount: 0, estimatedMinutes: 0 }) };
  });

  return { timelineTasks, weeklyWorkload };
}
