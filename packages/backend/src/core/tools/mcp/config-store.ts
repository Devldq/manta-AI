/**
 * MCP Server 配置持久化存储层
 *
 * 用户自定义的 MCP Server 配置持久化到磁盘，与内建配置分离：
 * - 内建配置: 代码中硬编码（mcp-config.ts 的 KNOWN_MCP_SERVERS）
 * - User configuration: ASH config/mcp/servers.json
 * - Tool visibility: ASH config/mcp/visibility.json
 *
 * 合并规则: 同名 server 用户配置覆盖内建配置
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { resolveStoragePath } from '../../../storage/path-routing';

import type { MCPServerEntry, MCPToolVisibility } from '../registry/types';

// ── 存储路径 ────────────────────────────────────────────────────────────────

function getServersStorePath(): string {
  return resolveStoragePath('config', 'mcp', 'servers.json');
}

function getVisibilityStorePath(): string {
  return resolveStoragePath('config', 'mcp', 'visibility.json');
}

function getSecretsStorePath(): string {
  return resolveStoragePath('secrets', 'mcp', 'server-secrets.json');
}

// ── 通用存储工具 ────────────────────────────────────────────────────────────

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
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

// ── Server 配置存储 ─────────────────────────────────────────────────────────

interface MCPStoreData {
  /** 用户自定义的 MCP Server 配置列表 */
  servers: MCPServerEntry[];
}

interface MCPServerSecrets {
  environment?: Record<string, string>;
  headers?: Record<string, string>;
  clientSecret?: string;
}

function loadServerSecrets(): Record<string, MCPServerSecrets> {
  return readJSON<Record<string, MCPServerSecrets>>(getSecretsStorePath(), {});
}

function hydrateServer(entry: MCPServerEntry, secret: MCPServerSecrets | undefined): MCPServerEntry {
  if (!secret) return entry;
  const hydrateValues = (metadata: Record<string, string> | undefined, values: Record<string, string> | undefined) => Object.fromEntries(
    Object.entries(metadata ?? {}).map(([key, value]) => [key, value.startsWith('{ash-secret:') ? values?.[key] ?? value : value]),
  );
  const config = entry.config.type === 'local'
    ? { ...entry.config, environment: hydrateValues(entry.config.environment, secret.environment) }
    : { ...entry.config, headers: hydrateValues(entry.config.headers, secret.headers) };
  if (config.oauth?.clientSecret?.startsWith('{ash-secret:') && secret.clientSecret) config.oauth = { ...config.oauth, clientSecret: secret.clientSecret };
  return { ...entry, config } as MCPServerEntry;
}

function sanitizeServer(entry: MCPServerEntry, previous: MCPServerSecrets | undefined): { entry: MCPServerEntry; secret?: MCPServerSecrets } {
  const secret: MCPServerSecrets = {};
  const config = { ...entry.config };
  if (config.type === 'local') {
    const environment: Record<string, string> = {};
    const values: Record<string, string> = {};
    for (const [key, value] of Object.entries(config.environment ?? {})) {
      if (/^\{env:[^}]+\}$/.test(value)) environment[key] = value;
      else if (value.startsWith('{ash-secret:')) { environment[key] = value; if (previous?.environment?.[key]) values[key] = previous.environment[key]; }
      else { values[key] = value; environment[key] = `{ash-secret:${entry.name}:environment:${key}}`; }
    }
    config.environment = environment;
    if (Object.keys(values).length) secret.environment = values;
  } else {
    const headers: Record<string, string> = {};
    const values: Record<string, string> = {};
    for (const [key, value] of Object.entries(config.headers ?? {})) {
      if (/^\{env:[^}]+\}$/.test(value)) headers[key] = value;
      else if (value.startsWith('{ash-secret:')) { headers[key] = value; if (previous?.headers?.[key]) values[key] = previous.headers[key]; }
      else { values[key] = value; headers[key] = `{ash-secret:${entry.name}:header:${key}}`; }
    }
    config.headers = headers;
    if (Object.keys(values).length) secret.headers = values;
  }
  if (config.oauth?.clientSecret && !/^\{env:[^}]+\}$/.test(config.oauth.clientSecret)) {
    secret.clientSecret = config.oauth.clientSecret.startsWith('{ash-secret:') ? previous?.clientSecret : config.oauth.clientSecret;
    config.oauth = { ...config.oauth, clientSecret: `{ash-secret:${entry.name}:oauth:clientSecret}` };
  }
  return { entry: { ...entry, config } as MCPServerEntry, secret: Object.keys(secret).length ? secret : undefined };
}

function readServersStore(): MCPStoreData {
  const data = readJSON<MCPStoreData>(getServersStorePath(), { servers: [] });
  const secrets = loadServerSecrets();
  return { servers: data.servers.map((entry) => hydrateServer(entry, secrets[entry.name])) };
}

function writeServersStore(data: MCPStoreData): void {
  const previous = loadServerSecrets();
  const secrets: Record<string, MCPServerSecrets> = {};
  const servers = data.servers.map((entry) => {
    const sanitized = sanitizeServer(entry, previous[entry.name]);
    if (sanitized.secret) secrets[entry.name] = sanitized.secret;
    return sanitized.entry;
  });
  writeJSON(getSecretsStorePath(), secrets);
  writeJSON(getServersStorePath(), { servers });
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
