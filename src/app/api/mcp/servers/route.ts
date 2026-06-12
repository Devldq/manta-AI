/* MCP Server 列表 & 创建 — GET/POST /api/mcp/servers
 *
 * 参照 OpenCode 设计重构:
 * - type 使用 "local" / "remote" (原 "stdio" / "remote")
 * - command 使用数组格式 (原 command + args)
 * - remote 支持 headers 简单认证 (原仅支持 OAuth)
 */
import { NextResponse } from 'next/server';
import {
  getEffectiveServers,
  isBuiltinServer,
} from '@tools/mcp/config';
import { saveUserServer } from '@tools/mcp/config-store';
import { getAllMCPServerStatus } from '@tools/mcp/setup';

import type {
  LocalServerConfig,
  RemoteServerConfig,
} from '@tools/registry/types';

// ── 列表响应类型 ────────────────────────────────────────────────────────────

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

/**
 * GET /api/mcp/servers
 *
 * 列出所有 MCP Server（内建 + 用户自定义），含连接状态。
 */
export async function GET() {
  try {
    const statuses = await getAllMCPServerStatus();
    const effective = getEffectiveServers();

    // 合并状态和配置
    const servers: MCPServerListItem[] = effective.map((entry) => {
      const status = statuses.find((s) => s.name === entry.name);
      return {
        name: entry.name,
        description: entry.description,
        enabled: entry.enabled !== false,
        type: entry.config.type,
        isBuiltin: isBuiltinServer(entry.name),
        isConnected: status?.isConnected ?? false,
        toolCount: status?.toolCount ?? 0,
        toolNames: status?.toolNames ?? [],
        oauthRequired: status?.oauthRequired,
        oauthAuthorized: status?.oauthAuthorized,
        lastError: status?.lastError,
      };
    });

    return NextResponse.json({ servers });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[MCP:servers] GET 错误:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// ── 创建请求类型 ────────────────────────────────────────────────────────────

interface CreateMCPServerBody {
  name: string;
  description?: string;
  enabled?: boolean;
  type: 'local' | 'remote';
  /** local 模式: command 数组 */
  command?: string[];
  /** local 模式: 环境变量 */
  environment?: Record<string, string>;
  /** remote 模式: URL */
  url?: string;
  /** remote 模式: 自定义请求头 (API Key 认证) */
  headers?: Record<string, string>;
  /** remote 模式: OAuth 配置 (如果配置，优先于 headers 的 Authorization) */
  oauth?: {
    authorizationEndpoint: string;
    tokenEndpoint: string;
    clientId: string;
    clientSecret?: string;
    scopes: string[];
    /** local 模式: 将 token 注入到哪个环境变量 */
    tokenEnvVar?: string;
  };
  /** 超时 (毫秒) */
  timeout?: number;
}

/**
 * POST /api/mcp/servers
 *
 * 创建用户自定义的 MCP Server。
 */
export async function POST(request: Request) {
  try {
    const body: CreateMCPServerBody = await request.json();

    // ── 参数校验 ──────────────────────────────────────────────────────────

    if (!body.name || !/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(body.name)) {
      return NextResponse.json(
        { error: 'name 必须是以字母开头、仅包含字母数字下划线横线的字符串' },
        { status: 400 },
      );
    }

    if (!body.type || !['local', 'remote'].includes(body.type)) {
      return NextResponse.json(
        { error: 'type 必须是 "local" 或 "remote"' },
        { status: 400 },
      );
    }

    // 检查名称冲突
    const existing = getEffectiveServers().find((s) => s.name === body.name);
    if (existing) {
      return NextResponse.json(
        {
          error: `MCP Server "${body.name}" 已存在，请使用 PUT 更新或删除后重建`,
        },
        { status: 409 },
      );
    }

    // local 模式校验
    if (body.type === 'local') {
      if (!body.command || body.command.length === 0) {
        return NextResponse.json(
          { error: 'local 模式必须提供 command 数组' },
          { status: 400 },
        );
      }
    }

    // remote 模式校验
    if (body.type === 'remote') {
      if (!body.url) {
        return NextResponse.json(
          { error: 'remote 模式必须提供 url 字段' },
          { status: 400 },
        );
      }
    }

    // ── 构建配置 ──────────────────────────────────────────────────────────

    let config: LocalServerConfig | RemoteServerConfig;

    if (body.type === 'local') {
      config = {
        type: 'local',
        command: body.command!,
        environment: body.environment,
        oauth: body.oauth
          ? {
              authorizationEndpoint: body.oauth.authorizationEndpoint,
              tokenEndpoint: body.oauth.tokenEndpoint,
              clientId: body.oauth.clientId,
              clientSecret: body.oauth.clientSecret,
              scopes: body.oauth.scopes ?? [],
              tokenEnvVar: body.oauth.tokenEnvVar,
            }
          : undefined,
        timeout: body.timeout,
      };
    } else {
      config = {
        type: 'remote',
        url: body.url!,
        headers: body.headers,
        oauth: body.oauth
          ? {
              authorizationEndpoint: body.oauth.authorizationEndpoint,
              tokenEndpoint: body.oauth.tokenEndpoint,
              clientId: body.oauth.clientId,
              clientSecret: body.oauth.clientSecret,
              scopes: body.oauth.scopes ?? [],
              tokenEnvVar: body.oauth.tokenEnvVar,
            }
          : undefined,
        timeout: body.timeout,
      };
    }

    const entry = {
      name: body.name,
      description: body.description ?? '',
      enabled: body.enabled !== false,
      config,
    };

    // ── 持久化 ────────────────────────────────────────────────────────────

    saveUserServer(entry);

    // ── local 模式: 立即尝试连接 ────────────────────────────────────────

    let isConnected = false;
    let toolCount = 0;
    let toolNames: string[] = [];

    if (body.type === 'local' && entry.enabled) {
      try {
        const { connectServerByName } = await import(
          '@tools/mcp/setup'
        );
        const tools = await connectServerByName(body.name);
        isConnected = true;
        toolCount = tools.length;
        toolNames = tools;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[MCP:servers] ${body.name} local 连接失败: ${msg}`);
      }
    }

    return NextResponse.json(
      {
        server: {
          name: entry.name,
          description: entry.description,
          enabled: entry.enabled !== false,
          type: entry.config.type,
          isBuiltin: false,
          isConnected,
          toolCount,
          toolNames,
        },
      },
      { status: 201 },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[MCP:servers] POST 错误:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
