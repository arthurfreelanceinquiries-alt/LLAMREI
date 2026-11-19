import type { ServerResponse } from 'node:http';

interface SseClient {
  id: string;
  res: ServerResponse;
}

class SseEventBus {
  clients: Set<SseClient> = new Set();

  subscribe(res: ServerResponse): () => void {
    const client: SseClient = { id: crypto.randomUUID(), res };
    this.clients.add(client);
    res.write(`event: connected\ndata: ${JSON.stringify({ ok: true, time: new Date().toISOString() })}\n\n`);
    return () => {
      this.clients.delete(client);
    };
  }

  emit(eventName: string, payload: unknown): void {
    const line = `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const client of this.clients) {
      if (!client.res.writableEnded) {
        client.res.write(line);
      }
    }
  }
}

export const sseBus = new SseEventBus();
