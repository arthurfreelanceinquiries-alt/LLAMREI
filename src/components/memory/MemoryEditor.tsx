import { useState, type FormEvent } from 'react';
import { MAX_MEMORY_BODY, MAX_MEMORY_TITLE, MEMORY_KINDS, type MemoryEntry, type MemoryKind } from '../../../shared/memory';
import { apiRequest } from '../../lib/api-client';
import { wibDateTimeInput, wibDateTimeToIso } from '../../lib/calendar-time';
import { memoryError, memoryKindLabels } from '../../lib/memory-client';
import type { WorkspaceDocItem } from '../../types/llamrei';
import { Control } from '../ui/Control';
import { DialogPanel } from '../ui/DialogPanel';

export function MemoryEditor({ item, importDocument, documents, onSaved, onClose }: {
  item?: MemoryEntry;
  importDocument: boolean;
  documents: WorkspaceDocItem[];
  onSaved: (item: MemoryEntry) => void;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<MemoryKind>(item?.kind ?? 'semantic');
  const [title, setTitle] = useState(item?.title ?? '');
  const [body, setBody] = useState(item?.body ?? '');
  const [tags, setTags] = useState(item?.tags.join(', ') ?? '');
  const [allowed, setAllowed] = useState(item?.usableByAssistant ?? false);
  const originalExpiry = item?.expiresAt ? wibDateTimeInput(item.expiresAt) : '';
  const [expiry, setExpiry] = useState(originalExpiry);
  const [documentId, setDocumentId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const label = importDocument ? 'Impor dokumen' : item ? 'Edit memori' : 'Catatan baru';
  const doc = documents.find(({ id }) => documentId === id);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const data = {
        kind, tags: tags.split(',').map((tag) => tag.trim()).filter(Boolean), usableByAssistant: allowed,
        expiresAt: expiry && expiry === originalExpiry ? item?.expiresAt : expiry ? wibDateTimeToIso(expiry) : null,
        ...(importDocument ? { sourceDocumentId: documentId } : { title, body }),
        ...(item ? { revision: item.revision } : {}),
      };
      const saved = await apiRequest<MemoryEntry>(item ? `/api/memory/${item.id}` : '/api/memory', {
        method: item ? 'PATCH' : 'POST', body: data,
      });
      onSaved(saved);
    } catch (error) {
      setError(memoryError(error, 'Perubahan belum dapat disimpan.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <DialogPanel label={label} className="workspace-form-dialog" onClose={() => { if (!busy) onClose(); }}>
      <form className="space-y-4 p-4 sm:p-5" onSubmit={(event) => void save(event)}>
        <h2 className="text-lg font-semibold">{label}</h2>
        {importDocument ? (
          <div className="space-y-2">
            <label className="ds-label">Dokumen sumber
              <select required autoFocus className="ds-field" value={documentId} onChange={(event) => setDocumentId(event.target.value)}>
                <option value="">Pilih dokumen</option>
                {documents.map((doc) => <option key={doc.id} value={doc.id}>{doc.title}</option>)}
              </select>
            </label>
            <p className="text-sm text-[var(--text-secondary)]">Salinan mengikuti masa simpan yang dipilih dan terhapus jika dokumen sumber dihapus.</p>
            {doc && <p className="line-clamp-3 whitespace-pre-wrap rounded-lg bg-[var(--bg-elevated)] p-3 text-sm [overflow-wrap:anywhere]">{doc.content_md || 'Dokumen ini kosong.'}</p>}
          </div>
        ) : (
          <>
            <label className="ds-label">Judul<input required autoFocus className="ds-field" maxLength={MAX_MEMORY_TITLE} value={title} onChange={(event) => setTitle(event.target.value)} /></label>
            <label className="ds-label">Isi catatan<textarea required className="ds-field min-h-32 resize-y" rows={6} maxLength={MAX_MEMORY_BODY} value={body} onChange={(event) => setBody(event.target.value)} /></label>
          </>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="ds-label">Jenis memori
            <select className="ds-field" value={kind} onChange={(event) => setKind(event.target.value as MemoryKind)}>
              {MEMORY_KINDS.map((choice) => <option key={choice} value={choice}>{memoryKindLabels[choice]}</option>)}
            </select>
          </label>
          <label className="ds-label">Kedaluwarsa (WIB)<input type="datetime-local" className="ds-field" value={expiry} onChange={(event) => setExpiry(event.target.value)} />
            <span className="text-xs text-[var(--text-secondary)]">Kosongkan untuk menyimpan tanpa batas waktu.</span>
          </label>
        </div>
        <label className="ds-label">Tag, dipisah dengan koma<input className="ds-field" maxLength={330} value={tags} onChange={(event) => setTags(event.target.value)} placeholder="Proyek, referensi" /></label>
        <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={allowed} onChange={(event) => setAllowed(event.target.checked)} /> Izinkan JARVIS mengambil catatan ini secara lokal</label>
        {error && <p role="alert" className="ds-note">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2 border-t border-[var(--border-subtle)] pt-3">
          <Control disabled={busy} onClick={onClose}>Batal</Control>
          <Control type="submit" className="ds-control--primary" disabled={busy || (importDocument && !documentId)}>{busy ? 'Menyimpan…' : 'Simpan memori'}</Control>
        </div>
      </form>
    </DialogPanel>
  );
}
