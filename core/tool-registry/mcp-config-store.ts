/**
 * MCP Server 配置持久化存储层。
 *
 * 用户自定义的 MCP Server 配置持久化到磁盘，与内建配置分离：
 * - 内建配置: 代码中硬编码（mcp-config.ts 的 KNOWN_MCP_SERVERS）
 * - 用户配置: ~/.manta-data/mcp-servers.json
 *
 * 合并规则: 同名 server 用户配置覆盖内建配置
 *
 * 注意：本文件不依赖 mcp-config.ts，避免循环引用。
 */
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';

import type { MCPServerEntry } from './types';

// ── 存储路径 ───────────────────────────────────────────────────────────────

function getStoreDir(): string {
  return path.join(os.homedir(), '.manta-data');
}

function getStorePath(): string {
  return path.join(getStoreDir(), 'mcp-servers.json');
}

// ── 存储结构 ───────────────────────────────────────────────────────────────

interface MCPStoreData {
  /** 用户自定义的 MCP Server 配置列表 */
  servers: MCPServerEntry[];
}

function readStore(): MCPStoreData {
  try {
    const storePath = getStorePath();
    if (!fs.existsSync(storePath)) {
      return { servers: [] };
    }
    const raw = fs.readFileSync(storePath, 'utf-8');
    const data = JSON.parse(raw);
    return {
      servers: Array.isArray(data.servers) ? data.servers : [],
    };
  } catch {
    return { servers: [] };
  }
}

function writeStore(data: MCPStoreData): void {
  const storeDir = getStoreDir();
  if (!fs.existsSync(storeDir)) {
    fs.mkdirSync(storeDir, { recursive: true });
  }
  fs.writeFileSync(getStorePath(), JSON.stringify(data, null, 2), 'utf-8');
}

// ── 对外 API ───────────────────────────────────────────────────────────────

/**
 * 获取所有用户自定义的 MCP Server 配置。
 */
export function loadUserServers(): MCPServerEntry[] {
  return readStore().servers;
}

/**
 * 获取单个用户自定义的 MCP Server 配置。
 * @returns 配置项或 undefined（未找到）
 */
export function getUserServer(name: string): MCPServerEntry | undefined {
  const servers = loadUserServers();
  return servers.find((s) => s.name === name);
}

/**
 * 保存（新增或更新）用户自定义的 MCP Server 配置。
 * 如果是更新已有配置，会覆盖同名的旧配置。
 */
export function saveUserServer(entry: MCPServerEntry): void {
  const data = readStore();
  const idx = data.servers.findIndex((s) => s.name === entry.name);

  if (idx >= 0) {
    data.servers[idx] = entry;
  } else {
    data.servers.push(entry);
  }

  writeStore(data);
}

/**
 * 删除用户自定义的 MCP Server 配置。
 * @returns true 如果成功删除，false 如果未找到
 */
export function deleteUserServer(name: string): boolean {
  const data = readStore();
  const idx = data.servers.findIndex((s) => s.name === name);

  if (idx < 0) return false;

  data.servers.splice(idx, 1);
  writeStore(data);
  return true;
}


