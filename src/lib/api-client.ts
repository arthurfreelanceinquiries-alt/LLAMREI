export const API_SESSION_REQUIRED = 'llamrei:api-session-required';

export function notifyApiSessionRequired(url: string, status: number): void {
  if (status === 401 && url.startsWith('/api/')) window.dispatchEvent(new Event(API_SESSION_REQUIRED));
}

export async function apiRequest<T = unknown>(
  url: string,
  options?: { method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'; body?: unknown; signal?: AbortSignal },
): Promise<T> {
  const res = await fetch(url, {
    method: options?.method ?? 'GET',
    headers: options?.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: options?.body !== undefined ? JSON.stringify(options.body) : undefined,
    signal: options?.signal,
  });
  if (!res.ok) {
    notifyApiSessionRequired(url, res.status);
    const errText = await res.text();
    throw new Error(errText || `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}
