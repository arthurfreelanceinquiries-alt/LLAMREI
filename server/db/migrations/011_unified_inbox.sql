CREATE TABLE inbox_thread_state (
  id TEXT PRIMARY KEY,
  seen_message_id TEXT,
  contact_id TEXT REFERENCES contacts(id) ON DELETE SET NULL,
  follow_up_at TEXT,
  note TEXT NOT NULL DEFAULT '',
  revision INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE inbox_gmail_messages (
  account_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  sender TEXT NOT NULL,
  body TEXT NOT NULL,
  received_at TEXT NOT NULL,
  unread INTEGER NOT NULL CHECK (unread IN (0,1)),
  PRIMARY KEY (account_id, message_id)
);

CREATE INDEX inbox_gmail_thread_dates ON inbox_gmail_messages(account_id, thread_id, received_at DESC);
CREATE INDEX inbox_gmail_account_dates ON inbox_gmail_messages(account_id, received_at DESC);

CREATE TABLE inbox_gmail_sync (
  account_id TEXT PRIMARY KEY,
  last_synced_at TEXT,
  last_attempt_at TEXT NOT NULL,
  last_outcome TEXT NOT NULL CHECK (last_outcome IN ('success','failed','unknown'))
);

CREATE TABLE inbox_draft_requests (
  request_id TEXT PRIMARY KEY,
  payload_hash TEXT NOT NULL,
  scheduled_id TEXT NOT NULL REFERENCES scheduled_messages(id) ON DELETE CASCADE
);
