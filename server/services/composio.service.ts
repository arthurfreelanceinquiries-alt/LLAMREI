import { createRequire } from 'node:module';
import { Ajv, type ValidateFunction } from 'ajv';
import type { FormatsPlugin } from 'ajv-formats';
import { getDb } from '../db/connection.ts';
import { sseBus } from '../lib/sse.ts';
import { getSecret } from './secret.service.ts';
import type { UnifiedToolDef } from './ai-provider.service.ts';

const COMPOSIO_API_V3 = 'https://backend.composio.dev/api/v3';
const COMPOSIO_API_V3_1 = 'https://backend.composio.dev/api/v3.1';
const addFormats = createRequire(import.meta.url)('ajv-formats') as FormatsPlugin;
const validators = new WeakMap<Record<string, unknown>, ValidateFunction>();
const APPROVAL_WINDOW_MINUTES = 15;

export interface ComposioToolkitItem {
  slug: string;
  name: string;
  category: string;
  description: string;
  logo?: string | null;
  authSchemes?: string[];
  connectedStatus?: string | null;
  connectedAccountId?: string | null;
  enabledForAgent?: boolean;
}

export interface ComposioConnectionRow {
  id: string;
  toolkit_slug: string;
  toolkit_name: string;
  auth_config_id: string | null;
  connected_account_id: string | null;
  status: 'pending' | 'active' | 'expired' | 'disconnected' | 'failed';
  redirect_url: string | null;
  account_label: string | null;
  updated_at: string;
  created_at: string;
}

export interface ComposioToolItem {
  slug: string;
  name: string;
  description: string;
  toolkitSlug: string;
  readOnly: boolean;
  inputParameters: Record<string, unknown>;
}

export interface ComposioToolLogRow {
  id: string;
  tool_slug: string;
  toolkit_slug: string;
  arguments_json: string;
  status: 'success' | 'failed' | 'pending_approval';
  result_summary: string | null;
  created_at: string;
}

export const CURATED_COMPOSIO_TOOLKITS: ComposioToolkitItem[] = [
  { slug: 'gmail', name: 'Gmail', category: 'google', description: 'Baca, cari, buat draf, dan kirim email langsung dari Jarvis/Llamrei.' },
  { slug: 'googlecalendar', name: 'Google Calendar', category: 'google', description: 'Kelola jadwal, cek ketersediaan waktu, dan buat acara Google Calendar.' },
  { slug: 'googledocs', name: 'Google Docs', category: 'google', description: 'Buat dan baca dokumen skripsi, notulen, atau laporan riset di Google Docs.' },
  { slug: 'googlesheets', name: 'Google Sheets', category: 'google', description: 'Baca dan tulis data tabel trading, keuangan, atau absensi BEM ke Google Sheets.' },
  { slug: 'googledrive', name: 'Google Drive', category: 'google', description: 'Cari dan kelola file dokumen kampus maupun organisasi di Google Drive.' },
  { slug: 'notion', name: 'Notion', category: 'productivity', description: 'Sinkronkan halaman catatan, database tugas, dan pengetahuan Notion.' },
  { slug: 'github', name: 'GitHub', category: 'developer', description: 'Kelola repository, issue, pull request, dan commit proyek coding.' },
  { slug: 'slack', name: 'Slack', category: 'communication', description: 'Kirim pesan channel, cari thread tim, dan ringkas diskusi kerja.' },
  { slug: 'discord', name: 'Discord', category: 'communication', description: 'Kirim pengumuman atau pantau pesan di server komunitas & tim.' },
  { slug: 'telegram', name: 'Telegram', category: 'communication', description: 'Integrasi bot & pesan Telegram untuk notifikasi dan automasi.' },
  { slug: 'linear', name: 'Linear', category: 'productivity', description: 'Buat dan lacak issue sprint produk software secara cepat.' },
  { slug: 'trello', name: 'Trello', category: 'productivity', description: 'Sinkronkan board, list, dan kartu kerja Trello.' },
  { slug: 'asana', name: 'Asana', category: 'productivity', description: 'Kelola proyek tim, milestone, dan tugas Asana.' },
  { slug: 'clickup', name: 'ClickUp Cloud', category: 'productivity', description: 'Hubungkan akun ClickUp cloud dengan workspace lokal Llamrei.' },
  { slug: 'twitter', name: 'X (Twitter)', category: 'social', description: 'Pantau tren, riset sentimen market/AI, dan buat draf postingan X.' },
  { slug: 'instagram', name: 'Instagram', category: 'social', description: 'Kelola jadwal konten dan interaksi Instagram organisasi/pribadi.' },
  { slug: 'linkedin', name: 'LinkedIn', category: 'social', description: 'Susun draf artikel profesional dan update jaringan LinkedIn.' },
  { slug: 'youtube', name: 'YouTube', category: 'social', description: 'Cari video riset, ringkas konten, dan kelola playlist/channel.' },
  { slug: 'spotify', name: 'Spotify', category: 'productivity', description: 'Putar playlist fokus kerja dan kontrol pemutaran Spotify.' },
  { slug: 'zoom', name: 'Zoom', category: 'communication', description: 'Buat link rapat Zoom otomatis saat ada agenda rapat BEM/skripsi.' },
  { slug: 'airtable', name: 'Airtable', category: 'productivity', description: 'Baca & perbarui basis data kolaboratif Airtable.' },
  { slug: 'dropbox', name: 'Dropbox', category: 'productivity', description: 'Akses dan cadangkan dokumen lintas perangkat di Dropbox.' },
  { slug: 'figma', name: 'Figma', category: 'developer', description: 'Inspeksi file desain, komentar, dan aset UI Figma.' },
  { slug: 'hubspot', name: 'HubSpot', category: 'productivity', description: 'Kelola kontak CRM, catatan rapat, dan follow-up kemitraan.' },
];

let cachedRemoteToolkits: { fetchedAt: number; items: ComposioToolkitItem[] } | null = null;
const cachedToolkitTools = new Map<string, { fetchedAt: number; tools: ComposioToolItem[] }>();

function getComposioUserId(): string {
  try {
    const db = getDb();
    const row = db.prepare("SELECT value_json FROM app_settings WHERE key = 'composio_user_id'").get() as
      | { value_json: string }
      | undefined;
    return row ? String(JSON.parse(row.value_json)) : 'llamrei_local';
  } catch {
    return 'llamrei_local';
  }
}

export function getEnabledComposioToolkits(): string[] {
  try {
    const db = getDb();
    const row = db.prepare("SELECT value_json FROM app_settings WHERE key = 'composio_enabled_toolkits'").get() as
      | { value_json: string }
      | undefined;
    const parsed = row ? (JSON.parse(row.value_json) as unknown) : null;
    if (Array.isArray(parsed)) return parsed.map((x) => String(x).toLowerCase());
  } catch {
    // fallback
  }
  return [];
}

export function setEnabledComposioToolkits(slugs: string[]): string[] {
  const clean = [...new Set(slugs.map((s) => s.trim().toLowerCase()).filter(Boolean))];
  const db = getDb();
  db.prepare(
    `INSERT INTO app_settings (key, value_json, updated_at) VALUES ('composio_enabled_toolkits', ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = datetime('now')`,
  ).run(JSON.stringify(clean));
  sseBus.emit('composio:update', { enabledToolkits: clean });
  return clean;
}

// Only reviewed read operations can execute without a one-time approval.
const READ_ONLY_TOOLS: ReadonlySet<string> = new Set([
  'GMAIL_FETCH_EMAILS',
  'GITHUB_LIST_ISSUES',
]);

export function isReadOnlyComposioTool(toolSlug: string): boolean {
  return READ_ONLY_TOOLS.has(toolSlug);
}

function getComposioHeaders(apiKey: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
  };
}

export function listComposioConnections(): ComposioConnectionRow[] {
  try {
    const db = getDb();
    return db.prepare('SELECT * FROM composio_connections ORDER BY updated_at DESC').all() as unknown as ComposioConnectionRow[];
  } catch {
    return [];
  }
}

export function listComposioToolLogs(): ComposioToolLogRow[] {
  try {
    const db = getDb();
    return db.prepare('SELECT * FROM composio_tool_logs ORDER BY created_at DESC LIMIT 30').all() as unknown as ComposioToolLogRow[];
  } catch {
    return [];
  }
}

export function getComposioState() {
  const apiKey = getSecret('COMPOSIO_API_KEY');
  const connections = listComposioConnections();
  const enabledToolkits = getEnabledComposioToolkits();
  const connBySlug = new Map(connections.map((c) => [c.toolkit_slug, c]));

  return {
    configured: Boolean(apiKey),
    userId: getComposioUserId(),
    enabledToolkits,
    connections,
    recentLogs: listComposioToolLogs(),
    curatedToolkits: CURATED_COMPOSIO_TOOLKITS.map((t) => {
      const conn = connBySlug.get(t.slug);
      return {
        ...t,
        connectedStatus: conn?.status ?? null,
        connectedAccountId: conn?.connected_account_id ?? null,
        enabledForAgent: enabledToolkits.includes(t.slug),
      };
    }),
  };
}

export async function listComposioToolkits(
  params: { search?: string; category?: string; limit?: number } = {},
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<{ items: ComposioToolkitItem[]; liveRemote: boolean }> {
  const apiKey = getSecret('COMPOSIO_API_KEY');
  const connections = listComposioConnections();
  const connBySlug = new Map(connections.map((c) => [c.toolkit_slug.toLowerCase(), c]));
  const enabledSet = new Set(getEnabledComposioToolkits());

  let baseItems: ComposioToolkitItem[] = CURATED_COMPOSIO_TOOLKITS;
  let liveRemote = false;

  if (apiKey) {
    if (cachedRemoteToolkits && Date.now() - cachedRemoteToolkits.fetchedAt < 10 * 60_000) {
      baseItems = cachedRemoteToolkits.items;
      liveRemote = true;
    } else {
      try {
        const res = await fetchImpl(`${COMPOSIO_API_V3}/toolkits?limit=150`, {
          headers: getComposioHeaders(apiKey),
          signal: AbortSignal.timeout(8000),
        });
        if (res.ok) {
          const json = (await res.json()) as {
            items?: Array<{
              slug?: string;
              name?: string;
              auth_schemes?: string[];
              meta?: { categories?: string[]; description?: string; logo?: string };
            }>;
          };
          const parsed = (json.items ?? [])
            .filter((x) => Boolean(x.slug))
            .map((x) => ({
              slug: x.slug!.toLowerCase(),
              name: x.name || x.slug!,
              category: x.meta?.categories?.[0] ?? 'other',
              description: x.meta?.description ?? '',
              logo: x.meta?.logo ?? null,
              authSchemes: x.auth_schemes ?? [],
            }));
          if (parsed.length > 0) {
            cachedRemoteToolkits = { fetchedAt: Date.now(), items: parsed };
            baseItems = parsed;
            liveRemote = true;
          }
        }
      } catch {
        // Fallback cleanly to curated catalog
      }
    }
  }

  const q = (params.search ?? '').trim().toLowerCase();
  const cat = (params.category ?? '').trim().toLowerCase();
  const limit = Math.min(200, Math.max(1, params.limit ?? 60));

  const filtered = baseItems
    .filter((t) => {
      if (cat && cat !== 'all' && !t.category.toLowerCase().includes(cat)) return false;
      if (q && !t.name.toLowerCase().includes(q) && !t.slug.toLowerCase().includes(q) && !t.description.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    })
    .slice(0, limit)
    .map((t) => {
      const conn = connBySlug.get(t.slug);
      return {
        ...t,
        connectedStatus: conn?.status ?? null,
        connectedAccountId: conn?.connected_account_id ?? null,
        enabledForAgent: enabledSet.has(t.slug),
      };
    });

  return { items: filtered, liveRemote };
}

export async function syncComposioConnections(
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<{ ok: boolean; syncedCount: number; connections: ComposioConnectionRow[]; note: string }> {
  const apiKey = getSecret('COMPOSIO_API_KEY');
  if (!apiKey) {
    return { ok: false, syncedCount: 0, connections: listComposioConnections(), note: 'COMPOSIO_API_KEY belum dikonfigurasi' };
  }

  const userId = getComposioUserId();
  try {
    const res = await fetchImpl(`${COMPOSIO_API_V3}/connected_accounts?user_ids=${encodeURIComponent(userId)}`, {
      headers: getComposioHeaders(apiKey),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      return { ok: false, syncedCount: 0, connections: listComposioConnections(), note: `Composio HTTP ${res.status}` };
    }
    const json = (await res.json()) as {
      items?: Array<{
        id?: string;
        status?: string;
        toolkit?: { slug?: string; name?: string };
        auth_config?: { id?: string };
      }>;
    };

    const db = getDb();
    const upsert = db.prepare(
      `INSERT INTO composio_connections (id, toolkit_slug, toolkit_name, auth_config_id, connected_account_id, status, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(toolkit_slug) DO UPDATE SET
         toolkit_name = excluded.toolkit_name,
         auth_config_id = COALESCE(excluded.auth_config_id, composio_connections.auth_config_id),
         connected_account_id = excluded.connected_account_id,
         status = excluded.status,
         updated_at = datetime('now')`,
    );

    let syncedCount = 0;
    for (const acc of json.items ?? []) {
      const slug = acc.toolkit?.slug?.toLowerCase();
      if (!slug || !acc.id) continue;
      const rawStatus = (acc.status ?? '').toUpperCase();
      const mappedStatus: ComposioConnectionRow['status'] =
        rawStatus === 'ACTIVE'
          ? 'active'
          : rawStatus === 'EXPIRED'
            ? 'expired'
            : rawStatus === 'FAILED'
              ? 'failed'
              : 'pending';
      upsert.run(
        `comp_${slug}`,
        slug,
        acc.toolkit?.name || slug,
        acc.auth_config?.id ?? null,
        acc.id,
        mappedStatus,
      );
      syncedCount++;
    }

    const updated = listComposioConnections();
    sseBus.emit('composio:update', { syncedCount });
    return { ok: true, syncedCount, connections: updated, note: `${syncedCount} koneksi aplikasi disinkronkan dari Composio` };
  } catch (err) {
    return {
      ok: false,
      syncedCount: 0,
      connections: listComposioConnections(),
      note: err instanceof Error ? err.message : 'Gagal sinkronisasi Composio',
    };
  }
}

export async function initiateToolkitConnection(
  toolkitSlug: string,
  callbackUrl?: string,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<{
  ok: boolean;
  redirectUrl?: string;
  connectedAccountId?: string;
  authConfigId?: string;
  error?: string;
}> {
  const apiKey = getSecret('COMPOSIO_API_KEY');
  if (!apiKey) {
    return { ok: false, error: 'Masukkan COMPOSIO_API_KEY di Pengaturan (Settings) terlebih dahulu.' };
  }

  const slug = toolkitSlug.trim().toLowerCase();
  if (!/^[a-z0-9_-]+$/.test(slug)) {
    return { ok: false, error: 'Slug toolkit tidak valid.' };
  }

  const userId = getComposioUserId();

  try {
    // 1. Find existing auth config for toolkit
    let authConfigId: string | null = null;
    const listRes = await fetchImpl(`${COMPOSIO_API_V3}/auth_configs?toolkit_slug=${encodeURIComponent(slug)}`, {
      headers: getComposioHeaders(apiKey),
      signal: AbortSignal.timeout(8000),
    });
    if (listRes.ok) {
      const listJson = (await listRes.json()) as { items?: Array<{ id?: string }> };
      authConfigId = listJson.items?.[0]?.id ?? null;
    }

    // 2. Create Composio Managed Auth config automatically if none exists yet
    if (!authConfigId) {
      const createRes = await fetchImpl(`${COMPOSIO_API_V3}/auth_configs`, {
        method: 'POST',
        headers: getComposioHeaders(apiKey),
        body: JSON.stringify({
          toolkit: { slug },
          auth_config: {
            type: 'use_composio_managed_auth',
            name: `${slug} Managed Auth`,
          },
        }),
        signal: AbortSignal.timeout(8000),
      });
      if (!createRes.ok) {
        const errBody = await createRes.text().catch(() => '');
        return { ok: false, error: `Gagal membuat Auth Config Composio (${createRes.status}): ${errBody.slice(0, 120)}` };
      }
      const created = (await createRes.json()) as { id?: string; auth_config?: { id?: string } };
      authConfigId = created.id ?? created.auth_config?.id ?? null;
    }

    if (!authConfigId) {
      return { ok: false, error: 'Auth Config ID tidak ditemukan dari Composio.' };
    }

    // 3. Request hosted Connect Link URL
    const linkRes = await fetchImpl(`${COMPOSIO_API_V3_1}/connected_accounts/link`, {
      method: 'POST',
      headers: getComposioHeaders(apiKey),
      body: JSON.stringify({
        auth_config_id: authConfigId,
        user_id: userId,
        ...(callbackUrl ? { callback_url: callbackUrl } : {}),
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!linkRes.ok) {
      const errBody = await linkRes.text().catch(() => '');
      return { ok: false, error: `Gagal membuat Connect Link (${linkRes.status}): ${errBody.slice(0, 120)}` };
    }

    const linkData = (await linkRes.json()) as {
      redirect_url?: string;
      connected_account_id?: string;
    };

    const db = getDb();
    const curated = CURATED_COMPOSIO_TOOLKITS.find((c) => c.slug === slug);
    db.prepare(
      `INSERT INTO composio_connections (id, toolkit_slug, toolkit_name, auth_config_id, connected_account_id, status, redirect_url, updated_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?, datetime('now'))
       ON CONFLICT(toolkit_slug) DO UPDATE SET
         auth_config_id = excluded.auth_config_id,
         connected_account_id = excluded.connected_account_id,
         status = 'pending',
         redirect_url = excluded.redirect_url,
         updated_at = datetime('now')`,
    ).run(
      `comp_${slug}`,
      slug,
      curated?.name ?? slug,
      authConfigId,
      linkData.connected_account_id ?? null,
      linkData.redirect_url ?? null,
    );

    // Ensure toolkit is enabled for agent automatically when connected
    const currentEnabled = getEnabledComposioToolkits();
    if (!currentEnabled.includes(slug)) {
      setEnabledComposioToolkits([...currentEnabled, slug]);
    }

    sseBus.emit('composio:update', { toolkitSlug: slug, status: 'pending' });
    return {
      ok: true,
      redirectUrl: linkData.redirect_url,
      connectedAccountId: linkData.connected_account_id,
      authConfigId,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Koneksi Composio gagal' };
  }
}

export async function disconnectComposioAccount(
  connectionOrAccountId: string,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<{ ok: boolean }> {
  const db = getDb();
  const row = db
    .prepare('SELECT * FROM composio_connections WHERE id = ? OR connected_account_id = ?')
    .get(connectionOrAccountId, connectionOrAccountId) as unknown as ComposioConnectionRow | undefined;

  const apiKey = getSecret('COMPOSIO_API_KEY');
  if (apiKey && row?.connected_account_id) {
    try {
      await fetchImpl(`${COMPOSIO_API_V3}/connected_accounts/${encodeURIComponent(row.connected_account_id)}`, {
        method: 'DELETE',
        headers: getComposioHeaders(apiKey),
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      // Proceed with local disconnect cleanup
    }
  }

  db.prepare('DELETE FROM composio_connections WHERE id = ? OR connected_account_id = ?').run(
    connectionOrAccountId,
    connectionOrAccountId,
  );
  sseBus.emit('composio:update', { disconnected: connectionOrAccountId });
  return { ok: true };
}

export async function listToolkitTools(
  toolkitSlug: string,
  limit = 15,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<ComposioToolItem[]> {
  const slug = toolkitSlug.trim().toLowerCase();
  const cached = cachedToolkitTools.get(slug);
  if (cached && Date.now() - cached.fetchedAt < 10 * 60_000) {
    return cached.tools.slice(0, limit);
  }

  const apiKey = getSecret('COMPOSIO_API_KEY');
  if (!apiKey) return [];

  try {
    const res = await fetchImpl(
      `${COMPOSIO_API_V3_1}/tools?toolkit_slug=${encodeURIComponent(slug)}&toolkit_versions=latest&limit=${30}`,
      {
        headers: getComposioHeaders(apiKey),
        signal: AbortSignal.timeout(8000),
      },
    );
    if (!res.ok) return [];
    const json = (await res.json()) as {
      items?: Array<{
        slug?: string;
        name?: string;
        description?: string;
        input_parameters?: Record<string, unknown>;
        parameters?: Record<string, unknown>;
      }>;
    };
    const tools: ComposioToolItem[] = (json.items ?? [])
      .filter((t) => typeof t.slug === 'string' && /^[A-Z0-9_]+$/.test(t.slug))
      .map((t) => ({
        slug: t.slug!,
        name: t.name || t.slug!,
        description: t.description || '',
        toolkitSlug: slug,
        readOnly: isReadOnlyComposioTool(t.slug!),
        inputParameters: t.input_parameters ?? t.parameters ?? {},
      }));

    cachedToolkitTools.set(slug, { fetchedAt: Date.now(), tools });
    return tools.slice(0, limit);
  } catch {
    return [];
  }
}

export interface ComposioTarget {
  toolkitSlug: string;
  accountId: string;
}

function activeTargets(): ComposioTarget[] {
  const enabled = new Set(getEnabledComposioToolkits());
  const accounts = new Map<string, Set<string>>();
  for (const connection of listComposioConnections()) {
    const toolkit = connection.toolkit_slug;
    if (connection.status !== 'active' || !connection.connected_account_id || !enabled.has(toolkit)) continue;
    const ids = accounts.get(toolkit) ?? new Set<string>();
    ids.add(connection.connected_account_id);
    accounts.set(toolkit, ids);
  }
  return [...accounts].flatMap(([toolkitSlug, ids]) =>
    ids.size === 1 ? [{ toolkitSlug, accountId: [...ids][0] }] : [],
  );
}

export type AgentComposioTool = UnifiedToolDef & { target: ComposioTarget };

export async function getActiveComposioToolsForAgent(
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<AgentComposioTool[]> {
  if (!getSecret('COMPOSIO_API_KEY')) return [];
  const tools: AgentComposioTool[] = [];
  for (const target of activeTargets().slice(0, 4)) {
    const definitions = await listToolkitTools(target.toolkitSlug, 6, fetchImpl);
    for (const tool of definitions) {
      if (tool.inputParameters.type !== 'object') continue;
      tools.push({
        name: `composio__${tool.slug}`,
        description: `[${target.toolkitSlug.toUpperCase()}${tool.readOnly ? ' · READ' : ' · APPROVAL'}] ${tool.description}`,
        parameters: tool.inputParameters,
        target,
      });
    }
  }
  return tools.slice(0, 24);
}

export function summarizeToolResult(raw: unknown): string {
  const str = typeof raw === 'string' ? raw : JSON.stringify(raw);
  if (str.length <= 2200) return str;
  return `${str.slice(0, 2200)}... [truncated ${str.length - 2200} chars]`;
}

type ComposioResult = {
  ok: boolean;
  data?: unknown;
  summary: string;
  error?: string;
  outcome?: 'denied' | 'failed' | 'unknown';
};

function deny(summary: string): ComposioResult {
  return { ok: false, outcome: 'denied', summary, error: summary };
}

function validArguments(schema: Record<string, unknown>, args: unknown): boolean {
  if (schema.type !== 'object' || schema.$async === true || !args || typeof args !== 'object' || Array.isArray(args)) return false;
  try {
    // Tool inputs must use declared fields. Composio schemas often omit additionalProperties.
    let validate = validators.get(schema);
    if (!validate) {
      validate = addFormats(new Ajv()).compile({ ...schema, additionalProperties: false });
      validators.set(schema, validate);
    }
    return validate(args) === true;
  } catch {
    return false;
  }
}

async function executeAuthorizedTool(
  toolSlug: string,
  args: unknown,
  fetchImpl: typeof fetch,
  approvedTarget?: ComposioTarget,
): Promise<ComposioResult> {
  if (typeof toolSlug !== 'string') return deny('Invalid Composio tool slug');
  const cleanSlug = toolSlug.replace(/^composio__/, '').trim().toUpperCase();
  if (!/^[A-Z0-9_]+$/.test(cleanSlug)) return deny('Invalid Composio tool slug');
  if (!approvedTarget && !isReadOnlyComposioTool(cleanSlug)) return deny('Composio tool requires approval');

  const apiKey = getSecret('COMPOSIO_API_KEY');
  if (!apiKey) return deny('COMPOSIO_API_KEY missing');

  const targets = activeTargets().filter(({ toolkitSlug, accountId }) =>
    cleanSlug.startsWith(`${toolkitSlug.toUpperCase()}_`) &&
    (!approvedTarget || (toolkitSlug === approvedTarget.toolkitSlug && accountId === approvedTarget.accountId)),
  );
  if (targets.length !== 1) return deny('Composio requires one active account on an enabled toolkit');
  const { toolkitSlug, accountId } = targets[0];
  const tools = await listToolkitTools(toolkitSlug, 30, fetchImpl);
  const definition = tools.find((tool) => tool.slug === cleanSlug);
  if (!definition) return deny('Composio tool was not discovered');
  if (!validArguments(definition.inputParameters, args)) return deny('Invalid Composio tool arguments');
  if (!activeTargets().some((target) => target.toolkitSlug === toolkitSlug && target.accountId === accountId)) {
    return deny('Composio account changed before execution');
  }

  let outcome: ComposioResult['outcome'] = 'unknown';
  let summary = 'Composio execution outcome is unknown';
  let data: unknown;
  let ok = false;
  try {
    const res = await fetchImpl(`${COMPOSIO_API_V3}/tools/execute/${encodeURIComponent(cleanSlug)}`, {
      method: 'POST',
      headers: getComposioHeaders(apiKey),
      body: JSON.stringify({
        user_id: getComposioUserId(),
        connected_account_id: accountId,
        arguments: args,
        version: 'latest',
      }),
      signal: AbortSignal.timeout(15000),
    });
    const result: unknown = await res.json().catch(() => null);
    const successful = result && typeof result === 'object' && 'successful' in result ? result.successful : undefined;
    if (res.ok && successful === true) {
      ok = true;
      summary = 'Composio confirmed success';
      data = result;
      outcome = undefined;
    } else if (successful === false || (res.status >= 400 && res.status < 500 && res.status !== 408)) {
      outcome = 'failed';
      summary = `Composio rejected the action (HTTP ${res.status})`;
    }
  } catch {
    // A timeout or lost response does not establish whether the provider executed the action.
  }

  const status = ok ? 'success' : 'failed';
  getDb().prepare(
    `INSERT INTO composio_tool_logs (id, tool_slug, toolkit_slug, arguments_json, status, result_summary)
     VALUES (?, ?, ?, '{}', ?, ?)`,
  ).run(`clg_${crypto.randomUUID()}`, cleanSlug, toolkitSlug, status, summary);
  sseBus.emit('composio:update', { toolSlug: cleanSlug, status });
  return ok ? { ok, data, summary } : { ok, outcome, summary, error: summary };
}

export function executeComposioTool(
  toolSlug: string,
  args: unknown,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<ComposioResult> {
  return executeAuthorizedTool(toolSlug, args, fetchImpl);
}

export async function executeApprovedComposioTool(
  auditId: string,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<ComposioResult | null> {
  const db = getDb();
  // Use a non-success state until the provider confirms success. A crash leaves the claim consumed.
  const audit = db.prepare(
    `UPDATE agent_audit_logs SET status = 'failed', undo_payload_json = ?
     WHERE id = ? AND tool_name = 'composio_execute_tool' AND status = 'pending_approval'
     RETURNING tool_args_json, created_at >= datetime('now', ?) AS valid_window
     `,
  ).get(JSON.stringify({ kind: 'none', outcome: 'unknown' }), auditId, `-${APPROVAL_WINDOW_MINUTES} minutes`) as
    { tool_args_json: string; valid_window: number } | undefined;
  if (!audit) return null;
  if (!audit.valid_window) return deny('Composio approval expired');

  const request = JSON.parse(audit.tool_args_json) as {
    toolSlug: string;
    arguments: unknown;
    target?: ComposioTarget;
  };
  if (!request.target?.toolkitSlug || !request.target.accountId) {
    return deny('Composio approval requires a bound account. Create a new approval.');
  }
  return executeAuthorizedTool(request.toolSlug, request.arguments, fetchImpl, request.target);
}
