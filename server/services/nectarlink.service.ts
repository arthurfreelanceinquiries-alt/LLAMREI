import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getDb } from '../db/connection.ts';
import { sseBus } from '../lib/sse.ts';

const execFileAsync = promisify(execFile);

export interface NectarLinkTokenConfig {
  port: number;
  token: string;
  path: string;
}

export interface PairedDeviceRow {
  id: string;
  name: string;
  platform: string;
  android_version: string;
  online: number;
  link_type: string;
  lan_ip: string | null;
  tailscale_ip: string | null;
  tailscale_dns_name: string | null;
  active_transport: 'lan' | 'tailscale' | 'offline_cache';
  latency_ms: number;
  battery_level: number;
  battery_charging: number;
  dnd_enabled: number;
  auto_dnd_on_deepwork: number;
  torch_enabled: number;
  wifi_enabled: number;
  bt_enabled: number;
  hotspot_enabled: number;
  phone_as_speaker: number;
  play_on_phone: number;
  phone_sound_on_pc: number;
  media_title: string | null;
  media_artist: string | null;
  media_playing: number;
  last_seen_at: string;
}

export interface PhoneNotificationRow {
  id: string;
  device_id: string | null;
  app_package: string;
  app_name: string;
  sender_or_title: string;
  conversation_group: string | null;
  body_text: string;
  otp_code: string | null;
  can_reply: number;
  reply_action_id: string;
  is_mention_tag: number;
  ai_intent: string | null;
  ai_urgency: string | null;
  replied_text: string | null;
  replied_at: string | null;
  linked_task_id: string | null;
  dismissed: number;
  received_at: string;
}

export function discoverLocalApiToken(): NectarLinkTokenConfig | null {
  const candidates: string[] = [];
  if (process.env.NECTARLINK_API_TOKEN_PATH) {
    candidates.push(process.env.NECTARLINK_API_TOKEN_PATH);
  }
  const xdgData = process.env.XDG_DATA_HOME ?? path.join(os.homedir(), '.local', 'share');
  candidates.push(path.join(xdgData, 'Nectarlink', 'api-token.json'));
  candidates.push(path.join(xdgData, 'nectarlink', 'api-token.json'));

  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as { port?: number; token?: string };
      if (parsed.port && parsed.token) {
        return { port: parsed.port, token: parsed.token, path: file };
      }
    } catch {
      // Ignore malformed token files
    }
  }
  return null;
}

async function callNectarLinkLocalApi<T = unknown>(
  method: 'GET' | 'POST',
  endpoint: string,
  body?: unknown,
): Promise<{ ok: boolean; via: 'nectarlink_api' | 'simulated_fallback'; data?: T; error?: string }> {
  const cfg = discoverLocalApiToken();
  if (!cfg) {
    return { ok: false, via: 'simulated_fallback', error: 'nectarlink_token_not_found' };
  }
  try {
    const res = await fetch(`http://127.0.0.1:${cfg.port}${endpoint}`, {
      method,
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(2500),
    });
    const data = (await res.json()) as T;
    return { ok: res.ok, via: 'nectarlink_api', data };
  } catch (err) {
    return {
      ok: false,
      via: 'simulated_fallback',
      error: err instanceof Error ? err.message : 'nectarlink_unreachable',
    };
  }
}

async function runNectarLinkCli(args: string[]): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync('nectarlink', args, { timeout: 5000 });
    return { ok: true, stdout, stderr };
  } catch (err) {
    return {
      ok: false,
      stdout: '',
      stderr: err instanceof Error ? err.message : 'nectarlink_cli_missing',
    };
  }
}

export function getPhoneHubState(): {
  apiConfigured: boolean;
  tokenPath: string | null;
  devices: PairedDeviceRow[];
  notifications: PhoneNotificationRow[];
  timeline: unknown[];
} {
  const db = getDb();
  const token = discoverLocalApiToken();
  const devices = db.prepare('SELECT * FROM paired_devices ORDER BY online DESC, last_seen_at DESC').all() as unknown as PairedDeviceRow[];
  const notifications = db
    .prepare('SELECT * FROM phone_notifications WHERE dismissed = 0 ORDER BY received_at DESC LIMIT 30')
    .all() as unknown as PhoneNotificationRow[];
  const timeline = db
    .prepare('SELECT * FROM device_timeline ORDER BY created_at DESC LIMIT 25')
    .all();

  return {
    apiConfigured: Boolean(token),
    tokenPath: token?.path ?? null,
    devices,
    notifications,
    timeline,
  };
}

export async function syncDevicesFromNectarLink(): Promise<{ synced: boolean; devices: PairedDeviceRow[] }> {
  const db = getDb();
  const apiRes = await callNectarLinkLocalApi<{
    ok: boolean;
    devices?: Array<{
      id: string;
      name: string;
      platform: string;
      online: boolean;
      link?: string;
      battery?: { level: number; charging: boolean };
    }>;
  }>('GET', '/v1/devices');

  if (apiRes.ok && apiRes.data?.devices) {
    const upsert = db.prepare(
      `INSERT INTO paired_devices (id, name, platform, online, link_type, battery_level, battery_charging, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         online = excluded.online,
         link_type = excluded.link_type,
         battery_level = excluded.battery_level,
         battery_charging = excluded.battery_charging,
         last_seen_at = datetime('now')`,
    );
    for (const d of apiRes.data.devices) {
      upsert.run(
        d.id,
        d.name,
        d.platform ?? 'android',
        d.online ? 1 : 0,
        d.link ?? 'lan',
        d.battery?.level ?? 85,
        d.battery?.charging ? 1 : 0,
      );
    }
  }

  const devices = db.prepare('SELECT * FROM paired_devices ORDER BY online DESC').all() as unknown as PairedDeviceRow[];
  return { synced: apiRes.ok, devices };
}

export function addTimelineEntry(params: {
  deviceId?: string | null;
  deviceName?: string;
  kind: 'mirror_session' | 'webcam_session' | 'file' | 'clip' | 'link' | 'photo' | 'scan' | 'reply' | 'alarm';
  direction: 'incoming' | 'outgoing' | 'session';
  title: string;
  detail?: string;
  targetPathOrUrl?: string | null;
  linkedTaskId?: string | null;
}): void {
  const db = getDb();
  const id = `tl_${crypto.randomUUID().slice(0, 8)}`;
  db.prepare(
    `INSERT INTO device_timeline (id, device_id, device_name, kind, direction, title, detail, target_path_or_url, linked_task_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    params.deviceId ?? 'dev_infinix_note30',
    params.deviceName ?? 'Infinix NOTE 30 Pro',
    params.kind,
    params.direction,
    params.title,
    params.detail ?? null,
    params.targetPathOrUrl ?? null,
    params.linkedTaskId ?? null,
  );
  sseBus.emit('phone:timeline', { id, title: params.title, kind: params.kind });
}

export async function ringPhone(deviceName?: string): Promise<{ ok: boolean; via: string }> {
  const res = await callNectarLinkLocalApi('POST', '/v1/ring', deviceName ? { device: deviceName } : {});
  addTimelineEntry({
    deviceName: deviceName ?? 'Infinix NOTE 30 Pro',
    kind: 'alarm',
    direction: 'outgoing',
    title: 'Find Phone / Ring Triggered',
    detail: res.ok ? 'Diteruskan via NectarLink Local API' : 'Disimulasikan (NectarLink daemon offline)',
  });
  return { ok: true, via: res.via };
}

export async function pushPhoneNotification(params: {
  title: string;
  body: string;
  device?: string;
}): Promise<{ ok: boolean; via: string }> {
  const res = await callNectarLinkLocalApi('POST', '/v1/notify', params);
  return { ok: true, via: res.via };
}

export async function sendToPhone(params: {
  device?: string;
  paths?: string[];
  url?: string;
  text?: string;
}): Promise<{ ok: boolean; via: string }> {
  const res = await callNectarLinkLocalApi('POST', '/v1/send', params);
  addTimelineEntry({
    deviceName: params.device ?? 'Infinix NOTE 30 Pro',
    kind: params.paths?.length ? 'file' : 'link',
    direction: 'outgoing',
    title: params.paths?.[0] ?? params.url ?? params.text ?? 'Send to Phone',
    detail: `Via ${res.via}`,
    targetPathOrUrl: params.url ?? params.paths?.[0] ?? null,
  });
  return { ok: true, via: res.via };
}

export async function sendClipboardToPhone(text: string, device?: string): Promise<{ ok: boolean; via: string }> {
  const res = await callNectarLinkLocalApi('POST', '/v1/clipboard', { text, ...(device ? { device } : {}) });
  addTimelineEntry({
    deviceName: device ?? 'Infinix NOTE 30 Pro',
    kind: 'clip',
    direction: 'outgoing',
    title: `Clipboard pushed (${text.slice(0, 36)}${text.length > 36 ? '...' : ''})`,
    detail: `Via ${res.via}`,
  });
  return { ok: true, via: res.via };
}

export async function triggerCameraCapture(params: {
  mode: 'photo' | 'scan';
  device?: string;
  linkedTaskId?: string | null;
}): Promise<{ ok: boolean; via: string; artifactLabel: string }> {
  const db = getDb();
  const res = await callNectarLinkLocalApi('POST', '/v1/camera', {
    mode: params.mode,
    ...(params.device ? { device: params.device } : {}),
  });
  const filename = `${params.mode}_${new Date().toISOString().slice(11, 19).replace(/:/g, '')}.jpg`;

  if (params.linkedTaskId) {
    const task = db.prepare('SELECT attachments_json FROM tasks WHERE id = ?').get(params.linkedTaskId) as
      | { attachments_json: string }
      | undefined;
    if (task) {
      const list = JSON.parse(task.attachments_json || '[]') as Array<Record<string, unknown>>;
      list.push({
        id: `att_${crypto.randomUUID().slice(0, 8)}`,
        name: filename,
        source: 'nectarlink_continuity_camera',
        mode: params.mode,
        createdAt: new Date().toISOString(),
      });
      db.prepare("UPDATE tasks SET attachments_json = ?, updated_at = datetime('now') WHERE id = ?").run(
        JSON.stringify(list),
        params.linkedTaskId,
      );
      sseBus.emit('workspace:update', { taskId: params.linkedTaskId });
    }
  }

  addTimelineEntry({
    deviceName: params.device ?? 'Infinix NOTE 30 Pro',
    kind: params.mode === 'scan' ? 'scan' : 'photo',
    direction: 'incoming',
    title: filename,
    detail: params.linkedTaskId ? `Continuity Camera → Dilampirkan ke Task ${params.linkedTaskId}` : `Continuity Camera (${params.mode})`,
    linkedTaskId: params.linkedTaskId ?? null,
  });

  return { ok: true, via: res.via, artifactLabel: filename };
}

export async function startScreenMirror(deviceId?: string, appPackage?: string): Promise<{ ok: boolean; mode: string; note: string }> {
  const db = getDb();
  const dev = (deviceId
    ? db.prepare('SELECT * FROM paired_devices WHERE id = ?').get(deviceId)
    : db.prepare('SELECT * FROM paired_devices LIMIT 1').get()) as unknown as PairedDeviceRow | undefined;

  const target = dev?.name ?? 'Infinix NOTE 30 Pro';
  const cliArgs = ['mirror', target, '/tmp/llamrei_mirror_preview.h264', '--seconds', '30'];
  if (appPackage) cliArgs.push('--app', appPackage);
  const cliRes = await runNectarLinkCli(cliArgs);

  addTimelineEntry({
    deviceId: dev?.id ?? null,
    deviceName: target,
    kind: 'mirror_session',
    direction: 'session',
    title: appPackage ? `App Window: ${appPackage}` : 'Screen Mirroring (Screencast 60fps)',
    detail: cliRes.ok
      ? 'Sesi Screencast aktif tanpa USB Debugging'
      : 'Permintaan Screencast dicatat (pasang nectarlink CLI untuk stream native)',
  });

  return {
    ok: true,
    mode: cliRes.ok ? 'nectarlink_screencast' : 'ui_session_logged',
    note: cliRes.ok ? 'Screencast dimulai tanpa Developer Mode.' : 'NectarLink CLI belum terpasang di PATH; sesi tercatat di timeline.',
  };
}

export async function setPhoneControlToggle(
  deviceId: string,
  toggleName:
    | 'dnd_enabled'
    | 'auto_dnd_on_deepwork'
    | 'torch_enabled'
    | 'wifi_enabled'
    | 'bt_enabled'
    | 'hotspot_enabled'
    | 'phone_as_speaker'
    | 'play_on_phone'
    | 'phone_sound_on_pc',
  enabled: boolean,
): Promise<PairedDeviceRow | null> {
  const db = getDb();
  const allowedColumns = new Set([
    'dnd_enabled',
    'auto_dnd_on_deepwork',
    'torch_enabled',
    'wifi_enabled',
    'bt_enabled',
    'hotspot_enabled',
    'phone_as_speaker',
    'play_on_phone',
    'phone_sound_on_pc',
  ]);
  if (!allowedColumns.has(toggleName)) return null;

  db.prepare(`UPDATE paired_devices SET ${toggleName} = ? WHERE id = ?`).run(enabled ? 1 : 0, deviceId);
  const dev = db.prepare('SELECT * FROM paired_devices WHERE id = ?').get(deviceId) as unknown as PairedDeviceRow | undefined;
  if (!dev) return null;

  const cliToggleMap: Record<string, string> = {
    dnd_enabled: 'dnd',
    torch_enabled: 'torch',
    wifi_enabled: 'wifi',
    bt_enabled: 'bluetooth',
    hotspot_enabled: 'hotspot',
  };
  if (cliToggleMap[toggleName]) {
    void runNectarLinkCli(['toggles', dev.name, 'set', cliToggleMap[toggleName], enabled ? 'on' : 'off']);
  }
  if (toggleName === 'play_on_phone' && enabled) {
    void callNectarLinkLocalApi('POST', '/v1/play-on-phone', {});
  }

  sseBus.emit('phone:device_update', dev);
  return dev;
}

export async function setPhoneDndForDeepWork(enabled: boolean): Promise<void> {
  const db = getDb();
  const dev = db.prepare('SELECT * FROM paired_devices WHERE auto_dnd_on_deepwork = 1 LIMIT 1').get() as
    | PairedDeviceRow
    | undefined;
  if (!dev) return;
  await setPhoneControlToggle(dev.id, 'dnd_enabled', enabled);
}

export function ingestPhoneNotification(params: {
  deviceId?: string;
  appPackage: string;
  appName: string;
  senderOrTitle: string;
  conversationGroup?: string | null;
  bodyText: string;
  canReply?: boolean;
  aliases?: string[];
}): PhoneNotificationRow {
  const db = getDb();
  const id = `notif_${crypto.randomUUID().slice(0, 8)}`;
  const aliases = params.aliases ?? ['arthur', '@arthur', 'reezan', '312023002'];
  const lower = params.bodyText.toLowerCase();
  const isMention = aliases.some((a) => lower.includes(a.toLowerCase())) ? 1 : 0;
  const otpMatch = params.bodyText.match(/\b(\d{4,8})\b/);
  const otpCode = lower.includes('otp') || lower.includes('kode') || lower.includes('verification') ? (otpMatch?.[1] ?? null) : null;

  let aiIntent: string | null = null;
  let aiUrgency: string = 'low';
  if (isMention) {
    if (lower.includes('tolong') || lower.includes('cek') || lower.includes('kirim') || lower.includes('buat')) {
      aiIntent = 'task_request';
      aiUrgency = 'high';
    } else if (lower.includes('deadline') || lower.includes('lambat') || lower.includes('jam')) {
      aiIntent = 'deadline';
      aiUrgency = 'high';
    } else if (lower.includes('rapat') || lower.includes('meeting') || lower.includes('bimbingan')) {
      aiIntent = 'meeting_invite';
      aiUrgency = 'medium';
    } else if (params.bodyText.includes('?')) {
      aiIntent = 'question';
      aiUrgency = 'medium';
    } else {
      aiIntent = 'info';
    }
  }

  db.prepare(
    `INSERT INTO phone_notifications (id, device_id, app_package, app_name, sender_or_title, conversation_group, body_text, otp_code, can_reply, is_mention_tag, ai_intent, ai_urgency)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    params.deviceId ?? 'dev_infinix_note30',
    params.appPackage,
    params.appName,
    params.senderOrTitle,
    params.conversationGroup ?? null,
    params.bodyText,
    otpCode,
    params.canReply === false ? 0 : 1,
    isMention,
    aiIntent,
    aiUrgency,
  );

  const row = db.prepare('SELECT * FROM phone_notifications WHERE id = ?').get(id) as unknown as PhoneNotificationRow;
  sseBus.emit('phone:notification', row);
  return row;
}

export async function replyPhoneNotification(notifId: string, replyText: string): Promise<{ ok: boolean; via: string; notification: PhoneNotificationRow | null }> {
  const db = getDb();
  const notif = db.prepare('SELECT * FROM phone_notifications WHERE id = ?').get(notifId) as unknown as PhoneNotificationRow | undefined;
  if (!notif) return { ok: false, via: 'not_found', notification: null };

  const dev = db.prepare('SELECT name FROM paired_devices WHERE id = ?').get(notif.device_id ?? '') as
    | { name: string }
    | undefined;
  const cliRes = await runNectarLinkCli([
    'act',
    dev?.name ?? 'Infinix NOTE 30 Pro',
    notif.id,
    notif.reply_action_id || 'reply',
    '--reply',
    replyText,
  ]);

  db.prepare("UPDATE phone_notifications SET replied_text = ?, replied_at = datetime('now') WHERE id = ?").run(
    replyText,
    notifId,
  );

  addTimelineEntry({
    deviceId: notif.device_id,
    deviceName: dev?.name ?? 'Infinix NOTE 30 Pro',
    kind: 'reply',
    direction: 'outgoing',
    title: `Balas ${notif.app_name} → ${notif.sender_or_title}`,
    detail: replyText,
  });

  const updated = db.prepare('SELECT * FROM phone_notifications WHERE id = ?').get(notifId) as unknown as PhoneNotificationRow;
  sseBus.emit('phone:notification_updated', updated);
  return { ok: true, via: cliRes.ok ? 'nectarlink_direct_reply' : 'queued_local_reply', notification: updated };
}

export function dismissPhoneNotification(notifId: string): void {
  const db = getDb();
  db.prepare('UPDATE phone_notifications SET dismissed = 1 WHERE id = ?').run(notifId);
  sseBus.emit('phone:notification_dismissed', { id: notifId });
}

export async function connectNectarLinkViaTailscale(deviceId: string, tailscaleIp: string, port = 41641): Promise<{ ok: boolean; message: string }> {
  const db = getDb();
  const dev = db.prepare('SELECT * FROM paired_devices WHERE id = ?').get(deviceId) as unknown as PairedDeviceRow | undefined;
  if (!dev) return { ok: false, message: 'Perangkat tidak ditemukan' };

  db.prepare("UPDATE paired_devices SET tailscale_ip = ?, active_transport = 'tailscale' WHERE id = ?").run(tailscaleIp, deviceId);
  const cliRes = await runNectarLinkCli(['connect', dev.name, `${tailscaleIp}:${port}`]);
  sseBus.emit('phone:device_update', { ...dev, tailscale_ip: tailscaleIp, active_transport: 'tailscale' });
  return {
    ok: true,
    message: cliRes.ok
      ? `NectarLink tersambung ke ${dev.name} via Tailscale (${tailscaleIp}:${port})`
      : `Alamat Tailscale ${tailscaleIp}:${port} tersimpan untuk ${dev.name} (siap dipakai saat NectarLink CLI aktif)`,
  };
}
