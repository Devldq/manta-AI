import * as fs from 'node:fs'
import * as path from 'node:path'

export interface ProjectInstructionFile {
  path: string
  content: string
}

function findProjectRoot(cwd: string): string {
  let current = path.resolve(cwd)

  while (true) {
    if (fs.existsSync(path.join(current, '.git'))) return current
    const parent = path.dirname(current)
    if (parent === current) return path.resolve(cwd)
    current = parent
  }
}

export function loadProjectInstructions(cwd: string): ProjectInstructionFile[] {
  const resolvedCwd = path.resolve(cwd)
  const projectRoot = findProjectRoot(resolvedCwd)
  const directories: string[] = []
  let current = resolvedCwd

  while (true) {
    directories.push(current)
    if (current === projectRoot) break
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }

  return directories.reverse().flatMap((directory) => {
    const instructionPath = path.join(directory, 'AGENTS.md')
    try {
      if (!fs.statSync(instructionPath).isFile()) return []
      const content = fs.readFileSync(instructionPath, 'utf8').trim()
      return content ? [{ path: instructionPath, content }] : []
    } catch {
      return []
    }
  })
}
