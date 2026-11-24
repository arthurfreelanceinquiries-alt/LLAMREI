-- Migration 005: Persistent WhatsApp Chat Threads & Messages Storage
CREATE TABLE IF NOT EXISTS wa_chat_threads (
    chat_jid TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    last_message TEXT NOT NULL DEFAULT '',
    last_timestamp TEXT NOT NULL DEFAULT '',
    unread_count INTEGER NOT NULL DEFAULT 0,
    is_group INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS wa_chat_messages (
    id TEXT PRIMARY KEY,
    chat_jid TEXT NOT NULL REFERENCES wa_chat_threads(chat_jid) ON DELETE CASCADE,
    sender_name TEXT NOT NULL,
    text TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    is_from_me INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_wa_messages_chat ON wa_chat_messages(chat_jid, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_wa_threads_updated ON wa_chat_threads(updated_at DESC);
