import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isPathInAllowedRoots } from './validators/PathValidator'

describe('sandbox path validation', () => {
  it('accepts a child path beneath an allowed root', () => {
    const root = join(process.cwd(), 'workspace')
    expect(isPathInAllowedRoots(join(root, 'child.txt'), [root])).toBe(true)
  })
})
