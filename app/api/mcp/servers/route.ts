/*  MCP Server 列表 & 创建 — GET/POST /api/mcp/servers */
import { NextResponse } from 'next/server';
import {
  getEffectiveServers,
  isBuiltinServer,
} from '@/core/tool-registry/mcp-config';
import { saveUserServer } from '@/core/tool-registry/mcp-config-store';
import { getToolRegistry } from '@/core/tool-registry/mcp-setup';
import { checkOAuthToken } from '@/core/tool-registry/mcp-oauth';

import type { MCPServerEntry, RemoteServerConfig, StdioServerConfig } from '@/core/tool-registry/types';

// ── 列表响应类型 ───────────────────────────────────────────────────────────

interface MCPServerListItem {
  name: string;
  description: string;
  enabled: boolean;
  type: 'stdio' | 'remote';
  isBuiltin: boolean;
  isConnected: boolean;
  toolCount: number;
  /** 仅 remote 模式：OAuth 是否已授权 */
  oauthAuthorized?: boolean;
}

/**
 * GET /api/mcp/servers
 *
 * 列出所有 MCP Server（内建 + 用户自定义），含连接状态。
 *
 * 返回: { servers: MCPServerListItem[] }
 */
export async function GET() {
  try {
    const registry = await getToolRegistry();
    const effective = getEffectiveServers();

    const servers: MCPServerListItem[] = await Promise.all(
      effective.map(async (entry) => {
        const isConnected = registry.isMCPServerConnected(entry.name);
        const toolCount = isConnected
          ? registry.getAll().filter((t) => t.name.startsWith(`mcp__${entry.name}__`)).length
          : 0;

        const item: MCPServerListItem = {
          name: entry.name,
          description: entry.description,
          enabled: entry.enabled !== false,
          type: entry.config.type,
          isBuiltin: isBuiltinServer(entry.name),
          isConnected,
          toolCount,
        };

        // remote 模式：检查 OAuth 授权状态
        if (entry.config.type === 'remote') {
          try {
            const config = entry.config as RemoteServerConfig;
            const hasToken = await checkOAuthToken(entry.name, config.oauth);
            item.oauthAuthorized = hasToken;
          } catch {
            item.oauthAuthorized = false;
          }
        }

        return item;
      }),
    );

    return NextResponse.json({ servers });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[MCP:servers] GET 错误:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// ── 创建请求类型 ───────────────────────────────────────────────────────────

interface CreateMCPServerBody {
  name: string;
  description?: string;
  enabled?: boolean;
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
}

/**
 * POST /api/mcp/servers
 *
 * 创建用户自定义的 MCP Server。
 *
 * 请求体: CreateMCPServerBody
 * 返回: { server: MCPServerListItem }
 */
export async function POST(request: Request) {
  try {
    const body: CreateMCPServerBody = await request.json();

    // ── 参数校验 ───────────────────────────────────────────────────────────

    if (!body.name || !/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(body.name)) {
      return NextResponse.json(
        { error: 'name 必须是以字母开头、仅包含字母数字下划线横线的字符串' },
        { status: 400 },
      );
    }

    if (!body.type || !['stdio', 'remote'].includes(body.type)) {
      return NextResponse.json(
        { error: 'type 必须是 "stdio" 或 "remote"' },
        { status: 400 },
      );
    }

    // 检查名称冲突
    const existing = getEffectiveServers().find((s) => s.name === body.name);
    if (existing) {
      return NextResponse.json(
        { error: `MCP Server "${body.name}" 已存在，请使用 PUT 更新或删除后重建` },
        { status: 409 },
      );
    }

    // Stdio 模式校验
    if (body.type === 'stdio') {
      if (!body.command) {
        return NextResponse.json(
          { error: 'stdio 模式必须提供 command 字段' },
          { status: 400 },
        );
      }
    }

    // Remote 模式校验
    if (body.type === 'remote') {
      if (!body.url) {
        return NextResponse.json(
          { error: 'remote 模式必须提供 url 字段' },
          { status: 400 },
        );
      }
      if (!body.oauth?.authorizationEndpoint || !body.oauth?.tokenEndpoint || !body.oauth?.clientId) {
        return NextResponse.json(
          { error: 'remote 模式必须提供 oauth.authorizationEndpoint、oauth.tokenEndpoint、oauth.clientId' },
          { status: 400 },
        );
      }
    }

    // ── 构建配置 ───────────────────────────────────────────────────────────

    let config: StdioServerConfig | RemoteServerConfig;

    if (body.type === 'stdio') {
      config = {
        type: 'stdio',
        command: body.command!,
        args: body.args ?? [],
        env: body.env,
      };
    } else {
      config = {
        type: 'remote',
        url: body.url!,
        oauth: {
          authorizationEndpoint: body.oauth!.authorizationEndpoint,
          tokenEndpoint: body.oauth!.tokenEndpoint,
          clientId: body.oauth!.clientId,
          clientSecret: body.oauth!.clientSecret,
          scopes: body.oauth!.scopes ?? [],
        },
      };
    }

    const entry: MCPServerEntry = {
      name: body.name,
      description: body.description ?? '',
      enabled: body.enabled !== false,
      config,
    };

    // ── 持久化 ─────────────────────────────────────────────────────────────

    saveUserServer(entry);

    // ── Stdio 模式：立即尝试连接 ───────────────────────────────────────────

    let isConnected = false;
    let toolCount = 0;

    if (body.type === 'stdio' && entry.enabled) {
      try {
        const { connectServerByName } = await import(
          '@/core/tool-registry/mcp-setup'
        );
        const tools = await connectServerByName(body.name);
        isConnected = true;
        toolCount = tools.length;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[MCP:servers] ${body.name} stdio 连接失败: ${msg}`);
        // 保存配置成功但连接失败，仍返回创建成功
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
/*  end: MCP Server 列表 & 创建 */
