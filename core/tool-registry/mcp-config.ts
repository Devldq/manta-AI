/**
 * MCP Server 配置表 — 所有内建 MCP Server 的连接信息。
 *
 * 两种模式：
 * - stdio:  子进程模式，通过 STDIO 与本地 MCP Server 进程通信
 * - remote: Remote HTTP 模式，通过 Streamable HTTP + OAuth 2.0 连接远程服务
 *
 * 在此数组中添加配置即可注册新的 MCP Server。
 */
import type { MCPServerEntry } from './types';
import { loadUserServers } from './mcp-config-store';

/**
 * 所有预置的 MCP Server 配置。
 *
 * 每个 entry:
 * - name:  逻辑名称（用于工具前缀 mcp__{name}__...）
 * - config: StdioServerConfig 或 RemoteServerConfig
 * - enabled: 默认 true，可在 UI 中切换
 */
export const KNOWN_MCP_SERVERS: MCPServerEntry[] = [
  {
    name: 'github',
    description: 'GitHub API — 仓库管理、Issues、PR、Actions 等',
    enabled: true,
    config: {
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
      env: {
        GITHUB_PERSONAL_ACCESS_TOKEN: process.env.GITHUB_PERSONAL_ACCESS_TOKEN || '',
      },
    },
  },
  {
    name: 'figma',
    description: 'Figma API — 设计稿读取、组件信息查询',
    enabled: true,
    config: {
      type: 'remote',
      url: 'https://mcp.figma.com/mcp',
      oauth: {
        authorizationEndpoint: 'https://www.figma.com/oauth',
        tokenEndpoint: 'https://www.figma.com/api/oauth/token',
        clientId: process.env.FIGMA_CLIENT_ID || '',
        scopes: ['files:read', 'file_comments:read'],
      },
    },
  },
];

/**
 * 获取合并后的生效配置：用户自定义配置覆盖同名内建配置。
 *
 * 合并规则：
 * - 用户自定义 server 覆盖同名的内建 server
 * - 用户自定义 server 优先于内建 server
 * - 内建 server 中被用户禁用的仍然保留（enabled: false）
 */
export function getEffectiveServers(): MCPServerEntry[] {
  const userServers = loadUserServers();
  const userNames = new Set(userServers.map((s) => s.name));

  // 内建 server：排除被用户覆盖的（同名用户配置覆盖）
  const builtin = KNOWN_MCP_SERVERS.filter((s) => !userNames.has(s.name));

  return [...builtin, ...userServers];
}

/**
 * 检查给定名称是否为内建 MCP Server。
 */
export function isBuiltinServer(name: string): boolean {
  return KNOWN_MCP_SERVERS.some((s) => s.name === name);
}

