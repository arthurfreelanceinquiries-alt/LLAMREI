import {
  BookOpen,
  CalendarDays,
  ChartNoAxesCombined,
  ClipboardList,
  Clock3,
  Folder,
  Inbox,
  Layers3,
  LayoutDashboard,
  List,
  MessageSquare,
  Plug,
  Plus,
  Send,
  Smartphone,
  SquareArrowOutUpRight,
  Target,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import type { ActiveTimer, AppLauncherItem, FolderItem, ListItem, NavTab, SpaceItem } from '../../types/llamrei';

interface Props {
  activeTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  onNavigate?: () => void;
  spaces: SpaceItem[];
  folders: FolderItem[];
  lists: ListItem[];
  appLaunchers: AppLauncherItem[];
  selectedSpaceId: string | 'ALL';
  selectedListId: string | 'ALL';
  onSelectWorkspaceScope: (spaceId: string | 'ALL', listId: string | 'ALL') => void;
  pendingChatCount: number;
  unrepliedWaTagCount: number;
  openTaskCount: number;
  armedAlarmCount: number;
  connectedAppsCount?: number;
  activeTimer: ActiveTimer | null;
  onStopTimer: (taskId: string) => void;
  onCreateSpace: (name: string) => void;
  onLaunchApp: (launcherId: string) => void;
}

interface NavigationItem {
  id: NavTab;
  icon: LucideIcon;
  label: string;
  count?: number;
  countLabel?: string;
}

const sectionTitle = 'px-2 py-1 text-xs font-semibold text-[var(--text-secondary)]';
const row = 'flex min-h-11 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-sm transition-colors hover:bg-[var(--bg-elevated)]';
const selectedRow = 'bg-[var(--accent-soft)] text-[var(--text-primary)]';
const unselectedRow = 'text-[var(--text-secondary)]';

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return [hours, minutes, seconds % 60].map((value) => String(value).padStart(2, '0')).join(':');
}

export function LeftClickUpSidebar({
  activeTab,
  onSelectTab,
  onNavigate,
  spaces,
  folders,
  lists,
  appLaunchers,
  selectedSpaceId,
  selectedListId,
  onSelectWorkspaceScope,
  pendingChatCount,
  unrepliedWaTagCount,
  openTaskCount,
  armedAlarmCount,
  connectedAppsCount = 0,
  activeTimer,
  onStopTimer,
  onCreateSpace,
  onLaunchApp,
}: Props) {
  const [elapsedSec, setElapsedSec] = useState(0);
  const [newSpaceName, setNewSpaceName] = useState('');
  const [addingSpace, setAddingSpace] = useState(false);
  const spaceFormId = useId();
  const spaceNameRef = useRef<HTMLInputElement>(null);
  const addSpaceRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!activeTimer) return;
    const startedAt = Date.parse(activeTimer.started_at);
    const update = () => {
      setElapsedSec(Number.isFinite(startedAt) ? Math.max(0, Math.floor((Date.now() - startedAt) / 1000)) : 0);
    };
    update();
    const id = window.setInterval(update, 1000);
    return () => window.clearInterval(id);
  }, [activeTimer]);

  useEffect(() => {
    if (addingSpace) spaceNameRef.current?.focus();
  }, [addingSpace]);

  const navigate = (tab: NavTab) => {
    onSelectTab(tab);
    onNavigate?.();
  };

  const selectScope = (spaceId: string, listId: string) => {
    onSelectWorkspaceScope(spaceId, listId);
    navigate('clickup');
  };

  const groups: Array<{ title: string; items: NavigationItem[] }> = [
    {
      title: 'Ruang kerja',
      items: [
        { id: 'morning', icon: LayoutDashboard, label: 'Ringkasan Pagi' },
        { id: 'clickup', icon: ClipboardList, label: 'Manajemen Tugas', count: openTaskCount, countLabel: 'tugas terbuka' },
        { id: 'calendar', icon: CalendarDays, label: 'Kalender & Alarm', count: armedAlarmCount, countLabel: 'alarm aktif' },
        { id: 'knowledge', icon: BookOpen, label: 'Knowledge Vault' },
      ],
    },
    {
      title: 'Komunikasi',
      items: [
        { id: 'inbox', icon: Inbox, label: 'Inbox' },
        { id: 'watags', icon: MessageSquare, label: 'Pusat WhatsApp', count: unrepliedWaTagCount, countLabel: 'pesan belum dibalas' },
        { id: 'scheduler', icon: Send, label: 'Pesan Terjadwal', count: pendingChatCount, countLabel: 'pesan menunggu persetujuan' },
      ],
    },
    {
      title: 'Personal',
      items: [
        { id: 'journal', icon: ChartNoAxesCombined, label: 'Jurnal Trading' },
        { id: 'goals', icon: Target, label: 'Goals & Life OS' },
      ],
    },
    {
      title: 'Sistem',
      items: [
        { id: 'phonehub', icon: Smartphone, label: 'Phone Hub' },
        { id: 'integrations', icon: Plug, label: 'Integrasi', count: connectedAppsCount, countLabel: 'aplikasi terhubung' },
      ],
    },
  ];

  const renderScopeList = (list: ListItem) => {
    const current = activeTab === 'clickup' && selectedListId === list.id;
    return (
      <li key={list.id}>
        <button
          type="button"
          aria-current={current ? 'true' : undefined}
          className={`${row} ${current ? selectedRow : unselectedRow}`}
          onClick={() => selectScope(list.space_id, list.id)}
        >
          <List aria-hidden="true" className="size-4 shrink-0 opacity-75" strokeWidth={1.75} />
          <span className="min-w-0 truncate" title={list.name}>{list.name}</span>
        </button>
      </li>
    );
  };

  const allSpacesCurrent = activeTab === 'clickup' && selectedSpaceId === 'ALL' && selectedListId === 'ALL';

  return (
    <aside
      aria-label="Bilah sisi"
      className="flex h-full min-h-0 w-full flex-col bg-[var(--bg-panel)] text-[var(--text-primary)]"
    >
      <div className="themed-scroll flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto overscroll-contain p-3">
        <nav aria-label="Navigasi utama" className="space-y-3">
          {groups.map(({ title, items }) => (
            <div key={title}>
              <h2 className={sectionTitle}>{title}</h2>
              <ul>
                {items.map(({ id, icon: Icon, label, count, countLabel }) => {
                  const current = activeTab === id;
                  return (
                    <li key={id}>
                      <button
                        type="button"
                        aria-current={current ? 'page' : undefined}
                        onClick={() => navigate(id)}
                        className={`${row} border ${current ? `${selectedRow} border-[var(--border-accent)] font-semibold` : `${unselectedRow} border-transparent font-medium`}`}
                      >
                        <Icon aria-hidden="true" strokeWidth={1.75} className={`size-[18px] shrink-0 ${current ? 'text-[var(--accent)]' : ''}`} />
                        <span className="min-w-0 flex-1 truncate">{label}</span>
                        {count !== undefined && count > 0 && (
                          <span className="font-mono-num shrink-0 rounded-md bg-[var(--bg-elevated)] px-1.5 py-0.5 text-xs text-[var(--text-secondary)]">
                            {count}<span className="sr-only"> {countLabel}</span>
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <nav aria-label="Ruang dan daftar tugas" className="border-t border-[var(--border-subtle)] pt-2">
          <div className="flex items-center justify-between">
            <h2 className={sectionTitle}>Space</h2>
            <button
              ref={addSpaceRef}
              type="button"
              aria-expanded={addingSpace}
              aria-controls={spaceFormId}
              aria-label="Tambah Space"
              onClick={() => setAddingSpace(!addingSpace)}
              className="grid size-11 shrink-0 place-items-center rounded-lg text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]"
            >
              <Plus aria-hidden="true" className="size-[18px]" strokeWidth={1.75} />
            </button>
          </div>
          <form
            id={spaceFormId}
            hidden={!addingSpace}
            onSubmit={(event) => {
              event.preventDefault();
              const name = newSpaceName.trim();
              if (!name) return;
              onCreateSpace(name);
              setNewSpaceName('');
              setAddingSpace(false);
              addSpaceRef.current?.focus();
            }}
          >
            <div className="mb-2 flex gap-2">
              <input
                ref={spaceNameRef}
                aria-label="Nama Space"
                value={newSpaceName}
                onChange={(event) => setNewSpaceName(event.currentTarget.value)}
                placeholder="Nama Space"
                className="min-h-11 min-w-0 flex-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-void)] px-2.5 text-base text-[var(--text-primary)] lg:text-sm"
              />
              <button
                type="submit"
                disabled={!newSpaceName.trim()}
                className="min-h-11 rounded-lg bg-[var(--accent)] px-2.5 text-sm font-semibold text-[var(--accent-fg)] disabled:opacity-50"
              >
                Buat
              </button>
            </div>
          </form>
          <ul>
            <li>
              <button
                type="button"
                aria-current={allSpacesCurrent ? 'true' : undefined}
                onClick={() => selectScope('ALL', 'ALL')}
                className={`${row} ${allSpacesCurrent ? selectedRow : unselectedRow}`}
              >
                <Layers3 aria-hidden="true" className="size-4 shrink-0" strokeWidth={1.75} />
                Semua Space
              </button>
            </li>
            {spaces.map((space) => {
              const spaceFolders = folders.filter((folder) => folder.space_id === space.id);
              const spaceLists = lists.filter((list) => list.space_id === space.id);
              const current = activeTab === 'clickup' && selectedSpaceId === space.id && selectedListId === 'ALL';
              return (
                <li key={space.id}>
                  <button
                    type="button"
                    aria-current={current ? 'true' : undefined}
                    onClick={() => selectScope(space.id, 'ALL')}
                    className={`${row} ${current ? selectedRow : unselectedRow} font-medium`}
                  >
                    <span aria-hidden="true" className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: space.color }} />
                    <span className="min-w-0 truncate" title={space.name}>{space.name}</span>
                  </button>
                  {(spaceFolders.length > 0 || spaceLists.length > 0) && (
                    <ul className="ml-3 border-l border-[var(--border-subtle)] pl-1">
                      {spaceFolders.map((folder) => (
                        <li key={folder.id}>
                          <div className="flex items-center gap-2 px-2.5 py-2 text-xs text-[var(--text-secondary)]">
                            <Folder aria-hidden="true" className="size-4 shrink-0" strokeWidth={1.75} />
                            <span className="min-w-0 truncate" title={folder.name}>{folder.name}</span>
                          </div>
                          <ul className="ml-2">{spaceLists.filter((list) => list.folder_id === folder.id).map(renderScopeList)}</ul>
                        </li>
                      ))}
                      {spaceLists.filter((list) => !list.folder_id).map(renderScopeList)}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </nav>

        {appLaunchers.length > 0 && (
          <section aria-label="Peluncur aplikasi" className="border-t border-[var(--border-subtle)] pt-3">
            <h2 className={sectionTitle}>Peluncur aplikasi</h2>
            <ul>
              {appLaunchers.map((launcher) => (
                <li key={launcher.id}>
                  <button
                    type="button"
                    onClick={() => onLaunchApp(launcher.id)}
                    title={launcher.description ?? launcher.label}
                    className={`${row} ${unselectedRow}`}
                  >
                    <SquareArrowOutUpRight aria-hidden="true" className="size-4 shrink-0" strokeWidth={1.75} />
                    <span className="min-w-0 truncate">{launcher.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      {activeTimer && (
        <section aria-label="Timer fokus" className="shrink-0 border-t border-[var(--border-subtle)] p-3">
          <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-3">
            <h2 className="flex items-center gap-2 text-xs font-semibold text-[var(--text-secondary)]">
              <Clock3 aria-hidden="true" className="size-4" strokeWidth={1.75} />
              Timer fokus
            </h2>
            <p className="mt-2 truncate text-sm font-medium" title={activeTimer.task_title}>{activeTimer.task_title}</p>
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono-num text-base tabular-nums">{formatDuration(elapsedSec)}</span>
              <button
                type="button"
                onClick={() => onStopTimer(activeTimer.task_id)}
                className="min-h-11 rounded-lg px-2 text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]"
              >
                Hentikan
              </button>
            </div>
          </div>
        </section>
      )}
    </aside>
  );
}
