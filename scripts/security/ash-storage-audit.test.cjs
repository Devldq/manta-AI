const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const repositoryRoot = path.resolve(__dirname, '../..')
const audit = path.join(__dirname, 'ash-storage-audit.ts')
const cases = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/ash-storage-audit-cases.json'), 'utf8'))

function runFixture(testCase, allowlist = { calls: [], literals: [] }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ash-storage-audit-'))
  try {
    const file = path.join(root, ...testCase.file.split('/'))
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, testCase.source)
    const canonical = path.join(root, 'canonical', 'path-routing.ts'); fs.mkdirSync(path.dirname(canonical), { recursive: true }); fs.writeFileSync(canonical, 'export const resolveStoragePath = (...x: unknown[]) => x; export const safeStorageSegment = (x: string) => x')
    const allowlistPath = path.join(root, 'allowlist.json')
    fs.writeFileSync(allowlistPath, JSON.stringify(allowlist))
    return spawnSync(process.execPath, [audit, '--root', root, '--allowlist', allowlistPath, '--canonical-routing', canonical], {
      cwd: repositoryRoot,
      encoding: 'utf8',
    })
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}

for (const testCase of cases) {
  const result = runFixture(testCase)
  const output = `${result.stdout}\n${result.stderr}`
  assert.equal(result.status, testCase.violations.length ? 1 : 0, `${testCase.name}\n${output}`)
  for (const expected of testCase.violations) assert.match(output, new RegExp(expected), testCase.name)
  process.stdout.write(`ok - ${testCase.name}\n`)
}

const allowlisted = {
  name: 'allows one exact callsite',
  file: 'packages/sample/src/allowed.ts',
  source: "import fs from 'node:fs';\nfs.writeFileSync('/tmp/a', 'x');\nfs.writeFileSync('/tmp/b', 'x')",
}
const exact = runFixture(allowlisted, {
  calls: [{ file: allowlisted.file, line: 2, column: 1, operation: 'writeFileSync', reason: 'This exact fixture call models a reviewed external user-owned output boundary.' }],
  literals: [],
})
assert.equal(exact.status, 1, `${exact.stdout}\n${exact.stderr}`)
assert.match(`${exact.stdout}\n${exact.stderr}`, /allowed\.ts:3:1.*writeFileSync/)
assert.doesNotMatch(`${exact.stdout}\n${exact.stderr}`, /allowed\.ts:2:1.*unrouted/)
process.stdout.write('ok - allowlists only one exact callsite\n')

const stale = runFixture({ file: 'packages/sample/src/clean.ts', source: 'export const clean = true' }, {
  calls: [{ file: 'packages/sample/src/clean.ts', line: 9, column: 1, operation: 'writeFileSync', reason: 'This deliberately stale fixture entry must fail closed during the audit.' }],
  literals: [],
})
assert.equal(stale.status, 1, `${stale.stdout}\n${stale.stderr}`)
assert.match(`${stale.stdout}\n${stale.stderr}`, /stale allowlist entry/)
process.stdout.write('ok - rejects stale callsite allowlists\n')

const e2e = runFixture({
  file: 'packages/desktop/e2e/storage-onboarding.e2e.ts',
  source: "import { mkdtemp } from 'node:fs/promises';\nexport async function acceptance() { return mkdtemp('ash-e2e-') }",
})
assert.equal(e2e.status, 0, `${e2e.stdout}\n${e2e.stderr}`)
process.stdout.write('ok - ignores dedicated E2E acceptance files\n')
