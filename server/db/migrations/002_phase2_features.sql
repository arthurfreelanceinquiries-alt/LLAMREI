-- Fase 2 Migration: WhatsApp Export Tag Inbox, Recurring Tasks, Templates & Safe App Launchers

ALTER TABLE tasks ADD COLUMN recurrence_rule TEXT NOT NULL DEFAULT 'none'
  CHECK (recurrence_rule IN ('none', 'daily', 'weekdays', 'weekly', 'monthly'));

CREATE TABLE IF NOT EXISTS wa_tag_mentions (
    id TEXT PRIMARY KEY,
    group_name TEXT NOT NULL,
    sender_display TEXT NOT NULL,
    message_timestamp TEXT NOT NULL,
    quoted_message TEXT NOT NULL,
    context_before TEXT,
    context_after TEXT,
    matched_alias TEXT NOT NULL,
    ai_intent TEXT CHECK (ai_intent IN ('question', 'task_request', 'deadline', 'info', 'meeting_invite', 'unclassified')),
    ai_urgency TEXT CHECK (ai_urgency IN ('high', 'medium', 'low')),
    replied_status TEXT NOT NULL DEFAULT 'unreplied' CHECK (replied_status IN ('unreplied', 'replied', 'ignored')),
    linked_task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
    content_hash TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_wa_tag_status ON wa_tag_mentions(replied_status, ai_urgency);

CREATE TABLE IF NOT EXISTS task_templates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    tasks_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS app_launchers (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    command_key TEXT NOT NULL,
    icon TEXT NOT NULL DEFAULT '🚀',
    description TEXT
);

-- Seed default templates & safe app launchers
INSERT OR IGNORE INTO task_templates (id, name, category, tasks_json) VALUES
  ('tpl_premarket', 'Pre-Market Routine (London/NY)', 'trading', '[{"title":"Cek Kalender Ekonomi (CPI/NFP/FOMC)","priority":"high","estimate":15,"hardAlarm":true},{"title":"Tandai Level Likuiditas XAUUSD & DXY H4","priority":"high","estimate":20,"hardAlarm":false},{"title":"Isi 10s Morning Check-In & Tilt Guard","priority":"urgent","estimate":5,"hardAlarm":false}]'),
  ('tpl_skripsi_bab', 'Checklist Penyusunan Bab Skripsi', 'academic', '[{"title":"Kumpulkan minimal 5 referensi jurnal terindeks","priority":"high","estimate":45,"hardAlarm":false},{"title":"Susun draf analisis & tabel APA","priority":"urgent","estimate":90,"hardAlarm":true},{"title":"Kirim draf ke Dr. Fredella & jadwalkan bimbingan","priority":"high","estimate":20,"hardAlarm":false}]');

INSERT OR IGNORE INTO app_launchers (id, label, command_key, icon, description) VALUES
  ('launch_antigravity', 'Antigravity IDE', 'antigravity', '⚡', 'Buka jendela Antigravity lokal (tanpa membungkus/menyadap token)'),
  ('launch_terminal', 'Terminal Linux', 'x-terminal-emulator', '💻', 'Buka terminal sistem'),
  ('launch_nectarlink', 'NectarLink Desktop', 'nectarlink', '📱', 'Buka jendela NectarLink untuk Mirror Screen 60fps'),
  ('launch_obsidian', 'Obsidian Vault', 'obsidian', '🧠', 'Buka catatan Second Brain di Obsidian');
