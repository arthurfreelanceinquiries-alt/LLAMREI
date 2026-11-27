import { useEffect, useState } from 'react';
import { Bell, Bot, Menu, MessageCircle, PanelLeft, Search, Settings, Smartphone } from 'lucide-react';
import type { AlarmReminderItem, BaileysStatus, MarketSessionItem, PairedDeviceItem } from '../../types/llamrei';
import { Control } from '../ui/Control';

interface Props {
  marketSessions: MarketSessionItem[];
  nextAlarm: AlarmReminderItem | null;
  device: PairedDeviceItem | null;
  baileysStatus?: BaileysStatus;
  isCopilotOpen: boolean;
  isNavigationOpen: boolean;
  onToggleNavigation: () => void;
  onToggleCopilot: () => void;
  onOpenCommandPalette: () => void;
  onOpenSettings: () => void;
  onOpenAlarms: () => void;
  onOpenPhoneHub: () => void;
  onOpenFocusedChat: () => void;
}

export function TopCommandBar({
  marketSessions, nextAlarm, device, baileysStatus, isCopilotOpen, isNavigationOpen,
  onToggleNavigation, onToggleCopilot, onOpenCommandPalette, onOpenSettings,
  onOpenAlarms, onOpenPhoneHub, onOpenFocusedChat,
}: Props) {
  const [clock, setClock] = useState('');
  useEffect(() => {
    const format = new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit' });
    const update = () => setClock(format.format(new Date()));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, []);
  const openSessions = marketSessions.filter(({ isOpen }) => isOpen).map(({ name }) => name);

  const alarmTime = nextAlarm
    ? new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit' })
      .format(new Date(nextAlarm.snoozed_until ?? nextAlarm.trigger_at))
    : null;
  const whatsappConnected = baileysStatus?.status === 'connected';

  return (
    <header className="workspace-topbar">
      <div className="workspace-brand">
        <Control aria-label="Navigasi" aria-expanded={isNavigationOpen} onClick={onToggleNavigation} title="Navigasi">
          <Menu className="lg:hidden" aria-hidden="true" />
          <PanelLeft className="hidden lg:block" aria-hidden="true" />
        </Control>
        <span className="workspace-wordmark"><span aria-hidden="true" />Llamrei</span>
        <span className="hidden min-[1280px]:block text-xs font-mono-num text-[var(--text-muted)]">{clock} WIB</span>
        {openSessions.length > 0 && (
          <span className="hidden min-[1360px]:block text-xs text-[var(--text-secondary)]" title={openSessions.join(', ')}>
            {openSessions.join(' · ')}
          </span>
        )}
      </div>
      <Control className="workspace-search" aria-label="Cari dan buka perintah" aria-keyshortcuts="Control+K Meta+K" onClick={onOpenCommandPalette}>
        <Search aria-hidden="true" />
        <span>Cari di workspace</span>
        <kbd>{/Mac|iPhone|iPad/.test(navigator.platform) ? '⌘ K' : 'Ctrl K'}</kbd>
      </Control>
      <div className="workspace-actions">
        <div className="workspace-status-actions">
          <Control onClick={onOpenAlarms} title={nextAlarm ? `${nextAlarm.title} · ${alarmTime} WIB` : 'Kalender dan alarm'} aria-label={alarmTime ? `Alarm berikutnya pukul ${alarmTime} WIB` : 'Kalender dan alarm'}>
            <Bell aria-hidden="true" />
            {alarmTime && <span className="hidden xl:inline font-mono-num">{alarmTime}</span>}
          </Control>
          <Control onClick={onOpenPhoneHub} title={device?.online ? 'Perangkat terhubung' : 'Status perangkat'} aria-label={device?.online ? 'Perangkat terhubung' : 'Status perangkat'}>
            <Smartphone aria-hidden="true" />
          </Control>
          <Control onClick={onOpenFocusedChat} title={whatsappConnected ? 'WhatsApp terhubung' : 'Kotak masuk WhatsApp'} aria-label={whatsappConnected ? 'WhatsApp terhubung' : 'Kotak masuk WhatsApp'}>
            <MessageCircle aria-hidden="true" />
            {whatsappConnected && <span className="workspace-status-dot" aria-hidden="true" />}
          </Control>
        </div>
        <Control aria-label="JARVIS" aria-pressed={isCopilotOpen} aria-keyshortcuts="Control+J Meta+J" className="workspace-copilot-trigger" onClick={onToggleCopilot}>
          <Bot aria-hidden="true" /><span className="hidden sm:inline">JARVIS</span>
        </Control>
        <Control aria-label="Pengaturan" title="Pengaturan" onClick={onOpenSettings}><Settings aria-hidden="true" /></Control>
      </div>
    </header>
  );
}
