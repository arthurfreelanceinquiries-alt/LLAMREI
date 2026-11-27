import { AlarmClock, Clock, Timer } from 'lucide-react';
import { useEffect, useState } from 'react';
import { startHardAlarmSoundLoop, stopHardAlarmSoundLoop } from '../../lib/alarm-sound';
import type { AlarmReminderItem } from '../../types/llamrei';
import { Control } from '../ui/Control';
import { DialogPanel } from '../ui/DialogPanel';

interface Props {
  alarm: AlarmReminderItem;
  onDismiss: (alarmId: string) => Promise<void>;
  onDismissAndStartTimer: (alarm: AlarmReminderItem) => Promise<void>;
  onSnooze: (alarmId: string, minutes: number) => Promise<void>;
}

export function HardAlarmOverlayModal({ alarm, onDismiss, onDismissAndStartTimer, onSnooze }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const { id, sound_preset } = alarm;
  useEffect(() => {
    startHardAlarmSoundLoop(sound_preset);
    return () => stopHardAlarmSoundLoop();
  }, [id, sound_preset]);

  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await action();
    } catch {
      setError('Perubahan alarm belum dikonfirmasi. Periksa koneksi dan coba lagi.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <DialogPanel label="Alarm berdering" role="alertdialog" className="workspace-form-dialog" onClose={() => undefined}>
      <div className="space-y-4 p-4 sm:p-6">
        <p className="flex items-center gap-2 text-sm font-semibold text-[var(--warning)]">
          <AlarmClock size={20} aria-hidden="true" /> Hard alarm berdering
        </p>
        <div className="space-y-1 [overflow-wrap:anywhere]">
          <h2 className="text-xl font-semibold">{alarm.title}</h2>
          {alarm.subtitle && <p className="text-sm text-[var(--text-secondary)]">{alarm.subtitle}</p>}
          {alarm.ring_phone_nectarlink === 1 && <p className="text-sm text-[var(--text-secondary)]">Pengaturan alarm menyertakan ponsel melalui NectarLink.</p>}
        </div>
        <div role="group" aria-label="Tunda alarm" className="grid grid-cols-3 gap-1">
          {[5, 10, 15].map((minutes) => (
            <Control key={minutes} className="ds-control--outline" disabled={busy} onClick={() => void run(() => onSnooze(id, minutes))}>
              <Clock aria-hidden="true" className="hidden sm:block" /> {minutes} mnt
            </Control>
          ))}
        </div>
        {error && <p role="alert" className="ds-note">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2 border-t border-[var(--border-subtle)] pt-3">
          {alarm.task_id && <Control className="ds-control--outline" disabled={busy} onClick={() => void run(() => onDismissAndStartTimer(alarm))}><Timer aria-hidden="true" /> Hentikan & mulai timer</Control>}
          <Control className="ds-control--primary" disabled={busy} onClick={() => void run(() => onDismiss(id))}>{busy ? 'Memproses…' : 'Hentikan alarm'}</Control>
        </div>
      </div>
    </DialogPanel>
  );
}
