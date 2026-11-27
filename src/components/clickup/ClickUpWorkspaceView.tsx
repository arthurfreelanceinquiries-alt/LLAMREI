import { CalendarDays, LayoutGrid, Plus, Rows3 } from 'lucide-react';
import { useId, useState, type FormEvent } from 'react';
import { formatWibStamp, wibDateKey, wibDateTimeToIso } from '../../lib/calendar-time';
import { listTaskStatuses } from '../../lib/task-status';
import { usePendingAction } from '../../lib/use-pending-action';
import { Control } from '../ui/Control';
import { DialogPanel } from '../ui/DialogPanel';
import type { ActiveTimer, FolderItem, GanttWorkloadState, ListItem, SpaceItem, TaskItem, TaskTemplateItem } from '../../types/llamrei';

interface Props {
  spaces: SpaceItem[];
  lists: ListItem[];
  tasks: TaskItem[];
  folders: FolderItem[];
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

const VIEWS = [
  { id: 'list', label: 'Daftar' },
  { id: 'kanban', label: 'Kanban' },
  { id: 'calendar', label: 'Kalender' },
  { id: 'gantt', label: 'Linimasa' },
] as const;

const controlClass = 'min-h-11 min-w-0 max-w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 text-sm text-[var(--text-primary)]';
const actionClass = `${controlClass} inline-flex items-center justify-center whitespace-nowrap font-medium hover:bg-[var(--bg-elevated)]`;

type TaskView = (typeof VIEWS)[number]['id'];
interface ViewPreference {
  mode: TaskView;
  query: string;
  priority: string;
  status: string;
  compact: boolean;
}

function readPreference(key: string): ViewPreference | null {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? 'null') as Partial<ViewPreference> | null;
    if (!value || !VIEWS.some(({ id }) => id === value.mode) || typeof value.query !== 'string' ||
      typeof value.priority !== 'string' || typeof value.status !== 'string' || typeof value.compact !== 'boolean') return null;
    return value as ViewPreference;
  } catch {
    return null;
  }
}

const dragMime = 'application/x-llamrei-task';

export function ClickUpWorkspaceView({
  spaces,
  lists,
  folders,
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
  const [newHardAlarm, setNewHardAlarm] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [listChoice, setListChoice] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [compact, setCompact] = useState(false);
  const [viewMessage, setViewMessage] = useState('');
  const action = usePendingAction();
  const [newListName, setNewListName] = useState('');
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);

  const visibleLists = lists.filter(
    (l) => (selectedSpaceId === 'ALL' || l.space_id === selectedSpaceId) && (selectedListId === 'ALL' || l.id === selectedListId),
  );
  const visibleListIds = new Set(visibleLists.map((l) => l.id));

  const scopedTasks = tasks.filter((task) => !task.parent_task_id && visibleListIds.has(task.list_id));
  const statusesByList = new Map(visibleLists.map((list) => [list.id, listTaskStatuses(list)]));
  const visibleStatuses = [...new Set([
    ...listTaskStatuses(),
    ...visibleLists.flatMap((list) => statusesByList.get(list.id) ?? []),
    ...scopedTasks.map((task) => task.status),
  ])];
  const query = search.trim().toLocaleLowerCase('id-ID');
  const parentTasks = scopedTasks.filter((task) =>
    (priorityFilter === 'ALL' || task.priority === priorityFilter) &&
    (statusFilter === 'ALL' || !visibleStatuses.includes(statusFilter) || task.status === statusFilter) &&
    (!query || `${task.title} ${task.description_md} ${task.tags_json}`.toLocaleLowerCase('id-ID').includes(query)),
  );
  const displayedTaskIds = new Set(parentTasks.map(({ id }) => id));
  const timeline = ganttWorkload.timelineTasks.filter(({ id }) => displayedTaskIds.has(id));
  const timelineStart = timeline.length ? Date.parse(timeline[0].startAt) : 0;
  const timelineEnd = timeline.reduce((end, item) => Math.max(end, Date.parse(item.endAt)), timelineStart);
  const timelineSpan = Math.max(timelineEnd - timelineStart, 1);
  const targetSpaceId = selectedSpaceId !== 'ALL' ? selectedSpaceId : spaces[0]?.id;
  const targetListId = visibleListIds.has(listChoice) ? listChoice : visibleLists[0]?.id;
  const activeList = selectedListId === 'ALL' ? undefined : lists.find(({ id }) => id === selectedListId);
  const activeFolder = folders.find(({ id }) => id === activeList?.folder_id);
  const viewKey = `llamrei:task-view:${selectedSpaceId}:${selectedListId}`;
  const savedView = readPreference(viewKey);
  const draggedTask = parentTasks.find(({ id }) => id === draggedTaskId);

  function updateStatus(task: TaskItem, status: string) {
    return action.run(`status-${task.id}`, () => onUpdateTask(task.id, { status }), 'Status tugas belum dapat diperbarui.');
  }

  async function createTask(event: FormEvent) {
    event.preventDefault();
    const dueAt = newDue ? wibDateTimeToIso(newDue) : null;
    if (!targetListId || !newTitle.trim() || ((newDue || newHardAlarm) && !dueAt)) return;

    if (await action.run('create', () => onCreateTask({
      listId: targetListId,
      title: newTitle.trim(),
      priority: newPriority,
      dueAt,
      hardAlarmEnabled: newHardAlarm,
    }), 'Tugas belum dapat disimpan. Periksa koneksi dan coba lagi.')) {
      setNewTitle('');
      setNewDue('');
      setNewHardAlarm(false);
      setCreateOpen(false);
    }
  }

  function saveView() {
    const preference: ViewPreference = { mode: viewMode, query: search, priority: priorityFilter, status: statusFilter, compact };
    try {
      localStorage.setItem(viewKey, JSON.stringify(preference));
      setViewMessage('Tampilan disimpan di browser ini.');
    } catch {
      setViewMessage('Browser tidak dapat menyimpan tampilan ini.');
    }
  }

  function restoreView() {
    if (!savedView) return;
    setViewMode(savedView.mode);
    setSearch(savedView.query);
    setPriorityFilter(savedView.priority);
    setStatusFilter(savedView.status);
    setCompact(savedView.compact);
    setViewMessage('Tampilan tersimpan dimuat.');
  }

  const getSpaceBadge = (listId: string) => {
    const l = lists.find((x) => x.id === listId);
    const s = spaces.find((x) => x.id === l?.space_id);
    return { spaceName: s?.name ?? 'Workspace', listName: l?.name ?? 'List', color: s?.color ?? 'var(--accent)' };
  };

  const statusControl = (task: TaskItem) => (
    <select
      aria-label={`Status ${task.title}`}
      value={task.status}
      disabled={!!action.pending}
      onChange={(event) => void updateStatus(task, event.target.value)}
      className={controlClass}
    >
      {listTaskStatuses(lists.find(({ id }) => id === task.list_id), task.status).map((status) => (
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
              {activeFolder && ` / ${activeFolder.name}`}
              {activeList && ` / ${activeList.name}`}
            </p>
            <h1 className="text-2xl font-semibold tracking-tight @[640px]/tasks:text-3xl">Tugas</h1>
            <p className="text-sm text-[var(--text-secondary)]">{parentTasks.length} dari {scopedTasks.length} tugas</p>
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
            {targetListId && <Control className="ds-control--primary" onClick={() => setCreateOpen(true)}><Plus aria-hidden="true" /> Tugas baru</Control>}
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

      {action.error && !createOpen && <p className="ds-note" role="alert">{action.error}</p>}
      {createOpen && targetListId && (
        <DialogPanel label="Tugas baru" className="workspace-form-dialog" onClose={() => { if (!action.pending) setCreateOpen(false); }}>
          <form onSubmit={(event) => void createTask(event)} className="space-y-3 p-4">
            <h2 className="text-base font-semibold">Tugas baru</h2>
            <label className="ds-label">Judul tugas baru<input className="ds-field" autoFocus required value={newTitle} onChange={(event) => setNewTitle(event.target.value)} /></label>
            <label className="ds-label">Daftar tujuan
              <select className="ds-field" value={targetListId} onChange={(event) => setListChoice(event.target.value)}>
                {visibleLists.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
              </select>
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="ds-label">Prioritas tugas baru
                <select className="ds-field" value={newPriority} onChange={(event) => setNewPriority(event.target.value as TaskItem['priority'])}>
                  <option value="urgent">Mendesak</option><option value="high">Tinggi</option>
                  <option value="normal">Normal</option><option value="low">Rendah</option>
                </select>
              </label>
              <label className="ds-label">Tenggat tugas baru (WIB)<input className="ds-field" type="datetime-local" required={newHardAlarm} value={newDue} onChange={(event) => setNewDue(event.target.value)} /></label>
            </div>
            <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={newHardAlarm} onChange={(event) => setNewHardAlarm(event.target.checked)} /> Hard alarm pada tenggat</label>
            {action.error && <p className="ds-note" role="alert">{action.error}</p>}
            <div className="flex justify-end gap-2">
              <Control disabled={!!action.pending} onClick={() => setCreateOpen(false)}>Batal</Control>
              <Control type="submit" className="ds-control--primary" disabled={!!action.pending || !newTitle.trim()}>{action.pending === 'create' ? 'Menyimpan…' : 'Buat tugas'}</Control>
            </div>
          </form>
        </DialogPanel>
      )}

      {/* CSV / Markdown Importer Modal-inline (FR-21) */}
      {importOpen && targetListId && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!importContent.trim()) return;
            setImportMsg(null);
            await action.run('import', async () => {
              const res = await onImportTasks(targetListId, importFormat, importContent);
              setImportMsg(`${res.importedCount} tugas diimpor.`);
              setImportContent('');
            }, 'Impor belum dapat diselesaikan. Periksa format dan koneksi.');
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
            placeholder={importFormat === 'markdown' ? '- [ ] **[HIGH]** Tinjau laporan' : 'title,priority,status\nTinjau laporan,high,To Do'}
            className={`${controlClass} w-full py-2 font-mono-num`}
          />
          <div className="flex items-center gap-2">
            <button type="submit" className={actionClass} disabled={!!action.pending || !importContent.trim()}>
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
          <select aria-label="Filter status tugas" value={visibleStatuses.includes(statusFilter) ? statusFilter : 'ALL'} onChange={(event) => setStatusFilter(event.target.value)} className={controlClass}>
            <option value="ALL">Semua status</option>
            {visibleStatuses.map((status) => <option key={status} value={status}>{status}</option>)}
          </select>
        </div>

        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {targetListId && (
            <select
              aria-label="Terapkan templat tugas"
              disabled={!!action.pending}
              defaultValue=""
              onChange={(e) => {
                if (!e.target.value) return;
                const id = e.target.value;
                e.target.value = '';
                void action.run('template', () => onApplyTemplate(id, targetListId), 'Templat belum dapat diterapkan.');
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
            onSubmit={async (event) => {
              event.preventDefault();
              if (!targetSpaceId || !newListName.trim()) return;
              if (await action.run('list', () => onCreateList(targetSpaceId, newListName.trim()), 'Daftar belum dapat dibuat.')) setNewListName('');
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
            <button type="submit" className={actionClass} disabled={!targetSpaceId || !!action.pending || !newListName.trim()}>
              Buat daftar
            </button>
          </form>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1 border-b border-[var(--border-subtle)] pb-2">
        <Control aria-pressed={compact} disabled={viewMode !== 'list'} onClick={() => setCompact(!compact)}><Rows3 aria-hidden="true" /> Daftar ringkas</Control>
        <Control onClick={saveView}>Simpan tampilan</Control>
        {savedView && <Control onClick={restoreView}>Muat tampilan</Control>}
        {viewMessage && <span className="text-xs text-[var(--text-secondary)]" role="status">{viewMessage}</span>}
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
                      className={`grid min-w-0 grid-cols-1 items-center gap-2 px-4 ${compact ? 'py-1.5' : 'py-3'} hover:bg-[var(--bg-panel)] @[680px]/tasks:grid-cols-[minmax(0,1fr)_auto]`}
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
                          disabled={!!action.pending}
                          onClick={() => void action.run('timer', () => isRunning ? onStopTimer(t.id) : onStartTimer(t.id), 'Timer belum dapat diperbarui.')}
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
                aria-label={`Kolom ${col}`}
                onDragOver={(event) => {
                  if (!action.pending && draggedTask && (statusesByList.get(draggedTask.list_id) ?? []).includes(col)) event.preventDefault();
                }}
                onDrop={(event) => {
                  const id = event.dataTransfer.getData(dragMime);
                  if (!draggedTask || id !== draggedTask.id || !(statusesByList.get(draggedTask.list_id) ?? []).includes(col)) return;
                  event.preventDefault();
                  if (draggedTask.status !== col) void updateStatus(draggedTask, col);
                  setDraggedTaskId(null);
                }}
                className="themed-card min-h-28 min-w-0 space-y-3 p-3"
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
                          event.dataTransfer.setData(dragMime, t.id);
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

      {viewMode === 'calendar' && (
        <section className="themed-card p-4">
          <h2 className="mb-2 flex items-center gap-2 font-semibold"><CalendarDays size={18} aria-hidden="true" /> Jadwal tugas</h2>
          {timeline.length === 0 && <p className="text-sm text-[var(--text-secondary)]">Belum ada jadwal untuk tugas yang dipilih.</p>}
          <ul className="divide-y divide-[var(--border-subtle)]">
            {timeline.map((item) => {
              const task = parentTasks.find(({ id }) => id === item.id);
              if (!task) return null;
              return (
                <li key={item.id}>
                  <button type="button" onClick={() => onOpenTask(task)} className="grid min-h-11 w-full min-w-0 gap-1 rounded-md px-2 py-2 text-left hover:bg-[var(--bg-elevated)]">
                    <span className="text-sm font-semibold [overflow-wrap:anywhere]">{item.title}</span>
                    <span className="text-xs text-[var(--text-secondary)]">{formatWibStamp(item.startAt)} · {item.status}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {viewMode === 'gantt' && (
        <div className="space-y-3">
          <section className="themed-card p-4">
            <h2 className="mb-3 flex items-center gap-2 font-semibold"><LayoutGrid size={18} aria-hidden="true" /> Beban tujuh hari ke depan</h2>
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4 @[700px]/tasks:grid-cols-7">
              {ganttWorkload.weeklyWorkload.map(({ dateWib }) => {
                const scheduled = timeline.filter((item) => item.status !== 'Done' && wibDateKey(item.startAt) === dateWib);
                return (
                  <li key={dateWib} className="rounded-lg bg-[var(--bg-elevated)] px-3 py-2 text-xs">
                    <p className="font-semibold">{dateWib.slice(8)} / {dateWib.slice(5, 7)}</p>
                    <p className="mt-1 text-[var(--text-secondary)]">{scheduled.length} tugas</p>
                    <p className="text-[var(--text-secondary)]">{scheduled.reduce((sum, item) => sum + item.estimateMinutes, 0)} mnt estimasi</p>
                  </li>
                );
              })}
            </ul>
          </section>
          <section className="themed-card p-4">
            <h2 className="mb-2 font-semibold">Linimasa</h2>
            {timeline.length === 0 && <p className="text-sm text-[var(--text-secondary)]">Linimasa akan tampil saat tugas yang dipilih memiliki jadwal.</p>}
            <ul className="divide-y divide-[var(--border-subtle)]">
              {timeline.map((item) => {
                const start = Date.parse(item.startAt);
                const left = 100 * (start - timelineStart) / timelineSpan;
                const width = 100 * (Date.parse(item.endAt) - start) / timelineSpan;
                const task = parentTasks.find(({ id }) => id === item.id);
                if (!task) return null;
                return (
                  <li key={item.id}>
                    <button type="button" onClick={() => onOpenTask(task)} className="grid min-h-11 w-full gap-1 rounded-md px-2 py-2 text-left hover:bg-[var(--bg-elevated)]">
                      <span className="text-sm font-semibold [overflow-wrap:anywhere]">{item.title}</span>
                      <span className="text-xs text-[var(--text-secondary)]">{formatWibStamp(item.startAt)}{Date.parse(item.endAt) > Date.parse(item.startAt) ? ` – ${formatWibStamp(item.endAt)}` : ''}</span>
                      <span className="relative mt-1 block h-1.5 overflow-hidden rounded-full bg-[var(--bg-elevated)]" aria-hidden="true">
                        <span className="absolute h-full min-w-1 rounded-full bg-[var(--accent)]" style={{ left: `min(${left}%, calc(100% - .25rem))`, width: `${width}%` }} />
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        </div>
      )}
      </div>
    </div>
  );
}
