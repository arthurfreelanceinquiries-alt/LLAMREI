import { useState } from 'react';
import type { ActiveTimer, MacroGoal, ScheduledMessageItem, TaskItem, WorkspaceDocItem } from '../../types/llamrei';

interface TypedCustomField {
  type: 'text' | 'number' | 'date' | 'select' | 'url';
  value: string;
}

interface Props {
  task: TaskItem | null;
  subtasks: TaskItem[];
  goals: MacroGoal[];
  linkedChats: ScheduledMessageItem[];
  linkedDocs: WorkspaceDocItem[];
  activeTimer: ActiveTimer | null;
  onClose: () => void;
  onUpdateTask: (taskId: string, patch: Record<string, unknown>) => Promise<void>;
  onUpdateTaskMeta: (taskId: string, meta: { recurrenceRule?: string; customFields?: Record<string, unknown> }) => Promise<void>;
  onCreateDoc: (input: { linkedTaskId: string; title: string; contentMd: string }) => Promise<void>;
  onDeleteDoc: (docId: string) => Promise<void>;
  onCreateSubtask: (parentTask: TaskItem, title: string) => Promise<void>;
  onDeleteTask: (taskId: string) => Promise<void>;
  onStartTimer: (taskId: string) => Promise<void>;
  onStopTimer: (taskId: string) => Promise<void>;
  onScanAttachmentFromPhone: (taskId: string) => Promise<void>;
  onAskLlamrei: (prompt: string, context: Record<string, unknown>) => void;
}

function safeParseJson<T>(raw: string | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function formatIsoToWibDatetimeLocal(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  const hh = map.hour === '24' ? '00' : map.hour;
  return `${map.year}-${map.month}-${map.day}T${hh}:${map.minute}`;
}

export function TaskDetailDrawer({
  task,
  subtasks,
  goals,
  linkedChats,
  linkedDocs,
  activeTimer,
  onClose,
  onUpdateTask,
  onUpdateTaskMeta,
  onCreateDoc,
  onDeleteDoc,
  onCreateSubtask,
  onDeleteTask,
  onStartTimer,
  onStopTimer,
  onScanAttachmentFromPhone,
  onAskLlamrei,
}: Props) {
  const [newSub, setNewSub] = useState('');
  const [newCheck, setNewCheck] = useState('');
  const [cfKey, setCfKey] = useState('');
  const [cfType, setCfType] = useState<TypedCustomField['type']>('text');
  const [cfVal, setCfVal] = useState('');
  const [docTitle, setDocTitle] = useState('');
  const [docBody, setDocBody] = useState('');

  if (!task) return null;

  const checklist = safeParseJson<Array<{ id: string; text: string; done: boolean }>>(task.checklist_json, []);
  const attachments = safeParseJson<Array<{ id: string; name: string; source: string }>>(task.attachments_json, []);
  const rawCustomFields = safeParseJson<Record<string, unknown>>(task.custom_fields_json, {});
  const customFields: Record<string, TypedCustomField> = {};
  for (const [k, v] of Object.entries(rawCustomFields)) {
    if (v && typeof v === 'object' && 'type' in v && 'value' in v) {
      customFields[k] = v as TypedCustomField;
    } else {
      customFields[k] = { type: 'text', value: String(v ?? '') };
    }
  }

  const isTimerRunning = activeTimer?.task_id === task.id;
  const dueLocalValue = formatIsoToWibDatetimeLocal(task.due_at ?? task.start_at);

  const saveCustomFieldsMap = async (nextMap: Record<string, TypedCustomField>) => {
    await onUpdateTaskMeta(task.id, { customFields: nextMap });
  };

  return (
    <div className="fixed inset-0 z-40 bg-black/70 backdrop-blur-xs flex justify-end" onClick={onClose}>
      <div
        className="w-full max-w-lg h-full border-l p-4 overflow-y-auto themed-scroll space-y-4 shadow-2xl"
        style={{ background: 'var(--bg-panel)', borderColor: 'var(--border-subtle)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-2 border-b pb-3" style={{ borderColor: 'var(--border-subtle)' }}>
          <div className="space-y-1 flex-1">
            <div className="text-xs font-mono-num" style={{ color: 'var(--accent)' }}>
              TASK DETAIL // CLICKUP + ALARM + CALENDAR (WIB)
            </div>
            <input
              defaultValue={task.title}
              onBlur={(e) => {
                if (e.target.value.trim() && e.target.value !== task.title) {
                  void onUpdateTask(task.id, { title: e.target.value.trim() });
                }
              }}
              className="w-full text-base font-bold bg-transparent outline-none border-b border-transparent focus:border-white/20"
            />
          </div>
          <button onClick={onClose} className="px-2 py-1 rounded text-xs bg-white/5 cursor-pointer">
            ✕
          </button>
        </div>

        {/* Quick Actions */}
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => void (isTimerRunning ? onStopTimer(task.id) : onStartTimer(task.id))}
            className="px-2.5 py-1.5 rounded text-xs font-mono-num font-bold cursor-pointer"
            style={{
              background: isTimerRunning ? '#ef4444' : 'var(--accent)',
              color: isTimerRunning ? '#ffffff' : 'var(--accent-fg)',
            }}
          >
            {isTimerRunning ? '⏹ Stop Timer & Matikan DND' : '▶ Mulai Timer (+ Auto-DND HP)'}
          </button>

          <button
            onClick={() => void onScanAttachmentFromPhone(task.id)}
            className="px-2.5 py-1.5 rounded text-xs font-mono-num border cursor-pointer"
            style={{ background: 'var(--bg-card)', borderColor: 'var(--border-subtle)', color: 'var(--accent-2)' }}
          >
            📷 Scan dari HP (NectarLink)
          </button>

          <button
            onClick={() => {
              onAskLlamrei(`Pecah tugas "${task.title}" jadi subtugas atau jadwalkan waktunya`, task as unknown as Record<string, unknown>);
              onClose();
            }}
            className="px-2.5 py-1.5 rounded text-xs font-mono-num border cursor-pointer"
            style={{ background: 'var(--accent-soft)', borderColor: 'var(--border-accent)', color: 'var(--accent)' }}
          >
            ⚡ Suruh Llamrei
          </button>
        </div>

        {/* Status, Priority, Goal, Due Date (WIB), Hard Alarm, Recurrence */}
        <div className="themed-card p-3 grid grid-cols-2 gap-3 text-xs">
          <label className="space-y-1">
            <span style={{ color: 'var(--text-muted)' }}>Status</span>
            <select
              value={task.status}
              onChange={(e) => void onUpdateTask(task.id, { status: e.target.value })}
              className="w-full px-2 py-1.5 rounded border"
              style={{ background: 'var(--bg-void)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
            >
              <option value="To Do">To Do</option>
              <option value="In Progress">In Progress</option>
              <option value="Review">Review</option>
              <option value="Done">Done</option>
            </select>
          </label>

          <label className="space-y-1">
            <span style={{ color: 'var(--text-muted)' }}>Prioritas</span>
            <select
              value={task.priority}
              onChange={(e) => void onUpdateTask(task.id, { priority: e.target.value })}
              className="w-full px-2 py-1.5 rounded border"
              style={{ background: 'var(--bg-void)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
            >
              <option value="urgent">Urgent</option>
              <option value="high">High</option>
              <option value="normal">Normal</option>
              <option value="low">Low</option>
            </select>
          </label>

          <label className="space-y-1 col-span-2">
            <span style={{ color: 'var(--text-muted)' }}>Jam & Tenggat WIB (Auto Soft Reminder H-15m)</span>
            <input
              type="datetime-local"
              defaultValue={dueLocalValue}
              onChange={(e) => {
                if (!e.target.value) return;
                const wibIso = new Date(`${e.target.value}:00+07:00`).toISOString();
                void onUpdateTask(task.id, { startAt: wibIso, dueAt: wibIso });
              }}
              className="w-full px-2 py-1.5 rounded border font-mono-num"
              style={{ background: 'var(--bg-void)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
            />
          </label>

          <label className="space-y-1 col-span-2">
            <span style={{ color: 'var(--text-muted)' }}>Kaitkan ke Macro Goal (FR-50)</span>
            <select
              value={task.goal_id ?? ''}
              onChange={(e) => void onUpdateTask(task.id, { goalId: e.target.value || null })}
              className="w-full px-2 py-1.5 rounded border"
              style={{ background: 'var(--bg-void)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
            >
              <option value="">— Tanpa Macro Goal —</option>
              {goals.map((g) => (
                <option key={g.id} value={g.id}>
                  🎯 {g.title} ({g.progress_percent}%)
                </option>
              ))}
            </select>
          </label>

          <div className="col-span-2 flex items-center justify-between pt-2 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
            <div>
              <div className="font-semibold text-amber-300">⏰ Sakelar Hard Alarm (Web + Dering HP)</div>
              <div style={{ color: 'var(--text-muted)' }}>Berbunyi terus sampai Anda klik Dismiss / Snooze</div>
            </div>
            <button
              onClick={() =>
                void onUpdateTask(task.id, {
                  hardAlarmEnabled: task.hard_alarm_enabled !== 1,
                  hardAlarmAt: task.hard_alarm_at ?? task.start_at ?? task.due_at ?? new Date(Date.now() + 3_600_000).toISOString(),
                })
              }
              className="px-3 py-1 rounded font-mono-num font-bold cursor-pointer"
              style={
                task.hard_alarm_enabled === 1
                  ? { background: '#f59e0b', color: '#050507' }
                  : { background: 'var(--bg-void)', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }
              }
            >
              {task.hard_alarm_enabled === 1 ? 'ON' : 'OFF'}
            </button>
          </div>

          <label className="space-y-1 col-span-2 pt-2 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
            <span style={{ color: 'var(--text-muted)' }}>🔁 Tugas Berulang (Auto-Spawn Saat Done)</span>
            <select
              value={task.recurrence_rule ?? 'none'}
              onChange={(e) => void onUpdateTaskMeta(task.id, { recurrenceRule: e.target.value })}
              className="w-full px-2 py-1.5 rounded border"
              style={{ background: 'var(--bg-void)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
            >
              <option value="none">Tidak Berulang</option>
              <option value="daily">Harian (Daily)</option>
              <option value="weekdays">Hari Kerja WIB (Senin–Jumat)</option>
              <option value="weekly">Mingguan (Weekly)</option>
              <option value="monthly">Bulanan (Monthly)</option>
            </select>
          </label>
        </div>

        {/* Typed Custom Fields (FR-16: angka, tanggal, pilihan, tautan) */}
        <div className="themed-card p-3 space-y-2 text-xs">
          <div className="font-semibold">🧩 Custom Fields ({Object.keys(customFields).length})</div>
          {Object.entries(customFields).map(([k, f]) => (
            <div key={k} className="flex items-center justify-between gap-2 bg-black/25 px-2 py-1 rounded">
              <span className="font-mono-num" style={{ color: 'var(--text-muted)' }}>
                {k} <span className="opacity-60">({f.type})</span>
              </span>
              <div className="flex items-center gap-2 min-w-0">
                {f.type === 'url' && /^https?:\/\//i.test(f.value) ? (
                  <a href={f.value} target="_blank" rel="noreferrer" className="font-mono-num underline truncate" style={{ color: 'var(--accent-2)' }}>
                    {f.value} ↗
                  </a>
                ) : (
                  <span className="font-mono-num font-semibold truncate">{f.value}</span>
                )}
                <button
                  onClick={() => {
                    const next = { ...customFields };
                    delete next[k];
                    void saveCustomFieldsMap(next);
                  }}
                  className="text-rose-400 cursor-pointer"
                  title="Hapus field"
                >
                  ✕
                </button>
              </div>
            </div>
          ))}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const cleanKey = cfKey.trim();
              if (!cleanKey || !cfVal.trim() || cleanKey === '__proto__' || cleanKey === 'constructor') return;
              void saveCustomFieldsMap({ ...customFields, [cleanKey]: { type: cfType, value: cfVal.trim() } });
              setCfKey('');
              setCfVal('');
            }}
            className="grid grid-cols-12 gap-1.5"
          >
            <input
              value={cfKey}
              onChange={(e) => setCfKey(e.target.value)}
              placeholder="Nama field"
              className="col-span-4 px-2 py-1 rounded border text-xs outline-none"
              style={{ background: 'var(--bg-void)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
            />
            <select
              value={cfType}
              onChange={(e) => setCfType(e.target.value as TypedCustomField['type'])}
              className="col-span-3 px-1.5 py-1 rounded border text-xs"
              style={{ background: 'var(--bg-void)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
            >
              <option value="text">Teks</option>
              <option value="number">Angka</option>
              <option value="date">Tanggal</option>
              <option value="select">Pilihan</option>
              <option value="url">Tautan</option>
            </select>
            <input
              type={cfType === 'number' ? 'number' : cfType === 'date' ? 'date' : cfType === 'url' ? 'url' : 'text'}
              value={cfVal}
              onChange={(e) => setCfVal(e.target.value)}
              placeholder="Nilai..."
              className="col-span-4 px-2 py-1 rounded border text-xs outline-none"
              style={{ background: 'var(--bg-void)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
            />
            <button type="submit" className="col-span-1 px-1 py-1 rounded border cursor-pointer" style={{ borderColor: 'var(--border-subtle)' }}>
              +
            </button>
          </form>
        </div>

        {/* Description */}
        <div className="space-y-1 text-xs">
          <div className="font-semibold" style={{ color: 'var(--text-muted)' }}>
            Deskripsi / Catatan
          </div>
          <textarea
            rows={3}
            defaultValue={task.description_md}
            onBlur={(e) => void onUpdateTask(task.id, { descriptionMd: e.target.value })}
            placeholder="Tambahkan detail tugas..."
            className="w-full p-2.5 rounded border text-xs outline-none"
            style={{ background: 'var(--bg-card)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
          />
        </div>

        {/* Subtasks */}
        <div className="themed-card p-3 space-y-2 text-xs">
          <div className="font-semibold">Subtasks ({subtasks.length})</div>
          {subtasks.map((sub) => (
            <div key={sub.id} className="flex items-center justify-between bg-black/25 px-2 py-1.5 rounded">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={sub.status === 'Done'}
                  onChange={(e) => void onUpdateTask(sub.id, { status: e.target.checked ? 'Done' : 'To Do' })}
                />
                <span className={sub.status === 'Done' ? 'line-through opacity-60' : ''}>{sub.title}</span>
              </label>
            </div>
          ))}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!newSub.trim()) return;
              void onCreateSubtask(task, newSub.trim());
              setNewSub('');
            }}
            className="flex gap-1.5"
          >
            <input
              value={newSub}
              onChange={(e) => setNewSub(e.target.value)}
              placeholder="+ Tambah subtugas..."
              className="flex-1 px-2 py-1 rounded border text-xs outline-none"
              style={{ background: 'var(--bg-void)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
            />
            <button type="submit" className="px-2.5 py-1 rounded font-bold cursor-pointer" style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}>
              +
            </button>
          </form>
        </div>

        {/* Action Checklist */}
        <div className="themed-card p-3 space-y-2 text-xs">
          <div className="font-semibold">Action Checklist ({checklist.length})</div>
          {checklist.map((item) => (
            <label key={item.id} className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={item.done}
                onChange={(e) => {
                  const next = checklist.map((c) => (c.id === item.id ? { ...c, done: e.target.checked } : c));
                  void onUpdateTask(task.id, { checklist: next });
                }}
              />
              <span className={item.done ? 'line-through opacity-60' : ''}>{item.text}</span>
            </label>
          ))}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!newCheck.trim()) return;
              const next = [...checklist, { id: `chk_${Date.now()}`, text: newCheck.trim(), done: false }];
              void onUpdateTask(task.id, { checklist: next });
              setNewCheck('');
            }}
            className="flex gap-1.5"
          >
            <input
              value={newCheck}
              onChange={(e) => setNewCheck(e.target.value)}
              placeholder="+ Item checklist..."
              className="flex-1 px-2 py-1 rounded border text-xs outline-none"
              style={{ background: 'var(--bg-void)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
            />
            <button type="submit" className="px-2.5 py-1 rounded border cursor-pointer" style={{ borderColor: 'var(--border-subtle)' }}>
              +
            </button>
          </form>
        </div>

        {/* Linked Workspace Docs (FR-19) */}
        <div className="themed-card p-3 space-y-2 text-xs">
          <div className="font-semibold">📄 Dokumen & Catatan Tertaut ({linkedDocs.length})</div>
          {linkedDocs.map((d) => (
            <div key={d.id} className="bg-black/25 p-2 rounded space-y-1">
              <div className="flex items-center justify-between">
                <span className="font-semibold">{d.title}</span>
                <button onClick={() => void onDeleteDoc(d.id)} className="text-rose-400 cursor-pointer">
                  ✕
                </button>
              </div>
              <div className="whitespace-pre-wrap" style={{ color: 'var(--text-secondary)' }}>
                {d.content_md}
              </div>
            </div>
          ))}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!docTitle.trim()) return;
              void onCreateDoc({ linkedTaskId: task.id, title: docTitle.trim(), contentMd: docBody });
              setDocTitle('');
              setDocBody('');
            }}
            className="space-y-1.5"
          >
            <input
              value={docTitle}
              onChange={(e) => setDocTitle(e.target.value)}
              placeholder="+ Judul catatan/dokumen..."
              className="w-full px-2 py-1 rounded border outline-none"
              style={{ background: 'var(--bg-void)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
            />
            <textarea
              rows={2}
              value={docBody}
              onChange={(e) => setDocBody(e.target.value)}
              placeholder="Isi catatan Markdown..."
              className="w-full px-2 py-1 rounded border outline-none"
              style={{ background: 'var(--bg-void)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
            />
            <button type="submit" className="px-2.5 py-1 rounded border cursor-pointer" style={{ borderColor: 'var(--border-subtle)' }}>
              + Lampirkan Dokumen
            </button>
          </form>
        </div>

        {(attachments.length > 0 || linkedChats.length > 0) && (
          <div className="themed-card p-3 space-y-2 text-xs">
            {attachments.length > 0 && (
              <div>
                <div className="font-semibold mb-1">📎 Lampiran ({attachments.length})</div>
                {attachments.map((a) => (
                  <div key={a.id} className="font-mono-num text-xs bg-black/25 px-2 py-1 rounded mb-1">
                    📷 {a.name} ({a.source})
                  </div>
                ))}
              </div>
            )}
            {linkedChats.length > 0 && (
              <div>
                <div className="font-semibold mb-1">💬 Chat Terjadwal Tertaut</div>
                {linkedChats.map((m) => (
                  <div key={m.id} className="bg-black/25 px-2 py-1 rounded mb-1">
                    → {m.recipient_name} ({m.status})
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="flex items-center justify-between pt-2 border-t text-xs" style={{ borderColor: 'var(--border-subtle)' }}>
          <span className="font-mono-num" style={{ color: 'var(--text-muted)' }}>
            Waktu tercatat: {Math.round(task.time_spent_seconds / 60)}m · Ditunda: {task.postponed_count}x
          </span>
          <button
            onClick={() => {
              void onDeleteTask(task.id);
              onClose();
            }}
            className="px-2.5 py-1 rounded bg-rose-500/20 text-rose-400 border border-rose-500/30 cursor-pointer"
          >
            Hapus Tugas
          </button>
        </div>
      </div>
    </div>
  );
}
