import { powershell } from '../platform/powershell'

export interface WindowsLinkMetadata { linkType: 'SymbolicLink' | 'Junction'; isContainer: boolean }
export interface WindowsLinkInput { id: string; path: string }
export interface WindowsLinkRunner { run(script: string, input: string): Promise<string> }

const script = `$items = @((([Console]::In.ReadToEnd()) | ConvertFrom-Json)); $results = foreach ($entry in $items) { $item = Get-Item -LiteralPath ([string]$entry.path) -Force -ErrorAction Stop; [pscustomobject]@{ id = [string]$entry.id; linkType = [string]$item.LinkType; isContainer = [bool]$item.PSIsContainer } }; ConvertTo-Json -InputObject @($results) -Compress`

export async function inspectWindowsLinks(inputs: WindowsLinkInput[], options: { chunkSize?: number; run?: WindowsLinkRunner['run'] } = {}): Promise<Map<string, WindowsLinkMetadata>> {
  const chunkSize = options.chunkSize ?? 200; if (!Number.isInteger(chunkSize) || chunkSize < 1) throw new Error('Windows link inspection chunk size must be positive')
  const run = options.run ?? ((command, input) => powershell.run(command, input)); const result = new Map<string, WindowsLinkMetadata>()
  for (let offset = 0; offset < inputs.length; offset += chunkSize) {
    const chunk = inputs.slice(offset, offset + chunkSize); const output = await run(script, JSON.stringify(chunk)); let rows: unknown
    try { rows = JSON.parse(output) } catch (error) { throw new Error('Windows link inspection returned invalid JSON', { cause: error }) }
    if (!Array.isArray(rows)) throw new Error('Windows link inspection did not return an array')
    for (const row of rows as Array<{ id?: unknown; linkType?: unknown; isContainer?: unknown }>) {
      if (typeof row.id !== 'string' || (row.linkType !== 'SymbolicLink' && row.linkType !== 'Junction') || typeof row.isContainer !== 'boolean') throw new Error(`Unsupported Windows reparse link type: ${String(row.linkType)}`)
      if (!chunk.some((entry) => entry.id === row.id) || result.has(row.id)) throw new Error(`Windows link inspection returned an unexpected id: ${row.id}`)
      result.set(row.id, { linkType: row.linkType, isContainer: row.isContainer })
    }
    if (chunk.some((entry) => !result.has(entry.id))) throw new Error('Windows link inspection omitted an input')
  }
  return result
}
