// Local Offline Cache & Outbox Queue for Mobile Home Screen Widgets (FR-68)
export interface OfflineMutation {
  mutationId: string;
  deviceId: string;
  actionType: 'task_toggle_done' | 'task_quick_create' | 'alarm_dismiss' | 'alarm_snooze' | 'alarm_toggle';
  targetId: string;
  payload?: Record<string, unknown>;
  clientTimestamp: string;
}

const SNAPSHOT_CACHE_KEY = 'llamrei_mobile_widget_snapshot_v1';
const OUTBOX_KEY = 'llamrei_mobile_outbox_v1';

export function saveWidgetSnapshotCache(snapshot: unknown): void {
  try {
    localStorage.setItem(SNAPSHOT_CACHE_KEY, JSON.stringify(snapshot));
  } catch {
    // Ignore storage quota issues
  }
}

export function loadWidgetSnapshotCache<T>(): T | null {
  try {
    const raw = localStorage.getItem(SNAPSHOT_CACHE_KEY);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function getOfflineOutbox(): OfflineMutation[] {
  try {
    const raw = localStorage.getItem(OUTBOX_KEY);
    return raw ? (JSON.parse(raw) as OfflineMutation[]) : [];
  } catch {
    return [];
  }
}

export function enqueueOfflineMutation(mutation: Omit<OfflineMutation, 'mutationId' | 'clientTimestamp'>): OfflineMutation[] {
  const list = getOfflineOutbox();
  list.push({
    ...mutation,
    mutationId: `mut_${crypto.randomUUID().slice(0, 10)}`,
    clientTimestamp: new Date().toISOString(),
  });
  localStorage.setItem(OUTBOX_KEY, JSON.stringify(list));
  return list;
}

export function clearOfflineOutbox(): void {
  localStorage.removeItem(OUTBOX_KEY);
}
