import { useEffect, useState } from 'react';
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
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  if (!open) return null;

  const q = query.trim().toLowerCase();
  const matchedTasks = tasks.filter((t) => t.title.toLowerCase().includes(q)).slice(0, 5);
  const matchedAlarms = alarms.filter((a) => a.title.toLowerCase().includes(q)).slice(0, 3);
  const matchedContacts = contacts.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 3);
  const matchedNews = news.filter((n) => n.title.toLowerCase().includes(q)).slice(0, 3);

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-start justify-center pt-20 p-4" onClick={onClose}>
      <div
        className="w-full max-w-xl rounded-xl border shadow-2xl overflow-hidden"
        style={{ background: 'var(--bg-panel)', borderColor: 'var(--border-accent)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-3 border-b flex items-center gap-2" style={{ borderColor: 'var(--border-subtle)' }}>
          <span className="font-mono-num text-xs" style={{ color: 'var(--accent)' }}>
            ⌘K
          </span>
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Cari tugas ClickUp, alarm, kontak, berita, atau ketik perintah ke Llamrei..."
            className="flex-1 bg-transparent text-sm outline-none"
          />
          <button onClick={onClose} className="text-xs px-2 py-0.5 rounded bg-white/5 cursor-pointer">
            ESC
          </button>
        </div>

        <div className="max-h-96 overflow-y-auto themed-scroll p-2 space-y-2 text-xs">
          {query.trim() && (
            <button
              onClick={() => {
                onAskLlamrei(query.trim());
                onClose();
              }}
              className="w-full text-left p-2 rounded-lg border flex items-center justify-between cursor-pointer"
              style={{ background: 'var(--accent-soft)', borderColor: 'var(--border-accent)', color: 'var(--accent)' }}
            >
              <span>🤖 Jalankan perintah di Llamrei: "{query.trim()}"</span>
              <span className="font-mono-num">ENTER ↵</span>
            </button>
          )}

          {matchedTasks.length > 0 && (
            <div className="space-y-1">
              <div className="px-2 font-mono-num" style={{ color: 'var(--text-muted)' }}>
                TUGAS CLICKUP
              </div>
              {matchedTasks.map((t) => (
                <button
                  key={t.id}
                  onClick={() => {
                    onSelectTask(t);
                    onNavigateTab('clickup');
                    onClose();
                  }}
                  className="w-full text-left px-2.5 py-1.5 rounded hover:bg-white/5 flex items-center justify-between cursor-pointer"
                >
                  <span className="truncate">{t.title}</span>
                  <span className="font-mono-num" style={{ color: 'var(--text-muted)' }}>
                    {t.status}
                  </span>
                </button>
              ))}
            </div>
          )}

          {matchedAlarms.length > 0 && (
            <div className="space-y-1">
              <div className="px-2 font-mono-num" style={{ color: 'var(--text-muted)' }}>
                ALARM & REMINDER
              </div>
              {matchedAlarms.map((a) => (
                <button
                  key={a.id}
                  onClick={() => {
                    onNavigateTab('calendar');
                    onClose();
                  }}
                  className="w-full text-left px-2.5 py-1.5 rounded hover:bg-white/5 flex items-center justify-between cursor-pointer"
                >
                  <span>
                    {a.kind === 'hard_alarm' ? '⏰' : '🔔'} {a.title}
                  </span>
                  <span className="font-mono-num" style={{ color: 'var(--text-muted)' }}>
                    {a.status}
                  </span>
                </button>
              ))}
            </div>
          )}

          {matchedContacts.length > 0 && (
            <div className="space-y-1">
              <div className="px-2 font-mono-num" style={{ color: 'var(--text-muted)' }}>
                KONTAK CHAT
              </div>
              {matchedContacts.map((c) => (
                <button
                  key={c.id}
                  onClick={() => {
                    onAskLlamrei(`Jadwalkan chat ke ${c.name} jam 19:00 soal `);
                    onClose();
                  }}
                  className="w-full text-left px-2.5 py-1.5 rounded hover:bg-white/5 flex items-center justify-between cursor-pointer"
                >
                  <span>💬 Jadwalkan chat ke {c.name}</span>
                  <span className="font-mono-num" style={{ color: 'var(--text-muted)' }}>
                    {c.phone_e164}
                  </span>
                </button>
              ))}
            </div>
          )}

          {matchedNews.length > 0 && (
            <div className="space-y-1">
              <div className="px-2 font-mono-num" style={{ color: 'var(--text-muted)' }}>
                BERITA PASAR & AI
              </div>
              {matchedNews.map((n) => (
                <button
                  key={n.id}
                  onClick={() => {
                    onAskLlamrei(`Ringkas berita ini: ${n.title}`);
                    onClose();
                  }}
                  className="w-full text-left px-2.5 py-1.5 rounded hover:bg-white/5 truncate cursor-pointer"
                >
                  📰 {n.title}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
