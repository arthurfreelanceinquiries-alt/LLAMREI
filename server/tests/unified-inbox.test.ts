import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { closeDb, getDb, initDatabase } from '../db/connection.ts';
import { gmailSyncStatus, syncInboxGmail } from '../inbox/gmail.ts';
import { createInboxDraft, getInboxThread, listInboxThreads, updateInboxThread } from '../inbox/store.ts';
import { executeComposioTool, getActiveComposioTarget, getActiveComposioToolsForAgent, setEnabledComposioToolkits, syncComposioConnections } from '../services/composio.service.ts';
import { createContact } from '../services/scheduler.service.ts';

const all = () => listInboxThreads({ query: '', unread: false, followUp: false });

function setup(t: TestContext) {
  initDatabase(':memory:');
  t.after(closeDb);
}

function fixtureKey(t: TestContext) {
  const old = process.env.COMPOSIO_API_KEY;
  process.env.COMPOSIO_API_KEY = 'inbox-fixture';
  t.after(() => { if (old === undefined) delete process.env.COMPOSIO_API_KEY; else process.env.COMPOSIO_API_KEY = old; });
}

function addAccount(toolkit: string, account: string) {
  getDb().prepare(`INSERT INTO composio_connections (id, toolkit_slug, toolkit_name, connected_account_id, status)
    VALUES (?, ?, ?, ?, 'active')`).run(`test_${toolkit}`, toolkit, toolkit, account);
}

test('inbox reads recorded sources, filters OTP, and preserves a new message when local read status races', (t) => {
  setup(t);
  const db = getDb();
  db.exec(`DELETE FROM phone_notifications; DELETE FROM wa_tag_mentions;
    INSERT INTO wa_chat_threads (chat_jid,name,unread_count) VALUES ('fixture@conference','Synthetic chat',1);
    INSERT INTO wa_chat_messages (id,chat_jid,sender_name,text,timestamp,created_at)
    VALUES ('message-a','fixture@conference','Fixture sender','First recorded message','16.20','2030-01-03 10:00:00');
    INSERT INTO phone_notifications (id,app_package,app_name,sender_or_title,body_text,otp_code,received_at)
    VALUES ('ok','org.telegram.messenger','Telegram','Synthetic Telegram','Message receipt',NULL,'2030-01-02 10:00:00'),
      ('otp','org.telegram.messenger','Telegram','Hidden code','Private authentication code','12345','2030-01-01 10:00:00');`);
  const threads = all();
  assert.deepEqual(threads.map(({ source }) => source), ['whatsapp', 'telegram_device']);
  const [thread] = threads;
  assert.equal(thread.updatedAt, '2030-01-03T10:00:00.000Z');
  assert.equal(getInboxThread(thread.id).messages[0].text, 'First recorded message');
  db.exec(`INSERT INTO wa_chat_messages (id,chat_jid,sender_name,text,timestamp,created_at)
    VALUES ('message-b','fixture@conference','Fixture sender','Second recorded message','16.40','2030-01-03 10:20:00')`);
  assert.throws(() => updateInboxThread(thread.id, { revision: 0, markRead: true, seenMessageId: 'message-a' }), { status: 409 });
  const detail = updateInboxThread(thread.id, { revision: 0, markRead: true, seenMessageId: 'message-b' });
  assert.equal(detail.thread.unread, false);
  assert.throws(() => updateInboxThread(thread.id, { revision: 0, note: 'Stale edit' }), { status: 409 });
});

test('contact follow-ups create exactly one approval-queued draft and receipts distinguish actual outcomes', (t) => {
  setup(t);
  const db = getDb();
  db.exec(`DELETE FROM phone_notifications; DELETE FROM wa_tag_mentions;
    INSERT INTO wa_chat_threads (chat_jid,name,unread_count) VALUES ('fixture@conference','Synthetic chat',0);
    INSERT INTO wa_chat_messages (id,chat_jid,sender_name,text,timestamp)
    VALUES ('message-a','fixture@conference','Fixture sender','Synthetic history','2030-01-03T10:00:00Z');`);
  const contact = createContact({ name: 'Fixture contact', phoneE164: '620000000001', preferredChannel: 'wa_me_manual' });
  const [item] = all();
  const scheduledAt = new Date(Date.now() + 3_600_000).toISOString();
  const payload = { revision: 1, body: 'Hello from a local fixture', scheduledAt, requestId: crypto.randomUUID() };
  assert.throws(() => createInboxDraft(item.id, payload), { status: 409 });
  const detail = updateInboxThread(item.id, { revision: 0, contactId: contact.id, followUpAt: scheduledAt, note: 'Review handoff' });
  assert.equal(detail.thread.followUpAt, scheduledAt);
  const sent = createInboxDraft(item.id, payload);
  assert.equal(sent.status, 'pending_approval');
  assert.equal(createInboxDraft(item.id, payload).id, sent.id);
  assert.throws(() => createInboxDraft(item.id, { ...payload, body: 'Changed' }), { status: 409 });
  assert.equal(getInboxThread(item.id).receipts[0].state, 'pending');
  db.prepare(`UPDATE scheduled_messages SET status = 'failed', gateway_response_json = '{"outcome":"unknown"}' WHERE id = ?`).run(sent.id);
  assert.equal(getInboxThread(item.id).receipts[0].state, 'unknown');
  db.prepare(`UPDATE scheduled_messages SET status = 'sent_auto', gateway_response_json = '{"outcome":"sent"}', sent_at = datetime('now') WHERE id = ?`).run(sent.id);
  assert.equal(getInboxThread(item.id).receipts[0].state, 'sent');
});

test('Gmail sync binds a reviewed read, deduplicates messages and separates caches by account', async (t) => {
  setup(t);
  fixtureKey(t);
  addAccount('gmail', 'fixture-account-1');
  setEnabledComposioToolkits(['gmail']);
  let malformed = false;
  let readCount = 0;
  let expectedAccount = 'fixture-account-1';
  const fetchImpl: typeof fetch = async (url, init) => {
    assert.equal(init?.redirect, 'error');
    if (String(url).includes('/tools?')) return Response.json({ items: [{ slug: 'GMAIL_FETCH_EMAILS',
      input_parameters: { type: 'object', properties: { max_results: { type: 'integer', maximum: 25 } }, required: ['max_results'] },
    }] });
    assert.ok(String(url).endsWith('/tools/execute/GMAIL_FETCH_EMAILS'));
    const body = JSON.parse(String(init?.body));
    assert.equal(body.connected_account_id, expectedAccount);
    assert.deepEqual(body.arguments, { max_results: 20 });
    readCount++;
    const message = { id: 'gm_example', threadId: 'gm_shared_thread', from: 'sender@example.invalid', subject: 'Fixture inbox', snippet: 'Cached message', internalDate: '1900000000000', labelIds: ['UNREAD'] };
    return Response.json({ successful: true, data: malformed ? { missing: true } : { messages: [message, message] } });
  };
  const options = new AbortController().signal;
  assert.equal((await syncInboxGmail(options, fetchImpl)).count, 1);
  await syncInboxGmail(options, fetchImpl);
  const original = all().find(({ source }) => source === 'gmail')!;
  assert.equal(getInboxThread(original.id).messages.length, 1);
  const successAt = gmailSyncStatus().lastSyncedAt;
  malformed = true;
  await assert.rejects(syncInboxGmail(options, fetchImpl), { status: 502 });
  assert.equal(gmailSyncStatus().lastSyncedAt, successAt);
  assert.equal(gmailSyncStatus().lastOutcome, 'unknown');
  getDb().prepare("UPDATE composio_connections SET connected_account_id = 'fixture-account-2' WHERE toolkit_slug = 'gmail'").run();
  assert.throws(() => getInboxThread(original.id), { status: 404 });
  malformed = false;
  expectedAccount = 'fixture-account-2';
  await syncInboxGmail(options, fetchImpl);
  assert.notEqual(all().find(({ source }) => source === 'gmail')?.id, original.id);
  setEnabledComposioToolkits([]);
  await assert.rejects(syncInboxGmail(options, fetchImpl), { status: 409 });
  assert.equal(readCount, 4);
});

test('dynamic tool lookup ranks the requested integration and refuses ambiguous or revoked accounts', async (t) => {
  setup(t);
  fixtureKey(t);
  const toolkits = ['notion', 'trello', 'spotify', 'figma', 'linear', 'asana', 'github'];
  toolkits.forEach((slug) => addAccount(slug, `fixture-${slug}`));
  setEnabledComposioToolkits(toolkits);
  const fetched: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    const url = new URL(String(input));
    const slug = url.searchParams.get('toolkit_slug')!;
    fetched.push(slug);
    return Response.json({ items: [{ slug: `${slug.toUpperCase()}_LIST_ISSUES`, name: 'List issues', input_parameters: { type: 'object', properties: {} } }] });
  };
  const offered = await getActiveComposioToolsForAgent(fetchImpl, undefined, 'List GitHub issues');
  assert.equal(offered[0].name, 'composio__GITHUB_LIST_ISSUES');
  assert.ok(fetched.includes('github'));

  const accounts = [{ id: 'fixture-one', toolkit: { slug: 'github' }, status: 'ACTIVE' }, { id: 'fixture-two', toolkit: { slug: 'github' }, status: 'ACTIVE' }];
  const synced = await syncComposioConnections(async () => Response.json({ items: accounts }));
  assert.equal(synced.ok, true);
  assert.equal(getActiveComposioTarget('github'), null);
  assert.equal((await executeComposioTool('GITHUB_LIST_ISSUES', {}, async () => assert.fail('ambiguous account'))).ok, false);
  await syncComposioConnections(async () => Response.json({ items: accounts.slice(0, 1) }));
  assert.equal(getActiveComposioTarget('github')?.accountId, 'fixture-one');
  await syncComposioConnections(async () => Response.json({ items: [] }));
  assert.equal(getActiveComposioTarget('github'), null);
});
