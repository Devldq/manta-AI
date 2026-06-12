/**
 * MCP Server 配置持久化存储层
 *
 * 用户自定义的 MCP Server 配置持久化到磁盘，与内建配置分离：
 * - 内建配置: 代码中硬编码（mcp-config.ts 的 KNOWN_MCP_SERVERS）
 * - 用户配置: ~/.manta-data/mcp-servers.json
 * - 工具可见性: ~/.manta-data/mcp-visibility.json
 *
 * 合并规则: 同名 server 用户配置覆盖内建配置
 */
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';

import type { MCPServerEntry, MCPToolVisibility } from '../registry/types';

// ── 存储路径 ────────────────────────────────────────────────────────────────

function getStoreDir(): string {
  return path.join(os.homedir(), '.manta-data');
}

function getServersStorePath(): string {
  return path.join(getStoreDir(), 'mcp-servers.json');
}

function getVisibilityStorePath(): string {
  return path.join(getStoreDir(), 'mcp-visibility.json');
}

// ── 通用存储工具 ────────────────────────────────────────────────────────────

function ensureStoreDir(): void {
  const dir = getStoreDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function readJSON<T>(filePath: string, defaultVal: T): T {
  try {
    if (!fs.existsSync(filePath)) return defaultVal;
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return defaultVal;
  }
}

function writeJSON(filePath: string, data: unknown): void {
  ensureStoreDir();
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

// ── Server 配置存储 ─────────────────────────────────────────────────────────

interface MCPStoreData {
  /** 用户自定义的 MCP Server 配置列表 */
  servers: MCPServerEntry[];
}

function readServersStore(): MCPStoreData {
  return readJSON<MCPStoreData>(getServersStorePath(), { servers: [] });
}

function writeServersStore(data: MCPStoreData): void {
  writeJSON(getServersStorePath(), data);
}

// ── Server 配置对外 API ─────────────────────────────────────────────────────

/**
 * 获取所有用户自定义的 MCP Server 配置。
 */
export function loadUserServers(): MCPServerEntry[] {
  return readServersStore().servers;
}

/**
 * 获取单个用户自定义的 MCP Server 配置。
 *
 * @param name Server 名称
 * @returns 配置项或 undefined（未找到）
 */
export function getUserServer(name: string): MCPServerEntry | undefined {
  return loadUserServers().find((s) => s.name === name);
}

/**
 * 保存（新增或更新）用户自定义的 MCP Server 配置。
 * 如果是更新已有配置，会覆盖同名的旧配置。
 *
 * @param entry MCP Server 配置项
 */
export function saveUserServer(entry: MCPServerEntry): void {
  const data = readServersStore();
  const idx = data.servers.findIndex((s) => s.name === entry.name);

  if (idx >= 0) {
    data.servers[idx] = entry;
  } else {
    data.servers.push(entry);
  }

  writeServersStore(data);
}

/**
 * 删除用户自定义的 MCP Server 配置。
 *
 * @param name Server 名称
 * @returns true 如果成功删除，false 如果未找到
 */
export function deleteUserServer(name: string): boolean {
  const data = readServersStore();
  const idx = data.servers.findIndex((s) => s.name === name);

  if (idx < 0) return false;

  data.servers.splice(idx, 1);
  writeServersStore(data);
  return true;
}

// ── 工具可见性配置存储 ──────────────────────────────────────────────────────

/**
 * 加载 MCP 工具可见性配置。
 */
export function loadMCPToolVisibility(): MCPToolVisibility {
  return readJSON<MCPToolVisibility>(getVisibilityStorePath(), {});
}

/**
 * 保存 MCP 工具可见性配置。
 */
export function saveMCPToolVisibility(visibility: MCPToolVisibility): void {
  writeJSON(getVisibilityStorePath(), visibility);
}

/**
 * 获取指定 agent 的所有可见 MCP 工具名列表。
 *
 * 这用于在 agent 执行时过滤工具列表。
 *
 * @param agentName agent 名称 (如果为 null 则返回全局可见的工具)
 * @param allMCPTools 所有已注册的 MCP 工具名列表
 * @returns 过滤后的工具名列表
 */
export function getVisibleMCPTools(
  agentName: string | null,
  allMCPTools: string[],
): string[] {
  const visibility = loadMCPToolVisibility();

  return allMCPTools.filter((toolName) => {
    // 非 MCP 工具始终可见
    if (!toolName.includes('_')) return true;

    // 检查 agent 级别配置
    if (agentName && visibility.agent?.[agentName]?.tools) {
      const agentTools = visibility.agent[agentName].tools!;
      for (const [pattern, enabled] of Object.entries(agentTools)) {
        if (matchGlobPattern(toolName, pattern)) {
          return enabled;
        }
      }
    }

    // 检查全局配置
    if (visibility.tools) {
      for (const [pattern, enabled] of Object.entries(visibility.tools)) {
        if (matchGlobPattern(toolName, pattern)) {
          return enabled;
        }
      }
    }

    // 默认可见
    return true;
  });
}

/**
 * Glob 模式匹配
 *
 * 支持 * (任意字符) 和 ? (单个字符)
 */
function matchGlobPattern(str: string, pattern: string): boolean {
  const regex = new RegExp(
    '^' +
      pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.') +
      '$',
  );
  return regex.test(str);
}
