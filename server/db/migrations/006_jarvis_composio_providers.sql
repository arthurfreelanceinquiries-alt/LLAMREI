-- Migration 006: Jarvis Multi-Provider AI & Composio 150+ Apps Connections

CREATE TABLE IF NOT EXISTS composio_connections (
    id TEXT PRIMARY KEY,
    toolkit_slug TEXT NOT NULL,
    toolkit_name TEXT NOT NULL,
    auth_config_id TEXT,
    connected_account_id TEXT,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'active', 'expired', 'disconnected', 'failed')),
    redirect_url TEXT,
    account_label TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_composio_conn_slug ON composio_connections(toolkit_slug);

CREATE TABLE IF NOT EXISTS composio_tool_logs (
    id TEXT PRIMARY KEY,
    tool_slug TEXT NOT NULL,
    toolkit_slug TEXT NOT NULL,
    arguments_json TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL CHECK (status IN ('success', 'failed', 'pending_approval')),
    result_summary TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_composio_logs_created ON composio_tool_logs(created_at DESC);
