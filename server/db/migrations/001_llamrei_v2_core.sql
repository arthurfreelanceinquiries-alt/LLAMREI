-- Llamrei Personal Dashboard v2.3 Core Schema
-- Covers: ClickUp Workspace, Goal Architecture, 2-Tier Task Alarms & Calendar,
-- Scheduled Messaging (Approve-Then-Auto-Send), NectarLink Phone Hub, Tailscale Sync,
-- Life OS Check-In / Tilt Guard / Habits, Market/News, and Agent Audit/Cost Ledger.

PRAGMA foreign_keys = ON;

-- 1. GOAL ARCHITECTURE (FR-50)
CREATE TABLE IF NOT EXISTS macro_goals (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    category TEXT NOT NULL CHECK (category IN ('academic', 'trading', 'organization', 'personal', 'financial')),
    target_date TEXT,
    target_metric_label TEXT,
    progress_percent INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'achieved', 'paused')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 2. CLICKUP HIERARCHY: SPACE -> FOLDER -> LIST -> TASK -> SUBTASK (FR-10..FR-18)
CREATE TABLE IF NOT EXISTS spaces (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#00d992',
    icon TEXT NOT NULL DEFAULT 'Briefcase',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS folders (
    id TEXT PRIMARY KEY,
    space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS lists (
    id TEXT PRIMARY KEY,
    space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
    folder_id TEXT REFERENCES folders(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    statuses_json TEXT NOT NULL DEFAULT '[{"id":"todo","name":"To Do","color":"#94a3b8","category":"open"},{"id":"in_progress","name":"In Progress","color":"#06b6d4","category":"active"},{"id":"review","name":"Review","color":"#f59e0b","category":"active"},{"id":"done","name":"Done","color":"#00d992","category":"closed"}]',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    list_id TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
    parent_task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
    goal_id TEXT REFERENCES macro_goals(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    description_md TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'To Do',
    priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('urgent', 'high', 'normal', 'low')),
    start_at TEXT,
    due_at TEXT,
    reminder_offsets_json TEXT NOT NULL DEFAULT '[15]',
    hard_alarm_enabled INTEGER NOT NULL DEFAULT 0,
    hard_alarm_at TEXT,
    time_estimate_minutes INTEGER NOT NULL DEFAULT 0,
    time_spent_seconds INTEGER NOT NULL DEFAULT 0,
    postponed_count INTEGER NOT NULL DEFAULT 0,
    auto_scheduled_block_start TEXT,
    auto_scheduled_block_end TEXT,
    tags_json TEXT NOT NULL DEFAULT '[]',
    checklist_json TEXT NOT NULL DEFAULT '[]',
    custom_fields_json TEXT NOT NULL DEFAULT '{}',
    attachments_json TEXT NOT NULL DEFAULT '[]',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tasks_list_status ON tasks(list_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_due_at ON tasks(due_at);
CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_task_id);

CREATE TABLE IF NOT EXISTS task_dependencies (
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    depends_on_task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    PRIMARY KEY (task_id, depends_on_task_id)
);

CREATE TABLE IF NOT EXISTS task_time_entries (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    duration_seconds INTEGER NOT NULL DEFAULT 0,
    note TEXT
);

-- 3. UNIFIED WEBSITE CALENDAR & 2-TIER ALARM ENGINE (FR-33..35, FR-60..65)
CREATE TABLE IF NOT EXISTS calendar_events (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL CHECK (source IN ('clickup_task', 'notion', 'google', 'scheduled_chat', 'local')),
    linked_task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
    external_id TEXT,
    title TEXT NOT NULL,
    start_at TEXT NOT NULL,
    end_at TEXT,
    all_day INTEGER NOT NULL DEFAULT 0,
    color TEXT NOT NULL DEFAULT '#00d992',
    has_hard_alarm INTEGER NOT NULL DEFAULT 0,
    location TEXT,
    notes TEXT,
    synced_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_calendar_start ON calendar_events(start_at);

CREATE TABLE IF NOT EXISTS task_alarms_reminders (
    id TEXT PRIMARY KEY,
    task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
    calendar_event_id TEXT REFERENCES calendar_events(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    subtitle TEXT,
    kind TEXT NOT NULL CHECK (kind IN ('soft_reminder', 'hard_alarm')),
    trigger_at TEXT NOT NULL,
    offset_minutes INTEGER NOT NULL DEFAULT 0,
    sound_preset TEXT NOT NULL DEFAULT 'tactical_pulse'
        CHECK (sound_preset IN ('tactical_pulse', 'siren_urgent', 'zen_chime', 'bell_classic')),
    ring_phone_nectarlink INTEGER NOT NULL DEFAULT 1,
    enabled INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'armed'
        CHECK (status IN ('armed', 'ringing', 'snoozed', 'dismissed', 'completed')),
    snooze_count INTEGER NOT NULL DEFAULT 0,
    snoozed_until TEXT,
    last_triggered_at TEXT,
    dismissed_from TEXT CHECK (dismissed_from IN ('web', 'android_widget', 'llamrei_agent')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_alarms_armed_trigger ON task_alarms_reminders(enabled, status, trigger_at);

-- 4. CONTACTS & APPROVE-THEN-AUTO-SEND SCHEDULED MESSAGES (FR-22..26)
CREATE TABLE IF NOT EXISTS contacts (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    aliases_json TEXT NOT NULL DEFAULT '[]',
    phone_e164 TEXT NOT NULL,
    telegram_chat_id TEXT,
    email TEXT,
    timezone TEXT NOT NULL DEFAULT 'Asia/Jakarta',
    active_hours_note TEXT,
    preferred_channel TEXT NOT NULL DEFAULT 'wa_gateway'
        CHECK (preferred_channel IN ('wa_gateway', 'nectarlink_bridge', 'wa_me_manual', 'telegram', 'email')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS scheduled_messages (
    id TEXT PRIMARY KEY,
    contact_id TEXT REFERENCES contacts(id) ON DELETE SET NULL,
    recipient_name TEXT NOT NULL,
    recipient_address TEXT NOT NULL,
    channel TEXT NOT NULL DEFAULT 'wa_gateway'
        CHECK (channel IN ('wa_gateway', 'nectarlink_bridge', 'wa_me_manual', 'telegram', 'email')),
    purpose TEXT NOT NULL,
    message_body TEXT NOT NULL,
    scheduled_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending_approval'
        CHECK (status IN (
            'pending_approval',
            'approved',
            'sending',
            'sent_auto',
            'reminded_fallback',
            'sent_manual_confirmed',
            'cancelled',
            'failed'
        )),
    approved_at TEXT,
    sent_at TEXT,
    gateway_response_json TEXT,
    linked_task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
    linked_event_id TEXT,
    created_by_prompt TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sched_msg_due ON scheduled_messages(status, scheduled_at);

-- 5. PHONE HUB (NECTARLINK), LIVE WA NOTIFICATIONS & TAILSCALE (FR-53..59, FR-66..69)
CREATE TABLE IF NOT EXISTS paired_devices (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    platform TEXT NOT NULL DEFAULT 'android',
    android_version TEXT DEFAULT 'Android 14',
    online INTEGER NOT NULL DEFAULT 0,
    link_type TEXT DEFAULT 'lan',
    lan_ip TEXT,
    tailscale_ip TEXT,
    tailscale_dns_name TEXT,
    active_transport TEXT NOT NULL DEFAULT 'lan'
        CHECK (active_transport IN ('lan', 'tailscale', 'offline_cache')),
    latency_ms INTEGER DEFAULT 4,
    battery_level INTEGER DEFAULT 84,
    battery_charging INTEGER NOT NULL DEFAULT 0,
    dnd_enabled INTEGER NOT NULL DEFAULT 0,
    auto_dnd_on_deepwork INTEGER NOT NULL DEFAULT 1,
    torch_enabled INTEGER NOT NULL DEFAULT 0,
    wifi_enabled INTEGER NOT NULL DEFAULT 1,
    bt_enabled INTEGER NOT NULL DEFAULT 1,
    hotspot_enabled INTEGER NOT NULL DEFAULT 0,
    phone_as_speaker INTEGER NOT NULL DEFAULT 0,
    play_on_phone INTEGER NOT NULL DEFAULT 0,
    phone_sound_on_pc INTEGER NOT NULL DEFAULT 0,
    media_title TEXT,
    media_artist TEXT,
    media_playing INTEGER NOT NULL DEFAULT 0,
    last_seen_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS phone_notifications (
    id TEXT PRIMARY KEY,
    device_id TEXT REFERENCES paired_devices(id) ON DELETE CASCADE,
    app_package TEXT NOT NULL,
    app_name TEXT NOT NULL,
    sender_or_title TEXT NOT NULL,
    conversation_group TEXT,
    body_text TEXT NOT NULL,
    otp_code TEXT,
    can_reply INTEGER NOT NULL DEFAULT 1,
    reply_action_id TEXT DEFAULT 'reply',
    is_mention_tag INTEGER NOT NULL DEFAULT 0,
    ai_intent TEXT,
    ai_urgency TEXT,
    replied_text TEXT,
    replied_at TEXT,
    linked_task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
    dismissed INTEGER NOT NULL DEFAULT 0,
    received_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_phone_notif_mention ON phone_notifications(is_mention_tag, dismissed, received_at);

CREATE TABLE IF NOT EXISTS device_timeline (
    id TEXT PRIMARY KEY,
    device_id TEXT,
    device_name TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('mirror_session', 'webcam_session', 'file', 'clip', 'link', 'photo', 'scan', 'reply', 'alarm')),
    direction TEXT NOT NULL CHECK (direction IN ('incoming', 'outgoing', 'session')),
    title TEXT NOT NULL,
    detail TEXT,
    target_path_or_url TEXT,
    linked_task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS mobile_sync_mutations (
    mutation_id TEXT PRIMARY KEY,
    device_id TEXT NOT NULL,
    action_type TEXT NOT NULL
        CHECK (action_type IN ('task_toggle_done', 'task_quick_create', 'alarm_dismiss', 'alarm_snooze', 'alarm_toggle')),
    target_id TEXT NOT NULL,
    payload_json TEXT NOT NULL DEFAULT '{}',
    client_timestamp TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 6. LIFE OS: 10S CHECK-IN, TILT GUARD & HABITS (FR-47..52)
CREATE TABLE IF NOT EXISTS daily_checkins (
    date_wib TEXT PRIMARY KEY,
    wake_time TEXT,
    sleep_hours REAL NOT NULL DEFAULT 7.0,
    energy_level INTEGER NOT NULL CHECK (energy_level BETWEEN 1 AND 5),
    mental_state TEXT NOT NULL CHECK (mental_state IN ('calm', 'focused', 'rushed', 'tilted', 'exhausted')),
    tilt_risk_level TEXT NOT NULL CHECK (tilt_risk_level IN ('low', 'moderate', 'high')),
    tilt_guard_advice TEXT,
    top_priority_note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS habits (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    icon TEXT NOT NULL DEFAULT 'CheckCircle',
    target_days_per_week INTEGER NOT NULL DEFAULT 5,
    current_streak INTEGER NOT NULL DEFAULT 0,
    best_streak INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS habit_logs (
    habit_id TEXT NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
    date_wib TEXT NOT NULL,
    completed INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (habit_id, date_wib)
);

-- 7. LLAMREI AGENT, AUDIT LOG & AI COST LEDGER (FR-01..08)
CREATE TABLE IF NOT EXISTS agent_audit_logs (
    id TEXT PRIMARY KEY,
    session_id TEXT,
    user_command TEXT NOT NULL,
    tool_name TEXT NOT NULL,
    tool_args_json TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending_approval', 'approved_executed', 'rejected', 'undone', 'failed')),
    undo_payload_json TEXT,
    executed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS chat_sessions (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS chat_messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool')),
    content TEXT NOT NULL,
    context_attachment_json TEXT,
    approval_card_json TEXT,
    model_used TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ai_usage_ledger (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    feature TEXT NOT NULL,
    prompt_tokens INTEGER NOT NULL,
    completion_tokens INTEGER NOT NULL,
    estimated_cost_usd REAL NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 8. NEWS, ECONOMIC CALENDAR & SETTINGS (FR-36..44)
CREATE TABLE IF NOT EXISTS news_articles (
    id TEXT PRIMARY KEY,
    source_name TEXT NOT NULL,
    category TEXT NOT NULL CHECK (category IN ('finance', 'forex', 'ai', 'crypto')),
    title TEXT NOT NULL,
    url TEXT NOT NULL UNIQUE,
    published_at TEXT NOT NULL,
    summary_raw TEXT,
    ai_summary TEXT,
    ai_topics_json TEXT DEFAULT '[]',
    is_saved INTEGER NOT NULL DEFAULT 0,
    fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS economic_events (
    id TEXT PRIMARY KEY,
    country TEXT NOT NULL,
    event_name TEXT NOT NULL,
    impact TEXT NOT NULL CHECK (impact IN ('high', 'medium', 'low')),
    scheduled_at TEXT NOT NULL,
    actual_val TEXT,
    forecast_val TEXT,
    previous_val TEXT,
    fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
