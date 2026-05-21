/*  start: MCP OAuth 状态查询 — GET /api/mcp/oauth/status?server=xxx */
import { NextResponse } from 'next/server';
import { getEffectiveServers } from '@/core/tool-registry/mcp-config';
import { checkOAuthToken } from '@/core/tool-registry/mcp-oauth';
import { connectServerByName } from '@/core/tool-registry/mcp-setup';
import type { RemoteServerConfig } from '@/core/tool-registry/types';

/**
 * GET /api/mcp/oauth/status?server=figma
 *
 * 查询 OAuth 授权状态：
 * - 检查 token 是否存在且有效
 * - 如果有效且 server 未注册工具，则动态注册 MCP 工具
 *
 * 返回：
 * - { connected: true, serverName }  — 已连接
 * - { connected: false, serverName } — 未授权
 *
 * 前端在收到 authorizationUrl 后，轮询此接口检测授权是否完成。
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const serverName = searchParams.get('server');

    if (!serverName) {
      return NextResponse.json(
        { error: '缺少 server 参数' },
        { status: 400 },
      );
    }

    const entry = getEffectiveServers().find((s) => s.name === serverName);
    if (!entry) {
      return NextResponse.json(
        { error: `未找到 MCP Server: ${serverName}` },
        { status: 404 },
      );
    }

    if (entry.config.type !== 'remote') {
      return NextResponse.json(
        { error: `${serverName} 不是 Remote OAuth 模式` },
        { status: 400 },
      );
    }

    const config = entry.config as RemoteServerConfig;

    // 检查 token
    const hasToken = await checkOAuthToken(serverName, config.oauth);

    if (!hasToken) {
      return NextResponse.json({ connected: false, serverName });
    }

    // Token 存在 — 尝试连接 MCP Server 并注册工具
    try {
      const tools = await connectServerByName(serverName);
      return NextResponse.json({
        connected: true,
        serverName,
        toolCount: tools.length,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[MCP:OAuth:status] ${serverName} 连接失败: ${msg}`);
      return NextResponse.json({
        connected: false,
        serverName,
        error: msg,
      });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[MCP:OAuth:status] 错误:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
/*  end: MCP OAuth 状态查询 */
