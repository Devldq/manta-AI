/**
 * MCP Server 配置表 — 所有内建 MCP Server 的连接信息。
 *
 * 两种模式：
 * - stdio:  子进程模式，通过 STDIO 与本地 MCP Server 进程通信
 * - remote: Remote HTTP 模式，通过 Streamable HTTP + OAuth 2.0 连接远程服务
 *
 * 环境变量命名的 MCP Server（如 GITHUB_PERSONAL_ACCESS_TOKEN）保持向后兼容。
 */
import type { MCPServerEntry } from './types';

/**
 * 所有预置的 MCP Server 配置。
 *
 * 每个 entry:
 * - name:  逻辑名称（用于工具前缀 mcp__{name}__...）
 * - config: StdioServerConfig 或 RemoteServerConfig
 * - enabled: 默认 true，可在 UI 中切换
 */
export const KNOWN_MCP_SERVERS: MCPServerEntry[] = [
  // ── GitHub (stdio 模式，通过 PAT) ──────────────────────────────────────
  {
    name: 'github',
    description: 'GitHub — 搜索仓库、代码、管理 Issue',
    enabled: true,
    config: {
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
      // 环境变量在连接时注入 GITHUB_PERSONAL_ACCESS_TOKEN
      env: {},
    },
  },

  // ── Figma (Remote HTTP + OAuth) ───────────────────────────────────────
  {
    name: 'figma',
    description: 'Figma — 设计文件、组件和样式管理',
    enabled: false,   // 需用户主动连接
    config: {
      type: 'remote',
      url: 'https://mcp.figma.com/mcp',
      oauth: {
        authorizationEndpoint: 'https://www.figma.com/oauth',
        tokenEndpoint: 'https://www.figma.com/api/oauth/token',
        clientId: process.env.FIGMA_CLIENT_ID || '',
        clientSecret: process.env.FIGMA_CLIENT_SECRET || '',
        scopes: ['file_read'],
      },
    },
  },

  // ── Linear (Remote HTTP + OAuth) ──────────────────────────────────────
  {
    name: 'linear',
    description: 'Linear — 项目管理、Issue 跟踪',
    enabled: false,
    config: {
      type: 'remote',
      url: 'https://mcp.linear.app/mcp',
      oauth: {
        authorizationEndpoint: 'https://linear.app/oauth/authorize',
        tokenEndpoint: 'https://api.linear.app/oauth/token',
        clientId: process.env.LINEAR_CLIENT_ID || '',
        clientSecret: process.env.LINEAR_CLIENT_SECRET || '',
        scopes: ['read', 'write'],
      },
    },
  },
];

/**
 * 从配置表中提取所有 Remote+OAuth server 的 OAuth 配置 Map。
 */
export function getOAuthConfigMap(): Map<
  string,
  { oauth: import('./types').OAuthServerConfig }
> {
  const map = new Map();
  for (const entry of KNOWN_MCP_SERVERS) {
    if (entry.config.type === 'remote' && entry.config.oauth) {
      map.set(entry.name, { oauth: entry.config.oauth });
    }
  }
  return map;
}
