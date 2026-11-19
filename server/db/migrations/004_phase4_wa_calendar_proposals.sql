-- Migration 004: WhatsApp Detail Topics (Tugas, Skripsi, Rapat, Ajakan Pergi) & Calendar Event Proposal Gate

ALTER TABLE wa_tag_mentions ADD COLUMN topic_category TEXT NOT NULL DEFAULT 'umum';
ALTER TABLE wa_tag_mentions ADD COLUMN has_event_proposal INTEGER NOT NULL DEFAULT 0;
ALTER TABLE wa_tag_mentions ADD COLUMN proposed_event_title TEXT;
ALTER TABLE wa_tag_mentions ADD COLUMN proposed_event_start TEXT;
ALTER TABLE wa_tag_mentions ADD COLUMN proposed_event_end TEXT;
ALTER TABLE wa_tag_mentions ADD COLUMN proposed_event_location TEXT;
ALTER TABLE wa_tag_mentions ADD COLUMN proposal_status TEXT NOT NULL DEFAULT 'none';
ALTER TABLE wa_tag_mentions ADD COLUMN linked_calendar_event_id TEXT REFERENCES calendar_events(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_wa_tag_proposal ON wa_tag_mentions(has_event_proposal, proposal_status);
CREATE INDEX IF NOT EXISTS idx_wa_tag_topic ON wa_tag_mentions(topic_category);
