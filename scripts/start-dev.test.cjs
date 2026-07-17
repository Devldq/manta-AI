const test = require('node:test')
const assert = require('node:assert/strict')
const { join } = require('node:path')

const { backendEnvironment, resolveBootstrapPath } = require('./start-dev.js')

test('uses an explicit MANTA_BOOTSTRAP_PATH when provided', () => {
  const bootstrapPath = resolveBootstrapPath({
    env: { MANTA_BOOTSTRAP_PATH: '/custom/ash-bootstrap.json' },
    platform: 'darwin',
    homeDir: '/Users/dev',
    exists: (path) => path === '/custom/ash-bootstrap.json',
  })

  assert.equal(bootstrapPath, '/custom/ash-bootstrap.json')
})

test('passes the resolved bootstrap to the backend without dropping existing environment', () => {
  assert.deepEqual(
    backendEnvironment('/resolved/ash-bootstrap.json', { PATH: '/bin' }),
    { PATH: '/bin', MANTA_BOOTSTRAP_PATH: '/resolved/ash-bootstrap.json' },
  )
})

test('uses the Electron development bootstrap on macOS', () => {
  const expected = join('/Users/dev', 'Library', 'Application Support', 'Electron', 'ash-bootstrap.json')
  const bootstrapPath = resolveBootstrapPath({
    env: {},
    platform: 'darwin',
    homeDir: '/Users/dev',
    exists: (path) => path === expected,
  })

  assert.equal(bootstrapPath, expected)
})

test('uses XDG_CONFIG_HOME for the Electron development bootstrap on Linux', () => {
  const expected = join('/tmp/config', 'Electron', 'ash-bootstrap.json')
  const bootstrapPath = resolveBootstrapPath({
    env: { XDG_CONFIG_HOME: '/tmp/config' },
    platform: 'linux',
    homeDir: '/home/dev',
    exists: (path) => path === expected,
  })

  assert.equal(bootstrapPath, expected)
})

test('fails early with an actionable error when no bootstrap exists', () => {
  assert.throws(() => resolveBootstrapPath({
    env: {},
    platform: 'darwin',
    homeDir: '/Users/dev',
    exists: () => false,
  }), /pnpm run dev:desktop.*MANTA_BOOTSTRAP_PATH/)
})
