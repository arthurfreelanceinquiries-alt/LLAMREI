import type { IncomingMessage, ServerResponse } from 'node:http';
import { INBOX_SOURCES, type InboxSnapshot, type InboxSource } from '../../shared/inbox.ts';
import { HttpBadRequestError, readJsonBody, sendJson } from '../lib/http.ts';
import { getBaileysStatus } from '../services/whatsapp-baileys.service.ts';
import { gmailSyncStatus, syncInboxGmail } from './gmail.ts';
import { createInboxDraft, getInboxThread, listInboxThreads, updateInboxThread } from './store.ts';

export async function routeInbox(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<boolean> {
  if (pathname === '/api/inbox' && req.method === 'GET') {
    const params = new URL(req.url ?? '/', 'http://127.0.0.1').searchParams;
    const source = (params.get('source') || undefined) as InboxSource | undefined;
    const query = params.get('q') ?? '';
    if (query.length > 200 || (source && !INBOX_SOURCES.includes(source))) throw new HttpBadRequestError(400, 'Filter inbox tidak valid.');
    const snapshot: InboxSnapshot = {
      threads: listInboxThreads({ source, query, unread: params.get('unread') === '1', followUp: params.get('followUp') === '1' }),
      gmail: gmailSyncStatus(), whatsapp: getBaileysStatus().status === 'connected' ? 'connected' : 'cached',
    };
    sendJson(res, 200, snapshot);
    return true;
  }
  if (pathname === '/api/inbox/gmail/sync' && req.method === 'POST') {
    await readJsonBody<unknown>(req);
    const controller = new AbortController();
    const abort = () => controller.abort();
    res.once('close', abort);
    try {
      const result = await syncInboxGmail(controller.signal);
      if (!controller.signal.aborted) sendJson(res, 200, result);
    } catch (error) {
      if (!controller.signal.aborted) throw error;
    } finally {
      res.off('close', abort);
    }
    return true;
  }
  const match = pathname.match(/^\/api\/inbox\/threads\/([a-zA-Z0-9_-]+)(\/drafts)?$/);
  if (!match) return false;
  const [, id, drafts] = match;
  if (drafts && req.method === 'POST') sendJson(res, 201, createInboxDraft(id, await readJsonBody<unknown>(req)));
  else if (!drafts && req.method === 'GET') sendJson(res, 200, getInboxThread(id));
  else if (!drafts && req.method === 'PATCH') sendJson(res, 200, updateInboxThread(id, await readJsonBody<unknown>(req)));
  else return false;
  return true;
}
