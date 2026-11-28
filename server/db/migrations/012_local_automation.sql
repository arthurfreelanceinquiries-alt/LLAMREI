CREATE TABLE automation_rules (
  id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL,
  definition_json TEXT NOT NULL CHECK (json_valid(definition_json)),
  trigger_list_id TEXT,
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1))
);
CREATE INDEX automation_active_task_rules ON automation_rules(trigger_list_id) WHERE enabled = 1;

CREATE TABLE automation_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_id TEXT NOT NULL REFERENCES automation_rules(id),
  rule_revision INTEGER NOT NULL,
  rule_name TEXT NOT NULL,
  source_task_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'handled', 'skipped', 'failed')),
  next_attempt_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  reason TEXT
);
CREATE INDEX automation_pending_events ON automation_events(next_attempt_at, id) WHERE status = 'pending';

CREATE TRIGGER automation_task_completed
AFTER UPDATE OF status ON tasks
WHEN OLD.status <> 'Done' AND NEW.status = 'Done'
BEGIN
  INSERT INTO automation_events (rule_id, rule_revision, rule_name, source_task_id, created_at, next_attempt_at)
  SELECT id, revision, json_extract(definition_json, '$.name'), NEW.id, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM automation_rules WHERE enabled = 1 AND trigger_list_id = NEW.list_id;
END;

CREATE TABLE automation_missions (
  id TEXT PRIMARY KEY,
  rule_id TEXT NOT NULL REFERENCES automation_rules(id),
  rule_revision INTEGER NOT NULL,
  event_id INTEGER UNIQUE REFERENCES automation_events(id),
  request_id TEXT UNIQUE,
  source_task_id TEXT,
  definition_json TEXT NOT NULL CHECK (json_valid(definition_json)),
  status TEXT NOT NULL CHECK (status IN ('queued', 'waiting_approval', 'completed', 'cancelled', 'expired', 'failed')),
  step_index INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  deadline_at TEXT NOT NULL,
  run_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  reason TEXT,
  CHECK ((event_id IS NULL) <> (request_id IS NULL))
);
CREATE INDEX automation_queued_missions ON automation_missions(run_at, id) WHERE status = 'queued';
CREATE INDEX automation_open_missions ON automation_missions(deadline_at) WHERE status IN ('queued', 'waiting_approval');
CREATE INDEX automation_recent_missions ON automation_missions(created_at DESC);

CREATE TABLE automation_checkpoints (
  mission_id TEXT NOT NULL REFERENCES automation_missions(id) ON DELETE CASCADE,
  step_index INTEGER NOT NULL,
  approval_id TEXT UNIQUE,
  approval_expires_at TEXT,
  approved_at TEXT,
  finished_at TEXT,
  task_id TEXT,
  PRIMARY KEY (mission_id, step_index)
);
