import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Bell,
  BookOpen,
  CalendarDays,
  FileText,
  CornerDownLeft,
  MessageSquare,
  Newspaper,
  Search,
  Sparkles,
  SquareCheck,
  X,
  type LucideIcon,
} from 'lucide-react';
import type { MemoryMatch } from '../../../shared/memory';
import { alarmStatusLabels } from '../../lib/alarm-state';
import { formatWibStamp } from '../../lib/calendar-time';
import { findMemory, memoryKindLabels } from '../../lib/memory-client';
import type { AlarmReminderItem, CalendarEventItem, ContactItem, NavTab, NewsArticleItem, TaskItem, WorkspaceDocItem } from '../../types/llamrei';

interface Props {
  open: boolean;
  onClose: () => void;
  tasks: TaskItem[];
  alarms: AlarmReminderItem[];
  calendarEvents: CalendarEventItem[];
  documents: WorkspaceDocItem[];
  contacts: ContactItem[];
  news: NewsArticleItem[];
  onNavigateTab: (tab: NavTab) => void;
  onSelectTask: (task: TaskItem) => void;
  onSelectEvent: (id: string) => void;
  onSelectAlarm: (id: string) => void;
  onSelectDocument: (id: string) => void;
  onSelectMemory: (id: string) => void;
  onAskLlamrei: (prompt: string, context?: Record<string, unknown>) => void;
}

interface Result {
  key: string;
  title: string;
  detail?: string;
  select: () => void;
}

interface ResultGroup {
  title: string;
  icon: LucideIcon;
  items: Result[];
}

export function CommandPaletteModal({
  open,
  onClose,
  tasks,
  alarms,
  calendarEvents,
  documents,
  contacts,
  news,
  onNavigateTab,
  onSelectTask,
  onSelectEvent,
  onSelectAlarm,
  onSelectDocument,
  onSelectMemory,
  onAskLlamrei,
}: Props) {
  const id = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [memoryMatches, setMemoryMatches] = useState<{ query: string; items: MemoryMatch[] }>();

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) {
      setQuery('');
      setActiveKey(null);
      return;
    }
    const trigger = document.activeElement;
    dialog.showModal();
    inputRef.current?.focus();
    return () => {
      dialog.close();
      if (document.activeElement === document.body && trigger instanceof HTMLElement && trigger.isConnected) {
        trigger.focus({ preventScroll: true });
      }
    };
  }, [open]);

  const prompt = query.trim();
  useEffect(() => {
    if (!open || prompt.length < 2) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void findMemory(prompt, { limit: 4, keywordOnly: true, signal: controller.signal }).then(({ items }) => {
        if (!controller.signal.aborted) setMemoryMatches({ query: prompt, items });
      }).catch(() => { if (!controller.signal.aborted) setMemoryMatches({ query: prompt, items: [] }); });
    }, 150);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [open, prompt]);
  const terms = prompt.toLocaleLowerCase('id-ID').split(/\s+/).filter(Boolean);
  const matches = (...fields: Array<string | null | undefined>) => {
    const text = fields.filter(Boolean).join(' ').toLocaleLowerCase('id-ID');
    return terms.every((term) => text.includes(term));
  };
  const groups: ResultGroup[] = [
    {
      title: 'Tugas',
      icon: SquareCheck,
      items: tasks.filter((task) => matches(task.title, task.description_md, task.tags_json, task.status)).slice(0, 5).map((task) => ({
        key: `task-${task.id}`,
        title: task.title,
        detail: task.status,
        select: () => {
          onSelectTask(task);
          onNavigateTab('clickup');
        },
      })),
    },
    {
      title: 'Agenda',
      icon: CalendarDays,
      items: calendarEvents.filter((event) => matches(event.title, event.location, event.notes)).slice(0, 4).map((event) => ({
        key: `event-${event.id}`,
        title: event.title,
        detail: formatWibStamp(event.start_at),
        select: () => onSelectEvent(event.id),
      })),
    },
    {
      title: 'Dokumen',
      icon: FileText,
      items: prompt ? documents.filter((doc) => matches(doc.title, doc.content_md)).slice(0, 4).map((doc) => ({
        key: `doc-${doc.id}`,
        title: doc.title,
        select: () => onSelectDocument(doc.id),
      })) : [],
    },
    {
      title: 'Alarm dan pengingat',
      icon: Bell,
      items: alarms.filter((alarm) => matches(alarm.title)).slice(0, 3).map((alarm) => ({
        key: `alarm-${alarm.id}`,
        title: alarm.title,
        detail: alarm.enabled ? alarmStatusLabels[alarm.status] : 'Nonaktif',
        select: () => onSelectAlarm(alarm.id),
      })),
    },
    {
      title: 'Knowledge Vault',
      icon: BookOpen,
      items: memoryMatches?.query === prompt ? memoryMatches.items.map((item) => ({
        key: item.id,
        title: item.title,
        detail: memoryKindLabels[item.kind],
        select: () => onSelectMemory(item.id),
      })) : [],
    },
    {
      title: 'Kontak',
      icon: MessageSquare,
      items: contacts.filter((contact) => matches(contact.name)).slice(0, 3).map((contact) => ({
        key: `contact-${contact.id}`,
        title: `Siapkan draf untuk ${contact.name}`,
        select: () => onAskLlamrei(`Jadwalkan chat ke ${contact.name} jam 19:00 soal `),
      })),
    },
    {
      title: 'Berita',
      icon: Newspaper,
      items: news.filter((article) => matches(article.title)).slice(0, 3).map((article) => ({
        key: `news-${article.id}`,
        title: article.title,
        select: () => onAskLlamrei(`Ringkas berita ini: ${article.title}`, { title: article.title, articleId: article.id, source: article.source_name }),
      })),
    },
  ];

  const matchCount = groups.reduce((total, group) => total + group.items.length, 0);
  if (prompt) {
    groups.push({
      title: 'Asisten',
      icon: Sparkles,
      items: [{ key: 'ask', title: `Tanya Llamrei: ${prompt}`, select: () => onAskLlamrei(prompt) }],
    });
  }

  const options = groups.flatMap((group) => group.items);
  const listId = `${id}-results`;
  const optionId = (index: number) => `${listId}-${index}`;
  const currentIndex = options.findIndex((option) => option.key === activeKey);
  const activeIndex = currentIndex < 0 && matchCount > 0 ? 0 : currentIndex;
  const activeOption = options[activeIndex];

  function select(result: Result) {
    result.select();
    onClose();
  }

  function handleSearchKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing || !options.length) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      if (activeOption) select(activeOption);
      return;
    }
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    const delta = event.key === 'ArrowUp' ? -1 : 1;
    const next = activeIndex < 0 ? (delta === 1 ? 0 : options.length - 1) : (activeIndex + delta + options.length) % options.length;
    setActiveKey(options[next].key);
    document.getElementById(optionId(next))?.scrollIntoView({ block: 'nearest' });
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={`${id}-label`}
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
      onKeyDown={(event) => {
        if (event.key !== 'Tab') return;
        if (event.shiftKey && event.target === inputRef.current) {
          event.preventDefault();
          resultsRef.current?.focus();
        } else if (!event.shiftKey && event.target === resultsRef.current) {
          event.preventDefault();
          inputRef.current?.focus();
        }
      }}
      className="fixed top-4 right-auto bottom-auto left-1/2 m-0 max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-0 text-[var(--text-primary)] shadow-2xl backdrop:bg-black/70 sm:top-[12vh] sm:max-h-[calc(88dvh-1rem)]"
    >
      <div className="flex max-h-[inherit] flex-col">
        <div className="flex shrink-0 items-center gap-3 border-b border-[var(--border-subtle)] px-4 py-2">
          <Search size={20} aria-hidden="true" className="shrink-0 text-[var(--text-secondary)]" />
          <h2 id={`${id}-label`} className="sr-only">Palet perintah</h2>
          <label htmlFor={`${id}-query`} className="sr-only">Cari atau tanyakan ke Llamrei</label>
          <input
            id={`${id}-query`}
            ref={inputRef}
            type="text"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={open && options.length > 0}
            aria-controls={options.length ? listId : undefined}
            aria-activedescendant={activeOption ? optionId(activeIndex) : undefined}
            aria-describedby={`${id}-keys`}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveKey(null);
              if (resultsRef.current) resultsRef.current.scrollTop = 0;
            }}
            onKeyDown={handleSearchKey}
            placeholder="Cari tugas, agenda, dokumen…"
            className="min-h-11 min-w-0 flex-1 rounded-md bg-transparent px-2 text-base placeholder:text-[var(--text-secondary)] focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-[var(--accent)]"
          />
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup palet perintah"
            title="Tutup (Esc)"
            className="grid size-11 shrink-0 place-items-center rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <div
          ref={resultsRef}
          role="region"
          aria-label="Daftar hasil"
          tabIndex={0}
          className="themed-scroll min-h-0 max-h-96 overflow-y-auto overscroll-contain p-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--accent)]"
        >
          <p role="status" className={matchCount ? 'sr-only' : 'px-3 py-4 text-sm text-[var(--text-secondary)]'}>
            {matchCount ? `${matchCount} hasil pencarian` : prompt ? 'Tidak ada hasil pencarian.' : 'Ketik untuk mencari atau bertanya ke Llamrei.'}
          </p>
          {!!options.length && (
            <div role="listbox" id={listId} aria-label="Hasil dan tindakan" className="space-y-2">
              {groups.filter((group) => group.items.length).map(({ title, icon: Icon, items }, index) => (
                <div key={title} role="group" aria-labelledby={`${listId}-group-${index}`}>
                  <div id={`${listId}-group-${index}`} className="px-3 pb-1 pt-2 text-xs font-medium text-[var(--text-secondary)]">
                    {title}
                  </div>
                  {items.map((item) => (
                    <div
                      key={item.key}
                      id={optionId(options.indexOf(item))}
                      role="option"
                      aria-selected={item === activeOption}
                      onMouseMove={() => setActiveKey(item.key)}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => select(item)}
                      className="flex min-h-11 cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-transparent px-3 py-2 text-sm aria-selected:border-[var(--border-accent)] aria-selected:bg-[var(--accent-soft)]"
                    >
                      <Icon size={16} aria-hidden="true" className="shrink-0 text-[var(--text-secondary)]" />
                      <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{item.title}</span>
                      {item.detail && (
                        <span className="hidden max-w-[35%] shrink-0 truncate text-xs sm:inline text-[var(--text-secondary)]">{item.detail}</span>
                      )}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>

        <div id={`${id}-keys`} className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-t border-[var(--border-subtle)] px-4 py-2.5 text-xs text-[var(--text-secondary)]">
          <span className="inline-flex items-center gap-1">
            <ArrowUp size={13} aria-hidden="true" />
            <ArrowDown size={13} aria-hidden="true" />
            <span aria-hidden="true">Navigasi</span>
            <span className="sr-only">Gunakan panah atas atau bawah untuk navigasi</span>
          </span>
          <span className="inline-flex items-center gap-1">
            <CornerDownLeft size={13} aria-hidden="true" />
            Enter untuk memilih
          </span>
          <span className="ml-auto"><kbd>Esc</kbd> untuk menutup</span>
        </div>
      </div>
    </dialog>
  );
}
