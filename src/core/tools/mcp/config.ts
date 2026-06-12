/**
 * MCP Server 配置表 — 所有内建 MCP Server 的连接信息。
 *
 * 参照 OpenCode 设计重构:
 * - local:  本地子进程模式 (原 stdio)
 * - remote: 远程 HTTP 模式 (支持 headers + OAuth)
 * - 统一使用 MCPServerEntry 格式
 * - 支持 {env:VAR_NAME} 环境变量引用
 * - 用户配置通过 mcp-config-store.ts 持久化, 覆盖同名内建配置
 */
import type { MCPServerEntry, MCPToolVisibility } from '../registry/types';
import { normalizeServerConfig } from '../registry/types';
import { loadUserServers } from './config-store';

/**
 * 所有预置的 MCP Server 配置。
 *
 * 设计原则:
 * - 默认 enabled: true, 用户可通过 UI 切换
 * - command 使用数组形式 (对齐 OpenCode)
 * - 敏感信息通过 {env:VAR_NAME} 引用系统环境变量, 不硬编码
 * - remote 模式支持 headers (API Key) 和 oauth 两种认证
 */
export const KNOWN_MCP_SERVERS: MCPServerEntry[] = [
  {
    name: 'github',
    description: 'GitHub API — 仓库管理、Issues、PR、Actions 等',
    enabled: true,
    config: {
      type: 'local',
      command: ['npx', '-y', '@modelcontextprotocol/server-github'],
      environment: {
        GITHUB_PERSONAL_ACCESS_TOKEN: '{env:GITHUB_PERSONAL_ACCESS_TOKEN}',
      },
      oauth: {
        authorizationEndpoint: 'https://github.com/login/oauth/authorize',
        tokenEndpoint: 'https://github.com/login/oauth/access_token',
        clientId: '{env:GITHUB_CLIENT_ID}',
        clientSecret: '{env:GITHUB_CLIENT_SECRET}',
        scopes: ['repo', 'read:org', 'read:user', 'workflow'],
        tokenEnvVar: 'GITHUB_PERSONAL_ACCESS_TOKEN',
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
        clientId: '{env:FIGMA_CLIENT_ID}',
        scopes: ['files:read', 'file_comments:read'],
      },
    },
  },
];

/**
 * 默认的 MCP 工具可见性配置
 *
 * 默认所有 MCP 工具对所有 agent 可见。
 * 可通过配置文件覆盖, 实现全局禁用 + 特定 agent 启用。
 */
export const DEFAULT_MCP_TOOL_VISIBILITY: MCPToolVisibility = {};

/**
 * 获取合并后的生效配置：用户自定义配置覆盖同名内建配置。
 *
 * 合并规则：
 * - 用户自定义 server 覆盖同名的内建 server
 * - 内建 server 中被用户禁用的仍然保留（enabled: false）
 */
export function getEffectiveServers(): MCPServerEntry[] {
  const userServers = loadUserServers();
  const userNames = new Set(userServers.map((s) => s.name));

  // 内建 server：排除被用户覆盖的
  const builtin = KNOWN_MCP_SERVERS.filter((s) => !userNames.has(s.name));

  return [...builtin, ...userServers].map(normalizeServerConfig);
}

/**
 * 检查给定名称是否为内建 MCP Server。
 */
export function isBuiltinServer(name: string): boolean {
  return KNOWN_MCP_SERVERS.some((s) => s.name === name);
}

/**
 * 根据名称查找 MCP Server 配置。
 *
 * @param name Server 名称
 * @returns 配置项或 undefined
 */
export function getServerByName(name: string): MCPServerEntry | undefined {
  return getEffectiveServers().find((s) => s.name === name);
}

/**
 * 加载 MCP 工具可见性配置。
 *
 * 从默认配置开始，用户的配置会覆盖默认值。
 * 配置文件路径: ~/.manta-data/mcp-visibility.json
 */
export function getMCPToolVisibility(): MCPToolVisibility {
  // TODO: 从配置文件加载用户自定义的 visibility
  // 目前使用默认配置
  return DEFAULT_MCP_TOOL_VISIBILITY;
}
