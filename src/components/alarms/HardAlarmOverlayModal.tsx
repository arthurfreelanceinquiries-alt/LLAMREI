import { useEffect } from 'react';
import { startHardAlarmSoundLoop, stopHardAlarmSoundLoop } from '../../lib/alarm-sound';
import type { AlarmReminderItem } from '../../types/llamrei';

interface Props {
  alarm: AlarmReminderItem | null;
  onDismiss: (alarmId: string) => void;
  onDismissAndStartTimer: (alarm: AlarmReminderItem) => void;
  onSnooze: (alarmId: string, minutes: number) => void;
}

export function HardAlarmOverlayModal({ alarm, onDismiss, onDismissAndStartTimer, onSnooze }: Props) {
  useEffect(() => {
    if (!alarm) {
      stopHardAlarmSoundLoop();
      return;
    }
    startHardAlarmSoundLoop(alarm.sound_preset);
    return () => stopHardAlarmSoundLoop();
  }, [alarm]);

  if (!alarm) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4">
      <div
        className="max-w-md w-full rounded-2xl border-2 p-6 space-y-4 shadow-2xl animate-pulse"
        style={{ background: 'var(--bg-card)', borderColor: '#f59e0b' }}
      >
        <div className="flex items-center justify-between">
          <span className="px-2.5 py-1 rounded text-xs font-mono-num font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
            ⏰ HARD ALARM BERBUNYI
          </span>
          <span className="text-xs font-mono-num" style={{ color: 'var(--text-muted)' }}>
            {alarm.ring_phone_nectarlink ? '📱 HP Dering Aktif' : '💻 Website Alarm'}
          </span>
        </div>

        <div className="space-y-1">
          <h2 className="text-xl font-bold">{alarm.title}</h2>
          {alarm.subtitle && (
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              {alarm.subtitle}
            </p>
          )}
        </div>

        <div className="grid grid-cols-3 gap-2">
          {[5, 10, 15].map((mins) => (
            <button
              key={mins}
              onClick={() => onSnooze(alarm.id, mins)}
              className="py-2 px-3 rounded-lg text-xs font-mono-num font-semibold border cursor-pointer"
              style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
            >
              🔕 Snooze {mins}m
            </button>
          ))}
        </div>

        <div className="flex gap-2 pt-1">
          {alarm.task_id && (
            <button
              onClick={() => onDismissAndStartTimer(alarm)}
              className="flex-1 py-2.5 px-3 rounded-lg text-xs font-mono-num font-bold cursor-pointer"
              style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
            >
              ▶ Dismiss & Start Timer
            </button>
          )}
          <button
            onClick={() => onDismiss(alarm.id)}
            className="flex-1 py-2.5 px-3 rounded-lg text-xs font-mono-num font-bold bg-rose-500 text-white cursor-pointer"
          >
            ✕ Dismiss Alarm
          </button>
        </div>
      </div>
    </div>
  );
}
