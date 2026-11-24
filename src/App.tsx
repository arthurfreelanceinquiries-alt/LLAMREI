import { useCallback, useEffect, useState } from 'react';
import { CalendarAndAlarmView } from './components/alarms/CalendarAndAlarmView';
import { HardAlarmOverlayModal } from './components/alarms/HardAlarmOverlayModal';
import { ClickUpWorkspaceView } from './components/clickup/ClickUpWorkspaceView';
import { TaskDetailDrawer } from './components/clickup/TaskDetailDrawer';
import { GoalsAndLifeOsView } from './components/goals/GoalsAndLifeOsView';
import { LeftClickUpSidebar } from './components/layout/LeftClickUpSidebar';
import { RightLlamreiDrawer } from './components/layout/RightLlamreiDrawer';
import { TopCommandBar } from './components/layout/TopCommandBar';
import { ScheduledChatCenter } from './components/messaging/ScheduledChatCenter';
import { WaTagInboxView } from './components/messaging/WaTagInboxView';
import { CommandPaletteModal } from './components/modals/CommandPaletteModal';
import { SettingsModal } from './components/modals/SettingsModal';
import { MorningBentoView } from './components/morning/MorningBentoView';
import { PhoneHubView } from './components/phonehub/PhoneHubView';
import { TradingJournalView } from './components/trader/TradingJournalView';
import { FocusedChatModal } from './components/watags/FocusedChatModal';
import { apiRequest } from './lib/api-client';
import { ThemeProvider } from './theme/ThemeContext';
import type {
  AlarmReminderItem,
  BootstrapPayload,
  NavTab,
  PhoneNotificationItem,
  TaskItem,
  ThemeId,
} from './types/llamrei';

function DashboardShell() {
  const [data, setData] = useState<BootstrapPayload | null>(null);
  const [activeTab, setActiveTab] = useState<NavTab>('morning');
  const [selectedSpaceId, setSelectedSpaceId] = useState<string | 'ALL'>('ALL');
  const [selectedListId, setSelectedListId] = useState<string | 'ALL'>('ALL');
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [watchlistSymbol, setWatchlistSymbol] = useState('OANDA:XAUUSD');
  const [ringingAlarm, setRingingAlarm] = useState<AlarmReminderItem | null>(null);
  const [toast, setToast] = useState<{ text: string; url?: string } | null>(null);
  const [pendingContext, setPendingContext] = useState<Record<string, unknown> | null>(null);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [focusedChatJid, setFocusedChatJid] = useState<string | null>(null);
  const [copilotOpen, setCopilotOpen] = useState(() => {
    return localStorage.getItem('llamrei_copilot_open') === 'true';
  });

  const toggleCopilot = useCallback(() => {
    setCopilotOpen((v) => {
      const next = !v;
      localStorage.setItem('llamrei_copilot_open', String(next));
      return next;
    });
  }, []);

  const loadBootstrap = useCallback(async () => {
    const payload = await apiRequest<BootstrapPayload>('/api/bootstrap');
    setData(payload);
    const activeRing = payload.alarms.find((a) => a.status === 'ringing');
    if (activeRing) setRingingAlarm(activeRing);
  }, []);

  useEffect(() => {
    void loadBootstrap();
  }, [loadBootstrap]);

  // Global Keyboard Shortcuts (Cmd+K for Command Palette, Cmd+J for Copilot)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCmdOpen((v) => !v);
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        toggleCopilot();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [toggleCopilot]);

  // Real-time SSE listener
  useEffect(() => {
    const es = new EventSource('/api/events');
    const refresh = () => void loadBootstrap();

    es.addEventListener('alarm:ring', (ev) => {
      const alarm = JSON.parse((ev as MessageEvent).data) as AlarmReminderItem;
      setRingingAlarm(alarm);
      refresh();
    });
    es.addEventListener('alarm:soft_reminder', (ev) => {
      const rem = JSON.parse((ev as MessageEvent).data) as AlarmReminderItem;
      setToast({ text: `🔔 ${rem.title}` });
      refresh();
    });
    es.addEventListener('chat:dispatched', (ev) => {
      const msg = JSON.parse((ev as MessageEvent).data) as { recipient_name: string; status: string; waMeUrl?: string };
      setToast({
        text:
          msg.status === 'sent_auto'
            ? `✓ Pesan ke ${msg.recipient_name} berhasil dikirim otomatis`
            : `💬 Waktunya kirim chat ke ${msg.recipient_name}`,
        url: msg.waMeUrl,
      });
      refresh();
    });

    es.addEventListener('wa:message', (ev) => {
      try {
        const raw = JSON.parse((ev as MessageEvent).data) as {
          chatJid?: string;
          message?: { senderName?: string; text?: string };
          senderName?: string;
          text?: string;
        };
        const sender = raw.message?.senderName || raw.senderName || 'Seseorang';
        const txt = raw.message?.text || raw.text || '';
        if (txt) {
          setToast({ text: `💬 [WA] ${sender}: ${txt.slice(0, 50)}` });
        }
      } catch {
        // ignore
      }
      refresh();
    });

    es.addEventListener('wa:proposal_new', (ev) => {
      try {
        const prop = JSON.parse((ev as MessageEvent).data) as { proposedTitle: string };
        setToast({ text: `📅 Usulan Agenda Baru: "${prop.proposedTitle}" - Butuh persetujuan Anda di tab WA Tags.` });
      } catch {
        // ignore
      }
      refresh();
    });

    [
      'alarm:update',
      'workspace:update',
      'chat:update',
      'calendar:update',
      'phone:notification',
      'phone:notification_updated',
      'phone:notification_dismissed',
      'phone:device_update',
      'phone:timeline',
      'agent:message',
      'agent:audit',
      'lifeos:checkin',
      'lifeos:kpi',
      'timer:update',
      'mobile:reconciled',
      'market:news_updated',
      'wa:imported',
      'wa:status',
      'wa:qr',
      'wa:connected',
      'wa:disconnected',
      'wa:tag_mention',
      'wa:proposal_accepted',
      'wa:proposal_declined',
      'journal:update',
      'docs:update',
    ].forEach((evName) => es.addEventListener(evName, refresh));

    return () => es.close();
  }, [loadBootstrap]);

  if (!data) {
    return (
      <div className="min-h-screen flex items-center justify-center font-mono-num text-sm" style={{ color: 'var(--accent)' }}>
        ⚡ Memuat Llamrei Personal Command Dashboard...
      </div>
    );
  }

  const openTask = data.workspace.tasks.find((t) => t.id === openTaskId) ?? null;
  const openTaskSubs = openTask ? data.workspace.tasks.filter((t) => t.parent_task_id === openTask.id) : [];
  const openTaskChats = openTask ? data.scheduledMessages.filter((m) => m.linked_task_id === openTask.id) : [];
  const openTaskDocs = openTask ? data.workspaceDocs.filter((d) => d.linked_task_id === openTask.id) : [];
  const openTaskCount = data.workspace.tasks.filter((t) => !t.parent_task_id && t.status !== 'Done').length;
  const armedAlarmCount = data.alarms.filter((a) => a.enabled === 1 && a.kind === 'hard_alarm').length;
  const pendingChatCount = data.scheduledMessages.filter((m) => m.status === 'pending_approval').length;
  const unrepliedWaTagCount = data.waTagMentions.filter((m) => m.replied_status === 'unreplied').length;

  const sendPromptToLlamrei = async (prompt: string, context?: Record<string, unknown> | null) => {
    setCopilotOpen(true);
    await apiRequest('/api/agent/prompt', { method: 'POST', body: { prompt, contextAttachment: context ?? null } });
    await loadBootstrap();
  };

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--bg-void)', color: 'var(--text-primary)' }}>
      <TopCommandBar
        marketSessions={data.marketSessions.sessions}
        nextAlarm={data.nextAlarm}
        device={data.phoneHub.devices[0] ?? null}
        network={data.network}
        aiBudget={data.aiBudget}
        baileysStatus={data.baileys}
        isCopilotOpen={copilotOpen}
        onToggleCopilot={toggleCopilot}
        onOpenCommandPalette={() => setCmdOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenAlarms={() => setActiveTab('calendar')}
        onOpenPhoneHub={() => setActiveTab('phonehub')}
        onOpenFocusedChat={() => {
          setActiveTab('watags');
        }}
        onTestAlarm={() => void apiRequest('/api/calendar-alarms/alarms/test', { method: 'POST', body: {} })}
      />

      {toast && (
        <div
          className="px-3 py-1.5 text-xs font-mono-num border-b flex items-center justify-between"
          style={{ background: 'var(--accent-soft)', borderColor: 'var(--border-accent)', color: 'var(--accent)' }}
        >
          <span>{toast.text}</span>
          <div className="flex items-center gap-2">
            {toast.url && (
              <a
                href={toast.url}
                target="_blank"
                rel="noreferrer"
                className="px-2 py-0.5 rounded font-bold"
                style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
              >
                Kirim via wa.me ↗
              </a>
            )}
            <button onClick={() => setToast(null)} className="cursor-pointer font-bold">
              ✕
            </button>
          </div>
        </div>
      )}

      {/* 3-PANEL HYBRID WORKSPACE */}
      <div className="flex-1 flex flex-col lg:flex-row min-h-0">
        <LeftClickUpSidebar
          activeTab={activeTab}
          onSelectTab={setActiveTab}
          spaces={data.workspace.spaces}
          folders={data.workspace.folders}
          lists={data.workspace.lists}
          appLaunchers={data.appLaunchers}
          selectedSpaceId={selectedSpaceId}
          selectedListId={selectedListId}
          onSelectWorkspaceScope={(sp, ls) => {
            setSelectedSpaceId(sp);
            setSelectedListId(ls);
          }}
          pendingChatCount={pendingChatCount}
          unrepliedWaTagCount={unrepliedWaTagCount}
          openTaskCount={openTaskCount}
          armedAlarmCount={armedAlarmCount}
          activeTimer={data.workspace.activeTimer}
          onStopTimer={(tid) => void apiRequest(`/api/workspace/tasks/${tid}/timer/stop`, { method: 'POST', body: {} }).then(loadBootstrap)}
          onCreateSpace={(name) => void apiRequest('/api/workspace/spaces', { method: 'POST', body: { name } }).then(loadBootstrap)}
          onLaunchApp={async (launcherId) => {
            const res = await apiRequest<{ ok: boolean; note: string }>(`/api/launchers/${launcherId}/open`, { method: 'POST', body: {} });
            setToast({ text: res.note });
          }}
        />

        {/* CENTER STAGE */}
        <main className="flex-1 min-w-0 p-3 lg:p-4 overflow-y-auto themed-scroll">
          {activeTab === 'morning' && (
            <MorningBentoView
              kpis={data.kpis}
              tasks={data.workspace.tasks}
              alarms={data.alarms}
              calendarEvents={data.calendarEvents}
              scheduledMessages={data.scheduledMessages}
              news={data.marketFeed.news}
              economicEvents={data.marketFeed.economicEvents}
              watchlistSymbol={watchlistSymbol}
              onSelectWatchlistSymbol={setWatchlistSymbol}
              onSaveCheckIn={async (input) => {
                await apiRequest('/api/lifeos/checkin', { method: 'POST', body: input });
                await loadBootstrap();
              }}
              onToggleHabit={async (id, completed) => {
                await apiRequest(`/api/lifeos/habits/${id}/toggle`, { method: 'POST', body: { completed } });
                await loadBootstrap();
              }}
              onCycleTaskStatus={async (task) => {
                const order = ['To Do', 'In Progress', 'Review', 'Done'];
                const next = order[(order.indexOf(task.status) + 1) % order.length];
                await apiRequest(`/api/workspace/tasks/${task.id}`, { method: 'PATCH', body: { status: next } });
                await loadBootstrap();
              }}
              onOpenTask={(t) => setOpenTaskId(t.id)}
              onNavigateTab={setActiveTab}
              onAskLlamreiWithContext={(prompt, ctx) => {
                setPendingContext(ctx);
                void sendPromptToLlamrei(prompt, ctx);
              }}
              onAutoSchedule={() => setActiveTab('goals')}
              onRefreshMarket={async () => {
                await apiRequest('/api/market/refresh', { method: 'POST', body: {} });
                await loadBootstrap();
              }}
            />
          )}

          {activeTab === 'clickup' && (
            <ClickUpWorkspaceView
              spaces={data.workspace.spaces}
              lists={data.workspace.lists}
              tasks={data.workspace.tasks}
              goals={data.workspace.goals}
              templates={data.taskTemplates}
              ganttWorkload={data.ganttWorkload}
              selectedSpaceId={selectedSpaceId}
              selectedListId={selectedListId}
              activeTimer={data.workspace.activeTimer}
              onCreateList={async (spaceId, name) => {
                await apiRequest('/api/workspace/lists', { method: 'POST', body: { spaceId, name } });
                await loadBootstrap();
              }}
              onApplyTemplate={async (templateId, listId) => {
                await apiRequest('/api/workspace/templates/apply', { method: 'POST', body: { templateId, listId } });
                await loadBootstrap();
              }}
              onImportTasks={async (listId, format, content) => {
                const res = await apiRequest<{ importedCount: number }>('/api/workspace/import', {
                  method: 'POST',
                  body: { listId, format, content },
                });
                await loadBootstrap();
                return res;
              }}
              onCreateTask={async (input) => {
                await apiRequest('/api/workspace/tasks', { method: 'POST', body: input });
                await loadBootstrap();
              }}
              onUpdateTask={async (taskId, patch) => {
                await apiRequest(`/api/workspace/tasks/${taskId}`, { method: 'PATCH', body: patch });
                await loadBootstrap();
              }}
              onOpenTask={(t) => setOpenTaskId(t.id)}
              onStartTimer={async (tid) => {
                await apiRequest(`/api/workspace/tasks/${tid}/timer/start`, { method: 'POST', body: {} });
                await loadBootstrap();
              }}
              onStopTimer={async (tid) => {
                await apiRequest(`/api/workspace/tasks/${tid}/timer/stop`, { method: 'POST', body: {} });
                await loadBootstrap();
              }}
            />
          )}

          {activeTab === 'calendar' && (
            <CalendarAndAlarmView
              calendarEvents={data.calendarEvents}
              alarms={data.alarms}
              tasks={data.workspace.tasks}
              onCreateCalendarEvent={async (input) => {
                await apiRequest('/api/calendar-alarms/events', { method: 'POST', body: input });
                await loadBootstrap();
              }}
              onMoveCalendarEvent={async (eventId, startAt) => {
                await apiRequest(`/api/calendar-alarms/events/${eventId}/move`, { method: 'PATCH', body: { startAt } });
                await loadBootstrap();
              }}
              onCreateAlarm={async (input) => {
                await apiRequest('/api/calendar-alarms/alarms', { method: 'POST', body: input });
                await loadBootstrap();
              }}
              onToggleAlarm={async (id, enabled) => {
                await apiRequest(`/api/calendar-alarms/alarms/${id}/toggle`, { method: 'PATCH', body: { enabled } });
                await loadBootstrap();
              }}
              onTestAlarm={async (alarmId) => {
                await apiRequest('/api/calendar-alarms/alarms/test', { method: 'POST', body: { alarmId } });
              }}
              onSnoozeAlarm={async (id, minutes) => {
                await apiRequest(`/api/calendar-alarms/alarms/${id}/snooze`, { method: 'POST', body: { minutes } });
                setRingingAlarm(null);
                await loadBootstrap();
              }}
              onDismissAlarm={async (id) => {
                await apiRequest(`/api/calendar-alarms/alarms/${id}/dismiss`, { method: 'POST', body: {} });
                setRingingAlarm(null);
                await loadBootstrap();
              }}
              onSyncNotion={async () => {
                const res = await apiRequest<{ note: string }>('/api/market/notion-sync', { method: 'POST', body: {} });
                await loadBootstrap();
                return res;
              }}
            />
          )}

          {activeTab === 'phonehub' && (
            <PhoneHubView
              apiConfigured={data.phoneHub.apiConfigured}
              devices={data.phoneHub.devices}
              notifications={data.phoneHub.notifications}
              timeline={data.phoneHub.timeline}
              network={data.network}
              tasks={data.workspace.tasks}
              alarms={data.alarms}
              onSyncNectarLink={async () => {
                await apiRequest('/api/phonehub/sync', { method: 'POST', body: {} });
                await loadBootstrap();
              }}
              onRingPhone={async () => {
                await apiRequest('/api/phonehub/ring', { method: 'POST', body: {} });
              }}
              onMirrorScreen={async (deviceId) => {
                const res = await apiRequest<{ note: string }>('/api/phonehub/mirror', { method: 'POST', body: { deviceId } });
                await loadBootstrap();
                return res;
              }}
              onSendFileOrLink={async (payload) => {
                await apiRequest('/api/phonehub/send', { method: 'POST', body: payload });
                await loadBootstrap();
              }}
              onSendClipboard={async (text) => {
                await apiRequest('/api/phonehub/clipboard', { method: 'POST', body: { text } });
                await loadBootstrap();
              }}
              onCameraCapture={async (mode) => {
                const res = await apiRequest<{ artifactLabel: string }>('/api/phonehub/camera', {
                  method: 'POST',
                  body: { mode },
                });
                await loadBootstrap();
                return res;
              }}
              onToggleControl={async (deviceId, toggle, enabled) => {
                await apiRequest(`/api/phonehub/devices/${deviceId}/toggle`, {
                  method: 'PATCH',
                  body: { toggle, enabled },
                });
                await loadBootstrap();
              }}
              onReplyNotification={async (notifId, replyText) => {
                await apiRequest(`/api/phonehub/notifications/${notifId}/reply`, {
                  method: 'POST',
                  body: { replyText },
                });
                await loadBootstrap();
              }}
              onDismissNotification={async (notifId) => {
                await apiRequest(`/api/phonehub/notifications/${notifId}`, { method: 'DELETE' });
                await loadBootstrap();
              }}
              onSimulateIncomingWa={async (sender, group, body) => {
                await apiRequest('/api/phonehub/notifications/simulate', {
                  method: 'POST',
                  body: { senderOrTitle: sender, conversationGroup: group, bodyText: body },
                });
                await loadBootstrap();
              }}
              onCreateTaskFromWaNotif={async (n: PhoneNotificationItem) => {
                const defaultList = data.workspace.lists[0]?.id ?? 'list_bab4';
                await apiRequest('/api/workspace/tasks', {
                  method: 'POST',
                  body: {
                    listId: defaultList,
                    title: `[WA ${n.sender_or_title}] ${n.body_text.slice(0, 60)}`,
                    priority: n.ai_urgency === 'high' ? 'urgent' : 'high',
                    dueAt: new Date(Date.now() + 2 * 3_600_000).toISOString(),
                    hardAlarmEnabled: n.ai_urgency === 'high',
                  },
                });
                setToast({ text: `Tugas dibuat di ClickUp dari notifikasi WA ${n.sender_or_title}` });
                await loadBootstrap();
              }}
              onConnectTailscalePeer={async (deviceId, tailscaleIp) => {
                const res = await apiRequest<{ message: string }>('/api/phonehub/tailscale-connect', {
                  method: 'POST',
                  body: { deviceId, tailscaleIp },
                });
                await loadBootstrap();
                return res;
              }}
              onReconcileMobileOutbox={async (mutations) => {
                await apiRequest('/api/mobile-widget/reconcile', { method: 'POST', body: { mutations } });
                await loadBootstrap();
              }}
              onToggleTaskDone={async (task: TaskItem) => {
                await apiRequest(`/api/workspace/tasks/${task.id}`, {
                  method: 'PATCH',
                  body: { status: task.status === 'Done' ? 'To Do' : 'Done' },
                });
                await loadBootstrap();
              }}
              onSnoozeAlarm={async (id, minutes) => {
                await apiRequest(`/api/calendar-alarms/alarms/${id}/snooze`, { method: 'POST', body: { minutes } });
                await loadBootstrap();
              }}
              onDismissAlarm={async (id) => {
                await apiRequest(`/api/calendar-alarms/alarms/${id}/dismiss`, { method: 'POST', body: {} });
                await loadBootstrap();
              }}
            />
          )}

          {activeTab === 'scheduler' && (
            <ScheduledChatCenter
              messages={data.scheduledMessages}
              contacts={data.contacts}
              onCreateDraft={async (input) => {
                await apiRequest('/api/scheduler/messages', { method: 'POST', body: input });
                await loadBootstrap();
              }}
              onApproveMessage={async (msgId, edits) => {
                await apiRequest(`/api/scheduler/messages/${msgId}/approve`, { method: 'POST', body: edits ?? {} });
                await loadBootstrap();
              }}
              onUpdateMessageStatus={async (msgId, status) => {
                await apiRequest(`/api/scheduler/messages/${msgId}/status`, { method: 'PATCH', body: { status } });
                await loadBootstrap();
              }}
              onCreateContact={async (input) => {
                await apiRequest('/api/scheduler/contacts', { method: 'POST', body: input });
                await loadBootstrap();
              }}
            />
          )}

          {activeTab === 'watags' && (
            <WaTagInboxView
              mentions={data.waTagMentions}
              liveWaNotifs={data.phoneHub.notifications.filter((n) => n.app_package === 'com.whatsapp')}
              baileys={data.baileys}
              baileysThreads={data.baileysThreads}
              onConnectBaileys={async () => {
                await apiRequest('/api/baileys/connect', { method: 'POST', body: {} });
                await loadBootstrap();
              }}
              onDisconnectBaileys={async () => {
                await apiRequest('/api/baileys/disconnect', { method: 'POST', body: {} });
                await loadBootstrap();
              }}
              onSyncBaileysGroups={async () => {
                const res = await apiRequest<{ ok: boolean; syncedGroups: number }>('/api/baileys/sync', { method: 'POST', body: {} });
                setToast({ text: `✓ Berhasil menyinkronkan ${res.syncedGroups} grup WhatsApp!` });
                await loadBootstrap();
              }}
              onSendBaileysMessage={async (chatJid, text) => {
                await apiRequest('/api/baileys/send', { method: 'POST', body: { chatJid, text } });
                await loadBootstrap();
              }}
              onOpenFocusedChat={(chatJid) => {
                setFocusedChatJid(chatJid ?? data.baileysThreads[0]?.chatJid ?? 'direct');
              }}
              onAcceptProposal={async (mentionId) => {
                const res = await apiRequest<{ ok: boolean; message?: string }>(`/api/wa-export/mentions/${mentionId}/accept-event`, {
                  method: 'POST',
                  body: {},
                });
                setToast({ text: res.message ?? '✓ Agenda berhasil diterima dan masuk ke kalender!' });
                await loadBootstrap();
              }}
              onDeclineProposal={async (mentionId) => {
                await apiRequest(`/api/wa-export/mentions/${mentionId}/decline-event`, {
                  method: 'POST',
                  body: {},
                });
                setToast({ text: 'Usulan agenda ditolak' });
                await loadBootstrap();
              }}
              onImportExportFile={async (input) => {
                const res = await apiRequest<{
                  totalParsedMessages: number;
                  matchedTags: number;
                  insertedNew: number;
                  skippedDuplicates: number;
                }>('/api/wa-export/import', { method: 'POST', body: input });
                await loadBootstrap();
                return res;
              }}
              onUpdateMentionStatus={async (id, repliedStatus) => {
                await apiRequest(`/api/wa-export/mentions/${id}`, { method: 'PATCH', body: { repliedStatus } });
                await loadBootstrap();
              }}
              onCreateTaskFromMention={async (m) => {
                const defaultList = data.workspace.lists[0]?.id ?? 'list_bab4';
                const created = await apiRequest<{ id: string }>('/api/workspace/tasks', {
                  method: 'POST',
                  body: {
                    listId: defaultList,
                    title: `[WA ${m.sender_display}] ${m.quoted_message.slice(0, 60)}`,
                    priority: m.ai_urgency === 'high' ? 'urgent' : 'high',
                    dueAt: new Date(Date.now() + 2 * 3_600_000).toISOString(),
                    hardAlarmEnabled: m.ai_urgency === 'high',
                  },
                });
                await apiRequest(`/api/wa-export/mentions/${m.id}`, {
                  method: 'PATCH',
                  body: { repliedStatus: m.replied_status, linkedTaskId: created.id },
                });
                setToast({ text: `Tugas ClickUp dibuat dari tag WA ${m.sender_display}` });
                await loadBootstrap();
              }}
              onCreateCalendarEventFromMention={async (m) => {
                await apiRequest('/api/calendar-alarms/events', {
                  method: 'POST',
                  body: {
                    title: `[WA ${m.group_name}] ${m.sender_display}: ${m.quoted_message.slice(0, 48)}`,
                    startAt: new Date(Date.now() + 3_600_000).toISOString(),
                    withHardAlarm: m.ai_urgency === 'high',
                  },
                });
                setToast({ text: `Acara kalender dibuat dari tag WA ${m.sender_display}` });
                await loadBootstrap();
              }}
              onScheduleReplyForMention={(m) => {
                void sendPromptToLlamrei(
                  `Jadwalkan chat ke ${m.sender_display} jam 19:00 soal menanggapi pesan di grup ${m.group_name}`,
                  m as unknown as Record<string, unknown>,
                );
              }}
              onReplyLiveNotification={async (notifId, replyText) => {
                await apiRequest(`/api/phonehub/notifications/${notifId}/reply`, {
                  method: 'POST',
                  body: { replyText },
                });
                await loadBootstrap();
              }}
            />
          )}

          {activeTab === 'journal' && (
            <TradingJournalView
              journal={data.tradingJournal}
              onCreateEntry={async (input) => {
                await apiRequest('/api/journal', { method: 'POST', body: input });
                await loadBootstrap();
              }}
              onDeleteEntry={async (id) => {
                await apiRequest(`/api/journal/${id}`, { method: 'DELETE' });
                await loadBootstrap();
              }}
              onAskLlamreiPattern={(summaryPrompt) => void sendPromptToLlamrei(summaryPrompt)}
            />
          )}

          {activeTab === 'goals' && (
            <GoalsAndLifeOsView
              goals={data.workspace.goals}
              bottlenecks={data.bottlenecks}
              onCreateGoal={async (input) => {
                await apiRequest('/api/workspace/goals', { method: 'POST', body: input });
                await loadBootstrap();
              }}
              onComputeAutoSchedule={async (apply) => {
                const res = await apiRequest<{
                  proposals: Array<{ taskId: string; title: string; priority: string; blockStart: string; blockEnd: string; reason: string }>;
                  blockedWindows: Array<{ label: string }>;
                }>('/api/lifeos/auto-schedule', { method: 'POST', body: { apply } });
                if (apply) await loadBootstrap();
                return res;
              }}
            />
          )}
        </main>

        {/* RIGHT LLAMREI CO-COMMANDER DRAWER */}
        {copilotOpen && (
          <RightLlamreiDrawer
            messages={data.chatMessages}
            auditLogs={data.auditLogs}
            pendingContext={pendingContext}
            onClearContext={() => setPendingContext(null)}
            onSendPrompt={sendPromptToLlamrei}
            onClose={() => setCopilotOpen(false)}
            onApproveAudit={async (auditId) => {
              await apiRequest(`/api/agent/audit/${auditId}/approve`, { method: 'POST', body: {} });
              await loadBootstrap();
            }}
            onUndoAudit={async (auditId) => {
              await apiRequest(`/api/agent/audit/${auditId}/undo`, { method: 'POST', body: {} });
              await loadBootstrap();
            }}
          />
        )}
      </div>

      {/* Drawers & Modals */}
      <TaskDetailDrawer
        key={openTask?.id ?? 'none'}
        task={openTask}
        subtasks={openTaskSubs}
        goals={data.workspace.goals}
        linkedChats={openTaskChats}
        linkedDocs={openTaskDocs}
        activeTimer={data.workspace.activeTimer}
        onClose={() => setOpenTaskId(null)}
        onUpdateTask={async (taskId, patch) => {
          await apiRequest(`/api/workspace/tasks/${taskId}`, { method: 'PATCH', body: patch });
          await loadBootstrap();
        }}
        onUpdateTaskMeta={async (taskId, meta) => {
          await apiRequest(`/api/workspace/tasks/${taskId}/meta`, { method: 'PATCH', body: meta });
          await loadBootstrap();
        }}
        onCreateDoc={async (input) => {
          await apiRequest('/api/docs', { method: 'POST', body: input });
          await loadBootstrap();
        }}
        onDeleteDoc={async (docId) => {
          await apiRequest(`/api/docs/${docId}`, { method: 'DELETE' });
          await loadBootstrap();
        }}
        onCreateSubtask={async (parent, title) => {
          await apiRequest('/api/workspace/tasks', {
            method: 'POST',
            body: { listId: parent.list_id, parentTaskId: parent.id, title, priority: parent.priority },
          });
          await loadBootstrap();
        }}
        onDeleteTask={async (taskId) => {
          await apiRequest(`/api/workspace/tasks/${taskId}`, { method: 'DELETE' });
          await loadBootstrap();
        }}
        onStartTimer={async (tid) => {
          await apiRequest(`/api/workspace/tasks/${tid}/timer/start`, { method: 'POST', body: {} });
          await loadBootstrap();
        }}
        onStopTimer={async (tid) => {
          await apiRequest(`/api/workspace/tasks/${tid}/timer/stop`, { method: 'POST', body: {} });
          await loadBootstrap();
        }}
        onScanAttachmentFromPhone={async (taskId) => {
          const res = await apiRequest<{ artifactLabel: string }>('/api/phonehub/camera', {
            method: 'POST',
            body: { mode: 'scan', linkedTaskId: taskId },
          });
          setToast({ text: `📷 Scan Continuity Camera dilampirkan: ${res.artifactLabel}` });
          await loadBootstrap();
        }}
        onAskLlamrei={(prompt, ctx) => {
          setPendingContext(ctx);
          void sendPromptToLlamrei(prompt, ctx);
        }}
      />

      <HardAlarmOverlayModal
        alarm={ringingAlarm}
        onDismiss={(id) => {
          void apiRequest(`/api/calendar-alarms/alarms/${id}/dismiss`, { method: 'POST', body: {} }).then(() => {
            setRingingAlarm(null);
            void loadBootstrap();
          });
        }}
        onDismissAndStartTimer={(alm) => {
          void apiRequest(`/api/calendar-alarms/alarms/${alm.id}/dismiss`, { method: 'POST', body: {} }).then(async () => {
            if (alm.task_id) {
              await apiRequest(`/api/workspace/tasks/${alm.task_id}/timer/start`, { method: 'POST', body: {} });
            }
            setRingingAlarm(null);
            await loadBootstrap();
          });
        }}
        onSnooze={(id, minutes) => {
          void apiRequest(`/api/calendar-alarms/alarms/${id}/snooze`, { method: 'POST', body: { minutes } }).then(() => {
            setRingingAlarm(null);
            void loadBootstrap();
          });
        }}
      />

      <CommandPaletteModal
        open={cmdOpen}
        onClose={() => setCmdOpen(false)}
        tasks={data.workspace.tasks}
        alarms={data.alarms}
        contacts={data.contacts}
        news={data.marketFeed.news}
        onNavigateTab={setActiveTab}
        onSelectTask={(t) => setOpenTaskId(t.id)}
        onAskLlamrei={(p) => void sendPromptToLlamrei(p)}
      />

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={data.settings}
        secretStatus={data.secretStatus}
        onSaveSettings={async (patch) => {
          await apiRequest('/api/settings', { method: 'PATCH', body: patch });
          await loadBootstrap();
        }}
        onSaveSecret={async (key, value) => {
          await apiRequest('/api/settings/secrets', { method: 'POST', body: { key, value } });
          await loadBootstrap();
        }}
      />

      {focusedChatJid !== null && (() => {
        const activeThread =
          data.baileysThreads.find((t) => t.chatJid === focusedChatJid) ??
          data.baileysThreads[0] ??
          null;
        const matchingProposal = data.waTagMentions.find(
          (m) =>
            m.has_event_proposal === 1 &&
            m.proposal_status === 'pending' &&
            activeThread &&
            ((m.sender_display && activeThread.name?.includes(m.sender_display)) ||
             (m.group_name && activeThread.name?.includes(m.group_name))),
        );
        return (
          <FocusedChatModal
            activeThread={activeThread}
            allThreads={data.baileysThreads}
            isConnected={data.baileys?.status === 'connected'}
            pendingProposal={
              matchingProposal
                ? {
                    id: matchingProposal.id,
                    title: matchingProposal.proposed_event_title || 'Agenda Baru',
                    time: matchingProposal.proposed_event_start
                      ? new Date(matchingProposal.proposed_event_start).toLocaleString('id-ID', {
                          dateStyle: 'short',
                          timeStyle: 'short',
                          timeZone: 'Asia/Jakarta',
                        }) + ' WIB'
                      : '-',
                    location: matchingProposal.proposed_event_location,
                  }
                : null
            }
            onSelectThread={(jid) => setFocusedChatJid(jid)}
            onSendMessage={async (chatJid, text) => {
              await apiRequest('/api/baileys/send', { method: 'POST', body: { chatJid, text } });
              await loadBootstrap();
            }}
            onClose={() => setFocusedChatJid(null)}
            onNavigateToQr={() => {
              setFocusedChatJid(null);
              setActiveTab('watags');
            }}
            onAcceptProposal={async (mentionId) => {
              const res = await apiRequest<{ ok: boolean; message?: string }>(`/api/wa-export/mentions/${mentionId}/accept-event`, {
                method: 'POST',
                body: {},
              });
              setToast({ text: res.message ?? '✓ Agenda berhasil diterima dan masuk ke kalender!' });
              await loadBootstrap();
            }}
            onDeclineProposal={async (mentionId) => {
              await apiRequest(`/api/wa-export/mentions/${mentionId}/decline-event`, {
                method: 'POST',
                body: {},
              });
              setToast({ text: 'Usulan agenda ditolak' });
              await loadBootstrap();
            }}
          />
        );
      })()}
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider initialTheme={'tactical' as ThemeId}>
      <DashboardShell />
    </ThemeProvider>
  );
}
