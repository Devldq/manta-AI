export interface McpSecretBinding { readonly field: string; readonly secretReferenceId?: string }
export interface PortableMcpServer {
  readonly transport: 'stdio' | 'http'
  readonly command?: string
  readonly args?: readonly string[]
  readonly url?: string
  readonly envVars?: readonly string[]
  readonly envHttpHeaders?: Readonly<Record<string, string>>
  readonly bearerTokenEnvVar?: string
  readonly secretBindings?: readonly McpSecretBinding[]
  readonly options?: Readonly<Record<string, string | number | boolean | readonly string[]>>
}

interface ParsedServer { name: string; metadata: PortableMcpServer; literals: readonly { field: string; value: string }[] }
const HEADER = /^\s*\[([^\]]+)]\s*(?:#.*)?$/
const MCP_HEADER = /^mcp_servers\.(?:"([A-Za-z0-9][A-Za-z0-9_-]{0,127})"|([A-Za-z0-9][A-Za-z0-9_-]{0,127}))(?:\.(env|http_headers))?$/
const KEY = /^\s*([A-Za-z0-9_-]+)\s*=\s*(.*?)\s*$/
const SAFE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/

function string(value: string): string { if (!/^"(?:[^"\\]|\\.)*"$/.test(value)) throw new Error('Unsupported MCP TOML string'); return JSON.parse(value) }
function strings(value: string): string[] { if (!/^\[.*]$/.test(value)) throw new Error('Unsupported MCP TOML array'); const body = value.slice(1, -1).trim(); return body ? body.split(',').map((item) => string(item.trim())) : [] }
function inline(value: string): Record<string, string> {
  if (!/^\{.*}$/.test(value)) throw new Error('Unsupported MCP TOML inline table'); const body = value.slice(1, -1).trim(); const result: Record<string, string> = {}
  if (!body) return result
  for (const part of body.split(',')) { const match = part.match(/^\s*([A-Za-z0-9_-]+)\s*=\s*(.*?)\s*$/); if (!match || !SAFE.test(match[1])) throw new Error('Unsupported MCP TOML inline entry'); result[match[1]] = string(match[2]) }
  return result
}
function referencesMcpRoot(value: string): boolean { return /^(?:mcp_servers|"mcp_servers"|'mcp_servers')(?:\.|$)/.test(value.trim().replace(/\s*\.\s*/g, '.')) }

export function parseMcpServers(source: string): ParsedServer[] {
  const lines = source.split(/(?<=\n)/); const raw = new Map<string, Record<string, unknown>>(); let current: { server: string; child?: string } | undefined
  for (const line of lines) {
    const header = line.trimEnd().match(HEADER)
    if (header) { const parsed = header[1].match(MCP_HEADER); current = parsed ? { server: parsed[1] ?? parsed[2], ...(parsed[3] ? { child: parsed[3] } : {}) } : undefined; if (referencesMcpRoot(header[1]) && !current) throw new Error('Unsupported MCP TOML table'); if (current && raw.has(`${current.server}:${current.child ?? ''}`)) throw new Error('Duplicate MCP TOML table'); if (current) raw.set(`${current.server}:${current.child ?? ''}`, {}); continue }
    if (!current || !line.trim() || line.trimStart().startsWith('#')) { if (!current && referencesMcpRoot(line.split('=', 1)[0])) throw new Error('Unsupported dotted MCP TOML assignment'); continue }
    const match = line.trimEnd().match(KEY); if (!match) throw new Error('Unsupported MCP TOML assignment')
    const table = raw.get(`${current.server}:${current.child ?? ''}`)!; if (Object.hasOwn(table, match[1])) throw new Error('Duplicate MCP TOML key')
    const allowed = current.child ? [] : ['command', 'args', 'env', 'env_vars', 'url', 'bearer_token_env_var', 'http_headers', 'env_http_headers', 'cwd', 'startup_timeout_sec', 'tool_timeout_sec', 'enabled', 'required', 'enabled_tools', 'disabled_tools', 'oauth_resource', 'oauth_resource_metadata_url']; if (!current.child && !allowed.includes(match[1])) throw new Error(`Unsupported MCP TOML key: ${match[1]}`)
    const value = match[2]; table[match[1]] = value.startsWith('"') ? string(value) : value.startsWith('[') ? strings(value) : value.startsWith('{') ? inline(value) : value === 'true' ? true : value === 'false' ? false : /^-?(?:\d+|\d+\.\d+)$/.test(value) ? Number(value) : (() => { throw new Error('Unsupported MCP TOML value') })()
  }
  const names = [...new Set([...raw.keys()].map((key) => key.split(':')[0]))].sort()
  return names.map((name) => {
    const base = raw.get(`${name}:`) ?? {}; const nestedEnv = raw.get(`${name}:env`); const nestedHeaders = raw.get(`${name}:http_headers`)
    if ((base.env && nestedEnv) || (base.http_headers && nestedHeaders)) throw new Error('MCP literal table is redefined by inline and nested forms')
    if (nestedEnv && Object.values(nestedEnv).some((value) => typeof value !== 'string')) throw new Error('MCP env literal values must be strings')
    if (nestedHeaders && Object.values(nestedHeaders).some((value) => typeof value !== 'string')) throw new Error('MCP HTTP header literal values must be strings')
    if ((base.command !== undefined) === (base.url !== undefined)) throw new Error('MCP server must choose exactly one transport')
    if (base.command !== undefined && (base.http_headers !== undefined || nestedHeaders !== undefined || base.env_http_headers !== undefined || base.bearer_token_env_var !== undefined || base.oauth_resource !== undefined || base.oauth_resource_metadata_url !== undefined)) throw new Error('MCP stdio transport contains HTTP-only fields')
    if (base.url !== undefined && (base.args !== undefined || base.env !== undefined || nestedEnv !== undefined || base.env_vars !== undefined)) throw new Error('MCP HTTP transport contains stdio-only fields')
    const types: Record<string, string> = { command: 'string', url: 'string', cwd: 'string', startup_timeout_sec: 'number', tool_timeout_sec: 'number', enabled: 'boolean', required: 'boolean', bearer_token_env_var: 'string', oauth_resource: 'string', oauth_resource_metadata_url: 'string' }
    for (const [key, type] of Object.entries(types)) if (base[key] !== undefined && typeof base[key] !== type) throw new Error(`MCP option ${key} has an invalid type`)
    for (const key of ['args', 'env_vars', 'enabled_tools', 'disabled_tools']) if (base[key] !== undefined && (!Array.isArray(base[key]) || (base[key] as unknown[]).some((value) => typeof value !== 'string'))) throw new Error(`MCP option ${key} must be a string array`)
    const env = (base.env ?? nestedEnv) as Record<string, string> | undefined; const headers = (base.http_headers ?? nestedHeaders) as Record<string, string> | undefined
    const literals = [...Object.entries(env ?? {}).map(([key, value]) => ({ field: `env.${key}`, value })), ...Object.entries(headers ?? {}).map(([key, value]) => ({ field: `http_headers.${key}`, value }))]
    const url = base.url as string | undefined; let sanitizedUrl = url
    if (url) { const parsed = new URL(url); if (parsed.username || parsed.password) { literals.push({ field: 'url.userinfo', value: `${parsed.username}:${parsed.password}` }); parsed.username = ''; parsed.password = '' } for (const key of [...parsed.searchParams.keys()]) if (/token|secret|key|password|credential/i.test(key)) { literals.push({ field: `url.query.${key}`, value: parsed.searchParams.get(key)! }); parsed.searchParams.delete(key) }; sanitizedUrl = parsed.toString() }
    const optionKeys = ['cwd', 'startup_timeout_sec', 'tool_timeout_sec', 'enabled', 'required', 'enabled_tools', 'disabled_tools', 'oauth_resource', 'oauth_resource_metadata_url']; const options = Object.fromEntries(optionKeys.filter((key) => base[key] !== undefined).map((key) => [key, base[key]])) as Record<string, string | number | boolean | readonly string[]>
    const metadata: PortableMcpServer = url ? { transport: 'http', url: sanitizedUrl, ...(base.env_http_headers ? { envHttpHeaders: base.env_http_headers as Record<string, string> } : {}), ...(base.bearer_token_env_var ? { bearerTokenEnvVar: base.bearer_token_env_var as string } : {}), ...(Object.keys(options).length ? { options } : {}) } : { transport: 'stdio', command: base.command as string, ...(base.args ? { args: base.args as string[] } : {}), ...(base.env_vars ? { envVars: base.env_vars as string[] } : {}), ...(Object.keys(options).length ? { options } : {}) }
    if (metadata.transport === 'stdio' && !metadata.command) throw new Error('MCP stdio server requires command'); return { name, metadata, literals }
  })
}

const quoted = (value: string) => JSON.stringify(value)
export function renderMcpServer(name: string, metadata: PortableMcpServer): string {
  if (!SAFE.test(name)) throw new Error('Unsafe MCP server name'); const lines = [`[mcp_servers.${name}]`]
  if (metadata.transport === 'stdio') { if (!metadata.command) throw new Error('MCP stdio server requires command'); lines.push(`command = ${quoted(metadata.command)}`); if (metadata.args) lines.push(`args = [${metadata.args.map(quoted).join(', ')}]`); if (metadata.envVars?.length) lines.push(`env_vars = [${[...new Set(metadata.envVars)].sort().map(quoted).join(', ')}]`) }
  else { if (!metadata.url) throw new Error('MCP HTTP server requires URL'); lines.push(`url = ${quoted(metadata.url)}`); if (metadata.bearerTokenEnvVar) lines.push(`bearer_token_env_var = ${quoted(metadata.bearerTokenEnvVar)}`); if (metadata.envHttpHeaders) lines.push(`env_http_headers = { ${Object.entries(metadata.envHttpHeaders).sort(([a], [b]) => a < b ? -1 : 1).map(([key, value]) => `${key} = ${quoted(value)}`).join(', ')} }`) }
  for (const key of ['cwd', 'startup_timeout_sec', 'tool_timeout_sec', 'enabled', 'required', 'enabled_tools', 'disabled_tools', 'oauth_resource', 'oauth_resource_metadata_url']) if (metadata.options?.[key] !== undefined) { const value = metadata.options[key]; lines.push(`${key} = ${Array.isArray(value) ? `[${value.map(quoted).join(', ')}]` : typeof value === 'string' ? quoted(value) : String(value)}`) }
  return `${lines.join('\n')}\n`
}

export function appendMcpServers(source: string, servers: readonly { name: string; metadata: PortableMcpServer }[]): string {
  const existing = new Set(parseMcpServers(source).map((server) => server.name)); for (const server of servers) if (existing.has(server.name)) throw new Error(`MCP projection conflict: ${server.name}`)
  const separator = source.length && !source.endsWith('\n') ? '\n' : ''; return `${source}${separator}${servers.map((server) => renderMcpServer(server.name, server.metadata)).join('')}`
}
