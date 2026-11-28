import type { IncomingMessage, ServerResponse } from 'node:http';
import { HttpBadRequestError, readJsonBody, sendJson } from '../lib/http.ts';
import { configureMemoryIndex, indexMemoryEntries, indexPendingMemory, memoryIndexStatus } from './embeddings.ts';
import { searchMemory } from './search.ts';
import { createMemory, deleteMemory, getMemory, isMemoryKind, purgeExpiredMemory, updateMemory } from './store.ts';

export async function routeMemory(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<boolean> {
  const method = req.method ?? 'GET';
  const controller = new AbortController();
  const abort = () => controller.abort();
  res.once('close', abort);
  const { signal } = controller;
  try {
    purgeExpiredMemory();
    if (pathname === '/api/memory/index') {
      if (method === 'GET') sendJson(res, 200, memoryIndexStatus());
      else if (method === 'PATCH') sendJson(res, 200, configureMemoryIndex(await readJsonBody<unknown>(req)));
      else if (method === 'POST') {
        const result = await indexPendingMemory({ signal });
        if (!signal.aborted) sendJson(res, 200, result);
      } else return false;
      return true;
    }
    if (pathname === '/api/memory') {
      if (method === 'GET') {
        const params = new URL(req.url ?? '/', 'http://127.0.0.1').searchParams;
        const query = params.get('q') ?? '';
        const kind = params.get('kind');
        const limit = Number(params.get('limit') ?? 24);
        if (query.length > 300 || (kind && !isMemoryKind(kind)) || !Number.isInteger(limit) || limit < 1 || limit > 60) {
          throw new HttpBadRequestError(400, 'Parameter pencarian memori tidak valid.');
        }
        const result = await searchMemory(query, { kind: isMemoryKind(kind) ? kind : undefined, limit, signal, keywordOnly: params.get('mode') === 'keyword' });
        if (!signal.aborted) sendJson(res, 200, result);
      } else if (method === 'POST') {
        const item = createMemory(await readJsonBody<unknown>(req));
        await indexMemoryEntries([item], { signal });
        if (!signal.aborted) sendJson(res, 201, item);
      } else return false;
      return true;
    }
    const id = pathname.match(/^\/api\/memory\/(mem_[a-f0-9-]{36})$/)?.[1];
    if (!id) return false;
    if (method === 'GET') {
      const item = getMemory(id);
      if (!item) throw new HttpBadRequestError(404, 'Memori tidak ditemukan atau sudah kedaluwarsa.');
      sendJson(res, 200, item);
    } else if (method === 'PATCH') {
      const item = updateMemory(id, await readJsonBody<unknown>(req));
      await indexMemoryEntries([item], { signal });
      if (!signal.aborted) sendJson(res, 200, item);
    } else if (method === 'DELETE') {
      const input = await readJsonBody<{ revision?: number } | null>(req);
      deleteMemory(id, input?.revision);
      sendJson(res, 200, { ok: true });
    } else return false;
    return true;
  } catch (error) {
    if (!signal.aborted) throw error;
    return true;
  } finally {
    res.off('close', abort);
  }
}
