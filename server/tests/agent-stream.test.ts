import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test, { type TestContext } from 'node:test';
import type { AgentFrame } from '../../shared/ai-protocol.ts';
import { closeDb, getDb, initDatabase } from '../db/connection.ts';
import { createLlamreiServer } from '../index.ts';
import { handleLlamreiPrompt } from '../services/llamrei-agent.service.ts';

const realFetch = globalThis.fetch;
const sseHeaders = { 'Content-Type': 'text/event-stream' };
const encoder = new TextEncoder();
const localTags = 'http://127.0.0.1:11434/api/tags';
const localCompletions = 'http://127.0.0.1:11434/v1/chat/completions';
const models = () => Response.json({ models: [{ model: 'qwen2.5:7b' }] });
const sse = (delta: object, finish_reason: string | null = null) => `data: ${JSON.stringify({ choices: [{ delta, finish_reason }] })}\n\n`;
const done = 'data: [DONE]\n\n';
const completion = (content: string) => new Response(sse({ content }, 'stop') + done, { headers: sseHeaders });

type PromptResult = Awaited<ReturnType<typeof handleLlamreiPrompt>>;

async function* frames(response: Response): AsyncGenerator<AgentFrame<PromptResult>> {
  assert.match(response.headers.get('Content-Type') ?? '', /application\/x-ndjson/);
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  try {
    for (;;) {
      const item = await reader.read();
      if (item.done) break;
      pending += decoder.decode(item.value, { stream: true });
      let newline = pending.indexOf('\n');
      while (newline !== -1) {
        yield JSON.parse(pending.slice(0, newline)) as AgentFrame<PromptResult>;
        pending = pending.slice(newline + 1);
        newline = pending.indexOf('\n');
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

async function setup(t: TestContext, mockFetch: typeof fetch) {
  initDatabase(':memory:');
  const previousToken = process.env.LLAMREI_API_TOKEN;
  process.env.LLAMREI_API_TOKEN = 'fixture-only';
  const server = createLlamreiServer();
  t.mock.method(globalThis, 'fetch', mockFetch);
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    closeDb();
    if (previousToken === undefined) delete process.env.LLAMREI_API_TOKEN;
    else process.env.LLAMREI_API_TOKEN = previousToken;
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

function post(base: string, body: unknown, options: { legacy?: boolean; signal?: AbortSignal; headers?: Record<string, string> } = {}) {
  return realFetch(`${base}/api/agent/prompt${options.legacy ? '' : '/stream'}`, {
    method: 'POST', body: JSON.stringify(body), signal: options.signal,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
}

function promptExists(prompt: string): boolean {
  return !!getDb().prepare('SELECT 1 FROM chat_messages WHERE content = ?').get(prompt);
}

test('HTTP sends provisional text and observed sources, then stores the complete turn once', { timeout: 6000 }, async (t) => {
  const expectedPrompt = 'Request from synthetic fixture';
  let finish!: () => void;
  let calls = 0;
  const base = await setup(t, async (url, init) => {
    if (String(url) === localTags) return models();
    assert.equal(String(url), localCompletions);
    calls++;
    const body = String(init?.body);
    assert.ok(!body.includes('fixture-attachment-secret'));
    assert.ok(!body.includes('private@example.test'));
    if (calls === 2) {
      assert.ok(body.includes('Tugas workspace'));
      return completion('Jawaban selesai berdasarkan [S2].');
    }
    return new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(sse({ content: 'Sedang memeriksa…' })));
        finish = () => {
          controller.enqueue(encoder.encode(sse({ tool_calls: [{ index: 0, id: 'read-fixture', function: {
            name: 'list_clickup_tasks', arguments: '{}',
          } }] }, 'tool_calls') + done));
          controller.close();
        };
      },
    }), { headers: sseHeaders });
  });

  const request = {
    prompt: expectedPrompt, providerOverride: 'ollama', requestId: crypto.randomUUID(),
    contextAttachment: { title: 'Synthetic contact private@example.test', api_key: 'fixture-attachment-secret' },
  };
  const response = await post(base, request);
  let sawRead = false;
  let result: PromptResult | undefined;
  for await (const event of frames(response)) {
    if (event.type === 'delta' && event.text === 'Sedang memeriksa…') {
      assert.equal(promptExists(expectedPrompt), false);
      finish();
    }
    if (event.type === 'state' && event.stage === 'tools') sawRead = true;
    if (event.type === 'complete') result = event.result;
  }
  assert.ok(sawRead);
  assert.equal(result?.assistantMessage.content, 'Jawaban selesai berdasarkan [S2].');
  assert.deepEqual(JSON.parse(result?.assistantMessage.source_refs_json ?? 'null'), [
    { id: 'S1', label: 'Item terlampir' }, { id: 'S2', label: 'Tugas workspace' },
  ]);
  assert.equal(getDb().prepare('SELECT count(*) AS n FROM chat_messages WHERE content = ?').get(expectedPrompt)?.n, 1);
  let replayId: string | undefined;
  for await (const event of frames(await post(base, request))) if (event.type === 'complete') replayId = event.result.assistantMessage.id;
  assert.equal(replayId, result?.assistantMessage.id);
  assert.equal(calls, 2);

  const metrics = await (await realFetch(`${base}/api/ai/metrics`)).json() as { models: Array<{ streamedSamples: number }> };
  assert.equal(metrics.models[0].streamedSamples, 2);
  const legacy = await post(base, { prompt: 'Briefing pagi', providerOverride: 'local' }, { legacy: true });
  assert.equal(legacy.status, 200);
  const legacyBody = await legacy.json() as PromptResult;
  assert.equal(legacyBody.providerUsed, 'local');
  assert.match(legacyBody.assistantMessage.content, /MORNING BRIEFING/);
});

test('concurrent retries of the same request leave one approval and reuse the recorded response', { timeout: 6000 }, async (t) => {
  const base = await setup(t, async () => assert.fail('Unexpected outgoing fixture request'));
  const request = { prompt: 'Buat tugas Fixture Ascension', requestId: crypto.randomUUID(), providerOverride: 'local' };
  const replies = await Promise.all([post(base, request, { legacy: true }), post(base, request, { legacy: true })]);
  const [first, second] = await Promise.all(replies.map(async (reply) => {
    assert.equal(reply.status, 200);
    return await reply.json() as PromptResult;
  }));
  assert.equal(first.userMessage.id, second.userMessage.id);
  assert.equal(first.assistantMessage.id, second.assistantMessage.id);
  assert.ok(first.assistantMessage.approval_card_json);
  assert.equal(getDb().prepare('SELECT count(*) AS n FROM agent_audit_logs WHERE user_command = ?').get(request.prompt)?.n, 1);
});

test('disconnect cancels upstream and leaves the prompt, partial reply and proposals uncommitted', { timeout: 6000 }, async (t) => {
  let notifyAborted!: () => void;
  const cancelled = new Promise<void>((resolve) => { notifyAborted = resolve; });
  const base = await setup(t, async (url, init) => {
    if (String(url) === localTags) return models();
    assert.equal(String(url), localCompletions);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(sse({ content: 'Potongan sintetis sebelum batal' })));
        init?.signal?.addEventListener('abort', () => {
          controller.error(init.signal?.reason);
          notifyAborted();
        }, { once: true });
      },
    });
    return new Response(body, { headers: sseHeaders });
  });
  const controller = new AbortController();
  const prompt = 'Create fixture after confirmation';
  const response = await post(base, { prompt, providerOverride: 'ollama' }, { signal: controller.signal });
  for await (const event of frames(response)) {
    if (event.type !== 'delta') continue;
    controller.abort();
    break;
  }
  await cancelled;
  assert.equal(promptExists(prompt), false);
  assert.equal(promptExists('Potongan sintetis sebelum batal'), false);
  assert.equal(getDb().prepare('SELECT count(*) AS n FROM agent_audit_logs WHERE user_command = ?').get(prompt)?.n, 0);
});

test('private context hides external tools and invalid local actions cannot create an approval', { timeout: 6000 }, async (t) => {
  let calls = 0;
  const base = await setup(t, async (url, init) => {
    if (String(url) === localTags) return models();
    assert.equal(String(url), localCompletions);
    const payload = String(init?.body);
    assert.ok(!payload.includes('unredacted-attachment-key'));
    assert.ok(!payload.includes('history@example.test'));
    assert.ok(!payload.includes('Bearertest1234567890'));
    if (++calls > 1) {
      assert.ok(payload.includes('Tool or arguments unavailable'));
      return completion('Parameter perlu diperiksa.');
    }
    assert.ok(!payload.includes('composio__GMAIL_FETCH_EMAILS'));
    return new Response(sse({ tool_calls: [
      { index: 0, id: 'invalid-write', function: { name: 'create_clickup_task', arguments: '{"title":"Fixture","listId":17}' } },
      { index: 1, id: 'unknown-read', function: { name: 'composio__GMAIL_FETCH_EMAILS', arguments: '{}' } },
    ] }, 'tool_calls') + done, { headers: sseHeaders });
  });
  const db = getDb();
  db.prepare("INSERT INTO chat_messages (id, session_id, role, content) VALUES ('history-test','sess_main','user',?)").run(
    'Synthetic history@example.test with Bearer Bearertest1234567890',
  );
  db.prepare(`INSERT INTO composio_connections (id, toolkit_slug, toolkit_name, connected_account_id, status)
    VALUES ('fixture', 'gmail', 'Gmail', 'example', 'active')`).run();

  let final: PromptResult | undefined;
  const prompt = 'Buat tugas dengan fixture';
  const response = await post(base, { prompt, contextAttachment: { authorization: 'unredacted-attachment-key' }, providerOverride: 'ollama' });
  for await (const event of frames(response)) if (event.type === 'complete') final = event.result;
  assert.equal(calls, 2);
  assert.equal(final?.assistantMessage.content, 'Parameter perlu diperiksa.');
  assert.equal(final?.assistantMessage.approval_card_json, null);
  assert.equal(db.prepare('SELECT count(*) AS n FROM agent_audit_logs WHERE user_command = ?').get(prompt)?.n, 0);
});

test('prompt stream shares authentication and validates input before sending headers', { timeout: 6000 }, async (t) => {
  const base = await setup(t, async () => assert.fail('Unexpected outgoing fixture request'));
  assert.equal((await post(base, { prompt: '' })).status, 400);
  assert.equal((await post(base, { prompt: 'x'.repeat(8001) })).status, 400);
  assert.equal((await post(base, { prompt: 'Fixture', providerOverride: 'unknown' })).status, 400);
  assert.equal((await post(base, { prompt: 'Fixture', sessionId: 'missing' })).status, 404);
  assert.equal((await post(base, { prompt: 'Fixture' }, { headers: { 'X-Forwarded-Proto': 'https' } })).status, 401);
  assert.equal((await post(base, { prompt: 'Fixture' }, { headers: { Origin: 'https://elsewhere.invalid' } })).status, 403);
});
