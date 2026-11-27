import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { getDb, wibOffsetIso } from '../db/connection.ts';
import { sseBus } from '../lib/sse.ts';
import { createStandaloneCalendarEvent, type CalendarEventRow } from './alarm-calendar.service.ts';

const MAX_ZIP_UNCOMPRESSED_BYTES = 10 * 1024 * 1024; // 10 MB anti-zip-bomb limit

export type WaTopicCategory = 'tugas_kuliah' | 'skripsi' | 'rapat_organisasi' | 'ajakan_pergi' | 'umum';
export type WaProposalStatus = 'none' | 'pending' | 'accepted' | 'declined';

export interface WaTagMentionRow {
  id: string;
  group_name: string;
  sender_display: string;
  message_timestamp: string;
  quoted_message: string;
  context_before: string | null;
  context_after: string | null;
  matched_alias: string;
  ai_intent: 'question' | 'task_request' | 'deadline' | 'info' | 'meeting_invite' | 'unclassified';
  ai_urgency: 'high' | 'medium' | 'low';
  replied_status: 'unreplied' | 'replied' | 'ignored';
  linked_task_id: string | null;
  content_hash: string;
  created_at: string;
  topic_category?: WaTopicCategory;
  has_event_proposal?: number;
  proposed_event_title?: string | null;
  proposed_event_start?: string | null;
  proposed_event_end?: string | null;
  proposed_event_location?: string | null;
  proposal_status?: WaProposalStatus;
  linked_calendar_event_id?: string | null;
}

interface ParsedChatLine {
  timestamp: string;
  sender: string;
  text: string;
}

/**
 * Masks Indonesian and international phone numbers (spaces, hyphens, dots, parens)
 * before any snippet is sent to an LLM.
 */
export function scrubPiiForLlm(text: string): string {
  return text
    .replace(/(?:\(?\+?62\)?|0)[\s.-]?8\d{1,3}(?:[\s.-]?\d{3,4}){2,3}/g, '[PHONE_REDACTED]')
    .replace(/\(\+\d{1,3}\)[\s.-]?\d{2,4}(?:[\s.-]?\d{3,5}){1,3}/g, '[PHONE_REDACTED]')
    .replace(/\+\d{1,3}[\s.-]?\d{6,12}/g, '[PHONE_REDACTED]')
    .replace(/\b\d{10,15}\b/g, '[PHONE_REDACTED]');
}

/**
 * Hardened pure-Node ZIP extractor for WhatsApp `.zip` exports with strict bounds checking
 * and `maxOutputLength` decompression cap (prevents zip bombs & OOB slices).
 */
export function extractTxtFromZipBuffer(zipBuf: Buffer): string {
  if (zipBuf.length < 22) {
    throw new Error('Berkas ZIP terlalu kecil atau rusak');
  }

  let eocdOffset = -1;
  for (let i = zipBuf.length - 22; i >= Math.max(0, zipBuf.length - 65558); i--) {
    if (zipBuf.readUInt32LE(i) === 0x06054b50) {
      const commentLen = zipBuf.readUInt16LE(i + 20);
      if (i + 22 + commentLen === zipBuf.length) {
        eocdOffset = i;
        break;
      }
    }
  }
  if (eocdOffset === -1) {
    throw new Error('Berkas ZIP tidak valid (EOCD tidak ditemukan)');
  }

  const cdOffset = zipBuf.readUInt32LE(eocdOffset + 16);
  const cdSize = zipBuf.readUInt32LE(eocdOffset + 12);
  const totalEntries = zipBuf.readUInt16LE(eocdOffset + 10);

  if (cdOffset === 0xffffffff || cdSize === 0xffffffff || totalEntries === 0xffff) {
    throw new Error('Format Zip64 tidak didukung');
  }
  if (cdOffset + cdSize > zipBuf.length || cdOffset > eocdOffset) {
    throw new Error('Header Central Directory ZIP di luar batas berkas');
  }

  let cursor = cdOffset;
  let totalDecompressed = 0;
  const txtParts: string[] = [];

  for (let idx = 0; idx < totalEntries; idx++) {
    if (cursor + 46 > zipBuf.length || zipBuf.readUInt32LE(cursor) !== 0x02014b50) break;
    const compressionMethod = zipBuf.readUInt16LE(cursor + 10);
    const compressedSize = zipBuf.readUInt32LE(cursor + 20);
    const uncompressedSize = zipBuf.readUInt32LE(cursor + 24);
    const fileNameLen = zipBuf.readUInt16LE(cursor + 28);
    const extraLen = zipBuf.readUInt16LE(cursor + 30);
    const commentLen = zipBuf.readUInt16LE(cursor + 32);
    const localHeaderOffset = zipBuf.readUInt32LE(cursor + 42);

    if (cursor + 46 + fileNameLen + extraLen + commentLen > zipBuf.length) {
      throw new Error('Entri Central Directory ZIP korup');
    }
    const fileName = zipBuf.subarray(cursor + 46, cursor + 46 + fileNameLen).toString('utf8');
    cursor += 46 + fileNameLen + extraLen + commentLen;

    if (!fileName.toLowerCase().endsWith('.txt') || fileName.includes('..')) continue;
    if (uncompressedSize > MAX_ZIP_UNCOMPRESSED_BYTES || totalDecompressed + uncompressedSize > MAX_ZIP_UNCOMPRESSED_BYTES) {
      throw new Error('Ukuran konten ZIP melebihi batas aman 10 MB');
    }
    if (localHeaderOffset + 30 > zipBuf.length || zipBuf.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
      throw new Error('Local header ZIP tidak valid');
    }

    const lhNameLen = zipBuf.readUInt16LE(localHeaderOffset + 26);
    const lhExtraLen = zipBuf.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + lhNameLen + lhExtraLen;
    if (dataStart + compressedSize > zipBuf.length) {
      throw new Error('Data terkompresi ZIP terpotong atau korup');
    }

    const compressedSlice = zipBuf.subarray(dataStart, dataStart + compressedSize);
    let outBuf: Buffer;
    if (compressionMethod === 0) {
      outBuf = compressedSlice;
    } else if (compressionMethod === 8) {
      const remaining = MAX_ZIP_UNCOMPRESSED_BYTES - totalDecompressed;
      if (remaining <= 0) {
        throw new Error('Zip bomb terdeteksi: hasil dekompresi melebihi 10 MB');
      }
      outBuf = zlib.inflateRawSync(compressedSlice, { maxOutputLength: remaining });
    } else {
      continue;
    }
    totalDecompressed += outBuf.length;
    if (totalDecompressed > MAX_ZIP_UNCOMPRESSED_BYTES) {
      throw new Error('Zip bomb terdeteksi: hasil dekompresi melebihi 10 MB');
    }
    txtParts.push(outBuf.toString('utf8'));
  }

  if (txtParts.length === 0) {
    throw new Error('Tidak ditemukan berkas .txt di dalam arsip ZIP ekspor WhatsApp');
  }
  return txtParts.join('\n');
}

const WA_LINE_PATTERNS: RegExp[] = [
  /^\[(\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4},?\s+\d{1,2}[:.]\d{2}(?:[:.]\d{2})?(?:\s?[APMapm]{2})?)\]\s+([^:]+):\s*(.*)$/,
  /^(\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4},?\s+\d{1,2}[:.]\d{2}(?:[:.]\d{2})?(?:\s?[APMapm]{2})?)\s+-\s+([^:]+):\s*(.*)$/,
];

const WA_SYSTEM_LINE_PATTERN = /^(\[?\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4},?\s+\d{1,2}[:.]\d{2}(?:[:.]\d{2})?(?:\s?[APMapm]{2})?\]?\s+-?\s*)/;

export function parseWhatsAppChatLines(rawText: string): ParsedChatLine[] {
  const lines = rawText.replace(/\r\n/g, '\n').split('\n');
  const parsed: ParsedChatLine[] = [];

  for (const rawLine of lines) {
    const cleanLine = rawLine.replace(/^\u200e+/, '').trim();
    if (!cleanLine) continue;

    let matched = false;
    for (const pattern of WA_LINE_PATTERNS) {
      const m = cleanLine.match(pattern);
      if (m) {
        parsed.push({ timestamp: m[1].trim(), sender: m[2].trim(), text: m[3].trim() });
        matched = true;
        break;
      }
    }

    if (!matched) {
      // Do not append WhatsApp system notifications (timestamped lines without a "sender:" prefix)
      if (WA_SYSTEM_LINE_PATTERN.test(cleanLine)) continue;
      if (parsed.length > 0) {
        parsed[parsed.length - 1].text += `\n${cleanLine}`;
      }
    }
  }

  return parsed;
}

export function classifyTagRuleBased(text: string): {
  intent: WaTagMentionRow['ai_intent'];
  urgency: WaTagMentionRow['ai_urgency'];
} {
  const lower = text.toLowerCase();
  if (/\b(deadline|paling lambat|sebelum jam|kumpul|due|bts)\b/i.test(lower)) {
    return { intent: 'deadline', urgency: 'high' };
  }
  if (/\b(tolong|cek|revisi|kirim|buatkan|kerjakan|upload|update)\b/i.test(lower)) {
    return { intent: 'task_request', urgency: 'high' };
  }
  if (text.includes('?') && /\b(gimana|kapan|berapa|apakah|sudahkah|dimana|kenapa)\b/i.test(lower)) {
    return { intent: 'question', urgency: 'medium' };
  }
  if (/\b(rapat|meeting|zoom|gmeet|bimbingan|ketemu|diskusi)\b/i.test(lower)) {
    return { intent: 'meeting_invite', urgency: 'medium' };
  }
  if (text.includes('?')) {
    return { intent: 'question', urgency: 'medium' };
  }
  return { intent: 'info', urgency: 'low' };
}

/**
 * Identifies detailed topic category (Tugas Kuliah, Skripsi, Rapat Organisasi, Ajakan Pergi/Nongkrong, Umum)
 */
export function detectTopicCategory(text: string, groupName: string): WaTopicCategory {
  const combined = `${groupName} ${text}`.toLowerCase();

  // 1. Skripsi S1
  if (
    /\b(skripsi|bab\s*[1-5]|bimbingan|fredella|dosen pembimbing|mra|spss|turnitin|kuesioner|olah data|semhas|sidang skripsi|sampel|hipotesis|variabel|metodologi|draf bab)\b/i.test(
      combined,
    )
  ) {
    return 'skripsi';
  }

  // 2. Rapat & Organisasi
  if (
    /\b(rapat|meeting|zoom|gmeet|bem|lk-feb|senat|himpunan|proker|panitia|evaluasi proker|notulensi|presidium|rundown|koordinasi divisi)\b/i.test(
      combined,
    )
  ) {
    return 'rapat_organisasi';
  }

  // 3. Tugas Kuliah
  if (
    /\b(tugas|tugas kelompok|pr|makalah|presentasi|kuis|uts|uas|lms|matkul|mata kuliah|dosen|kelompok|slide tugas|deadline tugas|kumpul tugas)\b/i.test(
      combined,
    )
  ) {
    return 'tugas_kuliah';
  }

  // 4. Ajakan Pergi / Nongkrong / Sosial
  if (
    /\b(nongkrong|ngopi|makan bareng|makan siang|makan malam|lunch|dinner|jalan yuk|pergi yuk|main yuk|nonton|locals tcg|main kartu|hangout|otw|ketemuan|ngumpul|kopi kenangan|starbucks|mall)\b/i.test(
      combined,
    )
  ) {
    return 'ajakan_pergi';
  }

  return 'umum';
}

/**
 * Parses event / meeting / study / hangout proposals from chat.
 * Strictly adheres to Arthur's gate: Proposed events are kept in 'pending' status
 * and ONLY enter the calendar after Arthur explicitly clicks 'Accept'.
 */
export function extractEventProposal(
  text: string,
  topic: WaTopicCategory,
  groupName: string,
  sender: string,
): {
  hasProposal: number;
  proposedTitle: string | null;
  proposedStart: string | null;
  proposedEnd: string | null;
  proposedLocation: string | null;
  proposalStatus: WaProposalStatus;
} {
  const lower = text.toLowerCase();

  const isInvite =
    topic === 'rapat_organisasi' ||
    topic === 'ajakan_pergi' ||
    /\b(rapat|meeting|zoom|gmeet|bimbingan|ketemuan|kumpul|nongkrong|ngopi|makan|lunch|dinner|jalan|diskusi|kerjain|sidang)\b/i.test(
      lower,
    );

  const timeMatch = lower.match(/(?:jam|pukul)\s*(\d{1,2})(?:[:.](\d{2}))?(?:\s*(pagi|siang|sore|malam))?/i);
  const dayMatch = lower.match(/\b(hari ini|besok|lusa|senin|selasa|rabu|kamis|jumat|sabtu|minggu|nanti malam|nanti sore|siang ini)\b/i);

  if (!isInvite && !timeMatch && !dayMatch) {
    return {
      hasProposal: 0,
      proposedTitle: null,
      proposedStart: null,
      proposedEnd: null,
      proposedLocation: null,
      proposalStatus: 'none',
    };
  }

  let dayOffset = 1; // default tomorrow
  if (dayMatch) {
    const dStr = dayMatch[1].toLowerCase();
    if (dStr === 'hari ini' || dStr === 'nanti malam' || dStr === 'nanti sore' || dStr === 'siang ini') {
      dayOffset = 0;
    } else if (dStr === 'besok') {
      dayOffset = 1;
    } else if (dStr === 'lusa') {
      dayOffset = 2;
    } else {
      const dayMap: Record<string, number> = { minggu: 0, senin: 1, selasa: 2, rabu: 3, kamis: 4, jumat: 5, sabtu: 6 };
      const targetDay = dayMap[dStr];
      if (targetDay !== undefined) {
        const todayDay = new Date().getDay();
        let diff = targetDay - todayDay;
        if (diff <= 0) diff += 7;
        dayOffset = diff;
      }
    }
  }

  let hour = 14;
  let minute = 0;
  if (timeMatch) {
    hour = Number.parseInt(timeMatch[1], 10);
    minute = timeMatch[2] ? Number.parseInt(timeMatch[2], 10) : 0;
    const period = timeMatch[3]?.toLowerCase();
    if (period === 'malam' && hour < 12) hour += 12;
    else if ((period === 'siang' || period === 'sore') && hour < 12 && hour >= 1 && hour <= 6) hour += 12;
  } else if (lower.includes('nanti malam')) {
    hour = 19;
    minute = 30;
  } else if (lower.includes('nanti sore')) {
    hour = 16;
    minute = 0;
  }

  const startIso = wibOffsetIso(dayOffset, hour, minute);
  const endHour = hour + (minute >= 30 ? 2 : 1);
  const endMinute = (minute + 30) % 60;
  const endIso = wibOffsetIso(dayOffset, endHour, endMinute);

  let location: string | null = null;
  const locMatch = lower.match(/(?:di|lewat|via)\s+(zoom|gmeet|google meet|kantin|kopi kenangan|starbucks|ruang bem|kampus|perpus|discord|lab)/i);
  if (locMatch) {
    location = locMatch[1].toUpperCase();
  }

  let proposedTitle = '';
  if (topic === 'rapat_organisasi') {
    const isProker = lower.includes('proker');
    const isEval = lower.includes('evaluasi');
    const qualifier = isEval ? 'Evaluasi' : isProker ? 'Proker' : 'Koordinasi';
    proposedTitle = `Rapat ${qualifier} ${groupName !== 'Personal Chat' ? `(${groupName})` : ''}`.trim();
  } else if (topic === 'skripsi') {
    proposedTitle = `Bimbingan Skripsi ${sender.toLowerCase().includes('fredella') ? 'Dr. Fredella' : ''}`.trim();
  } else if (topic === 'tugas_kuliah') {
    proposedTitle = `Kerja Tugas ${groupName !== 'Personal Chat' ? `(${groupName})` : `bareng ${sender}`}`.trim();
  } else if (topic === 'ajakan_pergi') {
    const isNgopi = lower.includes('ngopi') || lower.includes('kopi');
    const isMakan = lower.includes('makan') || lower.includes('lunch') || lower.includes('dinner');
    const verb = isNgopi ? 'Ngopi' : isMakan ? 'Makan Bareng' : 'Nongkrong';
    proposedTitle = `${verb} bareng ${sender}`;
  } else {
    proposedTitle = `Agenda dari WA: ${sender}`;
  }

  return {
    hasProposal: 1,
    proposedTitle,
    proposedStart: startIso,
    proposedEnd: endIso,
    proposedLocation: location,
    proposalStatus: 'pending',
  };
}

export async function importWhatsAppExport(input: {
  groupName: string;
  fileName: string;
  contentBase64?: string;
  rawText?: string;
  aliases?: string[];
}): Promise<{
  totalParsedMessages: number;
  matchedTags: number;
  insertedNew: number;
  skippedDuplicates: number;
  geminiCallsMade: number;
  mentions: WaTagMentionRow[];
}> {
  const db = getDb();
  let text = input.rawText ?? '';
  if (!text && input.contentBase64) {
    const buf = Buffer.from(input.contentBase64, 'base64');
    if (input.fileName.toLowerCase().endsWith('.zip')) {
      text = extractTxtFromZipBuffer(buf);
    } else {
      text = buf.toString('utf8');
    }
  }

  const lines = parseWhatsAppChatLines(text);
  const rawAliases = (input.aliases ?? []).map((a) => a.trim().toLowerCase()).filter((a) => a.length > 0);
  const aliases = rawAliases.length > 0 ? rawAliases : ['arthur', '@arthur', 'reezan', '312023002'];

  let matchedTags = 0;
  let insertedNew = 0;
  let skippedDuplicates = 0;

  const existsStmt = db.prepare('SELECT 1 FROM wa_tag_mentions WHERE content_hash = ?');
  const insertStmt = db.prepare(
    `INSERT OR IGNORE INTO wa_tag_mentions
     (id, group_name, sender_display, message_timestamp, quoted_message, context_before, context_after, matched_alias, ai_intent, ai_urgency, replied_status, content_hash, topic_category, has_event_proposal, proposed_event_title, proposed_event_start, proposed_event_end, proposed_event_location, proposal_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  for (let i = 0; i < lines.length; i++) {
    const msg = lines[i];
    const lowerText = msg.text.toLowerCase();
    const matchedAlias = aliases.find((a) => lowerText.includes(a));
    if (!matchedAlias) continue;

    matchedTags++;
    const hash = crypto
      .createHash('sha256')
      .update(`${input.groupName}|${msg.timestamp}|${msg.sender}|${msg.text}`)
      .digest('hex');

    if (existsStmt.get(hash)) {
      skippedDuplicates++;
      continue;
    }

    const before = lines
      .slice(Math.max(0, i - 2), i)
      .map((x) => `${x.sender}: ${x.text}`)
      .join('\n');
    const after = lines
      .slice(i + 1, Math.min(lines.length, i + 3))
      .map((x) => `${x.sender}: ${x.text}`)
      .join('\n');

    const repliedSoon = lines
      .slice(i + 1, Math.min(lines.length, i + 4))
      .some((x) => x.sender.toLowerCase().includes('arthur'));

    const classified = classifyTagRuleBased(msg.text);

    const topic = detectTopicCategory(msg.text, input.groupName);
    const proposal = extractEventProposal(msg.text, topic, input.groupName, msg.sender);

    const info = insertStmt.run(
      `watag_${crypto.randomUUID().slice(0, 8)}`,
      input.groupName,
      msg.sender,
      msg.timestamp,
      msg.text,
      before || null,
      after || null,
      matchedAlias,
      classified.intent,
      classified.urgency,
      repliedSoon ? 'replied' : 'unreplied',
      hash,
      topic,
      proposal.hasProposal,
      proposal.proposedTitle,
      proposal.proposedStart,
      proposal.proposedEnd,
      proposal.proposedLocation,
      proposal.proposalStatus,
    );

    if (Number(info.changes) > 0) insertedNew++;
    else skippedDuplicates++;
  }

  sseBus.emit('wa:imported', { groupName: input.groupName, insertedNew });
  return {
    totalParsedMessages: lines.length,
    matchedTags,
    insertedNew,
    skippedDuplicates,
    geminiCallsMade: 0,
    mentions: listWaTagMentions(),
  };
}

export function listWaTagMentions(): WaTagMentionRow[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT * FROM wa_tag_mentions
       ORDER BY CASE replied_status WHEN 'unreplied' THEN 0 WHEN 'replied' THEN 1 ELSE 2 END,
                CASE proposal_status WHEN 'pending' THEN 0 WHEN 'accepted' THEN 1 ELSE 2 END,
                CASE ai_urgency WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
                created_at DESC`,
    )
    .all() as unknown as WaTagMentionRow[];
}

export function updateWaTagMentionStatus(
  id: string,
  status: WaTagMentionRow['replied_status'],
  linkedTaskId?: string | null,
): WaTagMentionRow | null {
  const db = getDb();
  db.prepare(
    `UPDATE wa_tag_mentions
     SET replied_status = ?, linked_task_id = COALESCE(?, linked_task_id)
     WHERE id = ?`,
  ).run(status, linkedTaskId ?? null, id);
  return (db.prepare('SELECT * FROM wa_tag_mentions WHERE id = ?').get(id) as unknown as WaTagMentionRow) ?? null;
}

/**
 * Strict Acceptance Gate: Only when Arthur clicks Accept, the event is added to Calendar & Alarms
 */
export function acceptWaEventProposal(mentionId: string): { ok: boolean; event?: CalendarEventRow; error?: string } {
  const db = getDb();
  const mention = db.prepare('SELECT * FROM wa_tag_mentions WHERE id = ?').get(mentionId) as unknown as WaTagMentionRow | undefined;
  if (!mention) return { ok: false, error: 'Tag mention tidak ditemukan' };
  if (!mention.has_event_proposal || !mention.proposed_event_start) {
    return { ok: false, error: 'Tidak ada usulan agenda pada pesan ini' };
  }

  let color = '#00d992';
  let withHardAlarm = false;
  if (mention.topic_category === 'skripsi') {
    color = '#a855f7';
    withHardAlarm = true;
  } else if (mention.topic_category === 'rapat_organisasi') {
    color = '#3b82f6';
    withHardAlarm = true;
  } else if (mention.topic_category === 'ajakan_pergi') {
    color = '#ec4899';
    withHardAlarm = false;
  } else if (mention.topic_category === 'tugas_kuliah') {
    color = '#f59e0b';
    withHardAlarm = true;
  }

  const calEvent = createStandaloneCalendarEvent({
    title: mention.proposed_event_title || `Agenda: ${mention.group_name}`,
    startAt: mention.proposed_event_start,
    endAt: mention.proposed_event_end,
    source: 'local',
    color,
    notes: `Diterima dari WA [${mention.group_name}] oleh ${mention.sender_display}:\n"${mention.quoted_message}"`,
    withHardAlarm,
  });

  db.prepare(
    `UPDATE wa_tag_mentions
     SET proposal_status = 'accepted', linked_calendar_event_id = ?
     WHERE id = ?`,
  ).run(calEvent.id, mentionId);

  sseBus.emit('calendar:update', calEvent);
  sseBus.emit('wa:proposal_accepted', { mentionId, eventId: calEvent.id });

  return { ok: true, event: calEvent };
}

export function declineWaEventProposal(mentionId: string): { ok: boolean; error?: string } {
  const db = getDb();
  db.prepare(
    `UPDATE wa_tag_mentions
     SET proposal_status = 'declined'
     WHERE id = ?`,
  ).run(mentionId);

  sseBus.emit('wa:proposal_declined', { mentionId });
  return { ok: true };
}

export function updateWaEventProposal(
  mentionId: string,
  patch: { proposedTitle?: string; proposedStart?: string; proposedEnd?: string; proposedLocation?: string },
): { ok: boolean; mention?: WaTagMentionRow; error?: string } {
  const db = getDb();
  db.prepare(
    `UPDATE wa_tag_mentions
     SET proposed_event_title = COALESCE(?, proposed_event_title),
         proposed_event_start = COALESCE(?, proposed_event_start),
         proposed_event_end = COALESCE(?, proposed_event_end),
         proposed_event_location = COALESCE(?, proposed_event_location)
     WHERE id = ?`,
  ).run(
    patch.proposedTitle ?? null,
    patch.proposedStart ?? null,
    patch.proposedEnd ?? null,
    patch.proposedLocation ?? null,
    mentionId,
  );

  const updated = db.prepare('SELECT * FROM wa_tag_mentions WHERE id = ?').get(mentionId) as unknown as WaTagMentionRow;
  return { ok: true, mention: updated };
}
