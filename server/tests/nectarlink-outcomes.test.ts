import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { closeDb, initDatabase } from '../db/connection.ts';
import {
  connectNectarLinkViaTailscale,
  getPhoneHubState,
  pushPhoneNotification,
  replyPhoneNotification,
  ringPhone,
  sendClipboardToPhone,
  sendToPhone,
  setPhoneControlToggle,
  startScreenMirror,
  triggerCameraCapture,
} from '../services/nectarlink.service.ts';

function isolatedBridge(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'llamrei-bridge-'));
  const tokenPath = join(dir, 'api-token.json');
  const old = {
    NECTARLINK_API_TOKEN_PATH: process.env.NECTARLINK_API_TOKEN_PATH,
    PATH: process.env.PATH,
    XDG_DATA_HOME: process.env.XDG_DATA_HOME,
  };
  process.env.NECTARLINK_API_TOKEN_PATH = tokenPath;
  process.env.PATH = dir;
  process.env.XDG_DATA_HOME = dir;
  const db = initDatabase(':memory:');
  t.after(() => {
    closeDb();
    for (const [key, value] of Object.entries(old)) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(dir, { recursive: true, force: true });
  });
  return { db, dir, tokenPath };
}

test('NectarLink commands distinguish daemon acceptance, rejection, offline and unknown device outcomes', async (t) => {
  const { db, tokenPath } = isolatedBridge(t);
  const beforeTimeline = getPhoneHubState().timeline.length;
  const fixture = db.prepare('SELECT attachments_json FROM tasks WHERE id = ?');
  const beforeAttachments = fixture.get('task_bab4');

  let httpStatus = 200;
  let payload = { ok: true };
  let timeout = false;
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => {
    if (timeout) throw new DOMException('fixture timeout', 'TimeoutError');
    return Response.json(payload, { status: httpStatus });
  });
  assert.equal((await ringPhone()).status, 'offline');
  assert.equal(fetchMock.mock.callCount(), 0);
  assert.equal(getPhoneHubState().timeline.length, beforeTimeline);

  writeFileSync(tokenPath, JSON.stringify({ port: 53320, token: 'fixture-nectarlink-token' }));
  const ring = await ringPhone();
  const clipboard = await sendClipboardToPhone('private mock clipboard');
  const share = await sendToPhone({ url: 'https://example.invalid/private-fixture' });
  const push = await pushPhoneNotification({ title: 'Fixture', body: 'Fixture notice' });
  for (const result of [ring, clipboard, share, push]) {
    assert.equal(result.status, 'accepted');
    assert.equal(result.ok, false);
  }
  const timeline = getPhoneHubState().timeline;
  assert.equal(timeline.length, beforeTimeline + 3);
  assert.doesNotMatch(JSON.stringify(timeline), /private mock clipboard|private-fixture/);

  const camera = await triggerCameraCapture({ mode: 'scan', linkedTaskId: 'task_bab4' });
  assert.equal(camera.status, 'accepted');
  assert.equal(camera.ok, false);
  assert.equal(camera.artifactLabel, null);
  assert.deepEqual(fixture.get('task_bab4'), beforeAttachments);
  assert.equal(getPhoneHubState().timeline.length, timeline.length);

  payload = { ok: false };
  assert.equal((await ringPhone()).status, 'failed');
  httpStatus = 502;
  assert.equal((await ringPhone()).status, 'unknown');
  timeout = true;
  assert.equal((await ringPhone()).status, 'unknown');
  assert.equal(getPhoneHubState().timeline.length, timeline.length);
});

test('NectarLink CLI acceptance does not modify device telemetry or claim reply delivery', async (t) => {
  const { dir } = isolatedBridge(t);
  const previous = getPhoneHubState();
  const device = previous.devices[0];
  const notification = previous.notifications.find((candidate) => candidate.can_reply === 1 && !candidate.replied_at)!;

  const offlineReply = await replyPhoneNotification(notification.id, 'Fixture reply');
  assert.equal(offlineReply.status, 'offline');
  assert.equal(offlineReply.ok, false);

  writeFileSync(join(dir, 'nectarlink'), '#!/bin/sh\nexit 0\n', { mode: 0o700 });
  const reply = await replyPhoneNotification(notification.id, 'Fixture reply');
  assert.equal(reply.status, 'accepted');
  assert.equal(reply.ok, false);
  assert.deepEqual(reply.notification, notification);
  assert.deepEqual(getPhoneHubState().notifications, previous.notifications);

  const toggle = await setPhoneControlToggle(device.id, 'dnd_enabled', true);
  assert.equal(toggle.status, 'accepted');
  assert.equal(toggle.ok, false);
  assert.equal(toggle.device?.dnd_enabled, device.dnd_enabled);

  const preference = await setPhoneControlToggle(device.id, 'auto_dnd_on_deepwork', false);
  assert.equal(preference.status, 'saved');
  assert.equal(preference.ok, true);
  assert.equal(preference.device?.auto_dnd_on_deepwork, 0);

  const connection = await connectNectarLinkViaTailscale(device.id, '100.64.0.10');
  assert.equal(connection.status, 'accepted');
  assert.equal(connection.ok, false);
  const updated = getPhoneHubState().devices[0];
  assert.equal(updated.tailscale_ip, '100.64.0.10');
  assert.equal(updated.active_transport, device.active_transport);
  assert.equal(updated.online, device.online);

  const mirror = await startScreenMirror(device.id);
  assert.equal(mirror.status, 'accepted');
  assert.equal(mirror.ok, false);
  assert.deepEqual(getPhoneHubState().timeline, previous.timeline);
});
