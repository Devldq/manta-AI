/* MCP Server 管理页 — /mcp
 *
 * 参照 OpenCode 设计重构:
 * - type: local / remote (原 stdio / remote)
 * - command: 数组格式 (空格分隔输入)
 * - remote 支持 headers 简单认证 (API Key)
 * - 支持 timeout 配置
 * - 显示工具名列表
 * - 支持工具可见性预览
 */
'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Plus,
  Trash2,
  Edit3,
  Plug,
  Unplug,
  RefreshCw,
  Server,
  Wrench,
  Globe,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Loader2,
  Shield,
  ChevronDown,
  Terminal,
  Eye,
} from 'lucide-react';

// ── 类型定义 ───────────────────────────────────────────────────────────────

interface MCPServerListItem {
  name: string;
  description: string;
  enabled: boolean;
  type: 'local' | 'remote';
  isBuiltin: boolean;
  isConnected: boolean;
  toolCount: number;
  toolNames: string[];
  oauthRequired?: boolean;
  oauthAuthorized?: boolean;
  lastError?: string;
}

interface ServerFormData {
  name: string;
  description: string;
  enabled: boolean;
  type: 'local' | 'remote';
  // local
  command: string; // 空格分隔
  env: string; // 每行 KEY=VALUE
  // remote
  url: string;
  headerKey: string;
  headerValue: string;
  hasOauth: boolean;
  oauthAuthorizationEndpoint: string;
  oauthTokenEndpoint: string;
  oauthClientId: string;
  oauthClientSecret: string;
  oauthScopes: string;
  oauthTokenEnvVar: string; // local 模式：将 token 注入到哪个环境变量
  // 通用
  timeout: string;
}

// ── 初始表单数据 ────────────────────────────────────────────────────────────

const emptyForm: ServerFormData = {
  name: '',
  description: '',
  enabled: true,
  type: 'local',
  command: '',
  env: '',
  url: '',
  headerKey: '',
  headerValue: '',
  hasOauth: false,
  oauthAuthorizationEndpoint: '',
  oauthTokenEndpoint: '',
  oauthClientId: '',
  oauthClientSecret: '',
  oauthScopes: '',
  oauthTokenEnvVar: '',
  timeout: '5000',
};

// ── 页面组件 ────────────────────────────────────────────────────────────────

export default function MCPServersPage() {
  const [servers, setServers] = useState<MCPServerListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [showModal, setShowModal] = useState(false);
  const [editingServer, setEditingServer] = useState<string | null>(null);
  const [form, setForm] = useState<ServerFormData>(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  const [expandedServer, setExpandedServer] = useState<string | null>(null);

  const loadServers = useCallback(async () => {
    try {
      setError('');
      const res = await fetch('/api/mcp/servers');
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || '加载失败');
        return;
      }
      const data = await res.json();
      setServers(data.servers || []);
    } catch {
      setError('网络错误');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadServers();
  }, [loadServers]);

  function openCreateModal() {
    setEditingServer(null);
    setForm(emptyForm);
    setFormError('');
    setShowModal(true);
  }

  function openEditModal(server: MCPServerListItem) {
    setEditingServer(server.name);
    setForm({
      name: server.name,
      description: server.description,
      enabled: server.enabled,
      type: server.type,
      command: '',
      env: '',
      url: '',
      headerKey: '',
      headerValue: '',
      hasOauth: false,
      oauthAuthorizationEndpoint: '',
      oauthTokenEndpoint: '',
      oauthClientId: '',
      oauthClientSecret: '',
      oauthScopes: '',
      oauthTokenEnvVar: '',
      timeout: '5000',
    });
    setFormError('');
    setShowModal(true);
  }

  function closeModal() {
    setShowModal(false);
    setEditingServer(null);
    setForm(emptyForm);
    setFormError('');
  }

  function validateForm(): boolean {
    if (!form.name.trim()) {
      setFormError('名称不能为空');
      return false;
    }
    if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(form.name.trim())) {
      setFormError('名称必须以字母开头，仅包含字母、数字、下划线和横线');
      return false;
    }
    if (form.type === 'local' && !form.command.trim()) {
      setFormError('local 模式需要提供命令');
      return false;
    }
    if (form.type === 'remote' && !form.url.trim()) {
      setFormError('remote 模式需要提供 URL');
      return false;
    }
    if (
      form.hasOauth &&
      (!form.oauthAuthorizationEndpoint.trim() ||
        !form.oauthTokenEndpoint.trim() ||
        !form.oauthClientId.trim())
    ) {
      setFormError('OAuth 模式需要提供授权端点、Token 端点和 Client ID');
      return false;
    }
    if (form.type === 'local' && form.hasOauth && !form.oauthTokenEnvVar.trim()) {
      setFormError('local 模式的 OAuth 需要指定 Token 环境变量名');
      return false;
    }
    if (form.timeout && (isNaN(Number(form.timeout)) || Number(form.timeout) < 0)) {
      setFormError('超时必须为非负整数');
      return false;
    }
    return true;
  }

  async function handleSubmit() {
    if (!validateForm()) return;

    setSubmitting(true);
    setFormError('');

    try {
      const envObj: Record<string, string> = {};
      if (form.env.trim()) {
        form.env.split('\n').forEach((line) => {
          const idx = line.indexOf('=');
          if (idx > 0) {
            envObj[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
          }
        });
      }

      // command 数组 (空格分隔)
      const commandArr = form.command.trim()
        ? form.command.trim().split(/\s+/)
        : [];

      const body: Record<string, unknown> = {
        name: form.name.trim(),
        description: form.description.trim(),
        enabled: form.enabled,
        type: form.type,
      };

      if (form.type === 'local') {
        body.command = commandArr;
        if (Object.keys(envObj).length > 0) {
          body.environment = envObj;
        }
        // OAuth (可选, local 也支持 OAuth token 注入)
        if (form.hasOauth) {
          const scopesArr = form.oauthScopes.trim()
            ? form.oauthScopes.trim().split(/\s+/)
            : [];
          body.oauth = {
            authorizationEndpoint: form.oauthAuthorizationEndpoint.trim(),
            tokenEndpoint: form.oauthTokenEndpoint.trim(),
            clientId: form.oauthClientId.trim(),
            clientSecret: form.oauthClientSecret.trim() || undefined,
            scopes: scopesArr,
            tokenEnvVar: form.oauthTokenEnvVar.trim(),
          };
        }
      } else {
        body.url = form.url.trim();
        // headers (API Key 认证)
        if (form.headerKey.trim() && form.headerValue.trim()) {
          body.headers = {
            [form.headerKey.trim()]: form.headerValue.trim(),
          };
        }
        // OAuth (可选)
        if (form.hasOauth) {
          const scopesArr = form.oauthScopes.trim()
            ? form.oauthScopes.trim().split(/\s+/)
            : [];
          body.oauth = {
            authorizationEndpoint: form.oauthAuthorizationEndpoint.trim(),
            tokenEndpoint: form.oauthTokenEndpoint.trim(),
            clientId: form.oauthClientId.trim(),
            clientSecret: form.oauthClientSecret.trim() || undefined,
            scopes: scopesArr,
          };
        }
      }

      if (form.timeout) {
        body.timeout = Number(form.timeout);
      }

      let res: Response;
      if (editingServer) {
        res = await fetch(`/api/mcp/servers/${editingServer}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      } else {
        res = await fetch('/api/mcp/servers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      }

      const data = await res.json();
      if (!res.ok) {
        setFormError(data.error || '操作失败');
        return;
      }

      closeModal();
      await loadServers();
    } catch {
      setFormError('网络错误');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(name: string) {
    if (!confirm(`确定删除 MCP Server "${name}"？此操作不可逆。`)) return;

    try {
      const res = await fetch(`/api/mcp/servers/${name}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json();
        alert(data.error || '删除失败');
        return;
      }
      await loadServers();
    } catch {
      alert('网络错误');
    }
  }

  async function handleToggleEnabled(server: MCPServerListItem) {
    try {
      const res = await fetch(`/api/mcp/servers/${server.name}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !server.enabled }),
      });
      if (!res.ok) {
        const data = await res.json();
        alert(data.error || '操作失败');
        return;
      }
      await loadServers();
    } catch {
      alert('网络错误');
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2
          size={24}
          className="animate-spin"
          style={{ color: 'var(--color-text-muted)' }}
        />
      </div>
    );
  }

  return (
    <div className="p-8 max-w-4xl">
      {/* 头部 */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1
            className="text-2xl font-semibold tracking-tight"
            style={{ color: 'var(--color-text-primary)' }}
          >
            MCP 服务器
          </h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--color-text-muted)' }}>
            管理 MCP (Model Context Protocol) 服务器连接，扩展 AI 工具能力
          </p>
        </div>
        <button
          onClick={openCreateModal}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors"
          style={{
            background: 'var(--color-accent)',
            color: 'var(--color-text-inverse)',
          }}
        >
          <Plus size={16} />
          添加服务器
        </button>
      </div>

      {error && (
        <div
          className="mb-6 p-3 rounded-lg text-sm"
          style={{
            background: 'rgba(239,68,68,0.1)',
            color: '#ef4444',
            border: '1px solid rgba(239,68,68,0.2)',
          }}
        >
          {error}
          <button
            onClick={loadServers}
            className="ml-3 underline"
            style={{ color: '#ef4444' }}
          >
            重试
          </button>
        </div>
      )}

      {servers.length === 0 ? (
        <div
          className="text-center py-16 rounded-xl border"
          style={{
            borderColor: 'var(--color-border)',
            background: 'var(--color-background)',
          }}
        >
          <Server
            size={48}
            className="mx-auto mb-4"
            style={{ color: 'var(--color-text-muted)' }}
          />
          <p className="text-sm mb-4" style={{ color: 'var(--color-text-secondary)' }}>
            尚未配置任何 MCP 服务器
          </p>
          <button
            onClick={openCreateModal}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors"
            style={{
              background: 'var(--color-accent)',
              color: 'var(--color-text-inverse)',
            }}
          >
            <Plus size={16} />
            添加第一个服务器
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {servers.map((server) => (
            <ServerCard
              key={server.name}
              server={server}
              expanded={expandedServer === server.name}
              onToggleExpand={() =>
                setExpandedServer(
                  expandedServer === server.name ? null : server.name,
                )
              }
              onEdit={() => openEditModal(server)}
              onDelete={() => handleDelete(server.name)}
              onToggleEnabled={() => handleToggleEnabled(server)}
              onRefresh={loadServers}
            />
          ))}
        </div>
      )}

      {showModal && (
        <ServerFormModal
          form={form}
          setForm={setForm}
          isEditing={!!editingServer}
          submitting={submitting}
          error={formError}
          onSubmit={handleSubmit}
          onClose={closeModal}
        />
      )}
    </div>
  );
}

// ── Server 卡片组件 ─────────────────────────────────────────────────────────

function ServerCard({
  server,
  expanded,
  onToggleExpand,
  onEdit,
  onDelete,
  onToggleEnabled,
  onRefresh,
}: {
  server: MCPServerListItem;
  expanded: boolean;
  onToggleExpand: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onToggleEnabled: () => void;
  onRefresh: () => void;
}) {
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  async function handleConnect() {
    setActionLoading('connect');
    try {
      const res = await fetch(
        `/api/mcp/oauth/start?server=${encodeURIComponent(server.name)}`,
      );
      if (!res.ok) {
        const data = await res.json();
        alert(data.error || 'OAuth 启动失败');
        return;
      }
      const data = await res.json();
      if (data.authorizationUrl) {
        window.open(data.authorizationUrl, '_blank');
        const poll = setInterval(async () => {
          const statusRes = await fetch(
            `/api/mcp/oauth/status?server=${server.name}`,
          );
          const statusData = await statusRes.json();
          if (statusData.connected) {
            clearInterval(poll);
            onRefresh();
          }
        }, 3000);
        setTimeout(() => clearInterval(poll), 5 * 60 * 1000);
      }
    } catch {
      alert('网络错误');
    } finally {
      setActionLoading(null);
    }
  }

  async function handleDisconnect() {
    if (!confirm(`确定断开 "${server.name}" 的连接？`)) return;
    setActionLoading('disconnect');
    try {
      const res = await fetch(`/api/mcp/servers/${server.name}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: false }),
      });
      if (!res.ok) {
        const data = await res.json();
        alert(data.error || '断开失败');
        return;
      }
      onRefresh();
    } catch {
      alert('网络错误');
    } finally {
      setActionLoading(null);
    }
  }

  return (
    <div
      className="rounded-xl border transition-colors"
      style={{
        borderColor: 'var(--color-border)',
        background: server.enabled
          ? 'var(--color-background)'
          : 'var(--color-surface)',
        opacity: server.enabled ? 1 : 0.6,
      }}
    >
      <div className="flex items-center gap-4 p-4">
        <button
          onClick={onToggleExpand}
          className="flex-shrink-0 p-1 rounded transition-transform"
          style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)' }}
        >
          <ChevronDown
            size={16}
            style={{ color: 'var(--color-text-muted)' }}
          />
        </button>

        <div
          className="flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center"
          style={{ background: 'var(--color-surface)' }}
        >
          {server.isBuiltin ? (
            <Shield size={18} style={{ color: 'var(--color-accent)' }} />
          ) : server.type === 'local' ? (
            <Terminal size={18} style={{ color: 'var(--color-accent)' }} />
          ) : (
            <Globe size={18} style={{ color: 'var(--color-accent)' }} />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3
              className="text-sm font-semibold truncate"
              style={{ color: 'var(--color-text-primary)' }}
            >
              {server.name}
            </h3>
            {server.isBuiltin && (
              <span
                className="flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium"
                style={{
                  background: 'var(--color-surface)',
                  color: 'var(--color-accent)',
                  border: '1px solid var(--color-accent)',
                }}
              >
                内建
              </span>
            )}
          </div>
          <p
            className="text-xs mt-0.5 truncate"
            style={{ color: 'var(--color-text-muted)' }}
          >
            {server.description ||
              (server.type === 'local' ? '本地子进程 (local)' : '远程 HTTP 服务 (remote)')}
          </p>
        </div>

        <div className="flex-shrink-0">
          <StatusBadge server={server} />
        </div>

        <div className="flex-shrink-0 flex items-center gap-1">
          {server.oauthRequired &&
            server.enabled &&
            !server.isConnected && (
              <button
                onClick={handleConnect}
                disabled={actionLoading === 'connect'}
                className="p-1.5 rounded-lg transition-colors"
                style={{ color: 'var(--color-accent)' }}
                title="OAuth 授权连接"
              >
                {actionLoading === 'connect' ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <Plug size={16} />
                )}
              </button>
            )}

          {server.isConnected && (
            <button
              onClick={handleDisconnect}
              disabled={actionLoading === 'disconnect'}
              className="p-1.5 rounded-lg transition-colors hover:bg-red-500/10"
              style={{ color: 'var(--color-text-muted)' }}
              title="断开连接"
            >
              {actionLoading === 'disconnect' ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Unplug size={16} />
              )}
            </button>
          )}

          {!server.isBuiltin && (
            <button
              onClick={onEdit}
              className="p-1.5 rounded-lg transition-colors"
              style={{ color: 'var(--color-text-muted)' }}
              title="编辑"
            >
              <Edit3 size={16} />
            </button>
          )}

          {!server.isBuiltin && (
            <button
              onClick={onDelete}
              className="p-1.5 rounded-lg transition-colors hover:bg-red-500/10"
              style={{ color: 'var(--color-text-muted)' }}
              title="删除"
            >
              <Trash2 size={16} />
            </button>
          )}

          <button
            onClick={onToggleEnabled}
            className="p-1.5 rounded-lg transition-colors"
            style={{ color: 'var(--color-text-muted)' }}
            title={server.enabled ? '禁用' : '启用'}
          >
            <XCircle size={16} />
          </button>
        </div>
      </div>

      {/* 展开详情 */}
      {expanded && (
        <div
          className="px-4 pb-4 pt-0 border-t mx-4"
          style={{ borderColor: 'var(--color-border)' }}
        >
          <div className="grid grid-cols-2 gap-3 mt-3">
            <DetailItem
              label="类型"
              value={
                server.type === 'local'
                  ? 'Local (本地子进程)'
                  : 'Remote (HTTP 服务)'
              }
            />
            <DetailItem
              label="状态"
              value={
                server.enabled
                  ? server.isConnected
                    ? '已连接'
                    : '未连接'
                  : '已禁用'
              }
            />
            <DetailItem
              label="工具数"
              value={
                server.toolCount > 0
                  ? `${server.toolCount} 个工具`
                  : '-'
              }
            />
            <DetailItem
              label="来源"
              value={server.isBuiltin ? '内建' : '用户自定义'}
            />
            {server.oauthRequired && (
              <DetailItem
                label="OAuth 授权"
                value={server.oauthAuthorized ? '已授权' : '未授权'}
              />
            )}
            {server.lastError && (
              <DetailItem label="最后错误" value={server.lastError} />
            )}
          </div>

          {/* 工具名列表 */}
          {server.toolNames.length > 0 && (
            <div className="mt-3">
              <span className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                已注册工具 ({server.toolNames.length})
              </span>
              <div className="flex flex-wrap gap-1 mt-1">
                {server.toolNames.map((t) => (
                  <span
                    key={t}
                    className="text-[10px] px-1.5 py-0.5 font-mono rounded"
                    style={{
                      background: 'var(--color-surface)',
                      color: 'var(--color-text-secondary)',
                      border: '1px solid var(--color-border)',
                    }}
                  >
                    {t}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span
        className="text-[11px]"
        style={{ color: 'var(--color-text-muted)' }}
      >
        {label}
      </span>
      <p
        className="text-sm mt-0.5"
        style={{ color: 'var(--color-text-primary)' }}
      >
        {value}
      </p>
    </div>
  );
}

function StatusBadge({ server }: { server: MCPServerListItem }) {
  if (!server.enabled) {
    return (
      <span
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium"
        style={{
          background: 'var(--color-surface)',
          color: 'var(--color-text-muted)',
        }}
      >
        <XCircle size={12} /> 已禁用
      </span>
    );
  }
  if (server.isConnected) {
    return (
      <span
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium"
        style={{ background: 'rgba(34,197,94,0.15)', color: '#22c55e' }}
      >
        <CheckCircle2 size={12} /> 已连接 ({server.toolCount})
      </span>
    );
  }
  if (server.oauthRequired && server.oauthAuthorized === false) {
    return (
      <span
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium"
        style={{ background: 'rgba(250,204,21,0.15)', color: '#facc15' }}
      >
        <AlertCircle size={12} /> 待授权
      </span>
    );
  }
  if (server.oauthAuthorized === true) {
    return (
      <span
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium"
        style={{ background: 'rgba(59,130,246,0.15)', color: '#3b82f6' }}
      >
        <Globe size={12} /> 已授权
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium"
      style={{ background: 'rgba(249,115,22,0.15)', color: '#f97316' }}
    >
      <AlertCircle size={12} /> 未连接
    </span>
  );
}

// ── 表单 Modal ──────────────────────────────────────────────────────────────

function ServerFormModal({
  form,
  setForm,
  isEditing,
  submitting,
  error,
  onSubmit,
  onClose,
}: {
  form: ServerFormData;
  setForm: (f: ServerFormData) => void;
  isEditing: boolean;
  submitting: boolean;
  error: string;
  onSubmit: () => void;
  onClose: () => void;
}) {
  const update = (patch: Partial<ServerFormData>) =>
    setForm({ ...form, ...patch });

  return (
    <div
      className="fixed inset-0 flex items-start justify-center z-50 pt-[10vh]"
      style={{ background: 'rgba(0,0,0,0.4)' }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="rounded-xl border shadow-2xl w-full max-w-lg max-h-[80vh] overflow-y-auto"
        style={{
          background: 'var(--color-background)',
          borderColor: 'var(--color-border)',
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4 border-b"
          style={{ borderColor: 'var(--color-border)' }}
        >
          <h2
            className="text-sm font-semibold"
            style={{ color: 'var(--color-text-primary)' }}
          >
            {isEditing ? '编辑 MCP 服务器' : '添加 MCP 服务器'}
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded transition-colors"
            style={{ color: 'var(--color-text-muted)' }}
          >
            <XCircle size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-3">
          {/* 名称 */}
          <div>
            <label
              className="block text-xs font-medium mb-1"
              style={{ color: 'var(--color-text-secondary)' }}
            >
              名称 *
            </label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => update({ name: e.target.value })}
              disabled={isEditing}
              placeholder="例如: my-server"
              className="w-full px-2 py-1.5 text-xs rounded border focus:outline-none transition-colors"
              style={{
                background: 'var(--color-surface)',
                borderColor: 'var(--color-border)',
                color: 'var(--color-text-primary)',
              }}
            />
          </div>

          {/* 描述 */}
          <div>
            <label
              className="block text-xs font-medium mb-1"
              style={{ color: 'var(--color-text-secondary)' }}
            >
              描述
            </label>
            <input
              type="text"
              value={form.description}
              onChange={(e) => update({ description: e.target.value })}
              placeholder="简要描述此服务器的用途"
              className="w-full px-2 py-1.5 text-xs rounded border focus:outline-none transition-colors"
              style={{
                background: 'var(--color-surface)',
                borderColor: 'var(--color-border)',
                color: 'var(--color-text-primary)',
              }}
            />
          </div>

          {/* 类型选择 */}
          <div>
            <label
              className="block text-xs font-medium mb-1"
              style={{ color: 'var(--color-text-secondary)' }}
            >
              连接类型 *
            </label>
            <div className="flex gap-2">
              {(['local', 'remote'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => update({ type: t })}
                  className="flex-1 px-3 py-2 text-xs rounded-lg border transition-colors"
                  style={{
                    background:
                      form.type === t
                        ? 'var(--color-accent)'
                        : 'var(--color-surface)',
                    color:
                      form.type === t
                        ? 'var(--color-text-inverse)'
                        : 'var(--color-text-secondary)',
                    borderColor:
                      form.type === t
                        ? 'var(--color-accent)'
                        : 'var(--color-border)',
                  }}
                >
                  {t === 'local' ? '⌨️ Local (本地进程)' : '🌐 Remote (HTTP 服务)'}
                </button>
              ))}
            </div>
          </div>

          {/* local 字段 */}
          {form.type === 'local' && (
            <>
              <div>
                <label
                  className="block text-xs font-medium mb-1"
                  style={{ color: 'var(--color-text-secondary)' }}
                >
                  命令 * (空格分隔)
                </label>
                <input
                  type="text"
                  value={form.command}
                  onChange={(e) => update({ command: e.target.value })}
                  placeholder="例如: npx -y @modelcontextprotocol/server-github"
                  className="w-full px-2 py-1.5 text-xs rounded border focus:outline-none font-mono transition-colors"
                  style={{
                    background: 'var(--color-surface)',
                    borderColor: 'var(--color-border)',
                    color: 'var(--color-text-primary)',
                  }}
                />
              </div>
              <div>
                <label
                  className="block text-xs font-medium mb-1"
                  style={{ color: 'var(--color-text-secondary)' }}
                >
                  环境变量 (每行 KEY=VALUE, 支持 {'{env:VAR}'} 引用)
                </label>
                <textarea
                  value={form.env}
                  onChange={(e) => update({ env: e.target.value })}
                  placeholder={`GITHUB_PERSONAL_ACCESS_TOKEN={env:GITHUB_TOKEN}`}
                  rows={3}
                  className="w-full px-2 py-1.5 text-xs rounded border focus:outline-none font-mono resize-none transition-colors"
                  style={{
                    background: 'var(--color-surface)',
                    borderColor: 'var(--color-border)',
                    color: 'var(--color-text-primary)',
                  }}
                />
              </div>

              {/* OAuth 开关 (local 模式) */}
              <div className="flex items-center justify-between pt-1">
                <span
                  className="text-xs font-medium"
                  style={{ color: 'var(--color-text-secondary)' }}
                >
                  OAuth 2.0 认证
                </span>
                <button
                  onClick={() => update({ hasOauth: !form.hasOauth })}
                  className={`relative w-9 h-5 rounded-full transition-colors`}
                  style={{
                    background: form.hasOauth
                      ? 'var(--color-accent)'
                      : 'var(--color-border)',
                  }}
                >
                  <span
                    className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform"
                    style={{
                      left: form.hasOauth
                        ? 'calc(100% - 1.125rem)'
                        : '0.125rem',
                    }}
                  />
                </button>
              </div>

              {/* OAuth 详细配置 (local 模式) */}
              {form.hasOauth && (
                <>
                  <div>
                    <label
                      className="block text-xs font-medium mb-1"
                      style={{ color: 'var(--color-text-secondary)' }}
                    >
                      Token 环境变量名 *（OAuth token 注入到的变量名）
                    </label>
                    <input
                      type="text"
                      value={form.oauthTokenEnvVar}
                      onChange={(e) =>
                        update({ oauthTokenEnvVar: e.target.value })
                      }
                      placeholder="例如: GITHUB_PERSONAL_ACCESS_TOKEN"
                      className="w-full px-2 py-1.5 text-xs rounded border focus:outline-none font-mono transition-colors"
                      style={{
                        background: 'var(--color-surface)',
                        borderColor: 'var(--color-border)',
                        color: 'var(--color-text-primary)',
                      }}
                    />
                  </div>
                  <div>
                    <label
                      className="block text-xs font-medium mb-1"
                      style={{ color: 'var(--color-text-secondary)' }}
                    >
                      授权端点 *
                    </label>
                    <input
                      type="text"
                      value={form.oauthAuthorizationEndpoint}
                      onChange={(e) =>
                        update({ oauthAuthorizationEndpoint: e.target.value })
                      }
                      placeholder="https://github.com/login/oauth/authorize"
                      className="w-full px-2 py-1.5 text-xs rounded border focus:outline-none font-mono transition-colors"
                      style={{
                        background: 'var(--color-surface)',
                        borderColor: 'var(--color-border)',
                        color: 'var(--color-text-primary)',
                      }}
                    />
                  </div>
                  <div>
                    <label
                      className="block text-xs font-medium mb-1"
                      style={{ color: 'var(--color-text-secondary)' }}
                    >
                      Token 端点 *
                    </label>
                    <input
                      type="text"
                      value={form.oauthTokenEndpoint}
                      onChange={(e) =>
                        update({ oauthTokenEndpoint: e.target.value })
                      }
                      placeholder="https://github.com/login/oauth/access_token"
                      className="w-full px-2 py-1.5 text-xs rounded border focus:outline-none font-mono transition-colors"
                      style={{
                        background: 'var(--color-surface)',
                        borderColor: 'var(--color-border)',
                        color: 'var(--color-text-primary)',
                      }}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label
                        className="block text-xs font-medium mb-1"
                        style={{ color: 'var(--color-text-secondary)' }}
                      >
                        Client ID *
                      </label>
                      <input
                        type="text"
                        value={form.oauthClientId}
                        onChange={(e) =>
                          update({ oauthClientId: e.target.value })
                        }
                        placeholder="{'env:GITHUB_CLIENT_ID}'"
                        className="w-full px-2 py-1.5 text-xs rounded border focus:outline-none font-mono transition-colors"
                        style={{
                          background: 'var(--color-surface)',
                          borderColor: 'var(--color-border)',
                          color: 'var(--color-text-primary)',
                        }}
                      />
                    </div>
                    <div>
                      <label
                        className="block text-xs font-medium mb-1"
                        style={{ color: 'var(--color-text-secondary)' }}
                      >
                        Client Secret
                      </label>
                      <input
                        type="password"
                        value={form.oauthClientSecret}
                        onChange={(e) =>
                          update({ oauthClientSecret: e.target.value })
                        }
                        placeholder="(可选)"
                        className="w-full px-2 py-1.5 text-xs rounded border focus:outline-none font-mono transition-colors"
                        style={{
                          background: 'var(--color-surface)',
                          borderColor: 'var(--color-border)',
                          color: 'var(--color-text-primary)',
                        }}
                      />
                    </div>
                  </div>
                  <div>
                    <label
                      className="block text-xs font-medium mb-1"
                      style={{ color: 'var(--color-text-secondary)' }}
                    >
                      Scopes (空格分隔)
                    </label>
                    <input
                      type="text"
                      value={form.oauthScopes}
                      onChange={(e) =>
                        update({ oauthScopes: e.target.value })
                      }
                      placeholder="repo read:org read:user workflow"
                      className="w-full px-2 py-1.5 text-xs rounded border focus:outline-none font-mono transition-colors"
                      style={{
                        background: 'var(--color-surface)',
                        borderColor: 'var(--color-border)',
                        color: 'var(--color-text-primary)',
                      }}
                    />
                  </div>
                </>
              )}
            </>
          )}

          {/* remote 字段 */}
          {form.type === 'remote' && (
            <>
              <div>
                <label
                  className="block text-xs font-medium mb-1"
                  style={{ color: 'var(--color-text-secondary)' }}
                >
                  MCP Server URL *
                </label>
                <input
                  type="text"
                  value={form.url}
                  onChange={(e) => update({ url: e.target.value })}
                  placeholder="https://mcp.example.com/mcp"
                  className="w-full px-2 py-1.5 text-xs rounded border focus:outline-none font-mono transition-colors"
                  style={{
                    background: 'var(--color-surface)',
                    borderColor: 'var(--color-border)',
                    color: 'var(--color-text-primary)',
                  }}
                />
              </div>

              {/* Headers (API Key 认证) */}
              <div>
                <label
                  className="block text-xs font-medium mb-1"
                  style={{ color: 'var(--color-text-secondary)' }}
                >
                  Headers (API Key 认证，可选)
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={form.headerKey}
                    onChange={(e) => update({ headerKey: e.target.value })}
                    placeholder="Header 名"
                    className="flex-1 px-2 py-1.5 text-xs rounded border focus:outline-none font-mono transition-colors"
                    style={{
                      background: 'var(--color-surface)',
                      borderColor: 'var(--color-border)',
                      color: 'var(--color-text-primary)',
                    }}
                  />
                  <input
                    type="text"
                    value={form.headerValue}
                    onChange={(e) => update({ headerValue: e.target.value })}
                    placeholder="Header 值 (支持 {env:VAR})"
                    className="flex-[2] px-2 py-1.5 text-xs rounded border focus:outline-none font-mono transition-colors"
                    style={{
                      background: 'var(--color-surface)',
                      borderColor: 'var(--color-border)',
                      color: 'var(--color-text-primary)',
                    }}
                  />
                </div>
              </div>

              {/* OAuth 开关 */}
              <div className="flex items-center justify-between pt-1">
                <span
                  className="text-xs font-medium"
                  style={{ color: 'var(--color-text-secondary)' }}
                >
                  OAuth 2.0 认证
                </span>
                <button
                  onClick={() => update({ hasOauth: !form.hasOauth })}
                  className={`relative w-9 h-5 rounded-full transition-colors`}
                  style={{
                    background: form.hasOauth
                      ? 'var(--color-accent)'
                      : 'var(--color-border)',
                  }}
                >
                  <span
                    className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform"
                    style={{
                      left: form.hasOauth
                        ? 'calc(100% - 1.125rem)'
                        : '0.125rem',
                    }}
                  />
                </button>
              </div>

              {/* OAuth 详细配置 */}
              {form.hasOauth && (
                <>
                  <div>
                    <label
                      className="block text-xs font-medium mb-1"
                      style={{ color: 'var(--color-text-secondary)' }}
                    >
                      授权端点 *
                    </label>
                    <input
                      type="text"
                      value={form.oauthAuthorizationEndpoint}
                      onChange={(e) =>
                        update({ oauthAuthorizationEndpoint: e.target.value })
                      }
                      placeholder="https://example.com/oauth/authorize"
                      className="w-full px-2 py-1.5 text-xs rounded border focus:outline-none font-mono transition-colors"
                      style={{
                        background: 'var(--color-surface)',
                        borderColor: 'var(--color-border)',
                        color: 'var(--color-text-primary)',
                      }}
                    />
                  </div>
                  <div>
                    <label
                      className="block text-xs font-medium mb-1"
                      style={{ color: 'var(--color-text-secondary)' }}
                    >
                      Token 端点 *
                    </label>
                    <input
                      type="text"
                      value={form.oauthTokenEndpoint}
                      onChange={(e) =>
                        update({ oauthTokenEndpoint: e.target.value })
                      }
                      placeholder="https://example.com/oauth/token"
                      className="w-full px-2 py-1.5 text-xs rounded border focus:outline-none font-mono transition-colors"
                      style={{
                        background: 'var(--color-surface)',
                        borderColor: 'var(--color-border)',
                        color: 'var(--color-text-primary)',
                      }}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label
                        className="block text-xs font-medium mb-1"
                        style={{ color: 'var(--color-text-secondary)' }}
                      >
                        Client ID *
                      </label>
                      <input
                        type="text"
                        value={form.oauthClientId}
                        onChange={(e) =>
                          update({ oauthClientId: e.target.value })
                        }
                        placeholder="{'env:MY_CLIENT_ID}'"
                        className="w-full px-2 py-1.5 text-xs rounded border focus:outline-none font-mono transition-colors"
                        style={{
                          background: 'var(--color-surface)',
                          borderColor: 'var(--color-border)',
                          color: 'var(--color-text-primary)',
                        }}
                      />
                    </div>
                    <div>
                      <label
                        className="block text-xs font-medium mb-1"
                        style={{ color: 'var(--color-text-secondary)' }}
                      >
                        Client Secret
                      </label>
                      <input
                        type="password"
                        value={form.oauthClientSecret}
                        onChange={(e) =>
                          update({ oauthClientSecret: e.target.value })
                        }
                        placeholder="(可选)"
                        className="w-full px-2 py-1.5 text-xs rounded border focus:outline-none font-mono transition-colors"
                        style={{
                          background: 'var(--color-surface)',
                          borderColor: 'var(--color-border)',
                          color: 'var(--color-text-primary)',
                        }}
                      />
                    </div>
                  </div>
                  <div>
                    <label
                      className="block text-xs font-medium mb-1"
                      style={{ color: 'var(--color-text-secondary)' }}
                    >
                      Scopes (空格分隔)
                    </label>
                    <input
                      type="text"
                      value={form.oauthScopes}
                      onChange={(e) =>
                        update({ oauthScopes: e.target.value })
                      }
                      placeholder="files:read comments:read"
                      className="w-full px-2 py-1.5 text-xs rounded border focus:outline-none font-mono transition-colors"
                      style={{
                        background: 'var(--color-surface)',
                        borderColor: 'var(--color-border)',
                        color: 'var(--color-text-primary)',
                      }}
                    />
                  </div>
                </>
              )}
            </>
          )}

          {/* 超时 */}
          <div>
            <label
              className="block text-xs font-medium mb-1"
              style={{ color: 'var(--color-text-secondary)' }}
            >
              超时 (毫秒，默认 5000)
            </label>
            <input
              type="number"
              value={form.timeout}
              onChange={(e) => update({ timeout: e.target.value })}
              placeholder="5000"
              min="0"
              className="w-full px-2 py-1.5 text-xs rounded border focus:outline-none font-mono transition-colors"
              style={{
                background: 'var(--color-surface)',
                borderColor: 'var(--color-border)',
                color: 'var(--color-text-primary)',
              }}
            />
          </div>

          {/* 启用开关 */}
          <div className="flex items-center justify-between pt-1">
            <span
              className="text-xs font-medium"
              style={{ color: 'var(--color-text-secondary)' }}
            >
              启用
            </span>
            <button
              onClick={() => update({ enabled: !form.enabled })}
              className="relative w-9 h-5 rounded-full transition-colors"
              style={{
                background: form.enabled
                  ? 'var(--color-accent)'
                  : 'var(--color-border)',
              }}
            >
              <span
                className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform"
                style={{
                  left: form.enabled
                    ? 'calc(100% - 1.125rem)'
                    : '0.125rem',
                }}
              />
            </button>
          </div>

          {/* 错误 */}
          {error && (
            <p
              className="text-xs p-2 rounded"
              style={{
                background: 'rgba(239,68,68,0.1)',
                color: '#ef4444',
              }}
            >
              {error}
            </p>
          )}
        </div>

        {/* Footer */}
        <div
          className="flex justify-end gap-2 px-5 py-4 border-t"
          style={{ borderColor: 'var(--color-border)' }}
        >
          <button
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 text-xs rounded-lg transition-colors"
            style={{
              color: 'var(--color-text-secondary)',
            }}
          >
            取消
          </button>
          <button
            onClick={onSubmit}
            disabled={submitting}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-lg transition-colors disabled:opacity-50"
            style={{
              background: 'var(--color-accent)',
              color: 'var(--color-text-inverse)',
            }}
          >
            {submitting ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                提交中...
              </>
            ) : isEditing ? (
              '保存修改'
            ) : (
              '添加服务器'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
