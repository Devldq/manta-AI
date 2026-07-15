import { lstat } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { AgentInstallation } from '../types'

export interface CodexEnvironment { readonly homeDirectory: string; readonly env: Readonly<Record<string, string | undefined>> }

function normalized(path: string): string { const value = resolve(path); return process.platform === 'win32' ? value.toLowerCase() : value }
function contains(parent: string, child: string): boolean { const value = relative(normalized(parent), normalized(child)); return value === '' || (value !== '..' && !value.startsWith(`..${sep}`) && !isAbsolute(value)) }

export async function detectCodex(environment: CodexEnvironment): Promise<AgentInstallation[]> {
  if (!isAbsolute(environment.homeDirectory)) throw new Error('Codex home resolver must return an absolute user home')
  if (environment.env.CODEX_HOME && !isAbsolute(environment.env.CODEX_HOME)) throw new Error('Explicit CODEX_HOME must be an absolute path')
  const codexHome = resolve(environment.env.CODEX_HOME || join(environment.homeDirectory, '.codex')); const skillRoot = resolve(environment.homeDirectory, '.agents', 'skills')
  if (contains(codexHome, skillRoot) || contains(skillRoot, codexHome)) throw new Error('Codex home and user skill roots must not overlap')
  for (const path of [codexHome, skillRoot]) { const stat = await lstat(path); if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Codex native root is missing, linked, or not a directory') }
  return [{ schemaVersion: 1, id: 'codex-user', adapterId: 'codex', displayName: 'Codex', nativeRoots: [{ id: 'codex-home', path: codexHome }, { id: 'user-skills', path: skillRoot }] }]
}
