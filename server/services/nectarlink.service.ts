import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isIP } from 'node:net';
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
      if (typeof parsed.port === 'number' && Number.isInteger(parsed.port) && parsed.port >= 1 && parsed.port <= 65535 &&
          typeof parsed.token === 'string' && parsed.token.trim()) {
        return { port: parsed.port, token: parsed.token, path: file };
      }
    } catch {
      // Ignore malformed token files
    }
  }
  return null;
}

type TransportStatus = 'accepted' | 'offline' | 'failed' | 'unknown';
type CommandStatus = TransportStatus | 'saved' | 'unsupported';
type CommandVia = 'nectarlink_api' | 'nectarlink_cli' | 'local' | 'unavailable';

export interface NectarLinkCommandResult {
  ok: boolean;
  via: CommandVia;
  status: CommandStatus;
  message: string;
}

const outcomeMessages: Record<CommandStatus, string> = {
  accepted: 'Permintaan diterima NectarLink. Konfirmasi dari perangkat belum tersedia.',
  offline: 'NectarLink belum tersedia di komputer ini.',
  failed: 'NectarLink menolak permintaan.',
  unknown: 'Hasil perintah tidak diketahui. Periksa perangkat sebelum mengulangi.',
  saved: 'Preferensi disimpan di LLAMREI.',
  unsupported: 'Perintah ini belum didukung oleh integrasi NectarLink.',
};

function commandResult(status: CommandStatus, via: CommandVia, message = outcomeMessages[status]): NectarLinkCommandResult {
  return { ok: status === 'saved', via, status, message };
}

async function callNectarLinkLocalApi<T = unknown>(
  method: 'GET' | 'POST',
  endpoint: string,
  body?: unknown,
): Promise<{ status: TransportStatus; via: 'nectarlink_api' | 'unavailable'; data?: T }> {
  const cfg = discoverLocalApiToken();
  if (!cfg) return { status: 'offline', via: 'unavailable' };
  const via = 'nectarlink_api';
  try {
    const res = await fetch(`http://127.0.0.1:${cfg.port}${endpoint}`, {
      method,
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(2500),
      redirect: 'error',
    });
    const data = await res.json().catch(() => undefined) as T | undefined;
    if (res.ok) {
      const rejected = data != null && typeof data === 'object' && 'ok' in data && data.ok === false;
      return { status: rejected ? 'failed' : 'accepted', via, data };
    }
    return { status: res.status >= 400 && res.status < 500 && res.status !== 408 ? 'failed' : 'unknown', via };
  } catch (err) {
    const failure = err as { cause?: { code?: string } };
    return { status: failure.cause?.code === 'ECONNREFUSED' ? 'offline' : 'unknown', via };
  }
}

async function runNectarLinkCli(args: string[]): Promise<NectarLinkCommandResult> {
  try {
    await execFileAsync('nectarlink', args, { timeout: 5000 });
    return commandResult('accepted', 'nectarlink_cli');
  } catch (err) {
    return commandResult((err as NodeJS.ErrnoException).code === 'ENOENT' ? 'offline' : 'unknown', 'nectarlink_cli');
  }
}

async function postPhoneCommand(endpoint: string, body: unknown): Promise<NectarLinkCommandResult> {
  const { status, via } = await callNectarLinkLocalApi('POST', endpoint, body);
  return commandResult(status, via);
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

  const synced = apiRes.status === 'accepted' && Array.isArray(apiRes.data?.devices);
  if (synced && apiRes.data?.devices) {
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
  return { synced, devices };
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

export async function ringPhone(deviceName?: string): Promise<NectarLinkCommandResult> {
  const result = await postPhoneCommand('/v1/ring', deviceName ? { device: deviceName } : {});
  if (result.status === 'accepted') {
    addTimelineEntry({ deviceName, kind: 'alarm', direction: 'outgoing', title: 'Permintaan Find Phone', detail: result.message });
  }
  return result;
}

export function pushPhoneNotification(params: {
  title: string;
  body: string;
  device?: string;
}): Promise<NectarLinkCommandResult> {
  return postPhoneCommand('/v1/notify', params);
}

export async function sendToPhone(params: {
  device?: string;
  paths?: string[];
  url?: string;
  text?: string;
}): Promise<NectarLinkCommandResult> {
  const result = await postPhoneCommand('/v1/send', params);
  if (result.status === 'accepted') {
    addTimelineEntry({
      deviceName: params.device,
      kind: params.paths?.length ? 'file' : 'link',
      direction: 'outgoing',
      title: params.paths?.length ? 'Permintaan kirim berkas' : 'Permintaan kirim teks atau tautan',
      detail: result.message,
    });
  }
  return result;
}

export async function sendClipboardToPhone(text: string, device?: string): Promise<NectarLinkCommandResult> {
  const result = await postPhoneCommand('/v1/clipboard', { text, ...(device ? { device } : {}) });
  if (result.status === 'accepted') {
    addTimelineEntry({ deviceName: device, kind: 'clip', direction: 'outgoing', title: 'Permintaan sinkron papan klip', detail: result.message });
  }
  return result;
}

export async function triggerCameraCapture(params: {
  mode: 'photo' | 'scan';
  device?: string;
  linkedTaskId?: string | null;
}): Promise<NectarLinkCommandResult & { artifactLabel: string | null }> {
  if (params.mode !== 'photo' && params.mode !== 'scan') {
    return { ...commandResult('failed', 'local', 'Mode kamera tidak valid.'), artifactLabel: null };
  }
  // The bridge does not provide an authenticated artifact for attachment here.
  const result = await postPhoneCommand('/v1/camera', { mode: params.mode, ...(params.device ? { device: params.device } : {}) });
  return { ...result, artifactLabel: null };
}

export async function startScreenMirror(
  deviceId?: string,
  appPackage?: string,
): Promise<NectarLinkCommandResult & { mode: string; note: string }> {
  const db = getDb();
  const dev = (deviceId
    ? db.prepare('SELECT * FROM paired_devices WHERE id = ?').get(deviceId)
    : db.prepare('SELECT * FROM paired_devices ORDER BY online DESC, last_seen_at DESC LIMIT 1').get()) as unknown as PairedDeviceRow | undefined;
  if (!dev) {
    const result = commandResult('failed', 'local', 'Perangkat tidak ditemukan.');
    return { ...result, mode: 'unavailable', note: result.message };
  }

  const cliArgs = ['mirror', dev.name, '/tmp/llamrei_mirror_preview.h264', '--seconds', '30'];
  if (appPackage) cliArgs.push('--app', appPackage);
  const result = await runNectarLinkCli(cliArgs);
  return { ...result, mode: result.status === 'accepted' ? 'nectarlink_cli_accepted' : 'unavailable', note: result.message };
}

const localPreferenceToggles: ReadonlySet<string> = new Set([
  'auto_dnd_on_deepwork',
  'phone_as_speaker',
  'phone_sound_on_pc',
]);

const cliToggleMap = new Map([
  ['dnd_enabled', 'dnd'],
  ['torch_enabled', 'torch'],
  ['wifi_enabled', 'wifi'],
  ['bt_enabled', 'bluetooth'],
  ['hotspot_enabled', 'hotspot'],
]);

export async function setPhoneControlToggle(
  deviceId: string,
  toggleName: string,
  enabled: boolean,
): Promise<NectarLinkCommandResult & { device: PairedDeviceRow | null }> {
  const db = getDb();
  const getDevice = db.prepare('SELECT * FROM paired_devices WHERE id = ?');
  const device = getDevice.get(deviceId) as unknown as PairedDeviceRow | undefined;
  if (!device || typeof enabled !== 'boolean') {
    return { ...commandResult('failed', 'local', 'Perangkat atau pengaturan tidak valid.'), device: device ?? null };
  }
  if (localPreferenceToggles.has(toggleName)) {
    db.prepare(`UPDATE paired_devices SET ${toggleName} = ? WHERE id = ?`).run(enabled ? 1 : 0, deviceId);
    const updated = getDevice.get(deviceId) as unknown as PairedDeviceRow;
    sseBus.emit('phone:device_update', updated);
    return { ...updated, ...commandResult('saved', 'local'), device: updated };
  }
  const cliToggle = cliToggleMap.get(toggleName);
  if (cliToggle) {
    const result = await runNectarLinkCli(['toggles', device.name, 'set', cliToggle, enabled ? 'on' : 'off']);
    return { ...device, ...result, device };
  }
  if (toggleName === 'play_on_phone' && enabled) {
    const result = await postPhoneCommand('/v1/play-on-phone', { device: device.name });
    return { ...device, ...result, device };
  }
  return { ...device, ...commandResult('unsupported', 'local'), device };
}

export async function setPhoneDndForDeepWork(enabled: boolean): Promise<void> {
  const db = getDb();
  const dev = db.prepare('SELECT * FROM paired_devices WHERE auto_dnd_on_deepwork = 1 AND online = 1 LIMIT 1').get() as
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

export async function replyPhoneNotification(
  notifId: string,
  replyText: string,
): Promise<NectarLinkCommandResult & { notification: PhoneNotificationRow | null }> {
  const db = getDb();
  const notif = db.prepare('SELECT * FROM phone_notifications WHERE id = ?').get(notifId) as unknown as PhoneNotificationRow | undefined;
  if (!notif || !notif.can_reply || notif.dismissed || !notif.reply_action_id || typeof replyText !== 'string' || !replyText.trim()) {
    return { ...commandResult('failed', 'local', 'Notifikasi tidak dapat dibalas atau isi balasan kosong.'), notification: notif ?? null };
  }

  const dev = db.prepare('SELECT name FROM paired_devices WHERE id = ?').get(notif.device_id ?? '') as { name: string } | undefined;
  if (!dev) return { ...commandResult('failed', 'local', 'Perangkat tidak ditemukan.'), notification: notif };

  const result = await runNectarLinkCli(['act', dev.name, notif.id, notif.reply_action_id, '--reply', replyText]);
  return { ...result, notification: notif };
}

export function dismissPhoneNotification(notifId: string): void {
  const db = getDb();
  db.prepare('UPDATE phone_notifications SET dismissed = 1 WHERE id = ?').run(notifId);
  sseBus.emit('phone:notification_dismissed', { id: notifId });
}

export async function connectNectarLinkViaTailscale(
  deviceId: string,
  tailscaleIp: string,
  port = 41641,
): Promise<NectarLinkCommandResult> {
  const db = getDb();
  const device = db.prepare('SELECT * FROM paired_devices WHERE id = ?').get(deviceId) as unknown as PairedDeviceRow | undefined;
  const ipVersion = typeof tailscaleIp === 'string' ? isIP(tailscaleIp) : 0;
  if (!device || ipVersion === 0 || !Number.isInteger(port) || port < 1 || port > 65535) {
    return commandResult('failed', 'local', 'Perangkat, alamat IP, atau port tidak valid.');
  }

  db.prepare('UPDATE paired_devices SET tailscale_ip = ? WHERE id = ?').run(tailscaleIp, deviceId);
  sseBus.emit('phone:device_update', { ...device, tailscale_ip: tailscaleIp });
  const address = ipVersion === 6 ? `[${tailscaleIp}]:${port}` : `${tailscaleIp}:${port}`;
  const result = await runNectarLinkCli(['connect', device.name, address]);
  return { ...result, message: `Alamat Tailscale disimpan. ${result.message}` };
}
