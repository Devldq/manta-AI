/* MCP 工具可见性配置 — GET/PUT /api/mcp/visibility
 *
 * 参照 OpenCode 设计:
 * - 全局和 per-agent 的 glob 模式工具可见性控制
 * - 支持全局禁用 + 特定 agent 启用的策略
 */
import { NextResponse } from 'next/server';
import {
  loadMCPToolVisibility,
  saveMCPToolVisibility,
} from '@tools/mcp/config-store';
import { getToolRegistry } from '@tools/mcp/setup';

import type { MCPToolVisibility } from '@tools/registry/types';

/**
 * GET /api/mcp/visibility
 *
 * 获取当前的 MCP 工具可见性配置。
 *
 * 返回示例:
 * {
 *   "visibility": {
 *     "tools": { "github_*": false, "figma_*": true },
 *     "agent": {
 *       "my-agent": { "tools": { "github_*": true } }
 *     }
 *   }
 * }
 */
export async function GET() {
  try {
    const visibility = loadMCPToolVisibility();
    return NextResponse.json({ visibility });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * PUT /api/mcp/visibility
 *
 * 更新 MCP 工具可见性配置。
 *
 * 请求体: MCPToolVisibility
 */
export async function PUT(request: Request) {
  try {
    const body: MCPToolVisibility = await request.json();

    if (!body || typeof body !== 'object') {
      return NextResponse.json(
        { error: '无效的配置格式' },
        { status: 400 },
      );
    }

    // 保存配置
    saveMCPToolVisibility(body);

    return NextResponse.json({ success: true, visibility: body });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
