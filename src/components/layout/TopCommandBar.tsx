import { useEffect, useState } from 'react';
import { THEME_META, useTheme } from '../../theme/ThemeContext';
import type { AlarmReminderItem, BaileysStatus, MarketSessionItem, NetworkMeshState, PairedDeviceItem, ThemeId } from '../../types/llamrei';

interface Props {
  marketSessions: MarketSessionItem[];
  nextAlarm: AlarmReminderItem | null;
  device: PairedDeviceItem | null;
  network: NetworkMeshState;
  aiBudget: { monthlySpentUsd: number; monthlyCapUsd: number };
  baileysStatus?: BaileysStatus;
  onOpenCommandPalette: () => void;
  onOpenSettings: () => void;
  onOpenAlarms: () => void;
  onOpenPhoneHub: () => void;
  onOpenFocusedChat?: () => void;
  onTestAlarm: () => void;
}

export function TopCommandBar({
  marketSessions,
  nextAlarm,
  device,
  network,
  aiBudget,
  baileysStatus,
  onOpenCommandPalette,
  onOpenSettings,
  onOpenAlarms,
  onOpenPhoneHub,
  onOpenFocusedChat,
  onTestAlarm,
}: Props) {
  const { theme, setTheme } = useTheme();
  const [clock, setClock] = useState('--:--:--');

  useEffect(() => {
    const update = () => {
      setClock(
        new Intl.DateTimeFormat('id-ID', {
          timeZone: 'Asia/Jakarta',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
        }).format(new Date()),
      );
    };
    update();
    const id = window.setInterval(update, 1000);
    return () => window.clearInterval(id);
  }, []);

  const networkBadge = network.tailscale.running
    ? { label: `TAILSCALE ${network.tailscale.selfIp ?? ''}`, color: '#a855f7' }
    : network.lanUrls.length > 0
      ? { label: `LAN ${device?.latency_ms ?? 4}ms`, color: '#00d992' }
      : { label: 'LOCAL CACHE', color: '#f59e0b' };

  const nextAlarmLabel = nextAlarm
    ? `${nextAlarm.title.slice(0, 22)}${nextAlarm.title.length > 22 ? '…' : ''} · ${new Date(
        nextAlarm.snoozed_until ?? nextAlarm.trigger_at,
      ).toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit' })}`
    : 'No Armed Alarm';

  return (
    <header
      className="px-3 py-2 flex flex-wrap items-center justify-between gap-2 border-b shrink-0"
      style={{ background: 'var(--bg-topbar)', borderColor: 'var(--border-subtle)' }}
    >
      {/* Left: Brand, WIB Clock & Market Sessions */}
      <div className="flex items-center gap-2 flex-wrap">
        <div
          className="px-2 py-1 rounded text-xs font-mono-num font-bold flex items-center gap-1.5 border"
          style={{ background: 'var(--accent-soft)', color: 'var(--accent)', borderColor: 'var(--border-accent)' }}
        >
          <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: 'var(--accent)' }} />
          <span>LLAMREI // HUD</span>
        </div>

        <div
          className="px-2 py-1 rounded text-xs font-mono-num border"
          style={{ background: 'var(--bg-card)', borderColor: 'var(--border-subtle)' }}
        >
          WIB {clock}
        </div>

        <div className="hidden xl:flex items-center gap-1 text-xs font-mono-num">
          {marketSessions.map((s) => (
            <span
              key={s.id}
              title={`${s.name} (${s.wibHoursLabel})`}
              className="px-1.5 py-0.5 rounded border"
              style={
                s.isOpen
                  ? { background: 'var(--accent-soft)', color: 'var(--accent)', borderColor: 'var(--border-accent)' }
                  : { background: 'var(--bg-card)', color: 'var(--text-muted)', borderColor: 'var(--border-subtle)' }
              }
            >
              {s.name.slice(0, 3).toUpperCase()} {s.isOpen ? '●' : '○'}
            </span>
          ))}
        </div>

        {/* Next Alarm Countdown Pill */}
        <button
          onClick={onOpenAlarms}
          className="px-2 py-1 rounded text-xs font-mono-num border flex items-center gap-1.5 hover:opacity-90 transition cursor-pointer"
          style={{
            background: nextAlarm?.kind === 'hard_alarm' ? 'rgba(245,158,11,0.14)' : 'var(--bg-card)',
            borderColor: nextAlarm?.kind === 'hard_alarm' ? 'rgba(245,158,11,0.4)' : 'var(--border-subtle)',
            color: nextAlarm?.kind === 'hard_alarm' ? '#fbbf24' : 'var(--text-secondary)',
          }}
          title="Buka Kalender & Alarm Center"
        >
          <span>⏰</span>
          <span>{nextAlarmLabel}</span>
        </button>

        <button
          onClick={onTestAlarm}
          className="px-2 py-1 rounded text-xs font-mono-num border hover:opacity-90 cursor-pointer"
          style={{ background: 'var(--bg-card)', borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
          title="Simulasikan bunyi Hard Alarm sekarang"
        >
          🔔 Tes Alarm
        </button>
      </div>

      {/* Right: Ctrl+K, Phone/Tailscale Pill, Theme Switcher, Budget, Settings */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <button
          onClick={onOpenCommandPalette}
          className="px-2.5 py-1 rounded text-xs font-mono-num border flex items-center gap-2 hover:opacity-90 cursor-pointer"
          style={{ background: 'var(--bg-card)', borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
        >
          <span>⌘K Cari / Perintah</span>
        </button>

        <button
          onClick={onOpenPhoneHub}
          className="px-2 py-1 rounded text-xs font-mono-num border flex items-center gap-1.5 cursor-pointer"
          style={{ background: 'var(--bg-card)', borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
          title="Buka Phone Hub (NectarLink) & Status Tailscale"
        >
          <span>📱 {device?.battery_level ?? 84}%</span>
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: networkBadge.color }} />
          <span style={{ color: networkBadge.color }}>{networkBadge.label}</span>
        </button>

        {/* Baileys WhatsApp 1-Chat Pill */}
        <button
          onClick={onOpenFocusedChat}
          className="px-2 py-1 rounded text-xs font-mono-num border flex items-center gap-1.5 hover:opacity-90 cursor-pointer"
          style={{
            background: baileysStatus?.status === 'connected' ? 'rgba(0, 217, 146, 0.12)' : 'var(--bg-card)',
            borderColor: baileysStatus?.status === 'connected' ? 'rgba(0, 217, 146, 0.4)' : 'var(--border-subtle)',
            color: baileysStatus?.status === 'connected' ? '#00d992' : 'var(--text-secondary)',
          }}
          title={
            baileysStatus?.status === 'connected'
              ? `WhatsApp Terhubung: ${baileysStatus.userName ?? 'Aktif'} - Klik untuk Buka Focused Chat`
              : 'Buka WhatsApp / Tautkan Perangkat'
          }
        >
          <span>💬 WA</span>
          <span
            className="w-1.5 h-1.5 rounded-full"
            style={{
              background:
                baileysStatus?.status === 'connected'
                  ? '#00d992'
                  : baileysStatus?.status === 'awaiting_qr'
                    ? '#f59e0b'
                    : '#71717a',
            }}
          />
          {baileysStatus?.status === 'connected' && (baileysStatus.activeChatsCount > 0) && (
            <span className="px-1 rounded-full text-[10px] bg-emerald-500/20 text-emerald-300 font-bold">
              {baileysStatus.activeChatsCount}
            </span>
          )}
        </button>

        {/* Live 4-Theme Switcher */}
        <select
          aria-label="Theme Switcher"
          value={theme}
          onChange={(e) => setTheme(e.target.value as ThemeId)}
          className="px-2 py-1 rounded text-xs font-mono-num border outline-none cursor-pointer"
          style={{ background: 'var(--bg-card)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
        >
          {(Object.keys(THEME_META) as ThemeId[]).map((id) => (
            <option key={id} value={id} style={{ background: '#0b0d13', color: '#f2f2f2' }}>
              🎨 {THEME_META[id].short}
            </option>
          ))}
        </select>

        <span
          className="hidden sm:inline px-2 py-1 rounded text-xs font-mono-num border"
          style={{ background: 'var(--bg-card)', borderColor: 'var(--border-subtle)', color: 'var(--text-muted)' }}
          title="Pemakaian API AI Bulan Ini"
        >
          AI ${aiBudget.monthlySpentUsd.toFixed(2)}/${aiBudget.monthlyCapUsd}
        </span>

        <button
          onClick={onOpenSettings}
          className="px-2 py-1 rounded text-xs border cursor-pointer"
          style={{ background: 'var(--bg-card)', borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
          title="Pengaturan & Kunci API"
        >
          ⚙️
        </button>
      </div>
    </header>
  );
}
