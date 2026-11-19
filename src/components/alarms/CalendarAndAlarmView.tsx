import { useState } from 'react';
import type { AlarmReminderItem, CalendarEventItem, TaskItem } from '../../types/llamrei';
import { InteractiveVisualCalendar } from './InteractiveVisualCalendar';

interface Props {
  calendarEvents: CalendarEventItem[];
  alarms: AlarmReminderItem[];
  tasks: TaskItem[];
  onCreateCalendarEvent: (input: { title: string; startAt: string; withHardAlarm: boolean }) => Promise<void>;
  onMoveCalendarEvent: (eventId: string, newStartAt: string) => Promise<void>;
  onCreateAlarm: (input: { taskId?: string | null; title: string; triggerAt: string; soundPreset: AlarmReminderItem['sound_preset'] }) => Promise<void>;
  onToggleAlarm: (alarmId: string, enabled: boolean) => Promise<void>;
  onTestAlarm: (alarmId?: string) => Promise<void>;
  onSnoozeAlarm: (alarmId: string, minutes: number) => Promise<void>;
  onDismissAlarm: (alarmId: string) => Promise<void>;
  onSyncNotion: () => Promise<{ note: string }>;
}

export function CalendarAndAlarmView({
  calendarEvents,
  alarms,
  tasks,
  onCreateCalendarEvent,
  onMoveCalendarEvent,
  onCreateAlarm,
  onToggleAlarm,
  onTestAlarm,
  onSnoozeAlarm,
  onDismissAlarm,
  onSyncNotion,
}: Props) {
  const [evTitle, setEvTitle] = useState('');
  const [evStart, setEvStart] = useState('');
  const [evAlarm, setEvAlarm] = useState(true);

  const [almTitle, setAlmTitle] = useState('');
  const [almTaskId, setAlmTaskId] = useState('');
  const [almTime, setAlmTime] = useState('');
  const [almPreset, setAlmPreset] = useState<AlarmReminderItem['sound_preset']>('tactical_pulse');
  const [notionNote, setNotionNote] = useState<string | null>(null);

  const hardAlarms = alarms.filter((a) => a.kind === 'hard_alarm');
  const softReminders = alarms.filter((a) => a.kind === 'soft_reminder');

  const shiftEventByMinutes = (ev: CalendarEventItem, deltaMinutes: number) => {
    const startMs = Date.parse(ev.start_at);
    if (Number.isNaN(startMs)) return;
    const nextStart = new Date(startMs + deltaMinutes * 60_000).toISOString();
    void onMoveCalendarEvent(ev.id, nextStart);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
        <div>
          <div className="text-xs font-mono-num" style={{ color: 'var(--accent)' }}>
            KALENDER WEBSITE & MESIN ALARM 2-TINGKAT (FR-60..62)
          </div>
          <h1 className="text-sm font-bold">Sinkronisasi Dua Arah Task ClickUp ↔ Kalender ↔ Hard Alarm</h1>
        </div>
        <div className="flex gap-2">
          <button
            onClick={async () => {
              const r = await onSyncNotion();
              setNotionNote(r.note);
            }}
            className="px-2.5 py-1 rounded text-xs font-mono-num border cursor-pointer"
            style={{ background: 'var(--bg-card)', borderColor: 'var(--border-subtle)', color: '#c084fc' }}
          >
            ↻ Sync Notion Calendar
          </button>
          <button
            onClick={() => void onTestAlarm()}
            className="px-2.5 py-1 rounded text-xs font-mono-num font-bold cursor-pointer bg-amber-500 text-black"
          >
            🔔 Tes Bunyi Hard Alarm
          </button>
        </div>
      </div>

      {notionNote && (
        <div className="text-xs font-mono-num px-3 py-1.5 rounded border" style={{ background: 'var(--bg-card)', borderColor: 'var(--border-subtle)' }}>
          Notion Sync: {notionNote}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
        {/* LEFT: UNIFIED WEBSITE CALENDAR */}
        <div className="themed-card p-3 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono-num font-bold" style={{ color: 'var(--text-secondary)' }}>
              📅 KALENDER WEBSITE TERPADU ({calendarEvents.length})
            </span>
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Geser jam otomatis memperbarui Task & Alarm
            </span>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!evTitle.trim() || !evStart) return;
              void onCreateCalendarEvent({
                title: evTitle.trim(),
                startAt: new Date(evStart).toISOString(),
                withHardAlarm: evAlarm,
              });
              setEvTitle('');
            }}
            className="flex flex-wrap gap-1.5 text-xs"
          >
            <input
              value={evTitle}
              onChange={(e) => setEvTitle(e.target.value)}
              placeholder="+ Agenda kalender baru..."
              className="flex-1 min-w-[150px] px-2 py-1 rounded border outline-none"
              style={{ background: 'var(--bg-void)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
            />
            <input
              type="datetime-local"
              value={evStart}
              onChange={(e) => setEvStart(e.target.value)}
              className="px-2 py-1 rounded border font-mono-num"
              style={{ background: 'var(--bg-void)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
            />
            <label className="flex items-center gap-1 font-mono-num cursor-pointer">
              <input type="checkbox" checked={evAlarm} onChange={(e) => setEvAlarm(e.target.checked)} />
              <span>⏰</span>
            </label>
            <button type="submit" className="px-2.5 py-1 rounded font-bold cursor-pointer" style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}>
              + Acara
            </button>
          </form>

          <div className="space-y-1.5 max-h-[380px] overflow-y-auto themed-scroll pr-1">
            {calendarEvents.map((ev) => (
              <div
                key={ev.id}
                className="p-2 rounded bg-black/25 border-l-4 flex items-center justify-between gap-2 text-xs"
                style={{ borderLeftColor: ev.color }}
              >
                <div className="min-w-0">
                  <div className="font-semibold truncate">
                    {ev.has_hard_alarm === 1 ? '⏰ ' : ''}
                    {ev.title}
                  </div>
                  <div className="font-mono-num" style={{ color: 'var(--text-muted)' }}>
                    {new Date(ev.start_at).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'short', timeStyle: 'short' })} WIB ·{' '}
                    <span className="uppercase">{ev.source}</span>
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0 font-mono-num">
                  <button
                    onClick={() => shiftEventByMinutes(ev, -30)}
                    className="px-1.5 py-0.5 rounded border hover:bg-white/10 cursor-pointer"
                    style={{ borderColor: 'var(--border-subtle)' }}
                    title="Majukan 30 menit"
                  >
                    -30m
                  </button>
                  <button
                    onClick={() => shiftEventByMinutes(ev, 30)}
                    className="px-1.5 py-0.5 rounded border hover:bg-white/10 cursor-pointer"
                    style={{ borderColor: 'var(--border-subtle)' }}
                    title="Mundurkan 30 menit"
                  >
                    +30m
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* RIGHT: 2-TIER ALARM & REMINDER CENTER */}
        <div className="themed-card p-3 space-y-3">
          <div className="text-xs font-mono-num font-bold" style={{ color: 'var(--text-secondary)' }}>
            ⏰ HARD ALARMS ({hardAlarms.length}) & 🔔 SOFT REMINDERS ({softReminders.length})
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!almTitle.trim() || !almTime) return;
              void onCreateAlarm({
                taskId: almTaskId || null,
                title: almTitle.trim(),
                triggerAt: new Date(almTime).toISOString(),
                soundPreset: almPreset,
              });
              setAlmTitle('');
            }}
            className="grid grid-cols-2 gap-1.5 text-xs bg-black/25 p-2 rounded border"
            style={{ borderColor: 'var(--border-subtle)' }}
          >
            <input
              value={almTitle}
              onChange={(e) => setAlmTitle(e.target.value)}
              placeholder="Judul Hard Alarm..."
              className="col-span-2 px-2 py-1 rounded border outline-none"
              style={{ background: 'var(--bg-void)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
            />
            <select
              value={almTaskId}
              onChange={(e) => setAlmTaskId(e.target.value)}
              className="px-2 py-1 rounded border"
              style={{ background: 'var(--bg-void)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
            >
              <option value="">(Opsional) Tautkan ke Task...</option>
              {tasks
                .filter((t) => !t.parent_task_id && t.status !== 'Done')
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title.slice(0, 32)}
                  </option>
                ))}
            </select>
            <select
              value={almPreset}
              onChange={(e) => setAlmPreset(e.target.value as AlarmReminderItem['sound_preset'])}
              className="px-2 py-1 rounded border"
              style={{ background: 'var(--bg-void)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
            >
              <option value="tactical_pulse">Nada: Tactical Pulse</option>
              <option value="siren_urgent">Nada: Siren Urgent</option>
              <option value="zen_chime">Nada: Zen Chime</option>
            </select>
            <input
              type="datetime-local"
              value={almTime}
              onChange={(e) => setAlmTime(e.target.value)}
              className="px-2 py-1 rounded border font-mono-num"
              style={{ background: 'var(--bg-void)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
            />
            <button type="submit" className="px-2.5 py-1 rounded font-mono-num font-bold cursor-pointer bg-amber-500 text-black">
              + Pasang Hard Alarm
            </button>
          </form>

          {/* Hard Alarms List */}
          <div className="space-y-1.5 max-h-48 overflow-y-auto themed-scroll pr-1">
            {hardAlarms.map((a) => (
              <div key={a.id} className="p-2 rounded bg-black/25 border border-amber-500/30 flex items-center justify-between gap-2 text-xs">
                <div className="min-w-0">
                  <div className="font-semibold text-amber-300 truncate">⏰ {a.title}</div>
                  <div className="font-mono-num" style={{ color: 'var(--text-muted)' }}>
                    {new Date(a.snoozed_until ?? a.trigger_at).toLocaleString('id-ID', {
                      timeZone: 'Asia/Jakarta',
                      dateStyle: 'short',
                      timeStyle: 'short',
                    })}{' '}
                    WIB · {a.status.toUpperCase()}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => void onTestAlarm(a.id)}
                    className="px-1.5 py-0.5 rounded bg-white/5 text-xs cursor-pointer"
                    title="Tes bunyi"
                  >
                    🔔
                  </button>
                  {a.status === 'ringing' && (
                    <>
                      <button
                        onClick={() => void onSnoozeAlarm(a.id, 5)}
                        className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 text-xs cursor-pointer"
                      >
                        Snooze
                      </button>
                      <button
                        onClick={() => void onDismissAlarm(a.id)}
                        className="px-1.5 py-0.5 rounded bg-rose-500 text-white text-xs cursor-pointer"
                      >
                        Dismiss
                      </button>
                    </>
                  )}
                  <button
                    onClick={() => void onToggleAlarm(a.id, a.enabled !== 1)}
                    className="px-2 py-0.5 rounded font-mono-num font-bold cursor-pointer"
                    style={
                      a.enabled === 1
                        ? { background: 'var(--accent)', color: 'var(--accent-fg)' }
                        : { background: 'var(--bg-void)', border: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }
                    }
                  >
                    {a.enabled === 1 ? 'ON' : 'OFF'}
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Soft Reminders List */}
          <div className="pt-2 border-t space-y-1 max-h-40 overflow-y-auto themed-scroll" style={{ borderColor: 'var(--border-subtle)' }}>
            <div className="text-xs font-mono-num" style={{ color: 'var(--text-muted)' }}>
              SOFT REMINDERS OTOMATIS (H-15m / H-30m)
            </div>
            {softReminders.map((r) => (
              <div key={r.id} className="flex items-center justify-between px-2 py-1 rounded bg-black/20 text-xs">
                <span className="truncate">🔔 {r.title}</span>
                <span className="font-mono-num shrink-0 ml-2" style={{ color: 'var(--text-secondary)' }}>
                  {new Date(r.trigger_at).toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* FULL VISUAL CALENDAR GRID (BULAN & MINGGU) */}
      <InteractiveVisualCalendar
        calendarEvents={calendarEvents}
        onMoveCalendarEvent={onMoveCalendarEvent}
        onCreateCalendarEvent={onCreateCalendarEvent}
      />
    </div>
  );
}
