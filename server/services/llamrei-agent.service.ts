import { getDb, todayWibIsoDate, wibOffsetIso } from '../db/connection.ts';
import { sseBus } from '../lib/sse.ts';
import {
  getAiBudgetSummary,
  getAiSettingsSnapshot,
  invokeAiWithFallback,
  type AiInvocationOptions,
  type UnifiedMessage,
  type UnifiedToolDef,
} from './ai-provider.service.ts';
import {
  createOrUpdateHardAlarm,
  createStandaloneCalendarEvent,
  getNextArmedAlarm,
  listAlarmsAndReminders,
  listCalendarEvents,
} from './alarm-calendar.service.ts';
import {
  executeComposioTool,
  getActiveComposioToolsForAgent,
  getComposioState,
  isReadOnlyComposioTool,
  summarizeToolResult,
} from './composio.service.ts';
import { computeAutoScheduleForToday, getRealDataKpis } from './lifeos.service.ts';
import { getMarketAndNewsFeed } from './market.service.ts';
import {
  getPhoneHubState,
  replyPhoneNotification,
  ringPhone,
  setPhoneControlToggle,
} from './nectarlink.service.ts';
import {
  approveScheduledMessage,
  createScheduledMessageDraft,
  findContactByNameOrAlias,
  listScheduledMessages,
  updateScheduledMessageStatus,
} from './scheduler.service.ts';
import { getTradingJournalState } from './trading-journal.service.ts';
import { listWaTagMentions, scrubPiiForLlm } from './wa-export.service.ts';
import {
  createTask,
  deleteTask,
  getWeeklyBottleneckReport,
  getWorkspaceSnapshot,
  updateTask,
} from './workspace.service.ts';

export { getAiBudgetSummary };

export interface ApprovalCardData {
  auditId: string;
  toolName: string;
  title: string;
  summary: string;
  status: 'pending_approval' | 'approved_executed' | 'rejected' | 'undone';
  args: Record<string, unknown>;
  scheduledMessageId?: string;
  waMeUrl?: string;
}

export interface ChatMessageRow {
  id: string;
  session_id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  context_attachment_json: string | null;
  approval_card_json: string | null;
  model_used: string | null;
  created_at: string;
}

export interface AuditLogRow {
  id: string;
  session_id: string | null;
  user_command: string;
  tool_name: string;
  tool_args_json: string;
  status: 'pending_approval' | 'approved_executed' | 'rejected' | 'undone' | 'failed';
  undo_payload_json: string | null;
  executed_at: string | null;
  created_at: string;
}

export function listChatMessages(sessionId = 'sess_main'): ChatMessageRow[] {
  const db = getDb();
  return db
    .prepare('SELECT * FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC, rowid ASC')
    .all(sessionId) as unknown as ChatMessageRow[];
}

export function listAuditLogs(): AuditLogRow[] {
  const db = getDb();
  return db
    .prepare('SELECT * FROM agent_audit_logs ORDER BY created_at DESC, rowid DESC LIMIT 40')
    .all() as unknown as AuditLogRow[];
}

export function buildMorningBriefingText(): string {
  const kpis = getRealDataKpis();
  const ws = getWorkspaceSnapshot();
  const nextAlarm = getNextArmedAlarm();
  const phone = getPhoneHubState();
  const msgs = listScheduledMessages().filter((m) => m.status === 'pending_approval' || m.status === 'approved');
  const market = getMarketAndNewsFeed();
  const today = todayWibIsoDate();

  const openUrgent = ws.tasks.filter((t) => !t.parent_task_id && t.status !== 'Done').slice(0, 4);
  const todayEcon = (market.economicEvents as Array<{ country: string; event_name: string; impact: string; scheduled_at: string }>).filter((e) =>
    e.scheduled_at.startsWith(today),
  );
  const unreadTags = phone.notifications.filter((n) => n.is_mention_tag === 1 && !n.replied_at);

  const lines: string[] = [
    `**MORNING BRIEFING JARVIS // LLAMREI (${today})**`,
    `- **Kesiapan & Tilt Guard:** ${
      kpis.todayCheckIn
        ? `Tidur ${kpis.todayCheckIn.sleep_hours}j · Energi ${kpis.todayCheckIn.energy_level}/5 · Risiko **${kpis.todayCheckIn.tilt_risk_level.toUpperCase()}**. ${kpis.todayCheckIn.tilt_guard_advice ?? ''}`
        : 'Belum mengisi 10s Check-In pagi ini — isi di bar atas untuk mengaktifkan Tilt Guard.'
    }`,
    `- **KPI Eksekusi Nyata:** ${kpis.executionScorePercent}% tugas selesai (${kpis.completedTasks}/${kpis.totalTasks}) · Deep Work: ${kpis.deepWorkHoursTotal} jam · Habit hari ini: ${kpis.habitCompletionPercent}%.`,
    `- **Alarm Berikutnya:** ${nextAlarm ? `${nextAlarm.title} (${nextAlarm.trigger_at})` : 'Tidak ada alarm bersenjata.'}`,
    `- **Tugas ClickUp Prioritas:** ${
      openUrgent.map((t) => `[${t.priority.toUpperCase()}] ${t.title}`).join(' | ') || 'Semua tugas beres.'
    }`,
    `- **Antrean Chat Terjadwal:** ${msgs.length} pesan (${msgs.filter((m) => m.status === 'pending_approval').length} menunggu Approval Anda).`,
    `- **Phone Hub (NectarLink):** ${phone.devices[0]?.name ?? 'HP'} baterai ${phone.devices[0]?.battery_level ?? 0}% · ${unreadTags.length} mention WhatsApp belum dibalas.`,
    `- **Kalender Ekonomi Hari Ini:** ${
      todayEcon.map((e) => `[${e.impact.toUpperCase()} ${e.country}] ${e.event_name}`).join(' | ') || 'Tidak ada rilis besar hari ini.'
    }`,
  ];
  return lines.join('\n');
}

function parseIndonesianTimeToIso(text: string): string {
  const now = new Date();
  const isTomorrow = /\bbesok\b/i.test(text);
  const dayOffset = isTomorrow ? 1 : 0;

  const minMatch = text.match(/(\d+)\s*menit\s*(lagi|dari sekarang)/i);
  if (minMatch) {
    return new Date(now.getTime() + Number(minMatch[1]) * 60_000).toISOString();
  }

  const timeMatch = text.match(/(?:jam|pukul|at|@)\s*(\d{1,2})(?:[:.](\d{2}))?/i);
  if (timeMatch) {
    const h = Math.min(23, Math.max(0, Number(timeMatch[1])));
    const m = Math.min(59, Math.max(0, Number(timeMatch[2] ?? 0)));
    return wibOffsetIso(dayOffset, h, m);
  }

  return wibOffsetIso(dayOffset, Math.min(22, now.getHours() + 1), 0);
}

function createPendingApprovalAudit(params: {
  sessionId: string;
  userCommand: string;
  toolName: string;
  title: string;
  summary: string;
  args: Record<string, unknown>;
  scheduledMessageId?: string;
  waMeUrl?: string;
}): ApprovalCardData {
  const db = getDb();
  const auditId = `aud_${crypto.randomUUID().slice(0, 8)}`;
  db.prepare(
    `INSERT INTO agent_audit_logs (id, session_id, user_command, tool_name, tool_args_json, status)
     VALUES (?, ?, ?, ?, ?, 'pending_approval')`,
  ).run(auditId, params.sessionId, params.userCommand, params.toolName, JSON.stringify(params.args));

  return {
    auditId,
    toolName: params.toolName,
    title: params.title,
    summary: params.summary,
    status: 'pending_approval',
    args: params.args,
    scheduledMessageId: params.scheduledMessageId,
    waMeUrl: params.waMeUrl,
  };
}

function buildSystemPrompt(): string {
  const kpis = getRealDataKpis();
  const ws = getWorkspaceSnapshot();
  const phone = getPhoneHubState();
  const bottleneck = getWeeklyBottleneckReport();
  const aiCfg = getAiSettingsSnapshot();
  const composio = getComposioState();
  const activeApps = composio.connections.filter((c) => c.status === 'active').map((c) => c.toolkit_name);

  const identityLine =
    aiCfg.assistantPersona === 'jarvis'
      ? 'Kamu adalah JARVIS (identitas co-commander dari sistem LLAMREI), asisten personal cerdas milik Arthur Reezan (mahasiswa akhir FEB UKRIDA NIM 312023002 & trader aktif).'
      : 'Kamu adalah LLAMREI (Co-Commander / Jarvis OS), asisten personal milik Arthur Reezan (mahasiswa akhir FEB UKRIDA NIM 312023002 & trader aktif).';

  return [
    identityLine,
    'ATURAN ANTI-GENERIK (FR-52): Jangan pernah memberi saran motivasi klise atau normatif. Selalu rujuk data nyata Arthur dari tool/konteks.',
    'ATURAN KEAMANAN & APPROVAL GATE: Jangan mengarang angka pasar atau KPI. Aksi tulis/kirim (buat tugas, pasang alarm, kirim chat/email, ubah kalender eksternal) otomatis meminta persetujuan via Approval Card.',
    'MULTI-STEP REASONING: Kamu boleh memanggil tool baca (list tugas, cek kalender, cek WA, cek trading journal, atau tool Composio READ) beberapa kali sebelum menjawab.',
    `KONTEKS NYATA: Execution=${kpis.executionScorePercent}%, DeepWork=${kpis.deepWorkHoursTotal}h, TiltRisk=${kpis.todayCheckIn?.tilt_risk_level ?? 'unknown'}, Lists=${ws.lists.map((l) => `${l.id}:${l.name}`).join(', ')}, Bottleneck="${bottleneck.summaryAdvice}", Phone=${phone.devices[0]?.name ?? 'none'} (${phone.devices[0]?.battery_level ?? 0}%), ComposioConnectedApps=[${activeApps.join(', ') || 'belum ada'}].`,
    'Jawab dalam Bahasa Indonesia yang ringkas, tajam, dan terstruktur.',
  ].join('\n');
}

const LOCAL_TOOLS: UnifiedToolDef[] = [
  {
    name: 'get_morning_briefing_data',
    description: 'Membaca ringkasan lengkap hari ini: Tilt Guard, KPI tugas, alarm berikutnya, notifikasi HP, dan kalender ekonomi.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'list_clickup_tasks',
    description: 'Membaca daftar tugas ClickUp lokal (bisa filter status, priority, atau kata kunci search).',
    parameters: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'Filter status mis. To Do, In Progress, Review, Done' },
        priority: { type: 'string', description: 'urgent, high, normal, low' },
        search: { type: 'string', description: 'Kata kunci judul tugas' },
      },
    },
  },
  {
    name: 'list_calendar_and_alarms',
    description: 'Membaca agenda kalender dan daftar alarm/reminder aktif.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'list_wa_mentions_and_proposals',
    description: 'Membaca mention WhatsApp yang belum dibalas dan usulan agenda kalender yang menunggu persetujuan.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'get_trading_journal_summary',
    description: 'Membaca statistik jurnal trading (win rate, total R-multiple, net PnL, pola emosi calm vs tilt).',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'schedule_outbound_chat',
    description: 'Menyiapkan draf & jadwal pesan keluar (WhatsApp/Telegram) untuk disetujui Arthur di Approval Card.',
    parameters: {
      type: 'object',
      properties: {
        recipientName: { type: 'string' },
        purpose: { type: 'string' },
        messageBody: { type: 'string' },
        scheduledAtIso: { type: 'string' },
      },
      required: ['recipientName', 'purpose', 'messageBody', 'scheduledAtIso'],
    },
  },
  {
    name: 'create_clickup_task',
    description: 'Membuat tugas baru di ruang kerja ClickUp beserta tenggat, jadwal kalender, dan opsi Hard Alarm.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        listId: { type: 'string' },
        priority: { type: 'string', enum: ['urgent', 'high', 'normal', 'low'] },
        dueAtIso: { type: 'string' },
        hardAlarm: { type: 'boolean' },
        subtasks: { type: 'array', items: { type: 'string' } },
      },
      required: ['title'],
    },
  },
  {
    name: 'set_task_alarm_and_calendar',
    description: 'Memasang Hard Alarm & blok Kalender Website pada waktu tertentu.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        triggerAtIso: { type: 'string' },
        taskId: { type: 'string' },
      },
      required: ['title', 'triggerAtIso'],
    },
  },
  {
    name: 'auto_schedule_clickup_day',
    description: 'Menyusun blok jadwal tugas ClickUp hari ini gaya Motion, menghindari rapat & rilis CPI/FOMC.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'control_paired_phone',
    description: 'Mengontrol HP Android via NectarLink (dnd_on, dnd_off, find_phone).',
    parameters: {
      type: 'object',
      properties: { action: { type: 'string', enum: ['dnd_on', 'dnd_off', 'find_phone'] } },
      required: ['action'],
    },
  },
];

const LOCAL_READ_ONLY_TOOLS = new Set([
  'get_morning_briefing_data',
  'list_clickup_tasks',
  'list_calendar_and_alarms',
  'list_wa_mentions_and_proposals',
  'get_trading_journal_summary',
]);

async function executeReadOnlyTool(
  name: string,
  args: Record<string, unknown>,
  fetchImpl?: typeof fetch,
): Promise<string> {
  if (name === 'get_morning_briefing_data') {
    return buildMorningBriefingText();
  }
  if (name === 'list_clickup_tasks') {
    const ws = getWorkspaceSnapshot();
    const statusFilter = typeof args.status === 'string' ? args.status.toLowerCase() : null;
    const prioFilter = typeof args.priority === 'string' ? args.priority.toLowerCase() : null;
    const searchFilter = typeof args.search === 'string' ? args.search.toLowerCase() : null;
    const filtered = ws.tasks
      .filter((t) => !t.parent_task_id)
      .filter((t) => !statusFilter || t.status.toLowerCase() === statusFilter)
      .filter((t) => !prioFilter || t.priority.toLowerCase() === prioFilter)
      .filter((t) => !searchFilter || t.title.toLowerCase().includes(searchFilter))
      .slice(0, 15)
      .map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        priority: t.priority,
        due_at: t.due_at,
        hard_alarm: Boolean(t.hard_alarm_enabled),
      }));
    return JSON.stringify({ count: filtered.length, tasks: filtered });
  }
  if (name === 'list_calendar_and_alarms') {
    const events = listCalendarEvents().slice(0, 15).map((e) => ({
      id: e.id,
      title: e.title,
      start_at: e.start_at,
      source: e.source,
    }));
    const alarms = listAlarmsAndReminders()
      .filter((a) => a.enabled === 1)
      .slice(0, 12)
      .map((a) => ({ id: a.id, title: a.title, kind: a.kind, trigger_at: a.trigger_at, status: a.status }));
    return JSON.stringify({ events, alarms });
  }
  if (name === 'list_wa_mentions_and_proposals') {
    const mentions = listWaTagMentions()
      .slice(0, 12)
      .map((m) => ({
        id: m.id,
        group: m.group_name,
        sender: m.sender_display,
        topic: m.topic_category,
        urgency: m.ai_urgency,
        replied: m.replied_status,
        proposal: m.has_event_proposal ? { title: m.proposed_event_title, start: m.proposed_event_start, status: m.proposal_status } : null,
        text: scrubPiiForLlm(m.quoted_message.slice(0, 180)),
      }));
    return JSON.stringify({ mentions });
  }
  if (name === 'get_trading_journal_summary') {
    const j = getTradingJournalState();
    return JSON.stringify({ stats: j.stats, recentEntries: j.entries.slice(0, 5) });
  }
  if (name.startsWith('composio__')) {
    const slug = name.replace(/^composio__/, '');
    const res = await executeComposioTool(slug, args, fetchImpl);
    return summarizeToolResult(res);
  }
  return JSON.stringify({ error: `Unknown read-only tool: ${name}` });
}

function runLocalDeterministicRouter(
  prompt: string,
  sessionId: string,
  contextAttachment?: Record<string, unknown> | null,
): { reply: string; approvalCard: ApprovalCardData | null } {
  const lower = prompt.toLowerCase();
  const ws = getWorkspaceSnapshot();

  // 1. Scheduled Chat intent ("jadwalkan chat ke X jam Y soal Z")
  if (/\b(jadwalkan|schedule|kirim|chat|wa|whatsapp)\b/i.test(lower) && /\b(ke|to|sama)\b/i.test(lower)) {
    const toMatch = prompt.match(/(?:ke|to)\s+([A-Za-z0-9._\s]+?)(?=\s+(?:jam|pukul|besok|hari|soal|tentang|untuk|\d)|$)/i);
    const rawRecipient = (toMatch?.[1] ?? 'Raka').trim();
    const contact = findContactByNameOrAlias(rawRecipient);
    const recipientName = contact?.name ?? rawRecipient;
    const recipientAddress = contact?.phone_e164 ?? '6281200000000';
    const scheduledAt = parseIndonesianTimeToIso(prompt);

    const topicMatch = prompt.match(/(?:soal|tentang|mengenai|ingatkan|untuk)\s+(.+)$/i);
    const purpose = (topicMatch?.[1] ?? 'Tindak lanjut jadwal').trim();
    const messageBody = `Halo ${recipientName}, izin mengingatkan terkait ${purpose}. Kabari ya jika sudah siap. Terima kasih!`;

    const draft = createScheduledMessageDraft({
      contactId: contact?.id ?? null,
      recipientName,
      recipientAddress,
      channel: contact?.preferred_channel ?? 'nectarlink_bridge',
      purpose,
      messageBody,
      scheduledAt,
      createdByPrompt: prompt,
    });

    const card = createPendingApprovalAudit({
      sessionId,
      userCommand: prompt,
      toolName: 'schedule_outbound_chat',
      title: `Jadwal Chat → ${recipientName}`,
      summary: `Waktu: ${scheduledAt} · Channel: ${draft.channel} · Pesan: "${messageBody}"`,
      args: { scheduledMessageId: draft.id, recipientName, scheduledAt, messageBody },
      scheduledMessageId: draft.id,
      waMeUrl: draft.waMeUrl,
    });

    return {
      reply: `Siap. Saya sudah menyiapkan draf pesan ke **${recipientName}** untuk pukul **${scheduledAt}**. Silakan cek dan klik **Approve & Jadwalkan** pada kartu di bawah agar masuk antrean auto-send (tersedia juga tombol fallback \`wa.me\`).`,
      approvalCard: card,
    };
  }

  // 2. Morning Briefing
  if (/briefing|ringkasan pagi|apa jadwal|status hari ini/i.test(lower)) {
    return { reply: buildMorningBriefingText(), approvalCard: null };
  }

  // 3. Auto-Schedule Day (Motion-style)
  if (/auto.?schedule|susun jadwal|atur jadwal/i.test(lower)) {
    const plan = computeAutoScheduleForToday(false);
    const card = createPendingApprovalAudit({
      sessionId,
      userCommand: prompt,
      toolName: 'auto_schedule_clickup_day',
      title: `Auto-Schedule ${plan.proposals.length} Tugas ClickUp Hari Ini`,
      summary: plan.proposals.map((p) => `• ${p.title} (${p.blockStart.slice(11, 16)}–${p.blockEnd.slice(11, 16)})`).join('\n'),
      args: { proposals: plan.proposals },
    });
    return {
      reply: `Saya menyusun **${plan.proposals.length} blok Deep Work** di luar jam rapat Notion dan ±30 menit sekitar rilis High-Impact. Setujui kartu di bawah untuk menerapkannya ke Kalender Website & Reminder.`,
      approvalCard: card,
    };
  }

  // 4. Hard Alarm & Calendar
  if (/\b(alarm|ingatkan|pasang alarm)\b/i.test(lower)) {
    const triggerAt = parseIndonesianTimeToIso(prompt);
    const cleanTitle =
      prompt
        .replace(/^(llamrei|jarvis,?\s*)?(tolong\s*)?(pasang|set|buat)\s*(hard\s*)?alarm\s*/i, '')
        .replace(/(?:jam|pukul)\s*\d{1,2}(?:[:.]\d{2})?/i, '')
        .trim() || 'Alarm Fokus Llamrei';
    const card = createPendingApprovalAudit({
      sessionId,
      userCommand: prompt,
      toolName: 'set_task_alarm_and_calendar',
      title: `Hard Alarm & Kalender: ${cleanTitle}`,
      summary: `Akan berbunyi di Website + dering HP (NectarLink) pada ${triggerAt}`,
      args: { title: cleanTitle, triggerAtIso: triggerAt },
    });
    return {
      reply: `Draf **Hard Alarm** dan blok Kalender untuk **"${cleanTitle}"** pada **${triggerAt}** siap diaktifkan. Klik Approve untuk menyalakannya.`,
      approvalCard: card,
    };
  }

  // 5. Phone Controls via NectarLink
  if (/\b(dnd|do not disturb|bunyikan hp|ring phone|find phone)\b/i.test(lower)) {
    const devId = getPhoneHubState().devices[0]?.id ?? 'dev_infinix_note30';
    if (/bunyikan|ring|find/i.test(lower)) {
      void ringPhone();
      return { reply: 'Memicu dering **Find Phone** ke HP Anda via NectarLink.', approvalCard: null };
    }
    const turnOn = !/\b(matikan|off|nonaktifkan)\b/i.test(lower);
    void setPhoneControlToggle(devId, 'dnd_enabled', turnOn);
    return {
      reply: `Mode **Do Not Disturb (DND)** di HP ${turnOn ? 'diaktifkan' : 'dimatikan'} melalui jembatan NectarLink.`,
      approvalCard: null,
    };
  }

  // 6. Create or Split ClickUp Task
  if (/\b(buat tugas|create task|tambah tugas|pecah tugas)\b/i.test(lower)) {
    const title =
      prompt
        .replace(/^(llamrei|jarvis,?\s*)?(tolong\s*)?(buat|tambah|create)\s*tugas\s*/i, '')
        .trim() || 'Tugas Baru dari Jarvis/Llamrei';
    const defaultList = ws.lists[0]?.id ?? 'list_bab4';
    const priority = /urgent|mendesak/i.test(lower) ? 'urgent' : /high|tinggi/i.test(lower) ? 'high' : 'normal';
    const dueAtIso = parseIndonesianTimeToIso(prompt);
    const subtasks = /pecah/i.test(lower)
      ? ['Langkah 1: Siapkan data & referensi utama', 'Langkah 2: Eksekusi inti', 'Langkah 3: Verifikasi & finalisasi']
      : [];

    const card = createPendingApprovalAudit({
      sessionId,
      userCommand: prompt,
      toolName: 'create_clickup_task',
      title: `Buat Tugas ClickUp: ${title}`,
      summary: `Prioritas: ${priority.toUpperCase()} · Kalender & Reminder H-15m otomatis · Tenggat: ${dueAtIso}`,
      args: { title, listId: defaultList, priority, dueAtIso, hardAlarm: /alarm/i.test(lower), subtasks },
    });
    return {
      reply: `Siap. Kartu persetujuan pembuatan tugas **"${title}"** (terhubung ke Kalender Website & Reminder) sudah dibuat di bawah.`,
      approvalCard: card,
    };
  }

  // 7. Context attachment ("Tanya tentang ini" / Summarize News / Task)
  if (contextAttachment) {
    const ctxTitle = String(contextAttachment.title ?? contextAttachment.event_name ?? 'Item Terpilih');
    const ctxRaw = String(contextAttachment.summary_raw ?? contextAttachment.description_md ?? contextAttachment.body_text ?? '');
    return {
      reply: `**[Dibuat AI — Analisis Konteks]**\nUntuk **${ctxTitle}**: ${ctxRaw || 'Item ini berasal dari dashboard lokal Anda.'}\n\nRekomendasi aksi: Anda bisa langsung klik **"Buat Tugas"** atau menyuruh saya menjadwalkan tindak lanjutnya.`,
      approvalCard: null,
    };
  }

  // 8. Bottleneck check
  if (/bottleneck|evaluasi mingguan|tugas molor/i.test(lower)) {
    const report = getWeeklyBottleneckReport();
    return {
      reply: `**Weekly Bottleneck & Time-Leak Report:**\n${report.summaryAdvice}\n\nDistribusi waktu per Space:\n${report.spaceTimeBreakdown
        .map((s) => `• ${s.space_name}: ${Math.round(s.total_minutes)} menit (${s.done_count}/${s.task_count} tugas selesai)`)
        .join('\n')}`,
      approvalCard: null,
    };
  }

  return {
    reply: `Perintah diterima: "${prompt}".\nContoh perintah cepat:\n• *"Jadwalkan chat ke Raka jam 19:00 soal revisi slide"*\n• *"Buat tugas Bab 4 Uji MRA prioritas urgent jam 16:00"*\n• *"Pasang alarm jam 07:00 review chart XAUUSD"*\n• *"Auto schedule hari ini"* atau *"Briefing pagi"*\n• Atau hubungkan OpenCode/OpenRouter/Groq + Composio di ⚙️ Pengaturan untuk perintah lintas 150+ aplikasi.`,
    approvalCard: null,
  };
}

function buildApprovalCardForToolCall(params: {
  toolName: string;
  args: Record<string, unknown>;
  sessionId: string;
  userPrompt: string;
}): { card: ApprovalCardData; replyFallback: string } {
  const { toolName, args, sessionId, userPrompt } = params;

  if (toolName === 'schedule_outbound_chat') {
    const name = String(args.recipientName ?? 'Kontak');
    const contact = findContactByNameOrAlias(name);
    const body = String(args.messageBody ?? '');
    const schedAt = String(args.scheduledAtIso ?? wibOffsetIso(0, 19, 0));
    const draft = createScheduledMessageDraft({
      contactId: contact?.id ?? null,
      recipientName: contact?.name ?? name,
      recipientAddress: contact?.phone_e164 ?? '6281200000000',
      channel: contact?.preferred_channel ?? 'nectarlink_bridge',
      purpose: String(args.purpose ?? 'Pesan terjadwal'),
      messageBody: body,
      scheduledAt: schedAt,
      createdByPrompt: userPrompt,
    });
    const card = createPendingApprovalAudit({
      sessionId,
      userCommand: userPrompt,
      toolName,
      title: `Jadwal Chat → ${draft.recipient_name}`,
      summary: `Waktu: ${schedAt} · "${body}"`,
      args: { ...args, scheduledMessageId: draft.id },
      scheduledMessageId: draft.id,
      waMeUrl: draft.waMeUrl,
    });
    return {
      card,
      replyFallback: `Draf chat untuk **${draft.recipient_name}** sudah disiapkan di kartu persetujuan di bawah.`,
    };
  }

  if (toolName.startsWith('composio__')) {
    const toolSlug = toolName.replace(/^composio__/, '');
    const toolkit = toolSlug.split('_')[0] ?? 'COMPOSIO';
    const card = createPendingApprovalAudit({
      sessionId,
      userCommand: userPrompt,
      toolName: 'composio_execute_tool',
      title: `[${toolkit}] Jalankan ${toolSlug}`,
      summary: `Parameter: ${JSON.stringify(args).slice(0, 260)}`,
      args: { toolSlug, arguments: args },
    });
    return {
      card,
      replyFallback: `Aksi integrasi **${toolSlug}** membutuhkan persetujuan Anda. Klik **Approve & Jalankan** pada kartu di bawah untuk mengeksekusinya.`,
    };
  }

  const card = createPendingApprovalAudit({
    sessionId,
    userCommand: userPrompt,
    toolName,
    title: `Aksi Co-Commander: ${toolName}`,
    summary: JSON.stringify(args),
    args,
  });
  return {
    card,
    replyFallback: `Silakan setujui aksi **${toolName}** pada kartu konfirmasi di bawah.`,
  };
}

export async function handleLlamreiPrompt(input: {
  prompt: string;
  sessionId?: string;
  contextAttachment?: Record<string, unknown> | null;
  aiOptions?: AiInvocationOptions;
}): Promise<{
  userMessage: ChatMessageRow;
  assistantMessage: ChatMessageRow;
  usedGemini: boolean;
  providerUsed: string;
}> {
  const db = getDb();
  const sessionId = input.sessionId ?? 'sess_main';

  // Load recent conversation memory BEFORE inserting current prompt
  const historyRows = db
    .prepare(
      `SELECT role, content FROM chat_messages
       WHERE session_id = ? AND role IN ('user', 'assistant')
       ORDER BY created_at DESC, rowid DESC LIMIT 10`,
    )
    .all(sessionId) as Array<{ role: 'user' | 'assistant'; content: string }>;
  const priorMessages: UnifiedMessage[] = historyRows
    .reverse()
    .map((r) => ({ role: r.role, content: scrubPiiForLlm(r.content.slice(0, 1200)) }));

  const userMsgId = `cmsg_${crypto.randomUUID().slice(0, 8)}`;
  db.prepare(
    `INSERT INTO chat_messages (id, session_id, role, content, context_attachment_json)
     VALUES (?, ?, 'user', ?, ?)`,
  ).run(
    userMsgId,
    sessionId,
    input.prompt,
    input.contextAttachment ? JSON.stringify(input.contextAttachment) : null,
  );

  const isWaContext =
    Boolean(input.contextAttachment?.group_name || input.contextAttachment?.quoted_message) ||
    /grup\s+|whatsapp|ekspor chat/i.test(input.prompt);

  const ctxText = input.contextAttachment
    ? `\n\nKONTEKS ITEM TERLAMPIR: ${scrubPiiForLlm(JSON.stringify(input.contextAttachment))}`
    : '';
  const safePrompt = scrubPiiForLlm(input.prompt);

  const loopMessages: UnifiedMessage[] = [
    { role: 'system', content: buildSystemPrompt() },
    ...priorMessages,
    { role: 'user', content: `${safePrompt}${ctxText}` },
  ];

  const composioTools = await getActiveComposioToolsForAgent(input.aiOptions?.fetchImpl);
  const allTools: UnifiedToolDef[] = [...LOCAL_TOOLS, ...composioTools];

  let replyText = '';
  let approvalCard: ApprovalCardData | null = null;
  let providerUsed = 'local';
  let modelLabel = 'llamrei-local-router';
  let usedGemini = false;

  const MAX_REACT_STEPS = 4;
  for (let step = 0; step < MAX_REACT_STEPS; step++) {
    const aiRes = await invokeAiWithFallback(loopMessages, allTools, {
      ...input.aiOptions,
      isSensitiveWaContext: isWaContext,
    });
    if (!aiRes) break;

    providerUsed = aiRes.providerUsed;
    modelLabel = `${aiRes.providerUsed}/${aiRes.modelUsed}${aiRes.isFreeTier ? ' (FREE)' : ''}`;
    usedGemini = aiRes.providerUsed === 'gemini';

    if (aiRes.toolCalls.length === 0) {
      replyText = aiRes.text;
      break;
    }

    // Check if any requested tool needs immediate execution (phone toggle) or Approval Card
    let executedAnyReadOnly = false;
    const assistantTurnCalls = aiRes.toolCalls;
    const toolResultMessages: UnifiedMessage[] = [];

    for (const tc of assistantTurnCalls) {
      const isComposioRead = tc.name.startsWith('composio__') && isReadOnlyComposioTool(tc.name.replace(/^composio__/, ''));
      if (LOCAL_READ_ONLY_TOOLS.has(tc.name) || isComposioRead) {
        const resultStr = await executeReadOnlyTool(tc.name, tc.args, input.aiOptions?.fetchImpl);
        toolResultMessages.push({
          role: 'tool',
          toolCallId: tc.id,
          toolName: tc.name,
          content: resultStr,
        });
        executedAnyReadOnly = true;
      } else if (tc.name === 'control_paired_phone') {
        const devId = getPhoneHubState().devices[0]?.id ?? 'dev_infinix_note30';
        if (tc.args.action === 'find_phone') await ringPhone();
        if (tc.args.action === 'dnd_on') await setPhoneControlToggle(devId, 'dnd_enabled', true);
        if (tc.args.action === 'dnd_off') await setPhoneControlToggle(devId, 'dnd_enabled', false);
        toolResultMessages.push({
          role: 'tool',
          toolCallId: tc.id,
          toolName: tc.name,
          content: JSON.stringify({ ok: true, action: tc.args.action }),
        });
        executedAnyReadOnly = true;
      } else {
        // Write/outbound tool -> Pause cleanly on Approval Card
        const built = buildApprovalCardForToolCall({
          toolName: tc.name,
          args: tc.args,
          sessionId,
          userPrompt: input.prompt,
        });
        approvalCard = built.card;
        replyText = aiRes.text || built.replyFallback;
        break;
      }
    }

    if (approvalCard) break;

    if (executedAnyReadOnly) {
      loopMessages.push({
        role: 'assistant',
        content: aiRes.text,
        toolCalls: assistantTurnCalls,
      });
      loopMessages.push(...toolResultMessages);
      continue;
    }

    replyText = aiRes.text;
    break;
  }

  if (!replyText && !approvalCard) {
    const local = runLocalDeterministicRouter(input.prompt, sessionId, input.contextAttachment);
    const budget = getAiBudgetSummary();
    replyText = budget.blocked
      ? `⚠️ Batas anggaran AI bulanan ($${budget.monthlyCapUsd}) tercapai — dialihkan ke mode router lokal.\n\n${local.reply}`
      : local.reply;
    approvalCard = local.approvalCard;
    providerUsed = 'local';
    modelLabel = 'llamrei-local-router';
  }

  const aiMsgId = `cmsg_${crypto.randomUUID().slice(0, 8)}`;
  db.prepare(
    `INSERT INTO chat_messages (id, session_id, role, content, approval_card_json, model_used)
     VALUES (?, ?, 'assistant', ?, ?, ?)`,
  ).run(
    aiMsgId,
    sessionId,
    replyText,
    approvalCard ? JSON.stringify(approvalCard) : null,
    modelLabel,
  );

  const userMessage = db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(userMsgId) as unknown as ChatMessageRow;
  const assistantMessage = db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(aiMsgId) as unknown as ChatMessageRow;
  sseBus.emit('agent:message', assistantMessage);

  return { userMessage, assistantMessage, usedGemini, providerUsed };
}

export async function approveAuditAction(
  auditId: string,
  editedArgs?: Record<string, unknown>,
  fetchImpl?: typeof fetch,
): Promise<AuditLogRow | null> {
  const db = getDb();
  const audit = db.prepare('SELECT * FROM agent_audit_logs WHERE id = ?').get(auditId) as unknown as AuditLogRow | undefined;
  if (!audit || audit.status !== 'pending_approval') return null;

  const args = { ...(JSON.parse(audit.tool_args_json) as Record<string, unknown>), ...(editedArgs ?? {}) };
  let undoPayload: Record<string, unknown> = {};

  if (audit.tool_name === 'schedule_outbound_chat' && args.scheduledMessageId) {
    const msgId = String(args.scheduledMessageId);
    approveScheduledMessage(msgId, {
      messageBody: typeof args.messageBody === 'string' ? args.messageBody : undefined,
      scheduledAt: typeof args.scheduledAt === 'string' ? args.scheduledAt : undefined,
    });
    undoPayload = { kind: 'revert_scheduled_message', scheduledMessageId: msgId };
  } else if (audit.tool_name === 'create_clickup_task') {
    const ws = getWorkspaceSnapshot();
    const task = createTask({
      listId: String(args.listId ?? ws.lists[0]?.id ?? 'list_bab4'),
      title: String(args.title ?? 'Tugas Baru Llamrei'),
      priority: (args.priority as 'urgent' | 'high' | 'normal' | 'low') ?? 'normal',
      dueAt: typeof args.dueAtIso === 'string' ? args.dueAtIso : null,
      hardAlarmEnabled: Boolean(args.hardAlarm),
      subtasks: Array.isArray(args.subtasks) ? (args.subtasks as string[]) : [],
    });
    undoPayload = { kind: 'delete_task', taskId: task.id };
  } else if (audit.tool_name === 'set_task_alarm_and_calendar') {
    const alarm = createOrUpdateHardAlarm({
      taskId: typeof args.taskId === 'string' ? args.taskId : null,
      title: String(args.title ?? 'Alarm Llamrei'),
      triggerAt: String(args.triggerAtIso ?? new Date(Date.now() + 3_600_000).toISOString()),
    });
    if (!args.taskId) {
      createStandaloneCalendarEvent({
        title: String(args.title ?? 'Alarm Llamrei'),
        startAt: String(args.triggerAtIso),
        withHardAlarm: false,
      });
    }
    undoPayload = { kind: 'delete_alarm', alarmId: alarm.id };
  } else if (audit.tool_name === 'auto_schedule_clickup_day') {
    const res = computeAutoScheduleForToday(true);
    undoPayload = { kind: 'clear_auto_schedule', taskIds: res.proposals.map((p) => p.taskId) };
  } else if (audit.tool_name === 'reply_phone_notification' && args.notifId && args.replyText) {
    await replyPhoneNotification(String(args.notifId), String(args.replyText));
    undoPayload = { kind: 'none' };
  } else if (audit.tool_name === 'composio_execute_tool' && args.toolSlug) {
    const execRes = await executeComposioTool(
      String(args.toolSlug),
      (args.arguments as Record<string, unknown>) ?? {},
      fetchImpl,
    );
    undoPayload = { kind: 'none', composioOk: execRes.ok, summary: execRes.summary };
  }

  db.prepare(
    `UPDATE agent_audit_logs
     SET status = 'approved_executed', undo_payload_json = ?, executed_at = datetime('now')
     WHERE id = ?`,
  ).run(JSON.stringify(undoPayload), auditId);

  const msgs = db.prepare('SELECT id, approval_card_json FROM chat_messages WHERE approval_card_json IS NOT NULL').all() as Array<{
    id: string;
    approval_card_json: string;
  }>;
  for (const m of msgs) {
    const card = JSON.parse(m.approval_card_json) as ApprovalCardData;
    if (card.auditId === auditId) {
      card.status = 'approved_executed';
      db.prepare('UPDATE chat_messages SET approval_card_json = ? WHERE id = ?').run(JSON.stringify(card), m.id);
    }
  }

  const updated = db.prepare('SELECT * FROM agent_audit_logs WHERE id = ?').get(auditId) as unknown as AuditLogRow;
  sseBus.emit('agent:audit', updated);
  return updated;
}

export function undoAuditAction(auditId: string): AuditLogRow | null {
  const db = getDb();
  const audit = db.prepare('SELECT * FROM agent_audit_logs WHERE id = ?').get(auditId) as unknown as AuditLogRow | undefined;
  if (!audit || audit.status !== 'approved_executed' || !audit.undo_payload_json) return null;

  const undo = JSON.parse(audit.undo_payload_json) as {
    kind?: string;
    scheduledMessageId?: string;
    taskId?: string;
    alarmId?: string;
    taskIds?: string[];
  };

  if (undo.kind === 'revert_scheduled_message' && undo.scheduledMessageId) {
    updateScheduledMessageStatus(undo.scheduledMessageId, 'pending_approval');
  } else if (undo.kind === 'delete_task' && undo.taskId) {
    deleteTask(undo.taskId);
  } else if (undo.kind === 'delete_alarm' && undo.alarmId) {
    db.prepare('DELETE FROM task_alarms_reminders WHERE id = ?').run(undo.alarmId);
  } else if (undo.kind === 'clear_auto_schedule' && Array.isArray(undo.taskIds)) {
    for (const tid of undo.taskIds) {
      updateTask(tid, { autoScheduledBlockStart: null, autoScheduledBlockEnd: null });
    }
  }

  db.prepare("UPDATE agent_audit_logs SET status = 'undone' WHERE id = ?").run(auditId);
  const msgs = db.prepare('SELECT id, approval_card_json FROM chat_messages WHERE approval_card_json IS NOT NULL').all() as Array<{
    id: string;
    approval_card_json: string;
  }>;
  for (const m of msgs) {
    const card = JSON.parse(m.approval_card_json) as ApprovalCardData;
    if (card.auditId === auditId) {
      card.status = 'undone';
      db.prepare('UPDATE chat_messages SET approval_card_json = ? WHERE id = ?').run(JSON.stringify(card), m.id);
    }
  }

  const updated = db.prepare('SELECT * FROM agent_audit_logs WHERE id = ?').get(auditId) as unknown as AuditLogRow;
  sseBus.emit('agent:audit', updated);
  return updated;
}
