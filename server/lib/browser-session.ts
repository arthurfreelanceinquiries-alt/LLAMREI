import { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendError, sendJson } from './http.ts';

const COOKIE_NAME = '__Host-llamrei-session';
const SESSION_SECONDS = 60 * 60;
const SESSION_MILLISECONDS = SESSION_SECONDS * 1000;
const MAX_SESSIONS = 64;

function configuredHttpsOrigin(value: string | undefined): URL | undefined {
  if (!value) return;
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && url.origin === value) return url;
  } catch {
    // Invalid configuration leaves remote browser sessions disabled.
  }
}

function cookieId(req: IncomingMessage): string | undefined {
  const cookies = req.headers.cookie?.split(';').map((part) => part.trim()) ?? [];
  const matching = cookies.filter((cookie) => cookie.startsWith(`${COOKIE_NAME}=`));
  const id = matching.length === 1 ? matching[0].slice(COOKIE_NAME.length + 1) : '';
  return /^[a-f0-9]{64}$/.test(id) ? id : undefined;
}

function setSessionCookie(res: ServerResponse, id: string, maxAge: number): void {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${id}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`);
}

interface Session {
  expiresAt: number;
  timeout: NodeJS.Timeout;
  streams: Set<ServerResponse>;
}

export function createBrowserSessions(originSetting: string | undefined, isLoopback: (address: string | undefined) => boolean) {
  const origin = configuredHttpsOrigin(originSetting);
  const sessions = new Map<string, Session>();

  function isTrustedIngress(req: IncomingMessage): boolean {
    if (!origin || !isLoopback(req.socket.remoteAddress) || !isLoopback(req.socket.localAddress)) return false;
    const hosts = req.headersDistinct.host;
    const forwardedHosts = req.headersDistinct['x-forwarded-host'];
    const protocols = req.headersDistinct['x-forwarded-proto'];
    return hosts?.length === 1 && hosts[0].toLowerCase() === origin.host &&
      forwardedHosts?.length === 1 && forwardedHosts[0].toLowerCase() === origin.host &&
      protocols?.length === 1 && protocols[0] === 'https' && !req.headersDistinct['tailscale-funnel-request'];
  }

  function revoke(id: string): void {
    const session = sessions.get(id);
    if (!session) return;
    sessions.delete(id);
    clearTimeout(session.timeout);
    for (const stream of session.streams) stream.end();
  }

  function get(req: IncomingMessage): Session | undefined {
    if (!isTrustedIngress(req)) return;
    const id = cookieId(req);
    if (!id) return;
    const session = sessions.get(id);
    if (session && session.expiresAt <= Date.now()) {
      revoke(id);
      return;
    }
    return session;
  }

  function isSameOrigin(req: IncomingMessage): boolean {
    return origin !== undefined && req.headers.origin === origin.origin;
  }

  function handle(req: IncomingMessage, res: ServerResponse, isDirectLocal: boolean, hasBearer: boolean): void {
    if (req.method === 'GET' && isDirectLocal) {
      sendJson(res, 200, { state: 'local' });
      return;
    }
    if (!isTrustedIngress(req)) {
      sendError(res, 403, 'Remote browser access requires the configured private HTTPS origin');
      return;
    }
    if (req.method === 'GET') {
      const session = get(req);
      sendJson(res, 200, session
        ? { state: 'authenticated', expiresInMs: session.expiresAt - Date.now() }
        : { state: 'sign_in' });
      return;
    }
    if (!isSameOrigin(req)) {
      sendError(res, 403, 'Remote browser session changes require the configured origin');
      return;
    }
    const previousId = cookieId(req);
    if (req.method === 'DELETE') {
      if (previousId) revoke(previousId);
      setSessionCookie(res, '', 0);
      sendJson(res, 200, { state: 'sign_in' });
      return;
    }
    if (req.method !== 'POST') {
      sendError(res, 405, 'Unsupported browser session method');
      return;
    }
    if (!hasBearer) {
      sendError(res, 401, 'Unauthorized: invalid API token');
      return;
    }
    if (previousId) revoke(previousId);
    if (sessions.size >= MAX_SESSIONS) {
      sendError(res, 429, 'Too many active browser sessions');
      return;
    }
    const id = randomBytes(32).toString('hex');
    const expiresAt = Date.now() + SESSION_MILLISECONDS;
    const timeout = setTimeout(() => revoke(id), SESSION_MILLISECONDS).unref();
    sessions.set(id, { expiresAt, timeout, streams: new Set() });
    setSessionCookie(res, id, SESSION_SECONDS);
    sendJson(res, 200, { state: 'authenticated', expiresInMs: SESSION_MILLISECONDS });
  }

  function trackStream(session: Session, res: ServerResponse): void {
    session.streams.add(res);
    res.once('close', () => session.streams.delete(res));
  }

  return { get, handle, isSameOrigin, trackStream };
}
