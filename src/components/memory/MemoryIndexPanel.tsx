import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { MemoryIndexStatus } from '../../../shared/memory';
import { apiRequest } from '../../lib/api-client';
import { memoryError } from '../../lib/memory-client';
import { Control } from '../ui/Control';
import { DialogPanel } from '../ui/DialogPanel';

export function MemoryIndexPanel({ onClose, onUpdated }: { onClose: () => void; onUpdated: () => void }) {
  const [status, setStatus] = useState<MemoryIndexStatus>();
  const [enabled, setEnabled] = useState(false);
  const [model, setModel] = useState('');
  const [busy, setBusy] = useState<'config' | 'index'>();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const job = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void apiRequest<MemoryIndexStatus>('/api/memory/index', { signal: controller.signal }).then((result) => {
      if (controller.signal.aborted) return;
      setStatus(result);
      setEnabled(result.enabled);
      setModel(result.model);
    }).catch(() => { if (!controller.signal.aborted) setError('Pengaturan indeks belum dapat dimuat.'); });
    return () => {
      controller.abort();
      job.current?.abort();
    };
  }, []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError('');
    setNotice('');
    setBusy('config');
    try {
      setStatus(await apiRequest<MemoryIndexStatus>('/api/memory/index', { method: 'PATCH', body: { enabled, model } }));
      setNotice('Pengaturan indeks disimpan.');
      onUpdated();
    } catch (error) {
      setError(memoryError(error, 'Pengaturan indeks belum dapat disimpan.'));
    } finally {
      setBusy(undefined);
    }
  }

  async function buildIndex() {
    if (busy || !status?.enabled) return;
    const controller = new AbortController();
    job.current = controller;
    setError('');
    setNotice('');
    setBusy('index');
    try {
      const batch = await apiRequest<{ built: number; status: MemoryIndexStatus }>('/api/memory/index', { method: 'POST', signal: controller.signal });
      if (controller.signal.aborted) return;
      setStatus(batch.status);
      setNotice(batch.built ? `${batch.built} catatan diindeks.` : 'Model embedding lokal belum menghasilkan vektor. Pencarian kata kunci tersedia.');
      onUpdated();
    } catch (error) {
      if (!controller.signal.aborted) setError(memoryError(error, 'Indeks belum dapat diperbarui.'));
    } finally {
      job.current = null;
      setBusy(undefined);
    }
  }

  return (
    <DialogPanel label="Indeks embedding" className="workspace-form-dialog" onClose={() => { if (busy !== 'config') onClose(); }}>
      <form className="space-y-4 p-4 sm:p-5" onSubmit={(event) => void save(event)}>
        <h2 className="text-lg font-semibold">Indeks embedding</h2>
        <p className="text-sm text-[var(--text-secondary)]">Aktifkan pencarian berdasarkan makna dengan model Ollama yang terpasang di mesin ini. Pencarian kata kunci selalu tersedia.</p>
        {!status && !error && <p role="status" className="text-sm">Memuat pengaturan…</p>}
        {status && (
          <fieldset disabled={!!busy} className="min-w-0 space-y-3">
            <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} /> Aktifkan embedding lokal</label>
            <label className="ds-label">Model embedding<input className="ds-field" maxLength={160} value={model} onChange={(event) => setModel(event.target.value)} required /></label>
            <p className="text-sm text-[var(--text-secondary)]">{status.indexed} dari {status.total} catatan memiliki vektor.</p>
            {status.enabled && status.indexed < status.total && (
              <Control className="ds-control--outline" onClick={() => void buildIndex()}>{busy === 'index' ? 'Mengindeks…' : 'Indeks catatan berikutnya'}</Control>
            )}
          </fieldset>
        )}
        {error && <p role="alert" className="ds-note">{error}</p>}
        {notice && <p role="status" className="ds-note">{notice}</p>}
        <div className="flex flex-wrap justify-end gap-2 border-t border-[var(--border-subtle)] pt-3">
          <Control disabled={busy === 'config'} onClick={onClose}>Tutup</Control>
          {status && <Control type="submit" className="ds-control--primary" disabled={!!busy}>{busy === 'config' ? 'Menyimpan…' : 'Simpan pengaturan'}</Control>}
        </div>
      </form>
    </DialogPanel>
  );
}
