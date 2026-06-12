/* MCP Server 更新 & 删除 — PUT/DELETE /api/mcp/servers/[name]
 *
 * 参照 OpenCode 设计重构:
 * - 支持新的 local/remote 配置格式
 * - remote 支持 headers 简单认证
 * - 内建 server 只能更新 enabled/description
 */
import { NextResponse } from 'next/server';
import {
  getEffectiveServers,
  isBuiltinServer,
} from '@tools/mcp/config';
import {
  getUserServer,
  saveUserServer,
  deleteUserServer,
} from '@tools/mcp/config-store';
import {
  connectServerByName,
  disconnectServerByName,
} from '@tools/mcp/setup';
import { revokeOAuthToken } from '@tools/mcp/oauth';

import type {
  MCPServerEntry,
  LocalServerConfig,
  RemoteServerConfig,
} from '@tools/registry/types';

// ── 更新请求类型 ────────────────────────────────────────────────────────────

interface UpdateMCPServerBody {
  description?: string;
  enabled?: boolean;
  /** 如果提供，会修改连接配置；不提供则保留原配置 */
  config?: {
    type: 'local' | 'remote';
    /** local 模式字段 */
    command?: string[];
    environment?: Record<string, string>;
    timeout?: number;
    /** remote 模式字段 */
    url?: string;
    headers?: Record<string, string>;
    oauth?: {
      authorizationEndpoint: string;
      tokenEndpoint: string;
      clientId: string;
      clientSecret?: string;
      scopes: string[];
      /** local 模式: 将 token 注入到哪个环境变量 */
      tokenEnvVar?: string;
    };
  };
}

/**
 * PUT /api/mcp/servers/[name]
 *
 * 更新 MCP Server 配置。
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

    // ── 查找现有配置 ──────────────────────────────────────────────────────

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

    // ── 内建 server 限制 ─────────────────────────────────────────────────

    if (body.config && builtin) {
      return NextResponse.json(
        { error: `内建 MCP Server "${name}" 不允许修改连接配置` },
        { status: 403 },
      );
    }

    // ── 构建新配置 ────────────────────────────────────────────────────────

    let configChanged = false;
    let newConfig = existing.config;

    if (body.config) {
      if (body.config.type === 'local') {
        if (!body.config.command || body.config.command.length === 0) {
          return NextResponse.json(
            { error: 'local 模式必须提供 command 数组' },
            { status: 400 },
          );
        }
        newConfig = {
          type: 'local',
          command: body.config.command,
          environment: body.config.environment,
          oauth: body.config.oauth
            ? {
                authorizationEndpoint: body.config.oauth.authorizationEndpoint,
                tokenEndpoint: body.config.oauth.tokenEndpoint,
                clientId: body.config.oauth.clientId,
                clientSecret: body.config.oauth.clientSecret,
                scopes: body.config.oauth.scopes ?? [],
                tokenEnvVar: body.config.oauth.tokenEnvVar,
              }
            : undefined,
          timeout: body.config.timeout,
        } as LocalServerConfig;
        configChanged = true;
      } else if (body.config.type === 'remote') {
        if (!body.config.url) {
          return NextResponse.json(
            { error: 'remote 模式必须提供 url 字段' },
            { status: 400 },
          );
        }
        newConfig = {
          type: 'remote',
          url: body.config.url,
          headers: body.config.headers,
          oauth: body.config.oauth
            ? {
                authorizationEndpoint: body.config.oauth.authorizationEndpoint,
                tokenEndpoint: body.config.oauth.tokenEndpoint,
                clientId: body.config.oauth.clientId,
                clientSecret: body.config.oauth.clientSecret,
                scopes: body.config.oauth.scopes ?? [],
              }
            : undefined,
          timeout: body.config.timeout,
        } as RemoteServerConfig;
        configChanged = true;
      }
    }

    const updatedEntry: MCPServerEntry = {
      ...existing,
      description: body.description ?? existing.description,
      enabled:
        body.enabled !== undefined ? body.enabled : existing.enabled !== false,
      config: newConfig,
    };

    // ── 持久化 ────────────────────────────────────────────────────────────

    saveUserServer(updatedEntry);

    // ── 重连逻辑 ──────────────────────────────────────────────────────────

    let isConnected = false;
    let toolCount = 0;
    let toolNames: string[] = [];

    if (configChanged) {
      try {
        await disconnectServerByName(name);
        if (existing.config.type === 'remote') {
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

    // 如果 enabled，尝试连接
    if (updatedEntry.enabled) {
      try {
        if (updatedEntry.config.type === 'local') {
          const tools = await connectServerByName(name);
          isConnected = true;
          toolCount = tools.length;
          toolNames = tools;
        }
        // remote 不自动连接，需要走 OAuth 或 headers 认证流程
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
        toolNames,
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
 * 删除 MCP Server。内建 server 返回 403。
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  try {
    const { name } = await params;

    if (isBuiltinServer(name)) {
      return NextResponse.json(
        {
          error: `内建 MCP Server "${name}" 不可删除，可通过 PUT 设置 enabled: false 禁用`,
        },
        { status: 403 },
      );
    }

    const entry = getUserServer(name);
    if (!entry) {
      return NextResponse.json(
        { error: `未找到 MCP Server: ${name}` },
        { status: 404 },
      );
    }

    // 断开连接 & 撤销 OAuth token
    await revokeOAuthToken(name);
    try {
      await disconnectServerByName(name);
    } catch {
      // 忽略断开错误
    }

    deleteUserServer(name);

    return NextResponse.json({ success: true, name });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[MCP:servers] DELETE 错误:`, msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
