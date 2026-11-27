import { getDb, todayWibIsoDate } from '../db/connection.ts';
import { sseBus } from '../lib/sse.ts';
import { updateTask } from './workspace.service.ts';

export type MentalState = 'calm' | 'focused' | 'rushed' | 'tilted' | 'exhausted';
export type TiltRiskLevel = 'low' | 'moderate' | 'high';

export interface DailyCheckInRow {
  date_wib: string;
  wake_time: string | null;
  sleep_hours: number;
  energy_level: number;
  mental_state: MentalState;
  tilt_risk_level: TiltRiskLevel;
  tilt_guard_advice: string | null;
  top_priority_note: string | null;
  created_at: string;
}

export interface HabitWithTodayRow {
  id: string;
  title: string;
  icon: string;
  target_days_per_week: number;
  current_streak: number;
  best_streak: number;
  completedToday: boolean;
}

export function evaluateTiltGuard(params: {
  sleepHours: number;
  energyLevel: number;
  mentalState: MentalState;
  hasHighImpactNewsToday: boolean;
}): { risk: TiltRiskLevel; advice: string } {
  const { sleepHours, energyLevel, mentalState, hasHighImpactNewsToday } = params;
  const badMental = mentalState === 'tilted' || mentalState === 'exhausted' || mentalState === 'rushed';

  if (
    mentalState === 'tilted' ||
    ((sleepHours < 5.5 || energyLevel <= 2) && hasHighImpactNewsToday) ||
    (sleepHours < 4.5 && badMental)
  ) {
    return {
      risk: 'high',
      advice: hasHighImpactNewsToday
        ? 'TILT GUARD TINGGI: Tidur/energi rendah bertepatan dengan rilis berita High-Impact (CPI/NFP/FOMC) hari ini. Hindari entry impulsif, kurangi lot 50% atau observasi saja, dan fokus pada 1 tugas prioritas.'
        : 'TILT GUARD TINGGI: Kondisi mental/energi tidak optimal. Jangan buka posisi trading berisiko tinggi dan pecah tugas ClickUp menjadi blok ringan 25 menit.',
    };
  }

  if (sleepHours < 6.5 || energyLevel <= 3 || badMental) {
    return {
      risk: 'moderate',
      advice: 'TILT GUARD SEDANG: Energi menengah. Batasi sesi trading hanya pada setup A+ dan selesaikan tugas Deep Work tersulit di pagi hari.',
    };
  }

  return {
    risk: 'low',
    advice: 'KONDISI OPTIMAL: Tidur & fokus terjaga. Aman menjalankan blok Deep Work penuh dan rencana trading sesuai aturan.',
  };
}

export function saveDailyCheckIn(input: {
  wakeTime?: string | null;
  sleepHours: number;
  energyLevel: number;
  mentalState: MentalState;
  topPriorityNote?: string | null;
}): DailyCheckInRow {
  const db = getDb();
  const today = todayWibIsoDate();

  const highImpactCnt = db
    .prepare("SELECT COUNT(*) AS cnt FROM economic_events WHERE impact = 'high' AND scheduled_at LIKE ?")
    .get(`${today}%`) as { cnt: number };

  const evalRes = evaluateTiltGuard({
    sleepHours: input.sleepHours,
    energyLevel: input.energyLevel,
    mentalState: input.mentalState,
    hasHighImpactNewsToday: highImpactCnt.cnt > 0,
  });

  db.prepare(
    `INSERT INTO daily_checkins (date_wib, wake_time, sleep_hours, energy_level, mental_state, tilt_risk_level, tilt_guard_advice, top_priority_note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(date_wib) DO UPDATE SET
       wake_time = excluded.wake_time,
       sleep_hours = excluded.sleep_hours,
       energy_level = excluded.energy_level,
       mental_state = excluded.mental_state,
       tilt_risk_level = excluded.tilt_risk_level,
       tilt_guard_advice = excluded.tilt_guard_advice,
       top_priority_note = excluded.top_priority_note`,
  ).run(
    today,
    input.wakeTime ?? null,
    input.sleepHours,
    input.energyLevel,
    input.mentalState,
    evalRes.risk,
    evalRes.advice,
    input.topPriorityNote ?? null,
  );

  const row = db.prepare('SELECT * FROM daily_checkins WHERE date_wib = ?').get(today) as unknown as DailyCheckInRow;
  sseBus.emit('lifeos:checkin', row);
  return row;
}

export function getRealDataKpis(): {
  todayCheckIn: DailyCheckInRow | null;
  executionScorePercent: number;
  completedTasks: number;
  totalTasks: number;
  deepWorkHoursTotal: number;
  habits: HabitWithTodayRow[];
  habitCompletionPercent: number;
} {
  const db = getDb();
  const today = todayWibIsoDate();
  const todayCheckIn = db.prepare('SELECT * FROM daily_checkins WHERE date_wib = ?').get(today) as unknown as
    | DailyCheckInRow
    | undefined;

  const taskStats = db
    .prepare(
      `SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'Done' THEN 1 ELSE 0 END) AS done_cnt
       FROM tasks WHERE parent_task_id IS NULL`,
    )
    .get() as { total: number; done_cnt: number | null };

  const totalTasks = taskStats.total;
  const completedTasks = taskStats.done_cnt ?? 0;
  const executionScorePercent = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  const timeStats = db.prepare('SELECT COALESCE(SUM(time_spent_seconds), 0) AS sec FROM tasks').get() as { sec: number };
  const deepWorkHoursTotal = Math.round((timeStats.sec / 3600) * 10) / 10;

  const rawHabits = db.prepare('SELECT * FROM habits WHERE is_active = 1 ORDER BY sort_order ASC').all() as Array<{
    id: string;
    title: string;
    icon: string;
    target_days_per_week: number;
    current_streak: number;
    best_streak: number;
  }>;
  const todayLogs = new Set(
    (
      db.prepare('SELECT habit_id FROM habit_logs WHERE date_wib = ? AND completed = 1').all(today) as Array<{
        habit_id: string;
      }>
    ).map((r) => r.habit_id),
  );

  const habits: HabitWithTodayRow[] = rawHabits.map((h) => ({
    ...h,
    completedToday: todayLogs.has(h.id),
  }));
  const doneHabits = habits.filter((h) => h.completedToday).length;
  const habitCompletionPercent = habits.length > 0 ? Math.round((doneHabits / habits.length) * 100) : 0;

  return {
    todayCheckIn: todayCheckIn ?? null,
    executionScorePercent,
    completedTasks,
    totalTasks,
    deepWorkHoursTotal,
    habits,
    habitCompletionPercent,
  };
}

export function toggleHabitForToday(habitId: string, completed: boolean): HabitWithTodayRow[] {
  const db = getDb();
  const today = todayWibIsoDate();

  if (completed) {
    db.prepare('INSERT OR REPLACE INTO habit_logs (habit_id, date_wib, completed) VALUES (?, ?, 1)').run(habitId, today);
    db.prepare(
      `UPDATE habits
       SET current_streak = current_streak + 1,
           best_streak = MAX(best_streak, current_streak + 1)
       WHERE id = ?`,
    ).run(habitId);
  } else {
    db.prepare('DELETE FROM habit_logs WHERE habit_id = ? AND date_wib = ?').run(habitId, today);
    db.prepare('UPDATE habits SET current_streak = MAX(0, current_streak - 1) WHERE id = ?').run(habitId);
  }

  const kpis = getRealDataKpis();
  sseBus.emit('lifeos:kpi', kpis);
  return kpis.habits;
}

export interface AutoScheduleProposal {
  taskId: string;
  title: string;
  priority: string;
  blockStart: string;
  blockEnd: string;
  reason: string;
}

/**
 * Motion-style Energy & Market-Aware Auto-Scheduler (FR-48):
 * Assigns open ClickUp tasks into free Deep Work slots today in WIB,
 * avoiding Notion/Calendar meetings and +-30 minutes around High-Impact news releases.
 */
export function computeAutoScheduleForToday(applyImmediately = false, now = new Date()): {
  dateWib: string;
  blockedWindows: Array<{ label: string; startMs: number; endMs: number }>;
  proposals: AutoScheduleProposal[];
} {
  const db = getDb();
  const today = todayWibIsoDate(now);
  const dayStartMs = Date.parse(`${today}T08:00:00+07:00`);
  const dayEndMs = Date.parse(`${today}T22:00:00+07:00`);
  const dayStart = new Date(dayStartMs).toISOString();
  const dayEnd = new Date(dayEndMs).toISOString();

  const openTasks = db
    .prepare(
      `SELECT id, title, priority, time_estimate_minutes
       FROM tasks
       WHERE parent_task_id IS NULL AND status != 'Done'
       ORDER BY CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
                COALESCE(due_at, '9999') ASC
       LIMIT 6`,
    )
    .all() as Array<{ id: string; title: string; priority: string; time_estimate_minutes: number }>;

  const blockedWindows: Array<{ label: string; startMs: number; endMs: number }> = [];

  // Block non-task calendar events (Notion meetings, local events)
  const calEvents = db
    .prepare(`
      SELECT title, start_at, end_at, all_day FROM calendar_events
      WHERE source != 'clickup_task' AND julianday(start_at) < julianday(?)
      AND CASE
        WHEN julianday(end_at) > julianday(start_at) AND all_day = 0 THEN julianday(end_at)
        ELSE MAX(COALESCE(julianday(end_at), julianday(start_at)),
                 julianday(start_at) + CASE all_day WHEN 1 THEN 1 ELSE 1.0 / 24 END)
      END > julianday(?)
    `)
    .all(dayEnd, dayStart) as Array<{ title: string; start_at: string; end_at: string | null; all_day: number }>;
  for (const event of calEvents) {
    const startMs = Date.parse(event.start_at);
    const explicitEnd = Date.parse(event.end_at ?? '');
    const endMs = event.all_day === 1 ? Math.max(explicitEnd || startMs, startMs + 86_400_000)
      : explicitEnd > startMs ? explicitEnd : startMs + 3_600_000;
    blockedWindows.push({ label: event.title, startMs, endMs });
  }

  // Block +-30m around High-Impact Economic Events (CPI, NFP, FOMC)
  const highNews = db
    .prepare(`
      SELECT event_name, scheduled_at FROM economic_events
      WHERE impact = 'high' AND julianday(scheduled_at) BETWEEN julianday(?, '-30 minutes') AND julianday(?, '+30 minutes')
    `)
    .all(dayStart, dayEnd) as Array<{ event_name: string; scheduled_at: string }>;
  for (const n of highNews) {
    const t = Date.parse(n.scheduled_at);
    if (!Number.isNaN(t)) {
      blockedWindows.push({
        label: `High-Impact Market: ${n.event_name}`,
        startMs: t - 30 * 60_000,
        endMs: t + 30 * 60_000,
      });
    }
  }

  let cursorMs = Math.max(dayStartMs, Math.ceil(now.valueOf() / (15 * 60_000)) * 15 * 60_000);

  const proposals: AutoScheduleProposal[] = [];

  for (const task of openTasks) {
    const durMin = Math.max(25, Math.min(90, task.time_estimate_minutes || 45));
    const durMs = durMin * 60_000;

    while (cursorMs + durMs <= dayEndMs) {
      const candidateEnd = cursorMs + durMs;
      const conflict = blockedWindows.find((b) => cursorMs < b.endMs && candidateEnd > b.startMs);
      if (!conflict) {
        const blockStart = new Date(cursorMs).toISOString();
        const blockEnd = new Date(candidateEnd).toISOString();
        proposals.push({
          taskId: task.id,
          title: task.title,
          priority: task.priority,
          blockStart,
          blockEnd,
          reason: `Blok ${durMin}m bebas bentrok rapat & rilis High-Impact`,
        });
        cursorMs = candidateEnd + 15 * 60_000; // 15m recovery buffer
        break;
      }
      cursorMs = conflict.endMs + 5 * 60_000;
    }
  }

  if (applyImmediately) applyAutoSchedulePlan(proposals);
  return { dateWib: today, blockedWindows, proposals };
}

export function applyAutoSchedulePlan(proposals: AutoScheduleProposal[]): void {
  const db = getDb();
  db.exec('SAVEPOINT apply_schedule');
  try {
    for (const { taskId, blockStart, blockEnd } of proposals) {
      updateTask(taskId, { autoScheduledBlockStart: blockStart, autoScheduledBlockEnd: blockEnd });
    }
    db.exec('RELEASE apply_schedule');
  } catch (error) {
    db.exec('ROLLBACK TO apply_schedule; RELEASE apply_schedule');
    throw error;
  }
}
