/* MCP OAuth 授权启动 — GET /api/mcp/oauth/start?server=xxx
 *
 * 支持 local 和 remote 两种模式的 OAuth 授权。
 */
import { NextResponse } from 'next/server';
import { getEffectiveServers } from '@tools/mcp/config';
import { startOAuthFlow } from '@tools/mcp/oauth';
import { resolveEnvVarsInObject } from '@tools/registry/types';
import type { RemoteServerConfig, LocalServerConfig, OAuthServerConfig } from '@tools/registry/types';

/**
 * GET /api/mcp/oauth/start?server=figma  (remote)
 * GET /api/mcp/oauth/start?server=github (local)
 *
 * 发起 OAuth 2.0 + PKCE 授权流程。
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
        { error: `${serverName} 未配置 OAuth, 使用现有认证方式即可` },
        { status: 400 },
      );
    }

    if (!oauthConfig.clientId) {
      return NextResponse.json(
        {
          error: `${serverName} 未配置 clientId (请设置环境变量 ${serverName.toUpperCase()}_CLIENT_ID)`,
        },
        { status: 500 },
      );
    }

    // 解析环境变量引用
    const resolvedOAuth = resolveEnvVarsInObject(oauthConfig);

    const { authorizationUrl, state } = await startOAuthFlow(
      serverName,
      resolvedOAuth,
    );

    return NextResponse.json({ authorizationUrl, state });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[MCP:OAuth:start] 错误:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
