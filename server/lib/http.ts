import type { IncomingMessage, ServerResponse } from 'node:http';

const MAX_BODY_BYTES = 10 * 1024 * 1024; // 10 MB

export class HttpBadRequestError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function readJsonBody<T = Record<string, unknown>>(req: IncomingMessage): Promise<T> {
  const ct = (req.headers['content-type'] ?? '').toLowerCase();
  if (ct && !ct.includes('application/json')) {
    throw new HttpBadRequestError(415, 'Unsupported Content-Type; expected application/json');
  }

  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    total += buf.length;
    if (total > MAX_BODY_BYTES) {
      throw new HttpBadRequestError(413, 'Request payload too large');
    }
    chunks.push(buf);
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {} as T;
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new HttpBadRequestError(400, 'Invalid JSON body');
  }
}

export function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

export function sendError(res: ServerResponse, status: number, message: string): void {
  sendJson(res, status, { ok: false, error: message });
}
