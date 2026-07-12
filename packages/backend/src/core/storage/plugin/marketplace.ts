/**
 * Claude 插件市场 — 从 claude.com/plugins 拉取列表，并桥接 Claude Code 安装命令。
 */

import * as path from 'path'
import * as fs from 'fs'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { ensureDir, readJsonFile, writeJsonFile } from '../shared/fs-utils'
import { registerPlugin } from './store'
import { runWithoutDiagnosticsOwner } from '../../../storage/runtime-diagnostics'

const execFileAsync = promisify(execFile)

const CLAUDE_MARKETPLACE_URL = 'https://claude.com/plugins'
const CLAUDE_PLUGIN_DETAIL_BASE_URL = 'https://claude.com/plugins/'
const CLAUDE_OFFICIAL_MARKETPLACE = 'claude-plugins-official'
const MARKETPLACE_REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000
const INSTALL_TIMEOUT_MS = 5 * 60 * 1000

export interface PluginMarketplaceItem {
  id: string
  slug: string
  name: string
  description?: string
  detailUrl: string
  worksWith: string[]
  verified: boolean
  installCount?: number
  marketplaceName: string
  pluginId: string
  installCommand: string
  source: 'claude.com'
  updatedAt: string
}

export interface PluginMarketplaceCache {
  sourceUrl: string
  refreshedAt: string
  items: PluginMarketplaceItem[]
}

export interface ClaudePluginInstallResult {
  plugin: ReturnType<typeof registerPlugin>
  marketplaceItem?: PluginMarketplaceItem
  command: string[]
  stdout: string
  stderr: string
}

interface CommandOutput {
  stdout: string
  stderr: string
}

let refreshTimer: NodeJS.Timeout | null = null
const inFlightRefresh = new Map<string, Promise<PluginMarketplaceCache>>()
interface MarketplaceSchedulerState {
  paused: boolean
  execute(): Promise<void>
}
const schedulerOwners = new Map<symbol, MarketplaceSchedulerState>()

function getMarketplaceDataDir(): string {
  const root = process.env.MANTA_WORKSPACE_ROOT || process.cwd()
  return path.join(root, '.manta', 'plugin-marketplace')
}

function getCachePath(dataDir = getMarketplaceDataDir()): string {
  return path.join(dataDir, 'claude.json')
}

function decodeHtml(value: string): string {
  return value
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function sanitizePluginSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function toMantaPluginId(slug: string): string {
  const normalized = sanitizePluginSlug(slug).replace(/_/g, '-')
  const safe = normalized.replace(/[^a-z0-9-.]+/g, '-').replace(/-+/g, '-')
  return /^[a-z]/.test(safe) ? `claude.${safe}` : `claude.p-${safe}`
}

function normalizeClaudePluginSpec(source: string): string {
  let spec = source.trim()
  const commandMatch = spec.match(/^claude\s+plugin\s+install\s+(.+)$/i)
  if (commandMatch) {
    spec = commandMatch[1].trim()
  }
  spec = spec.replace(/^['"]|['"]$/g, '')
  if (!/^[a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+$/.test(spec)) {
    throw new Error(`不是合法的 Claude 插件标识: ${source}`)
  }
  return spec
}

async function runClaude(
  claudeBin: string,
  args: string[],
): Promise<CommandOutput> {
  const { stdout, stderr } = await execFileAsync(
    claudeBin,
    args,
    {
      cwd: process.env.MANTA_WORKSPACE_ROOT || process.cwd(),
      timeout: INSTALL_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
    },
  )
  return { stdout: stdout.trim(), stderr: stderr.trim() }
}

async function ensureOfficialClaudeMarketplace(claudeBin: string): Promise<CommandOutput[]> {
  const outputs: CommandOutput[] = []
  try {
    const list = await runClaude(claudeBin, ['plugin', 'marketplace', 'list', '--json'])
    outputs.push(list)
    const marketplaces = JSON.parse(list.stdout || '[]') as Array<{ name?: string; repo?: string }>
    const hasOfficial = marketplaces.some((marketplace) =>
      marketplace.name === CLAUDE_OFFICIAL_MARKETPLACE ||
      marketplace.repo === 'anthropics/claude-plugins-official',
    )
    if (hasOfficial) return outputs
  } catch {
    // 旧版 Claude CLI 或空配置解析失败时，继续尝试添加官方 marketplace。
  }

  outputs.push(await runClaude(claudeBin, [
    'plugin',
    'marketplace',
    'add',
    'anthropics/claude-plugins-official',
  ]))
  return outputs
}

function shouldRefreshMarketplaceAfterInstallError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /not found|out of date|marketplace/i.test(message)
}

function resolveClaudeBinary(): string {
  if (process.env.CLAUDE_BIN && fs.existsSync(process.env.CLAUDE_BIN)) {
    return process.env.CLAUDE_BIN
  }

  const home = process.env.HOME || process.env.USERPROFILE || ''
  const candidates = [
    'claude',
    path.join(home, '.local', 'bin', 'claude'),
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
  ]

  const nvmDir = path.join(home, '.nvm', 'versions', 'node')
  try {
    for (const version of fs.readdirSync(nvmDir)) {
      candidates.push(path.join(nvmDir, version, 'bin', 'claude'))
    }
  } catch {
    // nvm 目录不存在时忽略，继续使用 PATH。
  }

  return candidates.find((candidate) => candidate === 'claude' || fs.existsSync(candidate)) || 'claude'
}

function parseClaudePluginsPage(html: string): PluginMarketplaceItem[] {
  const now = new Date().toISOString()
  const cardPattern =
    /<a[^>]+href="\/plugins\/([^"]+)"[^>]*class="connector_cms_pill[\s\S]*?<\/a>/g
  const items: PluginMarketplaceItem[] = []
  const seen = new Set<string>()

  for (const match of html.matchAll(cardPattern)) {
    const slug = sanitizePluginSlug(match[1])
    const card = match[0]
    if (!slug || seen.has(slug)) continue

    const nameMatch = card.match(/<h3[^>]*>([\s\S]*?)<\/h3>/)
    if (!nameMatch) continue

    const descriptionMatch = card.match(/<p[^>]*class="[^"]*u-foreground-tertiary[^"]*"[^>]*>([\s\S]*?)<\/p>/)
    const worksWith = Array.from(card.matchAll(/fs-list-field="works-with">([^<]+)/g))
      .map((m) => decodeHtml(m[1]))
      .filter(Boolean)
    const installCountMatch = card.match(/format-number[^>]*>\s*([0-9]+)\s*<\/p>/)
    const pluginId = `${slug}@${CLAUDE_OFFICIAL_MARKETPLACE}`

    seen.add(slug)
    items.push({
      id: pluginId,
      slug,
      name: decodeHtml(nameMatch[1]),
      description: descriptionMatch ? decodeHtml(descriptionMatch[1]) : undefined,
      detailUrl: `${CLAUDE_PLUGIN_DETAIL_BASE_URL}${slug}`,
      worksWith: worksWith.length ? worksWith : ['Claude Code'],
      verified: /Anthropic\s+verified/i.test(card),
      installCount: installCountMatch ? Number(installCountMatch[1]) : undefined,
      marketplaceName: CLAUDE_OFFICIAL_MARKETPLACE,
      pluginId,
      installCommand: `claude plugin install ${pluginId}`,
      source: 'claude.com',
      updatedAt: now,
    })
  }

  return items
}

async function fetchText(url: string): Promise<string> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30_000)
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Manta-AI Plugin Marketplace (+https://claude.com/plugins)',
      },
      signal: controller.signal,
    })
    if (!res.ok) {
      throw new Error(`请求失败: ${res.status} ${res.statusText}`)
    }
    return await res.text()
  } finally {
    clearTimeout(timeout)
  }
}

export function readClaudeMarketplaceCache(dataDir = getMarketplaceDataDir()): PluginMarketplaceCache | null {
  return readJsonFile<PluginMarketplaceCache>(getCachePath(dataDir))
}

export async function refreshClaudeMarketplace(dataDir = getMarketplaceDataDir()): Promise<PluginMarketplaceCache> {
  const existing = inFlightRefresh.get(dataDir)
  if (existing) return existing

  const refresh = (async () => {
    const html = await fetchText(CLAUDE_MARKETPLACE_URL)
    const items = parseClaudePluginsPage(html)
    if (items.length === 0) {
      throw new Error('没有从 claude.com/plugins 解析到插件')
    }

    const cache: PluginMarketplaceCache = {
      sourceUrl: CLAUDE_MARKETPLACE_URL,
      refreshedAt: new Date().toISOString(),
      items,
    }
    ensureDir(dataDir)
    writeJsonFile(getCachePath(dataDir), cache)
    return cache
  })()
  inFlightRefresh.set(dataDir, refresh)

  try {
    return await refresh
  } finally {
    if (inFlightRefresh.get(dataDir) === refresh) inFlightRefresh.delete(dataDir)
  }
}

export async function getClaudeMarketplace(options?: { refresh?: boolean }): Promise<PluginMarketplaceCache> {
  if (options?.refresh) {
    return refreshClaudeMarketplace()
  }

  const cached = readClaudeMarketplaceCache()
  if (cached) return cached

  return refreshClaudeMarketplace()
}

async function getInstallCommandFromDetailPage(item: PluginMarketplaceItem): Promise<string> {
  try {
    const html = await fetchText(item.detailUrl)
    const commandMatch = html.match(/claude\s+plugin\s+install\s+[^<"']+/i)
    if (commandMatch) {
      return decodeHtml(commandMatch[0])
    }
  } catch {
    // 详情页不可用时回退到列表页推导出的官方命令。
  }
  return item.installCommand
}

function manifestFromClaudePlugin(
  spec: string,
  item?: PluginMarketplaceItem,
): Parameters<typeof registerPlugin>[0] {
  const [pluginSlug, marketplaceName] = spec.split('@')
  const name = item?.name || pluginSlug
  return {
    id: toMantaPluginId(pluginSlug),
    name,
    version: '1.0.0',
    description: item?.description || `Claude Code plugin: ${spec}`,
    author: item?.verified ? 'Anthropic verified marketplace' : 'Claude plugin marketplace',
    homepage: item?.detailUrl || `${CLAUDE_PLUGIN_DETAIL_BASE_URL}${pluginSlug}`,
    capabilities: [
      {
        type: 'command',
        name: 'claude-plugin',
        description: `通过 Claude Code 安装的外部插件: ${spec}`,
        config: {
          pluginId: spec,
          marketplaceName,
          installCommand: `claude plugin install ${spec}`,
        },
      },
    ],
    permissions: [
      { type: 'process', scope: 'claude plugin install', action: 'execute' },
      { type: 'network', scope: 'claude plugin marketplace', action: 'read' },
    ],
    tags: ['claude-code', 'marketplace', marketplaceName],
    sourcePath: spec,
  }
}

export async function installClaudePlugin(
  source: string,
): Promise<ClaudePluginInstallResult> {
  const spec = normalizeClaudePluginSpec(source)
  const cache = await getClaudeMarketplace().catch(() => null)
  const item = cache?.items.find((entry) => entry.pluginId === spec || entry.slug === spec.split('@')[0])
  const commandText = item ? await getInstallCommandFromDetailPage(item) : `claude plugin install ${spec}`
  const commandSpec = normalizeClaudePluginSpec(commandText)

  const claudeBin = resolveClaudeBinary()
  const setupOutputs = await ensureOfficialClaudeMarketplace(claudeBin)

  let installOutput: CommandOutput
  try {
    installOutput = await runClaude(claudeBin, ['plugin', 'install', commandSpec])
  } catch (error) {
    if (!shouldRefreshMarketplaceAfterInstallError(error)) throw error
    setupOutputs.push(await runClaude(claudeBin, [
      'plugin',
      'marketplace',
      'update',
      CLAUDE_OFFICIAL_MARKETPLACE,
    ]))
    installOutput = await runClaude(claudeBin, ['plugin', 'install', commandSpec])
  }

  const plugin = registerPlugin(manifestFromClaudePlugin(commandSpec, item))
  return {
    plugin,
    marketplaceItem: item,
    command: [claudeBin, 'plugin', 'install', commandSpec],
    stdout: [...setupOutputs.map((output) => output.stdout), installOutput.stdout].filter(Boolean).join('\n'),
    stderr: [...setupOutputs.map((output) => output.stderr), installOutput.stderr].filter(Boolean).join('\n'),
  }
}

export function isClaudePluginInstallSource(source: string): boolean {
  const trimmed = source.trim()
  return /^claude\s+plugin\s+install\s+/i.test(trimmed) ||
    /^[a-zA-Z0-9._-]+@claude-plugins-official$/.test(trimmed)
}

function runScheduledRefresh(): void {
  for (const owner of schedulerOwners.values()) {
    if (owner.paused) continue
    void owner.execute()
  }
}

function reconcileScheduler(): void {
  if (![...schedulerOwners.values()].some((owner) => !owner.paused)) {
    if (refreshTimer) clearInterval(refreshTimer)
    refreshTimer = null
    return
  }
  if (refreshTimer) return
  runScheduledRefresh()

  refreshTimer = runWithoutDiagnosticsOwner(() => setInterval(() => {
    runScheduledRefresh()
  }, MARKETPLACE_REFRESH_INTERVAL_MS))
  refreshTimer.unref()
}

export function acquireClaudeMarketplaceScheduler(log?: { info: (message: string) => void; warn: (message: string) => void }): () => Promise<void> {
  const owner = createClaudeMarketplaceRuntimeOwner()
  const release = owner.acquire(log)
  return async () => { release(); await owner.dispose() }
}

export interface ClaudeMarketplaceRuntimeOwner {
  acquire(log?: { info: (message: string) => void; warn: (message: string) => void }): () => void
  pause(): () => void
  checkpoint(): Promise<void>
  reopen(dataDir: string): Promise<void>
  dispose(): Promise<void>
}

export function createClaudeMarketplaceRuntimeOwner(
  initialDataDir = getMarketplaceDataDir(),
  refresh: (dataDir: string) => Promise<PluginMarketplaceCache> = refreshClaudeMarketplace,
  runInContext: <T>(operation: () => T) => T = (operation) => operation(),
): ClaudeMarketplaceRuntimeOwner {
  const id = Symbol('marketplace-runtime-owner')
  let dataDir = initialDataDir
  let paused = false
  let acquired = false
  let closing = false
  let disposed = false
  let disposePromise: Promise<void> | undefined
  const inFlight = new Set<Promise<void>>()
  let ownerLog: { info: (message: string) => void; warn: (message: string) => void } | undefined
  const execute = (): Promise<void> => {
    if (closing || disposed || paused) return Promise.resolve()
    let task!: Promise<void>
    task = Promise.resolve()
      .then(() => runInContext(async () => {
        try {
          const cache = await refresh(dataDir)
          ownerLog?.info(`[Plugin Marketplace] Claude 市场刷新完成: ${cache.items.length} 个插件`)
        } catch (error) {
          ownerLog?.warn(`[Plugin Marketplace] Claude 市场刷新失败: ${error instanceof Error ? error.message : String(error)}`)
        }
      }))
      .catch(() => undefined)
      .finally(() => { inFlight.delete(task) })
    inFlight.add(task)
    return task
  }
  return {
    acquire(log) {
      if (closing || disposed) throw new Error('Marketplace scheduler owner is disposed')
      if (acquired) throw new Error('Marketplace scheduler owner is already acquired')
      acquired = true
      ownerLog = log
      schedulerOwners.set(id, { paused, execute }); reconcileScheduler()
      let released = false
      return () => { if (!released) { released = true; acquired = false; schedulerOwners.delete(id); reconcileScheduler() } }
    },
    pause() {
      if (closing || disposed) throw new Error('Marketplace scheduler owner is disposed')
      paused = true
      const state = schedulerOwners.get(id); if (state) state.paused = true
      reconcileScheduler()
      let resumed = false
      return () => {
        if (resumed) return
        if (closing || disposed) { resumed = true; return }
        resumed = true; paused = false
        const current = schedulerOwners.get(id)
        if (current) { current.paused = false; void current.execute() }
        reconcileScheduler()
      }
    },
    async checkpoint() { await Promise.allSettled([...inFlight]); await inFlightRefresh.get(dataDir) },
    async reopen(nextDataDir) {
      if (closing || disposed) throw new Error('Marketplace scheduler owner is disposed')
      await Promise.allSettled([...inFlight])
      await inFlightRefresh.get(dataDir)
      dataDir = nextDataDir
    },
    dispose() {
      disposePromise ??= (async () => {
        closing = true
        schedulerOwners.delete(id); acquired = false; reconcileScheduler()
        await Promise.allSettled([...inFlight])
        const globalRefresh = inFlightRefresh.get(dataDir)
        if (globalRefresh) await globalRefresh.catch(() => undefined)
        disposed = true
      })()
      return disposePromise
    },
  }
}

export async function checkpointClaudeMarketplaceScheduler(): Promise<void> {
  await Promise.all(inFlightRefresh.values())
}
