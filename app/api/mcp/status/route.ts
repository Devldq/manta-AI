/* MCP Debug & 状态查询 — GET /api/mcp/status?server=xxx
 *
 * 参照 OpenCode 的 opencode mcp debug 命令:
 * - 不指定 server: 返回所有 server 的状态概览
 * - 指定 server: 返回详细状态（含连接诊断信息）
 */
import { NextResponse } from 'next/server';
import { getAllMCPServerStatus } from '@/core/tool-registry/mcp-setup';
import { getEffectiveServers } from '@/core/tool-registry/mcp-config';

/**
 * GET /api/mcp/status[?server=xxx]
 *
 * 返回 MCP Server 的运行时状态。
 * 指定 server 参数时返回单个 server 的详细状态。
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const serverName = searchParams.get('server');
    const statuses = await getAllMCPServerStatus();

    if (serverName) {
      const status = statuses.find((s) => s.name === serverName);
      if (!status) {
        // 尝试在配置中查找
        const entry = getEffectiveServers().find((s) => s.name === serverName);
        if (!entry) {
          return NextResponse.json(
            { error: `未找到 MCP Server: ${serverName}` },
            { status: 404 },
          );
        }
        return NextResponse.json({
          server: {
            name: entry.name,
            description: entry.description,
            enabled: entry.enabled !== false,
            isConnected: false,
            status: 'not_connected',
          },
        });
      }

      return NextResponse.json({ server: status });
    }

    return NextResponse.json({ servers: statuses });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
