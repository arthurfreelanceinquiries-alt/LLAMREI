import type { IncomingMessage, ServerResponse } from 'node:http';
import { AI_PROVIDER_IDS, MAX_AGENT_PROMPT_CHARS, type AgentFrame, type AiProviderId } from '../../shared/ai-protocol.ts';
import { getDb } from '../db/connection.ts';
import { HttpBadRequestError, readJsonBody, sendJson } from '../lib/http.ts';
import { getAiBudgetSummary, handleLlamreiPrompt, listAuditLogs } from '../services/llamrei-agent.service.ts';

async function readAgentPrompt(req: IncomingMessage) {
  const raw = await readJsonBody<unknown>(req);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new HttpBadRequestError(400, 'Permintaan asisten tidak valid.');
  const body = raw as Record<string, unknown>;
  if (typeof body.prompt !== 'string' || !body.prompt.trim() || body.prompt.length > MAX_AGENT_PROMPT_CHARS) {
    throw new HttpBadRequestError(400, `Masukkan pesan dengan panjang 1–${MAX_AGENT_PROMPT_CHARS} karakter.`);
  }
  const { sessionId, requestId, contextAttachment, providerOverride, modelOverride } = body;
  if (sessionId !== undefined && (typeof sessionId !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(sessionId))) {
    throw new HttpBadRequestError(400, 'Sesi asisten tidak valid.');
  }
  if (!getDb().prepare('SELECT 1 FROM chat_sessions WHERE id = ?').get(sessionId ?? 'sess_main')) {
    throw new HttpBadRequestError(404, 'Sesi asisten tidak ditemukan.');
  }
  if (requestId !== undefined && (typeof requestId !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(requestId))) {
    throw new HttpBadRequestError(400, 'ID permintaan tidak valid.');
  }
  if (contextAttachment != null && (typeof contextAttachment !== 'object' || Array.isArray(contextAttachment))) {
    throw new HttpBadRequestError(400, 'Konteks terlampir harus berupa objek.');
  }
  if (providerOverride !== undefined && !AI_PROVIDER_IDS.includes(providerOverride as AiProviderId)) {
    throw new HttpBadRequestError(400, 'Penyedia asisten tidak dikenal.');
  }
  if (modelOverride !== undefined && (typeof modelOverride !== 'string' || modelOverride.length > 256 || /[\u0000-\u001F\u007F]/.test(modelOverride))) {
    throw new HttpBadRequestError(400, 'Nama model tidak valid.');
  }
  return {
    prompt: body.prompt.trim(),
    sessionId,
    requestId,
    contextAttachment: contextAttachment as Record<string, unknown> | null | undefined,
    aiOptions: { providerOverride: providerOverride as AiProviderId | undefined, modelOverride: modelOverride?.trim() || undefined },
  };
}

export async function respondToAgentPrompt(req: IncomingMessage, res: ServerResponse, stream: boolean): Promise<void> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  res.once('close', abort);
  try {
    const body = await readAgentPrompt(req);
    if (res.destroyed || res.writableEnded) return;
    const input = { ...body, aiOptions: { ...body.aiOptions, signal: controller.signal } };
    if (!stream) {
      const result = await handleLlamreiPrompt(input);
      if (!controller.signal.aborted) sendJson(res, 200, { ...result, aiBudget: getAiBudgetSummary(), auditLogs: listAuditLogs() });
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      'X-Accel-Buffering': 'no',
      'X-Content-Type-Options': 'nosniff',
    });
    res.flushHeaders();

    function write(frame: AgentFrame<Awaited<ReturnType<typeof handleLlamreiPrompt>>>): void {
      if (res.destroyed || res.writableEnded) {
        abort();
        return;
      }
      if (res.writableLength > 512 * 1024) {
        abort();
        res.destroy();
        return;
      }
      res.write(`${JSON.stringify(frame)}\n`);
    }

    try {
      const result = await handleLlamreiPrompt({ ...input, onProgress: write });
      if (!controller.signal.aborted) write({ type: 'complete', result });
    } catch (error) {
      if (!controller.signal.aborted) {
        const message = error instanceof Error && error.name === 'TimeoutError'
          ? 'Waktu respons habis. Pesan masih tersedia untuk dikirim ulang.'
          : 'Balasan terhenti. Periksa percakapan sebelum mengirim ulang.';
        write({ type: 'error', message });
      }
    } finally {
      if (!res.writableEnded && !res.destroyed) res.end();
    }
  } catch (error) {
    if (!controller.signal.aborted && !res.writableEnded) throw error;
  } finally {
    res.off('close', abort);
  }
}
