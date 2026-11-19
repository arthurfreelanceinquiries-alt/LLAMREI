import { useEffect, useState } from 'react';
import {
  clearOfflineOutbox,
  enqueueOfflineMutation,
  getOfflineOutbox,
  loadWidgetSnapshotCache,
  saveWidgetSnapshotCache,
  type OfflineMutation,
} from '../../lib/offline-sync';
import type {
  AlarmReminderItem,
  NetworkMeshState,
  PairedDeviceItem,
  PhoneNotificationItem,
  TaskItem,
  TimelineItem,
} from '../../types/llamrei';

interface Props {
  apiConfigured: boolean;
  devices: PairedDeviceItem[];
  notifications: PhoneNotificationItem[];
  timeline: TimelineItem[];
  network: NetworkMeshState;
  tasks: TaskItem[];
  alarms: AlarmReminderItem[];
  onSyncNectarLink: () => Promise<void>;
  onRingPhone: () => Promise<void>;
  onMirrorScreen: (deviceId: string) => Promise<{ note: string }>;
  onSendFileOrLink: (payload: { url?: string; text?: string; paths?: string[] }) => Promise<void>;
  onSendClipboard: (text: string) => Promise<void>;
  onCameraCapture: (mode: 'photo' | 'scan') => Promise<{ artifactLabel: string }>;
  onToggleControl: (deviceId: string, toggle: string, enabled: boolean) => Promise<void>;
  onReplyNotification: (notifId: string, replyText: string) => Promise<void>;
  onDismissNotification: (notifId: string) => Promise<void>;
  onSimulateIncomingWa: (sender: string, group: string, body: string) => Promise<void>;
  onCreateTaskFromWaNotif: (notif: PhoneNotificationItem) => Promise<void>;
  onConnectTailscalePeer: (deviceId: string, ip: string) => Promise<{ message: string }>;
  onReconcileMobileOutbox: (mutations: OfflineMutation[]) => Promise<void>;
  onToggleTaskDone: (task: TaskItem) => Promise<void>;
  onSnoozeAlarm: (alarmId: string, minutes: number) => Promise<void>;
  onDismissAlarm: (alarmId: string) => Promise<void>;
}

export function PhoneHubView({
  apiConfigured,
  devices,
  notifications,
  timeline,
  network,
  tasks,
  alarms,
  onSyncNectarLink,
  onRingPhone,
  onMirrorScreen,
  onSendFileOrLink,
  onSendClipboard,
  onCameraCapture,
  onToggleControl,
  onReplyNotification,
  onDismissNotification,
  onSimulateIncomingWa,
  onCreateTaskFromWaNotif,
  onConnectTailscalePeer,
  onReconcileMobileOutbox,
  onToggleTaskDone,
  onSnoozeAlarm,
  onDismissAlarm,
}: Props) {
  const device = devices[0] ?? null;
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [typeOnPhoneText, setTypeOnPhoneText] = useState('');
  const [clipText, setClipText] = useState('');
  const [sendUrlText, setSendUrlText] = useState('');
  const [statusBanner, setStatusBanner] = useState<string | null>(null);
  const [tsIpInput, setTsIpInput] = useState(device?.tailscale_ip ?? network.tailscale.peers[0]?.tailscaleIp ?? '100.64.0.22');
  const simSender = 'Koordinator Riset';
  const [simBody, setSimBody] = useState('@Arthur tolong cek data CPI sebelum jam 19:00 ya!');

  // Offline simulation state for the 4 Android Home Screen Widgets
  const [offlineSim, setOfflineSim] = useState(false);
  const [outbox, setOutbox] = useState<OfflineMutation[]>(() => getOfflineOutbox());
  const [cachedTasks, setCachedTasks] = useState<TaskItem[]>(tasks);
  const [cachedAlarms, setCachedAlarms] = useState<AlarmReminderItem[]>(alarms);

  useEffect(() => {
    if (!offlineSim) {
      setCachedTasks(tasks);
      setCachedAlarms(alarms);
      saveWidgetSnapshotCache({ tasks, alarms });
    } else {
      const cached = loadWidgetSnapshotCache<{ tasks: TaskItem[]; alarms: AlarmReminderItem[] }>();
      if (cached) {
        setCachedTasks(cached.tasks);
        setCachedAlarms(cached.alarms);
      }
    }
  }, [offlineSim, tasks, alarms]);

  const handleWidgetTaskToggle = async (t: TaskItem) => {
    if (offlineSim) {
      const nextStatus = t.status === 'Done' ? 'To Do' : 'Done';
      setCachedTasks((prev) => prev.map((x) => (x.id === t.id ? { ...x, status: nextStatus } : x)));
      const q = enqueueOfflineMutation({
        deviceId: device?.id ?? 'android_widget',
        actionType: 'task_toggle_done',
        targetId: t.id,
        payload: { done: nextStatus === 'Done' },
      });
      setOutbox(q);
      setStatusBanner(`Offline Cache: Tugas "${t.title}" masuk antrean Outbox (${q.length} tertunda).`);
    } else {
      await onToggleTaskDone(t);
    }
  };

  const handleWidgetAlarmAction = async (alarmId: string, action: 'snooze' | 'dismiss') => {
    if (offlineSim) {
      setCachedAlarms((prev) =>
        prev.map((a) => (a.id === alarmId ? { ...a, status: action === 'dismiss' ? 'dismissed' : 'snoozed' } : a)),
      );
      const q = enqueueOfflineMutation({
        deviceId: device?.id ?? 'android_widget',
        actionType: action === 'dismiss' ? 'alarm_dismiss' : 'alarm_snooze',
        targetId: alarmId,
        payload: action === 'snooze' ? { minutes: 10 } : {},
      });
      setOutbox(q);
      setStatusBanner(`Offline Cache: Aksi alarm (${action}) disimpan di Outbox (${q.length} tertunda).`);
    } else if (action === 'dismiss') {
      await onDismissAlarm(alarmId);
    } else {
      await onSnoozeAlarm(alarmId, 10);
    }
  };

  const handleReconnectAndSync = async () => {
    setOfflineSim(false);
    const pending = getOfflineOutbox();
    if (pending.length > 0) {
      await onReconcileMobileOutbox(pending);
      clearOfflineOutbox();
      setOutbox([]);
      setStatusBanner(`Auto-Reconcile sukses: ${pending.length} aksi offline dari Widget HP disinkronkan ke SQLite!`);
    }
  };

  const widgetTasks = cachedTasks.filter((t) => !t.parent_task_id).slice(0, 4);
  const widgetAlarms = cachedAlarms.filter((a) => a.kind === 'hard_alarm');
  const nextWidgetAlarm = widgetAlarms[0] ?? null;
  const widgetReminders = cachedAlarms.filter((a) => a.kind === 'soft_reminder').slice(0, 3);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
        <div>
          <div className="text-xs font-mono-num" style={{ color: 'var(--accent)' }}>
            PHONE HUB // NECTARLINK BRIDGE + TAILSCALE MESH + 4 ANDROID WIDGETS
          </div>
          <h1 className="text-sm font-bold">Kontrol HP Tanpa USB Debugging, Direct Reply WA & Widget Home Screen</h1>
        </div>
        <button
          onClick={() => void onSyncNectarLink()}
          className="px-2.5 py-1 rounded text-xs font-mono-num border cursor-pointer"
          style={{ background: 'var(--bg-card)', borderColor: 'var(--border-subtle)', color: 'var(--accent)' }}
        >
          ↻ Poll NectarLink (127.0.0.1:53320)
        </button>
      </div>

      {statusBanner && (
        <div
          className="px-3 py-2 rounded text-xs font-mono-num border flex items-center justify-between"
          style={{ background: 'var(--accent-soft)', borderColor: 'var(--border-accent)', color: 'var(--accent)' }}
        >
          <span>{statusBanner}</span>
          <button onClick={() => setStatusBanner(null)} className="ml-2 font-bold cursor-pointer">
            ✕
          </button>
        </div>
      )}

      {/* SECTION 1: NECTARLINK DESKTOP HOME LAYOUT */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-3">
        {/* Left/Main 8 cols */}
        <div className="xl:col-span-8 space-y-3">
          {/* Device Card + Media Player */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
            <div className="themed-card p-3 flex items-center gap-3">
              <div
                className="w-14 h-24 rounded-lg border-2 flex flex-col items-center justify-center font-mono-num shrink-0"
                style={{ borderColor: 'var(--accent)', background: 'rgba(0,217,146,0.08)' }}
              >
                <span className="text-base font-bold" style={{ color: 'var(--accent)' }}>
                  {device?.battery_level ?? 84}%
                </span>
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  {device?.battery_charging ? '⚡CHG' : 'BAT'}
                </span>
              </div>
              <div className="space-y-1 min-w-0">
                <div className="text-sm font-bold truncate">{device?.name ?? 'Infinix NOTE 30 Pro'}</div>
                <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                  {device?.android_version ?? 'Android 14'} ·{' '}
                  <span style={{ color: apiConfigured ? 'var(--accent)' : '#fbbf24' }}>
                    {apiConfigured ? 'NectarLink API Active' : 'Standby Bridge Mode'}
                  </span>
                </div>
                <div className="text-xs font-mono-num" style={{ color: 'var(--accent-2)' }}>
                  📶 {device?.active_transport?.toUpperCase() ?? 'LAN'} · {device?.latency_ms ?? 4} ms
                </div>
              </div>
            </div>

            <div className="themed-card p-3 flex flex-col justify-between">
              <div className="text-xs font-mono-num" style={{ color: 'var(--text-muted)' }}>
                MEDIA PLAYER SYNC
              </div>
              <div>
                <div className="text-sm font-semibold truncate">{device?.media_title ?? 'Lofi Focus Beats'}</div>
                <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                  {device?.media_artist ?? 'ChilledCow'}
                </div>
              </div>
              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={() =>
                    device && void onToggleControl(device.id, 'play_on_phone', device.play_on_phone !== 1)
                  }
                  className="px-2.5 py-1 rounded text-xs font-mono-num border cursor-pointer"
                  style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' }}
                >
                  {device?.play_on_phone ? '⏸ Pause on Phone' : '▶ Play on Phone'}
                </button>
              </div>
            </div>
          </div>

          {/* 4 Quick Action Tiles (Mirror Screen, Send Files, Send Clipboard, Find Phone) */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <button
              onClick={async () => {
                const res = await onMirrorScreen(device?.id ?? 'dev_infinix_note30');
                setStatusBanner(res.note);
              }}
              className="themed-card p-3 text-left hover:border-white/30 space-y-1 cursor-pointer"
            >
              <div className="text-base">📲</div>
              <div className="text-xs font-bold">Mirror Screen</div>
              <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                60fps Tanpa Dev Mode
              </div>
            </button>

            <button
              onClick={async () => {
                const url = sendUrlText.trim() || window.location.href;
                await onSendFileOrLink({ url, text: 'Link dari Llamrei Desktop' });
                setStatusBanner(`Terkirim ke HP via NectarLink: ${url}`);
              }}
              className="themed-card p-3 text-left hover:border-white/30 space-y-1 cursor-pointer"
            >
              <div className="text-base">📤</div>
              <div className="text-xs font-bold">Send Files / Link</div>
              <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                LocalSend v2.1 Wi-Fi
              </div>
            </button>

            <button
              onClick={async () => {
                const txt = clipText.trim() || 'Clipboard test dari Llamrei';
                await onSendClipboard(txt);
                setStatusBanner(`Clipboard disinkronkan ke HP: "${txt}"`);
              }}
              className="themed-card p-3 text-left hover:border-white/30 space-y-1 cursor-pointer"
            >
              <div className="text-base">📋</div>
              <div className="text-xs font-bold">Send Clipboard</div>
              <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                Copy PC → Paste HP
              </div>
            </button>

            <button
              onClick={async () => {
                await onRingPhone();
                setStatusBanner('Sinyal Find Phone (Ring) dikirim ke HP!');
              }}
              className="themed-card p-3 text-left hover:border-white/30 space-y-1 cursor-pointer"
            >
              <div className="text-base">🔔</div>
              <div className="text-xs font-bold">Find Phone</div>
              <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                Bunyikan HP Sekarang
              </div>
            </button>
          </div>

          {/* Quick Send Inputs */}
          <div className="themed-card p-2.5 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
            <input
              value={clipText}
              onChange={(e) => setClipText(e.target.value)}
              placeholder="Teks untuk Send Clipboard..."
              className="px-2 py-1 rounded border outline-none"
              style={{ background: 'var(--bg-void)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
            />
            <input
              value={sendUrlText}
              onChange={(e) => setSendUrlText(e.target.value)}
              placeholder="URL / path file untuk Send to Phone..."
              className="px-2 py-1 rounded border outline-none"
              style={{ background: 'var(--bg-void)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
            />
          </div>

          {/* Live Notifications & Direct WA Reply */}
          <div className="themed-card p-3 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-mono-num font-bold" style={{ color: 'var(--text-secondary)' }}>
                🔔 LIVE NOTIFICATIONS & WHATSAPP DIRECT REPLY ({notifications.length})
              </span>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void onSimulateIncomingWa(simSender, 'Grup Riset Trading', simBody);
                }}
                className="flex gap-1 text-xs"
              >
                <input
                  value={simBody}
                  onChange={(e) => setSimBody(e.target.value)}
                  className="px-2 py-0.5 rounded border w-44 outline-none"
                  style={{ background: 'var(--bg-void)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
                />
                <button type="submit" className="px-2 py-0.5 rounded border cursor-pointer" style={{ borderColor: 'var(--border-subtle)' }}>
                  + Uji Notif WA
                </button>
              </form>
            </div>

            <div className="space-y-2 max-h-64 overflow-y-auto themed-scroll pr-1">
              {notifications.map((n) => (
                <div key={n.id} className="p-2.5 rounded bg-black/25 border space-y-1.5 text-xs" style={{ borderColor: 'var(--border-subtle)' }}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-semibold">
                      <span className="font-mono-num mr-1.5" style={{ color: 'var(--accent)' }}>
                        [{n.app_name}]
                      </span>
                      {n.sender_or_title}
                      {n.conversation_group && (
                        <span className="ml-1.5 font-normal" style={{ color: 'var(--text-muted)' }}>
                          di {n.conversation_group}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5">
                      {n.is_mention_tag === 1 && (
                        <span className="px-1.5 py-0.2 rounded font-mono-num bg-amber-500/20 text-amber-300">
                          TAG · {n.ai_intent ?? 'mention'}
                        </span>
                      )}
                      {n.otp_code && (
                        <button
                          onClick={() => {
                            void navigator.clipboard?.writeText(n.otp_code!);
                            setStatusBanner(`OTP ${n.otp_code} disalin ke clipboard!`);
                          }}
                          className="px-1.5 py-0.2 rounded font-mono-num bg-cyan-500/20 text-cyan-300 cursor-pointer"
                        >
                          Salin OTP {n.otp_code}
                        </button>
                      )}
                      <button
                        onClick={() => void onDismissNotification(n.id)}
                        className="px-1.5 py-0.2 rounded bg-white/5 cursor-pointer"
                      >
                        ✕
                      </button>
                    </div>
                  </div>

                  <div style={{ color: 'var(--text-secondary)' }}>{n.body_text}</div>

                  {n.replied_text && (
                    <div className="text-xs font-mono-num" style={{ color: 'var(--accent)' }}>
                      ✓ Dibalas dari PC: "{n.replied_text}"
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    {n.can_reply === 1 && (
                      <>
                        <input
                          value={replyDrafts[n.id] ?? ''}
                          onChange={(e) => setReplyDrafts((prev) => ({ ...prev, [n.id]: e.target.value }))}
                          placeholder="Balas WA langsung dari PC..."
                          className="flex-1 min-w-[160px] px-2 py-1 rounded border outline-none"
                          style={{ background: 'var(--bg-void)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
                        />
                        <button
                          onClick={async () => {
                            const txt = (replyDrafts[n.id] ?? '').trim();
                            if (!txt) return;
                            await onReplyNotification(n.id, txt);
                            setReplyDrafts((prev) => ({ ...prev, [n.id]: '' }));
                          }}
                          className="px-2.5 py-1 rounded font-mono-num font-bold cursor-pointer"
                          style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
                        >
                          Balas ↗
                        </button>
                      </>
                    )}
                    <button
                      onClick={() => void onCreateTaskFromWaNotif(n)}
                      className="px-2 py-1 rounded font-mono-num border cursor-pointer"
                      style={{ borderColor: 'var(--border-subtle)', color: 'var(--accent-2)' }}
                    >
                      + Jadi Tugas ClickUp
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right 4 cols: Phone Controls, Continuity Camera, Type on Phone, Timeline */}
        <div className="xl:col-span-4 space-y-3">
          {/* Phone Controls */}
          {device && (
            <div className="themed-card p-3 space-y-2 text-xs">
              <div className="font-mono-num font-bold" style={{ color: 'var(--text-secondary)' }}>
                PHONE CONTROLS & AUDIO
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {[
                  { key: 'dnd_enabled', label: '🌙 DND', val: device.dnd_enabled },
                  { key: 'torch_enabled', label: '🔦 Torch', val: device.torch_enabled },
                  { key: 'wifi_enabled', label: '📶 Wi-Fi', val: device.wifi_enabled },
                  { key: 'bt_enabled', label: 'ᛒ BT', val: device.bt_enabled },
                  { key: 'hotspot_enabled', label: '📡 Hotspot', val: device.hotspot_enabled },
                  { key: 'auto_dnd_on_deepwork', label: '⏱ Auto-DND', val: device.auto_dnd_on_deepwork },
                ].map((c) => (
                  <button
                    key={c.key}
                    onClick={() => void onToggleControl(device.id, c.key, c.val !== 1)}
                    className="py-1.5 px-2 rounded border font-mono-num cursor-pointer"
                    style={
                      c.val === 1
                        ? { background: 'var(--accent-soft)', color: 'var(--accent)', borderColor: 'var(--border-accent)' }
                        : { background: 'var(--bg-void)', borderColor: 'var(--border-subtle)', color: 'var(--text-muted)' }
                    }
                  >
                    {c.label}
                  </button>
                ))}
              </div>
              {[
                { key: 'phone_as_speaker', label: 'Phone as speaker', val: device.phone_as_speaker },
                { key: 'phone_sound_on_pc', label: 'Phone sound on this PC', val: device.phone_sound_on_pc },
              ].map((s) => (
                <div key={s.key} className="flex items-center justify-between pt-1">
                  <span>{s.label}</span>
                  <button
                    onClick={() => void onToggleControl(device.id, s.key, s.val !== 1)}
                    className="px-2 py-0.5 rounded font-mono-num text-xs cursor-pointer"
                    style={
                      s.val === 1
                        ? { background: 'var(--accent)', color: 'var(--accent-fg)' }
                        : { background: 'var(--bg-void)', border: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }
                    }
                  >
                    {s.val === 1 ? 'ON' : 'OFF'}
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Continuity Camera + Type on Phone */}
          <div className="themed-card p-3 space-y-2 text-xs">
            <div className="font-mono-num font-bold" style={{ color: 'var(--text-secondary)' }}>
              CAMERA & REMOTE INPUT
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={async () => {
                  const res = await onCameraCapture('scan');
                  setStatusBanner(`Continuity Camera Scan tersimpan: ${res.artifactLabel}`);
                }}
                className="p-2 rounded border text-left cursor-pointer"
                style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
              >
                <div className="font-bold">📄 Scan Dokumen</div>
                <div style={{ color: 'var(--text-muted)' }}>Ke Clipboard / Task</div>
              </button>
              <button
                onClick={async () => {
                  const res = await onCameraCapture('photo');
                  setStatusBanner(`Continuity Camera Photo tersimpan: ${res.artifactLabel}`);
                }}
                className="p-2 rounded border text-left cursor-pointer"
                style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
              >
                <div className="font-bold">📷 Foto Cepat</div>
                <div style={{ color: 'var(--text-muted)' }}>Phone Camera</div>
              </button>
            </div>

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!typeOnPhoneText.trim()) return;
                await onSendFileOrLink({ text: typeOnPhoneText.trim() });
                setStatusBanner(`Teks dikirim ke keyboard HP: "${typeOnPhoneText.trim()}"`);
                setTypeOnPhoneText('');
              }}
              className="flex gap-1.5 pt-1"
            >
              <input
                value={typeOnPhoneText}
                onChange={(e) => setTypeOnPhoneText(e.target.value)}
                placeholder="Type on phone dengan keyboard PC..."
                className="flex-1 px-2 py-1 rounded border outline-none"
                style={{ background: 'var(--bg-void)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
              />
              <button type="submit" className="px-2.5 py-1 rounded font-bold cursor-pointer" style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}>
                Start
              </button>
            </form>
          </div>

          {/* Timeline */}
          <div className="themed-card p-3 space-y-1.5 text-xs">
            <div className="font-mono-num font-bold" style={{ color: 'var(--text-secondary)' }}>
              TIMELINE LINTAS PERANGKAT
            </div>
            <div className="space-y-1 max-h-40 overflow-y-auto themed-scroll">
              {timeline.map((item) => (
                <div key={item.id} className="bg-black/25 px-2 py-1.5 rounded">
                  <div className="font-semibold truncate">{item.title}</div>
                  {item.detail && (
                    <div className="truncate" style={{ color: 'var(--text-muted)' }}>
                      {item.detail}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* SECTION 2: TAILSCALE MESH NETWORKING & QR ACCESS (FR-66..69) */}
      <div className="themed-card p-3 grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
        <div className="md:col-span-9 space-y-2 text-xs">
          <div className="flex items-center gap-2">
            <span className="font-mono-num font-bold text-purple-400">🟣 TAILSCALE MESH VPN & 3-PATH CONNECTION DOCTOR</span>
            <span className="px-2 py-0.5 rounded font-mono-num bg-white/5">
              {network.tailscale.running ? 'TAILSCALE ONLINE' : network.tailscale.installed ? 'TAILSCALE IDLE' : 'LAN + OFFLINE READY'}
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 font-mono-num">
            <div className="bg-black/25 p-2 rounded">
              <div style={{ color: 'var(--text-muted)' }}>URL Rekomendasi HP (Buka di Browser / Widget HP):</div>
              <div className="font-bold truncate" style={{ color: 'var(--accent)' }}>
                {network.recommendedMobileUrl}
              </div>
            </div>
            <div className="bg-black/25 p-2 rounded">
              <div style={{ color: 'var(--text-muted)' }}>Tailscale IP / LAN IP:</div>
              <div>
                TS: {network.tailscale.selfIp ?? 'Belum aktif'} · LAN: {network.lanUrls[0] ?? '127.0.0.1'}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              value={tsIpInput}
              onChange={(e) => setTsIpInput(e.target.value)}
              placeholder="IP Tailscale HP (100.x.y.z)"
              className="px-2 py-1 rounded border font-mono-num text-xs outline-none"
              style={{ background: 'var(--bg-void)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
            />
            <button
              onClick={async () => {
                if (!device) return;
                const r = await onConnectTailscalePeer(device.id, tsIpInput);
                setStatusBanner(r.message);
              }}
              className="px-2.5 py-1 rounded text-xs font-mono-num bg-purple-500/20 text-purple-300 border border-purple-500/40 cursor-pointer"
            >
              Sambungkan NectarLink via Tailscale IP
            </button>
            <span style={{ color: 'var(--text-muted)' }}>
              Setup cepat Linux: <code className="text-white">./scripts/setup-tailscale.sh</code>
            </span>
          </div>
        </div>

        <div className="md:col-span-3 flex flex-col items-center justify-center bg-black/30 p-2 rounded-lg">
          {network.qrDataUrl ? (
            <img src={network.qrDataUrl} alt="QR Akses HP Llamrei" className="w-28 h-28 rounded" />
          ) : (
            <div className="text-xs">QR Ready</div>
          )}
          <span className="text-xs font-mono-num mt-1" style={{ color: 'var(--text-muted)' }}>
            Scan dari HP Android
          </span>
        </div>
      </div>

      {/* SECTION 3: 4 ANDROID HOME SCREEN WIDGETS (1 ALL-IN-ONE + 3 MODULAR) WITH OFFLINE RECONCILE (FR-63..68) */}
      <div className="themed-card p-3 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-xs font-mono-num font-bold" style={{ color: 'var(--accent)' }}>
              📱 SUITE 4 WIDGET HOME SCREEN HP ANDROID (LIVE SYNC & OFFLINE OUTBOX)
            </div>
            <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              1 Widget All-in-One (4×3) + 3 Widget Terpisah (Task, Alarm, Reminder). Coba aktifkan Simulasi Laptop Sleep untuk menguji Offline Cache & Reconcile!
            </div>
          </div>

          <div className="flex items-center gap-2">
            <a
              href="/api/download/apk"
              download="llamrei-widgets.apk"
              className="px-3 py-1 rounded text-xs font-mono-num font-bold flex items-center gap-1.5 shadow transition hover:opacity-90"
              style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
            >
              <span>📥</span>
              <span>Download APK Widget</span>
            </a>
            <button
              onClick={() => setOfflineSim((v) => !v)}
              className="px-2.5 py-1 rounded text-xs font-mono-num border cursor-pointer"
              style={
                offlineSim
                  ? { background: 'rgba(245,158,11,0.2)', color: '#fbbf24', borderColor: 'rgba(245,158,11,0.5)' }
                  : { background: 'var(--bg-void)', borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }
              }
            >
              {offlineSim ? '🟡 Simulasi Laptop Sleep (OFFLINE)' : '🟢 Laptop Online'}
            </button>
            {outbox.length > 0 && (
              <button
                onClick={() => void handleReconnectAndSync()}
                className="px-2.5 py-1 rounded text-xs font-mono-num font-bold cursor-pointer"
                style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
              >
                ↻ Reconnect & Sync Outbox ({outbox.length})
              </button>
            )}
          </div>
        </div>

        {/* 1. ALL-IN-ONE WIDGET (4x3) */}
        <div className="rounded-2xl border p-3.5 space-y-2.5 shadow-xl" style={{ background: '#07090e', borderColor: 'var(--border-accent)' }}>
          <div className="flex items-center justify-between text-xs font-mono-num border-b pb-2" style={{ borderColor: '#1d2331' }}>
            <span className="font-bold" style={{ color: 'var(--accent)' }}>
              WIDGET 1: ALL-IN-ONE (4×3 HOME SCREEN)
            </span>
            <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300">
              ⏰ {nextWidgetAlarm ? `${nextWidgetAlarm.title.slice(0, 18)} · ${new Date(nextWidgetAlarm.trigger_at).toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit' })}` : 'No Alarm'}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
            <div className="space-y-1.5">
              <div className="font-mono-num text-slate-400">TASK CLICKUP HARI INI</div>
              {widgetTasks.map((t) => (
                <label key={t.id} className="flex items-center gap-2 bg-[#0d111a] px-2 py-1.5 rounded cursor-pointer">
                  <input type="checkbox" checked={t.status === 'Done'} onChange={() => void handleWidgetTaskToggle(t)} />
                  <span className={`truncate ${t.status === 'Done' ? 'line-through text-slate-500' : 'text-white'}`}>{t.title}</span>
                </label>
              ))}
            </div>

            <div className="space-y-1.5 flex flex-col justify-between">
              <div className="space-y-1">
                <div className="font-mono-num text-slate-400">REMINDER & KONTROL ALARM</div>
                {widgetReminders.map((r) => (
                  <div key={r.id} className="bg-[#0d111a] px-2 py-1 rounded truncate text-slate-300">
                    🔔 {r.title}
                  </div>
                ))}
              </div>
              {nextWidgetAlarm && (
                <div className="flex gap-2 pt-1">
                  <button
                    onClick={() => void handleWidgetAlarmAction(nextWidgetAlarm.id, 'snooze')}
                    className="flex-1 py-1 rounded bg-amber-500/20 text-amber-300 font-mono-num cursor-pointer"
                  >
                    🔕 Snooze 10m
                  </button>
                  <button
                    onClick={() => void handleWidgetAlarmAction(nextWidgetAlarm.id, 'dismiss')}
                    className="flex-1 py-1 rounded bg-rose-500/20 text-rose-300 font-mono-num cursor-pointer"
                  >
                    ✓ Dismiss
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 2, 3, 4: THREE MODULAR WIDGETS */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 text-xs">
          {/* Modular Task Widget */}
          <div className="rounded-2xl border p-3 space-y-1.5" style={{ background: '#07090e', borderColor: '#23293a' }}>
            <div className="font-mono-num font-bold text-cyan-400">WIDGET 2: TASK (3×2)</div>
            {widgetTasks.slice(0, 3).map((t) => (
              <label key={t.id} className="flex items-center gap-2 bg-[#0d111a] px-2 py-1 rounded cursor-pointer">
                <input type="checkbox" checked={t.status === 'Done'} onChange={() => void handleWidgetTaskToggle(t)} />
                <span className={`truncate ${t.status === 'Done' ? 'line-through text-slate-500' : 'text-white'}`}>{t.title}</span>
              </label>
            ))}
          </div>

          {/* Modular Alarm Widget */}
          <div className="rounded-2xl border p-3 space-y-2 flex flex-col justify-between" style={{ background: '#07090e', borderColor: '#23293a' }}>
            <div className="font-mono-num font-bold text-amber-400">WIDGET 3: ALARM (2×2)</div>
            {nextWidgetAlarm ? (
              <>
                <div>
                  <div className="text-lg font-mono-num font-bold text-white">
                    {new Date(nextWidgetAlarm.snoozed_until ?? nextWidgetAlarm.trigger_at).toLocaleTimeString('id-ID', {
                      timeZone: 'Asia/Jakarta',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}{' '}
                    WIB
                  </div>
                  <div className="truncate text-slate-400">{nextWidgetAlarm.title}</div>
                </div>
                <div className="flex gap-1.5">
                  <button
                    onClick={() => void handleWidgetAlarmAction(nextWidgetAlarm.id, 'snooze')}
                    className="flex-1 py-1 rounded bg-amber-500/20 text-amber-300 font-mono-num cursor-pointer"
                  >
                    Snooze
                  </button>
                  <button
                    onClick={() => void handleWidgetAlarmAction(nextWidgetAlarm.id, 'dismiss')}
                    className="flex-1 py-1 rounded bg-rose-500/20 text-rose-300 font-mono-num cursor-pointer"
                  >
                    Dismiss
                  </button>
                </div>
              </>
            ) : (
              <div className="text-slate-400">Tidak ada alarm aktif.</div>
            )}
          </div>

          {/* Modular Reminder Widget */}
          <div className="rounded-2xl border p-3 space-y-1.5" style={{ background: '#07090e', borderColor: '#23293a' }}>
            <div className="font-mono-num font-bold" style={{ color: 'var(--accent)' }}>
              WIDGET 4: REMINDER (3×2)
            </div>
            {widgetReminders.map((r) => (
              <div key={r.id} className="bg-[#0d111a] px-2 py-1 rounded flex justify-between gap-2">
                <span className="truncate text-slate-200">{r.title.replace('Reminder: ', '')}</span>
                <span className="font-mono-num text-emerald-400 shrink-0">
                  {new Date(r.trigger_at).toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
