import { X } from 'lucide-react';
import { lazy, useCallback, useEffect, useRef, useState } from 'react';
import { CalendarAndAlarmView, type CalendarTarget } from './components/alarms/CalendarAndAlarmView';
import { HardAlarmOverlayModal } from './components/alarms/HardAlarmOverlayModal';
import { ClickUpWorkspaceView } from './components/clickup/ClickUpWorkspaceView';
import { TaskDetailDrawer } from './components/clickup/TaskDetailDrawer';
import { GoalsAndLifeOsView } from './components/goals/GoalsAndLifeOsView';
import { LeftClickUpSidebar } from './components/layout/LeftClickUpSidebar';
import { RightLlamreiDrawer, type CopilotDraft } from './components/layout/RightLlamreiDrawer';
import { TopCommandBar } from './components/layout/TopCommandBar';
import { ScheduledChatCenter } from './components/messaging/ScheduledChatCenter';
import { WaTagInboxView } from './components/messaging/WaTagInboxView';
import { CommandPaletteModal } from './components/modals/CommandPaletteModal';
import { SettingsModal } from './components/modals/SettingsModal';
import { MorningBentoView } from './components/morning/MorningBentoView';
import { PhoneHubView, type PhoneCommandFeedback } from './components/phonehub/PhoneHubView';
import { TradingJournalView } from './components/trader/TradingJournalView';
import { IntegrationsHubView } from './components/integrations/IntegrationsHubView';
import { FocusedChatModal } from './components/watags/FocusedChatModal';
import { Control } from './components/ui/Control';
import { DialogPanel } from './components/ui/DialogPanel';
import { WorkspaceSection } from './components/ui/WorkspaceSection';
import { isActiveAlarm } from './lib/alarm-state';
import { listTaskStatuses } from './lib/task-status';
import { apiRequest } from './lib/api-client';
import { streamAgentReply, type AgentRequest, type AgentRequestControls } from './lib/agent-client';
import { ThemeProvider } from './theme/ThemeContext';
import type {
  AlarmReminderItem,
  BootstrapPayload,
  NavTab,
  PhoneNotificationItem,
  TaskItem,
} from './types/llamrei';

const MemoryVault = lazy(() => import('./components/memory/MemoryVault').then(({ MemoryVault }) => ({ default: MemoryVault })));
const InboxView = lazy(() => import('./components/inbox/InboxView').then(({ InboxView }) => ({ default: InboxView })));

function DashboardShell() {
  const [data, setData] = useState<BootstrapPayload | null>(null);
  const [activeTab, setActiveTab] = useState<NavTab>('morning');
  const [calendarTarget, setCalendarTarget] = useState<(CalendarTarget & { request: number }) | null>(null);
  const [memoryTarget, setMemoryTarget] = useState<{ id: string; request: number }>();
  const bootstrapRequest = useRef(0);
  const appliedBootstrap = useRef(0);
  const [selectedSpaceId, setSelectedSpaceId] = useState<string | 'ALL'>('ALL');
  const [selectedListId, setSelectedListId] = useState<string | 'ALL'>('ALL');
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [openDocumentId, setOpenDocumentId] = useState<string | null>(null);
  const [copilotDraft, setCopilotDraft] = useState<CopilotDraft | null>(null);
  const clearCopilotDraft = useCallback(() => setCopilotDraft(null), []);
  const [watchlistSymbol, setWatchlistSymbol] = useState('OANDA:XAUUSD');
  const [ringingAlarm, setRingingAlarm] = useState<AlarmReminderItem | null>(null);
  const [toast, setToast] = useState<{ text: string; url?: string } | null>(null);
  const [pendingContext, setPendingContext] = useState<Record<string, unknown> | null>(null);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [desktopSidebar, setDesktopSidebar] = useState(true);
  const [isCompact, setIsCompact] = useState(() => !window.matchMedia('(min-width: 1024px)').matches);
  const [bootstrapError, setBootstrapError] = useState(false);
  const [liveUpdates, setLiveUpdates] = useState(true);
  const [inboxVersion, setInboxVersion] = useState(0);

  useEffect(() => {
    const query = window.matchMedia('(min-width: 1024px)');
    const update = () => {
      setIsCompact(!query.matches);
      setNavigationOpen(false);
    };
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [focusedChatJid, setFocusedChatJid] = useState<string | null>(null);
  const [copilotOpen, setCopilotOpen] = useState(() => {
    return localStorage.getItem('llamrei_copilot_open') === 'true';
  });

  const toggleCopilot = useCallback(() => setCopilotOpen((open) => !open), []);
  useEffect(() => {
    localStorage.setItem('llamrei_copilot_open', String(copilotOpen));
  }, [copilotOpen]);

  const loadBootstrap = useCallback(async () => {
    const request = ++bootstrapRequest.current;
    const payload = await apiRequest<BootstrapPayload>('/api/bootstrap');
    if (request < appliedBootstrap.current) return;
    appliedBootstrap.current = request;
    setData(payload);
    setBootstrapError(false);
    setRingingAlarm(payload.alarms.find((alarm) => alarm.enabled === 1 && alarm.status === 'ringing') ?? null);
  }, []);

  useEffect(() => {
    void loadBootstrap().catch(() => setBootstrapError(true));
  }, [loadBootstrap]);

  // Global Keyboard Shortcuts (Cmd+K for Command Palette, Cmd+J for Copilot)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat || e.isComposing || ringingAlarm?.id) return;
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
  }, [toggleCopilot, ringingAlarm?.id]);

  // Real-time SSE listener
  useEffect(() => {
    const es = new EventSource('/api/events');
    const refresh = () => void loadBootstrap().catch(() => undefined);
    const refreshInbox = () => setInboxVersion((current) => current + 1);
    let disconnected = false;
    es.addEventListener('error', () => {
      disconnected = true;
      setLiveUpdates(false);
    });
    es.addEventListener('open', () => {
      setLiveUpdates(true);
      if (disconnected) { refresh(); refreshInbox(); }
      disconnected = false;
    });
    for (const event of ['wa:message', 'wa:imported', 'wa:status', 'wa:tag_mention', 'phone:notification', 'phone:notification_updated', 'phone:notification_dismissed', 'chat:update', 'chat:dispatched', 'composio:update']) {
      es.addEventListener(event, refreshInbox);
    }

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
            : msg.status === 'reminded_fallback'
            ? `Waktunya kirim chat ke ${msg.recipient_name}`
            : `Pengiriman ke ${msg.recipient_name} belum terkonfirmasi`,
        url: msg.status === 'reminded_fallback' ? msg.waMeUrl : undefined,
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
      'composio:update',
      'ai:providers_update',
    ].forEach((evName) => es.addEventListener(evName, refresh));

    return () => es.close();
  }, [loadBootstrap]);

  if (!data) {
    return (
      <div className="min-h-screen grid place-content-center gap-3 text-center p-4">
        {bootstrapError ? (
          <>
            <p role="alert">Workspace belum dapat dimuat. Periksa koneksi lalu coba lagi.</p>
            <Control onClick={() => {
              setBootstrapError(false);
              void loadBootstrap().catch(() => setBootstrapError(true));
            }}>Coba lagi</Control>
          </>
        ) : <p role="status">Memuat workspace…</p>}
      </div>
    );
  }

  const openDocument = data.workspaceDocs.find(({ id }) => id === openDocumentId);
  const openTask = data.workspace.tasks.find((t) => t.id === openTaskId) ?? null;
  const openTaskSubs = openTask ? data.workspace.tasks.filter((t) => t.parent_task_id === openTask.id) : [];
  const openTaskChats = openTask ? data.scheduledMessages.filter((m) => m.linked_task_id === openTask.id) : [];
  const openTaskDocs = openTask ? data.workspaceDocs.filter((d) => d.linked_task_id === openTask.id) : [];
  const openTaskCount = data.workspace.tasks.filter((t) => !t.parent_task_id && t.status !== 'Done').length;
  const armedAlarmCount = data.alarms.filter((alarm) => alarm.kind === 'hard_alarm' && isActiveAlarm(alarm)).length;
  const pendingChatCount = data.scheduledMessages.filter((m) => m.status === 'pending_approval').length;
  const unrepliedWaTagCount = data.waTagMentions.filter((m) => m.replied_status === 'unreplied').length;
  const connectedAppsCount = data.composio?.connections.filter((c) => c.status === 'active').length ?? 0;

  const navigateTab = (tab: NavTab) => {
    setCalendarTarget(null);
    setMemoryTarget(undefined);
    setActiveTab(tab);
  };

  const openCalendarTarget = (target: CalendarTarget) => {
    setCalendarTarget((current) => ({ ...target, request: (current?.request ?? 0) + 1 }));
    setActiveTab('calendar');
  };

  const openMemory = (id: string) => {
    setMemoryTarget((previous) => ({ id, request: (previous?.request ?? 0) + 1 }));
    setActiveTab('knowledge');
    if (isCompact) setCopilotOpen(false);
  };

  const refreshAfterMutation = async () => {
    try {
      await loadBootstrap();
    } catch {
      setToast({ text: 'Perubahan diterima. Muat ulang untuk melihat keadaan terbaru.' });
    }
  };

  const sendPromptToLlamrei = async (request: AgentRequest, controls: AgentRequestControls) => {
    const result = await streamAgentReply(request, controls);
    setData((current) => {
      if (!current) return current;
      const received = [result.userMessage, result.assistantMessage]
        .filter((message) => message && !current.chatMessages.some(({ id }) => id === message.id));
      return received.length ? { ...current, chatMessages: [...current.chatMessages, ...received] } : current;
    });
    void refreshAfterMutation();
    return result;
  };

  const prepareCopilotDraft = (prompt: string, context?: Record<string, unknown>) => {
    setPendingContext(context ?? null);
    setCopilotDraft({ prompt });
    setCopilotOpen(true);
  };

  const copilot = copilotOpen ? (
      <RightLlamreiDrawer
        messages={data.chatMessages}
        auditLogs={data.auditLogs}
        aiProviders={data.aiProviders}
        connectedAppsCount={connectedAppsCount}
        allowCloudContext={data.settings.ai_allow_cloud_chat_context === true}
        draft={copilotDraft}
        onDraftLoaded={clearCopilotDraft}
        pendingContext={pendingContext}
        onClearContext={(expected) => setPendingContext((current) => expected && current !== expected ? current : null)}
        onSendPrompt={sendPromptToLlamrei}
        onOpenMemory={openMemory}
        onOpenIntegrations={() => {
          setActiveTab('integrations');
          if (isCompact) setCopilotOpen(false);
        }}
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
  ) : null;

  const sidebar = (
    <LeftClickUpSidebar
      onNavigate={() => setNavigationOpen(false)}
      activeTab={activeTab}
      onSelectTab={navigateTab}
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
      connectedAppsCount={connectedAppsCount}
      activeTimer={data.workspace.activeTimer}
      onStopTimer={(tid) => void apiRequest(`/api/workspace/tasks/${tid}/timer/stop`, { method: 'POST', body: {} }).then(loadBootstrap)}
      onCreateSpace={(name) => void apiRequest('/api/workspace/spaces', { method: 'POST', body: { name } }).then(loadBootstrap)}
      onLaunchApp={async (launcherId) => {
        const res = await apiRequest<{ ok: boolean; note: string }>(`/api/launchers/${launcherId}/open`, { method: 'POST', body: {} });
        setToast({ text: res.note });
      }}
    />
  );

  return (
    <div className="workspace-shell">
      <a className="skip-to-workspace" href="#workspace-main">Lewati ke konten</a>
      <TopCommandBar
        marketSessions={data.marketSessions.sessions}
        nextAlarm={data.nextAlarm}
        device={data.phoneHub.devices[0] ?? null}
        baileysStatus={data.baileys}
        isCopilotOpen={copilotOpen}
        isNavigationOpen={isCompact ? navigationOpen : desktopSidebar}
        onToggleNavigation={() => isCompact ? setNavigationOpen((open) => !open) : setDesktopSidebar((open) => !open)}
        onToggleCopilot={toggleCopilot}
        onOpenCommandPalette={() => setCmdOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenAlarms={() => data.nextAlarm
          ? openCalendarTarget({ kind: 'alarm', id: data.nextAlarm.id })
          : navigateTab('calendar')}
        onOpenPhoneHub={() => setActiveTab('phonehub')}
        onOpenFocusedChat={() => {
          setActiveTab('watags');
        }}
      />

      {toast && (
        <div
          className="px-3 py-1.5 text-xs font-mono-num border-b flex items-center justify-between"
          style={{ background: 'var(--accent-soft)', borderColor: 'var(--border-accent)', color: 'var(--accent)' }}
        >
          <span role="status">{toast.text}</span>
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
            <Control aria-label="Tutup notifikasi" onClick={() => setToast(null)}><X aria-hidden="true" /></Control>
          </div>
        </div>
      )}

      {!liveUpdates && (
        <div className="flex flex-wrap items-center justify-between gap-1 border-b border-[var(--border-subtle)] bg-[var(--bg-panel)] px-3 py-1">
          <span role="status" className="text-sm text-[var(--text-secondary)]">Pembaruan otomatis terputus.</span>
          <Control onClick={() => void loadBootstrap().catch(() => setToast({ text: 'Data belum dapat dimuat ulang.' }))}>Muat ulang data</Control>
        </div>
      )}

      {/* 3-PANEL HYBRID WORKSPACE */}
      <div className="workspace-frame">
        {isCompact ? navigationOpen && (
          <DialogPanel label="Navigasi workspace" className="workspace-navigation-dialog" onClose={() => setNavigationOpen(false)}>
            <div className="workspace-navigation-heading">
              <strong>Navigasi</strong>
              <Control aria-label="Tutup navigasi" onClick={() => setNavigationOpen(false)}><X aria-hidden="true" /></Control>
            </div>
            {sidebar}
          </DialogPanel>
        ) : desktopSidebar && <div className="workspace-sidebar">{sidebar}</div>}

        {/* CENTER STAGE */}
        <main id="workspace-main" tabIndex={-1} className="workspace-main themed-scroll">
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
              pendingApprovalCount={data.auditLogs.filter(({ status }) => status === 'pending_approval').length}
              onOpenCalendarTarget={openCalendarTarget}
              onOpenCopilot={() => setCopilotOpen(true)}
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
                const order = listTaskStatuses(data.workspace.lists.find(({ id }) => id === task.list_id), task.status);
                const next = order[(order.indexOf(task.status) + 1) % order.length];
                await apiRequest(`/api/workspace/tasks/${task.id}`, { method: 'PATCH', body: { status: next } });
                await loadBootstrap();
              }}
              onOpenTask={(t) => setOpenTaskId(t.id)}
              onNavigateTab={navigateTab}
              onAskLlamreiWithContext={(prompt, ctx) => {
                prepareCopilotDraft(prompt, ctx);
              }}
              onAutoSchedule={() => navigateTab('goals')}
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
              folders={data.workspace.folders}
              templates={data.taskTemplates}
              ganttWorkload={data.ganttWorkload}
              selectedSpaceId={selectedSpaceId}
              selectedListId={selectedListId}
              activeTimer={data.workspace.activeTimer}
              onCreateList={async (spaceId, name) => {
                await apiRequest('/api/workspace/lists', { method: 'POST', body: { spaceId, name } });
                await refreshAfterMutation();
              }}
              onApplyTemplate={async (templateId, listId) => {
                await apiRequest('/api/workspace/templates/apply', { method: 'POST', body: { templateId, listId } });
                await refreshAfterMutation();
              }}
              onImportTasks={async (listId, format, content) => {
                const res = await apiRequest<{ importedCount: number }>('/api/workspace/import', {
                  method: 'POST',
                  body: { listId, format, content },
                });
                await refreshAfterMutation();
                return res;
              }}
              onCreateTask={async (input) => {
                await apiRequest('/api/workspace/tasks', { method: 'POST', body: input });
                await refreshAfterMutation();
              }}
              onUpdateTask={async (taskId, patch) => {
                await apiRequest(`/api/workspace/tasks/${taskId}`, { method: 'PATCH', body: patch });
                await refreshAfterMutation();
              }}
              onOpenTask={(t) => setOpenTaskId(t.id)}
              onStartTimer={async (tid) => {
                await apiRequest(`/api/workspace/tasks/${tid}/timer/start`, { method: 'POST', body: {} });
                await refreshAfterMutation();
              }}
              onStopTimer={async (tid) => {
                await apiRequest(`/api/workspace/tasks/${tid}/timer/stop`, { method: 'POST', body: {} });
                await refreshAfterMutation();
              }}
            />
          )}

          {activeTab === 'calendar' && (
            <CalendarAndAlarmView
              key={calendarTarget?.request ?? 0}
              target={calendarTarget ?? undefined}
              onOpenTask={setOpenTaskId}
              calendarEvents={data.calendarEvents}
              alarms={data.alarms}
              tasks={data.workspace.tasks}
              onCreateCalendarEvent={async (input) => {
                await apiRequest('/api/calendar-alarms/events', { method: 'POST', body: input });
                await refreshAfterMutation();
              }}
              onMoveCalendarEvent={async (eventId, startAt) => {
                await apiRequest(`/api/calendar-alarms/events/${eventId}/move`, { method: 'PATCH', body: { startAt } });
                await refreshAfterMutation();
              }}
              onCreateAlarm={async (input) => {
                await apiRequest('/api/calendar-alarms/alarms', { method: 'POST', body: input });
                await refreshAfterMutation();
              }}
              onToggleAlarm={async (id, enabled) => {
                await apiRequest(`/api/calendar-alarms/alarms/${id}/toggle`, { method: 'PATCH', body: { enabled } });
                await refreshAfterMutation();
              }}
              onRingAlarm={async (alarmId) => {
                const alarm = await apiRequest<AlarmReminderItem>('/api/calendar-alarms/alarms/test', { method: 'POST', body: { alarmId } });
                setRingingAlarm(alarm);
                void refreshAfterMutation();
              }}
              onSnoozeAlarm={async (id, minutes) => {
                await apiRequest(`/api/calendar-alarms/alarms/${id}/snooze`, { method: 'POST', body: { minutes } });
                setRingingAlarm(null);
                await refreshAfterMutation();
              }}
              onDismissAlarm={async (id) => {
                await apiRequest(`/api/calendar-alarms/alarms/${id}/dismiss`, { method: 'POST', body: {} });
                setRingingAlarm(null);
                await refreshAfterMutation();
              }}
              onSyncNotion={async () => {
                const res = await apiRequest<{ note: string }>('/api/market/notion-sync', { method: 'POST', body: {} });
                await refreshAfterMutation();
                return res;
              }}
            />
          )}

          {activeTab === 'knowledge' && (
            <WorkspaceSection>
              <MemoryVault key={memoryTarget?.request ?? 0} initialId={memoryTarget?.id} documents={data.workspaceDocs} onOpenDocument={setOpenDocumentId} />
            </WorkspaceSection>
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
                const result = await apiRequest<PhoneCommandFeedback>('/api/phonehub/ring', { method: 'POST', body: {} });
                await loadBootstrap();
                return result;
              }}
              onMirrorScreen={(deviceId) => apiRequest<PhoneCommandFeedback>('/api/phonehub/mirror', {
                method: 'POST', body: { deviceId },
              })}
              onSendFileOrLink={async (payload) => {
                const result = await apiRequest<PhoneCommandFeedback>('/api/phonehub/send', { method: 'POST', body: payload });
                await loadBootstrap();
                return result;
              }}
              onSendClipboard={async (text) => {
                const result = await apiRequest<PhoneCommandFeedback>('/api/phonehub/clipboard', { method: 'POST', body: { text } });
                await loadBootstrap();
                return result;
              }}
              onCameraCapture={(mode) => apiRequest<PhoneCommandFeedback>('/api/phonehub/camera', {
                method: 'POST', body: { mode },
              })}
              onToggleControl={async (deviceId, toggle, enabled) => {
                const result = await apiRequest<PhoneCommandFeedback>(`/api/phonehub/devices/${deviceId}/toggle`, {
                  method: 'PATCH',
                  body: { toggle, enabled },
                });
                await loadBootstrap();
                return result;
              }}
              onReplyNotification={(notifId, replyText) =>
                apiRequest<PhoneCommandFeedback>(`/api/phonehub/notifications/${notifId}/reply`, {
                  method: 'POST',
                  body: { replyText },
                })
              }
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
                const res = await apiRequest<PhoneCommandFeedback>('/api/phonehub/tailscale-connect', {
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

          {activeTab === 'inbox' && (
            <WorkspaceSection>
              <InboxView contacts={data.contacts} version={inboxVersion} onOpenIntegrations={() => navigateTab('integrations')} onOpenScheduled={() => {
                navigateTab('scheduler');
                void loadBootstrap().catch(() => undefined);
              }} />
            </WorkspaceSection>
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
                prepareCopilotDraft(
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
              onAskLlamreiPattern={prepareCopilotDraft}
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
              onComputeAutoSchedule={async (apply, expected) => {
                const res = await apiRequest<{
                  proposals: Array<{ taskId: string; title: string; priority: string; blockStart: string; blockEnd: string; reason: string }>;
                  blockedWindows: Array<{ label: string }>;
                }>('/api/lifeos/auto-schedule', { method: 'POST', body: { apply, expected } });
                if (apply) await refreshAfterMutation();
                return res;
              }}
            />
          )}

          {activeTab === 'integrations' && (
            <IntegrationsHubView
              composio={data.composio}
              onRefreshBootstrap={loadBootstrap}
              onOpenSettings={() => setSettingsOpen(true)}
              onAskJarvis={prepareCopilotDraft}
            />
          )}
        </main>

        {/* RIGHT JARVIS // LLAMREI CO-COMMANDER DRAWER */}
        {copilotOpen && (isCompact ? (
          <DialogPanel label="JARVIS" className="workspace-copilot-dialog" onClose={() => setCopilotOpen(false)}>
            {copilot}
          </DialogPanel>
        ) : <div className="workspace-copilot">{copilot}</div>)}
      </div>

      {/* Drawers & Modals */}
      <TaskDetailDrawer
        key={openTask?.id ?? 'none'}
        task={openTask}
        list={data.workspace.lists.find(({ id }) => id === openTask?.list_id)}
        onOpenRelatedTask={setOpenTaskId}
        subtasks={openTaskSubs}
        goals={data.workspace.goals}
        linkedChats={openTaskChats}
        linkedDocs={openTaskDocs}
        activeTimer={data.workspace.activeTimer}
        onClose={() => setOpenTaskId(null)}
        onUpdateTask={async (taskId, patch) => {
          await apiRequest(`/api/workspace/tasks/${taskId}`, { method: 'PATCH', body: patch });
          await refreshAfterMutation();
        }}
        onUpdateTaskMeta={async (taskId, meta) => {
          await apiRequest(`/api/workspace/tasks/${taskId}/meta`, { method: 'PATCH', body: meta });
          await refreshAfterMutation();
        }}
        onSaveDoc={async (input) => {
          await apiRequest('/api/docs', { method: 'POST', body: input });
          await refreshAfterMutation();
        }}
        onDeleteDoc={async (docId) => {
          await apiRequest(`/api/docs/${docId}`, { method: 'DELETE' });
          await refreshAfterMutation();
        }}
        onCreateSubtask={async (parent, title) => {
          await apiRequest('/api/workspace/tasks', {
            method: 'POST',
            body: { listId: parent.list_id, parentTaskId: parent.id, title, priority: parent.priority },
          });
          await refreshAfterMutation();
        }}
        onDeleteTask={async (taskId) => {
          await apiRequest(`/api/workspace/tasks/${taskId}`, { method: 'DELETE' });
          await refreshAfterMutation();
        }}
        onStartTimer={async (tid) => {
          await apiRequest(`/api/workspace/tasks/${tid}/timer/start`, { method: 'POST', body: {} });
          await refreshAfterMutation();
        }}
        onStopTimer={async (tid) => {
          await apiRequest(`/api/workspace/tasks/${tid}/timer/stop`, { method: 'POST', body: {} });
          await refreshAfterMutation();
        }}
        onScanAttachmentFromPhone={async (taskId) => {
          const result = await apiRequest<{ message: string }>('/api/phonehub/camera', {
            method: 'POST',
            body: { mode: 'scan', linkedTaskId: taskId },
          });
          await refreshAfterMutation();
          return result.message;
        }}
        onAskLlamrei={(prompt, ctx) => {
          prepareCopilotDraft(prompt, ctx);
        }}
      />

      {ringingAlarm && (
        <HardAlarmOverlayModal
          key={ringingAlarm.id}
          alarm={ringingAlarm}
          onDismiss={async (id) => {
            await apiRequest(`/api/calendar-alarms/alarms/${id}/dismiss`, { method: 'POST', body: {} });
            setRingingAlarm((current) => current?.id === id ? null : current);
            void loadBootstrap().catch(() => undefined);
          }}
          onDismissAndStartTimer={async (alarm) => {
            await apiRequest(`/api/calendar-alarms/alarms/${alarm.id}/dismiss`, { method: 'POST', body: {} });
            setRingingAlarm((current) => current?.id === alarm.id ? null : current);
            if (alarm.task_id) {
              try {
                await apiRequest(`/api/workspace/tasks/${alarm.task_id}/timer/start`, { method: 'POST', body: {} });
              } catch {
                setToast({ text: 'Alarm dihentikan. Timer belum dapat dimulai.' });
              }
            }
            void loadBootstrap().catch(() => undefined);
          }}
          onSnooze={async (id, minutes) => {
            await apiRequest(`/api/calendar-alarms/alarms/${id}/snooze`, { method: 'POST', body: { minutes } });
            setRingingAlarm((current) => current?.id === id ? null : current);
            void loadBootstrap().catch(() => undefined);
          }}
        />
      )}

      <CommandPaletteModal
        open={cmdOpen}
        onClose={() => setCmdOpen(false)}
        tasks={data.workspace.tasks}
        alarms={data.alarms}
        calendarEvents={data.calendarEvents}
        documents={data.workspaceDocs}
        contacts={data.contacts}
        news={data.marketFeed.news}
        onNavigateTab={navigateTab}
        onSelectTask={(task) => setOpenTaskId(task.id)}
        onSelectEvent={(id) => openCalendarTarget({ kind: 'event', id })}
        onSelectAlarm={(id) => openCalendarTarget({ kind: 'alarm', id })}
        onSelectDocument={setOpenDocumentId}
        onSelectMemory={openMemory}
        onAskLlamrei={prepareCopilotDraft}
      />

      {openDocument && (
        <DialogPanel label="Dokumen workspace" className="workspace-form-dialog" onClose={() => setOpenDocumentId(null)}>
          <div className="flex items-center justify-between gap-2 border-b border-[var(--border-subtle)] px-4 py-2">
            <h2 className="min-w-0 text-base font-semibold [overflow-wrap:anywhere]">{openDocument.title}</h2>
            <Control aria-label="Tutup dokumen" onClick={() => setOpenDocumentId(null)}><X aria-hidden="true" /></Control>
          </div>
          <div className="space-y-3 p-4">
            <p className="whitespace-pre-wrap text-sm leading-relaxed [overflow-wrap:anywhere]">{openDocument.content_md || 'Dokumen ini kosong.'}</p>
            {openDocument.linked_task_id && (
              <Control className="ds-control--outline" onClick={() => {
                setOpenDocumentId(null);
                navigateTab('clickup');
                setOpenTaskId(openDocument.linked_task_id);
              }}>Buka tugas tertaut</Control>
            )}
          </div>
        </DialogPanel>
      )}

      <SettingsModal
        key={settingsOpen ? 'settings-open' : 'settings-closed'}
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={data.settings}
        secretStatus={data.secretStatus}
        aiProviders={data.aiProviders}
        aiBudget={data.aiBudget}
        onSaveSettings={async (patch) => {
          await apiRequest('/api/settings', { method: 'PATCH', body: patch });
          await refreshAfterMutation();
        }}
        onSaveSecret={async (key, value) => {
          await apiRequest('/api/settings/secrets', { method: 'POST', body: { key, value } });
          await refreshAfterMutation();
        }}
        onRefreshProviders={async () => {
          await apiRequest('/api/ai/providers/refresh', { method: 'POST', body: {} });
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
    <ThemeProvider>
      <DashboardShell />
    </ThemeProvider>
  );
}
