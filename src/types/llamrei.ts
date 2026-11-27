export type ThemeId = 'tactical' | 'hybrid' | 'obsidian' | 'bento';

export type NavTab = 'morning' | 'clickup' | 'calendar' | 'phonehub' | 'scheduler' | 'watags' | 'journal' | 'goals' | 'integrations';

export type AiProviderId =
  | 'auto'
  | 'opencode_zen'
  | 'opencode_cli'
  | 'openrouter'
  | 'groq'
  | 'ollama'
  | 'gemini'
  | 'local';

export interface AiModelOption {
  id: string;
  name: string;
  provider: Exclude<AiProviderId, 'auto' | 'local'>;
  isFree: boolean;
  supportsTools: boolean;
  contextLimit?: number;
  note?: string;
}

export interface AiProviderCatalogSummary {
  activeProvider: AiProviderId;
  assistantPersona: 'jarvis' | 'llamrei';
  opencodeCliAvailable: boolean;
  providers: Array<{
    id: Exclude<AiProviderId, 'auto' | 'local'>;
    label: string;
    configured: boolean;
    isFreePrimary: boolean;
    selectedModel: string;
    models: AiModelOption[];
  }>;
}

export interface ComposioToolkitItem {
  slug: string;
  name: string;
  category: string;
  description: string;
  logo?: string | null;
  authSchemes?: string[];
  connectedStatus?: string | null;
  connectedAccountId?: string | null;
  enabledForAgent?: boolean;
}

export interface ComposioConnectionItem {
  id: string;
  toolkit_slug: string;
  toolkit_name: string;
  auth_config_id: string | null;
  connected_account_id: string | null;
  status: 'pending' | 'active' | 'expired' | 'disconnected' | 'failed';
  redirect_url: string | null;
  account_label: string | null;
  updated_at: string;
}

export interface ComposioToolItem {
  slug: string;
  name: string;
  description: string;
  toolkitSlug: string;
  readOnly: boolean;
  inputParameters: Record<string, unknown>;
}

export interface ComposioToolLogItem {
  id: string;
  tool_slug: string;
  toolkit_slug: string;
  arguments_json: string;
  status: 'success' | 'failed' | 'pending_approval';
  result_summary: string | null;
  created_at: string;
}

export interface ComposioState {
  configured: boolean;
  userId: string;
  enabledToolkits: string[];
  connections: ComposioConnectionItem[];
  recentLogs: ComposioToolLogItem[];
  curatedToolkits: ComposioToolkitItem[];
}

export interface MacroGoal {
  id: string;
  title: string;
  category: 'academic' | 'trading' | 'organization' | 'personal' | 'financial';
  target_date: string | null;
  target_metric_label: string | null;
  progress_percent: number;
  status: 'active' | 'achieved' | 'paused';
}

export interface SpaceItem {
  id: string;
  name: string;
  color: string;
  icon: string;
  sort_order: number;
}

export interface FolderItem {
  id: string;
  space_id: string;
  name: string;
  sort_order: number;
}

export interface ListItem {
  id: string;
  space_id: string;
  folder_id: string | null;
  name: string;
  statuses_json: string;
  sort_order: number;
}

export interface TaskItem {
  id: string;
  list_id: string;
  parent_task_id: string | null;
  goal_id: string | null;
  title: string;
  description_md: string;
  status: string;
  priority: 'urgent' | 'high' | 'normal' | 'low';
  start_at: string | null;
  due_at: string | null;
  reminder_offsets_json: string;
  hard_alarm_enabled: number;
  hard_alarm_at: string | null;
  time_estimate_minutes: number;
  time_spent_seconds: number;
  postponed_count: number;
  recurrence_rule?: 'none' | 'daily' | 'weekdays' | 'weekly' | 'monthly';
  auto_scheduled_block_start: string | null;
  auto_scheduled_block_end: string | null;
  tags_json: string;
  checklist_json: string;
  custom_fields_json?: string;
  attachments_json: string;
  sort_order: number;
}

export interface ActiveTimer {
  id: string;
  task_id: string;
  task_title: string;
  started_at: string;
}

export interface CalendarEventItem {
  id: string;
  source: 'clickup_task' | 'notion' | 'google' | 'scheduled_chat' | 'local';
  linked_task_id: string | null;
  title: string;
  start_at: string;
  end_at: string | null;
  color: string;
  has_hard_alarm: number;
  notes: string | null;
}

export interface AlarmReminderItem {
  id: string;
  task_id: string | null;
  calendar_event_id: string | null;
  title: string;
  subtitle: string | null;
  kind: 'soft_reminder' | 'hard_alarm';
  trigger_at: string;
  offset_minutes: number;
  sound_preset: 'tactical_pulse' | 'siren_urgent' | 'zen_chime' | 'bell_classic';
  ring_phone_nectarlink: number;
  enabled: number;
  status: 'armed' | 'ringing' | 'snoozed' | 'dismissed' | 'completed';
  snooze_count: number;
  snoozed_until: string | null;
}

export interface ContactItem {
  id: string;
  name: string;
  aliases_json: string;
  phone_e164: string;
  timezone: string;
  active_hours_note: string | null;
  preferred_channel: 'wa_gateway' | 'nectarlink_bridge' | 'wa_me_manual' | 'telegram' | 'email';
}

export interface ScheduledMessageItem {
  id: string;
  contact_id: string | null;
  recipient_name: string;
  recipient_address: string;
  channel: 'wa_gateway' | 'nectarlink_bridge' | 'wa_me_manual' | 'telegram' | 'email';
  purpose: string;
  message_body: string;
  scheduled_at: string;
  status: string;
  linked_task_id: string | null;
  waMeUrl: string;
}

export interface PairedDeviceItem {
  id: string;
  name: string;
  platform: string;
  android_version: string;
  online: number;
  link_type: string;
  lan_ip: string | null;
  tailscale_ip: string | null;
  tailscale_dns_name: string | null;
  active_transport: 'lan' | 'tailscale' | 'offline_cache';
  latency_ms: number;
  battery_level: number;
  battery_charging: number;
  dnd_enabled: number;
  auto_dnd_on_deepwork: number;
  torch_enabled: number;
  wifi_enabled: number;
  bt_enabled: number;
  hotspot_enabled: number;
  phone_as_speaker: number;
  play_on_phone: number;
  phone_sound_on_pc: number;
  media_title: string | null;
  media_artist: string | null;
  media_playing: number;
}

export interface PhoneNotificationItem {
  id: string;
  device_id: string | null;
  app_package: string;
  app_name: string;
  sender_or_title: string;
  conversation_group: string | null;
  body_text: string;
  otp_code: string | null;
  can_reply: number;
  is_mention_tag: number;
  ai_intent: string | null;
  ai_urgency: string | null;
  replied_text: string | null;
  replied_at: string | null;
  received_at: string;
}

export interface TimelineItem {
  id: string;
  device_name: string;
  kind: string;
  direction: string;
  title: string;
  detail: string | null;
  created_at: string;
}

export interface DailyCheckInItem {
  date_wib: string;
  sleep_hours: number;
  energy_level: number;
  mental_state: 'calm' | 'focused' | 'rushed' | 'tilted' | 'exhausted';
  tilt_risk_level: 'low' | 'moderate' | 'high';
  tilt_guard_advice: string | null;
}

export interface HabitItem {
  id: string;
  title: string;
  current_streak: number;
  best_streak: number;
  completedToday: boolean;
}

export interface KpiSummary {
  todayCheckIn: DailyCheckInItem | null;
  executionScorePercent: number;
  completedTasks: number;
  totalTasks: number;
  deepWorkHoursTotal: number;
  habits: HabitItem[];
  habitCompletionPercent: number;
}

export interface MarketSessionItem {
  id: string;
  name: string;
  localTimeStr: string;
  wibHoursLabel: string;
  isOpen: boolean;
}

export interface NewsArticleItem {
  id: string;
  source_name: string;
  category: string;
  title: string;
  url: string;
  published_at: string;
  summary_raw: string | null;
  ai_topics_json: string;
  is_saved: number;
}

export interface EconomicEventItem {
  id: string;
  country: string;
  event_name: string;
  impact: 'high' | 'medium' | 'low';
  scheduled_at: string;
  forecast_val: string | null;
  previous_val: string | null;
}

export interface ApprovalCard {
  auditId: string;
  toolName: string;
  title: string;
  summary: string;
  status: 'pending_approval' | 'approved_executed' | 'rejected' | 'undone' | 'failed';
  executionNote?: string;
  executionOutcome?: 'denied' | 'failed' | 'unknown';
  args: Record<string, unknown>;
  scheduledMessageId?: string;
  waMeUrl?: string;
}

export interface ChatMessageItem {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  approval_card_json: string | null;
  model_used: string | null;
  created_at: string;
}

export interface AuditLogItem {
  id: string;
  user_command: string;
  tool_name: string;
  status: string;
  undo_payload_json?: string | null;
  created_at: string;
}

export interface NetworkMeshState {
  port: number;
  lanUrls: string[];
  tailscale: {
    installed: boolean;
    running: boolean;
    selfIp: string | null;
    selfDnsName: string | null;
    serveUrl: string | null;
    peers: Array<{ id: string; hostname: string; tailscaleIp: string | null; os: string; online: boolean }>;
  };
  recommendedMobileUrl: string;
  qrDataUrl: string | null;
}

export type WaTopicCategory = 'tugas_kuliah' | 'skripsi' | 'rapat_organisasi' | 'ajakan_pergi' | 'umum';
export type WaProposalStatus = 'none' | 'pending' | 'accepted' | 'declined';

export interface WaTagMentionItem {
  id: string;
  group_name: string;
  sender_display: string;
  message_timestamp: string;
  quoted_message: string;
  context_before: string | null;
  context_after: string | null;
  matched_alias: string;
  ai_intent: string;
  ai_urgency: 'high' | 'medium' | 'low';
  replied_status: 'unreplied' | 'replied' | 'ignored';
  linked_task_id: string | null;
  topic_category?: WaTopicCategory;
  has_event_proposal?: number;
  proposed_event_title?: string | null;
  proposed_event_start?: string | null;
  proposed_event_end?: string | null;
  proposed_event_location?: string | null;
  proposal_status?: WaProposalStatus;
  linked_calendar_event_id?: string | null;
}

export interface TaskTemplateItem {
  id: string;
  name: string;
  category: string;
  tasks_json: string;
}

export interface AppLauncherItem {
  id: string;
  label: string;
  command_key: string;
  icon: string;
  description: string | null;
}

export interface TradingJournalEntryItem {
  id: string;
  symbol: string;
  direction: 'buy' | 'sell';
  session: 'sydney' | 'tokyo' | 'london' | 'new_york';
  entry_price: number;
  exit_price: number | null;
  stop_loss: number | null;
  take_profit: number | null;
  r_multiple: number;
  pnl_usd: number;
  outcome: 'win' | 'loss' | 'breakeven' | 'open';
  emotion: 'calm' | 'focused' | 'fomo' | 'revenge' | 'hesitant' | 'tilted';
  setup_reason: string;
  evaluation_note: string;
  checkin_date_wib: string | null;
  created_at: string;
}

export interface TradingJournalState {
  entries: TradingJournalEntryItem[];
  stats: {
    totalTrades: number;
    closedTrades: number;
    winRatePercent: number;
    totalR: number;
    netPnlUsd: number;
    calmWinRatePercent: number;
    tiltLossCount: number;
    patternSummary: string;
  };
}

export interface WorkspaceDocItem {
  id: string;
  space_id: string | null;
  linked_task_id: string | null;
  title: string;
  content_md: string;
  updated_at: string;
}

export interface GanttWorkloadState {
  timelineTasks: Array<{
    id: string;
    title: string;
    status: string;
    priority: string;
    startAt: string;
    endAt: string;
    estimateMinutes: number;
  }>;
  weeklyWorkload: Array<{ dateWib: string; taskCount: number; estimatedMinutes: number }>;
}

export interface BaileysChatMessage {
  id: string;
  chatJid: string;
  senderName: string;
  text: string;
  timestamp: string;
  isFromMe: boolean;
}

export interface BaileysChatThread {
  chatJid: string;
  name: string;
  lastMessage: string;
  lastTimestamp: string;
  unreadCount: number;
  messages: BaileysChatMessage[];
}

export interface BaileysStatus {
  status: 'disconnected' | 'connecting' | 'awaiting_qr' | 'connected';
  qrDataUrl: string | null;
  userJid: string | null;
  userName: string | null;
  activeChatsCount: number;
}

export interface BootstrapPayload {
  workspace: {
    goals: MacroGoal[];
    spaces: SpaceItem[];
    folders: FolderItem[];
    lists: ListItem[];
    tasks: TaskItem[];
    dependencies: Array<{ task_id: string; depends_on_task_id: string }>;
    activeTimer: ActiveTimer | null;
  };
  bottlenecks: {
    postponedTasks: Array<{ id: string; title: string; postponed_count: number; status: string; priority: string }>;
    spaceTimeBreakdown: Array<{ space_name: string; color: string; total_minutes: number; task_count: number; done_count: number }>;
    summaryAdvice: string;
  };
  calendarEvents: CalendarEventItem[];
  alarms: AlarmReminderItem[];
  nextAlarm: AlarmReminderItem | null;
  kpis: KpiSummary;
  contacts: ContactItem[];
  scheduledMessages: ScheduledMessageItem[];
  phoneHub: {
    apiConfigured: boolean;
    tokenPath: string | null;
    devices: PairedDeviceItem[];
    notifications: PhoneNotificationItem[];
    timeline: TimelineItem[];
  };
  marketSessions: {
    wibTime: string;
    wibDate: string;
    sessions: MarketSessionItem[];
  };
  marketFeed: {
    news: NewsArticleItem[];
    economicEvents: EconomicEventItem[];
  };
  chatMessages: ChatMessageItem[];
  auditLogs: AuditLogItem[];
  aiBudget: {
    monthlySpentUsd: number;
    monthlyCapUsd: number;
    remainingUsd: number;
    blocked: boolean;
    callsCount: number;
    actualSpentUsd: number;
    estimatedSpentUsd: number;
  };
  aiProviders: AiProviderCatalogSummary;
  composio: ComposioState;
  waTagMentions: WaTagMentionItem[];
  taskTemplates: TaskTemplateItem[];
  appLaunchers: AppLauncherItem[];
  tradingJournal: TradingJournalState;
  workspaceDocs: WorkspaceDocItem[];
  ganttWorkload: GanttWorkloadState;
  settings: Record<string, unknown>;
  secretStatus: Record<string, { configured: boolean; masked: string | null }>;
  network: NetworkMeshState;
  baileys: BaileysStatus;
  baileysThreads: BaileysChatThread[];
}
