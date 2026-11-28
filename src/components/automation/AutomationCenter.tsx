import { ArrowLeft, CircleCheck, GitBranch, Plus, RefreshCw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { activeMissionStates, type AutomationEvent, type AutomationRule, type AutomationSnapshot, type MissionDetail, type MissionState } from '../../../shared/automation';
import { apiErrorMessage, apiRequest } from '../../lib/api-client';
import { formatWibStamp } from '../../lib/calendar-time';
import type { ListItem } from '../../types/llamrei';
import { Control } from '../ui/Control';
import { RuleEditor, StepContent } from './RuleEditor';

const missionLabels: Record<MissionState, string> = {
  queued: 'Dalam antrean', waiting_approval: 'Perlu persetujuan',
  completed: 'Selesai', cancelled: 'Dibatalkan', expired: 'Kedaluwarsa', failed: 'Gagal',
};
const eventLabels: Record<AutomationEvent['status'], string> = {
  pending: 'Dalam antrean', handled: 'Misi dibuat', skipped: 'Dilewati', failed: 'Gagal',
};

export function AutomationCenter({ lists, version, onOpenTask, taskIds }: {
  lists: ListItem[]; version: number; onOpenTask: (id: string) => void; taskIds: ReadonlySet<string>;
}) {
  const [tab, setTab] = useState<'missions' | 'rules'>('missions');
  const [snapshot, setSnapshot] = useState<AutomationSnapshot>();
  const [selected, setSelected] = useState('');
  const [detail, setDetail] = useState<MissionDetail>();
  const [revision, setRevision] = useState(0);
  const [editor, setEditor] = useState<AutomationRule | null>();
  const [loadError, setLoadError] = useState('');
  const [detailError, setDetailError] = useState('');
  const [runError, setRunError] = useState('');
  const [runningRule, setRunningRule] = useState('');
  const runRequest = useRef<{ ruleId: string; revision: number; requestId: string } | null>(null);
  const missionList = useRef<HTMLElement>(null);
  const detailRegion = useRef<HTMLElement>(null);
  const lastOpened = useRef<HTMLButtonElement>(null);
  const refresh = () => setRevision((current) => current + 1);

  useEffect(() => {
    const controller = new AbortController();
    void apiRequest<AutomationSnapshot>('/api/automation', { signal: controller.signal }).then((result) => {
      if (!controller.signal.aborted) { setSnapshot(result); setLoadError(''); }
    }).catch((error) => {
      if (!controller.signal.aborted) setLoadError(apiErrorMessage(error, 'Misi dan aturan belum dapat dimuat.'));
    });
    return () => controller.abort();
  }, [revision, version]);

  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    void apiRequest<MissionDetail>(`/api/automation/missions/${selected}`, { signal: controller.signal }).then((result) => {
      if (!controller.signal.aborted) { setDetail(result); setDetailError(''); }
    }).catch((error) => {
      if (!controller.signal.aborted) setDetailError(apiErrorMessage(error, 'Misi belum dapat dibuka.'));
    });
    return () => controller.abort();
  }, [selected, revision, version]);

  useEffect(() => {
    if (tab === 'missions' && selected) detailRegion.current?.focus();
  }, [selected, tab]);

  function selectMission(id: string, trigger?: HTMLButtonElement) {
    setDetailError('');
    setSelected(id);
    setTab('missions');
    lastOpened.current = trigger ?? null;
  }

  async function manualRun(rule: AutomationRule) {
    if (runningRule) return;
    if (runRequest.current?.ruleId !== rule.id || runRequest.current.revision !== rule.revision) {
      runRequest.current = { ruleId: rule.id, revision: rule.revision, requestId: crypto.randomUUID() };
    }
    setRunningRule(rule.id);
    setRunError('');
    try {
      const mission = await apiRequest<MissionDetail>(`/api/automation/rules/${rule.id}/run`, {
        method: 'POST', body: { revision: rule.revision, requestId: runRequest.current.requestId },
      });
      runRequest.current = null;
      setDetail(mission);
      selectMission(mission.id);
      refresh();
    } catch (error) { setRunError(apiErrorMessage(error, 'Misi belum dapat dimulai.')); }
    finally { setRunningRule(''); }
  }

  return <div className="mx-auto min-w-0 max-w-[90rem] space-y-4">
    <header className="flex flex-wrap items-end justify-between gap-3">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Misi &amp; Otomasi</h1>
      <div className="flex flex-wrap gap-2">
        <Control className="ds-control--outline" onClick={refresh}><RefreshCw aria-hidden="true" /> Muat ulang</Control>
        <Control className="ds-control--primary" onClick={() => setEditor(null)}><Plus aria-hidden="true" /> Aturan baru</Control>
      </div>
    </header>
    <div role="group" aria-label="Tampilan otomasi" className="flex flex-wrap gap-1">
      <Control className="ds-segment" aria-pressed={tab === 'missions'} onClick={() => setTab('missions')}>Misi</Control>
      <Control className="ds-segment" aria-pressed={tab === 'rules'} onClick={() => setTab('rules')}>Aturan &amp; peristiwa</Control>
    </div>
    {loadError && <p className="ds-note" role="alert">{loadError}</p>}
    {!snapshot && !loadError && <p role="status" className="text-sm text-[var(--text-secondary)]">Memuat misi dan aturan…</p>}
    {snapshot && tab === 'missions' && <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
      <section ref={missionList} tabIndex={-1} aria-label="Daftar misi" className={`themed-card min-w-0 overflow-hidden ${selected ? 'hidden lg:block' : ''}`}>
        <h2 className="border-b border-[var(--border-subtle)] p-3 font-semibold">Misi terbaru</h2>
        {!snapshot.missions.length && <p className="p-3 text-sm text-[var(--text-secondary)]">Belum ada misi. Jalankan aturan manual atau aktifkan pemicu saat tugas selesai.</p>}
        <ul className="divide-y divide-[var(--border-subtle)]">{snapshot.missions.map((mission) => <li key={mission.id}>
          <button type="button" aria-current={selected === mission.id ? 'true' : undefined} onClick={(event) => selectMission(mission.id, event.currentTarget)}
            className="w-full space-y-1 px-3 py-3 text-left hover:bg-[var(--bg-elevated)] aria-current:bg-[var(--accent-soft)]">
            <span className="block truncate text-sm font-medium">{mission.name}</span>
            <span className="block text-xs text-[var(--text-secondary)]">{missionLabels[mission.status]} · {mission.stepIndex}/{mission.totalSteps} langkah</span>
          </button>
        </li>)}</ul>
      </section>
      {!selected && snapshot.missions.length > 0 && <p className="themed-card hidden p-5 text-sm text-[var(--text-secondary)] lg:block">Pilih misi untuk meninjau langkah dan persetujuannya.</p>}
      {selected && <section ref={detailRegion} tabIndex={-1} aria-label="Detail misi" className="themed-card min-w-0">
        <div className="p-2 lg:hidden"><Control onClick={() => {
          setSelected('');
          requestAnimationFrame(() => (lastOpened.current ?? missionList.current)?.focus());
        }}><ArrowLeft aria-hidden="true" /> Kembali ke misi</Control></div>
        {detailError && <p className="ds-note m-3" role="alert">{detailError}</p>}
        {!detailError && detail?.id === selected && <MissionPanel key={detail.id} mission={detail} lists={lists} onOpenTask={onOpenTask} taskIds={taskIds} onUpdated={(next) => { setDetail(next); refresh(); }} />}
        {!detailError && detail?.id !== selected && <p role="status" className="p-3 text-sm">Memuat detail…</p>}
      </section>}
    </div>}
    {snapshot && tab === 'rules' && <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
      <section aria-label="Aturan otomasi" className="themed-card min-w-0 overflow-hidden">
        <h2 className="border-b border-[var(--border-subtle)] p-3 font-semibold">Aturan otomasi</h2>
        {runError && <p className="ds-note m-3" role="alert">{runError}</p>}
        {!snapshot.rules.length && <p className="p-3 text-sm text-[var(--text-secondary)]">Belum ada aturan.</p>}
        <ul className="divide-y divide-[var(--border-subtle)]">{snapshot.rules.map((rule) => <li key={rule.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
          <div className="min-w-0 [overflow-wrap:anywhere]">
            <h3 className="font-medium">{rule.name}</h3>
            <p className="text-sm text-[var(--text-secondary)]">{rule.trigger.kind === 'manual' ? 'Manual' : rule.enabled ? 'Pemicu aktif' : 'Pemicu nonaktif'} · {rule.steps.length} langkah · {rule.maxMinutes} menit</p>
          </div>
          <div className="flex flex-wrap gap-1">
            <Control className="ds-control--outline" onClick={() => setEditor(rule)}>Edit aturan<span className="sr-only"> {rule.name}</span></Control>
            <Control className="ds-control--outline" disabled={Boolean(runningRule)} onClick={() => void manualRun(rule)}>
              {runningRule === rule.id ? 'Memulai…' : 'Jalankan manual'}<span className="sr-only"> {rule.name}</span>
            </Control>
          </div>
        </li>)}</ul>
      </section>
      <section aria-label="Peristiwa Sentinel" className="themed-card min-w-0 overflow-hidden">
        <h2 className="flex items-center gap-2 border-b border-[var(--border-subtle)] p-3 font-semibold"><GitBranch size={16} aria-hidden="true" /> Peristiwa Sentinel</h2>
        {!snapshot.events.length && <p className="p-3 text-sm text-[var(--text-secondary)]">Peristiwa tugas yang cocok dengan aturan aktif muncul di sini.</p>}
        <ul className="divide-y divide-[var(--border-subtle)]">{snapshot.events.map((event) => <li key={event.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
          <div className="min-w-0 max-w-full [overflow-wrap:anywhere]">
            <p className="font-medium">{event.ruleName}</p>
            <p className="text-xs text-[var(--text-secondary)]">{eventLabels[event.status]} · {formatWibStamp(event.createdAt)}</p>
            {event.reason && <p className="mt-1 text-sm text-[var(--text-secondary)]">{event.reason}</p>}
          </div>
          {event.missionId && <Control onClick={() => selectMission(event.missionId!)}>Buka misi</Control>}
        </li>)}</ul>
      </section>
    </div>}
    {editor !== undefined && <RuleEditor rule={editor} lists={lists} onClose={() => setEditor(undefined)} onSaved={() => {
      setEditor(undefined);
      setTab('rules');
      refresh();
    }} />}
  </div>;
}

function MissionPanel({ mission, lists, onUpdated, onOpenTask, taskIds }: {
  mission: MissionDetail; lists: ListItem[]; onUpdated: (mission: MissionDetail) => void;
  onOpenTask: (id: string) => void; taskIds: ReadonlySet<string>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function update(action: 'approve' | 'cancel') {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const updated = await apiRequest<MissionDetail>(`/api/automation/missions/${mission.id}/${action}`, {
        method: 'POST', body: action === 'approve' ? { stepIndex: mission.stepIndex, approvalId: mission.approval?.id } : {},
      });
      onUpdated(updated);
    } catch (error) { setError(apiErrorMessage(error, 'Perubahan misi belum dapat disimpan.')); }
    finally { setBusy(false); }
  }
  return <div className="min-w-0 space-y-3 p-3 sm:p-4">
    <header className="space-y-1 border-b border-[var(--border-subtle)] pb-3 [overflow-wrap:anywhere]">
      <h2 className="text-lg font-semibold">{mission.name}</h2>
      <p role="status" className="text-sm font-medium text-[var(--accent)]">{missionLabels[mission.status]} · {mission.stepIndex} dari {mission.totalSteps} langkah</p>
      <p className="text-sm text-[var(--text-secondary)]">Batas {formatWibStamp(mission.deadlineAt)} · Biaya USD 0</p>
      {mission.status === 'queued' && mission.runAt > new Date().toISOString() && <p className="text-sm text-[var(--text-secondary)]">Dilanjutkan {formatWibStamp(mission.runAt)}</p>}
      {mission.sourceTaskId && taskIds.has(mission.sourceTaskId) && <Control onClick={() => onOpenTask(mission.sourceTaskId!)}>Buka tugas pemicu</Control>}
    </header>
    <ol aria-label="Langkah misi" className="space-y-2">
      {mission.definition.steps.map((step, index) => {
        const checkpoint = mission.checkpoints.find(({ stepIndex }) => stepIndex === index);
        const approval = index === mission.stepIndex ? mission.approval : null;
        const taskId = checkpoint?.taskId;
        return <li key={index} className="space-y-1 rounded-lg bg-[var(--bg-elevated)] p-3 [overflow-wrap:anywhere]">
          <p className="flex items-center gap-1 text-xs text-[var(--text-secondary)]">
            {checkpoint?.finishedAt && <CircleCheck size={14} aria-hidden="true" />}
            Langkah {index + 1}{checkpoint?.finishedAt ? ` · Selesai ${formatWibStamp(checkpoint.finishedAt)}` : ''}
          </p>
          <StepContent step={step} lists={lists} approved={Boolean(checkpoint?.approvedAt)} />
          {taskId && taskIds.has(taskId) && <Control className="mt-1" onClick={() => onOpenTask(taskId)}>Buka tugas hasil misi</Control>}
          {approval && <div className="space-y-1 pt-2">
            <p className="text-sm text-[var(--text-secondary)]">Setujui sebelum {formatWibStamp(approval.expiresAt)}.</p>
            <Control disabled={busy} className="ds-control--primary" onClick={() => void update('approve')}>Setujui tugas ini</Control>
          </div>}
        </li>;
      })}
    </ol>
    {mission.reason && <p className="ds-note">{mission.reason}</p>}
    {error && <p className="ds-note" role="alert">{error}</p>}
    {activeMissionStates.includes(mission.status) && <Control className="ds-control--outline" disabled={busy} onClick={() => void update('cancel')}>Batalkan misi</Control>}
  </div>;
}
