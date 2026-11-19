import { useState } from 'react';
import type { MacroGoal } from '../../types/llamrei';

interface AutoProposal {
  taskId: string;
  title: string;
  priority: string;
  blockStart: string;
  blockEnd: string;
  reason: string;
}

interface Props {
  goals: MacroGoal[];
  bottlenecks: {
    postponedTasks: Array<{ id: string; title: string; postponed_count: number; status: string; priority: string }>;
    spaceTimeBreakdown: Array<{ space_name: string; color: string; total_minutes: number; task_count: number; done_count: number }>;
    summaryAdvice: string;
  };
  onCreateGoal: (input: { title: string; category: MacroGoal['category']; targetMetricLabel?: string }) => Promise<void>;
  onComputeAutoSchedule: (apply: boolean) => Promise<{
    proposals: AutoProposal[];
    blockedWindows: Array<{ label: string }>;
  }>;
}

export function GoalsAndLifeOsView({ goals, bottlenecks, onCreateGoal, onComputeAutoSchedule }: Props) {
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<MacroGoal['category']>('academic');
  const [metric, setMetric] = useState('');
  const [proposals, setProposals] = useState<AutoProposal[] | null>(null);
  const [blockedNotes, setBlockedNotes] = useState<string[]>([]);
  const [appliedNote, setAppliedNote] = useState<string | null>(null);

  const previewAutoSchedule = async () => {
    const res = await onComputeAutoSchedule(false);
    setProposals(res.proposals);
    setBlockedNotes(res.blockedWindows.map((b) => b.label));
    setAppliedNote(null);
  };

  const applyAutoSchedule = async () => {
    const res = await onComputeAutoSchedule(true);
    setProposals(res.proposals);
    setAppliedNote(`${res.proposals.length} blok tugas berhasil diterapkan ke Kalender Website & Reminder!`);
  };

  return (
    <div className="space-y-3">
      <div className="pb-2 border-b flex flex-wrap items-center justify-between gap-2" style={{ borderColor: 'var(--border-subtle)' }}>
        <div>
          <div className="text-xs font-mono-num" style={{ color: 'var(--accent)' }}>
            LIFE OS PRIME // GOAL ARCHITECTURE, MOTION AUTO-SCHEDULER & BOTTLENECK DETECTOR
          </div>
          <h1 className="text-sm font-bold">Arsitektur Tujuan & Evaluasi Performa Nyata</h1>
        </div>
        <button
          onClick={() => void previewAutoSchedule()}
          className="px-3 py-1.5 rounded text-xs font-mono-num font-bold cursor-pointer"
          style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
        >
          ⚡ Preview Auto-Schedule Hari Ini
        </button>
      </div>

      {/* Motion-Style Energy & Market-Aware Auto-Scheduler */}
      {proposals && (
        <div className="themed-card p-3 space-y-2 text-xs" style={{ borderColor: 'var(--border-accent)' }}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-mono-num font-bold" style={{ color: 'var(--accent)' }}>
              USULAN BLOK DEEP WORK HARI INI ({proposals.length} TUGAS)
            </span>
            <button
              onClick={() => void applyAutoSchedule()}
              className="px-3 py-1 rounded font-mono-num font-bold cursor-pointer"
              style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
            >
              ✓ Terapkan ke Kalender & Reminder
            </button>
          </div>
          {blockedNotes.length > 0 && (
            <div style={{ color: 'var(--text-muted)' }}>
              Otomatis menghindari: {blockedNotes.join(' · ')}
            </div>
          )}
          <div className="space-y-1">
            {proposals.map((p) => (
              <div key={p.taskId} className="bg-black/25 px-2.5 py-1.5 rounded flex items-center justify-between">
                <div>
                  <span className="font-semibold">{p.title}</span>{' '}
                  <span style={{ color: 'var(--text-muted)' }}>({p.reason})</span>
                </div>
                <span className="font-mono-num" style={{ color: 'var(--accent-2)' }}>
                  {new Date(p.blockStart).toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit' })}–
                  {new Date(p.blockEnd).toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit' })} WIB
                </span>
              </div>
            ))}
          </div>
          {appliedNote && (
            <div className="font-mono-num" style={{ color: 'var(--accent)' }}>
              ✓ {appliedNote}
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
        {/* Macro Goals */}
        <div className="themed-card p-3 space-y-3 text-xs">
          <div className="font-mono-num font-bold" style={{ color: 'var(--text-secondary)' }}>
            🎯 MACRO GOALS ARCHITECTURE ({goals.length})
          </div>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!title.trim()) return;
              await onCreateGoal({ title: title.trim(), category, targetMetricLabel: metric.trim() || undefined });
              setTitle('');
              setMetric('');
            }}
            className="grid grid-cols-2 gap-1.5 bg-black/25 p-2 rounded"
          >
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Judul Macro Goal..."
              className="col-span-2 px-2 py-1 rounded border outline-none"
              style={{ background: 'var(--bg-void)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
            />
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as MacroGoal['category'])}
              className="px-2 py-1 rounded border"
              style={{ background: 'var(--bg-void)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
            >
              <option value="academic">Academic / Skripsi</option>
              <option value="trading">Trading</option>
              <option value="organization">Organization</option>
              <option value="financial">Financial</option>
              <option value="personal">Personal</option>
            </select>
            <input
              value={metric}
              onChange={(e) => setMetric(e.target.value)}
              placeholder="Target metrik..."
              className="px-2 py-1 rounded border outline-none"
              style={{ background: 'var(--bg-void)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
            />
            <button type="submit" className="col-span-2 py-1 rounded font-bold cursor-pointer" style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}>
              + Tambah Macro Goal
            </button>
          </form>

          <div className="space-y-2">
            {goals.map((g) => (
              <div key={g.id} className="bg-black/25 p-2.5 rounded space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-semibold">{g.title}</span>
                  <span className="font-mono-num" style={{ color: 'var(--accent)' }}>
                    {g.progress_percent}%
                  </span>
                </div>
                <div className="h-1.5 rounded-full overflow-hidden bg-black/40">
                  <div className="h-full rounded-full" style={{ width: `${g.progress_percent}%`, background: 'var(--accent)' }} />
                </div>
                <div className="flex justify-between font-mono-num" style={{ color: 'var(--text-muted)' }}>
                  <span>{g.category.toUpperCase()}</span>
                  <span>{g.target_metric_label ?? ''}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Weekly Bottleneck & Time-Leak Detector */}
        <div className="themed-card p-3 space-y-3 text-xs">
          <div className="font-mono-num font-bold" style={{ color: 'var(--text-secondary)' }}>
            🔍 WEEKLY BOTTLENECK & TIME-LEAK DETECTOR (FR-51)
          </div>
          <div className="p-2.5 rounded bg-black/25 border border-amber-500/30 text-amber-200">
            {bottlenecks.summaryAdvice}
          </div>

          <div className="space-y-1.5">
            <div className="font-mono-num" style={{ color: 'var(--text-muted)' }}>
              DISTRIBUSI WAKTU PER SPACE
            </div>
            {bottlenecks.spaceTimeBreakdown.map((s) => (
              <div key={s.space_name} className="bg-black/25 px-2.5 py-1.5 rounded flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-sm" style={{ background: s.color }} />
                  <span className="font-medium">{s.space_name}</span>
                </div>
                <span className="font-mono-num">
                  {Math.round(s.total_minutes)}m · {s.done_count}/{s.task_count} selesai
                </span>
              </div>
            ))}
          </div>

          <div className="space-y-1.5">
            <div className="font-mono-num" style={{ color: 'var(--text-muted)' }}>
              TUGAS SERING TERTUNDA (POSTPONED)
            </div>
            {bottlenecks.postponedTasks.length === 0 ? (
              <div style={{ color: 'var(--text-muted)' }}>Belum ada tugas yang digeser tenggatnya.</div>
            ) : (
              bottlenecks.postponedTasks.map((t) => (
                <div key={t.id} className="bg-black/25 px-2.5 py-1.5 rounded flex items-center justify-between">
                  <span className="truncate">{t.title}</span>
                  <span className="font-mono-num text-rose-400 shrink-0 ml-2">Ditunda {t.postponed_count}x</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
