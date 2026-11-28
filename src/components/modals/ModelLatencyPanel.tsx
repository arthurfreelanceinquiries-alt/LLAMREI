import { RefreshCw } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import type { ModelLatency } from '../../../shared/ai-protocol';
import { aiProviderLabels } from '../../lib/ai-provider-options';
import { apiRequest } from '../../lib/api-client';
import { Control } from '../ui/Control';

export function ModelLatencyPanel() {
  const heading = useId();
  const [models, setModels] = useState<ModelLatency[]>();
  const [reload, setReload] = useState(0);
  const [pending, setPending] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const request = new AbortController();
    apiRequest<{ models: ModelLatency[] }>('/api/ai/metrics', { signal: request.signal }).then(({ models }) => {
      if (!request.signal.aborted) setModels(models);
    }).catch(() => {
      if (!request.signal.aborted) setFailed(true);
    }).finally(() => {
      if (!request.signal.aborted) setPending(false);
    });
    return () => request.abort();
  }, [reload]);

  return (
    <section aria-labelledby={heading} className="themed-card min-w-0 space-y-2 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={heading} className="text-sm font-semibold">Latensi model</h3>
        <Control className="ds-control--outline" disabled={pending} onClick={() => {
          setPending(true);
          setFailed(false);
          setReload((current) => current + 1);
        }}><RefreshCw aria-hidden="true" /> {pending ? 'Memuat…' : 'Perbarui latensi'}</Control>
      </div>
      <p className="text-sm text-[var(--text-secondary)]">Waktu sampai teks pertama dari model, diukur pada balasan streaming berhasil dalam 7 hari terakhir.</p>
      {failed && <p className="ds-note" role="alert">Latensi belum dapat dimuat.</p>}
      {!pending && !failed && models?.length === 0 && (
        <p role="status" className="text-sm text-[var(--text-secondary)]">Belum ada percobaan model.</p>
      )}
      {!!models?.length && (
        <ul className="divide-y divide-[var(--border-subtle)]">
          {models.slice(0, 12).map((model) => (
            <li key={`${model.provider}/${model.model}`} className="grid gap-1 py-2 text-sm [overflow-wrap:anywhere] sm:grid-cols-[minmax(0,1fr)_auto]">
              <span className="font-medium">{aiProviderLabels[model.provider]} · {model.model}</span>
              <span className="text-[var(--text-secondary)] tabular-nums">
                {model.streamedSamples > 0
                  ? `p50 ${model.firstTokenP50Ms} ms · p95 ${model.firstTokenP95Ms} ms · ${model.streamedSamples} sampel`
                  : 'Belum ada sampel teks'}
              </span>
            </li>
          ))}
        </ul>
      )}
      {models && models.length > 12 && <p className="text-xs text-[var(--text-secondary)]">Menampilkan 12 model terakhir dari {models.length} model.</p>}
    </section>
  );
}
