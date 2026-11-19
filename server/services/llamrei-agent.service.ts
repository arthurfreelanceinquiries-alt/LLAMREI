import { getDb, todayWibIsoDate, wibOffsetIso } from '../db/connection.ts';
import { sseBus } from '../lib/sse.ts';
import { getSecret } from './secret.service.ts';
import { scrubPiiForLlm } from './wa-export.service.ts';
import {
  createOrUpdateHardAlarm,
  createStandaloneCalendarEvent,
  getNextArmedAlarm,
} from './alarm-calendar.service.ts';
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
import {
  createTask,
  deleteTask,
  getWeeklyBottleneckReport,
  getWorkspaceSnapshot,
  updateTask,
} from './workspace.service.ts';

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

export function getAiBudgetSummary(): {
  monthlySpentUsd: number;
  monthlyCapUsd: number;
  remainingUsd: number;
  blocked: boolean;
  callsCount: number;
} {
  const db = getDb();
  const monthPrefix = todayWibIsoDate().slice(0, 7);
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(estimated_cost_usd), 0) AS spent, COUNT(*) AS cnt
       FROM ai_usage_ledger WHERE created_at LIKE ?`,
    )
    .get(`${monthPrefix}%`) as { spent: number; cnt: number };

  const capRow = db.prepare("SELECT value_json FROM app_settings WHERE key = 'ai_monthly_budget_usd'").get() as
    | { value_json: string }
    | undefined;
  const monthlyCapUsd = capRow ? Number(JSON.parse(capRow.value_json)) : 10.0;
  const monthlySpentUsd = Math.round(row.spent * 10000) / 10000;
  return {
    monthlySpentUsd,
    monthlyCapUsd,
    remainingUsd: Math.max(0, Math.round((monthlyCapUsd - monthlySpentUsd) * 10000) / 10000),
    blocked: monthlySpentUsd >= monthlyCapUsd,
    callsCount: row.cnt,
  };
}

function recordAiUsage(model: string, feature: string, promptTokens: number, completionTokens: number): void {
  const db = getDb();
  const isPro = model.includes('pro');
  const rateIn = isPro ? 0.00000125 : 0.00000015;
  const rateOut = isPro ? 0.000005 : 0.0000006;
  const cost = promptTokens * rateIn + completionTokens * rateOut;
  db.prepare(
    `INSERT INTO ai_usage_ledger (id, provider, model, feature, prompt_tokens, completion_tokens, estimated_cost_usd)
     VALUES (?, 'gemini', ?, ?, ?, ?, ?)`,
  ).run(`ai_${crypto.randomUUID().slice(0, 8)}`, model, feature, promptTokens, completionTokens, cost);
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
    `**MORNING BRIEFING LLAMREI (${today})**`,
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

  return [
    'Kamu adalah LLAMREI, personal co-commander & performance strategist milik Arthur Reezan (mahasiswa akhir FEB UKRIDA NIM 312023002 & trader).',
    'ATURAN ANTI-GENERIK (FR-52): Jangan pernah memberi saran motivasi klise atau normatif. Selalu rujuk data nyata Arthur di bawah ini.',
    'ATURAN KEAMANAN: Jangan mengarang angka harga pasar atau persentase KPI; gunakan hanya data dari tool/konteks.',
    `KONTEKS NYATA SAAT INI: Execution=${kpis.executionScorePercent}%, DeepWork=${kpis.deepWorkHoursTotal}h, TiltRisk=${kpis.todayCheckIn?.tilt_risk_level ?? 'unknown'}, Lists=${ws.lists.map((l) => `${l.id}:${l.name}`).join(', ')}, Bottleneck="${bottleneck.summaryAdvice}", Phone=${phone.devices[0]?.name ?? 'none'} (${phone.devices[0]?.battery_level ?? 0}%).`,
    'Jawab dalam Bahasa Indonesia yang ringkas, tajam, dan terstruktur.',
  ].join('\n');
}

const GEMINI_TOOLS = [
  {
    functionDeclarations: [
      {
        name: 'schedule_outbound_chat',
        description: 'Menyiapkan draf & jadwal pesan keluar (WhatsApp/Telegram) untuk disetujui Arthur di Approval Card.',
        parameters: {
          type: 'OBJECT',
          properties: {
            recipientName: { type: 'STRING' },
            purpose: { type: 'STRING' },
            messageBody: { type: 'STRING' },
            scheduledAtIso: { type: 'STRING' },
          },
          required: ['recipientName', 'purpose', 'messageBody', 'scheduledAtIso'],
        },
      },
      {
        name: 'create_clickup_task',
        description: 'Membuat tugas baru di ruang kerja ClickUp beserta tenggat, jadwal kalender, dan opsi Hard Alarm.',
        parameters: {
          type: 'OBJECT',
          properties: {
            title: { type: 'STRING' },
            listId: { type: 'STRING' },
            priority: { type: 'STRING', enum: ['urgent', 'high', 'normal', 'low'] },
            dueAtIso: { type: 'STRING' },
            hardAlarm: { type: 'BOOLEAN' },
            subtasks: { type: 'ARRAY', items: { type: 'STRING' } },
          },
          required: ['title'],
        },
      },
      {
        name: 'set_task_alarm_and_calendar',
        description: 'Memasang Hard Alarm & blok Kalender Website pada waktu tertentu.',
        parameters: {
          type: 'OBJECT',
          properties: {
            title: { type: 'STRING' },
            triggerAtIso: { type: 'STRING' },
            taskId: { type: 'STRING' },
          },
          required: ['title', 'triggerAtIso'],
        },
      },
      {
        name: 'auto_schedule_clickup_day',
        description: 'Menyusun blok jadwal tugas ClickUp hari ini gaya Motion, menghindari rapat & rilis CPI/FOMC.',
        parameters: { type: 'OBJECT', properties: {} },
      },
      {
        name: 'control_paired_phone',
        description: 'Mengontrol HP Android via NectarLink (dnd_on, dnd_off, find_phone).',
        parameters: {
          type: 'OBJECT',
          properties: { action: { type: 'STRING', enum: ['dnd_on', 'dnd_off', 'find_phone'] } },
          required: ['action'],
        },
      },
    ],
  },
];

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
    const cleanTitle = prompt
      .replace(/^(llamrei,?\s*)?(tolong\s*)?(pasang|set|buat)\s*(hard\s*)?alarm\s*/i, '')
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
    const title = prompt
      .replace(/^(llamrei,?\s*)?(tolong\s*)?(buat|tambah|create)\s*tugas\s*/i, '')
      .trim() || 'Tugas Baru dari Llamrei';
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
    reply: `Perintah diterima: "${prompt}".\nContoh perintah aksi cepat yang langsung terhubung ke Approval Card:\n• *"Jadwalkan chat ke Raka jam 19:00 soal revisi slide"*\n• *"Buat tugas Bab 4 Uji MRA prioritas urgent jam 16:00"*\n• *"Pasang alarm jam 07:00 review chart XAUUSD"*\n• *"Auto schedule hari ini"* atau *"Briefing pagi"*`,
    approvalCard: null,
  };
}

export async function handleLlamreiPrompt(input: {
  prompt: string;
  sessionId?: string;
  contextAttachment?: Record<string, unknown> | null;
}): Promise<{ userMessage: ChatMessageRow; assistantMessage: ChatMessageRow; usedGemini: boolean }> {
  const db = getDb();
  const sessionId = input.sessionId ?? 'sess_main';
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

  const geminiKey = getSecret('GEMINI_API_KEY');
  const budget = getAiBudgetSummary();
  const modelRow = db.prepare("SELECT value_json FROM app_settings WHERE key = 'ai_model'").get() as
    | { value_json: string }
    | undefined;
  const model = modelRow ? (JSON.parse(modelRow.value_json) as string) : 'gemini-2.5-flash';
  const paidRow = db.prepare("SELECT value_json FROM app_settings WHERE key = 'paid_billing_verified'").get() as
    | { value_json: string }
    | undefined;
  const paidVerified = paidRow ? Boolean(JSON.parse(paidRow.value_json)) : false;
  const isWaContext =
    Boolean(input.contextAttachment?.group_name || input.contextAttachment?.quoted_message) ||
    /grup\s+|whatsapp|ekspor chat/i.test(input.prompt);

  let replyText = '';
  let approvalCard: ApprovalCardData | null = null;
  let usedGemini = false;

  if (geminiKey && !budget.blocked && (!isWaContext || paidVerified)) {
    try {
      const ctxText = input.contextAttachment
        ? `\n\nKONTEKS ITEM TERLAMPIR: ${scrubPiiForLlm(JSON.stringify(input.contextAttachment))}`
        : '';
      const safePrompt = scrubPiiForLlm(input.prompt);
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(geminiKey)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: buildSystemPrompt() }] },
            contents: [{ role: 'user', parts: [{ text: `${safePrompt}${ctxText}` }] }],
            tools: GEMINI_TOOLS,
          }),
          signal: AbortSignal.timeout(15000),
        },
      );

      if (res.ok) {
        const data = (await res.json()) as {
          candidates?: Array<{
            content?: {
              parts?: Array<{
                text?: string;
                functionCall?: { name: string; args?: Record<string, unknown> };
              }>;
            };
          }>;
          usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
        };
        recordAiUsage(
          model,
          'agent',
          data.usageMetadata?.promptTokenCount ?? 300,
          data.usageMetadata?.candidatesTokenCount ?? 150,
        );
        usedGemini = true;
        const parts = data.candidates?.[0]?.content?.parts ?? [];
        const fnPart = parts.find((p) => p.functionCall);
        const textPart = parts.map((p) => p.text ?? '').join('\n').trim();

        if (fnPart?.functionCall) {
          const fc = fnPart.functionCall;
          const args = fc.args ?? {};
          if (fc.name === 'schedule_outbound_chat') {
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
              createdByPrompt: input.prompt,
            });
            approvalCard = createPendingApprovalAudit({
              sessionId,
              userCommand: input.prompt,
              toolName: fc.name,
              title: `Jadwal Chat → ${draft.recipient_name}`,
              summary: `Waktu: ${schedAt} · "${body}"`,
              args: { ...args, scheduledMessageId: draft.id },
              scheduledMessageId: draft.id,
              waMeUrl: draft.waMeUrl,
            });
            replyText = textPart || `Draf chat untuk **${draft.recipient_name}** sudah disiapkan di kartu persetujuan di bawah.`;
          } else if (fc.name === 'control_paired_phone') {
            const devId = getPhoneHubState().devices[0]?.id ?? 'dev_infinix_note30';
            if (args.action === 'find_phone') await ringPhone();
            if (args.action === 'dnd_on') await setPhoneControlToggle(devId, 'dnd_enabled', true);
            if (args.action === 'dnd_off') await setPhoneControlToggle(devId, 'dnd_enabled', false);
            replyText = textPart || `Perintah NectarLink \`${String(args.action)}\` dijalankan.`;
          } else {
            approvalCard = createPendingApprovalAudit({
              sessionId,
              userCommand: input.prompt,
              toolName: fc.name,
              title: `Aksi Llamrei: ${fc.name}`,
              summary: JSON.stringify(args),
              args,
            });
            replyText = textPart || `Silakan setujui aksi **${fc.name}** pada kartu konfirmasi di bawah.`;
          }
        } else if (textPart) {
          replyText = textPart;
        }
      }
    } catch {
      usedGemini = false;
    }
  }

  if (!replyText) {
    const local = runLocalDeterministicRouter(input.prompt, sessionId, input.contextAttachment);
    replyText = budget.blocked
      ? `⚠️ Batas anggaran AI bulanan ($${budget.monthlyCapUsd}) tercapai — dialihkan ke mode router lokal.\n\n${local.reply}`
      : local.reply;
    approvalCard = local.approvalCard;
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
    usedGemini ? model : 'llamrei-local-router',
  );

  const userMessage = db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(userMsgId) as unknown as ChatMessageRow;
  const assistantMessage = db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(aiMsgId) as unknown as ChatMessageRow;
  sseBus.emit('agent:message', assistantMessage);

  return { userMessage, assistantMessage, usedGemini };
}

export async function approveAuditAction(auditId: string, editedArgs?: Record<string, unknown>): Promise<AuditLogRow | null> {
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
  }

  db.prepare(
    `UPDATE agent_audit_logs
     SET status = 'approved_executed', undo_payload_json = ?, executed_at = datetime('now')
     WHERE id = ?`,
  ).run(JSON.stringify(undoPayload), auditId);

  // Also reflect approval status inside the chat message's approval_card_json
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
