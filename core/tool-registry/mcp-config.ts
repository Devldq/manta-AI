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

/**
 * 所有预置的 MCP Server 配置。
 *
 * 每个 entry:
 * - name:  逻辑名称（用于工具前缀 mcp__{name}__...）
 * - config: StdioServerConfig 或 RemoteServerConfig
 * - enabled: 默认 true，可在 UI 中切换
 */
export const KNOWN_MCP_SERVERS: MCPServerEntry[] = [];

