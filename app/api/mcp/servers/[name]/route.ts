/*  MCP Server 更新 & 删除 — PUT/DELETE /api/mcp/servers/[name] */
import { NextResponse } from 'next/server';
import {
  getEffectiveServers,
  isBuiltinServer,
} from '@/core/tool-registry/mcp-config';
import {
  getUserServer,
  saveUserServer,
  deleteUserServer,
} from '@/core/tool-registry/mcp-config-store';
import { connectServerByName, disconnectServerByName } from '@/core/tool-registry/mcp-setup';
import { revokeOAuthToken } from '@/core/tool-registry/mcp-oauth';

import type { MCPServerEntry, StdioServerConfig, RemoteServerConfig } from '@/core/tool-registry/types';

// ── 更新请求类型 ───────────────────────────────────────────────────────────

interface UpdateMCPServerBody {
  description?: string;
  enabled?: boolean;
  /** 如果提供，会修改连接配置；不提供则保留原配置 */
  config?: {
    type: 'stdio' | 'remote';
    /** Stdio 模式字段 */
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    /** Remote 模式字段 */
    url?: string;
    oauth?: {
      authorizationEndpoint: string;
      tokenEndpoint: string;
      clientId: string;
      clientSecret?: string;
      scopes: string[];
    };
  };
}

/**
 * PUT /api/mcp/servers/[name]
 *
 * 更新 MCP Server 配置。
 * - 内建 server：只能更新 enabled 和 description，不能修改 config
 * - 用户自定义 server：可以更新所有字段
 * - 如果 config 有变更，会先断开再重连
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  try {
    const { name } = await params;
    const body: UpdateMCPServerBody = await request.json();

    const builtin = isBuiltinServer(name);
    const userEntry = getUserServer(name);

    // ── 查找现有配置 ───────────────────────────────────────────────────────

    let existing: MCPServerEntry | undefined;

    if (builtin) {
      existing = getEffectiveServers().find((s) => s.name === name);
    } else {
      existing = userEntry;
    }

    if (!existing) {
      return NextResponse.json(
        { error: `未找到 MCP Server: ${name}` },
        { status: 404 },
      );
    }

    // ── 内建 server 限制 ──────────────────────────────────────────────────

    if (body.config && builtin) {
      return NextResponse.json(
        { error: `内建 MCP Server "${name}" 不允许修改连接配置` },
        { status: 403 },
      );
    }

    // ── 构建新配置 ─────────────────────────────────────────────────────────

    let configChanged = false;
    let newConfig = existing.config;

    if (body.config) {
      if (body.config.type === 'stdio') {
        if (!body.config.command) {
          return NextResponse.json(
            { error: 'stdio 模式必须提供 command 字段' },
            { status: 400 },
          );
        }
        newConfig = {
          type: 'stdio',
          command: body.config.command,
          args: body.config.args ?? [],
          env: body.config.env,
        } as StdioServerConfig;
        configChanged = true;
      } else if (body.config.type === 'remote') {
        if (!body.config.url) {
          return NextResponse.json(
            { error: 'remote 模式必须提供 url 字段' },
            { status: 400 },
          );
        }
        if (
          !body.config.oauth?.authorizationEndpoint ||
          !body.config.oauth?.tokenEndpoint ||
          !body.config.oauth?.clientId
        ) {
          return NextResponse.json(
            {
              error:
                'remote 模式必须提供 oauth.authorizationEndpoint、oauth.tokenEndpoint、oauth.clientId',
            },
            { status: 400 },
          );
        }
        newConfig = {
          type: 'remote',
          url: body.config.url,
          oauth: {
            authorizationEndpoint: body.config.oauth.authorizationEndpoint,
            tokenEndpoint: body.config.oauth.tokenEndpoint,
            clientId: body.config.oauth.clientId,
            clientSecret: body.config.oauth.clientSecret,
            scopes: body.config.oauth.scopes ?? [],
          },
        } as RemoteServerConfig;
        configChanged = true;
      }
    }

    const updatedEntry: MCPServerEntry = {
      ...existing,
      description: body.description ?? existing.description,
      enabled: body.enabled !== undefined ? body.enabled : existing.enabled !== false,
      config: newConfig,
    };

    // ── 持久化 ─────────────────────────────────────────────────────────────

    if (builtin) {
      // 内建 server 的变更写入用户配置（覆盖内建配置）
      saveUserServer(updatedEntry);
    } else {
      saveUserServer(updatedEntry);
    }

    // ── 重连逻辑 ───────────────────────────────────────────────────────────

    let isConnected = false;
    let toolCount = 0;

    // 如果 config 有变更，先断开
    if (configChanged) {
      try {
        await disconnectServerByName(name);
        if (existing.config.type === 'remote') {
          // remote 模式断开时清理 token
          await revokeOAuthToken(name);
        }
      } catch {
        // 忽略断开错误
      }
    }

    // 如果 disabled，断开连接
    if (!updatedEntry.enabled) {
      try {
        await disconnectServerByName(name);
      } catch {
        // 忽略
      }
    }

    // 如果 enabled 且没有 config 变更导致的重连，且当前未连接
    if (updatedEntry.enabled) {
      try {
        // stdio 模式或 remote 已授权 → 尝试连接
        if (updatedEntry.config.type === 'stdio') {
          const tools = await connectServerByName(name);
          isConnected = true;
          toolCount = tools.length;
        }
        // remote 模式不自动连接，需要走 OAuth 流程
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[MCP:servers] ${name} 重连失败: ${msg}`);
      }
    }

    return NextResponse.json({
      server: {
        name: updatedEntry.name,
        description: updatedEntry.description,
        enabled: updatedEntry.enabled !== false,
        type: updatedEntry.config.type,
        isBuiltin: builtin,
        isConnected,
        toolCount,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[MCP:servers] PUT 错误:`, msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * DELETE /api/mcp/servers/[name]
 *
 * 删除 MCP Server。
 * - 内建 server：返回 403 禁止删除，可通过 PUT 设置 enabled: false 来禁用
 * - 用户自定义 server：断开连接 + 清理 token + 删除配置
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  try {
    const { name } = await params;

    // 内建 server 不可删除
    if (isBuiltinServer(name)) {
      return NextResponse.json(
        { error: `内建 MCP Server "${name}" 不可删除，可通过 PUT 设置 enabled: false 禁用` },
        { status: 403 },
      );
    }

    // 检查是否存在
    const entry = getUserServer(name);
    if (!entry) {
      return NextResponse.json(
        { error: `未找到 MCP Server: ${name}` },
        { status: 404 },
      );
    }

    // 断开连接
    if (entry.config.type === 'remote') {
      await revokeOAuthToken(name);
    }
    try {
      await disconnectServerByName(name);
    } catch {
      // 忽略断开错误
    }

    // 删除配置
    deleteUserServer(name);

    return NextResponse.json({ success: true, name });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[MCP:servers] DELETE 错误:`, msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
/*  end: MCP Server 更新 & 删除 */
