import { useState, useMemo } from 'react';
import type { CalendarEventItem } from '../../types/llamrei';

interface Props {
  calendarEvents: CalendarEventItem[];
  onMoveCalendarEvent: (eventId: string, newStartAt: string) => Promise<void>;
  onCreateCalendarEvent: (input: { title: string; startAt: string; withHardAlarm: boolean }) => Promise<void>;
}

function getWibDateParts(date: Date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const [yearStr, monthStr, dayStr] = formatter.format(date).split('-');
  return {
    year: Number(yearStr),
    month: Number(monthStr) - 1, // 0-indexed
    day: Number(dayStr),
    dateStr: `${yearStr}-${monthStr}-${dayStr}`,
  };
}

function toWibDateStr(isoString: string): string {
  try {
    const d = new Date(isoString);
    if (Number.isNaN(d.getTime())) return '';
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Jakarta',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return formatter.format(d);
  } catch {
    return '';
  }
}

function toWibTimeString(isoString: string): string {
  try {
    const d = new Date(isoString);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleTimeString('id-ID', {
      timeZone: 'Asia/Jakarta',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

const MONTH_NAMES_ID = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

const DAY_NAMES_ID = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu'];
const DAY_SHORT_ID = ['SEN', 'SEL', 'RAB', 'KAM', 'JUM', 'SAB', 'MIN'];

export function InteractiveVisualCalendar({
  calendarEvents,
  onMoveCalendarEvent,
  onCreateCalendarEvent,
}: Props) {
  const todayWib = useMemo(() => getWibDateParts(new Date()), []);

  const [currentYear, setCurrentYear] = useState(todayWib.year);
  const [currentMonth, setCurrentMonth] = useState(todayWib.month);
  const [viewMode, setViewMode] = useState<'month' | 'week'>('month');
  const [selectedDateStr, setSelectedDateStr] = useState<string>(todayWib.dateStr);

  // Quick event add in selected date
  const [quickTitle, setQuickTitle] = useState('');
  const [quickTime, setQuickTime] = useState('10:00');
  const [quickHardAlarm, setQuickHardAlarm] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Navigate month
  const prevMonth = () => {
    if (currentMonth === 0) {
      setCurrentMonth(11);
      setCurrentYear((y) => y - 1);
    } else {
      setCurrentMonth((m) => m - 1);
    }
  };

  const nextMonth = () => {
    if (currentMonth === 11) {
      setCurrentMonth(0);
      setCurrentYear((y) => y + 1);
    } else {
      setCurrentMonth((m) => m + 1);
    }
  };

  const jumpToToday = () => {
    setCurrentYear(todayWib.year);
    setCurrentMonth(todayWib.month);
    setSelectedDateStr(todayWib.dateStr);
  };

  // Group events by date string
  const eventsByDate = useMemo(() => {
    const map = new Map<string, CalendarEventItem[]>();
    for (const ev of calendarEvents) {
      const dStr = toWibDateStr(ev.start_at);
      if (!dStr) continue;
      const list = map.get(dStr) ?? [];
      list.push(ev);
      map.set(dStr, list);
    }
    // Sort events on each day chronologically
    for (const list of map.values()) {
      list.sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at));
    }
    return map;
  }, [calendarEvents]);

  // Generate Month Grid (42 cells: 6 rows of 7 days, starting Monday)
  const monthGridDays = useMemo(() => {
    const firstDayOfMonth = new Date(currentYear, currentMonth, 1);
    // Sunday is 0 -> Monday = 0, Sunday = 6
    const firstDayIndex = (firstDayOfMonth.getDay() + 6) % 7;
    const daysInCurrentMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
    const daysInPrevMonth = new Date(currentYear, currentMonth, 0).getDate();

    const days: Array<{
      dateStr: string;
      dayNumber: number;
      isCurrentMonth: boolean;
      isToday: boolean;
      isSelected: boolean;
      events: CalendarEventItem[];
    }> = [];

    // Prev month padding
    for (let i = firstDayIndex - 1; i >= 0; i--) {
      const dayNum = daysInPrevMonth - i;
      const m = currentMonth === 0 ? 11 : currentMonth - 1;
      const y = currentMonth === 0 ? currentYear - 1 : currentYear;
      const dStr = `${y}-${String(m + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
      days.push({
        dateStr: dStr,
        dayNumber: dayNum,
        isCurrentMonth: false,
        isToday: dStr === todayWib.dateStr,
        isSelected: dStr === selectedDateStr,
        events: eventsByDate.get(dStr) ?? [],
      });
    }

    // Current month days
    for (let dayNum = 1; dayNum <= daysInCurrentMonth; dayNum++) {
      const dStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
      days.push({
        dateStr: dStr,
        dayNumber: dayNum,
        isCurrentMonth: true,
        isToday: dStr === todayWib.dateStr,
        isSelected: dStr === selectedDateStr,
        events: eventsByDate.get(dStr) ?? [],
      });
    }

    // Next month padding to fill complete weeks (35 or 42 cells)
    const totalCells = days.length <= 35 ? 35 : 42;
    const remaining = totalCells - days.length;
    for (let dayNum = 1; dayNum <= remaining; dayNum++) {
      const m = currentMonth === 11 ? 0 : currentMonth + 1;
      const y = currentMonth === 11 ? currentYear + 1 : currentYear;
      const dStr = `${y}-${String(m + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
      days.push({
        dateStr: dStr,
        dayNumber: dayNum,
        isCurrentMonth: false,
        isToday: dStr === todayWib.dateStr,
        isSelected: dStr === selectedDateStr,
        events: eventsByDate.get(dStr) ?? [],
      });
    }

    return days;
  }, [currentYear, currentMonth, todayWib.dateStr, selectedDateStr, eventsByDate]);

  // Generate Week View Days (7 days around selected date)
  const weekDays = useMemo(() => {
    const sel = new Date(selectedDateStr + 'T12:00:00+07:00');
    if (Number.isNaN(sel.getTime())) return [];
    const dayOfWeek = (sel.getDay() + 6) % 7; // Monday = 0
    const mondayMs = sel.getTime() - dayOfWeek * 86_400_000;

    const days: Array<{
      dateStr: string;
      dayNumber: number;
      dayName: string;
      monthName: string;
      isToday: boolean;
      isSelected: boolean;
      events: CalendarEventItem[];
    }> = [];

    for (let i = 0; i < 7; i++) {
      const d = new Date(mondayMs + i * 86_400_000);
      const parts = getWibDateParts(d);
      days.push({
        dateStr: parts.dateStr,
        dayNumber: parts.day,
        dayName: DAY_NAMES_ID[i],
        monthName: MONTH_NAMES_ID[parts.month],
        isToday: parts.dateStr === todayWib.dateStr,
        isSelected: parts.dateStr === selectedDateStr,
        events: eventsByDate.get(parts.dateStr) ?? [],
      });
    }
    return days;
  }, [selectedDateStr, todayWib.dateStr, eventsByDate]);

  const selectedDayEvents = eventsByDate.get(selectedDateStr) ?? [];

  const handleQuickAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickTitle.trim() || isSubmitting) return;
    setIsSubmitting(true);
    try {
      const iso = `${selectedDateStr}T${quickTime}:00+07:00`;
      await onCreateCalendarEvent({
        title: quickTitle.trim(),
        startAt: new Date(iso).toISOString(),
        withHardAlarm: quickHardAlarm,
      });
      setQuickTitle('');
    } finally {
      setIsSubmitting(false);
    }
  };

  const shiftEvent = (ev: CalendarEventItem, deltaMinutes: number) => {
    const startMs = Date.parse(ev.start_at);
    if (Number.isNaN(startMs)) return;
    const nextStart = new Date(startMs + deltaMinutes * 60_000).toISOString();
    void onMoveCalendarEvent(ev.id, nextStart);
  };

  return (
    <div className="themed-card p-4 space-y-4 border rounded-lg shadow-sm" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-card)' }}>
      {/* CALENDAR HEADER & NAVIGATION CONTROLS */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center font-bold text-lg" style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}>
            📅
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold tracking-wide">
                {MONTH_NAMES_ID[currentMonth]} {currentYear}
              </h2>
              <span className="text-[10px] font-mono-num px-2 py-0.5 rounded border uppercase" style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-muted)' }}>
                WIB (UTC+7)
              </span>
            </div>
            <div className="text-xs flex items-center gap-2" style={{ color: 'var(--text-muted)' }}>
              <span>Total {calendarEvents.length} Acara Terjadwal</span>
              <span>•</span>
              <span className="text-emerald-400 font-mono-num">Hari Ini: {todayWib.day} {MONTH_NAMES_ID[todayWib.month]} {todayWib.year}</span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Month / Week Toggle */}
          <div className="flex rounded p-0.5 border" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-void)' }}>
            <button
              onClick={() => setViewMode('month')}
              className={`px-3 py-1 rounded text-xs font-mono-num transition cursor-pointer ${viewMode === 'month' ? 'font-bold shadow' : 'text-stone-400 hover:text-white'}`}
              style={viewMode === 'month' ? { background: 'var(--accent)', color: 'var(--accent-fg)' } : {}}
            >
              Bulan
            </button>
            <button
              onClick={() => setViewMode('week')}
              className={`px-3 py-1 rounded text-xs font-mono-num transition cursor-pointer ${viewMode === 'week' ? 'font-bold shadow' : 'text-stone-400 hover:text-white'}`}
              style={viewMode === 'week' ? { background: 'var(--accent)', color: 'var(--accent-fg)' } : {}}
            >
              Minggu
            </button>
          </div>

          {/* Navigation Buttons */}
          <div className="flex items-center gap-1">
            <button
              onClick={prevMonth}
              className="px-2.5 py-1 rounded border text-xs font-mono-num hover:bg-white/10 cursor-pointer"
              style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-void)' }}
              title="Bulan Sebelumnya"
            >
              ◀ Prev
            </button>
            <button
              onClick={jumpToToday}
              className="px-3 py-1 rounded border text-xs font-mono-num font-semibold hover:bg-white/10 cursor-pointer text-amber-300"
              style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-void)' }}
            >
              Hari Ini
            </button>
            <button
              onClick={nextMonth}
              className="px-2.5 py-1 rounded border text-xs font-mono-num hover:bg-white/10 cursor-pointer"
              style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-void)' }}
              title="Bulan Berikutnya"
            >
              Next ▶
            </button>
          </div>
        </div>
      </div>

      {/* MONTH VIEW GRID */}
      {viewMode === 'month' && (
        <div className="space-y-1">
          {/* Days of Week Header */}
          <div className="grid grid-cols-7 gap-1 text-center font-mono-num text-[11px] font-bold py-1.5 rounded" style={{ background: 'var(--bg-void)', color: 'var(--text-secondary)' }}>
            {DAY_NAMES_ID.map((name, idx) => (
              <div key={name} className="py-0.5">
                <span className="hidden md:inline">{name}</span>
                <span className="md:hidden">{DAY_SHORT_ID[idx]}</span>
              </div>
            ))}
          </div>

          {/* 7x5 or 7x6 Day Cells Grid */}
          <div className="grid grid-cols-7 gap-1">
            {monthGridDays.map((cell) => {
              const hasEvents = cell.events.length > 0;
              const hasAlarm = cell.events.some((e) => e.has_hard_alarm === 1);

              return (
                <div
                  key={cell.dateStr}
                  onClick={() => setSelectedDateStr(cell.dateStr)}
                  className={`min-h-[96px] p-1.5 rounded border flex flex-col justify-between transition cursor-pointer select-none group ${
                    cell.isSelected
                      ? 'ring-2 ring-emerald-400 bg-white/5'
                      : cell.isToday
                      ? 'bg-emerald-950/20 border-emerald-500/50'
                      : cell.isCurrentMonth
                      ? 'bg-black/30 hover:bg-white/5'
                      : 'bg-black/10 opacity-40 hover:opacity-75'
                  }`}
                  style={{
                    borderColor: cell.isSelected ? 'var(--accent)' : cell.isToday ? '#10b981' : 'var(--border-subtle)',
                  }}
                >
                  {/* Date Number & Badges Header */}
                  <div className="flex items-center justify-between mb-1">
                    <span
                      className={`text-xs font-mono-num font-bold px-1.5 py-0.2 rounded ${
                        cell.isToday
                          ? 'bg-emerald-500 text-black font-extrabold shadow-sm'
                          : cell.isSelected
                          ? 'bg-white/20 text-white'
                          : cell.isCurrentMonth
                          ? 'text-stone-300'
                          : 'text-stone-500'
                      }`}
                    >
                      {cell.dayNumber}
                    </span>

                    <div className="flex items-center gap-0.5">
                      {hasAlarm && <span className="text-[10px]" title="Memiliki Hard Alarm">⏰</span>}
                      {hasEvents && (
                        <span
                          className="text-[9px] font-mono-num px-1 rounded-full font-bold"
                          style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
                        >
                          {cell.events.length}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Day Events Chips (up to 3 items, then +N more) */}
                  <div className="space-y-1 flex-1 overflow-hidden">
                    {cell.events.slice(0, 2).map((ev) => (
                      <div
                        key={ev.id}
                        className="text-[10px] px-1.5 py-0.5 rounded truncate font-medium flex items-center gap-1 shadow-xs border-l-2"
                        style={{
                          background: 'rgba(0, 0, 0, 0.45)',
                          borderLeftColor: ev.color || 'var(--accent)',
                          color: 'var(--text-primary)',
                        }}
                        title={`${toWibTimeString(ev.start_at)} WIB - ${ev.title}`}
                      >
                        <span className="font-mono-num text-[9px] text-stone-400 shrink-0">
                          {toWibTimeString(ev.start_at)}
                        </span>
                        <span className="truncate">{ev.title}</span>
                      </div>
                    ))}
                    {cell.events.length > 2 && (
                      <div className="text-[9px] font-mono-num text-stone-400 pl-1">
                        +{cell.events.length - 2} acara lagi...
                      </div>
                    )}
                  </div>

                  {/* Cell Hover hint */}
                  {cell.isToday && (
                    <div className="text-[9px] font-mono-num text-emerald-400 font-bold uppercase mt-1 tracking-wider">
                      • Hari Ini
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* WEEK VIEW GRID */}
      {viewMode === 'week' && (
        <div className="grid grid-cols-1 md:grid-cols-7 gap-2">
          {weekDays.map((day) => (
            <div
              key={day.dateStr}
              onClick={() => setSelectedDateStr(day.dateStr)}
              className={`p-2.5 rounded border min-h-[220px] flex flex-col justify-between transition cursor-pointer ${
                day.isSelected
                  ? 'ring-2 ring-emerald-400 bg-white/5'
                  : day.isToday
                  ? 'bg-emerald-950/20 border-emerald-500/50'
                  : 'bg-black/30 hover:bg-white/5'
              }`}
              style={{
                borderColor: day.isSelected ? 'var(--accent)' : day.isToday ? '#10b981' : 'var(--border-subtle)',
              }}
            >
              <div>
                <div className="flex items-center justify-between pb-1.5 border-b mb-2" style={{ borderColor: 'var(--border-subtle)' }}>
                  <div>
                    <div className="text-xs font-bold text-stone-300">{day.dayName}</div>
                    <div className="text-[10px] font-mono-num text-stone-400">{day.dayNumber} {day.monthName}</div>
                  </div>
                  {day.isToday && (
                    <span className="text-[9px] font-mono-num px-1.5 py-0.5 rounded bg-emerald-500 text-black font-extrabold">
                      HARI INI
                    </span>
                  )}
                </div>

                {/* Event list for this day */}
                <div className="space-y-1.5">
                  {day.events.length === 0 ? (
                    <div className="text-[11px] text-stone-500 italic py-2">Tidak ada acara</div>
                  ) : (
                    day.events.map((ev) => (
                      <div
                        key={ev.id}
                        className="p-1.5 rounded border-l-2 bg-black/40 text-xs space-y-0.5"
                        style={{ borderLeftColor: ev.color || 'var(--accent)' }}
                      >
                        <div className="font-semibold truncate">
                          {ev.has_hard_alarm === 1 ? '⏰ ' : ''}
                          {ev.title}
                        </div>
                        <div className="text-[10px] font-mono-num text-stone-400 flex items-center justify-between">
                          <span>{toWibTimeString(ev.start_at)} WIB</span>
                          <span className="uppercase text-[9px] px-1 rounded bg-white/5">{ev.source}</span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="text-[10px] font-mono-num text-stone-500 pt-2 border-t mt-2" style={{ borderColor: 'var(--border-subtle)' }}>
                {day.events.length} Acara
              </div>
            </div>
          ))}
        </div>
      )}

      {/* SELECTED DATE AGENDA DETAILS & QUICK ADD PANEL */}
      <div className="p-3 rounded-lg border bg-black/25 grid grid-cols-1 lg:grid-cols-3 gap-3" style={{ borderColor: 'var(--border-subtle)' }}>
        {/* Left 2 Cols: Detailed events on selected date */}
        <div className="lg:col-span-2 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono-num font-bold text-emerald-400">
                📌 AGENDA TANGGAL: {selectedDateStr}
              </span>
              {selectedDateStr === todayWib.dateStr && (
                <span className="text-[10px] px-1.5 py-0.2 rounded bg-emerald-500 text-black font-bold">
                  HARI INI
                </span>
              )}
            </div>
            <span className="text-xs font-mono-num text-stone-400">
              {selectedDayEvents.length} Acara Terdaftar
            </span>
          </div>

          {selectedDayEvents.length === 0 ? (
            <div className="p-4 rounded border border-dashed text-xs text-stone-400 text-center" style={{ borderColor: 'var(--border-subtle)' }}>
              Belum ada agenda di tanggal ini. Gunakan form di sebelah kanan untuk menambahkan acara baru langsung ke tanggal {selectedDateStr}.
            </div>
          ) : (
            <div className="space-y-1.5 max-h-52 overflow-y-auto themed-scroll pr-1">
              {selectedDayEvents.map((ev) => (
                <div
                  key={ev.id}
                  className="p-2 rounded bg-black/40 border-l-4 flex items-center justify-between gap-2 text-xs"
                  style={{ borderLeftColor: ev.color || 'var(--accent)' }}
                >
                  <div className="min-w-0">
                    <div className="font-semibold truncate">
                      {ev.has_hard_alarm === 1 ? '⏰ ' : ''}
                      {ev.title}
                    </div>
                    <div className="font-mono-num text-stone-400 text-[11px] flex items-center gap-2">
                      <span>Jam {toWibTimeString(ev.start_at)} WIB</span>
                      <span>•</span>
                      <span className="uppercase text-[9px] px-1.5 py-0.2 rounded bg-white/5 border border-white/10">
                        {ev.source}
                      </span>
                      {ev.notes && <span className="truncate text-stone-500">({ev.notes})</span>}
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0 font-mono-num text-[11px]">
                    <button
                      onClick={() => shiftEvent(ev, -30)}
                      className="px-1.5 py-0.5 rounded border hover:bg-white/10 cursor-pointer"
                      style={{ borderColor: 'var(--border-subtle)' }}
                      title="Majukan 30 menit"
                    >
                      -30m
                    </button>
                    <button
                      onClick={() => shiftEvent(ev, 30)}
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
          )}
        </div>

        {/* Right 1 Col: Quick Add Event directly into Selected Date */}
        <div className="space-y-2 border-t lg:border-t-0 lg:border-l lg:pl-3 pt-2 lg:pt-0" style={{ borderColor: 'var(--border-subtle)' }}>
          <div className="text-xs font-mono-num font-bold text-stone-300">
            + Tambah Acara di {selectedDateStr}
          </div>

          <form onSubmit={handleQuickAdd} className="space-y-2 text-xs">
            <input
              value={quickTitle}
              onChange={(e) => setQuickTitle(e.target.value)}
              placeholder="Judul agenda..."
              className="w-full px-2.5 py-1.5 rounded border outline-none text-xs"
              style={{ background: 'var(--bg-void)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
            />

            <div className="flex items-center gap-2">
              <label className="text-[11px] font-mono-num text-stone-400 shrink-0">Jam WIB:</label>
              <input
                type="time"
                value={quickTime}
                onChange={(e) => setQuickTime(e.target.value)}
                className="flex-1 px-2 py-1 rounded border font-mono-num text-xs"
                style={{ background: 'var(--bg-void)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
              />
            </div>

            <label className="flex items-center gap-1.5 cursor-pointer text-stone-300 text-[11px]">
              <input
                type="checkbox"
                checked={quickHardAlarm}
                onChange={(e) => setQuickHardAlarm(e.target.checked)}
                className="rounded cursor-pointer"
              />
              <span>⏰ Pasang Hard Alarm</span>
            </label>

            <button
              type="submit"
              disabled={isSubmitting || !quickTitle.trim()}
              className="w-full py-1.5 rounded font-mono-num font-bold text-xs cursor-pointer transition disabled:opacity-50"
              style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
            >
              {isSubmitting ? 'Menyimpan...' : `+ Simpan ke ${selectedDateStr}`}
            </button>
          </form>
        </div>
      </div>

      {/* LEGEND FOOTER */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-2 text-[11px] font-mono-num border-t text-stone-400" style={{ borderColor: 'var(--border-subtle)' }}>
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" />
            <span>Hari Ini</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-indigo-400 inline-block" />
            <span>ClickUp Task</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-purple-400 inline-block" />
            <span>Notion Calendar</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-400 inline-block" />
            <span>Trading / CPI</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="text-xs">⏰</span>
            <span>Hard Alarm Aktif</span>
          </span>
        </div>
        <div className="text-[10px] text-stone-500">
          💡 Tips: Klik tanggal manapun di kalender untuk melihat detail atau menjadwalkan acara
        </div>
      </div>
    </div>
  );
}
