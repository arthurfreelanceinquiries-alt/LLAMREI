CREATE TABLE memory_entries (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('working','episodic','semantic','preference','procedural','prospective')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  tags_json TEXT NOT NULL,
  usable_by_assistant INTEGER NOT NULL DEFAULT 0 CHECK (usable_by_assistant IN (0, 1)),
  expires_at TEXT,
  updated_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  source_document_id TEXT REFERENCES workspace_docs(id) ON DELETE CASCADE,
  source_title TEXT,
  source_captured_at TEXT
);

CREATE INDEX memory_expiry_idx ON memory_entries(expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX memory_source_idx ON memory_entries(source_document_id);

CREATE VIRTUAL TABLE memory_search USING fts5(
  title, body, tags_json, content='memory_entries', content_rowid='rowid', tokenize='unicode61 remove_diacritics 2'
);
INSERT INTO memory_search(memory_search, rank) VALUES('secure-delete', 1);

CREATE TRIGGER memory_search_insert AFTER INSERT ON memory_entries BEGIN
  INSERT INTO memory_search(rowid, title, body, tags_json) VALUES (new.rowid, new.title, new.body, new.tags_json);
END;

CREATE TRIGGER memory_search_delete AFTER DELETE ON memory_entries BEGIN
  INSERT INTO memory_search(memory_search, rowid, title, body, tags_json)
  VALUES ('delete', old.rowid, old.title, old.body, old.tags_json);
END;

CREATE TRIGGER memory_search_update AFTER UPDATE OF title, body, tags_json ON memory_entries BEGIN
  INSERT INTO memory_search(memory_search, rowid, title, body, tags_json)
  VALUES ('delete', old.rowid, old.title, old.body, old.tags_json);
  INSERT INTO memory_search(rowid, title, body, tags_json) VALUES (new.rowid, new.title, new.body, new.tags_json);
END;

CREATE TABLE memory_embeddings (
  entry_id TEXT PRIMARY KEY REFERENCES memory_entries(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  model TEXT NOT NULL,
  vector BLOB NOT NULL
);

CREATE TRIGGER memory_embedding_invalidate AFTER UPDATE OF revision ON memory_entries BEGIN
  DELETE FROM memory_embeddings WHERE entry_id = old.id;
END;

ALTER TABLE chat_messages ADD COLUMN memory_refs_json TEXT;
