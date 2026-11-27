import { useId, useState } from 'react';
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
const VIEWS = [
  { id: 'list', label: 'Daftar' },
  { id: 'kanban', label: 'Kanban' },
  { id: 'calendar', label: 'Kalender' },
  { id: 'gantt', label: 'Linimasa' },
] as const;

const controlClass = 'min-h-11 min-w-0 max-w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 text-sm text-[var(--text-primary)]';
const actionClass = `${controlClass} inline-flex items-center justify-center whitespace-nowrap font-medium hover:bg-[var(--bg-elevated)]`;

function listStatuses(list: ListItem): string[] {
  try {
    const statuses: unknown = JSON.parse(list.statuses_json);
    if (Array.isArray(statuses)) {
      return statuses.flatMap((status) => (typeof status?.name === 'string' && status.name.trim() ? [status.name] : []));
    }
  } catch {
    // Fall back to the workspace status defaults for legacy data.
  }
  return [];
}

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
  const viewId = useId();
  const [viewMode, setViewMode] = useState<(typeof VIEWS)[number]['id']>('list');
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
  const statusesByList = new Map(visibleLists.map((list) => [list.id, listStatuses(list)]));
  const visibleStatuses = [...new Set([
    ...KANBAN_STATUSES,
    ...visibleLists.flatMap((list) => statusesByList.get(list.id) ?? []),
    ...parentTasks.map((task) => task.status),
  ])];

  const targetSpaceId = selectedSpaceId !== 'ALL' ? selectedSpaceId : spaces[0]?.id ?? 'space_kuliah';
  const targetListId =
    selectedListId !== 'ALL'
      ? selectedListId
      : visibleLists[0]?.id ?? (selectedSpaceId === 'ALL' ? lists[0]?.id ?? null : null);

  const getSpaceBadge = (listId: string) => {
    const l = lists.find((x) => x.id === listId);
    const s = spaces.find((x) => x.id === l?.space_id);
    return { spaceName: s?.name ?? 'Workspace', listName: l?.name ?? 'List', color: s?.color ?? 'var(--accent)' };
  };

  const statusControl = (task: TaskItem) => (
    <select
      aria-label={`Status ${task.title}`}
      value={task.status}
      onChange={(event) => void onUpdateTask(task.id, { status: event.target.value })}
      className={controlClass}
    >
      {[...new Set([...KANBAN_STATUSES, ...(statusesByList.get(task.list_id) ?? []), task.status])].map((status) => (
        <option key={status} value={status}>{status}</option>
      ))}
    </select>
  );

  const priorityStyle = (priority: TaskItem['priority']) => {
    const color = priority === 'urgent' ? 'var(--danger)' : priority === 'high' ? 'var(--warning)' : 'var(--text-secondary)';
    return { bg: `color-mix(in srgb, ${color} 13%, var(--bg-card))`, color };
  };

  return (
    <div className="@container/tasks min-w-0 space-y-4">
      <header className="space-y-4 border-b border-[var(--border-subtle)] pb-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <p className="text-sm text-[var(--text-secondary)] [overflow-wrap:anywhere]">
              {selectedSpaceId === 'ALL' ? 'Semua ruang kerja' : spaces.find((space) => space.id === selectedSpaceId)?.name}
              {selectedListId !== 'ALL' && ` / ${visibleLists[0]?.name ?? 'List'}`}
            </p>
            <h1 className="text-2xl font-semibold tracking-tight @[640px]/tasks:text-3xl">Tugas</h1>
          </div>
          <div role="group" aria-label="Impor dan ekspor tugas" className="flex flex-wrap items-center gap-2">
          <a
            href={`/api/workspace/export/csv${selectedListId !== 'ALL' ? `?listId=${encodeURIComponent(selectedListId)}` : ''}`}
            aria-label="Ekspor tugas sebagai CSV"
            className={actionClass}
          >
            CSV
          </a>
          <a
            href={`/api/workspace/export/markdown${selectedListId !== 'ALL' ? `?listId=${encodeURIComponent(selectedListId)}` : ''}`}
            aria-label="Ekspor tugas sebagai Markdown"
            className={actionClass}
          >
            Markdown
          </a>
          {targetListId && (
            <button
              onClick={() => setImportOpen((v) => !v)}
              aria-expanded={importOpen}
              className={actionClass}
            >
              Impor
            </button>
          )}
          </div>
        </div>
        <div
          role="tablist"
          aria-label="Tampilan tugas"
          className="grid grid-cols-2 gap-1 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-1 @[420px]/tasks:inline-grid @[420px]/tasks:grid-cols-4"
          onKeyDown={(event) => {
            const index = VIEWS.findIndex((view) => view.id === viewMode);
            const navigation: Record<string, number> = {
              ArrowRight: (index + 1) % VIEWS.length,
              ArrowLeft: (index - 1 + VIEWS.length) % VIEWS.length,
              Home: 0,
              End: VIEWS.length - 1,
            };
            const nextIndex = navigation[event.key];
            if (nextIndex === undefined) return;
            event.preventDefault();
            const next = VIEWS[nextIndex].id;
            setViewMode(next);
            event.currentTarget.querySelector<HTMLButtonElement>(`[data-view="${next}"]`)?.focus();
          }}
        >
          {VIEWS.map(({ id, label }) => (
            <button
              key={id}
              id={`${viewId}-${id}`}
              data-view={id}
              role="tab"
              aria-controls={`${viewId}-panel`}
              aria-selected={viewMode === id}
              tabIndex={viewMode === id ? 0 : -1}
              onClick={() => setViewMode(id)}
              className="min-h-11 rounded-lg border border-transparent px-3 text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] aria-selected:border-[var(--border-subtle)] aria-selected:bg-[var(--bg-elevated)] aria-selected:text-[var(--text-primary)]"
            >
              {label}
            </button>
          ))}
        </div>
      </header>

      {/* Quick Create Task + Filters */}
      {!targetListId ? (
        <p className="themed-card p-4 text-sm text-[var(--text-secondary)]">
          Buat daftar untuk menambahkan tugas atau menggunakan templat.
        </p>
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
          className="themed-card grid grid-cols-2 items-center gap-2 p-3 @[660px]/tasks:flex @[660px]/tasks:flex-wrap"
        >
          <input
            aria-label="Judul tugas baru"
            required
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Judul tugas baru"
            className={`${controlClass} col-span-full w-full @[660px]/tasks:w-auto @[660px]/tasks:flex-1`}
          />
          <select
            aria-label="Prioritas tugas baru"
            value={newPriority}
            onChange={(e) => setNewPriority(e.target.value as TaskItem['priority'])}
            className={controlClass}
          >
            <option value="urgent">Urgent</option>
            <option value="high">High</option>
            <option value="normal">Normal</option>
            <option value="low">Low</option>
          </select>
          <label className="inline-flex min-h-11 items-center gap-2 text-sm text-[var(--text-secondary)]">
            <input type="checkbox" checked={newHardAlarm} onChange={(e) => setNewHardAlarm(e.target.checked)} className="size-4 accent-[var(--accent)]" />
            <span>Hard Alarm</span>
          </label>
          <input
            aria-label="Tenggat tugas baru (WIB)"
            type="datetime-local"
            value={newDue}
            onChange={(e) => setNewDue(e.target.value)}
            className={`${controlClass} col-span-full w-full @[660px]/tasks:w-auto`}
          />
          <button type="submit" className="col-span-full min-h-11 rounded-lg bg-[var(--accent)] px-3 text-sm font-semibold text-[var(--accent-fg)]">
            Buat tugas
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
          className="themed-card space-y-3 p-3 text-sm"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">Impor tugas</h2>
            <select
              aria-label="Format impor"
              value={importFormat}
              onChange={(e) => setImportFormat(e.target.value as 'csv' | 'markdown')}
              className={controlClass}
            >
              <option value="markdown">Markdown (- [ ] Tugas)</option>
              <option value="csv">CSV (title,priority,status,due_at)</option>
            </select>
          </div>
          <textarea
            aria-label="Isi berkas yang diimpor"
            rows={3}
            value={importContent}
            onChange={(e) => setImportContent(e.target.value)}
            placeholder={importFormat === 'markdown' ? '- [ ] **[HIGH]** Review Bab 4' : 'title,priority,status\nReview Bab 4,high,To Do'}
            className={`${controlClass} w-full py-2 font-mono-num`}
          />
          <div className="flex items-center gap-2">
            <button type="submit" className={actionClass}>
              Impor sekarang
            </button>
            {importMsg && <span role="status" className="text-[var(--text-secondary)]">{importMsg}</span>}
          </div>
        </form>
      )}

      {/* Filter & Add List Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div role="group" aria-label="Filter tugas" className="flex min-w-0 flex-wrap items-center gap-2">
          <input
            type="search"
            aria-label="Cari judul tugas"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari tugas"
            className={`${controlClass} w-44 grow`}
          />
          <select
            aria-label="Filter prioritas tugas"
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value)}
            className={controlClass}
          >
            <option value="ALL">Semua Prioritas</option>
            <option value="urgent">Urgent</option>
            <option value="high">High</option>
            <option value="normal">Normal</option>
            <option value="low">Low</option>
          </select>
        </div>

        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {targetListId && (
            <select
              aria-label="Terapkan templat tugas"
              defaultValue=""
              onChange={(e) => {
                if (!e.target.value) return;
                void onApplyTemplate(e.target.value, targetListId);
                e.target.value = '';
              }}
              className={controlClass}
            >
              <option value="">Gunakan templat</option>
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
              aria-label="Nama daftar baru"
              value={newListName}
              onChange={(e) => setNewListName(e.target.value)}
              placeholder="Nama daftar baru"
              className={`${controlClass} w-36`}
            />
            <button type="submit" className={actionClass}>
              Buat daftar
            </button>
          </form>
        </div>
      </div>

      <div id={`${viewId}-panel`} role="tabpanel" aria-labelledby={`${viewId}-${viewMode}`} className="min-w-0">
      {viewMode === 'list' && (
        <div className="space-y-4">
          {parentTasks.length === 0 && <p className="themed-card p-5 text-sm text-[var(--text-secondary)]">Tidak ada tugas yang cocok.</p>}
          {visibleStatuses.map((status) => {
            const group = parentTasks.filter((t) => t.status === status);
            if (group.length === 0) return null;
            return (
              <section key={status} className="themed-card overflow-hidden">
                <h2 className="flex items-center gap-2 border-b border-[var(--border-subtle)] bg-[var(--bg-panel)] px-4 py-3 text-sm font-semibold [overflow-wrap:anywhere]">
                  {status}
                  <span className="rounded-full bg-[var(--bg-elevated)] px-2 py-0.5 text-xs text-[var(--text-secondary)]">{group.length}</span>
                </h2>
                <ul className="divide-y divide-[var(--border-subtle)]">
                {group.map((t) => {
                  const meta = getSpaceBadge(t.list_id);
                  const ps = priorityStyle(t.priority);
                  const subs = tasks.filter((s) => s.parent_task_id === t.id);
                  const isRunning = activeTimer?.task_id === t.id;
                  return (
                    <li
                      key={t.id}
                      className="grid min-w-0 grid-cols-1 items-center gap-2 px-4 py-3 hover:bg-[var(--bg-panel)] @[680px]/tasks:grid-cols-[minmax(0,1fr)_auto]"
                    >
                      <div className="min-w-0 space-y-1">
                        <p className="flex items-start gap-2 text-xs text-[var(--text-secondary)] [overflow-wrap:anywhere]">
                          <span aria-hidden="true" className="mt-1 size-2 shrink-0 rounded-full" style={{ backgroundColor: meta.color }} />
                          {meta.spaceName} / {meta.listName}
                        </p>
                        <button onClick={() => onOpenTask(t)} className="block w-full rounded-sm text-left text-base font-semibold hover:underline [overflow-wrap:anywhere]">
                            {t.title}
                        </button>
                        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-[var(--text-secondary)]">
                          {subs.length > 0 && <span>Subtugas {subs.filter((s) => s.status === 'Done').length}/{subs.length}</span>}
                          {t.due_at && (
                            <span>Tenggat <time dateTime={t.due_at}>{new Date(t.due_at).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'short', timeStyle: 'short' })} WIB</time></span>
                          )}
                          <span>Waktu {Math.round(t.time_spent_seconds / 60)} mnt</span>
                          {t.hard_alarm_enabled === 1 && <span>Hard Alarm aktif</span>}
                        </div>
                      </div>

                      <div className="flex min-w-0 flex-wrap items-center gap-2 @[680px]/tasks:justify-end">
                        <span className="rounded-full px-2.5 py-1 text-xs font-medium" style={{ background: ps.bg, color: ps.color }}>
                          {t.priority.toUpperCase()}
                        </span>
                        {statusControl(t)}
                        <button
                          onClick={() => void (isRunning ? onStopTimer(t.id) : onStartTimer(t.id))}
                          aria-label={`${isRunning ? 'Hentikan timer' : 'Mulai timer'} ${t.title}`}
                          className={actionClass}
                        >
                          {isRunning ? 'Hentikan timer' : 'Mulai timer'}
                        </button>
                      </div>
                    </li>
                  );
                })}
                </ul>
              </section>
            );
          })}
        </div>
      )}

      {/* VIEW 2: DRAG-AND-DROP KANBAN BOARD */}
      {viewMode === 'kanban' && (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,13rem),1fr))] gap-3">
          {visibleStatuses.map((col) => {
            const colTasks = parentTasks.filter((t) => t.status === col);
            return (
              <section
                key={col}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (draggedTaskId) {
                    void onUpdateTask(draggedTaskId, { status: col });
                    setDraggedTaskId(null);
                  }
                }}
                className="themed-card min-w-0 space-y-3 p-3"
              >
                <h2 className="flex items-center justify-between gap-2 border-b border-[var(--border-subtle)] pb-2 text-sm font-semibold [overflow-wrap:anywhere]">
                  {col}
                  <span className="rounded-full bg-[var(--bg-elevated)] px-2 py-0.5 text-xs text-[var(--text-secondary)]">{colTasks.length}</span>
                </h2>

                <ul className="space-y-2">
                  {colTasks.map((t) => {
                    const ps = priorityStyle(t.priority);
                    return (
                      <li
                        key={t.id}
                        draggable
                        onDragStart={(event) => {
                          event.dataTransfer.effectAllowed = 'move';
                          event.dataTransfer.setData('text/plain', t.id);
                          setDraggedTaskId(t.id);
                        }}
                        onDragEnd={() => setDraggedTaskId(null)}
                        className="cursor-grab space-y-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-3 active:cursor-grabbing"
                      >
                        <div className="flex items-center justify-between text-xs">
                          <span className="rounded-full px-2.5 py-1 font-medium" style={{ background: ps.bg, color: ps.color }}>
                            {t.priority.toUpperCase()}
                          </span>
                          {t.hard_alarm_enabled === 1 && <span className="text-[var(--text-secondary)]">Alarm aktif</span>}
                        </div>
                        <button onClick={() => onOpenTask(t)} className="block w-full rounded-sm text-left text-sm font-semibold hover:underline [overflow-wrap:anywhere]">{t.title}</button>
                        <div className="text-xs text-[var(--text-secondary)]">
                          {t.due_at ? new Date(t.due_at).toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit' }) + ' WIB' : 'Tanpa jam'}
                        </div>
                        {statusControl(t)}
                      </li>
                    );
                  })}
                </ul>
              </section>
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
    </div>
  );
}
