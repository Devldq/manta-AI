/*  start: MCP OAuth 授权启动 — GET /api/mcp/oauth/start?server=xxx */
import { NextResponse } from 'next/server';
import { getEffectiveServers } from '@/core/tool-registry/mcp-config';
import { startOAuthFlow } from '@/core/tool-registry/mcp-oauth';
import type { RemoteServerConfig } from '@/core/tool-registry/types';

/**
 * GET /api/mcp/oauth/start?server=figma
 *
 * 发起 OAuth 2.0 + PKCE 授权流程：
 * 1. 启动 Loopback Server（随机端口）
 * 2. 生成 PKCE 参数
 * 3. 返回 authorizationUrl（前端用 shell.openExternal 打开浏览器）
 *
 * 返回：
 * - { authorizationUrl, state }  — 成功
 * - { error }                     — server 不存在或不是 remote 模式
 *
 * 前端收到 authorizationUrl 后，在 Electron 中用 shell.openExternal(url) 打开系统浏览器。
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

    // 查找 server 配置
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

    if (!config.oauth.clientId) {
      return NextResponse.json(
        { error: `${serverName} 未配置 clientId（请设置环境变量 ${serverName.toUpperCase()}_CLIENT_ID）` },
        { status: 500 },
      );
    }

    // 发起 OAuth 流程
    const { authorizationUrl, state } = await startOAuthFlow(
      serverName,
      config.oauth,
    );

    return NextResponse.json({ authorizationUrl, state });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[MCP:OAuth:start] 错误:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
/*  end: MCP OAuth 授权启动 */
