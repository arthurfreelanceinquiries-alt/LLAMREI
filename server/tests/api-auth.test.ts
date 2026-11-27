import assert from 'node:assert/strict';
import { once } from 'node:events';
import http, { type IncomingMessage, type OutgoingHttpHeaders } from 'node:http';
import test, { type TestContext } from 'node:test';
import { closeDb } from '../db/connection.ts';

// Server imports hydrate chat state. Keep that state in the disposable test fixture.
const previousDbPath = process.env.LLAMREI_DB_PATH;
process.env.LLAMREI_DB_PATH = ':memory:';
const { createLlamreiServer, isRemoteRequestAuthorized } = await import('../index.ts');
closeDb();
if (previousDbPath === undefined) delete process.env.LLAMREI_DB_PATH;
else process.env.LLAMREI_DB_PATH = previousDbPath;

const TOKEN = 'llamrei-synthetic-api-test-token';

async function startFixtureServer(t: TestContext, remoteOrigin?: string) {
  const previousToken = process.env.LLAMREI_API_TOKEN;
  const previousOrigin = process.env.LLAMREI_REMOTE_ORIGIN;
  process.env.LLAMREI_API_TOKEN = TOKEN;
  if (remoteOrigin === undefined) delete process.env.LLAMREI_REMOTE_ORIGIN;
  else process.env.LLAMREI_REMOTE_ORIGIN = remoteOrigin;
  let server: http.Server;
  try {
    server = createLlamreiServer();
  } finally {
    if (previousToken === undefined) delete process.env.LLAMREI_API_TOKEN;
    else process.env.LLAMREI_API_TOKEN = previousToken;
    if (previousOrigin === undefined) delete process.env.LLAMREI_REMOTE_ORIGIN;
    else process.env.LLAMREI_REMOTE_ORIGIN = previousOrigin;
  }
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise<void>((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  }));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const { port } = address;

  return (path: string, headers: OutgoingHttpHeaders = {}, method = 'GET'): Promise<IncomingMessage> => {
    return new Promise((resolve, reject) => {
      const request = http.request({ hostname: '127.0.0.1', port, path, headers, method }, resolve);
      request.on('error', reject);
      request.end();
    });
  };
}

test('API distinguishes local requests from proxied requests and preserves bearer access', async (t) => {
  const request = await startFixtureServer(t);
  async function requestHealth(headers?: OutgoingHttpHeaders) {
    const response = await request('/api/health', headers);
    response.resume();
    return response.statusCode;
  }

  assert.equal(await requestHealth(), 200);
  assert.equal(await requestHealth({ Host: 'localhost:5173', Origin: 'http://localhost:5173' }), 200);
  assert.equal(await requestHealth({ Host: 'localhost:5173', Origin: 'http://localhost:5713' }), 403);

  const remoteHost = 'llamrei.example.test';
  assert.equal(await requestHealth({ Host: remoteHost }), 401);
  assert.equal(await requestHealth({ 'X-Forwarded-For': '192.0.2.20' }), 401);
  assert.equal(await requestHealth({ 'Tailscale-User-Login': 'fixture@example.test' }), 401);
  assert.equal(await requestHealth({
    Host: remoteHost,
    Origin: `https://${remoteHost}`,
    Forwarded: 'for=192.0.2.20;proto=https',
    Authorization: `Bearer ${TOKEN}`,
  }), 200);
});

test('Bearer comparison safely rejects invalid byte lengths and empty tokens', () => {
  assert.equal(isRemoteRequestAuthorized('192.0.2.20', 'Bearer é', 'a'), false);
  assert.equal(isRemoteRequestAuthorized('192.0.2.20', 'Bearer ', ''), false);
});

test('Remote browser sessions require trusted HTTPS, protect writes, and revoke active SSE', async (t) => {
  const host = 'llamrei.example.test';
  const origin = `https://${host}`;
  const request = await startFixtureServer(t, origin);
  const sessionPath = '/api/auth/session';
  const ingress = { Host: host, 'X-Forwarded-Host': host, 'X-Forwarded-Proto': 'https' };
  const bearer = { ...ingress, Authorization: `Bearer ${TOKEN}` };
  const signIn = { ...bearer, Origin: origin };

  const requestStatus = async (path: string, headers?: OutgoingHttpHeaders, method?: string) => {
    const response = await request(path, headers, method);
    response.resume();
    return response.statusCode;
  };

  assert.equal(await requestStatus(sessionPath, ingress), 200);
  assert.equal(await requestStatus(sessionPath, bearer, 'POST'), 403);
  assert.equal(await requestStatus(sessionPath, { ...signIn, 'X-Forwarded-Proto': 'http' }, 'POST'), 403);
  assert.equal(await requestStatus(sessionPath, { ...signIn, 'X-Forwarded-Host': 'other.example.test' }, 'POST'), 403);
  assert.equal(await requestStatus(sessionPath, { ...signIn, 'Tailscale-Funnel-Request': '?1' }, 'POST'), 403);
  assert.equal(await requestStatus(sessionPath, { ...signIn, Authorization: 'Bearer invalid' }, 'POST'), 401);
  assert.equal(await requestStatus('/api/events', ingress), 401);

  const login = await request(sessionPath, signIn, 'POST');
  login.resume();
  assert.equal(login.statusCode, 200);
  const cookie = login.headers['set-cookie']?.[0];
  assert.match(cookie ?? '', /^__Host-llamrei-session=[a-f0-9]{64}; Path=\/; HttpOnly; Secure; SameSite=Strict; Max-Age=3600$/);
  assert.ok(cookie);
  const authenticated = { ...ingress, Cookie: cookie.split(';')[0] };

  assert.equal(await requestStatus('/api/health', authenticated), 200);
  assert.equal(await requestStatus('/api/health', { ...authenticated, 'X-Forwarded-Proto': 'http' }), 401);
  assert.equal(await requestStatus('/api/health', authenticated, 'POST'), 403);
  assert.equal(await requestStatus('/api/health', { ...authenticated, Origin: origin }, 'POST'), 404);

  const events = await request('/api/events', authenticated);
  const eventsClosed = once(events, 'end');
  events.resume();
  assert.equal(events.statusCode, 200);
  assert.equal(events.headers['cache-control'], 'no-store');

  assert.equal(await requestStatus(sessionPath, authenticated, 'DELETE'), 403);
  const logout = await request(sessionPath, { ...authenticated, Origin: origin }, 'DELETE');
  logout.resume();
  assert.equal(logout.statusCode, 200);
  assert.match(logout.headers['set-cookie']?.[0] ?? '', /Max-Age=0$/);
  await eventsClosed;
  assert.equal(await requestStatus('/api/health', authenticated), 401);
});
