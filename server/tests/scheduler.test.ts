import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { closeDb, getDb, initDatabase } from '../db/connection.ts';
import {
  approveScheduledMessage,
  createScheduledMessageDraft,
  listScheduledMessages,
  processDueScheduledMessagesTick,
  updateScheduledMessageStatus,
} from '../services/scheduler.service.ts';

const dueTime = new Date('2025-01-01T00:00:00Z');
const gateway = 'https://gateway.example.invalid/send';

function createDraft(offsetMs = 0) {
  return createScheduledMessageDraft({
    recipientName: 'Fixture recipient',
    recipientAddress: '12025550123',
    channel: 'wa_gateway',
    purpose: 'Synthetic fixture',
    messageBody: 'Synthetic message',
    scheduledAt: new Date(dueTime.getTime() + offsetMs).toISOString(),
  });
}

test('scheduler claims atomically, skips overlapping ticks and respects concurrent cancellation', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'llamrei-scheduler-test-'));
  const filename = join(dir, 'scheduler.db');
  const savedWebhook = process.env.WA_GATEWAY_WEBHOOK_URL;
  process.env.WA_GATEWAY_WEBHOOK_URL = gateway;
  initDatabase(filename);
  const otherDb = new DatabaseSync(filename);
  t.after(() => {
    closeDb();
    otherDb.close();
    rmSync(dir, { recursive: true, force: true });
    if (savedWebhook === undefined) delete process.env.WA_GATEWAY_WEBHOOK_URL;
    else process.env.WA_GATEWAY_WEBHOOK_URL = savedWebhook;
  });

  const first = createDraft(-2000);
  const second = createDraft(-1000);
  const pending = createDraft();
  assert.ok(approveScheduledMessage(first.id));
  assert.ok(approveScheduledMessage(second.id));
  assert.equal(approveScheduledMessage(pending.id, { scheduledAt: 'bad timestamp' }), null);

  let finishDispatch!: (result: Response) => void;
  const dispatchResponse = new Promise<Response>((resolve) => { finishDispatch = resolve; });
  const fetchMock = t.mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => {
    assert.equal(url, gateway);
    const claim = otherDb.prepare('SELECT status, gateway_response_json FROM scheduled_messages WHERE id = ?').get(first.id);
    assert.equal(claim?.status, 'sending');
    assert.equal(
      new Headers(options.headers).get('Idempotency-Key'),
      JSON.parse(String(claim?.gateway_response_json)).attemptId,
    );
    otherDb.prepare("UPDATE scheduled_messages SET status = 'cancelled' WHERE id = ?").run(second.id);
    return dispatchResponse;
  });

  const running = processDueScheduledMessagesTick(dueTime);
  assert.deepEqual(await processDueScheduledMessagesTick(dueTime), []);
  assert.equal(approveScheduledMessage(first.id), null);
  assert.equal(updateScheduledMessageStatus(first.id, 'cancelled'), null);
  assert.equal(updateScheduledMessageStatus(first.id, 'pending_approval'), null);
  finishDispatch(Response.json({ delivered: true }));

  const processed = await running;
  assert.equal(fetchMock.mock.callCount(), 1);
  assert.deepEqual(processed.map((message) => [message.id, message.status]), [[first.id, 'sent_auto']]);
  assert.ok(processed[0].sent_at);
  assert.equal(approveScheduledMessage(first.id), null);
  assert.equal(updateScheduledMessageStatus(first.id, 'pending_approval'), null);
  assert.equal(listScheduledMessages().find((message) => message.id === pending.id)?.status, 'pending_approval');
  assert.deepEqual(await processDueScheduledMessagesTick(dueTime), []);
});

test('scheduler preserves ambiguous outcomes without retrying a transport failure or an interrupted claim', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'llamrei-scheduler-test-'));
  const filename = join(dir, 'scheduler.db');
  const savedWebhook = process.env.WA_GATEWAY_WEBHOOK_URL;
  process.env.WA_GATEWAY_WEBHOOK_URL = gateway;
  initDatabase(filename);
  t.after(() => {
    closeDb();
    rmSync(dir, { recursive: true, force: true });
    if (savedWebhook === undefined) delete process.env.WA_GATEWAY_WEBHOOK_URL;
    else process.env.WA_GATEWAY_WEBHOOK_URL = savedWebhook;
  });

  const timeout = createDraft(-2000);
  const acceptedWithoutReceipt = createDraft(-1000);
  const interrupted = createDraft();
  const fresh = createDraft();
  assert.ok(approveScheduledMessage(timeout.id));
  assert.ok(approveScheduledMessage(acceptedWithoutReceipt.id));
  const recordClaim = getDb().prepare("UPDATE scheduled_messages SET status = 'sending', gateway_response_json = ? WHERE id = ?");
  recordClaim.run(JSON.stringify({ attemptId: 'interrupted', claimedAt: '2025-01-01T00:00:00Z' }), interrupted.id);
  recordClaim.run(JSON.stringify({ attemptId: 'fresh', claimedAt: new Date().toISOString() }), fresh.id);
  closeDb();
  initDatabase(filename);

  let attempt = 0;
  const fetchMock = t.mock.method(globalThis, 'fetch', async (url: string) => {
    assert.equal(url, gateway);
    if (attempt++ === 0) throw new DOMException('Synthetic timeout', 'TimeoutError');
    return new Response(null, { status: 202 });
  });

  const processed = await processDueScheduledMessagesTick(dueTime);
  assert.equal(fetchMock.mock.callCount(), 2);
  assert.deepEqual(processed.map((message) => message.id), [timeout.id, acceptedWithoutReceipt.id]);
  const messages = listScheduledMessages();
  for (const id of [timeout.id, acceptedWithoutReceipt.id, interrupted.id]) {
    const row = messages.find((message) => message.id === id);
    assert.equal(row?.status, 'failed');
    assert.equal(row.sent_at, null);
    assert.equal(JSON.parse(row.gateway_response_json!).outcome, 'unknown');
    assert.equal(approveScheduledMessage(id), null);
    assert.equal(updateScheduledMessageStatus(id, 'pending_approval'), null);
  }
  const recovered = messages.find((message) => message.id === interrupted.id)!;
  assert.equal(JSON.parse(recovered.gateway_response_json!).attemptId, 'interrupted');
  assert.equal(messages.find((message) => message.id === fresh.id)?.status, 'sending');
  assert.deepEqual(await processDueScheduledMessagesTick(dueTime), []);
  assert.equal(fetchMock.mock.callCount(), 2);
});
