import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb, initDatabase } from './db/connection.ts';
import { HttpBadRequestError, readJsonBody, sendError, sendJson } from './lib/http.ts';
import { sseBus } from './lib/sse.ts';
import {
  createOrUpdateHardAlarm,
  createStandaloneCalendarEvent,
  dismissAlarm,
  getNextArmedAlarm,
  listAlarmsAndReminders,
  listCalendarEvents,
  moveCalendarEvent,
  snoozeAlarm,
  testHardAlarm,
  toggleAlarmEnabled,
  type SoundPreset,
} from './services/alarm-calendar.service.ts';
import {
  approveAuditAction,
  getAiBudgetSummary,
  handleLlamreiPrompt,
  listAuditLogs,
  listChatMessages,
  undoAuditAction,
} from './services/llamrei-agent.service.ts';
import {
  computeAutoScheduleForToday,
  getRealDataKpis,
  saveDailyCheckIn,
  toggleHabitForToday,
  type MentalState,
} from './services/lifeos.service.ts';
import {
  getMarketAndNewsFeed,
  getWibMarketSessions,
  refreshLiveFinnhubAndRss,
  syncNotionCalendarDatabase,
  toggleSaveNewsArticle,
} from './services/market.service.ts';
import { getMobileWidgetSnapshot, reconcileMobileMutations, type MobileMutationItem } from './services/mobile-widget.service.ts';
import {
  connectNectarLinkViaTailscale,
  dismissPhoneNotification,
  getPhoneHubState,
  ingestPhoneNotification,
  replyPhoneNotification,
  ringPhone,
  sendClipboardToPhone,
  sendToPhone,
  setPhoneControlToggle,
  startScreenMirror,
  syncDevicesFromNectarLink,
  triggerCameraCapture,
} from './services/nectarlink.service.ts';
import { getNetworkMeshStatus } from './services/network-tailscale.service.ts';
import {
  approveScheduledMessage,
  createContact,
  createScheduledMessageDraft,
  listContacts,
  listScheduledMessages,
  startBackgroundDaemons,
  updateScheduledMessageStatus,
} from './services/scheduler.service.ts';
import { getSecretStatus, setSecret, type SecretKeyName } from './services/secret.service.ts';
import {
  initBaileysClient,
  getBaileysStatus,
  listBaileysThreads,
  getBaileysThread,
  sendBaileysMessage,
  disconnectBaileys,
  syncBaileysGroups,
  autoConnectBaileysIfCredsExist,
} from './services/whatsapp-baileys.service.ts';
import {
  applyTaskTemplateToList,
  launchWhitelistedApp,
  listAppLaunchers,
  listTaskTemplates,
  setTaskRecurrenceAndCustomFields,
  type RecurrenceRule,
} from './services/phase2-productivity.service.ts';
import {
  acceptWaEventProposal,
  declineWaEventProposal,
  importWhatsAppExport,
  listWaTagMentions,
  updateWaEventProposal,
  updateWaTagMentionStatus,
} from './services/wa-export.service.ts';
import {
  createOrUpdateWorkspaceDoc,
  deleteWorkspaceDoc,
  exportWorkspaceAsCsv,
  exportWorkspaceAsMarkdown,
  getGanttAndWorkloadSummary,
  importTasksIntoList,
  listWorkspaceDocs,
} from './services/phase3-docs-io.service.ts';
import {
  createTradingJournalEntry,
  deleteTradingJournalEntry,
  getTradingJournalState,
  type TradeDirection,
  type TradeEmotion,
  type TradeOutcome,
  type TradeSession,
} from './services/trading-journal.service.ts';
import {
  addTaskDependency,
  createFolder,
  createList,
  createMacroGoal,
  createSpace,
  createTask,
  deleteTask,
  getWeeklyBottleneckReport,
  getWorkspaceSnapshot,
  startTaskTimer,
  stopTaskTimer,
  updateTask,
  type CreateTaskInput,
  type MacroGoalRow,
  type UpdateTaskPatch,
} from './services/workspace.service.ts';
import type { OutboundChannel } from './services/gateway.service.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.resolve(__dirname, '..', 'dist');

const MIME_MAP: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.apk': 'application/vnd.android.package-archive',
};

function getAllSettings(): Record<string, unknown> {
  const db = getDb();
  const rows = db.prepare('SELECT key, value_json FROM app_settings').all() as Array<{ key: string; value_json: string }>;
  const map: Record<string, unknown> = {};
  for (const r of rows) {
    try {
      map[r.key] = JSON.parse(r.value_json);
    } catch {
      map[r.key] = r.value_json;
    }
  }
  return map;
}

async function routeApi(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<boolean> {
  const method = req.method ?? 'GET';

  // Health & SSE
  if (method === 'GET' && pathname === '/api/health') {
    sendJson(res, 200, { ok: true, service: 'llamrei-core', time: new Date().toISOString() });
    return true;
  }

  if (method === 'GET' && pathname === '/api/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    const unsubscribe = sseBus.subscribe(res);
    req.on('close', unsubscribe);
    return true;
  }

  // Bootstrap all modules in 1 fast roundtrip
  if (method === 'GET' && pathname === '/api/bootstrap') {
    const network = await getNetworkMeshStatus();
    sendJson(res, 200, {
      workspace: getWorkspaceSnapshot(),
      bottlenecks: getWeeklyBottleneckReport(),
      calendarEvents: listCalendarEvents(),
      alarms: listAlarmsAndReminders(),
      nextAlarm: getNextArmedAlarm(),
      kpis: getRealDataKpis(),
      contacts: listContacts(),
      scheduledMessages: listScheduledMessages(),
      phoneHub: getPhoneHubState(),
      marketSessions: getWibMarketSessions(),
      marketFeed: getMarketAndNewsFeed(),
      chatMessages: listChatMessages(),
      auditLogs: listAuditLogs(),
      aiBudget: getAiBudgetSummary(),
      waTagMentions: listWaTagMentions(),
      taskTemplates: listTaskTemplates(),
      appLaunchers: listAppLaunchers(),
      tradingJournal: getTradingJournalState(),
      workspaceDocs: listWorkspaceDocs(),
      ganttWorkload: getGanttAndWorkloadSummary(),
      settings: getAllSettings(),
      secretStatus: getSecretStatus(),
      network,
      baileys: getBaileysStatus(),
      baileysThreads: listBaileysThreads(),
    });
    return true;
  }

  // Workspace (ClickUp)
  if (method === 'GET' && pathname === '/api/workspace') {
    sendJson(res, 200, { ...getWorkspaceSnapshot(), bottlenecks: getWeeklyBottleneckReport() });
    return true;
  }
  if (method === 'POST' && pathname === '/api/workspace/spaces') {
    const body = await readJsonBody<{ name: string; color?: string; icon?: string }>(req);
    sendJson(res, 201, createSpace(body.name, body.color, body.icon));
    return true;
  }
  if (method === 'POST' && pathname === '/api/workspace/folders') {
    const body = await readJsonBody<{ spaceId: string; name: string }>(req);
    sendJson(res, 201, createFolder(body.spaceId, body.name));
    return true;
  }
  if (method === 'POST' && pathname === '/api/workspace/lists') {
    const body = await readJsonBody<{ spaceId: string; folderId?: string | null; name: string }>(req);
    sendJson(res, 201, createList(body.spaceId, body.name, body.folderId ?? null));
    return true;
  }
  if (method === 'POST' && pathname === '/api/workspace/goals') {
    const body = await readJsonBody<{
      title: string;
      category: MacroGoalRow['category'];
      targetDate?: string | null;
      targetMetricLabel?: string | null;
    }>(req);
    sendJson(res, 201, createMacroGoal(body));
    return true;
  }
  if (method === 'POST' && pathname === '/api/workspace/tasks') {
    const body = await readJsonBody<CreateTaskInput>(req);
    sendJson(res, 201, createTask(body));
    return true;
  }
  if (method === 'PATCH' && /^\/api\/workspace\/tasks\/[^/]+$/.test(pathname)) {
    const taskId = pathname.split('/').pop()!;
    const body = await readJsonBody<UpdateTaskPatch>(req);
    const updated = updateTask(taskId, body);
    if (!updated) sendError(res, 404, 'Task not found');
    else sendJson(res, 200, updated);
    return true;
  }
  if (method === 'DELETE' && /^\/api\/workspace\/tasks\/[^/]+$/.test(pathname)) {
    const taskId = pathname.split('/').pop()!;
    sendJson(res, 200, { ok: deleteTask(taskId) });
    return true;
  }
  if (method === 'POST' && /^\/api\/workspace\/tasks\/[^/]+\/dependencies$/.test(pathname)) {
    const taskId = pathname.split('/')[4];
    const body = await readJsonBody<{ dependsOnTaskId: string }>(req);
    addTaskDependency(taskId, body.dependsOnTaskId);
    sendJson(res, 200, { ok: true });
    return true;
  }
  if (method === 'POST' && /^\/api\/workspace\/tasks\/[^/]+\/timer\/start$/.test(pathname)) {
    const taskId = pathname.split('/')[4];
    sendJson(res, 200, { activeTimer: await startTaskTimer(taskId) });
    return true;
  }
  if (method === 'POST' && /^\/api\/workspace\/tasks\/[^/]+\/timer\/stop$/.test(pathname)) {
    const taskId = pathname.split('/')[4];
    sendJson(res, 200, await stopTaskTimer(taskId));
    return true;
  }

  // Calendar & 2-Tier Alarms
  if (method === 'GET' && pathname === '/api/calendar-alarms') {
    sendJson(res, 200, {
      calendarEvents: listCalendarEvents(),
      alarms: listAlarmsAndReminders(),
      nextAlarm: getNextArmedAlarm(),
    });
    return true;
  }
  if (method === 'POST' && pathname === '/api/calendar-alarms/events') {
    const body = await readJsonBody<{
      title: string;
      startAt: string;
      endAt?: string | null;
      color?: string;
      notes?: string;
      withHardAlarm?: boolean;
    }>(req);
    sendJson(res, 201, createStandaloneCalendarEvent(body));
    return true;
  }
  if (method === 'PATCH' && /^\/api\/calendar-alarms\/events\/[^/]+\/move$/.test(pathname)) {
    const eventId = pathname.split('/')[4];
    const body = await readJsonBody<{ startAt: string; endAt?: string | null }>(req);
    const updated = moveCalendarEvent(eventId, body.startAt, body.endAt);
    if (!updated) sendError(res, 404, 'Event not found');
    else sendJson(res, 200, updated);
    return true;
  }
  if (method === 'POST' && pathname === '/api/calendar-alarms/alarms') {
    const body = await readJsonBody<{
      taskId?: string | null;
      title: string;
      triggerAt: string;
      soundPreset?: SoundPreset;
      ringPhone?: boolean;
    }>(req);
    sendJson(res, 201, createOrUpdateHardAlarm(body));
    return true;
  }
  if (method === 'PATCH' && /^\/api\/calendar-alarms\/alarms\/[^/]+\/toggle$/.test(pathname)) {
    const alarmId = pathname.split('/')[4];
    const body = await readJsonBody<{ enabled: boolean }>(req);
    sendJson(res, 200, toggleAlarmEnabled(alarmId, body.enabled));
    return true;
  }
  if (method === 'POST' && /^\/api\/calendar-alarms\/alarms\/[^/]+\/snooze$/.test(pathname)) {
    const alarmId = pathname.split('/')[4];
    const body = await readJsonBody<{ minutes?: number }>(req);
    sendJson(res, 200, snoozeAlarm(alarmId, body.minutes ?? 10, 'web'));
    return true;
  }
  if (method === 'POST' && /^\/api\/calendar-alarms\/alarms\/[^/]+\/dismiss$/.test(pathname)) {
    const alarmId = pathname.split('/')[4];
    sendJson(res, 200, dismissAlarm(alarmId, 'web'));
    return true;
  }
  if (method === 'POST' && pathname === '/api/calendar-alarms/alarms/test') {
    const body = await readJsonBody<{ alarmId?: string }>(req);
    sendJson(res, 200, await testHardAlarm(body.alarmId));
    return true;
  }

  // Mobile Home Screen Widgets & Offline Delta Reconcile
  if (method === 'GET' && pathname === '/api/mobile-widget/snapshot') {
    sendJson(res, 200, getMobileWidgetSnapshot());
    return true;
  }
  if (method === 'POST' && pathname === '/api/mobile-widget/reconcile') {
    const body = await readJsonBody<{ mutations: MobileMutationItem[] }>(req);
    sendJson(res, 200, reconcileMobileMutations(body.mutations ?? []));
    return true;
  }

  // Phone Hub (NectarLink)
  if (method === 'GET' && pathname === '/api/phonehub') {
    sendJson(res, 200, getPhoneHubState());
    return true;
  }
  if (method === 'POST' && pathname === '/api/phonehub/sync') {
    sendJson(res, 200, await syncDevicesFromNectarLink());
    return true;
  }
  if (method === 'POST' && pathname === '/api/phonehub/ring') {
    const body = await readJsonBody<{ device?: string }>(req);
    sendJson(res, 200, await ringPhone(body.device));
    return true;
  }
  if (method === 'POST' && pathname === '/api/phonehub/mirror') {
    const body = await readJsonBody<{ deviceId?: string; appPackage?: string }>(req);
    sendJson(res, 200, await startScreenMirror(body.deviceId, body.appPackage));
    return true;
  }
  if (method === 'POST' && pathname === '/api/phonehub/send') {
    const body = await readJsonBody<{ device?: string; paths?: string[]; url?: string; text?: string }>(req);
    sendJson(res, 200, await sendToPhone(body));
    return true;
  }
  if (method === 'POST' && pathname === '/api/phonehub/clipboard') {
    const body = await readJsonBody<{ text: string; device?: string }>(req);
    sendJson(res, 200, await sendClipboardToPhone(body.text, body.device));
    return true;
  }
  if (method === 'POST' && pathname === '/api/phonehub/camera') {
    const body = await readJsonBody<{ mode: 'photo' | 'scan'; device?: string; linkedTaskId?: string | null }>(req);
    sendJson(res, 200, await triggerCameraCapture(body));
    return true;
  }
  if (method === 'PATCH' && /^\/api\/phonehub\/devices\/[^/]+\/toggle$/.test(pathname)) {
    const deviceId = pathname.split('/')[4];
    const body = await readJsonBody<{ toggle: Parameters<typeof setPhoneControlToggle>[1]; enabled: boolean }>(req);
    sendJson(res, 200, await setPhoneControlToggle(deviceId, body.toggle, body.enabled));
    return true;
  }
  if (method === 'POST' && pathname === '/api/phonehub/notifications/simulate') {
    const body = await readJsonBody<{
      appPackage?: string;
      appName?: string;
      senderOrTitle: string;
      conversationGroup?: string | null;
      bodyText: string;
    }>(req);
    sendJson(
      res,
      201,
      ingestPhoneNotification({
        appPackage: body.appPackage ?? 'com.whatsapp',
        appName: body.appName ?? 'WhatsApp',
        senderOrTitle: body.senderOrTitle,
        conversationGroup: body.conversationGroup ?? 'Grup Riset Trading',
        bodyText: body.bodyText,
      }),
    );
    return true;
  }
  if (method === 'POST' && /^\/api\/phonehub\/notifications\/[^/]+\/reply$/.test(pathname)) {
    const notifId = pathname.split('/')[4];
    const body = await readJsonBody<{ replyText: string }>(req);
    sendJson(res, 200, await replyPhoneNotification(notifId, body.replyText));
    return true;
  }
  if (method === 'DELETE' && /^\/api\/phonehub\/notifications\/[^/]+$/.test(pathname)) {
    const notifId = pathname.split('/')[4];
    dismissPhoneNotification(notifId);
    sendJson(res, 200, { ok: true });
    return true;
  }
  if (method === 'POST' && pathname === '/api/phonehub/tailscale-connect') {
    const body = await readJsonBody<{ deviceId: string; tailscaleIp: string; port?: number }>(req);
    sendJson(res, 200, await connectNectarLinkViaTailscale(body.deviceId, body.tailscaleIp, body.port));
    return true;
  }

  // Network & Tailscale
  if (method === 'GET' && pathname === '/api/network/status') {
    sendJson(res, 200, await getNetworkMeshStatus());
    return true;
  }

  // Life OS
  if (method === 'GET' && pathname === '/api/lifeos/kpis') {
    sendJson(res, 200, getRealDataKpis());
    return true;
  }
  if (method === 'POST' && pathname === '/api/lifeos/checkin') {
    const body = await readJsonBody<{
      wakeTime?: string | null;
      sleepHours: number;
      energyLevel: number;
      mentalState: MentalState;
      topPriorityNote?: string | null;
    }>(req);
    sendJson(res, 200, saveDailyCheckIn(body));
    return true;
  }
  if (method === 'POST' && /^\/api\/lifeos\/habits\/[^/]+\/toggle$/.test(pathname)) {
    const habitId = pathname.split('/')[4];
    const body = await readJsonBody<{ completed: boolean }>(req);
    sendJson(res, 200, { habits: toggleHabitForToday(habitId, body.completed) });
    return true;
  }
  if (method === 'POST' && pathname === '/api/lifeos/auto-schedule') {
    const body = await readJsonBody<{ apply?: boolean }>(req);
    sendJson(res, 200, computeAutoScheduleForToday(Boolean(body.apply)));
    return true;
  }

  // Scheduled Messaging & Contacts
  if (method === 'GET' && pathname === '/api/scheduler/messages') {
    sendJson(res, 200, listScheduledMessages());
    return true;
  }
  if (method === 'POST' && pathname === '/api/scheduler/messages') {
    const body = await readJsonBody<{
      contactId?: string | null;
      recipientName: string;
      recipientAddress: string;
      channel?: OutboundChannel;
      purpose: string;
      messageBody: string;
      scheduledAt: string;
      linkedTaskId?: string | null;
    }>(req);
    sendJson(res, 201, createScheduledMessageDraft(body));
    return true;
  }
  if (method === 'POST' && /^\/api\/scheduler\/messages\/[^/]+\/approve$/.test(pathname)) {
    const msgId = pathname.split('/')[4];
    const body = await readJsonBody<{ messageBody?: string; scheduledAt?: string; channel?: OutboundChannel }>(req);
    sendJson(res, 200, approveScheduledMessage(msgId, body));
    return true;
  }
  if (method === 'PATCH' && /^\/api\/scheduler\/messages\/[^/]+\/status$/.test(pathname)) {
    const msgId = pathname.split('/')[4];
    const body = await readJsonBody<{ status: 'sent_manual_confirmed' | 'cancelled' | 'pending_approval' }>(req);
    sendJson(res, 200, updateScheduledMessageStatus(msgId, body.status));
    return true;
  }
  if (method === 'GET' && pathname === '/api/scheduler/contacts') {
    sendJson(res, 200, listContacts());
    return true;
  }
  if (method === 'POST' && pathname === '/api/scheduler/contacts') {
    const body = await readJsonBody<{
      name: string;
      aliases?: string[];
      phoneE164: string;
      activeHoursNote?: string | null;
      preferredChannel?: OutboundChannel;
    }>(req);
    sendJson(res, 201, createContact(body));
    return true;
  }

  // Llamrei Agent & Audit Log
  if (method === 'GET' && pathname === '/api/agent/thread') {
    sendJson(res, 200, {
      messages: listChatMessages(),
      auditLogs: listAuditLogs(),
      aiBudget: getAiBudgetSummary(),
    });
    return true;
  }
  if (method === 'POST' && pathname === '/api/agent/prompt') {
    const body = await readJsonBody<{ prompt: string; contextAttachment?: Record<string, unknown> | null }>(req);
    const out = await handleLlamreiPrompt(body);
    sendJson(res, 200, { ...out, aiBudget: getAiBudgetSummary(), auditLogs: listAuditLogs() });
    return true;
  }
  if (method === 'POST' && /^\/api\/agent\/audit\/[^/]+\/approve$/.test(pathname)) {
    const auditId = pathname.split('/')[4];
    const body = await readJsonBody<{ editedArgs?: Record<string, unknown> }>(req);
    const resAudit = await approveAuditAction(auditId, body.editedArgs);
    if (!resAudit) sendError(res, 404, 'Pending audit not found');
    else sendJson(res, 200, resAudit);
    return true;
  }
  if (method === 'POST' && /^\/api\/agent\/audit\/[^/]+\/undo$/.test(pathname)) {
    const auditId = pathname.split('/')[4];
    const resAudit = undoAuditAction(auditId);
    if (!resAudit) sendError(res, 404, 'Undoable audit not found');
    else sendJson(res, 200, resAudit);
    return true;
  }

  // Market & News
  if (method === 'GET' && pathname === '/api/market/sessions') {
    sendJson(res, 200, getWibMarketSessions());
    return true;
  }
  if (method === 'GET' && pathname === '/api/market/feed') {
    sendJson(res, 200, getMarketAndNewsFeed());
    return true;
  }
  if (method === 'POST' && pathname === '/api/market/refresh') {
    sendJson(res, 200, await refreshLiveFinnhubAndRss());
    return true;
  }
  if (method === 'POST' && pathname === '/api/market/notion-sync') {
    sendJson(res, 200, await syncNotionCalendarDatabase());
    return true;
  }
  if (method === 'PATCH' && /^\/api\/market\/news\/[^/]+\/save$/.test(pathname)) {
    const id = pathname.split('/')[4];
    const body = await readJsonBody<{ saved: boolean }>(req);
    toggleSaveNewsArticle(id, body.saved);
    sendJson(res, 200, { ok: true });
    return true;
  }

  // Fase 2: WhatsApp Chat Export Tag Inbox, Templates, Recurrence, Custom Fields & App Launcher
  if (method === 'GET' && pathname === '/api/wa-export/mentions') {
    sendJson(res, 200, listWaTagMentions());
    return true;
  }
  if (method === 'POST' && pathname === '/api/wa-export/import') {
    const body = await readJsonBody<{
      groupName: string;
      fileName: string;
      contentBase64?: string;
      rawText?: string;
      aliases?: string[];
    }>(req);
    sendJson(res, 200, await importWhatsAppExport(body));
    return true;
  }
  if (method === 'PATCH' && /^\/api\/wa-export\/mentions\/[^/]+$/.test(pathname)) {
    const id = pathname.split('/').pop()!;
    const body = await readJsonBody<{ repliedStatus: 'unreplied' | 'replied' | 'ignored'; linkedTaskId?: string | null }>(req);
    sendJson(res, 200, updateWaTagMentionStatus(id, body.repliedStatus, body.linkedTaskId));
    return true;
  }
  if (method === 'POST' && /^\/api\/wa-export\/mentions\/[^/]+\/accept-event$/.test(pathname)) {
    const id = pathname.split('/')[4];
    const resObj = acceptWaEventProposal(id);
    if (!resObj.ok) sendError(res, 400, resObj.error ?? 'Gagal menerima agenda ke kalender');
    else sendJson(res, 200, resObj);
    return true;
  }
  if (method === 'POST' && /^\/api\/wa-export\/mentions\/[^/]+\/decline-event$/.test(pathname)) {
    const id = pathname.split('/')[4];
    const resObj = declineWaEventProposal(id);
    if (!resObj.ok) sendError(res, 400, resObj.error ?? 'Gagal menolak usulan agenda');
    else sendJson(res, 200, resObj);
    return true;
  }
  if (method === 'PATCH' && /^\/api\/wa-export\/mentions\/[^/]+\/proposal$/.test(pathname)) {
    const id = pathname.split('/')[4];
    const body = await readJsonBody<{ proposedTitle?: string; proposedStart?: string; proposedEnd?: string; proposedLocation?: string }>(req);
    const resObj = updateWaEventProposal(id, body);
    if (!resObj.ok) sendError(res, 400, resObj.error ?? 'Gagal memperbarui usulan agenda');
    else sendJson(res, 200, resObj);
    return true;
  }

  // Baileys WhatsApp Engine (Linked Device via QR & Focused 1-Chat Reply)
  if (method === 'GET' && pathname === '/api/baileys/status') {
    sendJson(res, 200, getBaileysStatus());
    return true;
  }
  if (method === 'POST' && pathname === '/api/baileys/connect') {
    void initBaileysClient();
    sendJson(res, 200, { ok: true, message: 'Inisialisasi Baileys WhatsApp dimulai' });
    return true;
  }
  if (method === 'POST' && pathname === '/api/baileys/sync') {
    const syncedGroups = await syncBaileysGroups();
    sendJson(res, 200, { ok: true, syncedGroups });
    return true;
  }
  if (method === 'POST' && pathname === '/api/baileys/disconnect') {
    disconnectBaileys();
    sendJson(res, 200, { ok: true, message: 'Baileys WhatsApp terputus' });
    return true;
  }
  if (method === 'GET' && pathname === '/api/baileys/threads') {
    sendJson(res, 200, listBaileysThreads());
    return true;
  }
  if (method === 'GET' && /^\/api\/baileys\/threads\/[^/]+$/.test(pathname)) {
    const jid = decodeURIComponent(pathname.split('/')[4]);
    const thread = getBaileysThread(jid);
    if (!thread) sendError(res, 404, 'Chat thread tidak ditemukan');
    else sendJson(res, 200, thread);
    return true;
  }
  if (method === 'POST' && pathname === '/api/baileys/send') {
    const body = await readJsonBody<{ chatJid: string; text: string }>(req);
    const result = await sendBaileysMessage(body.chatJid, body.text);
    if (!result.ok) sendError(res, 400, result.error ?? 'Gagal mengirim pesan');
    else sendJson(res, 200, result);
    return true;
  }
  if (method === 'PATCH' && /^\/api\/workspace\/tasks\/[^/]+\/meta$/.test(pathname)) {
    const taskId = pathname.split('/')[4];
    const body = await readJsonBody<{ recurrenceRule?: RecurrenceRule; customFields?: Record<string, unknown> }>(req);
    const result = setTaskRecurrenceAndCustomFields(taskId, body);
    if (!result.ok) sendError(res, 400, result.error ?? 'Invalid task meta');
    else sendJson(res, 200, { ok: true });
    return true;
  }
  if (method === 'POST' && pathname === '/api/workspace/templates/apply') {
    const body = await readJsonBody<{ templateId: string; listId: string }>(req);
    sendJson(res, 201, { created: applyTaskTemplateToList(body.templateId, body.listId) });
    return true;
  }
  if (method === 'POST' && /^\/api\/launchers\/[^/]+\/open$/.test(pathname)) {
    const id = pathname.split('/')[3];
    sendJson(res, 200, launchWhitelistedApp(id));
    return true;
  }

  // Fase 3: Trading Journal, Linked Docs, Gantt/Workload & CSV/Markdown IO
  if (method === 'GET' && pathname === '/api/journal') {
    sendJson(res, 200, getTradingJournalState());
    return true;
  }
  if (method === 'POST' && pathname === '/api/journal') {
    const body = await readJsonBody<{
      symbol: string;
      direction: TradeDirection;
      session: TradeSession;
      entryPrice: number;
      exitPrice?: number | null;
      stopLoss?: number | null;
      takeProfit?: number | null;
      rMultiple?: number;
      pnlUsd?: number;
      outcome?: TradeOutcome;
      emotion?: TradeEmotion;
      setupReason?: string;
      evaluationNote?: string;
    }>(req);
    const out = createTradingJournalEntry(body);
    if (!out.ok) sendError(res, 400, out.error ?? 'Invalid journal entry');
    else sendJson(res, 201, out.entry);
    return true;
  }
  if (method === 'DELETE' && /^\/api\/journal\/[^/]+$/.test(pathname)) {
    const id = pathname.split('/').pop()!;
    sendJson(res, 200, { ok: deleteTradingJournalEntry(id) });
    return true;
  }
  if (method === 'GET' && pathname === '/api/docs') {
    sendJson(res, 200, listWorkspaceDocs());
    return true;
  }
  if (method === 'POST' && pathname === '/api/docs') {
    const body = await readJsonBody<{
      id?: string;
      spaceId?: string | null;
      linkedTaskId?: string | null;
      title: string;
      contentMd: string;
    }>(req);
    sendJson(res, 201, createOrUpdateWorkspaceDoc(body));
    return true;
  }
  if (method === 'DELETE' && /^\/api\/docs\/[^/]+$/.test(pathname)) {
    const id = pathname.split('/').pop()!;
    sendJson(res, 200, { ok: deleteWorkspaceDoc(id) });
    return true;
  }
  if (method === 'GET' && pathname === '/api/workspace/gantt-workload') {
    sendJson(res, 200, getGanttAndWorkloadSummary());
    return true;
  }
  if (method === 'GET' && pathname === '/api/workspace/export/csv') {
    const urlObj = new URL(req.url ?? '/', 'http://127.0.0.1');
    const listId = urlObj.searchParams.get('listId') ?? undefined;
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="llamrei-tasks.csv"',
    });
    res.end(exportWorkspaceAsCsv(listId));
    return true;
  }
  if (method === 'GET' && pathname === '/api/workspace/export/markdown') {
    const urlObj = new URL(req.url ?? '/', 'http://127.0.0.1');
    const listId = urlObj.searchParams.get('listId') ?? undefined;
    res.writeHead(200, {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': 'attachment; filename="llamrei-tasks.md"',
    });
    res.end(exportWorkspaceAsMarkdown(listId));
    return true;
  }
  if (method === 'POST' && pathname === '/api/workspace/import') {
    const body = await readJsonBody<{ listId: string; format: 'csv' | 'markdown'; content: string }>(req);
    const out = importTasksIntoList(body);
    if (!out.ok) sendError(res, 400, out.error ?? 'Import gagal');
    else sendJson(res, 201, out);
    return true;
  }

  // Direct APK Download Endpoint
  if ((method === 'GET' || method === 'HEAD') && (pathname === '/api/download/apk' || pathname === '/download/llamrei-widgets.apk')) {
    const apkPath = path.resolve(process.cwd(), 'public', 'download', 'llamrei-widgets.apk');
    if (!fs.existsSync(apkPath)) {
      sendError(res, 404, 'File APK belum siap');
      return true;
    }
    const stat = fs.statSync(apkPath);
    res.writeHead(200, {
      'Content-Type': 'application/vnd.android.package-archive',
      'Content-Disposition': 'attachment; filename="llamrei-widgets.apk"',
      'Content-Length': stat.size,
    });
    fs.createReadStream(apkPath).pipe(res);
    return true;
  }

  // Settings & Secrets
  if (method === 'GET' && pathname === '/api/settings') {
    sendJson(res, 200, { settings: getAllSettings(), secretStatus: getSecretStatus() });
    return true;
  }
  if (method === 'PATCH' && pathname === '/api/settings') {
    const body = await readJsonBody<Record<string, unknown>>(req);
    const db = getDb();
    const stmt = db.prepare(
      `INSERT INTO app_settings (key, value_json, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = datetime('now')`,
    );
    for (const [k, v] of Object.entries(body)) {
      stmt.run(k, JSON.stringify(v));
    }
    sendJson(res, 200, getAllSettings());
    return true;
  }
  if (method === 'POST' && pathname === '/api/settings/secrets') {
    const body = await readJsonBody<{ key: SecretKeyName; value: string }>(req);
    const out = setSecret(body.key, body.value);
    sendJson(res, 200, { ...out, secretStatus: getSecretStatus() });
    return true;
  }

  return false;
}

function serveStaticAsset(res: ServerResponse, pathname: string): void {
  if (!fs.existsSync(DIST_DIR)) {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Llamrei API Server running. Run `npm run dev` or `npm run build` for frontend.');
    return;
  }

  const safePath = pathname === '/' ? '/index.html' : pathname;
  let filePath = path.join(DIST_DIR, safePath);
  if (!filePath.startsWith(DIST_DIR) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(DIST_DIR, 'index.html');
  }
  const ext = path.extname(filePath);
  res.writeHead(200, { 'Content-Type': MIME_MAP[ext] ?? 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
}

function getOrCreateNodeApiToken(): string {
  if (process.env.LLAMREI_API_TOKEN) return process.env.LLAMREI_API_TOKEN;
  const dir = process.env.LLAMREI_VAULT_DIR ?? path.resolve(process.cwd(), 'data');
  const tokenFile = path.join(dir, '.api.token');
  if (fs.existsSync(tokenFile)) {
    const existing = fs.readFileSync(tokenFile, 'utf8').trim();
    if (existing.length >= 32) return existing;
  }
  fs.mkdirSync(dir, { recursive: true });
  const generated = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(tokenFile, generated, { mode: 0o600 });
  return generated;
}

function isLoopbackAddress(addr: string | undefined): boolean {
  if (!addr) return false;
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

function isOriginAllowed(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const originHost = new URL(origin).host;
    const reqHost = req.headers.host ?? '';
    if (originHost === reqHost) return true;
    const originHostname = new URL(origin).hostname;
    if ((originHostname === '127.0.0.1' || originHostname === 'localhost') && reqHost.startsWith(originHostname)) {
      return true;
    }
    // Allow Vite dev proxy origin (localhost:5173 / 127.0.0.1:5173) targeting loopback
    if ((originHostname === '127.0.0.1' || originHostname === 'localhost') && isLoopbackAddress(req.socket.remoteAddress)) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function isRemoteRequestAuthorized(
  remoteAddress: string | undefined,
  authHeader: string | undefined,
  apiToken: string,
): boolean {
  if (isLoopbackAddress(remoteAddress)) return true;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return false;
  const presented = authHeader.slice(7);
  if (presented.length !== apiToken.length) return false;
  return crypto.timingSafeEqual(Buffer.from(presented), Buffer.from(apiToken));
}

export function createLlamreiServer(): http.Server {
  const apiToken = getOrCreateNodeApiToken();

  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const pathname = url.pathname;

    try {
      if (pathname.startsWith('/api/')) {
        // 1. CSRF / Cross-Origin Protection
        if (!isOriginAllowed(req)) {
          sendError(res, 403, 'Forbidden cross-origin API request');
          return;
        }
        // 2. Non-loopback requests require Bearer token (tailscale serve proxies via 127.0.0.1 loopback)
        if (!isRemoteRequestAuthorized(req.socket.remoteAddress, req.headers.authorization, apiToken)) {
          sendError(res, 401, 'Unauthorized: Bearer token required for non-loopback access');
          return;
        }

        const handled = await routeApi(req, res, pathname);
        if (!handled) {
          sendError(res, 404, `Unknown API route: ${pathname}`);
        }
        return;
      }
      serveStaticAsset(res, pathname);
    } catch (err) {
      if (err instanceof HttpBadRequestError) {
        if (!res.headersSent) sendError(res, err.status, err.message);
        return;
      }
      console.error('[llamrei-server] error:', err);
      if (!res.headersSent) {
        sendError(res, 500, err instanceof Error ? err.message : 'Internal server error');
      }
    }
  });
}

const isEntrypoint = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntrypoint) {
  initDatabase();
  startBackgroundDaemons();
  autoConnectBaileysIfCredsExist();
  const port = Number(process.env.LLAMREI_PORT ?? 4321);
  // Bind strictly to loopback by default; Tailscale Serve proxies privately to 127.0.0.1
  const host = process.env.LLAMREI_HOST ?? '127.0.0.1';
  const server = createLlamreiServer();
  server.listen(port, host, () => {
    console.log(`[llamrei-core] listening on http://${host}:${port} (local: http://127.0.0.1:${port})`);
  });
}
