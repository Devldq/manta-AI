/* MCP OAuth 状态查询 — GET /api/mcp/oauth/status?server=xxx
 *
 * 查询 OAuth 授权状态，完成后自动连接 MCP Server。
 * 支持 local 和 remote 两种模式。
 */
import { NextResponse } from 'next/server';
import { getEffectiveServers } from '@tools/mcp/config';
import { checkOAuthToken } from '@tools/mcp/oauth';
import { connectServerByName } from '@tools/mcp/setup';
import { resolveEnvVarsInObject } from '@tools/registry/types';
import type { RemoteServerConfig, LocalServerConfig, OAuthServerConfig } from '@tools/registry/types';

/**
 * GET /api/mcp/oauth/status?server=figma   (remote)
 * GET /api/mcp/oauth/status?server=github  (local)
 *
 * 查询 OAuth 授权状态：
 * - 检查 token 是否存在且有效
 * - 如果有效且 server 未注册工具，则动态注册 MCP 工具
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

    // 提取 OAuth 配置（local 或 remote 都可以有 oauth 字段）
    let oauthConfig: OAuthServerConfig | undefined;
    if (entry.config.type === 'remote') {
      oauthConfig = (entry.config as RemoteServerConfig).oauth;
    } else if (entry.config.type === 'local') {
      oauthConfig = (entry.config as LocalServerConfig).oauth;
    }

    if (!oauthConfig) {
      return NextResponse.json(
        { error: `${serverName} 未配置 OAuth` },
        { status: 400 },
      );
    }

    // 解析环境变量引用后检查 token
    const resolvedOAuth = resolveEnvVarsInObject(oauthConfig);
    const hasToken = await checkOAuthToken(serverName, resolvedOAuth);

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
        toolNames: tools,
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
