import { useEffect, useState } from 'react';
import type { ActiveTimer, AppLauncherItem, FolderItem, ListItem, NavTab, SpaceItem } from '../../types/llamrei';

interface Props {
  activeTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
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

export function LeftClickUpSidebar({
  activeTab,
  onSelectTab,
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

  useEffect(() => {
    if (!activeTimer) {
      setElapsedSec(0);
      return;
    }
    const update = () => {
      setElapsedSec(Math.max(0, Math.floor((Date.now() - Date.parse(activeTimer.started_at)) / 1000)));
    };
    update();
    const id = window.setInterval(update, 1000);
    return () => window.clearInterval(id);
  }, [activeTimer]);

  const formatDuration = (sec: number) => {
    const h = String(Math.floor(sec / 3600)).padStart(2, '0');
    const m = String(Math.floor((sec % 3600) / 60)).padStart(2, '0');
    const s = String(sec % 60).padStart(2, '0');
    return `${h}:${m}:${s}`;
  };

  const navItems: Array<{ id: NavTab; icon: string; label: string; badge?: string | number }> = [
    { id: 'morning', icon: '🌅', label: 'Ringkasan Pagi' },
    { id: 'clickup', icon: '🗂️', label: 'Manajemen Tugas', badge: openTaskCount },
    { id: 'calendar', icon: '📅', label: 'Kalender & Alarm', badge: armedAlarmCount },
    { id: 'watags', icon: '💬', label: 'Pusat WhatsApp', badge: unrepliedWaTagCount > 0 ? unrepliedWaTagCount : undefined },
    { id: 'journal', icon: '📊', label: 'Jurnal Trading' },
    { id: 'goals', icon: '🎯', label: 'Goals & Life OS' },
    { id: 'integrations', icon: '🔌', label: '150+ Apps (Composio)', badge: connectedAppsCount > 0 ? connectedAppsCount : undefined },
    { id: 'phonehub', icon: '📱', label: 'Phone Hub (HP)' },
    { id: 'scheduler', icon: '⏱️', label: 'Pesan Terjadwal', badge: pendingChatCount > 0 ? `${pendingChatCount} Wait` : undefined },
  ];

  return (
    <aside
      className="w-full lg:w-60 shrink-0 border-b lg:border-b-0 lg:border-r p-2.5 flex flex-col justify-between gap-3"
      style={{ background: 'var(--bg-panel)', borderColor: 'var(--border-subtle)' }}
    >
      <div className="space-y-3 overflow-y-auto themed-scroll">
        {/* Primary Tactical Modes */}
        <div className="space-y-1">
          <div className="text-xs font-mono-num uppercase tracking-wider px-1.5" style={{ color: 'var(--text-muted)' }}>
            Command Modes
          </div>
          {navItems.map((item) => {
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onSelectTab(item.id)}
                className="w-full text-left px-2.5 py-1.5 rounded text-xs font-medium flex items-center justify-between border transition cursor-pointer"
                style={
                  isActive
                    ? { background: 'var(--accent-soft)', color: 'var(--accent)', borderColor: 'var(--border-accent)' }
                    : { background: 'transparent', color: 'var(--text-secondary)', borderColor: 'transparent' }
                }
              >
                <span className="truncate">
                  {item.icon} {item.label}
                </span>
                {item.badge !== undefined && (
                  <span
                    className="text-xs font-mono-num px-1.5 py-0.2 rounded"
                    style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* ClickUp Hierarchy Tree */}
        <div className="pt-2 border-t space-y-1" style={{ borderColor: 'var(--border-subtle)' }}>
          <div className="flex items-center justify-between px-1.5">
            <span className="text-xs font-mono-num uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
              ClickUp Spaces
            </span>
            <button
              onClick={() => setAddingSpace((v) => !v)}
              className="text-xs font-mono-num cursor-pointer"
              style={{ color: 'var(--accent)' }}
              title="Tambah Space baru"
            >
              + Space
            </button>
          </div>

          {addingSpace && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!newSpaceName.trim()) return;
                onCreateSpace(newSpaceName.trim());
                setNewSpaceName('');
                setAddingSpace(false);
              }}
              className="flex gap-1 px-1"
            >
              <input
                value={newSpaceName}
                onChange={(e) => setNewSpaceName(e.target.value)}
                placeholder="Nama Space..."
                className="flex-1 min-w-0 px-2 py-1 rounded text-xs border outline-none"
                style={{ background: 'var(--bg-void)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
              />
              <button
                type="submit"
                className="px-2 py-1 rounded text-xs font-bold cursor-pointer"
                style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
              >
                OK
              </button>
            </form>
          )}

          <button
            onClick={() => {
              onSelectWorkspaceScope('ALL', 'ALL');
              onSelectTab('clickup');
            }}
            className="w-full text-left px-2 py-1 rounded text-xs flex items-center gap-2 cursor-pointer"
            style={{
              background: selectedSpaceId === 'ALL' && activeTab === 'clickup' ? 'var(--bg-elevated)' : 'transparent',
              color: 'var(--text-primary)',
            }}
          >
            <span className="w-2 h-2 rounded-sm" style={{ background: 'var(--accent)' }} />
            <span>Semua Space</span>
          </button>

          {spaces.map((sp) => {
            const spFolders = folders.filter((f) => f.space_id === sp.id);
            const spLists = lists.filter((l) => l.space_id === sp.id);
            return (
              <div key={sp.id} className="space-y-0.5">
                <button
                  onClick={() => {
                    onSelectWorkspaceScope(sp.id, 'ALL');
                    onSelectTab('clickup');
                  }}
                  className="w-full text-left px-2 py-1 rounded text-xs flex items-center gap-2 cursor-pointer"
                  style={{
                    background: selectedSpaceId === sp.id && selectedListId === 'ALL' ? 'var(--bg-elevated)' : 'transparent',
                    color: 'var(--text-secondary)',
                  }}
                >
                  <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: sp.color }} />
                  <span className="truncate font-medium">{sp.name}</span>
                </button>
                <div className="pl-3 space-y-0.5">
                  {spFolders.map((f) => {
                    const fLists = spLists.filter((l) => l.folder_id === f.id);
                    return (
                      <div key={f.id} className="space-y-0.5">
                        <div className="text-xs px-1.5 py-0.5 truncate" style={{ color: 'var(--text-muted)' }}>
                          📁 {f.name}
                        </div>
                        <div className="pl-3 space-y-0.5">
                          {fLists.map((l) => (
                            <button
                              key={l.id}
                              onClick={() => {
                                onSelectWorkspaceScope(sp.id, l.id);
                                onSelectTab('clickup');
                              }}
                              className="w-full text-left px-1.5 py-0.5 rounded text-xs truncate cursor-pointer"
                              style={{
                                background: selectedListId === l.id ? 'var(--bg-elevated)' : 'transparent',
                                color: selectedListId === l.id ? 'var(--accent)' : 'var(--text-muted)',
                              }}
                            >
                              └ {l.name}
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                  {spLists
                    .filter((l) => !l.folder_id)
                    .map((l) => (
                      <button
                        key={l.id}
                        onClick={() => {
                          onSelectWorkspaceScope(sp.id, l.id);
                          onSelectTab('clickup');
                        }}
                        className="w-full text-left px-1.5 py-0.5 rounded text-xs truncate cursor-pointer"
                        style={{
                          background: selectedListId === l.id ? 'var(--bg-elevated)' : 'transparent',
                          color: selectedListId === l.id ? 'var(--accent)' : 'var(--text-muted)',
                        }}
                      >
                        └ {l.name}
                      </button>
                    ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Safe App Launchers (FR-46) */}
      <div className="pt-2 border-t space-y-1" style={{ borderColor: 'var(--border-subtle)' }}>
        <div className="text-xs font-mono-num uppercase tracking-wider px-1" style={{ color: 'var(--text-muted)' }}>
          App Launcher
        </div>
        <div className="grid grid-cols-2 gap-1">
          {appLaunchers.map((a) => (
            <button
              key={a.id}
              onClick={() => onLaunchApp(a.id)}
              title={a.description ?? a.label}
              className="px-2 py-1 rounded text-xs border text-left truncate cursor-pointer hover:opacity-90"
              style={{ background: 'var(--bg-card)', borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
            >
              {a.icon} {a.label.split(' ')[0]}
            </button>
          ))}
        </div>
      </div>

      {/* Active Time Tracker & Auto-DND Status */}
      <div className="themed-card p-2.5 space-y-1">
        <div className="flex items-center justify-between text-xs font-mono-num" style={{ color: 'var(--text-muted)' }}>
          <span>⏱ DEEP WORK TIMER</span>
          {activeTimer && <span style={{ color: 'var(--accent)' }}>HP DND ●</span>}
        </div>
        {activeTimer ? (
          <>
            <div className="text-xs font-medium truncate">{activeTimer.task_title}</div>
            <div className="flex items-center justify-between pt-0.5">
              <span className="text-sm font-mono-num font-bold" style={{ color: 'var(--accent)' }}>
                {formatDuration(elapsedSec)}
              </span>
              <button
                onClick={() => onStopTimer(activeTimer.task_id)}
                className="px-2 py-0.5 rounded text-xs font-mono-num bg-rose-500/20 text-rose-400 border border-rose-500/40 cursor-pointer"
              >
                STOP
              </button>
            </div>
          </>
        ) : (
          <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Klik ▶ Timer di tugas ClickUp (otomatis nyalakan DND HP via NectarLink).
          </div>
        )}
      </div>
    </aside>
  );
}
