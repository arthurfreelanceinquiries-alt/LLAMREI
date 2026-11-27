import { AlarmClock, Bell, BellRing, Plus, Volume2, X } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { alarmStatusLabels, alarmTime, isActiveAlarm } from '../../lib/alarm-state';
import { playAlarmSample } from '../../lib/alarm-sound';
import { formatWibStamp, wibDateTimeInput, wibDateTimeToIso } from '../../lib/calendar-time';
import type { AlarmReminderItem, TaskItem } from '../../types/llamrei';
import { Control } from '../ui/Control';
import { DialogPanel } from '../ui/DialogPanel';

export interface AlarmInput {
  taskId: string | null;
  title: string;
  triggerAt: string;
  soundPreset: AlarmReminderItem['sound_preset'];
  ringPhone: boolean;
}

export interface AlarmActions {
  onCreateAlarm: (input: AlarmInput) => Promise<void>;
  onToggleAlarm: (alarmId: string, enabled: boolean) => Promise<void>;
  onRingAlarm: (alarmId: string) => Promise<void>;
  onSnoozeAlarm: (alarmId: string, minutes: number) => Promise<void>;
  onDismissAlarm: (alarmId: string) => Promise<void>;
}

interface Props extends AlarmActions {
  alarms: AlarmReminderItem[];
  tasks: TaskItem[];
  now: Date;
  initialAlarmId?: string;
}

const sounds = {
  tactical_pulse: 'Tactical Pulse',
  siren_urgent: 'Siren Urgent',
  zen_chime: 'Zen Chime',
  bell_classic: 'Bell Classic',
} satisfies Record<AlarmReminderItem['sound_preset'], string>;

function AlarmGroup({ title, alarms, kind, initialAlarmId, activeAction, onAction, onToggleAlarm, onRingAlarm, onDismissAlarm, onSnoozeAlarm }: {
  title: string;
  alarms: AlarmReminderItem[];
  kind: AlarmReminderItem['kind'];
  initialAlarmId?: string;
  activeAction: string | null;
  onAction: (id: string, run: () => Promise<void>) => Promise<void>;
} & Omit<AlarmActions, 'onCreateAlarm'>) {
  const target = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (!target.current) return;
    target.current.focus();
  }, [initialAlarmId]);

  const Icon = kind === 'hard_alarm' ? AlarmClock : Bell;
  return (
    <section className="themed-card min-w-0">
      <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] p-3 sm:p-4">
        <Icon className="text-[var(--accent)]" size={18} aria-hidden="true" />
        <h2 className="font-semibold">{title}</h2>
        <span className="ml-auto rounded-md bg-[var(--bg-elevated)] px-2 py-1 text-xs text-[var(--text-secondary)]">{alarms.length}</span>
      </div>
      {alarms.length === 0 ? (
        <p className="p-4 text-sm text-[var(--text-secondary)]">Belum ada {title.toLowerCase()} di tampilan ini.</p>
      ) : (
        <ul className="divide-y divide-[var(--border-subtle)]">
          {alarms.map((alarm) => {
            const ringing = alarm.status === 'ringing' && alarm.enabled === 1;
            const statusLabel = alarm.enabled === 0 && alarm.status === 'armed' ? 'Nonaktif' : alarmStatusLabels[alarm.status];
            return (
              <li
                key={alarm.id}
                ref={alarm.id === initialAlarmId ? target : undefined}
                tabIndex={alarm.id === initialAlarmId ? -1 : undefined}
                className="grid min-w-0 gap-2 px-3 py-3 focus-visible:outline-offset-[-2px] sm:px-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 [overflow-wrap:anywhere]">
                    <h3 className="text-sm font-semibold">{alarm.title}</h3>
                    <p className="mt-1 text-xs text-[var(--text-secondary)]">
                      {formatWibStamp(alarmTime(alarm))}
                    </p>
                    <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                      {alarm.kind === 'soft_reminder' ? `${alarm.offset_minutes} menit sebelum agenda` : sounds[alarm.sound_preset]}
                      {alarm.ring_phone_nectarlink === 1 && ' · Ponsel melalui NectarLink'}
                    </p>
                  </div>
                  <span className={`rounded-md bg-[var(--bg-elevated)] px-2 py-1 text-xs font-medium ${ringing ? 'text-[var(--warning)]' : 'text-[var(--text-secondary)]'}`}>{statusLabel}</span>
                </div>
                {kind === 'hard_alarm' && (
                  <div className="flex flex-wrap items-center gap-1">
                    <Control
                      aria-label={`Coba nada ${alarm.title}`}
                      onClick={() => playAlarmSample(alarm.sound_preset)}
                    ><Volume2 aria-hidden="true" /></Control>
                    {ringing ? (
                      <>
                        <Control disabled={!!activeAction} onClick={() => void onAction(alarm.id, () => onSnoozeAlarm(alarm.id, 5))}>Tunda 5 mnt</Control>
                        <Control disabled={!!activeAction} onClick={() => void onAction(alarm.id, () => onDismissAlarm(alarm.id))}>Hentikan</Control>
                      </>
                    ) : (
                      <Control
                        aria-label={`Bunyikan alarm ${alarm.title} sekarang di browser`}
                        disabled={!!activeAction}
                        onClick={() => void onAction(alarm.id, () => onRingAlarm(alarm.id))}
                      >Bunyikan sekarang</Control>
                    )}
                    <Control
                      className="ds-control--outline"
                      aria-label={`${alarm.enabled === 1 ? 'Nonaktifkan' : 'Aktifkan'} alarm ${alarm.title}`}
                      disabled={!!activeAction}
                      onClick={() => void onAction(alarm.id, () => onToggleAlarm(alarm.id, alarm.enabled !== 1))}
                    >
                      {activeAction === alarm.id ? 'Memproses…' : alarm.enabled === 1 ? 'Nonaktifkan' : 'Aktifkan'}
                    </Control>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export function AlarmCenter({ alarms, tasks, now, initialAlarmId, onCreateAlarm, ...actions }: Props) {
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState<'all' | 'active'>('all');
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [error, setError] = useState('');
  const activeCount = alarms.filter(isActiveAlarm).length;
  const items = alarms.filter((alarm) => filter === 'all' || isActiveAlarm(alarm));
  const hardAlarms = items.filter(({ kind }) => kind === 'hard_alarm');
  const softReminders = items.filter(({ kind }) => kind === 'soft_reminder');

  async function run(id: string, action: () => Promise<void>) {
    if (activeAction) return;
    setActiveAction(id);
    setError('');
    try {
      await action();
    } catch {
      setError('Status alarm belum dapat diperbarui. Periksa koneksi dan coba lagi.');
    } finally {
      setActiveAction(null);
    }
  }

  return (
    <div className="min-w-0 space-y-4">
      <div className="themed-card flex flex-wrap items-center justify-between gap-2 p-3 sm:p-4">
        <div role="group" aria-label="Filter alarm" className="flex flex-wrap gap-1">
          <Control className="ds-segment" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>Semua</Control>
          <Control className="ds-segment" aria-pressed={filter === 'active'} onClick={() => setFilter('active')}>Aktif ({activeCount})</Control>
        </div>
        <div className="flex flex-wrap gap-1">
          <Control className="ds-control--outline" onClick={() => playAlarmSample()}><Volume2 aria-hidden="true" /> Coba nada</Control>
          <Control className="ds-control--primary" onClick={() => setCreating(true)}><Plus aria-hidden="true" /> Alarm baru</Control>
        </div>
      </div>
      {error && <p className="ds-note" role="alert">{error}</p>}
      <div className="grid items-start gap-4 xl:grid-cols-2">
        <AlarmGroup title="Hard alarm" kind="hard_alarm" alarms={hardAlarms} initialAlarmId={initialAlarmId} activeAction={activeAction} onAction={run} {...actions} />
        <AlarmGroup title="Pengingat" kind="soft_reminder" alarms={softReminders} initialAlarmId={initialAlarmId} activeAction={activeAction} onAction={run} {...actions} />
      </div>
      {creating && <AlarmForm tasks={tasks} now={now} onSave={onCreateAlarm} onClose={() => setCreating(false)} />}
    </div>
  );
}

function AlarmForm({ tasks, now, onSave, onClose }: {
  tasks: TaskItem[];
  now: Date;
  onSave: AlarmActions['onCreateAlarm'];
  onClose: () => void;
}) {
  const [title, setTitle] = useState('');
  const [taskId, setTaskId] = useState('');
  const [trigger, setTrigger] = useState(() => wibDateTimeInput(new Date(now.valueOf() + 3_600_000)));
  const [sound, setSound] = useState<AlarmReminderItem['sound_preset']>('tactical_pulse');
  const [ringPhone, setRingPhone] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const triggerAt = wibDateTimeToIso(trigger);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!triggerAt || !title.trim() || saving) return;
    setSaving(true);
    setError('');
    try {
      await onSave({ title: title.trim(), taskId: taskId || null, triggerAt, soundPreset: sound, ringPhone });
      onClose();
    } catch {
      setError('Alarm belum dapat disimpan. Periksa koneksi dan coba lagi.');
    } finally {
      setSaving(false);
    }
  }

  function selectTask(id: string) {
    setTaskId(id);
    const task = tasks.find((item) => item.id === id);
    if (!task) return;
    if (!title.trim()) setTitle(task.title);
    const suggested = task.hard_alarm_at ?? task.start_at ?? task.due_at;
    if (suggested && wibDateTimeInput(suggested)) setTrigger(wibDateTimeInput(suggested));
  }

  return (
    <DialogPanel label="Alarm baru" className="workspace-form-dialog" onClose={() => { if (!saving) onClose(); }}>
      <div className="flex items-center justify-between gap-2 border-b border-[var(--border-subtle)] px-4 py-2">
        <h2 className="flex items-center gap-2 font-semibold"><BellRing size={18} aria-hidden="true" /> Alarm baru</h2>
        <Control aria-label="Tutup" disabled={saving} onClick={onClose}><X aria-hidden="true" /></Control>
      </div>
      <form className="space-y-3 p-4" onSubmit={(event) => void submit(event)}>
        <label className="ds-label">Judul alarm<input autoFocus required className="ds-field" value={title} onChange={(event) => setTitle(event.target.value)} /></label>
        <label className="ds-label">Tugas tertaut (opsional)
          <select className="ds-field" value={taskId} onChange={(event) => selectTask(event.target.value)}>
            <option value="">Alarm mandiri</option>
            {tasks.filter((task) => !task.parent_task_id && task.status !== 'Done').map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}
          </select>
        </label>
        <label className="ds-label">Waktu alarm (WIB)<input className="ds-field" required type="datetime-local" value={trigger} onChange={(event) => setTrigger(event.target.value)} /></label>
        <div className="flex items-end gap-2">
          <label className="ds-label flex-1">Nada alarm
            <select className="ds-field" value={sound} onChange={(event) => setSound(event.target.value as AlarmReminderItem['sound_preset'])}>
              {Object.entries(sounds).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
          </label>
          <Control className="ds-control--outline" aria-label="Coba nada yang dipilih" onClick={() => playAlarmSample(sound)}><Volume2 aria-hidden="true" /></Control>
        </div>
        <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={ringPhone} onChange={(event) => setRingPhone(event.target.checked)} /> Sertakan ponsel melalui NectarLink</label>
        {error && <p className="ds-note" role="alert">{error}</p>}
        <div className="flex justify-end gap-2">
          <Control disabled={saving} onClick={onClose}>Batal</Control>
          <Control type="submit" className="ds-control--primary" disabled={saving || !title.trim() || !triggerAt}>{saving ? 'Menyimpan…' : 'Pasang alarm'}</Control>
        </div>
      </form>
    </DialogPanel>
  );
}
