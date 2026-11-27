import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Bell,
  CornerDownLeft,
  MessageSquare,
  Newspaper,
  Search,
  Sparkles,
  SquareCheck,
  X,
  type LucideIcon,
} from 'lucide-react';
import type { AlarmReminderItem, ContactItem, NavTab, NewsArticleItem, TaskItem } from '../../types/llamrei';

interface Props {
  open: boolean;
  onClose: () => void;
  tasks: TaskItem[];
  alarms: AlarmReminderItem[];
  contacts: ContactItem[];
  news: NewsArticleItem[];
  onNavigateTab: (tab: NavTab) => void;
  onSelectTask: (task: TaskItem) => void;
  onAskLlamrei: (prompt: string) => void;
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

const alarmStatus: Record<AlarmReminderItem['status'], string> = {
  armed: 'Siap',
  ringing: 'Berdering',
  snoozed: 'Ditunda',
  dismissed: 'Dihentikan',
  completed: 'Selesai',
};

export function CommandPaletteModal({
  open,
  onClose,
  tasks,
  alarms,
  contacts,
  news,
  onNavigateTab,
  onSelectTask,
  onAskLlamrei,
}: Props) {
  const id = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [activeKey, setActiveKey] = useState<string | null>(null);

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
  const q = prompt.toLowerCase();
  const matches = (text: string) => text.toLowerCase().includes(q);
  const groups: ResultGroup[] = [
    {
      title: 'Tugas',
      icon: SquareCheck,
      items: tasks.filter((task) => matches(task.title)).slice(0, 5).map((task) => ({
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
      title: 'Alarm dan pengingat',
      icon: Bell,
      items: alarms.filter((alarm) => matches(alarm.title)).slice(0, 3).map((alarm) => ({
        key: `alarm-${alarm.id}`,
        title: alarm.title,
        detail: alarm.enabled ? alarmStatus[alarm.status] : 'Nonaktif',
        select: () => onNavigateTab('calendar'),
      })),
    },
    {
      title: 'Kontak',
      icon: MessageSquare,
      items: contacts.filter((contact) => matches(contact.name)).slice(0, 3).map((contact) => ({
        key: `contact-${contact.id}`,
        title: `Jadwalkan chat ke ${contact.name}`,
        detail: contact.phone_e164 ?? undefined,
        select: () => onAskLlamrei(`Jadwalkan chat ke ${contact.name} jam 19:00 soal `),
      })),
    },
    {
      title: 'Berita',
      icon: Newspaper,
      items: news.filter((article) => matches(article.title)).slice(0, 3).map((article) => ({
        key: `news-${article.id}`,
        title: article.title,
        select: () => onAskLlamrei(`Ringkas berita ini: ${article.title}`),
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
  const activeIndex = Math.max(0, options.findIndex((option) => option.key === activeKey));
  const activeOption = options[activeIndex];

  function select(result: Result) {
    result.select();
    onClose();
  }

  function handleSearchKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing || !options.length) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      select(activeOption);
      return;
    }
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    const delta = event.key === 'ArrowUp' ? -1 : 1;
    const next = (activeIndex + delta + options.length) % options.length;
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
          closeRef.current?.focus();
        } else if (!event.shiftKey && event.target === closeRef.current) {
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
            aria-expanded={open && !!activeOption}
            aria-controls={activeOption ? listId : undefined}
            aria-activedescendant={activeOption ? optionId(activeIndex) : undefined}
            aria-describedby={`${id}-keys`}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveKey(null);
              if (resultsRef.current) resultsRef.current.scrollTop = 0;
            }}
            onKeyDown={handleSearchKey}
            placeholder="Cari tugas, alarm, kontak, berita…"
            className="min-h-11 min-w-0 flex-1 rounded-md bg-transparent px-2 text-base placeholder:text-[var(--text-secondary)] focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-[var(--accent)]"
          />
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Tutup palet perintah"
            title="Tutup (Esc)"
            className="grid size-11 shrink-0 place-items-center rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <div ref={resultsRef} className="themed-scroll min-h-0 max-h-96 overflow-y-auto overscroll-contain p-2">
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
                      className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border border-transparent px-3 py-2 text-sm aria-selected:border-[var(--border-accent)] aria-selected:bg-[var(--accent-soft)]"
                    >
                      <Icon size={16} aria-hidden="true" className="shrink-0 text-[var(--text-secondary)]" />
                      <span className="min-w-0 flex-1 truncate">{item.title}</span>
                      {item.detail && (
                        <span className="max-w-[35%] shrink-0 truncate text-xs text-[var(--text-secondary)]">{item.detail}</span>
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
