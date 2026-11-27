import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { closeDb, initDatabase, todayWibIsoDate, wibOffsetIso } from '../db/connection.ts';
import {
  listAlarmsAndReminders,
  listCalendarEvents,
  moveCalendarEvent,
  processDueAlarmsTick,
  snoozeAlarm,
} from '../services/alarm-calendar.service.ts';
import { computeAutoScheduleForToday, evaluateTiltGuard, getRealDataKpis, saveDailyCheckIn } from '../services/lifeos.service.ts';
import { approveAuditAction, handleLlamreiPrompt, undoAuditAction } from '../services/llamrei-agent.service.ts';
import { getWibMarketSessions } from '../services/market.service.ts';
import { getMobileWidgetSnapshot, reconcileMobileMutations } from '../services/mobile-widget.service.ts';
import { ingestPhoneNotification } from '../services/nectarlink.service.ts';
import { parseTailscaleStatusJson } from '../services/network-tailscale.service.ts';
import {
  approveScheduledMessage,
  createScheduledMessageDraft,
  processDueScheduledMessagesTick,
} from '../services/scheduler.service.ts';
import { createTask, getWorkspaceSnapshot, startTaskTimer, stopTaskTimer, updateTask } from '../services/workspace.service.ts';

function setupIsolatedEnv() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'llamrei-test-'));
  process.env.LLAMREI_DISABLE_LIBSECRET = '1';
  process.env.LLAMREI_VAULT_DIR = tmpDir;
  initDatabase(':memory:');
  return () => {
    closeDb();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  };
}

test('ClickUp Task ↔ Website Calendar ↔ 2-Tier Alarm bi-directional sync & postpone tracking', async () => {
  const cleanup = setupIsolatedEnv();
  try {
    const startAt = wibOffsetIso(0, 16, 0);
    const dueAt = wibOffsetIso(0, 17, 0);
    const task = createTask({
      listId: 'list_bab4',
      goalId: 'goal_skripsi',
      title: 'Uji Regresi MRA Tahap 2',
      priority: 'urgent',
      startAt,
      dueAt,
      reminderOffsets: [15],
      hardAlarmEnabled: true,
    });

    const cal = listCalendarEvents().find((e) => e.linked_task_id === task.id);
    assert.ok(cal, 'Task should project onto Website Calendar');
    assert.equal(cal.has_hard_alarm, 1);

    const alarms = listAlarmsAndReminders().filter((a) => a.task_id === task.id);
    assert.ok(alarms.some((a) => a.kind === 'soft_reminder' && a.offset_minutes === 15), 'Soft reminder H-15m should exist');
    assert.ok(alarms.some((a) => a.kind === 'hard_alarm'), 'Hard alarm should exist');

    // Move task block on Website Calendar by +1 hour -> updates task & alarms
    const movedStart = wibOffsetIso(0, 18, 0);
    const movedEnd = wibOffsetIso(0, 19, 0);
    moveCalendarEvent(cal.id, movedStart, movedEnd);

    const ws = getWorkspaceSnapshot();
    const updatedTask = ws.tasks.find((t) => t.id === task.id);
    assert.equal(updatedTask?.start_at, movedStart);

    // Pushing due date forward increments postponed_count
    const pushedDue = wibOffsetIso(1, 17, 0);
    const postponed = updateTask(task.id, { dueAt: pushedDue });
    assert.equal(postponed?.postponed_count, 1);

    // Trigger due hard alarm and snooze
    const pastIso = new Date(Date.now() - 5000).toISOString();
    updateTask(task.id, { hardAlarmEnabled: true, hardAlarmAt: pastIso });
    const dueTriggered = await processDueAlarmsTick(new Date());
    assert.ok(dueTriggered.some((a) => a.task_id === task.id && a.kind === 'hard_alarm'));

    const snoozed = snoozeAlarm(`alm_hard_${task.id}`, 10, 'web');
    assert.equal(snoozed?.status, 'snoozed');
    assert.equal(snoozed?.snooze_count, 1);
  } finally {
    cleanup();
  }
});

test('Deep Work Time Tracker remains usable when the opted-in phone is offline', async () => {
  const cleanup = setupIsolatedEnv();
  try {
    const started = await startTaskTimer('task_bab4');
    assert.ok(started);
    const devAfterStart = await import('../services/nectarlink.service.ts').then((m) => m.getPhoneHubState().devices[0]);
    assert.equal(devAfterStart.auto_dnd_on_deepwork, 1);
    assert.equal(devAfterStart.online, 0);
    assert.equal(devAfterStart.dnd_enabled, 0);

    const stopped = await stopTaskTimer('task_bab4');
    assert.ok(stopped.durationSeconds >= 1);
    const devAfterStop = await import('../services/nectarlink.service.ts').then((m) => m.getPhoneHubState().devices[0]);
    assert.equal(devAfterStop.dnd_enabled, 0);
  } finally {
    cleanup();
  }
});

test('Mobile Home Screen Widget snapshot & idempotent offline delta reconciliation', () => {
  const cleanup = setupIsolatedEnv();
  try {
    const snapBefore = getMobileWidgetSnapshot();
    assert.ok(snapBefore.tasks.length > 0);

    const res1 = reconcileMobileMutations([
      {
        mutationId: 'mut_001',
        deviceId: 'dev_infinix_note30',
        actionType: 'task_toggle_done',
        targetId: 'task_cpi',
        payload: { done: true },
        clientTimestamp: new Date().toISOString(),
      },
      {
        mutationId: 'mut_002',
        deviceId: 'dev_infinix_note30',
        actionType: 'task_quick_create',
        targetId: 'new',
        payload: { title: 'Catat ide setup dari HP', hardAlarm: true },
        clientTimestamp: new Date().toISOString(),
      },
    ]);
    assert.equal(res1.applied, 2);
    assert.equal(res1.skippedDuplicate, 0);

    // Replaying identical mutationIds must be idempotent
    const res2 = reconcileMobileMutations([
      {
        mutationId: 'mut_001',
        deviceId: 'dev_infinix_note30',
        actionType: 'task_toggle_done',
        targetId: 'task_cpi',
        payload: { done: true },
        clientTimestamp: new Date().toISOString(),
      },
    ]);
    assert.equal(res2.applied, 0);
    assert.equal(res2.skippedDuplicate, 1);
  } finally {
    cleanup();
  }
});

test('Scheduled Messaging strictly enforces Approval Gate before auto-dispatch', async () => {
  const cleanup = setupIsolatedEnv();
  try {
    const pastIso = new Date(Date.now() - 10_000).toISOString();
    const draft = createScheduledMessageDraft({
      recipientName: 'Raka Pratama',
      recipientAddress: '6281200008821',
      channel: 'wa_me_manual',
      purpose: 'Test Gate',
      messageBody: 'Halo Raka, ini test approval gate',
      scheduledAt: pastIso,
    });
    assert.equal(draft.status, 'pending_approval');

    // Scheduler tick must NOT send pending_approval drafts
    const skipped = await processDueScheduledMessagesTick(new Date());
    assert.ok(!skipped.some((m) => m.id === draft.id), 'Pending message must never be dispatched before approval');

    // Approve now
    const approved = approveScheduledMessage(draft.id);
    assert.equal(approved?.status, 'approved');

    // Now due tick processes it
    const sent = await processDueScheduledMessagesTick(new Date());
    assert.ok(sent.some((m) => m.id === draft.id && (m.status === 'sent_auto' || m.status === 'reminded_fallback')));
  } finally {
    cleanup();
  }
});

test('Llamrei Agent command produces Approval Card, executes on Approve, and reverts on Undo', async () => {
  const cleanup = setupIsolatedEnv();
  try {
    const res = await handleLlamreiPrompt({
      prompt: 'Llamrei, buat tugas Finalisasi Lampiran Skripsi prioritas urgent jam 20:00',
    });
    assert.ok(res.assistantMessage.approval_card_json, 'Write command must generate an Approval Card');
    const card = JSON.parse(res.assistantMessage.approval_card_json!) as { auditId: string; status: string };
    assert.equal(card.status, 'pending_approval');

    const countBefore = getWorkspaceSnapshot().tasks.length;
    const approved = await approveAuditAction(card.auditId);
    assert.equal(approved?.status, 'approved_executed');
    assert.equal(getWorkspaceSnapshot().tasks.length, countBefore + 1);

    const undone = undoAuditAction(card.auditId);
    assert.equal(undone?.status, 'undone');
    assert.equal(getWorkspaceSnapshot().tasks.length, countBefore);
  } finally {
    cleanup();
  }
});

test('Life OS Tilt Guard, Auto-Scheduler conflict avoidance, Market WIB & Tailscale JSON parser', () => {
  const cleanup = setupIsolatedEnv();
  try {
    const tilt = evaluateTiltGuard({
      sleepHours: 4.5,
      energyLevel: 2,
      mentalState: 'tilted',
      hasHighImpactNewsToday: true,
    });
    assert.equal(tilt.risk, 'high');

    const saved = saveDailyCheckIn({ sleepHours: 5.0, energyLevel: 2, mentalState: 'rushed' });
    assert.equal(saved.date_wib, todayWibIsoDate());
    assert.equal(saved.tilt_risk_level, 'high');

    const kpis = getRealDataKpis();
    assert.ok(kpis.totalTasks >= 1);

    const schedule = computeAutoScheduleForToday(false);
    assert.ok(schedule.proposals.length >= 1);
    for (const p of schedule.proposals) {
      const s = Date.parse(p.blockStart);
      const e = Date.parse(p.blockEnd);
      for (const b of schedule.blockedWindows) {
        assert.ok(!(s < b.endMs && e > b.startMs), `Scheduled block "${p.title}" overlapped blocked window "${b.label}"`);
      }
    }

    const sessions = getWibMarketSessions(new Date('2026-11-19T08:30:00+07:00'));
    assert.equal(sessions.sessions.length, 4);

    const notif = ingestPhoneNotification({
      appPackage: 'com.whatsapp',
      appName: 'WhatsApp',
      senderOrTitle: 'Dosen',
      conversationGroup: 'Skripsi',
      bodyText: '@Arthur tolong kirim revisi Bab 4 jam 16:00, kode 123456',
    });
    assert.equal(notif.is_mention_tag, 1);
    assert.equal(notif.ai_intent, 'task_request');

    const ts = parseTailscaleStatusJson(
      JSON.stringify({
        BackendState: 'Running',
        Self: { DNSName: 'arthur-laptop.tail123.ts.net.', TailscaleIPs: ['100.64.0.10', 'fd7a::1'] },
        Peer: {
          p1: { ID: 'p1', HostName: 'infinix-note30', DNSName: 'infinix-note30.tail123.ts.net.', TailscaleIPs: ['100.64.0.22'], OS: 'android', Online: true },
        },
      }),
    );
    assert.equal(ts.running, true);
    assert.equal(ts.selfIp, '100.64.0.10');
    assert.equal(ts.peers[0].tailscaleIp, '100.64.0.22');
  } finally {
    cleanup();
  }
});
