import { getDb } from '../db/connection.ts';
import { sseBus } from '../lib/sse.ts';
import { getSecret } from './secret.service.ts';
import type { UnifiedToolDef } from './ai-provider.service.ts';

const COMPOSIO_API_V3 = 'https://backend.composio.dev/api/v3';
const COMPOSIO_API_V3_1 = 'https://backend.composio.dev/api/v3.1';

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
    return row ? String(JSON.parse(row.value_json)) : 'arthur_reezan';
  } catch {
    return 'arthur_reezan';
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
  return ['gmail', 'googlecalendar', 'googledocs', 'googlesheets', 'notion', 'github'];
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

/**
 * Classifies whether a Composio action slug is safe read-only (auto-executable inside ReAct loop)
 * or mutating/outbound (must pause at an Approval Card before execution).
 */
export function isReadOnlyComposioTool(toolSlug: string): boolean {
  const upper = toolSlug.toUpperCase();
  if (/(SEND|CREATE|UPDATE|DELETE|REMOVE|POST|WRITE|REPLY|PATCH|PUT|EXECUTE|DISPATCH|PUBLISH|UPLOAD|ADD|INSERT|MODIFY|ARCHIVE|CANCEL|REVOKE)/.test(upper)) {
    return false;
  }
  return /(^|_)(GET|LIST|FETCH|SEARCH|FIND|READ|CHECK|VIEW|PROFILE|INFO|SUMMARY|QUERY)(_|$)/.test(upper);
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
      `${COMPOSIO_API_V3_1}/tools?toolkit_slug=${encodeURIComponent(slug)}&toolkit_versions=latest&limit=${Math.min(30, limit)}`,
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
      .filter((t) => Boolean(t.slug))
      .map((t) => ({
        slug: t.slug!,
        name: t.name || t.slug!,
        description: t.description || '',
        toolkitSlug: slug,
        readOnly: isReadOnlyComposioTool(t.slug!),
        inputParameters: t.input_parameters ?? t.parameters ?? { type: 'object', properties: {} },
      }));

    cachedToolkitTools.set(slug, { fetchedAt: Date.now(), tools });
    return tools.slice(0, limit);
  } catch {
    return [];
  }
}

export async function getActiveComposioToolsForAgent(
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<UnifiedToolDef[]> {
  const apiKey = getSecret('COMPOSIO_API_KEY');
  if (!apiKey) return [];

  const activeConns = listComposioConnections().filter((c) => c.status === 'active');
  const enabledSet = new Set(getEnabledComposioToolkits());
  const targetSlugs = activeConns.map((c) => c.toolkit_slug).filter((s) => enabledSet.has(s)).slice(0, 4);
  if (targetSlugs.length === 0) return [];

  const allTools: UnifiedToolDef[] = [];
  for (const slug of targetSlugs) {
    const tools = await listToolkitTools(slug, 6, fetchImpl);
    for (const t of tools) {
      allTools.push({
        name: `composio__${t.slug}`,
        description: `[${slug.toUpperCase()}${t.readOnly ? ' · READ' : ' · WRITE/APPROVAL'}] ${t.description}`,
        parameters: t.inputParameters,
      });
    }
  }
  return allTools.slice(0, 24);
}

export function summarizeToolResult(raw: unknown): string {
  const str = typeof raw === 'string' ? raw : JSON.stringify(raw);
  if (str.length <= 2200) return str;
  return `${str.slice(0, 2200)}... [truncated ${str.length - 2200} chars]`;
}

export async function executeComposioTool(
  toolSlug: string,
  args: Record<string, unknown>,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<{ ok: boolean; data?: unknown; summary: string; error?: string }> {
  const cleanSlug = toolSlug.replace(/^composio__/, '').trim().toUpperCase();
  if (!/^[A-Z0-9_]+$/.test(cleanSlug)) {
    return { ok: false, summary: 'Slug tool Composio tidak valid.', error: 'Invalid tool slug' };
  }

  const apiKey = getSecret('COMPOSIO_API_KEY');
  if (!apiKey) {
    return { ok: false, summary: 'COMPOSIO_API_KEY belum diisi.', error: 'COMPOSIO_API_KEY missing' };
  }

  const toolkitSlug = cleanSlug.split('_')[0]?.toLowerCase() ?? 'composio';
  const userId = getComposioUserId();
  const db = getDb();
  const logId = `clg_${crypto.randomUUID().slice(0, 8)}`;

  try {
    const res = await fetchImpl(`${COMPOSIO_API_V3}/tools/execute/${encodeURIComponent(cleanSlug)}`, {
      method: 'POST',
      headers: getComposioHeaders(apiKey),
      body: JSON.stringify({
        user_id: userId,
        arguments: args,
        version: 'latest',
      }),
      signal: AbortSignal.timeout(15000),
    });

    const json = await res.json().catch(() => ({}));
    const summary = summarizeToolResult(json);

    if (!res.ok) {
      db.prepare(
        `INSERT INTO composio_tool_logs (id, tool_slug, toolkit_slug, arguments_json, status, result_summary)
         VALUES (?, ?, ?, ?, 'failed', ?)`,
      ).run(logId, cleanSlug, toolkitSlug, JSON.stringify(args), summary);
      sseBus.emit('composio:update', { toolSlug: cleanSlug, status: 'failed' });
      return { ok: false, data: json, summary, error: `HTTP ${res.status}` };
    }

    db.prepare(
      `INSERT INTO composio_tool_logs (id, tool_slug, toolkit_slug, arguments_json, status, result_summary)
       VALUES (?, ?, ?, ?, 'success', ?)`,
    ).run(logId, cleanSlug, toolkitSlug, JSON.stringify(args), summary);
    sseBus.emit('composio:update', { toolSlug: cleanSlug, status: 'success' });
    return { ok: true, data: json, summary };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : 'Composio execution error';
    db.prepare(
      `INSERT INTO composio_tool_logs (id, tool_slug, toolkit_slug, arguments_json, status, result_summary)
       VALUES (?, ?, ?, ?, 'failed', ?)`,
    ).run(logId, cleanSlug, toolkitSlug, JSON.stringify(args), errMsg);
    return { ok: false, summary: errMsg, error: errMsg };
  }
}
