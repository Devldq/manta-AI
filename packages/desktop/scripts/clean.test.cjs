const { mkdtempSync, mkdirSync, existsSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const test = require('node:test')
const assert = require('node:assert/strict')

test('clean removes every build and package output directory', () => {
  const root = mkdtempSync(join(tmpdir(), 'manta-desktop-clean-'))
  for (const directory of ['dist', '.package-staging', 'release', 'release-win']) mkdirSync(join(root, directory), { recursive: true })

  const { clean } = require('./clean.cjs')
  clean(root)

  for (const directory of ['dist', '.package-staging', 'release', 'release-win']) assert.equal(existsSync(join(root, directory)), false)
})
