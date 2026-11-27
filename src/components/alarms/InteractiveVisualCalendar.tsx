import { AlarmClock, CalendarDays, ChevronLeft, ChevronRight, Plus, X } from 'lucide-react';
import { useMemo, useState, type DragEvent, type FormEvent } from 'react';
import { shiftCalendarEnd } from '../../../shared/calendar-range';
import { addCalendarDays, formatDay, formatWibStamp, formatWibTime, wibDateKey, wibDateTimeInput, wibDateTimeToIso } from '../../lib/calendar-time';
import type { CalendarEventItem } from '../../types/llamrei';
import { Control } from '../ui/Control';
import { DialogPanel } from '../ui/DialogPanel';

export interface CalendarEventInput {
  title: string;
  startAt: string;
  endAt?: string | null;
  withHardAlarm: boolean;
  ringPhone?: boolean;
}

interface Props {
  calendarEvents: CalendarEventItem[];
  now: Date;
  initialEventId?: string;
  onMoveCalendarEvent: (eventId: string, newStartAt: string) => Promise<void>;
  onCreateCalendarEvent: (input: CalendarEventInput) => Promise<void>;
  onOpenTask: (taskId: string) => void;
}

const modes = { day: 'Hari', week: 'Minggu', month: 'Bulan', agenda: 'Agenda' } as const;
type Mode = keyof typeof modes;

const sourceNames: Record<CalendarEventItem['source'], string> = {
  clickup_task: 'Tugas',
  local: 'Lokal',
  notion: 'Notion',
  google: 'Google Calendar',
  scheduled_chat: 'Pesan terjadwal',
};
const dayNames = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];
const monthFormat = new Intl.DateTimeFormat('id-ID', { timeZone: 'UTC', month: 'long', year: 'numeric' });
const dragMime = 'application/x-llamrei-calendar-event';
const outline = 'ds-control--outline';

function intervalEnd(start: string, end: string | null, allDay?: number): number {
  const first = Date.parse(start);
  // Events without an end occupy their start instant, or the whole day for all-day events.
  const finish = end ? Date.parse(end) : first;
  return Math.max(first + (allDay === 1 ? 86_400_000 : 1), Number.isFinite(finish) ? finish : first);
}

function eventsOnDay(events: CalendarEventItem[], day: string): CalendarEventItem[] {
  const start = Date.parse(`${day}T00:00:00+07:00`);
  const end = start + 86_400_000;
  return events.filter((item) => Date.parse(item.start_at) < end && intervalEnd(item.start_at, item.end_at, item.all_day) > start);
}

function offsetMonth(key: string, delta: number): string {
  const date = new Date(`${key.slice(0, 7)}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + delta);
  return date.toISOString().slice(0, 10);
}

function monthDays(key: string): string[] {
  const first = `${key.slice(0, 7)}-01`;
  const offset = (new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7;
  const last = addCalendarDays(offsetMonth(first, 1), -1);
  const cells = Math.ceil((Number(last.slice(-2)) + offset) / 7) * 7;
  return Array.from({ length: cells }, (_, index) => addCalendarDays(first, index - offset));
}

function weekDays(key: string): string[] {
  const offset = (new Date(`${key}T00:00:00Z`).getUTCDay() + 6) % 7;
  return Array.from({ length: 7 }, (_, index) => addCalendarDays(key, index - offset));
}

function eventTime(event: CalendarEventItem, day: string): string {
  if (event.all_day === 1) return 'Sepanjang hari';
  if (wibDateKey(event.start_at) < day) return 'Berlanjut';
  const start = formatWibTime(event.start_at);
  return event.end_at && Date.parse(event.end_at) > Date.parse(event.start_at)
    ? `${start}–${formatWibTime(event.end_at)} WIB`
    : `${start} WIB`;
}

export function InteractiveVisualCalendar({
  calendarEvents, now, initialEventId, onMoveCalendarEvent, onCreateCalendarEvent, onOpenTask,
}: Props) {
  const today = wibDateKey(now);
  const initialEvent = calendarEvents.find(({ id }) => id === initialEventId);
  const [date, setDate] = useState(() => (initialEvent && wibDateKey(initialEvent.start_at)) || today);
  const [mode, setMode] = useState<Mode>('month');
  const [detail, setDetail] = useState<{ id: string; targetDate?: string } | null>(() =>
    initialEvent ? { id: initialEvent.id } : null);
  const [creating, setCreating] = useState(false);
  const events = useMemo(() => calendarEvents
    .filter(({ start_at }) => !!wibDateKey(start_at))
    .sort((left, right) => Date.parse(left.start_at) - Date.parse(right.start_at)), [calendarEvents]);
  const selected = events.find(({ id }) => id === detail?.id);
  const displayedDays = mode === 'month' ? monthDays(date)
    : mode === 'week' ? weekDays(date) : [];
  const selectedEvents = eventsOnDay(events, date);
  const month = date.slice(0, 7);
  const agenda = mode === 'agenda'
    ? monthDays(date).filter((day) => day.startsWith(month)).map((day) => ({ day, items: eventsOnDay(events, day) }))
      .filter(({ items }) => items.length > 0)
    : [{ day: date, items: selectedEvents }];
  const heading = mode === 'day' ? formatDay(date)
    : mode === 'week' ? `${formatDay(displayedDays[0])} – ${formatDay(displayedDays[6])}`
    : monthFormat.format(new Date(`${date}T00:00:00Z`));

  function navigate(delta: number) {
    setDate((current) => mode === 'month' || mode === 'agenda'
      ? offsetMonth(current, delta) : addCalendarDays(current, delta * (mode === 'week' ? 7 : 1)));
  }

  function previewDrop(event: DragEvent, day: string) {
    const id = event.dataTransfer.getData(dragMime);
    if (!events.some((item) => item.id === id)) return;
    event.preventDefault();
    setDate(day);
    setDetail({ id, targetDate: day });
  }

  return (
    <div className="min-w-0 space-y-4">
      <section aria-label="Navigasi tanggal" className="themed-card min-w-0 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-subtle)] p-3 sm:p-4">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold capitalize leading-snug" aria-live="polite">{heading}</h2>
            <p className="text-xs text-[var(--text-secondary)]">Waktu Indonesia Barat (WIB)</p>
          </div>
          <div className="flex flex-wrap gap-1">
            <Control className={outline} aria-label="Periode sebelumnya" onClick={() => navigate(-1)}><ChevronLeft aria-hidden="true" /></Control>
            <Control className={outline} onClick={() => setDate(today)}>Hari ini</Control>
            <Control className={outline} aria-label="Periode berikutnya" onClick={() => navigate(1)}><ChevronRight aria-hidden="true" /></Control>
          </div>
          <div role="group" aria-label="Tampilan kalender" className="flex w-full flex-wrap gap-1">
            {(Object.keys(modes) as Mode[]).map((item) => (
              <Control key={item} className="ds-segment" aria-pressed={mode === item} onClick={() => setMode(item)}>{modes[item]}</Control>
            ))}
          </div>
        </div>

        {displayedDays.length > 0 && (
          <div className="min-w-0">
            <div className="grid grid-cols-7 border-b border-[var(--border-subtle)] text-center text-xs font-semibold text-[var(--text-secondary)]" aria-hidden="true">
              {dayNames.map((label) => <span key={label} className="py-2">{label}</span>)}
            </div>
            <div className="grid grid-cols-7">
              {displayedDays.map((day) => {
                const items = eventsOnDay(events, day);
                return (
                  <button
                    key={day}
                    type="button"
                    aria-label={`${formatDay(day)}, ${items.length} agenda`}
                    aria-pressed={day === date}
                    aria-current={day === today ? 'date' : undefined}
                    onClick={() => setDate(day)}
                    onDragOver={(event) => { if (event.dataTransfer.types.includes(dragMime)) event.preventDefault(); }}
                    onDrop={(event) => previewDrop(event, day)}
                    className="group relative flex min-h-12 min-w-0 flex-col items-center border-r border-b border-[var(--border-subtle)] px-0.5 py-1.5 text-sm hover:bg-[var(--bg-elevated)] focus-visible:z-10 focus-visible:outline-offset-[-2px] aria-pressed:bg-[var(--accent-soft)] sm:min-h-20 sm:items-stretch sm:px-1.5"
                  >
                    <span className="flex items-center justify-between gap-1">
                      <span className={`grid size-6 place-items-center rounded-md font-semibold ${day === today ? 'bg-[var(--accent)] text-[var(--accent-fg)]' : day.startsWith(month) ? '' : 'text-[var(--text-muted)]'}`}>
                        {Number(day.slice(-2))}
                      </span>
                      {items.length > 0 && <span className="hidden rounded bg-[var(--bg-elevated)] px-1.5 text-xs text-[var(--text-secondary)] sm:block">{items.length}</span>}
                    </span>
                    <span className="mt-1 w-full space-y-0.5 text-left" aria-hidden="true">
                      {items.length > 0 && <span className="mx-auto block size-1.5 rounded-full bg-[var(--accent)] sm:hidden" />}
                      {items.slice(0, 2).map((event) => (
                        <span key={event.id} className="hidden truncate rounded-sm border-l-2 bg-[var(--bg-elevated)] px-1 py-0.5 text-xs sm:block" style={{ borderColor: event.color }}>
                          {event.title}
                        </span>
                      ))}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </section>

      <section aria-labelledby="calendar-agenda" className="themed-card p-3 sm:p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 id="calendar-agenda" className="text-base font-semibold">{mode === 'agenda' ? 'Agenda bulan ini' : 'Agenda tanggal dipilih'}</h2>
            {mode !== 'agenda' && <p className="text-sm capitalize text-[var(--text-secondary)]">{formatDay(date)}</p>}
          </div>
          <Control className="ds-control--primary" onClick={() => setCreating(true)}><Plus aria-hidden="true" /> Agenda baru</Control>
        </div>

        {mode === 'day' && today === date && (
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-[var(--accent)]">
            {formatWibTime(now)} WIB <span className="h-px flex-1 bg-[var(--border-accent)]" />
          </div>
        )}
        {!agenda.some(({ items }) => items.length) && (
          <p className="rounded-lg border border-dashed border-[var(--border-subtle)] p-4 text-sm text-[var(--text-secondary)]">Belum ada agenda pada periode ini.</p>
        )}
        {agenda.map(({ day, items }) => items.length ? (
          <div key={day} className="mb-3 last:mb-0">
            {mode === 'agenda' && <h3 className="mb-1 text-sm font-semibold capitalize">{formatDay(day)}</h3>}
            <ul className="divide-y divide-[var(--border-subtle)]">
              {items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button" draggable
                    onDragStart={(event) => { event.dataTransfer.setData(dragMime, item.id); event.dataTransfer.effectAllowed = 'move'; }}
                    onClick={() => setDetail({ id: item.id })}
                    className="flex min-h-12 w-full min-w-0 items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-[var(--bg-elevated)]"
                  >
                    <span className="h-7 w-0.5 shrink-0 rounded" style={{ background: item.color }} aria-hidden="true" />
                    <span className="grid min-w-0 flex-1 gap-0.5">
                      <span className="flex min-w-0 flex-wrap items-center gap-2 text-sm font-semibold [overflow-wrap:anywhere]">{item.title} {item.has_hard_alarm === 1 && <AlarmClock size={14} aria-label="Alarm tertaut" />}</span>
                      <span className="text-xs text-[var(--text-secondary)]">{eventTime(item, day)} · {sourceNames[item.source]}</span>
                    </span>
                    <ChevronRight size={16} aria-hidden="true" className="shrink-0 text-[var(--text-secondary)]" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null)}
      </section>

      {creating && (
        <NewEventDialog date={date} events={events} onSave={onCreateCalendarEvent} onClose={() => setCreating(false)} />
      )}
      {selected && (
        <EventDetail
          key={selected.id}
          event={selected}
          events={events}
          targetDate={detail?.targetDate}
          onMove={async (startAt) => {
            await onMoveCalendarEvent(selected.id, startAt);
            setDate(wibDateKey(startAt));
          }}
          onOpenTask={onOpenTask}
          onClose={() => setDetail(null)}
        />
      )}
    </div>
  );
}

function DialogHeading({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-[var(--border-subtle)] px-4 py-2">
      <h2 className="text-base font-semibold">{title}</h2>
      <Control aria-label="Tutup" onClick={onClose}><X aria-hidden="true" /></Control>
    </div>
  );
}

function ScheduleConflicts({ events, startAt, endAt, eventId, allDay }: {
  events: CalendarEventItem[];
  startAt: string;
  endAt: string | null;
  eventId?: string;
  allDay?: number;
}) {
  const start = Date.parse(startAt);
  const end = intervalEnd(startAt, endAt, allDay);
  const conflicts = events.filter((event) => event.id !== eventId &&
    Date.parse(event.start_at) < end && intervalEnd(event.start_at, event.end_at, event.all_day) > start);
  if (!conflicts.length) return null;
  return (
    <div className="ds-note" role="status">
      <p className="font-semibold text-[var(--warning)]">Bertabrakan dengan {conflicts.length} agenda</p>
      <ul className="list-disc pl-5">
        {conflicts.slice(0, 3).map((event) => <li key={event.id}>{event.title} · {formatWibStamp(event.start_at)}</li>)}
      </ul>
    </div>
  );
}

function NewEventDialog({ date, events, onSave, onClose }: {
  date: string;
  events: CalendarEventItem[];
  onSave: Props['onCreateCalendarEvent'];
  onClose: () => void;
}) {
  const [title, setTitle] = useState('');
  const [start, setStart] = useState(`${date}T09:00`);
  const [end, setEnd] = useState('');
  const [withAlarm, setWithAlarm] = useState(false);
  const [ringPhone, setRingPhone] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const startAt = wibDateTimeToIso(start);
  const endAt = end ? wibDateTimeToIso(end) : null;
  const invalidRange = !!end && (!startAt || !endAt || Date.parse(endAt) < Date.parse(startAt));

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!title.trim() || !startAt || invalidRange || saving) return;
    setError('');
    setSaving(true);
    try {
      await onSave({ title: title.trim(), startAt, endAt, withHardAlarm: withAlarm, ringPhone: withAlarm && ringPhone });
      onClose();
    } catch {
      setError('Agenda belum dapat disimpan. Periksa koneksi dan coba lagi.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <DialogPanel label="Agenda baru" className="workspace-form-dialog" onClose={() => { if (!saving) onClose(); }}>
      <DialogHeading title="Agenda baru" onClose={() => { if (!saving) onClose(); }} />
      <form className="space-y-3 p-4" onSubmit={(event) => void submit(event)}>
        <label className="ds-label">Judul agenda<input autoFocus className="ds-field" required value={title} onChange={(event) => setTitle(event.target.value)} /></label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="ds-label">Mulai (WIB)<input className="ds-field" type="datetime-local" required value={start} onChange={(event) => setStart(event.target.value)} /></label>
          <label className="ds-label">Selesai (WIB, opsional)<input className="ds-field" type="datetime-local" min={start} value={end} onChange={(event) => setEnd(event.target.value)} /></label>
        </div>
        <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={withAlarm} onChange={(event) => setWithAlarm(event.target.checked)} /> Pasang hard alarm</label>
        {withAlarm && <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={ringPhone} onChange={(event) => setRingPhone(event.target.checked)} /> Sertakan ponsel melalui NectarLink</label>}
        {startAt && !invalidRange && <ScheduleConflicts events={events} startAt={startAt} endAt={endAt} />}
        {invalidRange && <p className="ds-note" role="alert">Jam selesai harus sama dengan atau setelah jam mulai.</p>}
        {error && <p className="ds-note" role="alert">{error}</p>}
        <div className="flex justify-end gap-2">
          <Control disabled={saving} onClick={onClose}>Batal</Control>
          <Control type="submit" disabled={saving || !startAt || !title.trim() || invalidRange} className="ds-control--primary">{saving ? 'Menyimpan…' : 'Simpan agenda'}</Control>
        </div>
      </form>
    </DialogPanel>
  );
}

function EventDetail({ event, events, targetDate, onMove, onOpenTask, onClose }: {
  event: CalendarEventItem;
  events: CalendarEventItem[];
  targetDate?: string;
  onMove: (startAt: string) => Promise<void>;
  onOpenTask: Props['onOpenTask'];
  onClose: () => void;
}) {
  const original = wibDateTimeInput(event.start_at);
  const allDay = event.all_day === 1;
  const initialInput = allDay ? original.slice(0, 10) : original;
  const [draft, setDraft] = useState(() => !targetDate ? initialInput : allDay ? targetDate : `${targetDate}${original.slice(10)}`);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const startAt = wibDateTimeToIso(allDay ? `${draft}${original.slice(10)}` : draft);
  const endAt = startAt ? shiftCalendarEnd(event.start_at, event.end_at, startAt) : null;
  const changed = draft !== initialInput;

  function shift(minutes: number) {
    const time = Date.parse(startAt ?? event.start_at) + minutes * 60_000;
    setDraft(wibDateTimeInput(new Date(time)));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!startAt || !changed || saving) return;
    setError('');
    setSaving(true);
    try {
      await onMove(startAt);
      onClose();
    } catch {
      setError('Perubahan jadwal belum tersimpan. Coba lagi setelah memeriksa koneksi.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <DialogPanel label="Detail agenda" className="workspace-form-dialog" onClose={() => { if (!saving) onClose(); }}>
      <DialogHeading title="Detail agenda" onClose={() => { if (!saving) onClose(); }} />
      <div className="space-y-4 p-4">
        <div className="space-y-1 [overflow-wrap:anywhere]">
          <p className="flex items-center gap-2 text-xs font-medium text-[var(--text-secondary)]"><CalendarDays size={14} aria-hidden="true" /> {sourceNames[event.source]}</p>
          <h3 className="text-lg font-semibold">{event.title}</h3>
          <p className="text-sm text-[var(--text-secondary)]">{allDay ? formatDay(wibDateKey(event.start_at)) : formatWibStamp(event.start_at)}{allDay ? ' · Sepanjang hari' : ''}</p>
          {event.end_at && !allDay && <p className="text-sm text-[var(--text-secondary)]">Selesai {formatWibStamp(event.end_at)}</p>}
          {event.location && <p className="text-sm">{event.location}</p>}
          {event.notes && <p className="whitespace-pre-wrap text-sm text-[var(--text-secondary)]">{event.notes}</p>}
          {event.linked_task_id && <Control className={outline} onClick={() => { onClose(); onOpenTask(event.linked_task_id!); }}>Buka tugas</Control>}
        </div>
        <form onSubmit={(event) => void submit(event)} className="space-y-3 border-t border-[var(--border-subtle)] pt-3">
          <h4 className="text-sm font-semibold">Ubah jadwal</h4>
          {(event.source === 'notion' || event.source === 'google') && <p className="text-sm text-[var(--text-secondary)]">Perubahan berlaku pada salinan kalender di LLAMREI.</p>}
          <label className="ds-label">{allDay ? 'Tanggal baru (WIB)' : 'Mulai baru (WIB)'}<input className="ds-field" type={allDay ? 'date' : 'datetime-local'} required value={draft} onChange={(event) => setDraft(event.target.value)} /></label>
          {!allDay && (
            <div className="flex flex-wrap gap-2">
              <Control className={outline} onClick={() => shift(-30)}>−30 mnt</Control>
              <Control className={outline} onClick={() => shift(30)}>+30 mnt</Control>
            </div>
          )}
          {changed && startAt && (
            <>
              <p className="text-sm text-[var(--text-secondary)]">
                Jadwal baru {formatWibStamp(startAt)}{endAt ? ` sampai ${formatWibStamp(endAt)}` : ''}.
                {event.has_hard_alarm === 1 && ' Alarm tertaut ikut bergeser.'}
              </p>
              <ScheduleConflicts eventId={event.id} events={events} startAt={startAt} endAt={endAt} allDay={event.all_day} />
            </>
          )}
          {error && <p className="ds-note" role="alert">{error}</p>}
          <div className="flex justify-end">
            <Control type="submit" className="ds-control--primary" disabled={!changed || !startAt || saving}>{saving ? 'Menyimpan…' : 'Simpan jadwal'}</Control>
          </div>
        </form>
      </div>
    </DialogPanel>
  );
}
