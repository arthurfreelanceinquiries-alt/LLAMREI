import { useEffect, useRef, useState } from 'react';
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
  onSelectWatchlistSymbol: (sym: string) => void;
  onSaveCheckIn: (input: { sleepHours: number; energyLevel: number; mentalState: DailyCheckInItem['mental_state'] }) => Promise<void>;
  onToggleHabit: (habitId: string, completed: boolean) => Promise<void>;
  onCycleTaskStatus: (task: TaskItem) => Promise<void>;
  onOpenTask: (task: TaskItem) => void;
  onNavigateTab: (tab: NavTab) => void;
  onAskLlamreiWithContext: (prompt: string, context: Record<string, unknown>) => void;
  onAutoSchedule: () => void;
  onRefreshMarket: () => Promise<void>;
}

const WATCHLIST = [
  { symbol: 'OANDA:XAUUSD', label: 'XAU/USD', price: '2,642.80', delta: '+0.64%', up: true },
  { symbol: 'FX:EURUSD', label: 'EUR/USD', price: '1.0584', delta: '-0.18%', up: false },
  { symbol: 'BINANCE:BTCUSDT', label: 'BTC/USDT', price: '94,120', delta: '+1.85%', up: true },
  { symbol: 'TVC:DXY', label: 'DXY', price: '106.24', delta: '+0.12%', up: true },
];

export function MorningBentoView({
  kpis,
  tasks,
  alarms,
  calendarEvents,
  scheduledMessages,
  news,
  economicEvents,
  watchlistSymbol,
  onSelectWatchlistSymbol,
  onSaveCheckIn,
  onToggleHabit,
  onCycleTaskStatus,
  onOpenTask,
  onNavigateTab,
  onAskLlamreiWithContext,
  onAutoSchedule,
  onRefreshMarket,
}: Props) {
  const [sleepHours, setSleepHours] = useState(kpis.todayCheckIn?.sleep_hours ?? 7);
  const [energyLevel, setEnergyLevel] = useState(kpis.todayCheckIn?.energy_level ?? 4);
  const [mentalState, setMentalState] = useState<DailyCheckInItem['mental_state']>(kpis.todayCheckIn?.mental_state ?? 'focused');
  const tvContainerRef = useRef<HTMLDivElement | null>(null);
  const [tvOfflineFallback, setTvOfflineFallback] = useState(false);

  useEffect(() => {
    const el = tvContainerRef.current;
    if (!el) return;
    el.innerHTML = '';
    setTvOfflineFallback(false);

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
      colorTheme: 'dark',
      isTransparent: true,
      autosize: false,
      largeChartUrl: '',
    });
    script.onerror = () => setTvOfflineFallback(true);
    el.appendChild(script);
  }, [watchlistSymbol]);

  const openTasks = tasks.filter((t) => !t.parent_task_id && t.status !== 'Done').slice(0, 4);
  const nextHardAlarm = alarms.find((a) => a.kind === 'hard_alarm' && a.enabled === 1 && a.status !== 'dismissed');
  const pendingChats = scheduledMessages.filter((m) => m.status === 'pending_approval' || m.status === 'approved').slice(0, 2);

  return (
    <div className="space-y-3">
      {/* Header Row */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-sm font-bold tracking-tight flex items-center gap-2">
            <span>MORNING COMMAND BENTO</span>
            <span
              className="text-xs font-mono-num px-1.5 py-0.5 rounded border"
              style={{ background: 'var(--accent-soft)', color: 'var(--accent)', borderColor: 'var(--border-accent)' }}
            >
              LIFE OS + TRADER
            </span>
          </h1>
          <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            Satu layar pagi: 10s Check-In, Alarm Tugas, Kalender, ClickUp, Jadwal Chat, Watchlist & CPI/FOMC.
          </p>
        </div>
        <button
          onClick={onAutoSchedule}
          className="px-3 py-1.5 rounded text-xs font-mono-num font-bold cursor-pointer"
          style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
        >
          ⚡ Auto-Schedule Hari Ini
        </button>
      </div>

      {/* 10-Second Morning Check-In & Trader Tilt Guard (FR-47) */}
      <div className="themed-card p-3 space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono-num font-bold" style={{ color: 'var(--accent)' }}>
              10-SECOND MORNING CHECK-IN & TILT GUARD
            </span>
            {kpis.todayCheckIn && (
              <span
                className="text-xs font-mono-num px-2 py-0.5 rounded border font-bold"
                style={{
                  background:
                    kpis.todayCheckIn.tilt_risk_level === 'high'
                      ? 'rgba(239,68,68,0.18)'
                      : kpis.todayCheckIn.tilt_risk_level === 'moderate'
                        ? 'rgba(245,158,11,0.18)'
                        : 'var(--accent-soft)',
                  borderColor:
                    kpis.todayCheckIn.tilt_risk_level === 'high'
                      ? 'rgba(239,68,68,0.5)'
                      : kpis.todayCheckIn.tilt_risk_level === 'moderate'
                        ? 'rgba(245,158,11,0.5)'
                        : 'var(--border-accent)',
                  color:
                    kpis.todayCheckIn.tilt_risk_level === 'high'
                      ? '#f87171'
                      : kpis.todayCheckIn.tilt_risk_level === 'moderate'
                        ? '#fbbf24'
                        : 'var(--accent)',
                }}
              >
                RISK: {kpis.todayCheckIn.tilt_risk_level.toUpperCase()}
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <label className="flex items-center gap-1 font-mono-num">
              <span style={{ color: 'var(--text-muted)' }}>Tidur:</span>
              <input
                type="number"
                step="0.5"
                min="2"
                max="12"
                value={sleepHours}
                onChange={(e) => setSleepHours(Number(e.target.value))}
                className="w-14 px-1.5 py-0.5 rounded border text-center"
                style={{ background: 'var(--bg-void)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
              />
              <span>jam</span>
            </label>

            <div className="flex items-center gap-1">
              <span className="font-mono-num" style={{ color: 'var(--text-muted)' }}>
                Energi:
              </span>
              {[1, 2, 3, 4, 5].map((lvl) => (
                <button
                  key={lvl}
                  onClick={() => setEnergyLevel(lvl)}
                  className="px-1.5 py-0.5 rounded text-xs font-mono-num border cursor-pointer"
                  style={
                    energyLevel === lvl
                      ? { background: 'var(--accent)', color: 'var(--accent-fg)', borderColor: 'var(--accent)' }
                      : { background: 'var(--bg-void)', borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }
                  }
                >
                  {lvl}⚡
                </button>
              ))}
            </div>

            <select
              value={mentalState}
              onChange={(e) => setMentalState(e.target.value as DailyCheckInItem['mental_state'])}
              className="px-2 py-0.5 rounded border text-xs"
              style={{ background: 'var(--bg-void)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
            >
              <option value="focused">Focused</option>
              <option value="calm">Calm</option>
              <option value="rushed">Rushed</option>
              <option value="tilted">Tilted</option>
              <option value="exhausted">Exhausted</option>
            </select>

            <button
              onClick={() => void onSaveCheckIn({ sleepHours, energyLevel, mentalState })}
              className="px-2.5 py-0.5 rounded text-xs font-mono-num font-bold cursor-pointer"
              style={{ background: 'var(--accent-soft)', color: 'var(--accent)', border: '1px solid var(--border-accent)' }}
            >
              Simpan Cek Pagi
            </button>
          </div>
        </div>

        {kpis.todayCheckIn?.tilt_guard_advice && (
          <div className="text-xs px-2.5 py-1.5 rounded bg-black/25 border" style={{ borderColor: 'var(--border-subtle)' }}>
            {kpis.todayCheckIn.tilt_guard_advice}
          </div>
        )}
      </div>

      {/* Real-Data KPI & Habit Streak Row (FR-49) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
        <div className="themed-card p-2.5 space-y-1.5">
          <div className="flex justify-between text-xs font-mono-num">
            <span style={{ color: 'var(--text-muted)' }}>EXECUTION SCORE</span>
            <span style={{ color: 'var(--accent)' }}>
              {kpis.executionScorePercent}% ({kpis.completedTasks}/{kpis.totalTasks})
            </span>
          </div>
          <div className="h-2 rounded-full overflow-hidden bg-black/40">
            <div className="h-full rounded-full transition-all" style={{ width: `${kpis.executionScorePercent}%`, background: 'var(--accent)' }} />
          </div>
        </div>

        <div className="themed-card p-2.5 space-y-1.5">
          <div className="flex justify-between text-xs font-mono-num">
            <span style={{ color: 'var(--text-muted)' }}>DEEP WORK LOGGED</span>
            <span style={{ color: 'var(--accent-2)' }}>{kpis.deepWorkHoursTotal} jam</span>
          </div>
          <div className="h-2 rounded-full overflow-hidden bg-black/40">
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${Math.min(100, Math.round((kpis.deepWorkHoursTotal / 6) * 100))}%`, background: 'var(--accent-2)' }}
            />
          </div>
        </div>

        <div className="themed-card p-2.5 space-y-1">
          <div className="flex justify-between text-xs font-mono-num">
            <span style={{ color: 'var(--text-muted)' }}>HABIT STREAKS</span>
            <span>{kpis.habitCompletionPercent}% hari ini</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {kpis.habits.map((h) => (
              <button
                key={h.id}
                onClick={() => void onToggleHabit(h.id, !h.completedToday)}
                className="px-2 py-0.5 rounded text-xs border cursor-pointer"
                style={
                  h.completedToday
                    ? { background: 'var(--accent-soft)', color: 'var(--accent)', borderColor: 'var(--border-accent)' }
                    : { background: 'var(--bg-void)', borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }
                }
              >
                {h.completedToday ? '✓' : '□'} {h.title.split(' ')[0]} ({h.current_streak}d)
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* TradingView Watchlist + Agenda/Alarm/Chat Summary */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5">
        {/* Trader Panel */}
        <div className="themed-card p-2.5 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-mono-num font-bold" style={{ color: 'var(--text-secondary)' }}>
              📈 WATCHLIST & CHART TRADINGVIEW
            </span>
            <div className="flex gap-1">
              {WATCHLIST.map((w) => (
                <button
                  key={w.symbol}
                  onClick={() => onSelectWatchlistSymbol(w.symbol)}
                  className="px-1.5 py-0.5 rounded text-xs font-mono-num border cursor-pointer"
                  style={
                    watchlistSymbol === w.symbol
                      ? { background: 'var(--accent-soft)', color: 'var(--accent)', borderColor: 'var(--border-accent)' }
                      : { background: 'var(--bg-void)', borderColor: 'var(--border-subtle)', color: 'var(--text-muted)' }
                  }
                >
                  {w.label}
                </button>
              ))}
            </div>
          </div>

          <div ref={tvContainerRef} className="min-h-[170px] rounded overflow-hidden bg-black/30" />
          {tvOfflineFallback && (
            <div className="text-xs font-mono-num p-2 rounded bg-black/30">
              Offline/Blocked fallback — {WATCHLIST.map((w) => `${w.label}: ${w.price} (${w.delta})`).join(' · ')}
            </div>
          )}

          <div className="flex items-center justify-between text-xs pt-1 border-t" style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-muted)' }}>
            <span>Powered by TradingView (Atribusi Resmi)</span>
            <span>Catatan: Bukan saran investasi (FR-43)</span>
          </div>
        </div>

        {/* Agenda, Hard Alarm & Scheduled Chats */}
        <div className="themed-card p-2.5 space-y-2 flex flex-col justify-between">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono-num font-bold" style={{ color: 'var(--text-secondary)' }}>
                📅 KALENDER, ALARM & JADWAL CHAT
              </span>
              <button
                onClick={() => onNavigateTab('calendar')}
                className="text-xs font-mono-num hover:underline cursor-pointer"
                style={{ color: 'var(--accent)' }}
              >
                Buka Kalender & Alarm →
              </button>
            </div>

            {nextHardAlarm && (
              <div className="px-2.5 py-1.5 rounded border border-amber-500/40 bg-amber-500/10 text-xs flex items-center justify-between">
                <span className="font-semibold text-amber-300">⏰ Hard Alarm: {nextHardAlarm.title}</span>
                <span className="font-mono-num text-amber-200">
                  {new Date(nextHardAlarm.trigger_at).toLocaleTimeString('id-ID', {
                    timeZone: 'Asia/Jakarta',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}{' '}
                  WIB
                </span>
              </div>
            )}

            <div className="space-y-1">
              {calendarEvents.slice(0, 3).map((ev) => (
                <div
                  key={ev.id}
                  className="px-2.5 py-1.5 rounded bg-black/25 text-xs flex items-center justify-between border-l-2"
                  style={{ borderLeftColor: ev.color }}
                >
                  <span className="truncate">{ev.title}</span>
                  <span className="font-mono-num shrink-0 ml-2" style={{ color: 'var(--text-secondary)' }}>
                    {new Date(ev.start_at).toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              ))}
              {pendingChats.map((m) => (
                <div
                  key={m.id}
                  onClick={() => onNavigateTab('scheduler')}
                  className="px-2.5 py-1.5 rounded bg-black/25 text-xs flex items-center justify-between border-l-2 border-amber-400 cursor-pointer"
                >
                  <span className="truncate">💬 Chat → {m.recipient_name}: {m.purpose}</span>
                  <span className="font-mono-num text-amber-300 shrink-0 ml-2">{m.status === 'pending_approval' ? 'WAIT APPROVE' : 'APPROVED'}</span>
                </div>
              ))}
            </div>
          </div>

          {/* High Impact Econ Events */}
          <div className="pt-2 border-t space-y-1" style={{ borderColor: 'var(--border-subtle)' }}>
            <div className="text-xs font-mono-num" style={{ color: 'var(--text-muted)' }}>
              KALENDER EKONOMI (CPI / NFP / FOMC)
            </div>
            {economicEvents.slice(0, 2).map((ec) => (
              <div key={ec.id} className="flex items-center justify-between text-xs bg-black/25 px-2 py-1 rounded">
                <span className="truncate">
                  <span className={ec.impact === 'high' ? 'text-rose-400 font-mono-num font-bold mr-1.5' : 'text-amber-400 font-mono-num mr-1.5'}>
                    [{ec.impact.toUpperCase()} · {ec.country}]
                  </span>
                  {ec.event_name}
                </span>
                <span className="font-mono-num shrink-0 ml-2" style={{ color: 'var(--text-secondary)' }}>
                  {new Date(ec.scheduled_at).toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit' })} WIB
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ClickUp Priority Tasks Snapshot */}
      <div className="themed-card p-2.5 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-mono-num font-bold" style={{ color: 'var(--text-secondary)' }}>
            🗂️ TUGAS PRIORITAS CLICKUP (TERHUBUNG KE KALENDER & ALARM)
          </span>
          <button
            onClick={() => onNavigateTab('clickup')}
            className="text-xs font-mono-num hover:underline cursor-pointer"
            style={{ color: 'var(--accent)' }}
          >
            Buka Workspace Penuh →
          </button>
        </div>

        <div className="space-y-1.5">
          {openTasks.map((t) => (
            <div
              key={t.id}
              className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded bg-black/25 border"
              style={{ borderColor: 'var(--border-subtle)' }}
            >
              <div className="flex items-center gap-2 min-w-0">
                <button
                  onClick={() => void onCycleTaskStatus(t)}
                  className="px-2 py-0.5 rounded text-xs font-mono-num border cursor-pointer shrink-0"
                  style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)', color: 'var(--accent)' }}
                >
                  {t.status}
                </button>
                <button onClick={() => onOpenTask(t)} className="text-xs font-medium truncate text-left hover:underline cursor-pointer">
                  {t.title}
                </button>
                {t.hard_alarm_enabled === 1 && <span title="Hard Alarm Aktif">⏰</span>}
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <span
                  className="px-1.5 py-0.5 rounded text-xs font-mono-num"
                  style={{
                    background: t.priority === 'urgent' ? 'rgba(239,68,68,0.18)' : 'rgba(245,158,11,0.16)',
                    color: t.priority === 'urgent' ? '#f87171' : '#fbbf24',
                  }}
                >
                  {t.priority.toUpperCase()}
                </span>
                <button
                  onClick={() => onAskLlamreiWithContext(`Bantu pecah atau jadwalkan tindak lanjut tugas: ${t.title}`, t as unknown as Record<string, unknown>)}
                  className="px-2 py-0.5 rounded text-xs font-mono-num border cursor-pointer"
                  style={{ background: 'var(--accent-soft)', borderColor: 'var(--border-accent)', color: 'var(--accent)' }}
                >
                  ⚡ Tanya
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Finance & AI Intel Feed */}
      <div className="themed-card p-2.5 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-mono-num font-bold" style={{ color: 'var(--text-secondary)' }}>
            📰 INTEL FEED // FINANCE, FOREX & AI
          </span>
          <button
            onClick={() => void onRefreshMarket()}
            className="text-xs font-mono-num px-2 py-0.5 rounded border cursor-pointer"
            style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)', color: 'var(--accent-2)' }}
          >
            ↻ Refresh RSS / Finnhub
          </button>
        </div>

        <div className="space-y-1.5">
          {news.slice(0, 4).map((n) => (
            <div key={n.id} className="flex items-center justify-between gap-2 bg-black/25 px-2.5 py-1.5 rounded text-xs">
              <div className="min-w-0">
                <span className="font-mono-num mr-1.5" style={{ color: 'var(--accent-2)' }}>
                  [{n.category.toUpperCase()}]
                </span>
                <a href={n.url} target="_blank" rel="noreferrer" className="hover:underline">
                  {n.title}
                </a>
              </div>
              <button
                onClick={() =>
                  onAskLlamreiWithContext(`Ringkas & terjemahkan berita ini ke poin penting untuk trader: ${n.title}`, n as unknown as Record<string, unknown>)
                }
                className="shrink-0 px-2 py-0.5 rounded text-xs font-mono-num border cursor-pointer"
                style={{ background: 'var(--accent-soft)', borderColor: 'var(--border-accent)', color: 'var(--accent)' }}
              >
                ⚡ Ringkas AI
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
