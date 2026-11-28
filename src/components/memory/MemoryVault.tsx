import { BookOpen, Database, FilePlus2, Plus, Search, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { MEMORY_KINDS, type MemoryEntry, type MemoryKind, type MemoryMatch, type MemorySearchResult } from '../../../shared/memory';
import { apiRequest } from '../../lib/api-client';
import { formatWibStamp } from '../../lib/calendar-time';
import { findMemory, memoryError, memoryKindLabels } from '../../lib/memory-client';
import type { WorkspaceDocItem } from '../../types/llamrei';
import { Control } from '../ui/Control';
import { DialogPanel } from '../ui/DialogPanel';
import { MemoryEditor } from './MemoryEditor';
import { MemoryIndexPanel } from './MemoryIndexPanel';

export function MemoryVault({ documents, initialId, onOpenDocument }: {
  documents: WorkspaceDocItem[];
  initialId?: string;
  onOpenDocument: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<MemoryKind | ''>('');
  const [limit, setLimit] = useState(24);
  const [reload, setReload] = useState(0);
  const [results, setResults] = useState<MemorySearchResult>();
  const [searchError, setSearchError] = useState('');
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | undefined>(initialId);
  const [detail, setDetail] = useState<MemoryEntry>();
  const [detailError, setDetailError] = useState('');
  const [editor, setEditor] = useState<{ importDocument: boolean; item?: MemoryEntry }>();
  const [indexOpen, setIndexOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [notice, setNotice] = useState('');

  const refresh = () => setReload((previous) => previous + 1);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setSearchError('');
    const timer = window.setTimeout(() => {
      void findMemory(query, { kind: kind || undefined, limit, signal: controller.signal }).then((data) => {
        if (!controller.signal.aborted) setResults(data);
      }).catch((error) => {
        if (!controller.signal.aborted) setSearchError(memoryError(error, 'Memori belum dapat dimuat.'));
      }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, query ? 180 : 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query, kind, limit, reload]);

  useEffect(() => {
    if (!selectedId) return;
    const controller = new AbortController();
    setDetailError('');
    void apiRequest<MemoryEntry>(`/api/memory/${selectedId}`, { signal: controller.signal }).then((item) => {
      if (!controller.signal.aborted) setDetail(item);
    }).catch((error) => {
      if (!controller.signal.aborted) setDetailError(memoryError(error, 'Catatan belum dapat dibuka.'));
    });
    return () => controller.abort();
  }, [selectedId, reload]);

  function closeDetail() {
    if (deleting) return;
    setSelectedId(undefined);
    setDetail(undefined);
    setDetailError('');
    setConfirmDelete(false);
  }

  async function remove(item: MemoryEntry) {
    if (deleting) return;
    setDeleting(true);
    setDetailError('');
    try {
      await apiRequest(`/api/memory/${item.id}`, { method: 'DELETE', body: { revision: item.revision } });
      setSelectedId(undefined);
      setDetail(undefined);
      setConfirmDelete(false);
      setNotice('Catatan dihapus.');
      refresh();
    } catch (error) {
      setDetailError(memoryError(error, 'Catatan belum dapat dihapus.'));
    } finally {
      setDeleting(false);
    }
  }

  function saved(item: MemoryEntry) {
    setEditor(undefined);
    setNotice('Memori disimpan.');
    setDetail(item);
    setSelectedId(item.id);
    refresh();
  }
  const active = detail?.id === selectedId ? detail : undefined;

  return (
    <div className="mx-auto min-w-0 max-w-6xl space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Knowledge Vault</h1>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">Simpan referensi dan tentukan catatan yang bisa dipakai JARVIS.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Control className="ds-control--outline" onClick={() => setIndexOpen(true)}><Database aria-hidden="true" /> Indeks</Control>
          {!!documents.length && <Control className="ds-control--outline" onClick={() => setEditor({ importDocument: true })}><FilePlus2 aria-hidden="true" /> Impor dokumen</Control>}
          <Control className="ds-control--primary" onClick={() => setEditor({ importDocument: false })}><Plus aria-hidden="true" /> Catatan baru</Control>
        </div>
      </header>

      <div className="themed-card grid items-end gap-3 p-3 sm:grid-cols-[minmax(0,1fr)_13rem] sm:p-4">
        <label className="ds-label min-w-0"><span className="flex items-center gap-2"><Search size={16} aria-hidden="true" /> Cari memori</span>
          <input type="search" className="ds-field" maxLength={300} value={query} onChange={(event) => { setQuery(event.target.value); setLimit(24); }} placeholder="Judul, isi, atau tag" />
        </label>
        <label className="ds-label">Jenis memori
          <select className="ds-field" value={kind} onChange={(event) => { setKind(event.target.value as MemoryKind | ''); setLimit(24); }}>
            <option value="">Semua jenis</option>
            {MEMORY_KINDS.map((choice) => <option key={choice} value={choice}>{memoryKindLabels[choice]}</option>)}
          </select>
        </label>
      </div>

      {notice && <p role="status" className="text-sm text-[var(--text-secondary)]">{notice}</p>}
      {loading && <p role="status" className="text-sm text-[var(--text-secondary)]">Mencari catatan…</p>}
      {!loading && searchError && <div className="ds-note flex flex-wrap items-center justify-between gap-2"><p role="alert">{searchError}</p><Control onClick={refresh}>Coba lagi</Control></div>}
      {!loading && !searchError && results && (
        results.items.length ? (
          <>
            <p role="status" className="text-sm text-[var(--text-secondary)]">
              {results.items.length} catatan ditampilkan{query && ` · ${results.mode === 'hybrid' ? 'Pencarian hibrida' : 'Kata kunci'}`}
            </p>
            <ul className="grid gap-3 lg:grid-cols-2">
              {results.items.map((item) => <li key={item.id} className="min-w-0"><MemoryCard item={item} onOpen={() => setSelectedId(item.id)} /></li>)}
            </ul>
            {results.more && (limit < 60
              ? <Control className="ds-control--outline" onClick={() => setLimit((previous) => Math.min(60, previous + 24))}>Tampilkan lebih banyak</Control>
              : <p className="text-sm text-[var(--text-secondary)]">Persempit pencarian untuk melihat catatan lain.</p>)}
          </>
        ) : (
          <section className="themed-card space-y-2 px-5 py-8 text-center">
            <BookOpen size={24} className="mx-auto text-[var(--accent)]" aria-hidden="true" />
            <h2 className="font-semibold">{query || kind ? 'Catatan tidak ditemukan' : 'Belum ada catatan'}</h2>
            <p className="text-sm text-[var(--text-secondary)]">{query || kind ? 'Coba kata kunci atau jenis lain.' : 'Tambahkan catatan atau impor dokumen dari ruang kerja.'}</p>
          </section>
        )
      )}

      {selectedId && !editor && (
        <DialogPanel label="Detail memori" className="workspace-form-dialog" onClose={closeDetail}>
          <div className="space-y-4 p-4 sm:p-5">
            <div className="flex items-start justify-between gap-2">
              <h2 className="min-w-0 text-lg font-semibold [overflow-wrap:anywhere]">{active?.title ?? 'Detail memori'}</h2>
              <Control aria-label="Tutup detail memori" disabled={deleting} onClick={closeDetail}><X aria-hidden="true" /></Control>
            </div>
            {!active && !detailError && <p role="status" className="text-sm">Memuat catatan…</p>}
            {detailError && <p role="alert" className="ds-note">{detailError}</p>}
            {active && (
              <>
                <dl className="grid gap-2 text-sm sm:grid-cols-2">
                  <div><dt className="text-xs text-[var(--text-secondary)]">Jenis</dt><dd>{memoryKindLabels[active.kind]}</dd></div>
                  <div><dt className="text-xs text-[var(--text-secondary)]">Kedaluwarsa</dt><dd>{active.expiresAt ? formatWibStamp(active.expiresAt) : 'Tanpa batas waktu'}</dd></div>
                  <div><dt className="text-xs text-[var(--text-secondary)]">Akses JARVIS</dt><dd>{active.usableByAssistant ? 'Bisa dipakai secara lokal' : 'Khusus vault'}</dd></div>
                  <div><dt className="text-xs text-[var(--text-secondary)]">Terakhir diubah</dt><dd>{formatWibStamp(active.updatedAt)}</dd></div>
                </dl>
                <p className="whitespace-pre-wrap rounded-lg bg-[var(--bg-elevated)] p-3 text-sm leading-relaxed [overflow-wrap:anywhere]">{active.body}</p>
                <TagList tags={active.tags} />
                {active.source.kind === 'document' ? (
                  <div className="rounded-lg border border-[var(--border-subtle)] p-3 text-sm [overflow-wrap:anywhere]">
                    <p>Disalin dari {active.source.title} pada {formatWibStamp(active.source.capturedAt)}</p>
                    <Control className="mt-2" onClick={() => { if (active.source.kind === 'document') { closeDetail(); onOpenDocument(active.source.id); } }}>Buka dokumen sumber</Control>
                  </div>
                ) : <p className="text-sm text-[var(--text-secondary)]">Sumber manual</p>}
                {confirmDelete ? (
                  <div className="rounded-lg border border-[var(--border-subtle)] p-3">
                    <h3 className="font-semibold">Hapus catatan ini?</h3>
                    <p className="my-2 text-sm text-[var(--text-secondary)]">Catatan dan indeksnya akan dihapus dari vault.</p>
                    <div className="flex flex-wrap gap-2">
                      <Control disabled={deleting} onClick={() => setConfirmDelete(false)}>Batal</Control>
                      <Control disabled={deleting} className="ds-control--outline text-[var(--danger)]" onClick={() => void remove(active)}>{deleting ? 'Menghapus…' : 'Ya, hapus catatan'}</Control>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap justify-end gap-2 border-t border-[var(--border-subtle)] pt-3">
                    <Control className="ds-control--outline text-[var(--danger)]" onClick={() => setConfirmDelete(true)}>Hapus catatan</Control>
                    <Control className="ds-control--primary" onClick={() => { closeDetail(); setEditor({ item: active, importDocument: false }); }}>Edit catatan</Control>
                  </div>
                )}
              </>
            )}
          </div>
        </DialogPanel>
      )}
      {editor && <MemoryEditor {...editor} documents={documents} onClose={() => setEditor(undefined)} onSaved={saved} />}
      {indexOpen && <MemoryIndexPanel onClose={() => setIndexOpen(false)} onUpdated={refresh} />}
    </div>
  );
}

function TagList({ tags }: { tags: string[] }) {
  if (!tags.length) return null;
  return <ul aria-label="Tag" className="flex flex-wrap gap-1">{tags.map((tag) => <li key={tag} className="rounded-md bg-[var(--bg-elevated)] px-2 py-1 text-xs text-[var(--text-secondary)] [overflow-wrap:anywhere]">{tag}</li>)}</ul>;
}

function MemoryCard({ item, onOpen }: { item: MemoryMatch; onOpen: () => void }) {
  return (
    <article className="themed-card h-full min-w-0 space-y-2 p-3 sm:p-4">
      <div className="flex flex-wrap gap-2 text-xs text-[var(--text-secondary)]">
        <span>{memoryKindLabels[item.kind]}</span>
        {item.source.kind === 'document' && <span>· Dokumen</span>}
        {item.usableByAssistant && <span className="text-[var(--accent)]">· Untuk JARVIS</span>}
      </div>
      <h2 className="text-base font-semibold"><button type="button" onClick={onOpen} className="min-h-11 rounded text-left hover:underline [overflow-wrap:anywhere]">{item.title}</button></h2>
      <p className="line-clamp-3 whitespace-pre-wrap text-sm leading-relaxed text-[var(--text-secondary)] [overflow-wrap:anywhere]">{item.excerpt}</p>
      <TagList tags={item.tags} />
    </article>
  );
}
