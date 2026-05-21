/*  MCP Server 管理页 — /mcp */
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
} from 'lucide-react';

// ── 类型定义 ───────────────────────────────────────────────────────────────

interface MCPServerListItem {
  name: string;
  description: string;
  enabled: boolean;
  type: 'stdio' | 'remote';
  isBuiltin: boolean;
  isConnected: boolean;
  toolCount: number;
  oauthAuthorized?: boolean;
}

interface ServerFormData {
  name: string;
  description: string;
  enabled: boolean;
  type: 'stdio' | 'remote';
  // Stdio
  command: string;
  args: string;
  env: string; // 每行 KEY=VALUE
  // Remote
  url: string;
  oauthAuthorizationEndpoint: string;
  oauthTokenEndpoint: string;
  oauthClientId: string;
  oauthClientSecret: string;
  oauthScopes: string;
}

// ── 初始表单数据 ───────────────────────────────────────────────────────────

const emptyForm: ServerFormData = {
  name: '',
  description: '',
  enabled: true,
  type: 'stdio',
  command: '',
  args: '',
  env: '',
  url: '',
  oauthAuthorizationEndpoint: '',
  oauthTokenEndpoint: '',
  oauthClientId: '',
  oauthClientSecret: '',
  oauthScopes: '',
};

// ── 页面组件 ───────────────────────────────────────────────────────────────

export default function MCPServersPage() {
  const [servers, setServers] = useState<MCPServerListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Modal 状态
  const [showModal, setShowModal] = useState(false);
  const [editingServer, setEditingServer] = useState<string | null>(null);
  const [form, setForm] = useState<ServerFormData>(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  // 展开的 server 详情
  const [expandedServer, setExpandedServer] = useState<string | null>(null);

  // ── 加载 server 列表 ─────────────────────────────────────────────────────

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

  // ── Modal 操作 ───────────────────────────────────────────────────────────

  function openCreateModal() {
    setEditingServer(null);
    setForm(emptyForm);
    setFormError('');
    setShowModal(true);
  }

  function openEditModal(server: MCPServerListItem) {
    setEditingServer(server.name);
    // 预填现有值（config 字段需要从 API 获取，此处简化处理）
    setForm({
      name: server.name,
      description: server.description,
      enabled: server.enabled,
      type: server.type,
      command: '',
      args: '',
      env: '',
      url: '',
      oauthAuthorizationEndpoint: '',
      oauthTokenEndpoint: '',
      oauthClientId: '',
      oauthClientSecret: '',
      oauthScopes: '',
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

  // ── 表单验证 ─────────────────────────────────────────────────────────────

  function validateForm(): boolean {
    if (!form.name.trim()) {
      setFormError('名称不能为空');
      return false;
    }
    if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(form.name.trim())) {
      setFormError('名称必须以字母开头，仅包含字母、数字、下划线和横线');
      return false;
    }
    if (form.type === 'stdio' && !form.command.trim()) {
      setFormError('Stdio 模式需要提供命令');
      return false;
    }
    if (form.type === 'remote') {
      if (!form.url.trim()) {
        setFormError('Remote 模式需要提供 URL');
        return false;
      }
      if (!form.oauthAuthorizationEndpoint.trim() || !form.oauthTokenEndpoint.trim() || !form.oauthClientId.trim()) {
        setFormError('Remote 模式需要提供 OAuth 授权端点、Token 端点和 Client ID');
        return false;
      }
    }
    return true;
  }

  // ── 提交表单 ─────────────────────────────────────────────────────────────

  async function handleSubmit() {
    if (!validateForm()) return;

    setSubmitting(true);
    setFormError('');

    try {
      // 解析 env（每行 KEY=VALUE）
      const envObj: Record<string, string> = {};
      if (form.env.trim()) {
        form.env.split('\n').forEach((line) => {
          const idx = line.indexOf('=');
          if (idx > 0) {
            envObj[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
          }
        });
      }

      // 解析 args（空格分隔）
      const argsArr = form.args.trim()
        ? form.args.trim().split(/\s+/)
        : [];

      // 解析 scopes（空格分隔）
      const scopesArr = form.oauthScopes.trim()
        ? form.oauthScopes.trim().split(/\s+/)
        : [];

      const body: Record<string, unknown> = {
        name: form.name.trim(),
        description: form.description.trim(),
        enabled: form.enabled,
        type: form.type,
      };

      if (form.type === 'stdio') {
        body.command = form.command.trim();
        body.args = argsArr;
        body.env = Object.keys(envObj).length > 0 ? envObj : undefined;
      } else {
        body.url = form.url.trim();
        body.oauth = {
          authorizationEndpoint: form.oauthAuthorizationEndpoint.trim(),
          tokenEndpoint: form.oauthTokenEndpoint.trim(),
          clientId: form.oauthClientId.trim(),
          clientSecret: form.oauthClientSecret.trim() || undefined,
          scopes: scopesArr,
        };
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

  // ── 删除 server ──────────────────────────────────────────────────────────

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

  // ── 连接/断开 ────────────────────────────────────────────────────────────

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

  // ── 状态徽章 ─────────────────────────────────────────────────────────────

  function StatusBadge({ server }: { server: MCPServerListItem }) {
    if (!server.enabled) {
      return (
        <span
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium"
          style={{ background: 'var(--color-surface)', color: 'var(--color-text-muted)' }}
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
          <CheckCircle2 size={12} /> 已连接 ({server.toolCount} 工具)
        </span>
      );
    }
    if (server.type === 'remote' && server.oauthAuthorized === false) {
      return (
        <span
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium"
          style={{ background: 'rgba(250,204,21,0.15)', color: '#facc15' }}
        >
          <AlertCircle size={12} /> 待授权
        </span>
      );
    }
    if (server.type === 'remote' && server.oauthAuthorized === true) {
      return (
        <span
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium"
          style={{ background: 'rgba(59,130,246,0.15)', color: '#3b82f6' }}
        >
          <Globe size={12} /> 已授权（未连接）
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

  // ── 渲染 ─────────────────────────────────────────────────────────────────

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

      {/* 错误 */}
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

      {/* Server 列表 */}
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
                setExpandedServer(expandedServer === server.name ? null : server.name)
              }
              onEdit={() => openEditModal(server)}
              onDelete={() => handleDelete(server.name)}
              onToggleEnabled={() => handleToggleEnabled(server)}
              onRefresh={loadServers}
            />
          ))}
        </div>
      )}

      {/* 添加/编辑 Modal */}
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

// ── Server 卡片组件 ────────────────────────────────────────────────────────

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
      const res = await fetch(`/api/mcp/oauth/start?server=${encodeURIComponent(server.name)}`);
      if (!res.ok) {
        const data = await res.json();
        alert(data.error || 'OAuth 启动失败');
        return;
      }
      const data = await res.json();
      // 打开授权页面
      if (data.authorizationUrl) {
        window.open(data.authorizationUrl, '_blank');
        // 轮询等待授权完成
        const poll = setInterval(async () => {
          const statusRes = await fetch(`/api/mcp/oauth/status?server=${server.name}`);
          const statusData = await statusRes.json();
          if (statusData.connected) {
            clearInterval(poll);
            onRefresh();
          }
        }, 3000);
        setTimeout(() => clearInterval(poll), 5 * 60 * 1000); // 5 分钟超时
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
        background: server.enabled ? 'var(--color-background)' : 'var(--color-surface)',
        opacity: server.enabled ? 1 : 0.6,
      }}
    >
      {/* 主行 */}
      <div className="flex items-center gap-4 p-4">
        {/* 展开按钮 */}
        <button
          onClick={onToggleExpand}
          className="flex-shrink-0 p-1 rounded transition-transform"
          style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)' }}
        >
          <ChevronDown size={16} style={{ color: 'var(--color-text-muted)' }} />
        </button>

        {/* 图标 */}
        <div
          className="flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center"
          style={{ background: 'var(--color-surface)' }}
        >
          {server.isBuiltin ? (
            <Shield size={18} style={{ color: 'var(--color-accent)' }} />
          ) : server.type === 'remote' ? (
            <Globe size={18} style={{ color: 'var(--color-accent)' }} />
          ) : (
            <Wrench size={18} style={{ color: 'var(--color-accent)' }} />
          )}
        </div>

        {/* 信息 */}
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
            {server.description || (server.type === 'stdio' ? '本地 Stdio 进程' : '远程 HTTP 服务')}
          </p>
        </div>

        {/* 状态 */}
        <div className="flex-shrink-0">
          <StatusBadge server={server} />
        </div>

        {/* 操作按钮 */}
        <div className="flex-shrink-0 flex items-center gap-1">
          {/* Remote 模式：连接按钮 */}
          {server.type === 'remote' && server.enabled && !server.isConnected && (
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

          {/* 已连接：断开按钮 */}
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

          {/* 编辑（仅自定义 server） */}
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

          {/* 删除（仅自定义 server） */}
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

          {/* 启用/禁用切换 */}
          <button
            onClick={onToggleEnabled}
            className="p-1.5 rounded-lg transition-colors"
            style={{ color: 'var(--color-text-muted)' }}
            title={server.enabled ? '禁用' : '启用'}
          >
            {server.enabled ? (
              <XCircle size={16} />
            ) : (
              <CheckCircle2 size={16} />
            )}
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
            <DetailItem label="类型" value={server.type === 'stdio' ? 'Stdio (本地进程)' : 'Remote (HTTP + OAuth)'} />
            <DetailItem label="状态" value={server.enabled ? (server.isConnected ? '已连接' : '未连接') : '已禁用'} />
            <DetailItem label="工具数" value={server.toolCount > 0 ? `${server.toolCount} 个工具` : '-'} />
            <DetailItem label="来源" value={server.isBuiltin ? '内建' : '用户自定义'} />
            {server.type === 'remote' && (
              <DetailItem
                label="OAuth 授权"
                value={server.oauthAuthorized ? '已授权' : '未授权'}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── 详情项 ─────────────────────────────────────────────────────────────────

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
        {label}
      </span>
      <p className="text-sm mt-0.5" style={{ color: 'var(--color-text-primary)' }}>
        {value}
      </p>
    </div>
  );
}

// ── 状态徽章（外部提取版）──────────────────────────────────────────────────

function StatusBadge({ server }: { server: MCPServerListItem }) {
  if (!server.enabled) {
    return (
      <span
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium"
        style={{ background: 'var(--color-surface)', color: 'var(--color-text-muted)' }}
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
        <CheckCircle2 size={12} /> 已连接 ({server.toolCount} 工具)
      </span>
    );
  }
  if (server.type === 'remote' && server.oauthAuthorized === false) {
    return (
      <span
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium"
        style={{ background: 'rgba(250,204,21,0.15)', color: '#facc15' }}
      >
        <AlertCircle size={12} /> 待授权
      </span>
    );
  }
  if (server.type === 'remote' && server.oauthAuthorized === true) {
    return (
      <span
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium"
        style={{ background: 'rgba(59,130,246,0.15)', color: '#3b82f6' }}
      >
        <Globe size={12} /> 已授权（未连接）
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

// ── 表单 Modal ─────────────────────────────────────────────────────────────

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
        {/* Modal Header */}
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

        {/* Modal Body */}
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
              {(['stdio', 'remote'] as const).map((t) => (
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
                  {t === 'stdio' ? '📡 Stdio (本地进程)' : '🌐 Remote (HTTP + OAuth)'}
                </button>
              ))}
            </div>
          </div>

          {/* Stdio 字段 */}
          {form.type === 'stdio' && (
            <>
              <div>
                <label
                  className="block text-xs font-medium mb-1"
                  style={{ color: 'var(--color-text-secondary)' }}
                >
                  命令 *
                </label>
                <input
                  type="text"
                  value={form.command}
                  onChange={(e) => update({ command: e.target.value })}
                  placeholder="例如: npx 或 node"
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
                  参数 (空格分隔)
                </label>
                <input
                  type="text"
                  value={form.args}
                  onChange={(e) => update({ args: e.target.value })}
                  placeholder="例如: -y @modelcontextprotocol/server-github"
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
                  环境变量 (每行 KEY=VALUE)
                </label>
                <textarea
                  value={form.env}
                  onChange={(e) => update({ env: e.target.value })}
                  placeholder="GITHUB_TOKEN=ghp_xxx"
                  rows={3}
                  className="w-full px-2 py-1.5 text-xs rounded border focus:outline-none font-mono resize-none transition-colors"
                  style={{
                    background: 'var(--color-surface)',
                    borderColor: 'var(--color-border)',
                    color: 'var(--color-text-primary)',
                  }}
                />
              </div>
            </>
          )}

          {/* Remote 字段 */}
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
              <div>
                <label
                  className="block text-xs font-medium mb-1"
                  style={{ color: 'var(--color-text-secondary)' }}
                >
                  OAuth 授权端点 *
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
                  OAuth Token 端点 *
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
                    placeholder="your-client-id"
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
                  onChange={(e) => update({ oauthScopes: e.target.value })}
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
              className={`relative w-9 h-5 rounded-full transition-colors ${
                form.enabled ? '' : ''
              }`}
              style={{
                background: form.enabled ? 'var(--color-accent)' : 'var(--color-border)',
              }}
            >
              <span
                className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform"
                style={{
                  left: form.enabled ? 'calc(100% - 1.125rem)' : '0.125rem',
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

        {/* Modal Footer */}
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
/*  end: MCP Server 管理页 */
