import type { AgentComposioTool, ComposioTarget } from '../services/composio.service.ts';
import type { UnifiedToolDef } from './provider-types.ts';

export interface RegisteredTool extends UnifiedToolDef {
  mode: 'read' | 'approval';
  label: string;
  target?: ComposioTarget;
}

const localTools: RegisteredTool[] = [
  {
    name: 'get_morning_briefing_data', mode: 'read', label: 'Ringkasan pagi',
    description: 'Membaca ringkasan lengkap hari ini: Tilt Guard, KPI tugas, alarm berikutnya, notifikasi HP, dan kalender ekonomi.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'list_clickup_tasks', mode: 'read', label: 'Tugas workspace',
    description: 'Membaca daftar tugas ClickUp lokal (bisa filter status, priority, atau kata kunci search).',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        status: { type: 'string', description: 'Filter status mis. To Do, In Progress, Review, Done' },
        priority: { type: 'string', description: 'urgent, high, normal, low' },
        search: { type: 'string', description: 'Kata kunci judul tugas' },
      },
    },
  },
  {
    name: 'list_calendar_and_alarms', mode: 'read', label: 'Kalender dan alarm',
    description: 'Membaca agenda kalender dan daftar alarm/reminder aktif.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'list_wa_mentions_and_proposals', mode: 'read', label: 'Mention WhatsApp',
    description: 'Membaca mention WhatsApp yang belum dibalas dan usulan agenda kalender yang menunggu persetujuan.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_trading_journal_summary', mode: 'read', label: 'Jurnal trading',
    description: 'Membaca statistik jurnal trading (win rate, total R-multiple, net PnL, pola emosi calm vs tilt).',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'schedule_outbound_chat', mode: 'approval', label: 'schedule_outbound_chat',
    description: 'Menyiapkan draf & jadwal pesan keluar (WhatsApp/Telegram) untuk disetujui pengguna di Approval Card.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        recipientName: { type: 'string', minLength: 1, maxLength: 160 },
        purpose: { type: 'string' },
        messageBody: { type: 'string', minLength: 1, maxLength: 5000 },
        scheduledAtIso: { type: 'string', format: 'date-time' },
      },
      required: ['recipientName', 'purpose', 'messageBody', 'scheduledAtIso'],
    },
  },
  {
    name: 'create_clickup_task', mode: 'approval', label: 'create_clickup_task',
    description: 'Membuat tugas baru di ruang kerja ClickUp beserta tenggat, jadwal kalender, dan opsi Hard Alarm.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        title: { type: 'string', minLength: 1, maxLength: 300 },
        listId: { type: 'string' },
        priority: { type: 'string', enum: ['urgent', 'high', 'normal', 'low'] },
        dueAtIso: { type: 'string', format: 'date-time' },
        hardAlarm: { type: 'boolean' },
        subtasks: { type: 'array', maxItems: 20, items: { type: 'string', minLength: 1, maxLength: 300 } },
      },
      required: ['title'],
    },
  },
  {
    name: 'set_task_alarm_and_calendar', mode: 'approval', label: 'set_task_alarm_and_calendar',
    description: 'Memasang Hard Alarm & blok Kalender Website pada waktu tertentu.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        title: { type: 'string', minLength: 1, maxLength: 300 },
        triggerAtIso: { type: 'string', format: 'date-time' },
        taskId: { type: 'string' },
      },
      required: ['title', 'triggerAtIso'],
    },
  },
  {
    name: 'auto_schedule_clickup_day', mode: 'approval', label: 'auto_schedule_clickup_day',
    description: 'Menyusun blok jadwal tugas ClickUp hari ini gaya Motion, menghindari rapat & rilis CPI/FOMC.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'control_paired_phone', mode: 'approval', label: 'control_paired_phone',
    description: 'Mengontrol HP Android via NectarLink (dnd_on, dnd_off, find_phone).',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: { action: { type: 'string', enum: ['dnd_on', 'dnd_off', 'find_phone'] } },
      required: ['action'],
    },
  },
];

export function getAgentToolRegistry(externalTools: AgentComposioTool[]): Map<string, RegisteredTool> {
  const registry = new Map(localTools.map((tool) => [tool.name, tool]));
  const ambiguous = new Set<string>();
  for (const tool of externalTools) {
    if (ambiguous.has(tool.name)) continue;
    if (registry.has(tool.name)) {
      registry.delete(tool.name);
      ambiguous.add(tool.name);
      continue;
    }
    registry.set(tool.name, {
      ...tool,
      label: tool.target.toolkitSlug.toUpperCase(),
      mode: tool.readOnly ? 'read' : 'approval',
    });
  }
  return registry;
}
