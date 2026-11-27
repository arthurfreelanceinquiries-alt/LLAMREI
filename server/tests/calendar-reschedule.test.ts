import assert from 'node:assert/strict';
import test from 'node:test';
import { closeDb, initDatabase } from '../db/connection.ts';
import {
  createOrUpdateHardAlarm,
  createStandaloneCalendarEvent,
  dismissAlarm,
  listAlarmsAndReminders,
  moveCalendarEvent,
  processDueAlarmsTick,
  snoozeAlarm,
  toggleAlarmEnabled,
} from '../services/alarm-calendar.service.ts';
import { computeAutoScheduleForToday } from '../services/lifeos.service.ts';
import { createTask, getWorkspaceSnapshot, updateTask } from '../services/workspace.service.ts';

test('rescheduling moves a local event with its duration and linked alarm', (t) => {
  initDatabase(':memory:');
  t.after(closeDb);
  const event = createStandaloneCalendarEvent({
    title: 'Agenda uji', startAt: '2030-01-15T10:00:00+07:00', endAt: '2030-01-15T11:00:00+07:00',
    withHardAlarm: true, ringPhone: false,
  });
  const alarm = () => listAlarmsAndReminders().find(({ calendar_event_id }) => calendar_event_id === event.id);
  snoozeAlarm(alarm()!.id, 5);
  const moved = moveCalendarEvent(event.id, '2030-01-16T13:00:00+07:00');
  assert.equal(moved?.end_at, '2030-01-16T07:00:00.000Z');
  assert.equal(alarm()?.trigger_at, '2030-01-16T13:00:00+07:00');
  assert.equal(alarm()?.status, 'armed');
  assert.equal(alarm()?.snoozed_until, null);

  toggleAlarmEnabled(alarm()!.id, false);
  const movedAgain = moveCalendarEvent(event.id, '2030-01-17T13:00:00+07:00');
  assert.equal(movedAgain?.has_hard_alarm, 0);
  assert.equal(alarm()?.status, 'dismissed');
  assert.equal(alarm()?.enabled, 0);
});

test('moving a task block shifts its reminder and preserves independently scheduled deadlines', (t) => {
  initDatabase(':memory:');
  t.after(closeDb);
  const task = createTask({
    listId: 'list_bab4', title: 'Tugas uji', startAt: '2030-01-15T10:00:00+07:00',
    dueAt: '2030-01-15T11:00:00+07:00', hardAlarmEnabled: true, reminderOffsets: [15],
  });
  const eventId = `cal_task_${task.id}`;
  const hardId = `alm_hard_${task.id}`;
  const alarms = () => listAlarmsAndReminders().filter(({ task_id }) => task_id === task.id);
  const currentTask = () => getWorkspaceSnapshot().tasks.find(({ id }) => id === task.id);

  const reminderId = alarms().find(({ kind }) => kind === 'soft_reminder')!.id;
  dismissAlarm(reminderId);
  snoozeAlarm(hardId, 5);
  updateTask(task.id, { title: 'Judul uji setelah diedit' });
  assert.equal(alarms().find(({ id }) => id === reminderId)?.status, 'dismissed');
  assert.equal(alarms().find(({ id }) => id === hardId)?.status, 'snoozed');

  moveCalendarEvent(eventId, '2030-01-15T12:00:00+07:00');
  assert.equal(currentTask()?.due_at, '2030-01-15T06:00:00.000Z');
  assert.equal(alarms().find(({ id }) => id === reminderId)?.trigger_at, '2030-01-15T04:45:00.000Z');
  assert.equal(alarms().find(({ id }) => id === hardId)?.snoozed_until, null);

  updateTask(task.id, {
    autoScheduledBlockStart: '2030-01-16T10:00:00+07:00',
    autoScheduledBlockEnd: '2030-01-16T10:30:00+07:00',
  });
  const deadline = currentTask()?.due_at;
  const moved = moveCalendarEvent(eventId, '2030-01-16T11:00:00+07:00');
  assert.equal(moved?.end_at, '2030-01-16T04:30:00.000Z');
  assert.equal(currentTask()?.due_at, deadline);
});

test('the same alarm is claimed once across overlapping ticks and timezone offsets', async (t) => {
  const db = initDatabase(':memory:');
  t.after(closeDb);
  db.exec('UPDATE task_alarms_reminders SET enabled = 0');
  const event = createStandaloneCalendarEvent({
    title: 'Alarm uji', startAt: '2030-01-15T10:00:00+07:00', withHardAlarm: true, ringPhone: false,
  });
  const now = new Date('2030-01-15T03:00:01Z');
  const [first, second] = await Promise.all([processDueAlarmsTick(now), processDueAlarmsTick(now)]);
  assert.deepEqual([...first, ...second].map(({ calendar_event_id }) => calendar_event_id), [event.id]);
});


test('schedule preview blocks UTC events that continue into the next WIB calendar day', (t) => {
  initDatabase(':memory:');
  t.after(closeDb);
  createStandaloneCalendarEvent({
    title: 'Rapat lintas hari',
    startAt: '2030-01-14T16:30:00.000Z',
    endAt: '2030-01-15T03:30:00.000Z',
  });
  const plan = computeAutoScheduleForToday(false, new Date('2030-01-15T08:00:00+07:00'));
  assert.ok(plan.blockedWindows.some(({ label }) => label === 'Rapat lintas hari'));
  assert.ok(plan.proposals[0]);
  assert.ok(Date.parse(plan.proposals[0].blockStart) >= Date.parse('2030-01-15T10:30:00+07:00'));
  const late = computeAutoScheduleForToday(false, new Date('2030-01-15T23:00:00+07:00'));
  assert.equal(late.proposals.length, 0);
});


test('a manually named alarm can be attached to a task without a deadline', (t) => {
  initDatabase(':memory:');
  t.after(closeDb);
  const task = createTask({ listId: 'list_bab4', title: 'Tugas tanpa tenggat' });
  const alarm = createOrUpdateHardAlarm({
    taskId: task.id, title: 'Bunyi khusus', triggerAt: '2030-01-15T10:00:00+07:00', ringPhone: false,
  });
  assert.ok(alarm.calendar_event_id);
  assert.equal(alarm.title, 'Bunyi khusus');
  assert.equal(alarm.ring_phone_nectarlink, 0);

  updateTask(task.id, { title: 'Tugas sudah diganti' });
  assert.equal(listAlarmsAndReminders().find(({ id }) => id === alarm.id)?.title, 'Bunyi khusus');
});
