import { scrubPiiForLlm } from '../services/wa-export.service.ts';

const attachmentFields = [
  'id', 'title', 'description_md', 'content_md', 'summary_raw', 'body_text', 'event_name', 'source',
  'start_at', 'due_at', 'scheduled_at', 'published_at', 'priority', 'status', 'list_id',
  'topic_category', 'ai_urgency', 'quoted_message', 'proposed_event_title', 'proposed_event_start',
];
const secretKey = /(?:api[_-]?key|auth(?:orization)?|token|password|passphrase|secret|credential|cookie|private[_-]?key|headers|\b(?:raw[_-]?)?logs?\b)/i;

export function redactAiText(text: string): string {
  return scrubPiiForLlm(text)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[EMAIL_REDACTED]')
    .replace(/\b100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}\b/g, '[TAILSCALE_IP_REDACTED]')
    .replace(/(\b(?:otp|kode verifikasi)\b\D{0,24})\d{4,8}\b/gi, '$1[CODE_REDACTED]')
    .replace(/\bBearer\s+[^\s,;"']+/gi, 'Bearer [REDACTED]')
    .replace(/\b(?:sk-(?:proj-)?|gh[pousr]_|xox[baprs]-|AIza|AKIA)[A-Za-z0-9_-]{12,}\b/g, '[KEY_REDACTED]')
    .replace(/((?:api[_ -]?key|access[_ -]?token|password|passphrase|secret|cookie)\s*["']?\s*[:=]\s*["']?)[^\s"',;}]+/gi, '$1[REDACTED]')
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, '[KEY_REDACTED]');
}

export function compactAttachment(input?: Record<string, unknown> | null): Record<string, string> | null {
  if (!input) return null;
  const values = Object.entries(input).flatMap(([key, value]): Array<[string, string]> =>
    attachmentFields.includes(key) && typeof value === 'string'
      ? [[key, redactAiText(value).slice(0, 1200)]] : [],
  );
  return values.length ? Object.fromEntries(values) : null;
}

function safeResult(value: unknown, depth: number, budget: { remaining: number }): unknown {
  if (budget.remaining-- <= 0) return '[truncated]';
  if (typeof value === 'string') return redactAiText(value).slice(0, 1600);
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
  if (depth >= 5) return '[truncated]';
  if (Array.isArray(value)) return value.slice(0, 16).map((item) => safeResult(item, depth + 1, budget));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).slice(0, 24)
      .filter(([key]) => !secretKey.test(key))
      .map(([key, item]) => [redactAiText(key).slice(0, 80), safeResult(item, depth + 1, budget)]));
  }
  return null;
}

export function compactToolResult(value: unknown): string {
  const text = JSON.stringify(safeResult(value, 0, { remaining: 160 }));
  return text.length > 2800 ? `${text.slice(0, 2800)}… [truncated]` : text;
}

export function redactToolArguments(args: Record<string, unknown>): Record<string, unknown> {
  return safeResult(args, 0, { remaining: 160 }) as Record<string, unknown>;
}
