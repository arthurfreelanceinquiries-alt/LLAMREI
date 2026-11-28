import { ArrowDown, ArrowUp, Play, Plus, Trash2 } from 'lucide-react';
import { useRef, useState, type FormEvent } from 'react';
import { automationLimits, type AutomationDefinition, type AutomationPreview, type AutomationRule, type AutomationStep } from '../../../shared/automation';
import { apiErrorMessage, apiRequest } from '../../lib/api-client';
import { formatWibStamp } from '../../lib/calendar-time';
import type { ListItem } from '../../types/llamrei';
import { Control } from '../ui/Control';
import { DialogPanel } from '../ui/DialogPanel';

export function StepContent({ step, lists, approved = false }: { step: AutomationStep; lists: ListItem[]; approved?: boolean }) {
  if (step.kind === 'record') return <><p className="font-medium">Catat di misi</p><p className="whitespace-pre-wrap text-sm text-[var(--text-secondary)]">{step.note}</p></>;
  return <><p className="font-medium">Buat tugas · {step.title}</p><p className="text-sm text-[var(--text-secondary)]">{lists.find(({ id }) => id === step.listId)?.name ?? 'Daftar tidak tersedia'} · {approved ? 'Disetujui' : 'Perlu persetujuan'}</p></>;
}

function ListField({ label, lists, value, change }: { label: string; lists: ListItem[]; value: string; change: (value: string) => void }) {
  const missing = value && !lists.some(({ id }) => id === value);
  return <label className="ds-label">{label}<select className="ds-field" value={value} required onChange={(event) => change(event.target.value)}>
    <option value="" disabled>Pilih daftar</option>
    {missing && <option value={value} disabled>Daftar tidak tersedia</option>}
    {lists.map(({ id, name }) => <option value={id} key={id}>{name}</option>)}
  </select></label>;
}

function newDraft(): AutomationDefinition {
  return { name: '', trigger: { kind: 'manual' }, steps: [{ kind: 'record', note: '' }], maxMinutes: automationLimits.defaultDurationMinutes, quietHours: null };
}

export function RuleEditor({ rule, lists, onSaved, onClose }: {
  rule: AutomationRule | null; lists: ListItem[]; onSaved: () => void; onClose: () => void;
}) {
  const [draft, setDraft] = useState<AutomationDefinition>(() => rule ?? newDraft());
  const [enabled, setEnabled] = useState(rule?.enabled ?? false);
  const [preview, setPreview] = useState<AutomationPreview>();
  const [pending, setPending] = useState<'save' | 'preview'>();
  const [error, setError] = useState('');
  const requestId = useRef<string | null>(null);
  const busy = useRef(false);
  const label = rule ? 'Edit aturan' : 'Aturan baru';
  function change(patch: Partial<AutomationDefinition>) {
    setDraft((current) => ({ ...current, ...patch }));
    setPreview(undefined);
    requestId.current = null;
  }
  function setStep(index: number, step: AutomationStep) {
    change({ steps: draft.steps.map((old, position) => position === index ? step : old) });
  }
  function moveStep(index: number, destination: number) {
    const steps = [...draft.steps];
    [steps[index], steps[destination]] = [steps[destination], steps[index]];
    change({ steps });
  }
  async function submit(mode: 'save' | 'preview') {
    if (busy.current) return;
    busy.current = true;
    setPending(mode);
    setError('');
    try {
      if (mode === 'preview') {
        setPreview(undefined);
        const result = await apiRequest<AutomationPreview>('/api/automation/rules/preview', { method: 'POST', body: draft });
        setPreview(result);
      } else {
        requestId.current ??= crypto.randomUUID();
        await apiRequest(rule ? `/api/automation/rules/${rule.id}` : '/api/automation/rules', {
          method: rule ? 'PATCH' : 'POST', body: { ...draft, enabled, revision: rule?.revision, requestId: requestId.current },
        });
        onSaved();
      }
    } catch (error) { setError(apiErrorMessage(error, 'Aturan belum dapat diproses.')); }
    finally { busy.current = false; setPending(undefined); }
  }
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); void submit('save'); };

  return <DialogPanel label={label} className="workspace-form-dialog" onClose={() => { if (!pending) onClose(); }}>
    <form className="space-y-4 p-4 sm:p-5" onSubmit={handleSubmit}>
      <h2 className="text-lg font-semibold">{label}</h2>
      <fieldset disabled={Boolean(pending)} className="min-w-0 space-y-4">
        <label className="ds-label">Nama aturan<input className="ds-field" value={draft.name} required maxLength={100} onChange={(event) => change({ name: event.target.value })} /></label>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="ds-label">Pemicu<select className="ds-field" value={draft.trigger.kind} onChange={(event) => {
            setEnabled(false);
            change({ trigger: event.target.value === 'manual' ? { kind: 'manual' } : { kind: 'task_completed', listId: lists[0]?.id ?? '' } });
          }}><option value="manual">Jalankan manual</option><option value="task_completed">Tugas selesai</option></select></label>
          {draft.trigger.kind === 'task_completed' && <ListField label="Daftar pemicu" lists={lists} value={draft.trigger.listId} change={(listId) => change({ trigger: { kind: 'task_completed', listId } })} />}
        </div>
        {draft.trigger.kind === 'task_completed' && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={enabled} onChange={(event) => { setEnabled(event.target.checked); requestId.current = null; }} /> Aktifkan pemicu saat tugas di daftar ini selesai</label>}
        <fieldset className="min-w-0 space-y-2 rounded-xl border border-[var(--border-subtle)] p-3">
          <legend className="px-1 text-sm font-semibold">Langkah misi</legend>
          {draft.steps.map((step, index) => (
            <fieldset key={index} className="min-w-0 space-y-2 rounded-lg bg-[var(--bg-elevated)] p-2">
              <legend className="px-1 text-xs text-[var(--text-secondary)]">Langkah {index + 1}</legend>
              <div className="flex flex-wrap items-end gap-1">
                <label className="ds-label min-w-36 flex-1">Tindakan<select className="ds-field" value={step.kind} onChange={(event) => setStep(index, event.target.value === 'record'
                  ? { kind: 'record', note: '' } : { kind: 'create_task', listId: lists[0]?.id ?? '', title: '' })}>
                  <option value="record">Catat di misi</option><option value="create_task">Buat tugas dengan persetujuan</option>
                </select></label>
                <Control aria-label={`Naikkan langkah ${index + 1}`} disabled={index === 0} onClick={() => moveStep(index, index - 1)}><ArrowUp aria-hidden="true" /></Control>
                <Control aria-label={`Turunkan langkah ${index + 1}`} disabled={index === draft.steps.length - 1} onClick={() => moveStep(index, index + 1)}><ArrowDown aria-hidden="true" /></Control>
                <Control aria-label={`Hapus langkah ${index + 1}`} disabled={draft.steps.length === 1} onClick={() => change({ steps: draft.steps.filter((_, position) => position !== index) })}><Trash2 aria-hidden="true" /></Control>
              </div>
              {step.kind === 'record'
                ? <label className="ds-label">Isi catatan<textarea className="ds-field resize-y" rows={2} value={step.note} required maxLength={1000} onChange={(event) => setStep(index, { ...step, note: event.target.value })} /></label>
                : <div className="grid gap-2 sm:grid-cols-2">
                  <label className="ds-label">Judul tugas<input className="ds-field" value={step.title} required maxLength={200} onChange={(event) => setStep(index, { ...step, title: event.target.value })} /></label>
                  <ListField label="Daftar tujuan" lists={lists} value={step.listId} change={(listId) => setStep(index, { ...step, listId })} />
                </div>}
            </fieldset>
          ))}
          <Control className="ds-control--outline" disabled={draft.steps.length >= automationLimits.steps} onClick={() => change({ steps: [...draft.steps, { kind: 'record', note: '' }] })}><Plus aria-hidden="true" /> Tambah langkah</Control>
        </fieldset>
        <div className="grid items-end gap-2 sm:grid-cols-2">
          <label className="ds-label">Batas waktu (menit)<input className="ds-field" type="number" value={draft.maxMinutes || ''} min={1} max={automationLimits.durationMinutes} required onChange={(event) => change({ maxMinutes: Number(event.target.value) })} /></label>
          <label className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" checked={Boolean(draft.quietHours)} onChange={(event) => change({ quietHours: event.target.checked ? { start: '22:00', end: '06:00' } : null })} /> Atur jam hening (WIB)</label>
        </div>
        {draft.quietHours && <div className="grid grid-cols-2 gap-2">
          <label className="ds-label">Mulai hening<input className="ds-field" type="time" required value={draft.quietHours.start} onChange={(event) => change({ quietHours: { start: event.target.value, end: draft.quietHours!.end } })} /></label>
          <label className="ds-label">Akhir hening<input className="ds-field" type="time" required value={draft.quietHours.end} onChange={(event) => change({ quietHours: { start: draft.quietHours!.start, end: event.target.value } })} /></label>
        </div>}
      </fieldset>
      {preview && <section aria-label="Hasil simulasi" className="space-y-2 rounded-xl border border-[var(--border-subtle)] p-3">
        <h3 className="font-semibold">Hasil simulasi</h3>
        <p className="text-sm text-[var(--text-secondary)]">Biaya USD {preview.costUsd} · Batas {formatWibStamp(preview.deadlineAt)}</p>
        {preview.earliestAt >= preview.deadlineAt && <p className="ds-note">Batas waktu akan habis sebelum jam hening berakhir.</p>}
        {preview.earliestAt < preview.deadlineAt && <p className="text-sm text-[var(--text-secondary)]">Perkiraan mulai {formatWibStamp(preview.earliestAt)}</p>}
        <ol className="space-y-2">{preview.definition.steps.map((step, index) => <li key={index} className="rounded bg-[var(--bg-elevated)] p-2 [overflow-wrap:anywhere]"><StepContent step={step} lists={lists} /></li>)}</ol>
      </section>}
      {error && <p role="alert" className="ds-note">{error}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <Control disabled={Boolean(pending)} onClick={onClose}>Tutup</Control>
        <Control disabled={Boolean(pending)} className="ds-control--outline" onClick={() => void submit('preview')}><Play aria-hidden="true" /> {pending === 'preview' ? 'Mensimulasikan…' : 'Simulasi'}</Control>
        <Control disabled={Boolean(pending)} type="submit" className="ds-control--primary">{pending === 'save' ? 'Menyimpan…' : 'Simpan aturan'}</Control>
      </div>
    </form>
  </DialogPanel>;
}
