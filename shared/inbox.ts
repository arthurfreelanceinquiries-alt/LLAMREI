export const INBOX_SOURCES = ['whatsapp', 'whatsapp_import', 'whatsapp_device', 'telegram_device', 'gmail'] as const;
export type InboxSource = typeof INBOX_SOURCES[number];

export interface InboxThread {
  id: string;
  source: InboxSource;
  title: string;
  preview: string;
  updatedAt: string;
  unread: boolean;
  contactId: string | null;
  followUpAt: string | null;
  note: string;
  revision: number;
}

export interface InboxMessage {
  id: string;
  sender: string;
  text: string;
  at: string;
  outbound: boolean;
}

export type InboxRemoteStatus = {
  state: 'unconfigured' | 'ready' | 'unavailable';
  lastSyncedAt: string | null;
  lastAttemptAt: string | null;
  lastOutcome: 'success' | 'failed' | 'unknown' | null;
};

export interface InboxSnapshot {
  threads: InboxThread[];
  gmail: InboxRemoteStatus;
  whatsapp: 'connected' | 'cached';
}

export interface InboxReceipt {
  id: string;
  body: string;
  scheduledAt: string;
  sentAt: string | null;
  state: 'pending' | 'queued' | 'sending' | 'sent' | 'manual' | 'handoff' | 'cancelled' | 'failed' | 'unknown';
}

export interface InboxDetail {
  thread: InboxThread;
  messages: InboxMessage[];
  receipts: InboxReceipt[];
}
