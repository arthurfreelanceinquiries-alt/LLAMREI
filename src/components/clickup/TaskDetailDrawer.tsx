import { ArrowLeft, Camera, FileText, Play, Plus, Sparkles, Square, Trash2, X } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { formatWibStamp, wibDateTimeInput, wibDateTimeToIso } from '../../lib/calendar-time';
import { listTaskStatuses } from '../../lib/task-status';
import { usePendingAction } from '../../lib/use-pending-action';
import type { ActiveTimer, ListItem, MacroGoal, ScheduledMessageItem, TaskItem, WorkspaceDocItem } from '../../types/llamrei';
import { Control } from '../ui/Control';
import { DialogPanel } from '../ui/DialogPanel';

interface CustomField {
  type: 'text' | 'number' | 'date' | 'select' | 'url';
  value: string;
}

interface Props {
  task: TaskItem | null;
  list?: ListItem;
  subtasks: TaskItem[];
  goals: MacroGoal[];
  linkedChats: ScheduledMessageItem[];
  linkedDocs: WorkspaceDocItem[];
  activeTimer: ActiveTimer | null;
  onClose: () => void;
  onOpenRelatedTask: (id: string) => void;
  onUpdateTask: (taskId: string, patch: Record<string, unknown>) => Promise<void>;
  onUpdateTaskMeta: (taskId: string, meta: { recurrenceRule?: string; customFields?: Record<string, unknown> }) => Promise<void>;
  onSaveDoc: (input: { id?: string; linkedTaskId: string; title: string; contentMd: string }) => Promise<void>;
  onDeleteDoc: (docId: string) => Promise<void>;
  onCreateSubtask: (parent: TaskItem, title: string) => Promise<void>;
  onDeleteTask: (taskId: string) => Promise<void>;
  onStartTimer: (taskId: string) => Promise<void>;
  onStopTimer: (taskId: string) => Promise<void>;
  onScanAttachmentFromPhone: (taskId: string) => Promise<string>;
  onAskLlamrei: (prompt: string, context: Record<string, unknown>) => void;
}

function arrayOrEmpty<T>(raw: string | undefined): T[] {
  try {
    const value: unknown = JSON.parse(raw ?? '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function taskCustomFields(raw: string | undefined): Record<string, CustomField> {
  try {
    const value: unknown = JSON.parse(raw ?? '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).map(([key, field]) => [
      key,
      field && typeof field === 'object' && 'type' in field && 'value' in field
        ? { type: field.type, value: String(field.value ?? '') }
        : { type: 'text', value: String(field ?? '') },
    ]));
  } catch {
    return {};
  }
}

const recurrence = {
  none: 'Tidak berulang',
  daily: 'Harian',
  weekdays: 'Hari kerja',
  weekly: 'Mingguan',
  monthly: 'Bulanan',
};

type Detail = NonNullable<Props['task']>;
function timeFields(task: Detail) {
  return {
    start: task.start_at ? wibDateTimeInput(task.start_at) : '',
    due: task.due_at ? wibDateTimeInput(task.due_at) : '',
  };
}

export function TaskDetailDrawer({ task, ...props }: Props) {
  return task ? <TaskDetail key={task.id} task={task} {...props} /> : null;
}

function TaskDetail({
  task, list, subtasks, goals, linkedChats, linkedDocs, activeTimer, onClose, onOpenRelatedTask,
  onUpdateTask, onUpdateTaskMeta, onSaveDoc, onDeleteDoc, onCreateSubtask, onDeleteTask, onStartTimer, onStopTimer,
  onScanAttachmentFromPhone, onAskLlamrei,
}: Omit<Props, 'task'> & { task: Detail }) {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description_md);
  const [schedule, setSchedule] = useState(() => timeFields(task));
  const [newSubtask, setNewSubtask] = useState('');
  const [newCheck, setNewCheck] = useState('');
  const [field, setField] = useState<{ name: string } & CustomField>({ name: '', type: 'text', value: '' });
  const [doc, setDoc] = useState<{ id?: string; title: string; body: string }>({ title: '', body: '' });
  const [confirmRemoval, setConfirmRemoval] = useState<{ kind: 'task' | 'document'; id: string; title: string }>();
  const [notice, setNotice] = useState('');
  const action = usePendingAction();
  const checklist = arrayOrEmpty<{ id: string; text: string; done: boolean }>(task.checklist_json);
  const attachments = arrayOrEmpty<{ id: string; name: string; source: string }>(task.attachments_json);
  const fields = taskCustomFields(task.custom_fields_json);
  const timerRunning = activeTimer?.task_id === task.id;
  const currentSchedule = timeFields(task);
  const start = schedule.start ? wibDateTimeToIso(schedule.start) : null;
  const due = schedule.due ? wibDateTimeToIso(schedule.due) : null;
  const invalidRange = !!(start && due && Date.parse(start) > Date.parse(due));
  const scheduleChanged = schedule.start !== currentSchedule.start || schedule.due !== currentSchedule.due;
  const hasSchedule = !!(task.start_at || task.due_at || task.auto_scheduled_block_start);

  function run(key: string, operation: () => Promise<void>, failure = 'Perubahan belum dapat disimpan. Periksa koneksi dan coba lagi.') {
    setNotice('');
    return action.run(key, operation, failure);
  }

  function saveTask(patch: Record<string, unknown>) {
    return run('task', () => onUpdateTask(task.id, patch));
  }

  async function saveText(event: FormEvent) {
    event.preventDefault();
    if (!title.trim()) return;
    if (await saveTask({ title: title.trim(), descriptionMd: description })) setNotice('Detail tugas tersimpan.');
  }

  async function addSubtask(event: FormEvent) {
    event.preventDefault();
    if (!newSubtask.trim()) return;
    if (await run('subtask', () => onCreateSubtask(task, newSubtask.trim()))) setNewSubtask('');
  }

  async function addChecklistItem(event: FormEvent) {
    event.preventDefault();
    if (!newCheck.trim()) return;
    const next = [...checklist, { id: `chk_${crypto.randomUUID()}`, text: newCheck.trim(), done: false }];
    if (await saveTask({ checklist: next })) setNewCheck('');
  }

  async function saveField(event: FormEvent) {
    event.preventDefault();
    const key = field.name.trim();
    if (!key || !field.value.trim() || ['__proto__', 'constructor', 'prototype'].includes(key)) return;
    const customFields = { ...fields, [key]: { type: field.type, value: field.value.trim() } };
    if (await run('field', () => onUpdateTaskMeta(task.id, { customFields }))) setField({ name: '', type: 'text', value: '' });
  }

  async function saveDoc(event: FormEvent) {
    event.preventDefault();
    if (!doc.title.trim()) return;
    if (await run('document', () => onSaveDoc({ id: doc.id, linkedTaskId: task.id, title: doc.title.trim(), contentMd: doc.body }))) {
      setDoc({ title: '', body: '' });
    }
  }

  async function remove() {
    if (!confirmRemoval) return;
    const { kind, id } = confirmRemoval;
    if (await run('delete', () => kind === 'document' ? onDeleteDoc(id) : onDeleteTask(id), 'Penghapusan belum terkonfirmasi.')) {
      setConfirmRemoval(undefined);
      if (kind === 'task') onClose();
      if (doc.id === id) setDoc({ title: '', body: '' });
    }
  }

  return (
    <DialogPanel label="Detail tugas" className="workspace-task-dialog themed-scroll" onClose={() => { if (!action.pending) onClose(); }}>
      <header className="sticky top-0 z-10 border-b border-[var(--border-subtle)] bg-[var(--bg-panel)] px-3 py-2 sm:px-4">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h2 className="font-semibold">{task.parent_task_id ? 'Detail subtugas' : 'Detail tugas'}</h2>
            <p className="text-xs text-[var(--text-secondary)] [overflow-wrap:anywhere]">{list?.name ?? task.status}</p>
          </div>
          <Control onClick={onClose} disabled={!!action.pending} aria-label="Tutup detail tugas"><X aria-hidden="true" /></Control>
        </div>
        {action.error && <p className="ds-note" role="alert">{action.error}</p>}
        {notice && <p className="ds-note" role="status">{notice}</p>}
        {action.pending && <p className="text-xs text-[var(--text-secondary)]" role="status">Memproses perubahan…</p>}
      </header>

      <fieldset disabled={!!action.pending} className="min-w-0 space-y-4 p-3 sm:p-4">
        {task.parent_task_id && <Control className="ds-control--outline" onClick={() => onOpenRelatedTask(task.parent_task_id!)}><ArrowLeft aria-hidden="true" /> Tugas induk</Control>}
        <section className="themed-card space-y-3 p-3">
          <form className="space-y-3" onSubmit={(event) => void saveText(event)}>
            <label className="ds-label">Judul tugas<input required className="ds-field font-semibold" value={title} onChange={(event) => setTitle(event.target.value)} /></label>
            <label className="ds-label">Deskripsi<textarea className="ds-field" rows={3} value={description} onChange={(event) => setDescription(event.target.value)} /></label>
            <Control type="submit" className="ds-control--primary" disabled={!title.trim() || (title === task.title && description === task.description_md)}>Simpan detail</Control>
          </form>
          <div className="flex flex-wrap gap-1 border-t border-[var(--border-subtle)] pt-2">
            <Control className="ds-control--outline" onClick={() => void run('timer', () => timerRunning ? onStopTimer(task.id) : onStartTimer(task.id), 'Timer belum dapat diperbarui.')}>
              {timerRunning ? <Square aria-hidden="true" /> : <Play aria-hidden="true" />} {timerRunning ? 'Hentikan timer' : 'Mulai timer'}
            </Control>
            <Control className="ds-control--outline" onClick={() => void run('scan', async () => {
              setNotice(await onScanAttachmentFromPhone(task.id));
            }, 'Status pemindaian belum diterima.')}>
              <Camera aria-hidden="true" /> Pindai lewat ponsel
            </Control>
            <Control className="ds-control--outline" onClick={() => {
              onAskLlamrei(`Bantu saya merinci subtugas atau jadwal untuk "${task.title}".`, task as unknown as Record<string, unknown>);
              onClose();
            }}><Sparkles aria-hidden="true" /> Tanya Llamrei</Control>
          </div>
        </section>

        <section className="themed-card space-y-3 p-3">
          <h3 className="text-sm font-semibold">Properti & jadwal</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="ds-label">Status
              <select className="ds-field" value={task.status} onChange={(event) => void saveTask({ status: event.target.value })}>
                {listTaskStatuses(list, task.status).map((status) => <option key={status}>{status}</option>)}
              </select>
            </label>
            <label className="ds-label">Prioritas
              <select className="ds-field" value={task.priority} onChange={(event) => void saveTask({ priority: event.target.value })}>
                <option value="urgent">Mendesak</option><option value="high">Tinggi</option>
                <option value="normal">Normal</option><option value="low">Rendah</option>
              </select>
            </label>
            <label className="ds-label">Target
              <select className="ds-field" value={task.goal_id ?? ''} onChange={(event) => void saveTask({ goalId: event.target.value || null })}>
                <option value="">Tanpa target</option>
                {goals.map(({ id, title }) => <option key={id} value={id}>{title}</option>)}
              </select>
            </label>
            <label className="ds-label">Pengulangan
              <select className="ds-field" value={task.recurrence_rule ?? 'none'} onChange={(event) => {
                const recurrenceRule = event.target.value;
                void run('recurrence', () => onUpdateTaskMeta(task.id, { recurrenceRule }));
              }}>
                {Object.entries(recurrence).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
              </select>
            </label>
          </div>
          <form className="space-y-2" onSubmit={(event) => {
            event.preventDefault();
            if (!invalidRange && scheduleChanged) void saveTask({
              ...(schedule.start !== currentSchedule.start ? { startAt: start } : {}),
              ...(schedule.due !== currentSchedule.due ? { dueAt: due } : {}),
            });
          }}>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="ds-label">Mulai tugas (WIB)<input className="ds-field" type="datetime-local" value={schedule.start} onChange={(event) => setSchedule({ ...schedule, start: event.target.value })} /></label>
              <label className="ds-label">Tenggat tugas (WIB)<input className="ds-field" type="datetime-local" value={schedule.due} onChange={(event) => setSchedule({ ...schedule, due: event.target.value })} /></label>
            </div>
            {invalidRange && <p className="ds-note" role="alert">Tenggat harus sama dengan atau setelah waktu mulai.</p>}
            <Control type="submit" className="ds-control--outline" disabled={!scheduleChanged || invalidRange}>Simpan jadwal tugas</Control>
          </form>
          {task.auto_scheduled_block_start && <p className="text-xs text-[var(--text-secondary)]">Blok fokus: {formatWibStamp(task.auto_scheduled_block_start)}</p>}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border-subtle)] pt-2">
            <div>
              <p className="text-sm font-semibold">Hard alarm</p>
              <p className="text-xs text-[var(--text-secondary)]">{hasSchedule ? 'Atur bunyi dan ponsel di layar Alarm.' : 'Simpan jadwal tugas untuk memasang alarm.'}</p>
            </div>
            <Control
              className="ds-control--outline"
              aria-pressed={task.hard_alarm_enabled === 1}
              aria-label="Hard alarm tugas"
              disabled={!hasSchedule && task.hard_alarm_enabled !== 1}
              onClick={() => void saveTask({ hardAlarmEnabled: task.hard_alarm_enabled !== 1 })}
            >{task.hard_alarm_enabled === 1 ? 'Terpasang' : 'Nonaktif'}</Control>
          </div>
        </section>

        <section className="themed-card space-y-2 p-3">
          <h3 className="font-semibold">Subtugas</h3>
          {subtasks.length === 0 && <p className="text-sm text-[var(--text-secondary)]">Belum ada subtugas.</p>}
          <ul className="divide-y divide-[var(--border-subtle)]">
            {subtasks.map((subtask) => (
              <li key={subtask.id} className="flex min-h-11 items-center gap-2">
                <input type="checkbox" aria-label={`Tandai selesai ${subtask.title}`} checked={subtask.status === 'Done'} onChange={(event) => {
                  const status = event.target.checked ? 'Done' : 'To Do';
                  void run('subtask-status', () => onUpdateTask(subtask.id, { status }));
                }} />
                <button type="button" className="min-h-11 text-left text-sm hover:underline [overflow-wrap:anywhere]" onClick={() => onOpenRelatedTask(subtask.id)}>
                  {subtask.title}
                </button>
              </li>
            ))}
          </ul>
          <form className="flex gap-2" onSubmit={(event) => void addSubtask(event)}>
            <input className="ds-field" aria-label="Nama subtugas baru" placeholder="Nama subtugas" value={newSubtask} onChange={(event) => setNewSubtask(event.target.value)} />
            <Control type="submit" className="ds-control--outline" aria-label="Tambah subtugas" disabled={!newSubtask.trim()}><Plus aria-hidden="true" /></Control>
          </form>
        </section>

        <section className="themed-card space-y-2 p-3">
          <h3 className="font-semibold">Checklist</h3>
          {checklist.map((item) => (
            <label key={item.id} className="flex min-h-11 items-center gap-2 text-sm [overflow-wrap:anywhere]">
              <input type="checkbox" checked={item.done} onChange={(event) => void saveTask({
                checklist: checklist.map((entry) => entry.id === item.id ? { ...entry, done: event.target.checked } : entry),
              })} /> {item.text}
            </label>
          ))}
          <form className="flex gap-2" onSubmit={(event) => void addChecklistItem(event)}>
            <input className="ds-field" aria-label="Item checklist baru" placeholder="Item checklist" value={newCheck} onChange={(event) => setNewCheck(event.target.value)} />
            <Control type="submit" className="ds-control--outline" aria-label="Tambah checklist" disabled={!newCheck.trim()}><Plus aria-hidden="true" /></Control>
          </form>
        </section>

        <section className="themed-card space-y-2 p-3">
          <h3 className="flex items-center gap-2 font-semibold"><FileText size={16} aria-hidden="true" /> Dokumen tertaut</h3>
          {linkedDocs.map((item) => (
            <article key={item.id} className="space-y-1 rounded-lg bg-[var(--bg-elevated)] px-3 py-2 [overflow-wrap:anywhere]">
              <h4 className="text-sm font-semibold">{item.title}</h4>
              <p className="whitespace-pre-wrap text-sm text-[var(--text-secondary)]">{item.content_md}</p>
              <div className="flex gap-1">
                <Control onClick={() => setDoc({ id: item.id, title: item.title, body: item.content_md })}>Edit dokumen</Control>
                <Control aria-label={`Hapus dokumen ${item.title}`} onClick={() => setConfirmRemoval({ kind: 'document', id: item.id, title: item.title })}><Trash2 aria-hidden="true" /></Control>
              </div>
            </article>
          ))}
          <form className="space-y-2" onSubmit={(event) => void saveDoc(event)}>
            <label className="ds-label">Judul dokumen<input required className="ds-field" value={doc.title} onChange={(event) => setDoc({ ...doc, title: event.target.value })} /></label>
            <label className="ds-label">Isi dokumen (Markdown)<textarea className="ds-field" rows={3} value={doc.body} onChange={(event) => setDoc({ ...doc, body: event.target.value })} /></label>
            <div className="flex flex-wrap gap-1">
              <Control type="submit" className="ds-control--outline" disabled={!doc.title.trim()}>{doc.id ? 'Simpan dokumen' : 'Tambahkan dokumen'}</Control>
              {doc.id && <Control onClick={() => setDoc({ title: '', body: '' })}>Batal edit</Control>}
            </div>
          </form>
        </section>

        <section className="themed-card space-y-2 p-3">
          <h3 className="font-semibold">Kolom kustom</h3>
          {Object.entries(fields).map(([name, value]) => (
            <div key={name} className="flex flex-wrap items-center gap-2 border-b border-[var(--border-subtle)] pb-1 text-sm">
              <span className="min-w-0 flex-1 [overflow-wrap:anywhere]"><strong>{name}</strong> · {value.type === 'url' && /^https?:\/\//i.test(value.value)
                ? <a href={value.value} target="_blank" rel="noreferrer" className="text-[var(--accent)] underline">{value.value}</a> : value.value}</span>
              <Control onClick={() => setField({ name, ...value })}>Edit</Control>
              <Control aria-label={`Hapus kolom ${name}`} onClick={() => {
                const next = { ...fields };
                delete next[name];
                void run('field', () => onUpdateTaskMeta(task.id, { customFields: next }));
              }}><Trash2 aria-hidden="true" /></Control>
            </div>
          ))}
          <form className="grid gap-2 sm:grid-cols-2" onSubmit={(event) => void saveField(event)}>
            <label className="ds-label">Nama kolom<input className="ds-field" required value={field.name} onChange={(event) => setField({ ...field, name: event.target.value })} /></label>
            <label className="ds-label">Tipe kolom
              <select className="ds-field" value={field.type} onChange={(event) => setField({ ...field, type: event.target.value as CustomField['type'], value: '' })}>
                <option value="text">Teks</option><option value="number">Angka</option><option value="date">Tanggal</option>
                <option value="select">Pilihan</option><option value="url">Tautan</option>
              </select>
            </label>
            <label className="ds-label">Nilai<input className="ds-field" required type={field.type === 'select' ? 'text' : field.type} value={field.value} onChange={(event) => setField({ ...field, value: event.target.value })} /></label>
            <Control type="submit" className="ds-control--outline self-end" disabled={!field.name.trim() || !field.value.trim()}>Simpan kolom</Control>
          </form>
        </section>

        {(attachments.length > 0 || linkedChats.length > 0) && (
          <section className="themed-card space-y-2 p-3 [overflow-wrap:anywhere]">
            <h3 className="font-semibold">Lampiran & pesan tertaut</h3>
            {attachments.map(({ id, name, source }) => <p key={id} className="text-sm">{name} · {source}</p>)}
            {linkedChats.map(({ id, recipient_name, status }) => <p key={id} className="text-sm">{recipient_name} · {status}</p>)}
          </section>
        )}
        <footer className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-[var(--text-secondary)]">Waktu tercatat {Math.round(task.time_spent_seconds / 60)} mnt · Diundur {task.postponed_count} kali</span>
          <Control className="ds-control--outline text-[var(--danger)]" onClick={() => setConfirmRemoval({ kind: 'task', id: task.id, title: task.title })}><Trash2 aria-hidden="true" /> Hapus tugas</Control>
        </footer>
      </fieldset>

      {confirmRemoval && (
        <DialogPanel label="Konfirmasi penghapusan" className="workspace-form-dialog" onClose={() => { if (!action.pending) setConfirmRemoval(undefined); }}>
          <div className="space-y-3 p-4">
            <h3 className="text-base font-semibold">Hapus {confirmRemoval.kind === 'task' ? 'tugas' : 'dokumen'}?</h3>
            <p className="text-sm [overflow-wrap:anywhere]">{confirmRemoval.title}</p>
            {confirmRemoval.kind === 'task' && <p className="text-sm text-[var(--text-secondary)]">Subtugas, alarm, dan entri waktu dari tugas ini ikut dihapus.</p>}
            {action.error && <p className="ds-note" role="alert">{action.error}</p>}
            <div className="flex justify-end gap-2">
              <Control disabled={!!action.pending} onClick={() => setConfirmRemoval(undefined)}>Batal</Control>
              <Control disabled={!!action.pending} className="ds-control--outline text-[var(--danger)]" onClick={() => void remove()}>{action.pending ? 'Menghapus…' : 'Ya, hapus'}</Control>
            </div>
          </div>
        </DialogPanel>
      )}
    </DialogPanel>
  );
}
