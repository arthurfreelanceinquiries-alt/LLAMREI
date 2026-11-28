import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { AutomationDefinition, MissionDetail } from '../../shared/automation.ts';
import { approveMissionStep, cancelMission, getAutomationSnapshot, getMission, processAutomationTick, runSavedRule } from '../automation/missions.ts';
import { previewAutomation, saveAutomationRule } from '../automation/rules.ts';
import { closeDb, getDb, initDatabase } from '../db/connection.ts';
import { createList, createSpace, createTask, updateTask } from '../services/workspace.service.ts';

const daytime = new Date('2031-02-08T06:04:00Z');
const shifted = (base: Date, ms: number) => new Date(base.getTime() + ms);
const definition: AutomationDefinition = {
  name: 'Tinjauan tugas fixture', trigger: { kind: 'manual' },
  steps: [{ kind: 'record', note: 'Ringkasan fixture' }], maxMinutes: 60, quietHours: null,
};

function newList(): string {
  const space = createSpace('Workspace fixture', '#818cf8');
  return createList(space.id, 'Daftar fixture').id;
}

function count(table: 'automation_missions' | 'automation_events' | 'scheduled_messages'): number {
  return (getDb().prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count;
}

function approvalFor(mission: MissionDetail) {
  assert.ok(mission.approval);
  return { stepIndex: mission.stepIndex, approvalId: mission.approval.id };
}

test('dry runs validate bounded local steps, show quiet hours and never create events or executions', (t) => {
  initDatabase(':memory:');
  t.after(closeDb);
  const before = count('scheduled_messages');
  const quiet = new Date('2031-02-08T16:04:00Z');
  const preview = previewAutomation({ ...definition, quietHours: { start: '22:00', end: '06:00' } }, quiet);
  assert.equal(preview.earliestAt, '2031-02-08T23:00:00.000Z');
  assert.equal(preview.deadlineAt, '2031-02-08T17:04:00.000Z');
  assert.equal(preview.costUsd, 0);
  for (const invalid of [
    { maxMinutes: 1441 }, { quietHours: { start: '22:00', end: '22:00' } },
    { trigger: { kind: 'task_completed', listId: 'unknown' } }, { steps: Array(7).fill(definition.steps[0]) },
    { steps: [{ kind: 'send_message', body: 'fixture' }] },
  ]) {
    assert.throws(() => previewAutomation({ ...definition, ...invalid }, quiet), { status: 400 });
  }
  assert.deepEqual(getAutomationSnapshot(), { rules: [], missions: [], events: [] });
  assert.equal(count('scheduled_messages'), before);
});

test('a frozen mission resumes through restart and exact approval, executing its local task once', (t) => {
  const temp = mkdtempSync(join(tmpdir(), 'llamrei-mission-'));
  const database = join(temp, 'test.sqlite');
  initDatabase(database);
  t.after(() => {
    closeDb();
    rmSync(temp, { recursive: true, force: true });
  });
  const listId = newList();
  const baselineScheduled = count('scheduled_messages');
  const rule = saveAutomationRule({ ...definition, steps: [
    definition.steps[0], { kind: 'create_task', listId, title: 'Tugas disetujui' },
  ] });
  const request = { revision: rule.revision, requestId: crypto.randomUUID() };
  const { id } = runSavedRule(rule.id, request, daytime);
  assert.equal(runSavedRule(rule.id, request, daytime).id, id);
  processAutomationTick(daytime);
  assert.equal(getMission(id).stepIndex, 1);
  closeDb();
  initDatabase(database);
  processAutomationTick(daytime);
  const waiting = getMission(id);
  assert.equal(waiting.status, 'waiting_approval');
  const approval = approvalFor(waiting);
  assert.throws(() => approveMissionStep(id, { ...approval, approvalId: crypto.randomUUID() }, daytime), { status: 409 });
  assert.throws(() => approveMissionStep(id, { ...approval, stepIndex: 0 }, daytime), { status: 409 });
  const edited = saveAutomationRule({ ...rule, steps: [{ kind: 'create_task', listId, title: 'Tugas berubah' }] }, rule.id);
  assert.throws(() => runSavedRule(rule.id, { ...request, revision: edited.revision }, daytime), { status: 409 });
  assert.equal(runSavedRule(rule.id, request, daytime).id, id);
  closeDb();
  initDatabase(database);
  assert.equal(getMission(id).approval?.id, approval.approvalId);
  assert.equal(approveMissionStep(id, approval, daytime).status, 'queued');
  assert.throws(() => approveMissionStep(id, approval, daytime), { status: 409 });
  closeDb();
  initDatabase(database);
  processAutomationTick(daytime);
  processAutomationTick(daytime);
  const complete = getMission(id);
  assert.equal(complete.status, 'completed');
  const tasks = getDb().prepare('SELECT id, title FROM tasks WHERE list_id = ?').all(listId);
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].title, 'Tugas disetujui');
  assert.equal(tasks[0].id, complete.checkpoints[1].taskId);
  assert.equal(count('scheduled_messages'), baselineScheduled);
});

test('completion events join the source transaction and pending events respect rule revision', (t) => {
  const db = initDatabase(':memory:');
  t.after(closeDb);
  const listId = newList();
  const task = createTask({ listId, title: 'Sumber fixture' });
  const rule = saveAutomationRule({ ...definition, trigger: { kind: 'task_completed', listId }, enabled: true });
  db.exec('BEGIN IMMEDIATE');
  db.prepare("UPDATE tasks SET status = 'Done' WHERE id = ?").run(task.id);
  assert.equal(count('automation_events'), 1);
  db.exec('ROLLBACK');
  assert.equal(count('automation_events'), 0);
  updateTask(task.id, { status: 'Done' });
  updateTask(task.id, { status: 'Done' });
  assert.equal(count('automation_events'), 1);
  saveAutomationRule({ ...rule, enabled: false }, rule.id);
  processAutomationTick();
  assert.equal(getAutomationSnapshot().events[0].status, 'skipped');
  assert.equal(count('automation_missions'), 0);
  saveAutomationRule({ ...rule, revision: 2 }, rule.id);
  updateTask(task.id, { status: 'To Do' });
  updateTask(task.id, { status: 'Done' });
  processAutomationTick();
  processAutomationTick();
  const { events, missions } = getAutomationSnapshot();
  assert.equal(events[0].status, 'handled');
  assert.equal(missions.length, 1);
  assert.equal(missions[0].id, events[0].missionId);
  assert.equal(missions[0].status, 'completed');
  assert.equal(getMission(missions[0].id).sourceTaskId, task.id);
});

test('quiet hours defer work, deadlines and expired approvals cannot execute, and cancellation wins before claim', (t) => {
  initDatabase(':memory:');
  t.after(closeDb);
  const listId = newList();
  const quiet = new Date('2031-02-08T16:04:00Z');
  const rule = saveAutomationRule({ ...definition, maxMinutes: 1440, quietHours: { start: '22:00', end: '06:00' },
    steps: [{ kind: 'create_task', listId, title: 'Tugas fixture hening' }] });
  const start = (at: Date, revision = rule.revision) => runSavedRule(rule.id, { revision, requestId: crypto.randomUUID() }, at);
  const deferred = start(quiet);
  processAutomationTick(quiet);
  assert.equal(getMission(deferred.id).status, 'queued');
  assert.equal(getMission(deferred.id).runAt, '2031-02-08T23:00:00.000Z');
  const resumed = new Date(deferred.runAt);
  processAutomationTick(resumed);
  const waiting = getMission(deferred.id);
  const late = shifted(resumed, 15 * 60_000);
  assert.throws(() => approveMissionStep(waiting.id, approvalFor(waiting), late), { status: 409 });
  processAutomationTick(late);
  assert.equal(getMission(waiting.id).status, 'expired');

  const cancelled = start(daytime);
  processAutomationTick(daytime);
  approveMissionStep(cancelled.id, approvalFor(getMission(cancelled.id)), daytime);
  assert.equal(cancelMission(cancelled.id).status, 'cancelled');
  processAutomationTick(daytime);
  const short = saveAutomationRule({ ...rule, maxMinutes: 1 }, rule.id);
  const expired = start(daytime, short.revision);
  processAutomationTick(shifted(daytime, 60_000));
  assert.equal(getMission(expired.id).status, 'expired');
  assert.equal(getDb().prepare('SELECT 1 FROM tasks WHERE list_id = ?').get(listId), undefined);
});

test('failed local transaction retries safely and stops after three failed attempts', (t) => {
  const db = initDatabase(':memory:');
  t.after(closeDb);
  const listId = newList();
  const rule = saveAutomationRule({ ...definition, steps: [{ kind: 'create_task', listId, title: 'Dapat diulang' }] });
  const start = () => {
    const { id } = runSavedRule(rule.id, { revision: rule.revision, requestId: crypto.randomUUID() }, daytime);
    processAutomationTick(daytime);
    approveMissionStep(id, approvalFor(getMission(id)), daytime);
    return id;
  };
  const forceRollback = () => db.exec(`CREATE TRIGGER fixture_rollback BEFORE UPDATE OF finished_at ON automation_checkpoints
    BEGIN SELECT RAISE(ABORT, 'fixture failure'); END;`);
  const taskCount = () => db.prepare('SELECT id FROM tasks WHERE list_id = ?').all(listId).length;
  const recoverable = start();
  forceRollback();
  processAutomationTick(daytime);
  assert.equal(taskCount(), 0);
  assert.equal(getMission(recoverable).status, 'queued');
  db.exec('DROP TRIGGER fixture_rollback');
  processAutomationTick(shifted(daytime, 999));
  assert.equal(taskCount(), 0);
  processAutomationTick(shifted(daytime, 1000));
  assert.equal(taskCount(), 1);
  assert.equal(getMission(recoverable).status, 'completed');

  const permanent = start();
  forceRollback();
  for (const elapsed of [0, 1000, 3000, 7000]) processAutomationTick(shifted(daytime, elapsed));
  assert.equal(taskCount(), 1);
  assert.equal(getMission(permanent).status, 'failed');
  const failure = db.prepare('SELECT attempts FROM automation_missions WHERE id = ?').get(permanent);
  assert.equal(failure?.attempts, 3);
});
