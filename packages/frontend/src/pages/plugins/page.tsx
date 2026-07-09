/* Plugin 插件管理页 — /plugins
 *
 * 功能：
 * - Plugin CRUD（安装/卸载/启禁用）
 * - 扫描 plugins/ 目录注册 plugin.yaml
 * - 查看插件详情（能力/钩子/依赖/权限）
 * - 插件生命周期管理（激活/停用）
 * - 钩子执行状态查看
 */

import { useState, useEffect, useCallback } from 'react';
import {
  Plus,
  Trash2,
  Zap,
  Package,
  Wrench,
  XCircle,
  ChevronDown,
  Loader2,
  Eye,
  EyeOff,
  Search,
  Download,
  Upload,
  Check,
  FileSearch,
  Play,
  Square,
  AlertTriangle,
  Shield,
  Link2,
  Layers,
  Clock,
  Terminal,
  FolderOpen,
  Globe,
  RefreshCw,
  ExternalLink,
} from 'lucide-react';

// ── 类型 ──────────────────────────────────────────────────────────────────

type PluginState = 'discovered' | 'installed' | 'active' | 'error' | 'upgrading';

interface PluginCapability {
  type: string;
  name: string;
  description?: string;
  entry?: string;
  config?: Record<string, unknown>;
}

interface PluginHook {
  name: string;
  event: string;
  command: string;
  timeout?: number;
  blocking?: boolean;
}

interface PluginDependency {
  pluginId: string;
  version?: string;
  required: boolean;
}

interface PluginPermission {
  type: string;
  scope: string;
  action?: string;
}

interface PluginSummary {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  state: PluginState;
  enabled: boolean;
  capabilities: PluginCapability[];
  tags?: string[];
  icon?: string;
  createdAt: string;
  updatedAt: string;
}

interface PluginDefinition extends PluginSummary {
  manifest: {
    id: string;
    name: string;
    version: string;
    description?: string;
    author?: string;
    license?: string;
    homepage?: string;
    requires?: string;
    runnerId?: string;
    capabilities?: PluginCapability[];
    hooks?: PluginHook[];
    dependencies?: PluginDependency[];
    permissions?: PluginPermission[];
    tags?: string[];
    icon?: string;
  };
  installedAt?: string;
  activatedAt?: string;
  statusMessage?: string;
  installPath?: string;
}

interface ScannedPluginItem {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  dirName: string;
  dirPath: string;
  alreadyRegistered: boolean;
  valid: { valid: boolean; errors: string[] };
  capabilities?: PluginCapability[];
  hooks?: PluginHook[];
}

interface RegistrySummary {
  total: number;
  active: number;
  inactive: number;
  errors: number;
  loadOrder: string[];
  hookStats: Record<string, { lastRun?: string; successCount: number; failCount: number }>;
}

interface MarketplaceItem {
  id: string;
  slug: string;
  name: string;
  description?: string;
  detailUrl: string;
  worksWith: string[];
  verified: boolean;
  installCount?: number;
  marketplaceName: string;
  pluginId: string;
  installCommand: string;
  source: 'claude.com';
  updatedAt: string;
  installed?: boolean;
}

interface MarketplaceResponse {
  sourceUrl: string;
  refreshedAt: string;
  total: number;
  items: MarketplaceItem[];
}

// ── API 辅助 ──────────────────────────────────────────────────────────────

async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || '请求失败');
  return data;
}

// ── 工具函数 ──────────────────────────────────────────────────────────────

function formatDate(iso: string) {
  try { return new Date(iso).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
  catch { return iso; }
}

function PluginStateBadge({ state }: { state: PluginState }) {
  const config: Record<PluginState, { color: string; bg: string; label: string }> = {
    active: { color: '#22c55e', bg: 'rgba(34,197,94,0.15)', label: '运行中' },
    installed: { color: '#f59e0b', bg: 'rgba(245,158,11,0.15)', label: '已安装' },
    discovered: { color: '#8b5cf6', bg: 'rgba(139,92,246,0.15)', label: '已发现' },
    error: { color: '#ef4444', bg: 'rgba(239,68,68,0.15)', label: '异常' },
    upgrading: { color: '#3b82f6', bg: 'rgba(59,130,246,0.15)', label: '升级中' },
  };
  const c = config[state] || config.installed;
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium" style={{ background: c.bg, color: c.color, border: `1px solid ${c.color}40` }}>
      {c.label}
    </span>
  );
}

// ── 页面主体 ──────────────────────────────────────────────────────────────

export default function PluginsPage() {
  const [activeView, setActiveView] = useState<'installed' | 'marketplace'>('installed');
  const [plugins, setPlugins] = useState<PluginSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // 注册表摘要
  const [registry, setRegistry] = useState<RegistrySummary | null>(null);

  // 展开详情
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [pluginDetail, setPluginDetail] = useState<PluginDefinition | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // 扫描 modal
  const [showScanModal, setShowScanModal] = useState(false);
  const [scannedItems, setScannedItems] = useState<ScannedPluginItem[]>([]);
  const [scanLoading, setScanLoading] = useState(false);
  const [scanError, setScanError] = useState('');
  const [selectedForRegister, setSelectedForRegister] = useState<Set<string>>(new Set());
  const [registering, setRegistering] = useState(false);

  // 安装 modal
  const [showInstallModal, setShowInstallModal] = useState(false);
  const [installPath, setInstallPath] = useState('');
  const [installError, setInstallError] = useState('');
  const [installing, setInstalling] = useState(false);

  // 卸载确认
  const [uninstalling, setUninstalling] = useState<string | null>(null);

  // Claude 市场
  const [marketplace, setMarketplace] = useState<MarketplaceResponse | null>(null);
  const [marketLoading, setMarketLoading] = useState(true);
  const [marketRefreshing, setMarketRefreshing] = useState(false);
  const [marketError, setMarketError] = useState('');
  const [marketSearch, setMarketSearch] = useState('');
  const [marketInstalling, setMarketInstalling] = useState<string | null>(null);

  // ═══ 数据加载 ══════════════════════════════════════════════════════════

  const loadPlugins = useCallback(async () => {
    try {
      setError('');
      const data = await apiFetch<{ data: { plugins: PluginSummary[] } }>('/api/plugins');
      setPlugins(data.data?.plugins || []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadRegistry = useCallback(async () => {
    try {
      const data = await apiFetch<{ data: RegistrySummary }>('/api/plugins/registry');
      setRegistry(data.data || null);
    } catch { /* 忽略 */ }
  }, []);

  const loadMarketplace = useCallback(async (options?: { refresh?: boolean }) => {
    try {
      setMarketError('');
      const qs = options?.refresh ? '?refresh=true' : '';
      const data = await apiFetch<{ data: MarketplaceResponse }>(`/api/plugins/marketplace${qs}`);
      setMarketplace(data.data || null);
    } catch (e: any) {
      setMarketError(e.message);
    } finally {
      setMarketLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPlugins();
    loadRegistry();
    loadMarketplace();
  }, [loadPlugins, loadRegistry, loadMarketplace]);

  const fetchDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    try {
      const data = await apiFetch<{ data: { plugin: PluginDefinition } }>(`/api/plugins/${id}`);
      setPluginDetail(data.data?.plugin || null);
    } catch {
      setPluginDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  function toggleExpand(id: string) {
    if (expandedId === id) {
      setExpandedId(null);
      setPluginDetail(null);
    } else {
      setExpandedId(id);
      fetchDetail(id);
    }
  }

  // ═══ 插件操作 ════════════════════════════════════════════════════════

  async function handleToggleEnabled(id: string, enabled: boolean) {
    try {
      await apiFetch(`/api/plugins/${id}/toggle`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !enabled }),
      });
      await loadPlugins();
      await loadRegistry();
    } catch (e: any) {
      alert(e.message);
    }
  }

  async function handleActivate(id: string) {
    try {
      await apiFetch(`/api/plugins/${id}/activate`, { method: 'POST' });
      await loadPlugins();
      await loadRegistry();
    } catch (e: any) {
      alert(e.message);
    }
  }

  async function handleDeactivate(id: string) {
    try {
      await apiFetch(`/api/plugins/${id}/deactivate`, { method: 'POST' });
      await loadPlugins();
      await loadRegistry();
    } catch (e: any) {
      alert(e.message);
    }
  }

  async function handleUninstall(id: string, name: string) {
    if (!confirm(`确定卸载插件 "${name}"？此操作不可逆，将删除所有相关数据。`)) return;
    setUninstalling(id);
    try {
      await apiFetch(`/api/plugins/${id}`, { method: 'DELETE' });
      await loadPlugins();
      await loadRegistry();
      if (expandedId === id) { setExpandedId(null); setPluginDetail(null); }
    } catch (e: any) {
      alert(e.message);
    } finally {
      setUninstalling(null);
    }
  }

  // ═══ 扫描 & 注册 ═══════════════════════════════════════════════════════

  async function openScanModal() {
    setShowScanModal(true);
    setScanLoading(true);
    setScanError('');
    setSelectedForRegister(new Set());
    try {
      const data = await apiFetch<{ data: { scanned: ScannedPluginItem[]; baseDir: string; total: number; newCount: number } }>(
        '/api/plugins/scan',
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
      );
      const scanned = data.data?.scanned || [];
      setScannedItems(scanned);
      setSelectedForRegister(new Set(
        scanned.filter((s) => !s.alreadyRegistered && s.valid.valid).map((s) => s.id),
      ));
      if (scanned.length === 0) setScanError('未在 plugins/ 目录中找到任何 plugin.yaml 文件');
    } catch (e: any) {
      setScanError(e.message);
    } finally {
      setScanLoading(false);
    }
  }

  function toggleSelectRegister(id: string) {
    const next = new Set(selectedForRegister);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelectedForRegister(next);
  }

  async function handleRegister() {
    if (selectedForRegister.size === 0) return;
    setRegistering(true);
    try {
      await apiFetch('/api/plugins/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [...selectedForRegister] }),
      });
      setShowScanModal(false);
      await loadPlugins();
      await loadRegistry();
    } catch (e: any) {
      setScanError(e.message);
    } finally {
      setRegistering(false);
    }
  }

  // ═══ 安装 ════════════════════════════════════════════════════════════

  async function handleInstall() {
    if (!installPath.trim()) {
      setInstallError('插件来源不能为空');
      return;
    }
    setInstalling(true);
    setInstallError('');
    try {
      await apiFetch('/api/plugins/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: installPath.trim() }),
      });
      setShowInstallModal(false);
      setInstallPath('');
      await loadPlugins();
      await loadRegistry();
    } catch (e: any) {
      setInstallError(e.message);
    } finally {
      setInstalling(false);
    }
  }

  async function handleRefreshMarketplace() {
    setMarketRefreshing(true);
    try {
      await loadMarketplace({ refresh: true });
    } finally {
      setMarketRefreshing(false);
    }
  }

  async function handleInstallMarketplace(item: MarketplaceItem) {
    setMarketInstalling(item.pluginId);
    try {
      await apiFetch('/api/plugins/marketplace/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pluginId: item.pluginId }),
      });
      await loadPlugins();
      await loadRegistry();
      await loadMarketplace();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setMarketInstalling(null);
    }
  }

  // ═══ 渲染 ══════════════════════════════════════════════════════════════

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 size={24} className="animate-spin" style={{ color: 'var(--color-text-muted)' }} />
      </div>
    );
  }

  return (
    <div className="p-8 max-w-6xl">
      {/* 头部 */}
      <div className="flex items-start justify-between mb-8 gap-4">
        <div className="flex-1">
          <h1 className="text-2xl font-semibold tracking-tight" style={{ color: 'var(--color-text-primary)' }}>
            插件管理
          </h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--color-text-muted)' }}>
            管理 Agent 插件扩展 · 安装/卸载/启禁用 · 插件生命周期控制
          </p>
        </div>
        <div className="flex items-center gap-2">
          {activeView === 'installed' ? (
            <>
              <button
                onClick={openScanModal}
                className="inline-flex items-center gap-2 px-3 py-2 text-xs font-medium rounded-lg border transition-colors"
                style={{ color: 'var(--color-text-secondary)', borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
              >
                <FileSearch size={14} /> 扫描注册
              </button>
              <button
                onClick={() => setShowInstallModal(true)}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors"
                style={{ background: 'var(--color-accent)', color: 'var(--color-text-inverse)' }}
              >
                <Package size={16} /> 安装插件
              </button>
            </>
          ) : (
            <button
              onClick={handleRefreshMarketplace}
              disabled={marketRefreshing}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
              style={{ background: 'var(--color-accent)', color: 'var(--color-text-inverse)' }}
            >
              <RefreshCw size={16} className={marketRefreshing ? 'animate-spin' : ''} /> 刷新市场
            </button>
          )}
        </div>
      </div>

      <div className="mb-6 inline-flex rounded-lg border p-1" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
        <button
          onClick={() => setActiveView('installed')}
          className="px-3 py-1.5 text-xs font-medium rounded-md transition-colors"
          style={{
            background: activeView === 'installed' ? 'var(--color-background)' : 'transparent',
            color: activeView === 'installed' ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
          }}
        >
          已安装
        </button>
        <button
          onClick={() => setActiveView('marketplace')}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors"
          style={{
            background: activeView === 'marketplace' ? 'var(--color-background)' : 'transparent',
            color: activeView === 'marketplace' ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
          }}
        >
          <Globe size={13} /> Claude 市场
        </button>
      </div>

      {/* 注册表摘要 */}
      {activeView === 'installed' && registry && (
        <div className="mb-6 p-3 rounded-lg border flex items-center gap-6 text-xs" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
          <span style={{ color: 'var(--color-text-secondary)' }}>概述：</span>
          <span style={{ color: 'var(--color-text-primary)' }}>共 <strong>{registry.total}</strong> 个</span>
          <span style={{ color: '#22c55e' }}>激活 <strong>{registry.active}</strong> 个</span>
          <span style={{ color: 'var(--color-text-muted)' }}>未激活 <strong>{registry.inactive}</strong> 个</span>
          {registry.errors > 0 && <span style={{ color: '#ef4444' }}>异常 <strong>{registry.errors}</strong> 个</span>}
          {registry.loadOrder.length > 0 && (
            <span className="truncate max-w-[200px]" style={{ color: 'var(--color-text-muted)' }}>
              加载顺序: {registry.loadOrder.join(' → ')}
            </span>
          )}
        </div>
      )}

      {/* 错误提示 */}
      {activeView === 'installed' && error && (
        <div className="mb-6 p-3 rounded-lg text-sm" style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.2)' }}>
          {error}
          <button onClick={loadPlugins} className="ml-3 underline" style={{ color: '#ef4444' }}>重试</button>
        </div>
      )}

      {/* 空状态 */}
      {activeView === 'marketplace' ? (
        <MarketplacePanel
          marketplace={marketplace}
          loading={marketLoading}
          error={marketError}
          search={marketSearch}
          installing={marketInstalling}
          onSearch={setMarketSearch}
          onRetry={() => loadMarketplace({ refresh: true })}
          onInstall={handleInstallMarketplace}
        />
      ) : plugins.length === 0 ? (
        <div className="text-center py-16 rounded-xl border" style={{ borderColor: 'var(--color-border)', background: 'var(--color-background)' }}>
          <Package size={48} className="mx-auto mb-4" style={{ color: 'var(--color-text-muted)' }} />
          <p className="text-sm mb-2" style={{ color: 'var(--color-text-secondary)' }}>尚未安装任何插件</p>
          <p className="text-xs mb-4" style={{ color: 'var(--color-text-muted)' }}>
            安装插件扩展 Agent 能力，或从 plugins/ 目录扫描注册已有插件
          </p>
          <div className="flex items-center justify-center gap-2">
            <button
              onClick={() => setShowInstallModal(true)}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors"
              style={{ background: 'var(--color-accent)', color: 'var(--color-text-inverse)' }}
            >
              <Package size={16} /> 安装第一个插件
            </button>
            <button
              onClick={openScanModal}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg border transition-colors"
              style={{ color: 'var(--color-text-secondary)', borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
            >
              <FileSearch size={16} /> 扫描注册
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {plugins.map((plugin) => (
            <PluginCard
              key={plugin.id}
              plugin={plugin}
              detail={expandedId === plugin.id ? pluginDetail : null}
              detailLoading={expandedId === plugin.id ? detailLoading : false}
              expanded={expandedId === plugin.id}
              onToggleExpand={() => toggleExpand(plugin.id)}
              onToggleEnabled={() => handleToggleEnabled(plugin.id, plugin.enabled)}
              onActivate={() => handleActivate(plugin.id)}
              onDeactivate={() => handleDeactivate(plugin.id)}
              onUninstall={() => handleUninstall(plugin.id, plugin.name)}
              uninstalling={uninstalling === plugin.id}
            />
          ))}
        </div>
      )}

      {/* 扫描注册 Modal */}
      {showScanModal && (
        <ScanRegisterModal
          items={scannedItems}
          selected={selectedForRegister}
          loading={scanLoading}
          registering={registering}
          error={scanError}
          onToggle={toggleSelectRegister}
          onSelectAll={() => {
            const newIds = scannedItems.filter((s) => !s.alreadyRegistered && s.valid.valid).map((s) => s.id);
            setSelectedForRegister(new Set(newIds));
          }}
          onRegister={handleRegister}
          onClose={() => setShowScanModal(false)}
        />
      )}

      {/* 安装 Modal */}
      {showInstallModal && (
        <InstallModal
          path={installPath}
          onChange={setInstallPath}
          installing={installing}
          error={installError}
          onInstall={handleInstall}
          onClose={() => { setShowInstallModal(false); setInstallPath(''); setInstallError(''); }}
        />
      )}
    </div>
  );
}

// ── Claude 市场 ────────────────────────────────────────────────────────────────

function MarketplacePanel({
  marketplace,
  loading,
  error,
  search,
  installing,
  onSearch,
  onRetry,
  onInstall,
}: {
  marketplace: MarketplaceResponse | null;
  loading: boolean;
  error: string;
  search: string;
  installing: string | null;
  onSearch: (value: string) => void;
  onRetry: () => void;
  onInstall: (item: MarketplaceItem) => void;
}) {
  const normalizedSearch = search.trim().toLowerCase();
  const items = (marketplace?.items || []).filter((item) => {
    if (!normalizedSearch) return true;
    return (
      item.name.toLowerCase().includes(normalizedSearch) ||
      item.slug.toLowerCase().includes(normalizedSearch) ||
      (item.description || '').toLowerCase().includes(normalizedSearch)
    );
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <Loader2 size={24} className="animate-spin" style={{ color: 'var(--color-text-muted)' }} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-muted)' }} />
          <input
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="搜索 Claude 插件"
            className="w-full pl-8 pr-3 py-2 text-xs rounded-lg border focus:outline-none"
            style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text-primary)' }}
          />
        </div>
        {marketplace && (
          <div className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
            {items.length} / {marketplace.total} · {formatDate(marketplace.refreshedAt)}
          </div>
        )}
      </div>

      {error && (
        <div className="p-3 rounded-lg text-sm" style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.2)' }}>
          {error}
          <button onClick={onRetry} className="ml-3 underline" style={{ color: '#ef4444' }}>重试</button>
        </div>
      )}

      {items.length === 0 ? (
        <div className="text-center py-16 rounded-xl border" style={{ borderColor: 'var(--color-border)', background: 'var(--color-background)' }}>
          <Globe size={42} className="mx-auto mb-4" style={{ color: 'var(--color-text-muted)' }} />
          <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>没有匹配的 Claude 插件</p>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {items.map((item) => (
            <MarketplaceCard
              key={item.id}
              item={item}
              installing={installing === item.pluginId}
              onInstall={() => onInstall(item)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function MarketplaceCard({
  item,
  installing,
  onInstall,
}: {
  item: MarketplaceItem;
  installing: boolean;
  onInstall: () => void;
}) {
  return (
    <div className="rounded-lg border p-4 flex flex-col gap-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-background)' }}>
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: 'var(--color-surface)' }}>
          <Package size={20} style={{ color: 'var(--color-accent)' }} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold truncate" style={{ color: 'var(--color-text-primary)' }}>{item.name}</h3>
            {item.verified && (
              <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(34,197,94,0.12)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.24)' }}>
                verified
              </span>
            )}
            {item.installed && (
              <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(99,102,241,0.12)', color: 'var(--color-accent)', border: '1px solid rgba(99,102,241,0.24)' }}>
                已安装
              </span>
            )}
          </div>
          <p className="text-xs mt-1 line-clamp-2" style={{ color: 'var(--color-text-muted)' }}>
            {item.description || item.pluginId}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
        {item.worksWith.map((target) => (
          <span key={target} className="px-1.5 py-0.5 rounded" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            {target}
          </span>
        ))}
        {typeof item.installCount === 'number' && (
          <span>{item.installCount.toLocaleString()} installs</span>
        )}
      </div>

      <code className="block text-[10px] px-2 py-1.5 rounded truncate" style={{ background: 'var(--color-surface)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}>
        {item.installCommand}
      </code>

      <div className="flex items-center justify-between gap-2 mt-auto">
        <a
          href={item.detailUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-xs"
          style={{ color: 'var(--color-text-muted)' }}
        >
          <ExternalLink size={13} /> 详情
        </a>
        <button
          onClick={onInstall}
          disabled={installing || item.installed}
          className="inline-flex items-center gap-2 px-3 py-2 text-xs font-medium rounded-lg transition-colors disabled:opacity-50"
          style={{ background: item.installed ? 'var(--color-surface)' : 'var(--color-accent)', color: item.installed ? 'var(--color-text-muted)' : 'var(--color-text-inverse)' }}
        >
          {installing ? <><Loader2 size={14} className="animate-spin" /> 安装中...</> : item.installed ? <><Check size={14} /> 已安装</> : <><Download size={14} /> 一键安装</>}
        </button>
      </div>
    </div>
  );
}

// ── Plugin 卡片 ────────────────────────────────────────────────────────────────

function PluginCard({
  plugin,
  detail,
  detailLoading,
  expanded,
  onToggleExpand,
  onToggleEnabled,
  onActivate,
  onDeactivate,
  onUninstall,
  uninstalling,
}: {
  plugin: PluginSummary;
  detail: PluginDefinition | null;
  detailLoading: boolean;
  expanded: boolean;
  onToggleExpand: () => void;
  onToggleEnabled: () => void;
  onActivate: () => void;
  onDeactivate: () => void;
  onUninstall: () => void;
  uninstalling: boolean;
}) {
  const isActive = plugin.state === 'active';
  const isError = plugin.state === 'error';

  return (
    <div className="rounded-xl border transition-colors"
      style={{
        borderColor: isError ? 'rgba(239,68,68,0.3)' : 'var(--color-border)',
        background: plugin.enabled ? 'var(--color-background)' : 'var(--color-surface)',
        opacity: plugin.enabled ? 1 : 0.6,
      }}
    >
      <div className="flex items-center gap-4 p-4">
        <button onClick={onToggleExpand} className="flex-shrink-0 p-1 rounded transition-transform" style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)' }}>
          <ChevronDown size={16} style={{ color: 'var(--color-text-muted)' }} />
        </button>

        <div className="flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: 'var(--color-surface)' }}>
          <Package size={20} style={{ color: 'var(--color-accent)' }} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold truncate" style={{ color: 'var(--color-text-primary)' }}>{plugin.name}</h3>
            <span className="text-[10px] font-mono" style={{ color: 'var(--color-text-muted)' }}>v{plugin.version}</span>
            <PluginStateBadge state={plugin.state} />
            {isError && <AlertTriangle size={14} style={{ color: '#ef4444' }} />}
          </div>
          <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--color-text-muted)' }}>
            {plugin.description || plugin.id}
          </p>

          {/* 能力标签 */}
          {plugin.capabilities && plugin.capabilities.length > 0 && (
            <div className="flex items-center gap-1 mt-1.5 flex-wrap">
              {plugin.capabilities.slice(0, 4).map((c, i) => (
                <span key={i} className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(99,102,241,0.1)', color: 'var(--color-accent)', border: '1px solid rgba(99,102,241,0.2)' }}>
                  {c.type}:{c.name}
                </span>
              ))}
              {plugin.capabilities.length > 4 && (
                <span className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>+{plugin.capabilities.length - 4}</span>
              )}
            </div>
          )}
        </div>

        {/* 操作按钮 */}
        <div className="flex-shrink-0 flex items-center gap-1">
          {isActive ? (
            <button onClick={onDeactivate} className="p-1.5 rounded-lg transition-colors" style={{ color: '#f59e0b' }} title="停用">
              <Square size={16} />
            </button>
          ) : (
            <button onClick={onActivate} className="p-1.5 rounded-lg transition-colors" style={{ color: '#22c55e' }} title="激活">
              <Play size={16} />
            </button>
          )}
          <button onClick={onToggleEnabled} className="p-1.5 rounded-lg transition-colors" style={{ color: 'var(--color-text-muted)' }} title={plugin.enabled ? '禁用' : '启用'}>
            {plugin.enabled ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
          <button
            onClick={onUninstall}
            disabled={uninstalling}
            className="p-1.5 rounded-lg transition-colors hover:bg-red-500/10"
            style={{ color: 'var(--color-text-muted)' }}
            title="卸载"
          >
            {uninstalling ? <Loader2 size={16} className="animate-spin" style={{ color: '#ef4444' }} /> : <Trash2 size={16} />}
          </button>
        </div>
      </div>

      {/* 展开详情 */}
      {expanded && (
        <div className="px-4 pb-4 border-t mx-4" style={{ borderColor: 'var(--color-border)' }}>
          {detailLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 size={20} className="animate-spin" style={{ color: 'var(--color-text-muted)' }} />
            </div>
          ) : detail ? (
            <div className="mt-3 space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <DetailItem label="ID" value={detail.manifest.id} />
                <DetailItem label="名称" value={detail.manifest.name} />
                <DetailItem label="版本" value={detail.manifest.version} />
                <DetailItem label="作者" value={detail.manifest.author || '-'} />
                <DetailItem label="许可" value={detail.manifest.license || '-'} />
                <DetailItem label="核心要求" value={detail.manifest.requires || '-'} />
                <DetailItem label="安装时间" value={detail.installedAt ? formatDate(detail.installedAt) : '-'} />
                <DetailItem label="激活时间" value={detail.activatedAt ? formatDate(detail.activatedAt) : '-'} />
                <DetailItem label="安装路径" value={detail.installPath || '-'} />
              </div>

              {/* 描述 */}
              {detail.manifest.description && (
                <div>
                  <span className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>描述</span>
                  <p className="text-sm mt-0.5" style={{ color: 'var(--color-text-primary)' }}>{detail.manifest.description}</p>
                </div>
              )}

              {/* 能力 */}
              {detail.manifest.capabilities && detail.manifest.capabilities.length > 0 && (
                <div>
                  <span className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>提供能力 ({detail.manifest.capabilities.length})</span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {detail.manifest.capabilities.map((c, i) => (
                      <span key={i} className="text-[10px] px-1.5 py-0.5 rounded-lg font-mono"
                        style={{ background: 'rgba(99,102,241,0.1)', color: 'var(--color-accent)', border: '1px solid rgba(99,102,241,0.2)' }}>
                        {c.type}: {c.name}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* 钩子 */}
              {detail.manifest.hooks && detail.manifest.hooks.length > 0 && (
                <div>
                  <span className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>生命周期钩子 ({detail.manifest.hooks.length})</span>
                  <div className="mt-1 space-y-1">
                    {detail.manifest.hooks.map((h, i) => (
                      <div key={i} className="flex items-center gap-2 text-[11px] p-1.5 rounded" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
                        <Terminal size={12} style={{ color: 'var(--color-text-muted)' }} />
                        <span className="font-mono" style={{ color: 'var(--color-text-primary)' }}>{h.name}</span>
                        <span className="px-1 py-0.5 rounded text-[10px]" style={{ background: 'rgba(139,92,246,0.15)', color: '#8b5cf6' }}>{h.event}</span>
                        <span className="truncate" style={{ color: 'var(--color-text-muted)' }}>{h.command}</span>
                        {h.blocking && <span className="text-[10px] px-1 rounded" style={{ color: '#ef4444', background: 'rgba(239,68,68,0.1)' }}>阻断</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 依赖 */}
              {detail.manifest.dependencies && detail.manifest.dependencies.length > 0 && (
                <div>
                  <span className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>插件依赖 ({detail.manifest.dependencies.length})</span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {detail.manifest.dependencies.map((d, i) => (
                      <span key={i} className="text-[10px] px-1.5 py-0.5 rounded font-mono"
                        style={{ background: 'var(--color-surface)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}>
                        <Link2 size={10} className="inline" /> {d.pluginId}{d.version ? `@${d.version}` : ''}
                        {!d.required && <span style={{ color: 'var(--color-text-muted)' }}> (可选)</span>}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* 权限 */}
              {detail.manifest.permissions && detail.manifest.permissions.length > 0 && (
                <div>
                  <span className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>权限声明 ({detail.manifest.permissions.length})</span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {detail.manifest.permissions.map((p, i) => (
                      <span key={i} className="text-[10px] px-1.5 py-0.5 rounded"
                        style={{ background: 'rgba(234,179,8,0.15)', color: '#eab308', border: '1px solid rgba(234,179,8,0.3)' }}>
                        <Shield size={10} className="inline" /> {p.type}:{p.scope}{p.action ? `:${p.action}` : ''}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <p className="text-xs py-4" style={{ color: 'var(--color-text-muted)' }}>加载详情失败</p>
          )}
        </div>
      )}
    </div>
  );
}

function DetailItem({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <span className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>{label}</span>
      <p className="text-sm mt-0.5 truncate" style={{ color: 'var(--color-text-primary)' }}>{value}</p>
    </div>
  );
}

// ── 扫描注册 Modal ──────────────────────────────────────────────────────────

function ScanRegisterModal({
  items, selected, loading, registering, error,
  onToggle, onSelectAll, onRegister, onClose,
}: {
  items: ScannedPluginItem[];
  selected: Set<string>;
  loading: boolean;
  registering: boolean;
  error: string;
  onToggle: (id: string) => void;
  onSelectAll: () => void;
  onRegister: () => void;
  onClose: () => void;
}) {
  const newItems = items.filter((s) => !s.alreadyRegistered);
  const registeredItems = items.filter((s) => s.alreadyRegistered);

  if (loading) {
    return (
      <ModalOverlay onClose={onClose}>
        <ModalBox title="扫描插件目录" onClose={onClose} maxHeight>
          <div className="flex items-center justify-center py-12">
            <Loader2 size={24} className="animate-spin" style={{ color: 'var(--color-text-muted)' }} />
            <span className="ml-3 text-sm" style={{ color: 'var(--color-text-muted)' }}>正在扫描 plugins/ 目录...</span>
          </div>
        </ModalBox>
      </ModalOverlay>
    );
  }

  return (
    <ModalOverlay onClose={onClose}>
      <ModalBox title="扫描注册插件" onClose={onClose} maxHeight>
        {error && (
          <div className="mb-3 p-2 rounded text-xs" style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>{error}</div>
        )}

        {items.length === 0 ? (
          <div className="text-center py-8">
            <FileSearch size={36} className="mx-auto mb-3" style={{ color: 'var(--color-text-muted)' }} />
            <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>未找到任何 plugin.yaml 文件</p>
            <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>请在项目的 plugins/ 目录中添加 plugin.yaml 文件</p>
          </div>
        ) : (
          <>
            {newItems.length > 0 && (
              <div className="mb-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
                    可注册 ({newItems.length})
                  </span>
                  <button onClick={onSelectAll} className="text-xs underline" style={{ color: 'var(--color-accent)' }}>全选</button>
                </div>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {newItems.map((item) => (
                    <ScanItemRow key={item.id} item={item} checked={selected.has(item.id)} onToggle={() => onToggle(item.id)} />
                  ))}
                </div>
              </div>
            )}

            {registeredItems.length > 0 && (
              <div className="mb-4">
                <span className="text-xs font-medium" style={{ color: 'var(--color-text-muted)' }}>
                  已注册 ({registeredItems.length})
                </span>
                <div className="space-y-2 mt-2 max-h-32 overflow-y-auto">
                  {registeredItems.map((item) => (
                    <ScanItemRow key={item.id} item={item} checked={false} disabled onToggle={() => {}} />
                  ))}
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-3 border-t" style={{ borderColor: 'var(--color-border)' }}>
              <button onClick={onClose} className="px-4 py-2 text-xs rounded-lg transition-colors" style={{ color: 'var(--color-text-secondary)' }}>取消</button>
              <button
                onClick={onRegister}
                disabled={selected.size === 0 || registering}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-lg transition-colors disabled:opacity-50"
                style={{ background: 'var(--color-accent)', color: 'var(--color-text-inverse)' }}
              >
                {registering ? <><Loader2 size={14} className="animate-spin" /> 注册中...</> : <><Download size={14} /> 注册选中 ({selected.size})</>}
              </button>
            </div>
          </>
        )}
      </ModalBox>
    </ModalOverlay>
  );
}

function ScanItemRow({
  item, checked, disabled, onToggle,
}: {
  item: ScannedPluginItem;
  checked: boolean;
  disabled?: boolean;
  onToggle: () => void;
}) {
  const hasErrors = !item.valid.valid;

  return (
    <label
      className={`flex items-center gap-3 p-2 rounded-lg border transition-colors ${disabled ? 'opacity-50' : 'cursor-pointer'}`}
      style={{ borderColor: hasErrors ? 'rgba(239,68,68,0.3)' : 'var(--color-border)', background: 'var(--color-surface)' }}
    >
      <input
        type="checkbox" checked={checked} disabled={disabled || hasErrors}
        onChange={onToggle} className="w-4 h-4 rounded" style={{ accentColor: 'var(--color-accent)' }}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold font-mono" style={{ color: 'var(--color-text-primary)' }}>{item.name}</span>
          <span className="text-[10px] font-mono" style={{ color: 'var(--color-text-muted)' }}>v{item.version}</span>
          {hasErrors && <AlertTriangle size={12} style={{ color: '#ef4444' }} />}
        </div>
        <p className="text-[10px] truncate mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
          {item.description?.slice(0, 80) || item.id}
        </p>
        <span className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>{item.dirName}/</span>
      </div>
      {disabled && (
        <span className="text-[10px] px-1.5 py-0.5 rounded flex items-center gap-1" style={{ background: 'rgba(34,197,94,0.1)', color: '#22c55e' }}>
          <Check size={12} /> 已注册
        </span>
      )}
      {hasErrors && (
        <span className="text-[10px] px-1.5 py-0.5 rounded flex items-center gap-1" style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>
          <AlertTriangle size={12} /> 无效
        </span>
      )}
    </label>
  );
}

// ── 安装 Modal ──────────────────────────────────────────────────────────────

function InstallModal({
  path: installPath, onChange, installing, error, onInstall, onClose,
}: {
  path: string;
  onChange: (v: string) => void;
  installing: boolean;
  error: string;
  onInstall: () => void;
  onClose: () => void;
}) {
  return (
    <ModalOverlay onClose={onClose}>
      <ModalBox title="安装插件" onClose={onClose}>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-text-secondary)' }}>
              插件来源 *
            </label>
            <div className="relative">
              <FolderOpen size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-muted)' }} />
              <input
                type="text"
                value={installPath}
                onChange={(e) => onChange(e.target.value)}
                placeholder="本地目录，或 claude plugin install frontend-design@claude-plugins-official"
                className="w-full pl-8 pr-3 py-2 text-xs rounded-lg border focus:outline-none font-mono transition-colors"
                style={{ background: 'var(--color-surface)', borderColor: error ? '#ef4444' : 'var(--color-border)', color: 'var(--color-text-primary)' }}
                onKeyDown={(e) => e.key === 'Enter' && onInstall()}
              />
            </div>
            <p className="text-[10px] mt-1" style={{ color: 'var(--color-text-muted)' }}>
              支持本地 plugin.yaml 目录、Claude 插件 ID，或完整 claude plugin install 命令
            </p>
          </div>

          {error && (
            <div className="p-2 rounded text-xs" style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>{error}</div>
          )}

          <div className="flex justify-end gap-2 pt-2 border-t" style={{ borderColor: 'var(--color-border)' }}>
            <button onClick={onClose} disabled={installing} className="px-4 py-2 text-xs rounded-lg transition-colors" style={{ color: 'var(--color-text-secondary)' }}>取消</button>
            <button
              onClick={onInstall}
              disabled={installing || !installPath.trim()}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-lg transition-colors disabled:opacity-50"
              style={{ background: 'var(--color-accent)', color: 'var(--color-text-inverse)' }}
            >
              {installing ? <><Loader2 size={14} className="animate-spin" /> 安装中...</> : <><Package size={14} /> 安装</>}
            </button>
          </div>
        </div>
      </ModalBox>
    </ModalOverlay>
  );
}

// ── 通用 Modal ──────────────────────────────────────────────────────────────

function ModalOverlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 flex items-start justify-center z-50 pt-[10vh]"
      style={{ background: 'rgba(0,0,0,0.4)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {children}
    </div>
  );
}

function ModalBox({ title, children, onClose, maxHeight }: { title: string; children: React.ReactNode; onClose: () => void; maxHeight?: boolean }) {
  return (
    <div
      className={`rounded-xl border shadow-2xl w-full max-w-lg ${maxHeight ? 'max-h-[80vh] overflow-y-auto' : ''}`}
      style={{ background: 'var(--color-background)', borderColor: 'var(--color-border)' }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--color-border)' }}>
        <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>{title}</h2>
        <button onClick={onClose} className="p-1 rounded transition-colors" style={{ color: 'var(--color-text-muted)' }}><XCircle size={18} /></button>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}
