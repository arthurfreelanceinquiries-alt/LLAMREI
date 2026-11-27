import { useEffect, useState } from 'react';
import { apiRequest } from '../../lib/api-client';
import type { ComposioState, ComposioToolItem, ComposioToolkitItem } from '../../types/llamrei';

interface Props {
  composio: ComposioState;
  onRefreshBootstrap: () => Promise<void>;
  onOpenSettings: () => void;
  onAskJarvis: (prompt: string) => void;
}

const CATEGORIES = [
  { id: 'all', label: 'Semua' },
  { id: 'google', label: 'Google Workspace' },
  { id: 'productivity', label: 'Produktivitas' },
  { id: 'communication', label: 'Komunikasi' },
  { id: 'developer', label: 'Developer' },
  { id: 'social', label: 'Sosial & Media' },
];

export function IntegrationsHubView({ composio, onRefreshBootstrap, onOpenSettings, onAskJarvis }: Props) {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [toolkits, setToolkits] = useState<ComposioToolkitItem[]>(composio.curatedToolkits);
  const [liveRemote, setLiveRemote] = useState(false);
  const [busySlug, setBusySlug] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [statusBanner, setStatusBanner] = useState<string | null>(null);
  const [pendingRedirectUrl, setPendingRedirectUrl] = useState<string | null>(null);

  // Tool inspector state
  const [inspectSlug, setInspectSlug] = useState<string | null>(null);
  const [inspectedTools, setInspectedTools] = useState<ComposioToolItem[]>([]);
  const [loadingTools, setLoadingTools] = useState(false);
  const [execArgsJson, setExecArgsJson] = useState('{}');
  const [execResult, setExecResult] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const qs = new URLSearchParams();
        if (search.trim()) qs.set('search', search.trim());
        if (category !== 'all') qs.set('category', category);
        qs.set('limit', '90');
        const res = await apiRequest<{ items: ComposioToolkitItem[]; liveRemote: boolean }>(
          `/api/composio/toolkits?${qs.toString()}`,
        );
        if (active) {
          setToolkits(res.items);
          setLiveRemote(res.liveRemote);
        }
      } catch {
        if (active) setToolkits(composio.curatedToolkits);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [search, category, composio.curatedToolkits, composio.connections]);

  const handleConnect = async (slug: string) => {
    setBusySlug(slug);
    setStatusBanner(null);
    setPendingRedirectUrl(null);
    try {
      const res = await apiRequest<{ ok: boolean; redirectUrl?: string; error?: string }>('/api/composio/connect', {
        method: 'POST',
        body: { toolkitSlug: slug, callbackUrl: window.location.href },
      });
      if (res.redirectUrl) {
        setPendingRedirectUrl(res.redirectUrl);
        window.open(res.redirectUrl, '_blank', 'noopener,noreferrer');
        setStatusBanner(`Link OAuth untuk "${slug}" dibuat! Selesaikan login di tab baru lalu klik "↻ Sync Status".`);
      }
      await onRefreshBootstrap();
    } catch (err) {
      setStatusBanner(err instanceof Error ? err.message : 'Gagal menghubungkan aplikasi');
    } finally {
      setBusySlug(null);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    setStatusBanner(null);
    try {
      const res = await apiRequest<{ ok: boolean; syncedCount: number; note: string }>('/api/composio/sync', {
        method: 'POST',
        body: {},
      });
      setStatusBanner(res.note);
      await onRefreshBootstrap();
    } catch (err) {
      setStatusBanner(err instanceof Error ? err.message : 'Gagal sync koneksi Composio');
    } finally {
      setSyncing(false);
    }
  };

  const handleDisconnect = async (connId: string) => {
    await apiRequest(`/api/composio/connections/${encodeURIComponent(connId)}`, { method: 'DELETE' });
    setStatusBanner('Koneksi aplikasi diputuskan.');
    await onRefreshBootstrap();
  };

  const handleToggleAgentExpose = async (slug: string) => {
    const current = new Set(composio.enabledToolkits);
    if (current.has(slug)) current.delete(slug);
    else current.add(slug);
    await apiRequest('/api/composio/enabled-toolkits', {
      method: 'PATCH',
      body: { toolkits: [...current] },
    });
    await onRefreshBootstrap();
  };

  const handleInspectTools = async (slug: string) => {
    setInspectSlug(slug);
    setLoadingTools(true);
    setExecResult(null);
    try {
      const res = await apiRequest<{ tools: ComposioToolItem[] }>(
        `/api/composio/tools?toolkitSlug=${encodeURIComponent(slug)}&limit=15`,
      );
      setInspectedTools(res.tools);
    } catch {
      setInspectedTools([]);
    } finally {
      setLoadingTools(false);
    }
  };

  const handleExecuteTool = async (toolSlug: string) => {
    setExecResult('Menjalankan...');
    try {
      const parsedArgs = JSON.parse(execArgsJson || '{}') as Record<string, unknown>;
      const res = await apiRequest<{ ok: boolean; summary: string }>('/api/composio/tools/execute', {
        method: 'POST',
        body: { toolSlug, arguments: parsedArgs },
      });
      setExecResult(res.summary);
      await onRefreshBootstrap();
    } catch (err) {
      setExecResult(err instanceof Error ? err.message : 'Eksekusi gagal');
    }
  };

  const activeCount = composio.connections.filter((c) => c.status === 'active').length;

  return (
    <div className="space-y-3">
      {/* Header */}
      <div
        className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b"
        style={{ borderColor: 'var(--border-subtle)' }}
      >
        <div>
          <div className="text-xs font-mono-num" style={{ color: 'var(--accent)' }}>
            COMPOSIO GATEWAY // 150+ APP INTEGRATIONS FOR JARVIS & LLAMREI
          </div>
          <h1 className="text-sm font-bold">
            Hubungkan Gmail, Google Calendar, Docs, Sheets, Notion, GitHub & 150+ Aplikasi
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void handleSync()}
            disabled={syncing || !composio.configured}
            className="px-2.5 py-1 rounded text-xs font-mono-num border cursor-pointer disabled:opacity-50"
            style={{ background: 'var(--bg-card)', borderColor: 'var(--border-subtle)', color: 'var(--accent)' }}
          >
            {syncing ? 'Menyinkronkan...' : '↻ Sync Status'}
          </button>
          <button
            onClick={onOpenSettings}
            className="px-2.5 py-1 rounded text-xs font-mono-num font-bold cursor-pointer"
            style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
          >
            🔑 {composio.configured ? 'Atur Key Composio' : 'Pasang COMPOSIO_API_KEY'}
          </button>
        </div>
      </div>

      {/* Onboarding / Status Banner */}
      {!composio.configured && (
        <div
          className="themed-card p-3 text-xs space-y-1.5 border"
          style={{ borderColor: 'rgba(245, 158, 11, 0.45)', background: 'rgba(245, 158, 11, 0.08)' }}
        >
          <div className="font-bold text-amber-300">
            ⚡ Mode Katalog Siap Pakai — Pasang COMPOSIO_API_KEY (Gratis 100.000 tool call/bulan)
          </div>
          <p style={{ color: 'var(--text-secondary)' }}>
            Daftar gratis di <strong>composio.dev</strong> (Hobby Tier $0/bulan), salin Project API Key, lalu masukkan ke{' '}
            <strong>⚙️ Pengaturan → COMPOSIO_API_KEY</strong>. Setelah aktif, semua tombol Connect OAuth dan eksekusi 150+ aplikasi langsung berjalan dari Jarvis/Llamrei (tetap dilindungi <em>Approval Card</em> untuk aksi kirim/ubah).
          </p>
        </div>
      )}

      {statusBanner && (
        <div
          className="p-2.5 rounded-lg border text-xs flex flex-wrap items-center justify-between gap-2"
          style={{ background: 'var(--accent-soft)', borderColor: 'var(--border-accent)', color: 'var(--accent)' }}
        >
          <span>{statusBanner}</span>
          {pendingRedirectUrl && (
            <a
              href={pendingRedirectUrl}
              target="_blank"
              rel="noreferrer"
              className="px-2 py-0.5 rounded font-bold"
              style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
            >
              Buka Halaman OAuth ↗
            </a>
          )}
        </div>
      )}

      {/* Connected Accounts Strip */}
      <div className="themed-card p-3 space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span className="font-mono-num font-bold" style={{ color: 'var(--text-secondary)' }}>
            🔗 AKUN TERHUBUNG ({activeCount} aktif · {composio.connections.length} total · User ID: {composio.userId})
          </span>
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {liveRemote ? '🟢 Katalog Live Composio' : '📦 Katalog Kurasi Utama'}
          </span>
        </div>

        {composio.connections.length === 0 ? (
          <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Belum ada aplikasi terhubung. Klik <strong>Connect</strong> pada kartu aplikasi di bawah untuk memulai OAuth.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
            {composio.connections.map((conn) => (
              <div
                key={conn.id}
                className="p-2.5 rounded border flex items-center justify-between gap-2 text-xs"
                style={{ background: 'var(--bg-void)', borderColor: 'var(--border-subtle)' }}
              >
                <div className="min-w-0">
                  <div className="font-semibold truncate">{conn.toolkit_name}</div>
                  <div className="font-mono-num text-[11px]" style={{ color: 'var(--text-muted)' }}>
                    {conn.toolkit_slug} ·{' '}
                    <span style={{ color: conn.status === 'active' ? 'var(--accent)' : '#fbbf24' }}>
                      {conn.status.toUpperCase()}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {conn.status === 'pending' && conn.redirect_url && (
                    <a
                      href={conn.redirect_url}
                      target="_blank"
                      rel="noreferrer"
                      className="px-2 py-1 rounded text-[11px] font-mono-num border"
                      style={{ borderColor: 'var(--border-accent)', color: 'var(--accent)' }}
                    >
                      OAuth ↗
                    </a>
                  )}
                  <button
                    onClick={() => void handleInspectTools(conn.toolkit_slug)}
                    className="px-2 py-1 rounded text-[11px] font-mono-num border cursor-pointer"
                    style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
                  >
                    Tools
                  </button>
                  <button
                    onClick={() => void handleDisconnect(conn.id)}
                    className="px-2 py-1 rounded text-[11px] font-mono-num bg-rose-500/15 text-rose-300 border border-rose-500/30 cursor-pointer"
                  >
                    Putus
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Filter & Search Bar */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Cari 150+ aplikasi (Gmail, Calendar, Notion, GitHub, Slack, Sheets, X...)"
          className="flex-1 min-w-[240px] px-3 py-1.5 rounded-lg text-xs border outline-none"
          style={{ background: 'var(--bg-card)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
        />
        <div className="flex flex-wrap gap-1">
          {CATEGORIES.map((c) => (
            <button
              key={c.id}
              onClick={() => setCategory(c.id)}
              className="px-2.5 py-1 rounded text-xs font-mono-num border cursor-pointer"
              style={
                category === c.id
                  ? { background: 'var(--accent-soft)', borderColor: 'var(--border-accent)', color: 'var(--accent)' }
                  : { background: 'var(--bg-card)', borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }
              }
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {/* Toolkit Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2.5">
        {toolkits.map((tk) => {
          const isActive = tk.connectedStatus === 'active';
          const isPending = tk.connectedStatus === 'pending';
          const enabledForAgent = composio.enabledToolkits.includes(tk.slug);

          return (
            <div key={tk.slug} className="themed-card p-3 flex flex-col justify-between gap-2.5 text-xs">
              <div className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    {tk.logo && <img src={tk.logo} alt={tk.name} className="w-5 h-5 rounded object-contain bg-white/10" />}
                    <span className="font-bold truncate">{tk.name}</span>
                  </div>
                  <span
                    className="px-1.5 py-0.5 rounded font-mono-num text-[10px]"
                    style={{
                      background: isActive
                        ? 'rgba(0, 217, 146, 0.15)'
                        : isPending
                          ? 'rgba(245, 158, 11, 0.15)'
                          : 'rgba(255,255,255,0.06)',
                      color: isActive ? '#00d992' : isPending ? '#fbbf24' : 'var(--text-muted)',
                    }}
                  >
                    {isActive ? 'ACTIVE' : isPending ? 'PENDING OAUTH' : tk.category.toUpperCase()}
                  </span>
                </div>
                <p className="line-clamp-2 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                  {tk.description || `Integrasi toolkit ${tk.name} (${tk.slug}) via Composio.`}
                </p>
              </div>

              <div className="flex items-center justify-between gap-1.5 pt-1 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                <button
                  onClick={() => void handleToggleAgentExpose(tk.slug)}
                  className="px-2 py-1 rounded text-[11px] font-mono-num border cursor-pointer"
                  style={
                    enabledForAgent
                      ? { background: 'var(--accent-soft)', borderColor: 'var(--border-accent)', color: 'var(--accent)' }
                      : { background: 'var(--bg-void)', borderColor: 'var(--border-subtle)', color: 'var(--text-muted)' }
                  }
                  title="Izinkan Jarvis/Llamrei melihat tool dari aplikasi ini"
                >
                  {enabledForAgent ? '✓ Agen On' : 'Agen Off'}
                </button>
                <div className="flex items-center gap-1">
                  {composio.configured && (
                    <button
                      onClick={() => void handleInspectTools(tk.slug)}
                      className="px-2 py-1 rounded text-[11px] font-mono-num border cursor-pointer hover:bg-white/5"
                      style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
                    >
                      Tools
                    </button>
                  )}
                  <button
                    onClick={() => void handleConnect(tk.slug)}
                    disabled={busySlug === tk.slug}
                    className="px-2.5 py-1 rounded text-[11px] font-mono-num font-bold cursor-pointer disabled:opacity-50"
                    style={{
                      background: isActive ? 'var(--bg-elevated)' : 'var(--accent)',
                      color: isActive ? 'var(--text-primary)' : 'var(--accent-fg)',
                    }}
                  >
                    {busySlug === tk.slug ? '...' : isActive ? 'Reconnect' : 'Connect'}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Tool Inspector Modal */}
      {inspectSlug && (
        <div
          className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setInspectSlug(null)}
        >
          <div
            className="w-full max-w-2xl rounded-xl border p-4 space-y-3 max-h-[85vh] overflow-y-auto themed-scroll text-xs"
            style={{ background: 'var(--bg-panel)', borderColor: 'var(--border-accent)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b pb-2" style={{ borderColor: 'var(--border-subtle)' }}>
              <div>
                <div className="font-mono-num font-bold" style={{ color: 'var(--accent)' }}>
                  INSPEKSI TOOLS COMPOSIO // {inspectSlug.toUpperCase()}
                </div>
                <div style={{ color: 'var(--text-muted)' }}>
                  Tool READ otomatis dipakai agen; tool WRITE/SEND wajib Approval Card.
                </div>
              </div>
              <button onClick={() => setInspectSlug(null)} className="px-2 py-1 rounded bg-white/5 cursor-pointer">
                Tutup
              </button>
            </div>

            <div className="space-y-1">
              <div className="font-semibold">Argumen JSON Uji Coba (Opsional)</div>
              <textarea
                rows={2}
                value={execArgsJson}
                onChange={(e) => setExecArgsJson(e.target.value)}
                className="w-full p-2 rounded border font-mono-num outline-none"
                style={{ background: 'var(--bg-void)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
              />
            </div>

            {loadingTools ? (
              <div className="py-4 text-center font-mono-num">Memuat daftar tool {inspectSlug}...</div>
            ) : inspectedTools.length === 0 ? (
              <div className="py-4 text-center" style={{ color: 'var(--text-muted)' }}>
                Tidak ada tool ditemukan (pastikan COMPOSIO_API_KEY valid).
              </div>
            ) : (
              <div className="space-y-2">
                {inspectedTools.map((tool) => (
                  <div
                    key={tool.slug}
                    className="p-2.5 rounded border space-y-1.5"
                    style={{ background: 'var(--bg-card)', borderColor: 'var(--border-subtle)' }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono-num font-bold" style={{ color: 'var(--accent)' }}>
                        {tool.slug}
                      </span>
                      <span
                        className="px-1.5 py-0.5 rounded font-mono-num text-[10px]"
                        style={{
                          background: tool.readOnly ? 'rgba(0,217,146,0.12)' : 'rgba(245,158,11,0.15)',
                          color: tool.readOnly ? '#00d992' : '#fbbf24',
                        }}
                      >
                        {tool.readOnly ? 'AUTO READ' : 'APPROVAL WRITE'}
                      </span>
                    </div>
                    <p style={{ color: 'var(--text-secondary)' }}>{tool.description}</p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => void handleExecuteTool(tool.slug)}
                        className="px-2.5 py-1 rounded font-mono-num font-bold cursor-pointer"
                        style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
                      >
                        ▶ Test Jalankan
                      </button>
                      <button
                        onClick={() => {
                          setInspectSlug(null);
                          onAskJarvis(`Gunakan ${inspectSlug} (${tool.slug}) untuk `);
                        }}
                        className="px-2.5 py-1 rounded font-mono-num border cursor-pointer"
                        style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
                      >
                        ✨ Suruh Jarvis Pakai Tool Ini
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {execResult && (
              <pre
                className="p-2.5 rounded border font-mono-num text-[11px] overflow-x-auto whitespace-pre-wrap"
                style={{ background: 'var(--bg-void)', borderColor: 'var(--border-accent)', color: 'var(--text-primary)' }}
              >
                {execResult}
              </pre>
            )}
          </div>
        </div>
      )}

      {/* Recent Tool Logs */}
      {composio.recentLogs.length > 0 && (
        <div className="themed-card p-3 space-y-2 text-xs">
          <div className="font-mono-num font-bold" style={{ color: 'var(--text-secondary)' }}>
            📜 LOG EKSEKUSI COMPOSIO TERBARU
          </div>
          <div className="space-y-1.5">
            {composio.recentLogs.slice(0, 8).map((log) => (
              <div
                key={log.id}
                className="p-2 rounded border flex flex-col gap-1"
                style={{ background: 'var(--bg-void)', borderColor: 'var(--border-subtle)' }}
              >
                <div className="flex items-center justify-between font-mono-num">
                  <span style={{ color: 'var(--accent)' }}>{log.tool_slug}</span>
                  <span style={{ color: log.status === 'success' ? '#00d992' : '#f87171' }}>
                    {log.status.toUpperCase()} · {log.created_at}
                  </span>
                </div>
                {log.result_summary && (
                  <div className="truncate font-mono-num text-[11px]" style={{ color: 'var(--text-muted)' }}>
                    {log.result_summary}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
