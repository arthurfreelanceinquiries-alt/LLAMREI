import { useState } from 'react';
import type { ActiveTimer, GanttWorkloadState, ListItem, MacroGoal, SpaceItem, TaskItem, TaskTemplateItem } from '../../types/llamrei';

interface Props {
  spaces: SpaceItem[];
  lists: ListItem[];
  tasks: TaskItem[];
  goals: MacroGoal[];
  templates: TaskTemplateItem[];
  ganttWorkload: GanttWorkloadState;
  selectedSpaceId: string | 'ALL';
  selectedListId: string | 'ALL';
  activeTimer: ActiveTimer | null;
  onCreateList: (spaceId: string, name: string) => Promise<void>;
  onApplyTemplate: (templateId: string, listId: string) => Promise<void>;
  onImportTasks: (listId: string, format: 'csv' | 'markdown', content: string) => Promise<{ importedCount: number }>;
  onCreateTask: (input: {
    listId: string;
    title: string;
    priority: TaskItem['priority'];
    dueAt?: string | null;
    hardAlarmEnabled?: boolean;
  }) => Promise<void>;
  onUpdateTask: (taskId: string, patch: Record<string, unknown>) => Promise<void>;
  onOpenTask: (task: TaskItem) => void;
  onStartTimer: (taskId: string) => Promise<void>;
  onStopTimer: (taskId: string) => Promise<void>;
}

const KANBAN_STATUSES = ['To Do', 'In Progress', 'Review', 'Done'];

export function ClickUpWorkspaceView({
  spaces,
  lists,
  tasks,
  templates,
  ganttWorkload,
  selectedSpaceId,
  selectedListId,
  activeTimer,
  onCreateList,
  onApplyTemplate,
  onImportTasks,
  onCreateTask,
  onUpdateTask,
  onOpenTask,
  onStartTimer,
  onStopTimer,
}: Props) {
  const [viewMode, setViewMode] = useState<'list' | 'kanban' | 'calendar' | 'gantt'>('list');
  const [importOpen, setImportOpen] = useState(false);
  const [importFormat, setImportFormat] = useState<'csv' | 'markdown'>('markdown');
  const [importContent, setImportContent] = useState('');
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [priorityFilter, setPriorityFilter] = useState<string>('ALL');
  const [newTitle, setNewTitle] = useState('');
  const [newPriority, setNewPriority] = useState<TaskItem['priority']>('high');
  const [newDue, setNewDue] = useState('');
  const [newHardAlarm, setNewHardAlarm] = useState(true);
  const [newListName, setNewListName] = useState('');
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);

  const visibleLists = lists.filter(
    (l) => (selectedSpaceId === 'ALL' || l.space_id === selectedSpaceId) && (selectedListId === 'ALL' || l.id === selectedListId),
  );
  const visibleListIds = new Set(visibleLists.map((l) => l.id));

  const parentTasks = tasks.filter(
    (t) =>
      !t.parent_task_id &&
      visibleListIds.has(t.list_id) &&
      (priorityFilter === 'ALL' || t.priority === priorityFilter) &&
      (!search.trim() || t.title.toLowerCase().includes(search.toLowerCase())),
  );

  const targetSpaceId = selectedSpaceId !== 'ALL' ? selectedSpaceId : spaces[0]?.id ?? 'space_kuliah';
  const targetListId =
    selectedListId !== 'ALL'
      ? selectedListId
      : visibleLists[0]?.id ?? (selectedSpaceId === 'ALL' ? lists[0]?.id ?? null : null);

  const getSpaceBadge = (listId: string) => {
    const l = lists.find((x) => x.id === listId);
    const s = spaces.find((x) => x.id === l?.space_id);
    return { spaceName: s?.name ?? 'Workspace', listName: l?.name ?? 'List', color: s?.color ?? '#00d992' };
  };

  const priorityStyle = (p: TaskItem['priority']) => {
    if (p === 'urgent') return { bg: 'rgba(239,68,68,0.18)', color: '#f87171' };
    if (p === 'high') return { bg: 'rgba(245,158,11,0.18)', color: '#fbbf24' };
    if (p === 'normal') return { bg: 'rgba(56,189,248,0.15)', color: '#38bdf8' };
    return { bg: 'rgba(148,163,184,0.15)', color: '#94a3b8' };
  };

  return (
    <div className="space-y-3">
      {/* Header & Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
        <div>
          <div className="text-xs font-mono-num" style={{ color: 'var(--accent)' }}>
            CLICKUP WORKSPACE // {selectedSpaceId === 'ALL' ? 'SEMUA SPACE' : spaces.find((s) => s.id === selectedSpaceId)?.name.toUpperCase()}
          </div>
          <h1 className="text-sm font-bold">Manajemen Tugas, Subtugas, Time Tracker & Alarm</h1>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          {(['list', 'kanban', 'calendar', 'gantt'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setViewMode(m)}
              className="px-2.5 py-1 rounded text-xs font-mono-num border cursor-pointer"
              style={
                viewMode === m
                  ? { background: 'var(--accent-soft)', color: 'var(--accent)', borderColor: 'var(--border-accent)' }
                  : { background: 'var(--bg-card)', borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }
              }
            >
              {m === 'list' ? '≡ List' : m === 'kanban' ? '▥ Kanban' : m === 'calendar' ? '📅 Calendar' : '📊 Gantt & Beban'}
            </button>
          ))}
          <a
            href={`/api/workspace/export/csv${selectedListId !== 'ALL' ? `?listId=${encodeURIComponent(selectedListId)}` : ''}`}
            className="px-2 py-1 rounded text-xs font-mono-num border"
            style={{ background: 'var(--bg-card)', borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
          >
            ⬇ CSV
          </a>
          <a
            href={`/api/workspace/export/markdown${selectedListId !== 'ALL' ? `?listId=${encodeURIComponent(selectedListId)}` : ''}`}
            className="px-2 py-1 rounded text-xs font-mono-num border"
            style={{ background: 'var(--bg-card)', borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
          >
            ⬇ MD
          </a>
          {targetListId && (
            <button
              onClick={() => setImportOpen((v) => !v)}
              className="px-2 py-1 rounded text-xs font-mono-num border cursor-pointer"
              style={{ background: 'var(--bg-card)', borderColor: 'var(--border-subtle)', color: 'var(--accent-2)' }}
            >
              ⬆ Impor
            </button>
          )}
        </div>
      </div>

      {/* Quick Create Task + Filters */}
      {!targetListId ? (
        <div className="themed-card p-3 text-xs flex items-center justify-between gap-2 border border-amber-500/40 text-amber-300">
          <span>Space ini belum memiliki List. Buat List terlebih dahulu di bawah sebelum menambah tugas atau menerapkan template.</span>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!newTitle.trim()) return;
            void onCreateTask({
              listId: targetListId,
              title: newTitle.trim(),
              priority: newPriority,
              dueAt: newDue ? new Date(`${newDue}:00+07:00`).toISOString() : new Date(Date.now() + 2 * 3_600_000).toISOString(),
              hardAlarmEnabled: newHardAlarm,
            });
            setNewTitle('');
          }}
          className="themed-card p-2.5 flex flex-wrap items-center gap-2 text-xs"
        >
          <input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="+ Tugas baru (otomatis masuk Kalender Website & Reminder)..."
            className="flex-1 min-w-[200px] px-2.5 py-1.5 rounded border outline-none"
            style={{ background: 'var(--bg-void)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
          />
          <select
            value={newPriority}
            onChange={(e) => setNewPriority(e.target.value as TaskItem['priority'])}
            className="px-2 py-1.5 rounded border"
            style={{ background: 'var(--bg-void)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
          >
            <option value="urgent">⚑ Urgent</option>
            <option value="high">⚑ High</option>
            <option value="normal">Normal</option>
            <option value="low">Low</option>
          </select>
          <input
            type="datetime-local"
            value={newDue}
            onChange={(e) => setNewDue(e.target.value)}
            className="px-2 py-1.5 rounded border font-mono-num"
            style={{ background: 'var(--bg-void)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
          />
          <label className="flex items-center gap-1 cursor-pointer font-mono-num">
            <input type="checkbox" checked={newHardAlarm} onChange={(e) => setNewHardAlarm(e.target.checked)} />
            <span>⏰ Hard Alarm</span>
          </label>
          <button type="submit" className="px-3 py-1.5 rounded font-mono-num font-bold cursor-pointer" style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}>
            + Buat Tugas
          </button>
        </form>
      )}

      {/* CSV / Markdown Importer Modal-inline (FR-21) */}
      {importOpen && targetListId && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!importContent.trim()) return;
            const res = await onImportTasks(targetListId, importFormat, importContent);
            setImportMsg(`Berhasil mengimpor ${res.importedCount} tugas ke list aktif.`);
            setImportContent('');
          }}
          className="themed-card p-3 space-y-2 text-xs"
        >
          <div className="flex items-center justify-between">
            <span className="font-mono-num font-bold">IMPOR TUGAS (CSV / MARKDOWN CHECKLIST)</span>
            <select
              value={importFormat}
              onChange={(e) => setImportFormat(e.target.value as 'csv' | 'markdown')}
              className="px-2 py-0.5 rounded border"
              style={{ background: 'var(--bg-void)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
            >
              <option value="markdown">Markdown (- [ ] Tugas)</option>
              <option value="csv">CSV (title,priority,status,due_at)</option>
            </select>
          </div>
          <textarea
            rows={3}
            value={importContent}
            onChange={(e) => setImportContent(e.target.value)}
            placeholder={importFormat === 'markdown' ? '- [ ] **[HIGH]** Review Bab 4' : 'title,priority,status\nReview Bab 4,high,To Do'}
            className="w-full p-2 rounded border font-mono-num outline-none"
            style={{ background: 'var(--bg-void)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
          />
          <div className="flex items-center gap-2">
            <button type="submit" className="px-3 py-1 rounded font-bold cursor-pointer" style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}>
              Impor Sekarang
            </button>
            {importMsg && <span style={{ color: 'var(--accent)' }}>{importMsg}</span>}
          </div>
        </form>
      )}

      {/* Filter & Add List Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter judul tugas..."
            className="px-2.5 py-1 rounded border outline-none"
            style={{ background: 'var(--bg-card)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
          />
          <select
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value)}
            className="px-2 py-1 rounded border"
            style={{ background: 'var(--bg-card)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
          >
            <option value="ALL">Semua Prioritas</option>
            <option value="urgent">Urgent</option>
            <option value="high">High</option>
            <option value="normal">Normal</option>
            <option value="low">Low</option>
          </select>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {targetListId && (
            <select
              defaultValue=""
              onChange={(e) => {
                if (!e.target.value) return;
                void onApplyTemplate(e.target.value, targetListId);
                e.target.value = '';
              }}
              className="px-2 py-1 rounded border text-xs"
              style={{ background: 'var(--bg-card)', borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
            >
              <option value="">📋 Terapkan Template...</option>
              {templates.map((tpl) => (
                <option key={tpl.id} value={tpl.id}>
                  {tpl.name}
                </option>
              ))}
            </select>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!newListName.trim()) return;
              void onCreateList(targetSpaceId, newListName.trim());
              setNewListName('');
            }}
            className="flex gap-1"
          >
            <input
              value={newListName}
              onChange={(e) => setNewListName(e.target.value)}
              placeholder="+ List baru..."
              className="px-2 py-1 rounded border outline-none w-32"
              style={{ background: 'var(--bg-card)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
            />
            <button type="submit" className="px-2 py-1 rounded border cursor-pointer" style={{ borderColor: 'var(--border-subtle)' }}>
              + List
            </button>
          </form>
        </div>
      </div>

      {/* VIEW 1: GROUPED LIST VIEW */}
      {viewMode === 'list' && (
        <div className="space-y-3">
          {KANBAN_STATUSES.map((status) => {
            const group = parentTasks.filter((t) => t.status === status);
            if (group.length === 0) return null;
            return (
              <div key={status} className="themed-card p-2.5 space-y-1.5">
                <div className="flex items-center justify-between text-xs font-mono-num pb-1 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
                  <span className="font-bold" style={{ color: status === 'Done' ? 'var(--accent)' : 'var(--text-primary)' }}>
                    {status.toUpperCase()} ({group.length})
                  </span>
                </div>
                {group.map((t) => {
                  const meta = getSpaceBadge(t.list_id);
                  const ps = priorityStyle(t.priority);
                  const subs = tasks.filter((s) => s.parent_task_id === t.id);
                  const isRunning = activeTimer?.task_id === t.id;
                  return (
                    <div
                      key={t.id}
                      className="flex flex-wrap items-center justify-between gap-2 px-2.5 py-2 rounded bg-black/25 hover:bg-black/40 border transition"
                      style={{ borderColor: 'var(--border-subtle)' }}
                    >
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-mono-num px-1.5 py-0.2 rounded" style={{ background: 'rgba(255,255,255,0.06)', color: meta.color }}>
                            {meta.spaceName} / {meta.listName}
                          </span>
                          <button onClick={() => onOpenTask(t)} className="text-xs font-semibold truncate hover:underline text-left cursor-pointer">
                            {t.title}
                          </button>
                          {t.hard_alarm_enabled === 1 && <span title="Hard Alarm Aktif">⏰</span>}
                        </div>
                        <div className="text-xs font-mono-num" style={{ color: 'var(--text-muted)' }}>
                          Subtask: {subs.filter((s) => s.status === 'Done').length}/{subs.length} · Tenggat:{' '}
                          {t.due_at ? new Date(t.due_at).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'short', timeStyle: 'short' }) : '—'}
                          {' · '}Waktu: {Math.round(t.time_spent_seconds / 60)}m
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="px-2 py-0.5 rounded text-xs font-mono-num" style={{ background: ps.bg, color: ps.color }}>
                          {t.priority.toUpperCase()}
                        </span>
                        <button
                          onClick={() => void (isRunning ? onStopTimer(t.id) : onStartTimer(t.id))}
                          className="px-2 py-0.5 rounded text-xs font-mono-num border cursor-pointer"
                          style={{
                            borderColor: 'var(--border-subtle)',
                            color: isRunning ? '#f87171' : 'var(--accent)',
                          }}
                          title="Time Tracker (+ Auto-DND HP)"
                        >
                          {isRunning ? '⏹' : '▶'}
                        </button>
                        <select
                          value={t.status}
                          onChange={(e) => void onUpdateTask(t.id, { status: e.target.value })}
                          className="px-2 py-0.5 rounded text-xs font-mono-num border"
                          style={{ background: 'var(--bg-void)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
                        >
                          {KANBAN_STATUSES.map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}

      {/* VIEW 2: DRAG-AND-DROP KANBAN BOARD */}
      {viewMode === 'kanban' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2.5">
          {KANBAN_STATUSES.map((col) => {
            const colTasks = parentTasks.filter((t) => t.status === col);
            return (
              <div
                key={col}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (draggedTaskId) {
                    void onUpdateTask(draggedTaskId, { status: col });
                    setDraggedTaskId(null);
                  }
                }}
                className="themed-card p-2.5 space-y-2 min-h-[260px]"
              >
                <div className="flex items-center justify-between text-xs font-mono-num pb-1.5 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
                  <span className="font-bold" style={{ color: col === 'Done' ? 'var(--accent)' : 'var(--text-primary)' }}>
                    {col.toUpperCase()}
                  </span>
                  <span className="px-1.5 py-0.2 rounded bg-white/5">{colTasks.length}</span>
                </div>

                <div className="space-y-2">
                  {colTasks.map((t) => {
                    const ps = priorityStyle(t.priority);
                    return (
                      <div
                        key={t.id}
                        draggable
                        onDragStart={() => setDraggedTaskId(t.id)}
                        onClick={() => onOpenTask(t)}
                        className="p-2.5 rounded-lg bg-black/30 border hover:border-white/25 space-y-1.5 cursor-grab active:cursor-grabbing"
                        style={{ borderColor: 'var(--border-subtle)' }}
                      >
                        <div className="flex items-center justify-between text-xs">
                          <span className="px-1.5 py-0.2 rounded font-mono-num" style={{ background: ps.bg, color: ps.color }}>
                            {t.priority.toUpperCase()}
                          </span>
                          {t.hard_alarm_enabled === 1 && <span>⏰</span>}
                        </div>
                        <div className="text-xs font-semibold">{t.title}</div>
                        <div className="text-xs font-mono-num" style={{ color: 'var(--text-muted)' }}>
                          {t.due_at ? new Date(t.due_at).toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit' }) + ' WIB' : 'Tanpa jam'}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* VIEW 3: INLINE CALENDAR VIEW */}
      {viewMode === 'calendar' && (
        <div className="themed-card p-3 space-y-2">
          <div className="text-xs font-mono-num" style={{ color: 'var(--text-muted)' }}>
            PROYEKSI JADWAL TUGAS DI KALENDER
          </div>
          {parentTasks
            .filter((t) => t.due_at || t.start_at)
            .sort((a, b) => (a.start_at ?? a.due_at ?? '').localeCompare(b.start_at ?? b.due_at ?? ''))
            .map((t) => (
              <div
                key={t.id}
                onClick={() => onOpenTask(t)}
                className="flex items-center justify-between px-3 py-2 rounded bg-black/25 border-l-2 cursor-pointer"
                style={{ borderLeftColor: t.hard_alarm_enabled ? '#f59e0b' : 'var(--accent)' }}
              >
                <div>
                  <div className="text-xs font-semibold">
                    {t.hard_alarm_enabled ? '⏰ ' : ''}
                    {t.title}
                  </div>
                  <div className="text-xs font-mono-num" style={{ color: 'var(--text-muted)' }}>
                    Status: {t.status} · Prioritas: {t.priority}
                  </div>
                </div>
                <div className="text-xs font-mono-num" style={{ color: 'var(--accent)' }}>
                  {new Date(t.start_at ?? t.due_at!).toLocaleString('id-ID', {
                    timeZone: 'Asia/Jakarta',
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })}
                </div>
              </div>
            ))}
        </div>
      )}
      {/* VIEW 4: GANTT TIMELINE & WEEKLY WORKLOAD (FR-20) */}
      {viewMode === 'gantt' && (
        <div className="space-y-3">
          <div className="themed-card p-3 space-y-2 text-xs">
            <div className="font-mono-num font-bold" style={{ color: 'var(--text-secondary)' }}>
              📊 PETA BEBAN KERJA MINGGUAN (WORKLOAD CAPACITY)
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-2">
              {ganttWorkload.weeklyWorkload.map((d) => {
                const loadPct = Math.min(100, Math.round((d.estimatedMinutes / 360) * 100));
                return (
                  <div key={d.dateWib} className="bg-black/25 p-2 rounded space-y-1">
                    <div className="font-mono-num font-bold">{d.dateWib.slice(5)}</div>
                    <div className="h-2 rounded-full overflow-hidden bg-black/40">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${loadPct}%`,
                          background: loadPct > 85 ? '#ef4444' : loadPct > 60 ? '#f59e0b' : 'var(--accent)',
                        }}
                      />
                    </div>
                    <div className="font-mono-num" style={{ color: 'var(--text-muted)' }}>
                      {d.taskCount} tgs · {d.estimatedMinutes}m
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="themed-card p-3 space-y-2 text-xs">
            <div className="font-mono-num font-bold" style={{ color: 'var(--text-secondary)' }}>
              📈 GANTT TIMELINE TUGAS
            </div>
            {ganttWorkload.timelineTasks.map((item) => {
              const barPct = Math.min(100, Math.max(15, Math.round((item.estimateMinutes / 180) * 100)));
              return (
                <div key={item.id} className="bg-black/25 p-2 rounded space-y-1">
                  <div className="flex justify-between">
                    <span className="font-semibold truncate">{item.title}</span>
                    <span className="font-mono-num shrink-0 ml-2" style={{ color: 'var(--text-muted)' }}>
                      {new Date(item.startAt).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'short', timeStyle: 'short' })} ({item.estimateMinutes}m)
                    </span>
                  </div>
                  <div className="h-2.5 rounded bg-black/40 overflow-hidden">
                    <div
                      className="h-full rounded"
                      style={{
                        width: `${barPct}%`,
                        background: item.status === 'Done' ? 'var(--accent)' : item.priority === 'urgent' ? '#ef4444' : 'var(--accent-2)',
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
