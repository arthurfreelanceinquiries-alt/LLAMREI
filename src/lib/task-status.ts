import type { ListItem } from '../types/llamrei';

const defaultStatuses = ['To Do', 'In Progress', 'Review', 'Done'];

export function listTaskStatuses(list?: ListItem, current?: string): string[] {
  let configured: string[] = [];
  try {
    const statuses: unknown = JSON.parse(list?.statuses_json ?? '[]');
    if (Array.isArray(statuses)) {
      configured = statuses.flatMap((status) => typeof status?.name === 'string' && status.name.trim() ? [status.name] : []);
    }
  } catch {
    // The default statuses remain available for lists created before status customization.
  }
  return [...new Set([...defaultStatuses, ...configured, ...(current ? [current] : [])])];
}
