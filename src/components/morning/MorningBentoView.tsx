import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  AlarmClock,
  ArrowRight,
  CalendarDays,
  ClipboardCheck,
  CheckCircle2,
  ChevronRight,
  CircleCheckBig,
  Clock3,
  ListTodo,
  Moon,
  Newspaper,
  RefreshCw,
  Sparkles,
  TrendingUp,
} from 'lucide-react';
import { alarmStatusLabels, alarmTime, isActiveAlarm } from '../../lib/alarm-state';
import { usePendingAction } from '../../lib/use-pending-action';
import type { CalendarTarget } from '../alarms/CalendarAndAlarmView';
import { useTheme } from '../../theme/ThemeContext';
import type {
  AlarmReminderItem,
  CalendarEventItem,
  DailyCheckInItem,
  EconomicEventItem,
  KpiSummary,
  NavTab,
  NewsArticleItem,
  ScheduledMessageItem,
  TaskItem,
} from '../../types/llamrei';

interface Props {
  kpis: KpiSummary;
  tasks: TaskItem[];
  alarms: AlarmReminderItem[];
  calendarEvents: CalendarEventItem[];
  scheduledMessages: ScheduledMessageItem[];
  news: NewsArticleItem[];
  economicEvents: EconomicEventItem[];
  watchlistSymbol: string;
  pendingApprovalCount: number;
  onSelectWatchlistSymbol: (sym: string) => void;
  onSaveCheckIn: (input: { sleepHours: number; energyLevel: number; mentalState: DailyCheckInItem['mental_state'] }) => Promise<void>;
  onToggleHabit: (habitId: string, completed: boolean) => Promise<void>;
  onCycleTaskStatus: (task: TaskItem) => Promise<void>;
  onOpenTask: (task: TaskItem) => void;
  onOpenCalendarTarget: (target: CalendarTarget) => void;
  onOpenCopilot: () => void;
  onNavigateTab: (tab: NavTab) => void;
  onAskLlamreiWithContext: (prompt: string, context: Record<string, unknown>) => void;
  onAutoSchedule: () => void;
  onRefreshMarket: () => Promise<void>;
}

const watchlist = [
  { symbol: 'OANDA:XAUUSD', label: 'XAU/USD' },
  { symbol: 'FX:EURUSD', label: 'EUR/USD' },
  { symbol: 'BINANCE:BTCUSDT', label: 'BTC/USDT' },
  { symbol: 'TVC:DXY', label: 'DXY' },
];

const priorities = {
  urgent: { rank: 0, label: 'Mendesak', color: 'var(--danger, var(--accent))' },
  high: { rank: 1, label: 'Tinggi', color: 'var(--warning, var(--accent))' },
  normal: { rank: 2, label: 'Normal', color: 'var(--text-secondary)' },
  low: { rank: 3, label: 'Rendah', color: 'var(--text-secondary)' },
};

const riskLabels = { high: 'Tinggi', moderate: 'Sedang', low: 'Rendah' };

const weekday = new Intl.DateTimeFormat('id-ID', {
  timeZone: 'Asia/Jakarta',
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});
const dayAndTime = new Intl.DateTimeFormat('id-ID', {
  timeZone: 'Asia/Jakarta',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});
const number = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 });

const card = 'min-w-0 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4 sm:p-5';
const sectionTitle = 'flex min-w-0 items-center gap-2 text-[15px] font-semibold text-[var(--text-primary)]';
const supportingText = 'text-sm leading-relaxed text-[var(--text-secondary)]';
const sectionAction = 'inline-flex min-h-11 shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2 text-sm font-medium text-[var(--accent)] hover:bg-[var(--accent-soft)]';
const control = 'min-h-11 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 text-sm text-[var(--text-primary)]';
const rowBorder = 'border-t border-[var(--border-subtle)] first:border-t-0';

function dateLabel(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? 'Waktu belum tersedia' : `${dayAndTime.format(date)} WIB`;
}

export function MorningBentoView({
  kpis,
  tasks,
  alarms,
  calendarEvents,
  scheduledMessages,
  news,
  economicEvents,
  watchlistSymbol,
  pendingApprovalCount,
  onSelectWatchlistSymbol,
  onSaveCheckIn,
  onToggleHabit,
  onCycleTaskStatus,
  onOpenTask,
  onOpenCalendarTarget,
  onOpenCopilot,
  onNavigateTab,
  onAskLlamreiWithContext,
  onAutoSchedule,
  onRefreshMarket,
}: Props) {
  const { theme } = useTheme();
  const action = usePendingAction();
  const [sleepHours, setSleepHours] = useState(kpis.todayCheckIn?.sleep_hours ?? 7);
  const [energyLevel, setEnergyLevel] = useState(kpis.todayCheckIn?.energy_level ?? 4);
  const [mentalState, setMentalState] = useState<DailyCheckInItem['mental_state']>(kpis.todayCheckIn?.mental_state ?? 'focused');
  const [checkInStatus, setCheckInStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [marketStatus, setMarketStatus] = useState<'idle' | 'refreshing' | 'error'>('idle');
  const tvContainerRef = useRef<HTMLDivElement>(null);
  const [chartState, setChartState] = useState<'loading' | 'ready' | 'unavailable'>('loading');

  useEffect(() => {
    const container = tvContainerRef.current;
    if (!container) return;
    setChartState('loading');

    const script = document.createElement('script');
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-mini-symbol-overview.js';
    script.async = true;
    script.type = 'text/javascript';
    script.text = JSON.stringify({
      symbol: watchlistSymbol,
      width: '100%',
      height: 170,
      locale: 'id',
      dateRange: '1D',
      colorTheme: document.documentElement.dataset.theme === 'light' ? 'light' : 'dark',
      isTransparent: true,
      autosize: false,
      largeChartUrl: '',
    });
    const observer = new MutationObserver(() => {
      const frame = container.querySelector('iframe');
      if (frame) {
        frame.title = `Grafik TradingView ${watchlistSymbol}`;
        setChartState('ready');
      }
    });
    observer.observe(container, { childList: true, subtree: true });
    const timeout = window.setTimeout(() => {
      if (!container.querySelector('iframe')) setChartState('unavailable');
    }, 6000);
    script.onerror = () => setChartState('unavailable');
    container.replaceChildren(script);
    return () => {
      observer.disconnect();
      window.clearTimeout(timeout);
      script.onerror = null;
      container.replaceChildren();
    };
  }, [theme, watchlistSymbol]);

  const now = Date.now();
  const openTasks = tasks
    .filter((task) => !task.parent_task_id && task.status !== 'Done')
    .sort((a, b) => priorities[a.priority].rank - priorities[b.priority].rank)
    .slice(0, 4);
  const hardAlarms = alarms.filter((alarm) => alarm.kind === 'hard_alarm' && isActiveAlarm(alarm));
  const nextHardAlarm = hardAlarms.find((alarm) => alarm.status === 'ringing') ??
    hardAlarms.sort((left, right) => Date.parse(alarmTime(left)) - Date.parse(alarmTime(right)))[0];
  const upcoming = calendarEvents
    .filter((event) => Date.parse(event.end_at ?? event.start_at) >= now)
    .sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at))
    .slice(0, 3);
  const pendingChats = scheduledMessages
    .filter((message) => message.status === 'pending_approval' || message.status === 'approved')
    .slice(0, 2);
  const marketEvents = economicEvents.filter((event) => Date.parse(event.scheduled_at) >= now).slice(0, 2);

  async function saveCheckIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCheckInStatus('saving');
    try {
      await onSaveCheckIn({ sleepHours, energyLevel, mentalState });
      setCheckInStatus('saved');
    } catch {
      setCheckInStatus('error');
    }
  }

  async function refreshMarket() {
    setMarketStatus('refreshing');
    try {
      await onRefreshMarket();
      setMarketStatus('idle');
    } catch {
      setMarketStatus('error');
    }
  }

  return (
    <div className="mx-auto grid w-full max-w-[1440px] gap-4 sm:gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3 sm:gap-4">
        <div>
          <p className="mb-1 text-sm font-medium text-[var(--text-secondary)]">{weekday.format(now)} · WIB</p>
          <h1 className="text-[28px] leading-tight font-semibold tracking-tight sm:text-[32px]">Hari ini</h1>
        </div>
        <button
          type="button"
          onClick={onAutoSchedule}
          className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg bg-[var(--accent)] px-4 text-sm font-semibold text-[var(--accent-fg)] hover:brightness-110"
        >
          <Sparkles size={16} aria-hidden />
          Susun jadwal
        </button>
      </header>

      {pendingApprovalCount > 0 && (
        <button type="button" onClick={onOpenCopilot} className="themed-card flex min-h-11 items-center gap-2 px-3 py-2 text-left text-sm hover:bg-[var(--bg-elevated)]">
          <ClipboardCheck size={17} aria-hidden="true" className="text-[var(--accent)]" />
          <span className="flex-1">{pendingApprovalCount} aksi menunggu persetujuan</span>
          <ArrowRight size={16} aria-hidden="true" />
        </button>
      )}
      {action.error && <p className="ds-note" role="alert">{action.error}</p>}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4" role="group" aria-label="Ringkasan aktivitas">
        <section className={card} aria-labelledby="overview-tasks-metric">
          <h2 id="overview-tasks-metric" className={sectionTitle}><CircleCheckBig size={17} aria-hidden /> Tugas selesai</h2>
          <div className="mt-2.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="text-2xl leading-none font-semibold tabular-nums">{kpis.executionScorePercent}%</span>
            <span className={supportingText}>{kpis.completedTasks} dari {kpis.totalTasks} tugas</span>
          </div>
          <div
            role="progressbar"
            aria-label="Persentase tugas selesai"
            aria-valuenow={kpis.executionScorePercent}
            className="mt-3 h-1.5 overflow-hidden rounded-full bg-[var(--bg-elevated)]"
          >
            <div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${kpis.executionScorePercent}%` }} />
          </div>
        </section>

        <section className={card} aria-labelledby="overview-focus-metric">
          <h2 id="overview-focus-metric" className={sectionTitle}><Clock3 size={17} aria-hidden /> Waktu fokus</h2>
          <div className="mt-2.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="text-2xl leading-none font-semibold tabular-nums">{number.format(kpis.deepWorkHoursTotal)}</span>
            <span className={supportingText}>jam tercatat</span>
          </div>
        </section>

        <section className={card} aria-labelledby="overview-habit-metric">
          <h2 id="overview-habit-metric" className={sectionTitle}><CheckCircle2 size={17} aria-hidden /> Kebiasaan</h2>
          <div className="mt-2.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="text-2xl leading-none font-semibold tabular-nums">{kpis.habitCompletionPercent}%</span>
            <span className={supportingText}>selesai hari ini</span>
          </div>
        </section>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <section className={card} aria-labelledby="overview-priorities">
          <header className="flex flex-wrap items-center justify-between gap-x-2">
            <h2 id="overview-priorities" className={sectionTitle}><ListTodo size={17} aria-hidden /> Tugas prioritas</h2>
            <button type="button" className={sectionAction} onClick={() => onNavigateTab('clickup')}>
              Semua tugas <ArrowRight size={15} aria-hidden />
            </button>
          </header>
          {openTasks.length > 0 ? (
            <ul className="mt-1">
              {openTasks.map((task) => (
                <li key={task.id} className={`${rowBorder} grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 py-2`}>
                  <div className="min-w-0">
                    <button
                      type="button"
                      onClick={() => onOpenTask(task)}
                      className="flex min-h-8 cursor-pointer items-center gap-1.5 rounded text-left text-sm leading-snug font-medium hover:text-[var(--accent)]"
                    >
                      {task.title}
                      {task.hard_alarm_enabled === 1 && <AlarmClock size={14} className="shrink-0" role="img" aria-label="Alarm aktif" />}
                    </button>
                    <div className="flex flex-wrap items-center gap-x-2">
                      <span className="text-xs font-medium" style={{ color: priorities[task.priority].color }}>{priorities[task.priority].label}</span>
                      <button
                        type="button"
                        disabled={!!action.pending}
                        onClick={() => void action.run(task.id, () => onCycleTaskStatus(task), 'Status tugas belum dapat diperbarui.')}
                        aria-label={`Ubah status ${task.title}, saat ini ${task.status}`}
                        className="inline-flex min-h-8 cursor-pointer items-center gap-0.5 rounded px-1 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]"
                      >
                        {task.status} <ChevronRight size={12} aria-hidden />
                      </button>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onAskLlamreiWithContext(`Bantu pecah atau jadwalkan tindak lanjut tugas: ${task.title}`, task as unknown as Record<string, unknown>)}
                    aria-label={`Tanya Llamrei tentang ${task.title}`}
                    className={sectionAction}
                  >
                    <Sparkles size={15} aria-hidden /> Tanya
                  </button>
                </li>
              ))}
            </ul>
          ) : <p className={supportingText}>Tidak ada tugas yang perlu dikerjakan.</p>}
        </section>

        <section className={card} aria-labelledby="overview-agenda">
          <header className="flex flex-wrap items-center justify-between gap-x-2">
            <h2 id="overview-agenda" className={sectionTitle}><CalendarDays size={17} aria-hidden /> Agenda mendatang</h2>
            <button type="button" className={sectionAction} onClick={() => onNavigateTab('calendar')}>
              Kalender <ArrowRight size={15} aria-hidden />
            </button>
          </header>
          {nextHardAlarm && (
            <button type="button" onClick={() => onOpenCalendarTarget({ kind: 'alarm', id: nextHardAlarm.id })} className="my-2 flex w-full min-w-0 items-start gap-2 rounded-lg bg-[var(--bg-elevated)] px-3 py-2.5 text-left text-sm">
              <AlarmClock size={17} className="mt-0.5 shrink-0 text-[var(--warning)]" aria-hidden="true" />
              <span className="grid min-w-0 flex-1 gap-1 [overflow-wrap:anywhere]">
                <span className="font-medium">{alarmStatusLabels[nextHardAlarm.status]} · {nextHardAlarm.title}</span>
                <span className="text-xs text-[var(--text-secondary)]">{dateLabel(alarmTime(nextHardAlarm))}</span>
              </span>
              <ChevronRight size={16} aria-hidden="true" />
            </button>
          )}
          {upcoming.length > 0 ? (
            <ul>
              {upcoming.map((event) => (
                <li key={event.id} className={rowBorder}>
                  <button type="button" onClick={() => onOpenCalendarTarget({ kind: 'event', id: event.id })} className="flex min-h-11 w-full min-w-0 items-start gap-2 rounded-md px-1 py-2 text-left text-sm hover:bg-[var(--bg-elevated)]">
                    <span className="mt-1.5 size-2 shrink-0 rounded-full" style={{ background: event.color }} aria-hidden="true" />
                    <span className="grid min-w-0 flex-1 gap-1 [overflow-wrap:anywhere]">
                      <span className="font-medium">{event.title}</span>
                      <span className="text-xs text-[var(--text-secondary)]">{dateLabel(event.start_at)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : <p className={supportingText}>Belum ada kegiatan mendatang.</p>}
          {pendingChats.length > 0 && (
            <ul className="mt-2 border-t border-[var(--border-subtle)] pt-1">
              {pendingChats.map((message) => (
                <li key={message.id}>
                  <button
                    type="button"
                    onClick={() => onNavigateTab('scheduler')}
                    className="flex min-h-11 w-full cursor-pointer items-start justify-between gap-2 rounded px-1 py-2 text-left text-sm hover:bg-[var(--bg-elevated)]"
                  >
                    <span className="min-w-0">{message.recipient_name} · {message.purpose || 'Pesan terjadwal'}</span>
                    <span className="shrink-0 text-right text-xs text-[var(--text-secondary)]">
                      {message.status === 'pending_approval' ? 'Perlu persetujuan' : 'Disetujui'}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className={card} aria-labelledby="overview-checkin">
        <header className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="overview-checkin" className={sectionTitle}><Moon size={17} aria-hidden /> Cek pagi</h2>
          {kpis.todayCheckIn && (
            <span className="rounded-md bg-[var(--bg-elevated)] px-2.5 py-1 text-xs font-medium text-[var(--text-secondary)]">
              Risiko tilt {riskLabels[kpis.todayCheckIn.tilt_risk_level].toLowerCase()}
            </span>
          )}
        </header>
        <form className="mt-3 flex flex-wrap items-end gap-3" onSubmit={(event) => void saveCheckIn(event)}>
          <label className="grid gap-1 text-sm text-[var(--text-secondary)]">
            Tidur (jam)
            <input
              className={`${control} w-24`}
              type="number"
              step="0.5"
              min="2"
              max="12"
              required
              value={Number.isNaN(sleepHours) ? '' : sleepHours}
              onChange={(event) => setSleepHours(event.target.valueAsNumber)}
            />
          </label>
          <fieldset className="flex flex-wrap gap-1">
            <legend className="mb-1 text-sm text-[var(--text-secondary)]">Energi</legend>
            {[1, 2, 3, 4, 5].map((level) => (
              <button
                key={level}
                type="button"
                onClick={() => setEnergyLevel(level)}
                aria-pressed={energyLevel === level}
                className={`${control} min-w-11 cursor-pointer hover:bg-[var(--accent-soft)]`}
                style={energyLevel === level ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : undefined}
              >
                {level}
              </button>
            ))}
          </fieldset>
          <label className="grid gap-1 text-sm text-[var(--text-secondary)]">
            Kondisi
            <select
              value={mentalState}
              onChange={(event) => setMentalState(event.target.value as DailyCheckInItem['mental_state'])}
              className={control}
            >
              <option value="focused">Fokus</option>
              <option value="calm">Tenang</option>
              <option value="rushed">Terburu-buru</option>
              <option value="tilted">Tidak stabil</option>
              <option value="exhausted">Lelah</option>
            </select>
          </label>
          <button type="submit" disabled={checkInStatus === 'saving'} className={`${sectionAction} px-3`}>
            {checkInStatus === 'saving' ? 'Menyimpan…' : 'Simpan cek pagi'}
          </button>
        </form>
        {checkInStatus === 'error' && <p role="alert" className={`mt-2 ${supportingText}`}>Cek pagi gagal disimpan. Coba lagi.</p>}
        {checkInStatus === 'saved' && <p role="status" className={`mt-2 ${supportingText}`}>Cek pagi tersimpan.</p>}
        {kpis.todayCheckIn?.tilt_guard_advice && <p className={`mt-3 ${supportingText}`}>{kpis.todayCheckIn.tilt_guard_advice}</p>}

        {kpis.habits.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2 border-t border-[var(--border-subtle)] pt-3" role="group" aria-label="Tandai kebiasaan">
            {kpis.habits.map((habit) => (
              <button
                key={habit.id}
                type="button"
                disabled={!!action.pending}
                onClick={() => void action.run(habit.id, () => onToggleHabit(habit.id, !habit.completedToday), 'Kebiasaan belum dapat diperbarui.')}
                aria-pressed={habit.completedToday}
                className={`${control} inline-flex max-w-full cursor-pointer items-center gap-2 py-1 text-left hover:bg-[var(--accent-soft)]`}
                style={habit.completedToday ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : undefined}
              >
                {habit.completedToday && <CheckCircle2 size={15} className="shrink-0" aria-hidden />}
                <span>{habit.title}</span>
                <span className="shrink-0 text-xs text-[var(--text-secondary)]">{habit.current_streak} hari</span>
              </button>
            ))}
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <section className={card} aria-labelledby="overview-watchlist">
          <h2 id="overview-watchlist" className={sectionTitle}><TrendingUp size={17} aria-hidden /> Watchlist</h2>
          <div className="my-2 flex flex-wrap gap-1.5" role="group" aria-label="Simbol watchlist">
            {watchlist.map(({ symbol, label }) => (
              <button
                key={symbol}
                type="button"
                aria-pressed={watchlistSymbol === symbol}
                onClick={() => onSelectWatchlistSymbol(symbol)}
                className={`${control} cursor-pointer font-medium hover:bg-[var(--accent-soft)]`}
                style={watchlistSymbol === symbol ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : undefined}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="relative min-h-[170px] overflow-hidden rounded-lg bg-[var(--bg-elevated)]">
            <div ref={tvContainerRef} />
            {chartState !== 'ready' && (
              <p className={`absolute inset-0 grid place-items-center p-4 text-center ${supportingText}`} role="status">
                {chartState === 'loading' ? 'Memuat grafik…' : 'Grafik TradingView tidak tersedia.'}
              </p>
            )}
          </div>
          <p className="mt-2 text-xs text-[var(--text-secondary)]">Data dari TradingView · Bukan saran investasi</p>

          {marketEvents.length > 0 && (
            <div className="mt-4 border-t border-[var(--border-subtle)] pt-3">
              <h3 className="mb-1 text-sm font-medium">Kalender ekonomi</h3>
              <ul>
                {marketEvents.map((event) => (
                  <li key={event.id} className={`${rowBorder} py-2 text-sm`}>
                    <p>{event.event_name}</p>
                    <p className="mt-0.5 text-xs text-[var(--text-secondary)]">{event.country} · {dateLabel(event.scheduled_at)}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <section className={card} aria-labelledby="overview-news">
          <header className="flex flex-wrap items-center justify-between gap-x-2">
            <h2 id="overview-news" className={sectionTitle}><Newspaper size={17} aria-hidden /> Berita pasar & AI</h2>
            <button
              type="button"
              onClick={() => void refreshMarket()}
              disabled={marketStatus === 'refreshing'}
              className={sectionAction}
            >
              <RefreshCw size={15} aria-hidden /> {marketStatus === 'refreshing' ? 'Memuat…' : 'Perbarui'}
            </button>
          </header>
          {marketStatus === 'error' && <p role="alert" className={supportingText}>Berita gagal diperbarui. Coba lagi.</p>}
          {news.length > 0 ? (
            <ul>
              {news.slice(0, 4).map((article) => (
                <li key={article.id} className={`${rowBorder} flex items-start justify-between gap-2 py-2.5`}>
                  <div className="min-w-0">
                    <a href={article.url} target="_blank" rel="noreferrer" className="block break-words rounded text-sm leading-snug font-medium hover:underline">
                      {article.title}
                    </a>
                    <p className="mt-1 break-words text-xs text-[var(--text-secondary)]">
                      {article.url.startsWith('https://example.local/') ? 'Contoh artikel' : article.source_name} · {dateLabel(article.published_at)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onAskLlamreiWithContext(
                      `Ringkas & terjemahkan berita ini ke poin penting untuk trader: ${article.title}`,
                      article as unknown as Record<string, unknown>,
                    )}
                    aria-label={`Ringkas berita dengan Llamrei, ${article.title}`}
                    className={sectionAction}
                  >
                    <Sparkles size={15} aria-hidden /> Ringkas
                  </button>
                </li>
              ))}
            </ul>
          ) : <p className={supportingText}>Belum ada berita tersedia.</p>}
        </section>
      </div>
    </div>
  );
}
