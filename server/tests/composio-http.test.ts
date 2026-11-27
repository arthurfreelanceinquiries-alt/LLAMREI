import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { closeDb } from '../db/connection.ts';

test('direct Composio execute route denies writes and malformed requests without contacting a provider', async (t) => {
  const originalPath = process.env.LLAMREI_DB_PATH;
  const originalToken = process.env.LLAMREI_API_TOKEN;
  process.env.LLAMREI_DB_PATH = ':memory:';
  process.env.LLAMREI_API_TOKEN = 'synthetic-composio-http-fixture';
  t.after(() => {
    if (originalPath === undefined) delete process.env.LLAMREI_DB_PATH;
    else process.env.LLAMREI_DB_PATH = originalPath;
    if (originalToken === undefined) delete process.env.LLAMREI_API_TOKEN;
    else process.env.LLAMREI_API_TOKEN = originalToken;
    closeDb();
  });
  const { createLlamreiServer } = await import('../index.ts');
  const request = globalThis.fetch;
  const providerCalls = t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('Unexpected provider request');
  });

  const server = createLlamreiServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}/api/composio/tools/execute`;
  const execute = (body: unknown) => request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const denied = await execute({ toolSlug: 'GMAIL_SEND_EMAIL', arguments: {} });
  assert.equal(denied.status, 400);
  assert.deepEqual(await denied.json(), { ok: false, error: 'Composio tool requires approval' });
  const malformed = await execute(null);
  assert.equal(malformed.status, 400);
  assert.deepEqual(await malformed.json(), { ok: false, error: 'Invalid Composio tool slug' });
  assert.equal(providerCalls.mock.callCount(), 0);
});
