import test from 'node:test';
import assert from 'node:assert/strict';
import {
  detectTopicCategory,
  extractEventProposal,
  acceptWaEventProposal,
  declineWaEventProposal,
} from '../services/wa-export.service.ts';
import { getDb } from '../db/connection.ts';
import { listCalendarEvents } from '../services/alarm-calendar.service.ts';

test('WA Topic Detection: Identifies Tugas, Skripsi, Rapat Organisasi & Ajakan Pergi', () => {
  // 1. Tugas Kuliah
  const t1 = detectTopicCategory('Guys jangan lupa tugas kelompok presentasi dikumpul jumat', 'Kelas Riset');
  assert.equal(t1, 'tugas_kuliah');

  // 2. Skripsi
  const t2 = detectTopicCategory('Draf Bab 4 sudah saya revisi, siap bimbingan dengan Dr. Fredella', 'Skripsi');
  assert.equal(t2, 'skripsi');

  // 3. Rapat Organisasi
  const t3 = detectTopicCategory('Rapat evaluasi proker BEM jam 16.00 di ruang rapat', 'BEM FEB UKRIDA');
  assert.equal(t3, 'rapat_organisasi');

  // 4. Ajakan Pergi / Hangout
  const t4 = detectTopicCategory('Art, nanti malam jam 19.30 ngopi santai yuk di Kopi Kenangan', 'Personal Chat');
  assert.equal(t4, 'ajakan_pergi');
});

test('WA Event Proposal Extraction & Strict Calendar Acceptance Gate', () => {
  const db = getDb();
  const text = '@Arthur besok jam 16.00 ada rapat evaluasi proker BEM di Ruang BEM ya';
  const topic = detectTopicCategory(text, 'BEM FEB UKRIDA');
  assert.equal(topic, 'rapat_organisasi');

  const proposal = extractEventProposal(text, topic, 'BEM FEB UKRIDA', 'Kevin');
  assert.equal(proposal.hasProposal, 1);
  assert.equal(proposal.proposalStatus, 'pending');
  assert.ok(proposal.proposedStart);
  assert.ok(proposal.proposedTitle?.includes('Rapat'));

  // Insert mock mention with this pending proposal
  const mentionId = `watag_test_${Date.now()}`;
  db.prepare(
    `INSERT INTO wa_tag_mentions
     (id, group_name, sender_display, message_timestamp, quoted_message, matched_alias, ai_intent, ai_urgency, replied_status, content_hash, topic_category, has_event_proposal, proposed_event_title, proposed_event_start, proposed_event_end, proposed_event_location, proposal_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    mentionId,
    'BEM FEB UKRIDA',
    'Kevin',
    new Date().toISOString(),
    text,
    '@Arthur',
    'meeting_invite',
    'high',
    'unreplied',
    `hash_test_${Date.now()}`,
    topic,
    proposal.hasProposal,
    proposal.proposedTitle,
    proposal.proposedStart,
    proposal.proposedEnd,
    proposal.proposedLocation,
    proposal.proposalStatus,
  );

  // Verification 1: Event must NOT be in calendar before explicit acceptance
  const initialEvents = listCalendarEvents();
  assert.ok(!initialEvents.some((e) => e.notes?.includes(mentionId)));

  // Verification 2: Decline proposal test
  const declineRes = declineWaEventProposal(mentionId);
  assert.equal(declineRes.ok, true);
  let row = db.prepare('SELECT proposal_status FROM wa_tag_mentions WHERE id = ?').get(mentionId) as { proposal_status: string };
  assert.equal(row.proposal_status, 'declined');

  // Reset to pending and test ACCEPT
  db.prepare("UPDATE wa_tag_mentions SET proposal_status = 'pending' WHERE id = ?").run(mentionId);
  const acceptRes = acceptWaEventProposal(mentionId);
  assert.equal(acceptRes.ok, true);
  assert.ok(acceptRes.event?.id);

  // Verification 3: Event is now in calendar with topic color
  const acceptedRow = db.prepare('SELECT proposal_status, linked_calendar_event_id FROM wa_tag_mentions WHERE id = ?').get(mentionId) as { proposal_status: string; linked_calendar_event_id: string };
  assert.equal(acceptedRow.proposal_status, 'accepted');
  assert.equal(acceptedRow.linked_calendar_event_id, acceptRes.event.id);

  const updatedEvents = listCalendarEvents();
  const addedEvent = updatedEvents.find((e) => e.id === acceptRes.event?.id);
  assert.ok(addedEvent);
  assert.equal(addedEvent.title, proposal.proposedTitle);
  assert.equal(addedEvent.color, '#3b82f6'); // Blue for rapat_organisasi
});
