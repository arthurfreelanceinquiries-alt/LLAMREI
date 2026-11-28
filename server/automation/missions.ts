import { afterQuietHours, type AutomationDefinition, type AutomationEvent, type AutomationRule, type AutomationSnapshot, type MissionDetail, type MissionState, type MissionSummary } from '../../shared/automation.ts';
import { getDb } from '../db/connection.ts';
import { HttpBadRequestError } from '../lib/http.ts';
import { sseBus } from '../lib/sse.ts';
import { createTask } from '../services/workspace.service.ts';
import { automationRequestIdPattern, getAutomationRule, inputRecord, listAutomationRules, workspaceListExists } from './rules.ts';

interface MissionRow {
  id: string;
  rule_id: string;
  rule_revision: number;
  definition_json: string;
  status: MissionState;
  step_index: number;
  source_task_id: string | null;
  created_at: string;
  deadline_at: string;
  run_at: string;
  reason: string | null;
  attempts: number;
}

interface EventRow {
  id: number;
  rule_id: string;
  rule_revision: number;
  rule_name: string;
  source_task_id: string;
  created_at: string;
  status: AutomationEvent['status'];
  mission_id?: string;
  reason: string | null;
  attempts: number;
  next_attempt_at: string;
}

interface CheckpointRow {
  step_index: number;
  approval_id: string | null;
  approval_expires_at: string | null;
  approved_at: string | null;
  finished_at: string | null;
  task_id: string | null;
}

const batchSize = 12;
const maxAttempts = 3;
const approvalTimeout = 15 * 60_000;

function inTransaction<T>(operation: () => T): T {
  const db = getDb();
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = operation();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function missionRow(id: string): MissionRow {
  const row = getDb().prepare('SELECT * FROM automation_missions WHERE id = ?').get(id) as unknown as MissionRow | undefined;
  if (!row) throw new HttpBadRequestError(404, 'Misi tidak ditemukan.');
  return row;
}

function summarize(row: MissionRow, definition = JSON.parse(row.definition_json) as AutomationDefinition): MissionSummary {
  return {
    id: row.id, name: definition.name, status: row.status, stepIndex: row.step_index, totalSteps: definition.steps.length,
    createdAt: row.created_at, deadlineAt: row.deadline_at, runAt: row.run_at, reason: row.reason,
  };
}

export function getMission(id: string): MissionDetail {
  const row = missionRow(id);
  const definition = JSON.parse(row.definition_json) as AutomationDefinition;
  const checkpoints = getDb().prepare('SELECT * FROM automation_checkpoints WHERE mission_id = ? ORDER BY step_index').all(id) as unknown as CheckpointRow[];
  const current = checkpoints.find((checkpoint) => checkpoint.step_index === row.step_index);
  return {
    ...summarize(row, definition), definition, sourceTaskId: row.source_task_id,
    checkpoints: checkpoints.map((checkpoint) => ({
      stepIndex: checkpoint.step_index, approvedAt: checkpoint.approved_at, finishedAt: checkpoint.finished_at, taskId: checkpoint.task_id,
    })),
    approval: row.status === 'waiting_approval' && current?.approval_id && current.approval_expires_at
      ? { id: current.approval_id, expiresAt: current.approval_expires_at } : null,
  };
}

export function getAutomationSnapshot(): AutomationSnapshot {
  const db = getDb();
  const missions = db.prepare('SELECT * FROM automation_missions ORDER BY created_at DESC, id LIMIT 60').all() as unknown as MissionRow[];
  const events = db.prepare(`SELECT e.*, m.id AS mission_id FROM automation_events e LEFT JOIN automation_missions m ON m.event_id = e.id
    ORDER BY e.id DESC LIMIT 20`).all() as unknown as EventRow[];
  return {
    rules: listAutomationRules(), missions: missions.map((row) => summarize(row)),
    events: events.map((event) => ({
      id: event.id, ruleName: event.rule_name, sourceTaskId: event.source_task_id, createdAt: event.created_at,
      status: event.status, reason: event.reason, missionId: event.mission_id ?? null,
    })),
  };
}

type MissionSource = { requestId: string } | { event: EventRow };

function insertMission(rule: AutomationRule, source: MissionSource, createdAt: Date, now: Date): string {
  const { id: ruleId, revision, enabled: _enabled, ...definition } = rule;
  const id = crypto.randomUUID();
  const event = 'event' in source ? source.event : null;
  const requestId = 'requestId' in source ? source.requestId : null;
  const deadlineAt = new Date(createdAt.getTime() + definition.maxMinutes * 60_000).toISOString();
  getDb().prepare(`INSERT INTO automation_missions
    (id, rule_id, rule_revision, event_id, request_id, source_task_id, definition_json, status, created_at, deadline_at, run_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?)`).run(
    id, ruleId, revision, event?.id ?? null, requestId, event?.source_task_id ?? null, JSON.stringify(definition),
    createdAt.toISOString(), deadlineAt, afterQuietHours(now, definition.quietHours),
  );
  return id;
}

export function runSavedRule(ruleId: string, raw: unknown, now = new Date()): MissionDetail {
  const { revision, requestId } = inputRecord(raw);
  if (typeof requestId !== 'string' || !automationRequestIdPattern.test(requestId)) throw new HttpBadRequestError(400, 'Identitas permintaan misi tidak valid.');
  const missionId = inTransaction(() => {
    const prior = getDb().prepare('SELECT id, rule_id, rule_revision FROM automation_missions WHERE request_id = ?').get(requestId) as
      { id: string; rule_id: string; rule_revision: number } | undefined;
    if (prior) {
      if (prior.rule_id !== ruleId || prior.rule_revision !== revision) throw new HttpBadRequestError(409, 'Permintaan misi sudah digunakan.');
      return prior.id;
    }
    const rule = getAutomationRule(ruleId);
    if (rule.revision !== revision) throw new HttpBadRequestError(409, 'Aturan sudah berubah. Muat ulang sebelum menjalankan.');
    return insertMission(rule, { requestId }, now, now);
  });
  sseBus.emit('automation:update', {});
  return getMission(missionId);
}

export function approveMissionStep(id: string, raw: unknown, now = new Date()): MissionDetail {
  const { stepIndex, approvalId } = inputRecord(raw);
  if (typeof stepIndex !== 'number' || !Number.isInteger(stepIndex) || typeof approvalId !== 'string' || !automationRequestIdPattern.test(approvalId)) {
    throw new HttpBadRequestError(400, 'Identitas persetujuan tidak valid.');
  }
  inTransaction(() => {
    const db = getDb();
    const row = missionRow(id);
    const iso = now.toISOString();
    if (row.status !== 'waiting_approval' || row.step_index !== stepIndex || row.deadline_at <= iso) {
      throw new HttpBadRequestError(409, 'Langkah ini sudah berubah atau persetujuannya kedaluwarsa.');
    }
    const accepted = db.prepare(`UPDATE automation_checkpoints SET approved_at = ?
      WHERE mission_id = ? AND step_index = ? AND approval_id = ? AND approved_at IS NULL AND approval_expires_at > ?`)
      .run(iso, id, stepIndex, approvalId, iso);
    if (!accepted.changes) throw new HttpBadRequestError(409, 'Persetujuan tidak cocok atau kedaluwarsa.');
    const definition = JSON.parse(row.definition_json) as AutomationDefinition;
    db.prepare("UPDATE automation_missions SET status = 'queued', run_at = ? WHERE id = ?")
      .run(afterQuietHours(now, definition.quietHours), id);
  });
  sseBus.emit('automation:update', {});
  return getMission(id);
}

export function cancelMission(id: string): MissionDetail {
  const result = getDb().prepare(`UPDATE automation_missions SET status = 'cancelled', reason = NULL
    WHERE id = ? AND status IN ('queued', 'waiting_approval')`).run(id);
  if (result.changes) sseBus.emit('automation:update', {});
  return getMission(id);
}

function consumeEvent(event: EventRow, now: Date): boolean {
  return inTransaction(() => {
    const db = getDb();
    const current = db.prepare('SELECT * FROM automation_events WHERE id = ?').get(event.id) as unknown as EventRow | undefined;
    if (current?.status !== 'pending' || current.next_attempt_at > now.toISOString()) return false;
    const rule = getAutomationRule(event.rule_id);
    const createdAt = new Date(event.created_at);
    const expired = now.getTime() >= createdAt.getTime() + rule.maxMinutes * 60_000;
    const changed = !rule.enabled || rule.revision !== event.rule_revision;
    if (changed || expired) {
      db.prepare("UPDATE automation_events SET status = 'skipped', reason = ? WHERE id = ?")
        .run(changed ? 'Aturan dinonaktifkan atau sudah berubah.' : 'Batas waktu pemicu telah lewat.', event.id);
      return true;
    }
    insertMission(rule, { event }, createdAt, now);
    db.prepare("UPDATE automation_events SET status = 'handled', reason = NULL WHERE id = ?").run(event.id);
    return true;
  });
}

function advanceMission(id: string, now: Date): boolean {
  return inTransaction(() => {
    const db = getDb();
    const row = missionRow(id);
    const iso = now.toISOString();
    if (row.status !== 'queued' || row.run_at > iso || row.deadline_at <= iso) return false;
    const definition = JSON.parse(row.definition_json) as AutomationDefinition;
    const afterQuiet = afterQuietHours(now, definition.quietHours);
    if (afterQuiet > iso) {
      db.prepare('UPDATE automation_missions SET run_at = ? WHERE id = ?').run(afterQuiet, id);
      return true;
    }
    const step = definition.steps[row.step_index];
    let taskId: string | null = null;
    if (step.kind === 'create_task') {
      if (!workspaceListExists(step.listId)) {
        db.prepare("UPDATE automation_missions SET status = 'failed', reason = ? WHERE id = ?")
          .run('Daftar tujuan sudah tidak tersedia.', id);
        return true;
      }
      const checkpoint = db.prepare('SELECT approved_at FROM automation_checkpoints WHERE mission_id = ? AND step_index = ?')
        .get(id, row.step_index) as { approved_at: string | null } | undefined;
      if (!checkpoint?.approved_at) {
        const expiry = new Date(Math.min(Date.parse(row.deadline_at), now.getTime() + approvalTimeout)).toISOString();
        db.prepare(`INSERT INTO automation_checkpoints (mission_id, step_index, approval_id, approval_expires_at)
          VALUES (?, ?, ?, ?)`).run(id, row.step_index, crypto.randomUUID(), expiry);
        db.prepare("UPDATE automation_missions SET status = 'waiting_approval', reason = NULL WHERE id = ?").run(id);
        return true;
      }
      taskId = createTask({
        id: `task_${crypto.randomUUID()}`, listId: step.listId, title: step.title, priority: 'normal', reminderOffsets: [],
      }).id;
    }
    db.prepare(`INSERT INTO automation_checkpoints (mission_id, step_index, finished_at, task_id)
      VALUES (?, ?, ?, ?) ON CONFLICT(mission_id, step_index) DO UPDATE SET finished_at = excluded.finished_at, task_id = excluded.task_id`)
      .run(id, row.step_index, iso, taskId);
    const nextStep = row.step_index + 1;
    db.prepare('UPDATE automation_missions SET status = ?, step_index = ?, attempts = 0, run_at = ?, reason = NULL WHERE id = ?')
      .run(nextStep === definition.steps.length ? 'completed' : 'queued', nextStep, iso, id);
    return true;
  });
}

function expireMissions(iso: string): boolean {
  const db = getDb();
  const expired = db.prepare(`UPDATE automation_missions SET status = 'expired', reason = 'Batas waktu misi telah lewat.'
    WHERE status IN ('queued', 'waiting_approval') AND deadline_at <= ?`).run(iso);
  const approvals = db.prepare(`UPDATE automation_missions AS m SET status = 'expired', reason = 'Waktu persetujuan telah habis.'
    WHERE status = 'waiting_approval' AND EXISTS (SELECT 1 FROM automation_checkpoints AS c
      WHERE c.mission_id = m.id AND c.step_index = m.step_index AND c.approval_expires_at <= ?)`).run(iso);
  return Boolean(expired.changes || approvals.changes);
}

function retryTime(attempts: number, now: Date): string {
  return new Date(now.getTime() + 1000 * 2 ** attempts).toISOString();
}

export function processAutomationTick(now = new Date()): boolean {
  const db = getDb();
  const iso = now.toISOString();
  let changed = expireMissions(iso);
  const events = db.prepare("SELECT * FROM automation_events WHERE status = 'pending' AND next_attempt_at <= ? ORDER BY next_attempt_at, id LIMIT ?")
    .all(iso, batchSize) as unknown as EventRow[];
  for (const event of events) {
    try {
      if (consumeEvent(event, now)) changed = true;
    } catch {
      const exhausted = event.attempts + 1 >= maxAttempts;
      const result = db.prepare(`UPDATE automation_events SET attempts = attempts + 1, status = ?, next_attempt_at = ?, reason = ?
        WHERE id = ? AND attempts = ? AND status = 'pending'`).run(
        exhausted ? 'failed' : 'pending', retryTime(event.attempts, now),
        exhausted ? 'Pemicu gagal diproses.' : 'Menunggu percobaan ulang.', event.id, event.attempts,
      );
      if (result.changes) changed = true;
    }
  }
  const due = db.prepare("SELECT * FROM automation_missions WHERE status = 'queued' AND run_at <= ? ORDER BY run_at, id LIMIT ?")
    .all(iso, batchSize) as unknown as MissionRow[];
  for (const mission of due) {
    try {
      if (advanceMission(mission.id, now)) changed = true;
    } catch {
      const exhausted = mission.attempts + 1 >= maxAttempts;
      const result = db.prepare(`UPDATE automation_missions SET attempts = attempts + 1, status = ?, run_at = ?, reason = ?
        WHERE id = ? AND status = 'queued' AND step_index = ? AND attempts = ? AND run_at = ?`).run(
        exhausted ? 'failed' : 'queued', retryTime(mission.attempts, now),
        exhausted ? 'Langkah gagal setelah beberapa percobaan.' : 'Menunggu percobaan ulang.', mission.id, mission.step_index, mission.attempts, mission.run_at,
      );
      if (result.changes) changed = true;
    }
  }
  if (changed) sseBus.emit('automation:update', {});
  return changed;
}

export function startAutomationWorker(): NodeJS.Timeout {
  return setInterval(() => {
    try {
      processAutomationTick();
    } catch {
      console.error('[automation] Local mission tick failed');
    }
  }, 2000).unref();
}
