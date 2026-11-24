import { useEffect, useState } from 'react';
import type {
  AlarmReminderItem,
  BaileysStatus,
  MarketSessionItem,
  NetworkMeshState,
  PairedDeviceItem,
} from '../../types/llamrei';

interface Props {
  marketSessions: MarketSessionItem[];
  nextAlarm: AlarmReminderItem | null;
  device: PairedDeviceItem | null;
  network: NetworkMeshState;
  aiBudget: { monthlySpentUsd: number; monthlyCapUsd: number };
  baileysStatus?: BaileysStatus;
  isCopilotOpen?: boolean;
  onToggleCopilot?: () => void;
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
  isCopilotOpen = false,
  onToggleCopilot,
  onOpenCommandPalette,
  onOpenSettings,
  onOpenAlarms,
  onOpenPhoneHub,
  onOpenFocusedChat,
}: Props) {
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
    ? { label: `TAILSCALE ${network.tailscale.selfIp ? network.tailscale.selfIp.split('.').slice(0, 2).join('.') + '…' : ''}`, color: '#a855f7' }
    : network.lanUrls.length > 0
      ? { label: `LAN ${device?.latency_ms ?? 3}ms`, color: '#00d992' }
      : { label: 'OFFLINE', color: '#f59e0b' };

  const nextAlarmLabel = nextAlarm
    ? `${nextAlarm.title.slice(0, 18)}${nextAlarm.title.length > 18 ? '…' : ''} · ${new Date(
        nextAlarm.snoozed_until ?? nextAlarm.trigger_at,
      ).toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit' })}`
    : 'No Alarm';

  // Active market sessions summary
  const openSessions = marketSessions.filter((s) => s.isOpen).map((s) => s.name.slice(0, 3).toUpperCase());

  return (
    <header
      className="h-13 px-3.5 flex items-center justify-between border-b shrink-0 z-20 backdrop-blur-md"
      style={{
        background: 'var(--bg-topbar)',
        borderColor: 'var(--border-subtle)',
      }}
    >
      {/* LEFT SECTION: Logo Brand, WIB Time & Next Alarm */}
      <div className="flex items-center gap-2.5 min-w-0">
        <div className="flex items-center gap-2 font-bold tracking-tight text-sm">
          <span
            className="w-2 h-2 rounded-full ring-2 ring-emerald-500/30 animate-pulse"
            style={{ background: 'var(--accent)' }}
          />
          <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>
            LLAMREI
          </span>
          <span
            className="text-[10px] uppercase font-mono-num px-1.5 py-0.5 rounded tracking-widest font-semibold"
            style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
          >
            OS
          </span>
        </div>

        <div className="h-4 w-[1px] bg-white/10 hidden sm:block" />

        <div
          className="text-xs font-mono-num hidden sm:flex items-center gap-1.5"
          style={{ color: 'var(--text-secondary)' }}
          title="Waktu Indonesia Barat (UTC+7)"
        >
          <span className="text-[10px] font-semibold text-white/40">WIB</span>
          <span>{clock}</span>
        </div>

        {openSessions.length > 0 && (
          <div
            className="hidden xl:flex items-center gap-1 text-[11px] font-mono-num px-2 py-0.5 rounded border border-white/5"
            style={{ background: 'var(--bg-card)', color: 'var(--accent)' }}
            title={`Sesi pasar aktif: ${openSessions.join(', ')}`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            <span>{openSessions.join(' · ')}</span>
          </div>
        )}

        {/* Compact Next Alarm Pill */}
        <button
          onClick={onOpenAlarms}
          className="px-2 py-1 rounded-lg text-xs font-medium border flex items-center gap-1.5 hover:bg-white/5 transition cursor-pointer"
          style={{
            background: nextAlarm?.kind === 'hard_alarm' ? 'rgba(245,158,11,0.1)' : 'var(--bg-card)',
            borderColor: nextAlarm?.kind === 'hard_alarm' ? 'rgba(245,158,11,0.35)' : 'var(--border-subtle)',
            color: nextAlarm?.kind === 'hard_alarm' ? '#fbbf24' : 'var(--text-secondary)',
          }}
          title="Buka Kalender & Pengaturan Alarm"
        >
          <span className="text-xs">⏰</span>
          <span className="font-mono-num truncate max-w-[150px]">{nextAlarmLabel}</span>
        </button>
      </div>

      {/* CENTER SECTION: Quick Search Trigger (⌘K) */}
      <div className="flex-1 max-w-md mx-3 hidden md:block">
        <button
          onClick={onOpenCommandPalette}
          className="w-full h-8 px-3 rounded-lg text-xs border flex items-center justify-between text-left hover:border-white/20 transition cursor-pointer shadow-xs"
          style={{
            background: 'var(--bg-card)',
            borderColor: 'var(--border-subtle)',
            color: 'var(--text-muted)',
          }}
        >
          <div className="flex items-center gap-2">
            <svg className="w-3.5 h-3.5 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <span>Cari tugas, kalender, kontak, atau perintah...</span>
          </div>
          <kbd className="px-1.5 py-0.5 text-[10px] font-mono-num rounded bg-white/5 border border-white/10 text-white/50">
            ⌘K
          </kbd>
        </button>
      </div>

      {/* RIGHT SECTION: Quick Status Badges, Copilot Toggle & Settings */}
      <div className="flex items-center gap-2">
        {/* WhatsApp Hub Pill */}
        <button
          onClick={onOpenFocusedChat}
          className="h-8 px-2.5 rounded-lg text-xs font-medium border flex items-center gap-1.5 hover:bg-white/5 transition cursor-pointer"
          style={{
            background: baileysStatus?.status === 'connected' ? 'rgba(0, 217, 146, 0.08)' : 'var(--bg-card)',
            borderColor: baileysStatus?.status === 'connected' ? 'rgba(0, 217, 146, 0.3)' : 'var(--border-subtle)',
            color: baileysStatus?.status === 'connected' ? '#00d992' : 'var(--text-secondary)',
          }}
          title={
            baileysStatus?.status === 'connected'
              ? `WhatsApp Aktif: ${baileysStatus.userName ?? 'Terkoneksi'}`
              : 'Status WhatsApp & Hub obrolan'
          }
        >
          <span>💬</span>
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
          <span className="hidden sm:inline font-mono-num">
            {baileysStatus?.status === 'connected'
              ? 'WA Aktif'
              : baileysStatus?.status === 'awaiting_qr'
                ? 'Scan QR'
                : 'WA'}
          </span>
          {baileysStatus?.status === 'connected' && baileysStatus.activeChatsCount > 0 && (
            <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-emerald-500/20 text-emerald-300 font-bold font-mono-num">
              {baileysStatus.activeChatsCount}
            </span>
          )}
        </button>

        {/* Device & Network Hub */}
        <button
          onClick={onOpenPhoneHub}
          className="h-8 px-2.5 rounded-lg text-xs font-medium border hidden sm:flex items-center gap-1.5 hover:bg-white/5 transition cursor-pointer"
          style={{
            background: 'var(--bg-card)',
            borderColor: 'var(--border-subtle)',
            color: 'var(--text-secondary)',
          }}
          title="Phone Hub & Status Jaringan"
        >
          <span>📱 {device?.battery_level ?? 84}%</span>
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: networkBadge.color }} />
          <span className="font-mono-num text-[11px]" style={{ color: networkBadge.color }}>
            {networkBadge.label}
          </span>
        </button>

        {/* Co-Commander Drawer Toggle Button */}
        {onToggleCopilot && (
          <button
            onClick={onToggleCopilot}
            className="h-8 px-2.5 rounded-lg text-xs font-semibold border flex items-center gap-1.5 transition cursor-pointer shadow-xs"
            style={
              isCopilotOpen
                ? {
                    background: 'var(--accent)',
                    color: 'var(--accent-fg)',
                    borderColor: 'var(--accent)',
                  }
                : {
                    background: 'var(--bg-card)',
                    color: 'var(--accent)',
                    borderColor: 'var(--border-accent)',
                  }
            }
            title="Buka / Tutup Panel Llamrei Co-Commander (⌘J)"
          >
            <span>✨</span>
            <span className="hidden md:inline">Llamrei</span>
            <span
              className="text-[10px] font-mono-num px-1 rounded"
              style={{
                background: isCopilotOpen ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.08)',
              }}
            >
              ⌘J
            </span>
          </button>
        )}

        {/* Settings Button */}
        <button
          onClick={onOpenSettings}
          className="h-8 w-8 rounded-lg border flex items-center justify-center hover:bg-white/5 transition cursor-pointer"
          style={{
            background: 'var(--bg-card)',
            borderColor: 'var(--border-subtle)',
            color: 'var(--text-secondary)',
          }}
          title={`Pengaturan Sistem · Kuota AI: $${aiBudget.monthlySpentUsd.toFixed(2)} / $${aiBudget.monthlyCapUsd.toFixed(2)}`}
        >
          ⚙️
        </button>
      </div>
    </header>
  );
}
