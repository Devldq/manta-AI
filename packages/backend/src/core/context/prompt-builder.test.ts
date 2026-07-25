import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  coreRules,
  projectInstructions,
  runtimeSecurityFacts,
  type PromptContext,
} from './prompt-builder.js'
import { loadProjectInstructions } from './project-instructions.js'

const promptContext: PromptContext = {
  toolCount: 0,
  deferredToolSummary: '',
  sessionMessageCount: 0,
  sessionId: 'conversation-id',
}

const temporaryDirectories: string[] = []

function createTemporaryDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'manta-prompt-'))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

describe('Manta platform prompt', () => {
  it('defines authority, existing-work, verification, and reporting boundaries', () => {
    const prompt = coreRules()(promptContext)

    expect(prompt).toContain('Inspect, explain, review, and diagnose requests authorize read-only investigation, not edits.')
    expect(prompt).toContain('Assume uncommitted and untracked files belong to the user.')
    expect(prompt).toContain('Do not infer authorization to delete existing work')
    expect(prompt).toContain('Never claim success from process liveness, compilation, mocks, or a screenshot alone')
    expect(prompt).toContain('Runtime Security Facts are authoritative')
  })

  it('describes request-mode approval without claiming unrestricted access', () => {
    const prompt = runtimeSecurityFacts({
      approvalMode: 'request',
      securityContextAvailable: true,
      allowedRoots: ['/workspace'],
      shellAllowedRoots: ['/workspace'],
      allowExternalRead: true,
      allowExternalWrite: false,
      networkAccess: false,
    })(promptContext)

    expect(prompt).toContain('Approval mode: request')
    expect(prompt).toContain('External reads: requires user approval')
    expect(prompt).toContain('External writes: denied')
    expect(prompt).toContain('Dangerous shell commands: requires user approval')
    expect(prompt).toContain('Network access: disabled')
    expect(prompt).not.toContain('access ANY path')
  })

  it('describes full mode and missing security contexts accurately', () => {
    const fullPrompt = runtimeSecurityFacts({
      approvalMode: 'full',
      securityContextAvailable: true,
      allowedRoots: ['/workspace'],
      shellAllowedRoots: ['/workspace'],
      allowExternalRead: true,
      allowExternalWrite: true,
    })(promptContext)
    const unavailablePrompt = runtimeSecurityFacts({
      approvalMode: 'request',
      securityContextAvailable: false,
      allowedRoots: [],
      shellAllowedRoots: [],
      allowExternalRead: false,
      allowExternalWrite: false,
    })(promptContext)

    expect(fullPrompt).toContain('External reads: allowed without interactive approval')
    expect(fullPrompt).toContain('Dangerous shell commands: allowed without interactive approval')
    expect(unavailablePrompt).toContain('Security context: unavailable')
    expect(unavailablePrompt).toContain('must not claim access')
  })
})

describe('project instructions', () => {
  it('loads AGENTS.md files from repository root to the working directory', () => {
    const parent = createTemporaryDirectory()
    const repository = path.join(parent, 'repository')
    const nested = path.join(repository, 'packages', 'backend')
    fs.mkdirSync(path.join(repository, '.git'), { recursive: true })
    fs.mkdirSync(nested, { recursive: true })
    fs.writeFileSync(path.join(parent, 'AGENTS.md'), 'outside repository')
    fs.writeFileSync(path.join(repository, 'AGENTS.md'), 'root instruction')
    fs.writeFileSync(path.join(repository, 'packages', 'AGENTS.md'), 'package instruction')

    const instructions = loadProjectInstructions(nested)
    const prompt = projectInstructions(nested)(promptContext)

    expect(instructions.map(item => item.content)).toEqual([
      'root instruction',
      'package instruction',
    ])
    expect(prompt).toContain('A more specific file takes precedence over a parent file')
    expect(prompt?.indexOf('root instruction')).toBeLessThan(prompt?.indexOf('package instruction') ?? -1)
    expect(prompt).not.toContain('outside repository')
  })

  it('skips the section when no project instruction exists', () => {
    const directory = createTemporaryDirectory()
    fs.mkdirSync(path.join(directory, '.git'))

    expect(projectInstructions(directory)(promptContext)).toBeNull()
  })
})
