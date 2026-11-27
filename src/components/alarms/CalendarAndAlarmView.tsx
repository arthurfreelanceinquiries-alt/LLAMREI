import { AlarmClock, CalendarDays, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { AlarmReminderItem, CalendarEventItem, TaskItem } from '../../types/llamrei';
import { Control } from '../ui/Control';
import { isActiveAlarm } from '../../lib/alarm-state';
import { AlarmCenter, type AlarmActions } from './AlarmCenter';
import { InteractiveVisualCalendar, type CalendarEventInput } from './InteractiveVisualCalendar';

export interface CalendarTarget {
  kind: 'event' | 'alarm';
  id: string;
}

interface Props extends AlarmActions {
  calendarEvents: CalendarEventItem[];
  alarms: AlarmReminderItem[];
  tasks: TaskItem[];
  target?: CalendarTarget;
  onCreateCalendarEvent: (input: CalendarEventInput) => Promise<void>;
  onMoveCalendarEvent: (eventId: string, newStartAt: string) => Promise<void>;
  onSyncNotion: () => Promise<{ note: string }>;
  onOpenTask: (taskId: string) => void;
}

export function CalendarAndAlarmView({
  calendarEvents, alarms, tasks, target, onCreateCalendarEvent, onMoveCalendarEvent, onSyncNotion, onOpenTask, ...alarmActions
}: Props) {
  const [section, setSection] = useState<'calendar' | 'alarms'>(() => target?.kind === 'alarm' ? 'alarms' : 'calendar');
  const [now, setNow] = useState(() => new Date());
  const [syncing, setSyncing] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; error: boolean }>();
  const activeCount = alarms.filter(isActiveAlarm).length;

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  async function syncNotion() {
    if (syncing) return;
    setSyncing(true);
    setFeedback(undefined);
    try {
      const { note } = await onSyncNotion();
      setFeedback({ text: note, error: false });
    } catch {
      setFeedback({ text: 'Sinkronisasi Notion belum dapat diselesaikan.', error: true });
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="mx-auto min-w-0 max-w-[92rem] space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Kalender & alarm</h1>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">{calendarEvents.length} agenda · {activeCount} alarm dan pengingat aktif</p>
        </div>
        <Control className="ds-control--outline" disabled={syncing} onClick={() => void syncNotion()}>
          <RefreshCw aria-hidden="true" /> {syncing ? 'Menyinkronkan…' : 'Sinkronkan Notion'}
        </Control>
      </header>
      {feedback && <p className="ds-note" role={feedback.error ? 'alert' : 'status'}>{feedback.text}</p>}
      <div role="group" aria-label="Kalender dan alarm" className="inline-flex flex-wrap gap-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-1">
        <Control className="ds-segment" aria-pressed={section === 'calendar'} onClick={() => setSection('calendar')}><CalendarDays aria-hidden="true" /> Kalender</Control>
        <Control className="ds-segment" aria-pressed={section === 'alarms'} onClick={() => setSection('alarms')}><AlarmClock aria-hidden="true" /> Alarm & pengingat</Control>
      </div>
      {section === 'calendar' ? (
        <InteractiveVisualCalendar
          calendarEvents={calendarEvents}
          now={now}
          initialEventId={target?.kind === 'event' ? target.id : undefined}
          onCreateCalendarEvent={onCreateCalendarEvent}
          onMoveCalendarEvent={onMoveCalendarEvent}
          onOpenTask={onOpenTask}
        />
      ) : (
        <AlarmCenter alarms={alarms} tasks={tasks} now={now} initialAlarmId={target?.kind === 'alarm' ? target.id : undefined} {...alarmActions} />
      )}
    </div>
  );
}
