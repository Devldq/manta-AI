import { execFile } from 'node:child_process'

export interface WindowsLinkMetadata { linkType: 'SymbolicLink' | 'Junction'; isContainer: boolean }

export async function inspectWindowsLink(filePath: string): Promise<WindowsLinkMetadata> {
  const script = "$item = Get-Item -LiteralPath $env:ASH_LINK_PATH -Force -ErrorAction Stop; [pscustomobject]@{ LinkType = [string]$item.LinkType; IsContainer = [bool]$item.PSIsContainer } | ConvertTo-Json -Compress"
  const output = await new Promise<string>((resolve, reject) => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { env: { ...process.env, ASH_LINK_PATH: filePath } }, (error, stdout, stderr) => error ? reject(new Error(`Failed to inspect Windows link: ${stderr.trim() || error.message}`, { cause: error })) : resolve(stdout.trim())))
  let value: { LinkType?: unknown; IsContainer?: unknown }
  try { value = JSON.parse(output) as typeof value } catch (error) { throw new Error('Windows link inspection returned invalid JSON', { cause: error }) }
  if ((value.LinkType !== 'SymbolicLink' && value.LinkType !== 'Junction') || typeof value.IsContainer !== 'boolean') throw new Error(`Unsupported Windows reparse link type: ${String(value.LinkType)}`)
  return { linkType: value.LinkType, isContainer: value.IsContainer }
}
