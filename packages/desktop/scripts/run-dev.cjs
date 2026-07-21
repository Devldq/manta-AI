const { copyFile, mkdtemp, rm } = require('node:fs/promises')
const { dirname, join } = require('node:path')
const { tmpdir } = require('node:os')
const { spawn } = require('node:child_process')

const projectDir = join(__dirname, '..')
const command = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const nativeBinary = join(dirname(require.resolve('better-sqlite3')), '..', 'build', 'Release', 'better_sqlite3.node')
const forwardedSignals = ['SIGINT', 'SIGTERM']

function createSignalGuard(signalSource = process) {
  let activeChild
  let firstSignal
  let forwarded = false
  let cleaned = false

  const forwardToActiveChild = () => {
    if (firstSignal === undefined || forwarded || activeChild === undefined) return
    forwarded = true
    try {
      activeChild.child.kill(firstSignal)
    } catch (error) {
      activeChild.onError(error)
    }
  }
  const handlers = new Map(forwardedSignals.map((signal) => [signal, () => {
    if (firstSignal !== undefined) return
    firstSignal = signal
    forwardToActiveChild()
  }]))

  for (const [signal, handler] of handlers) signalSource.on(signal, handler)

  return {
    activate(child, onError) {
      activeChild = { child, onError }
      forwardToActiveChild()
    },
    deactivate(child) {
      if (activeChild?.child === child) activeChild = undefined
    },
    get signal() {
      return firstSignal
    },
    cleanup() {
      if (cleaned) return
      cleaned = true
      for (const [signal, handler] of handlers) signalSource.removeListener(signal, handler)
    },
  }
}

function run(file, args, options = {}, runtime = {}) {
  return new Promise((resolveRun, reject) => {
    const ownsSignalGuard = runtime.signalGuard === undefined
    const signalGuard = runtime.signalGuard ?? createSignalGuard(runtime.signalSource)
    const platform = runtime.platform ?? process.platform
    let child
    let settled = false
    const cleanup = () => {
      if (child !== undefined) signalGuard.deactivate(child)
      if (ownsSignalGuard) signalGuard.cleanup()
    }
    const finish = (error) => {
      if (settled) return
      settled = true
      cleanup()
      if (error) reject(error)
      else resolveRun()
    }

    try {
      child = (runtime.spawn ?? spawn)(file, args, {
        cwd: projectDir,
        stdio: 'inherit',
        windowsHide: true,
        shell: platform === 'win32' && String(file).toLowerCase().endsWith('.cmd'),
        ...options,
      })
    } catch (error) {
      finish(error)
      return
    }
    child.once('error', finish)
    child.once('close', (code, signal) => {
      if (code === 0) finish()
      else finish(new Error(`${file} exited ${signal ?? code}`))
    })
    signalGuard.activate(child, finish)
  })
}

async function snapshotNodeAbi() {
  const directory = await mkdtemp(join(tmpdir(), 'manta-dev-native-'))
  const backup = join(directory, 'better_sqlite3.node')
  await copyFile(nativeBinary, backup)
  return { backup, directory }
}

async function restoreNodeAbi(snapshot) {
  await copyFile(snapshot.backup, nativeBinary)
  await rm(snapshot.directory, { recursive: true, force: true })
}

async function rebuildForNode(runtime) {
  const env = { ...process.env }
  for (const name of ['npm_config_runtime', 'npm_config_target', 'npm_config_disturl']) delete env[name]
  await run(command, ['--filter', '@manta/rag', 'rebuild', 'better-sqlite3'], { env }, runtime)
}

async function rebuildForElectron(runtime) {
  const electronVersion = require('electron/package.json').version
  await run(command, ['--filter', '@manta/rag', 'rebuild', 'better-sqlite3'], {
    env: {
      ...process.env,
      npm_config_runtime: 'electron',
      npm_config_target: electronVersion,
      npm_config_disturl: 'https://electronjs.org/headers',
    },
  }, runtime)
}

async function signElectronNativeBinary(runtime = {}) {
  if ((runtime.platform ?? process.platform) !== 'darwin') return
  // dyld can reject a freshly rebuilt addon with CODESIGNING/Invalid Page even
  // when codesign --verify succeeds, so replace the linker signature explicitly.
  await run('codesign', ['--force', '--sign', '-', nativeBinary], {}, runtime)
}

async function launchElectron(runtime) {
  await run(require('electron'), ['dist/main.js'], {}, runtime)
}

function interruptedError(signal) {
  const error = new Error(`Development run interrupted by ${signal}`)
  error.signal = signal
  return error
}

async function runDev(deps = { rebuildForNode, snapshotNodeAbi, rebuildForElectron, signElectronNativeBinary, launchElectron, restoreNodeAbi }, runtime = {}) {
  const signalGuard = createSignalGuard(runtime.signalSource)
  const childRuntime = { ...runtime, signalGuard }
  let snapshot
  let hasSnapshot = false
  let primaryError
  let restoreError

  try {
    await deps.rebuildForNode?.(childRuntime)
    if (signalGuard.signal !== undefined) throw interruptedError(signalGuard.signal)
    snapshot = await deps.snapshotNodeAbi()
    hasSnapshot = true
    if (signalGuard.signal !== undefined) throw interruptedError(signalGuard.signal)
    await deps.rebuildForElectron(childRuntime)
    if (signalGuard.signal !== undefined) throw interruptedError(signalGuard.signal)
    await deps.signElectronNativeBinary?.(childRuntime)
    if (signalGuard.signal !== undefined) throw interruptedError(signalGuard.signal)
    await deps.launchElectron(childRuntime)
    if (signalGuard.signal !== undefined) throw interruptedError(signalGuard.signal)
  } catch (error) {
    primaryError = error
  }

  try {
    if (hasSnapshot) await deps.restoreNodeAbi(snapshot)
  } catch (error) {
    restoreError = error
  } finally {
    signalGuard.cleanup()
  }

  if (primaryError === undefined && signalGuard.signal !== undefined) primaryError = interruptedError(signalGuard.signal)
  if (primaryError !== undefined && restoreError !== undefined) {
    throw new AggregateError([primaryError, restoreError], 'Development run failed and Node ABI restore also failed')
  }
  if (primaryError !== undefined) throw primaryError
  if (restoreError !== undefined) throw restoreError
}

module.exports = { rebuildForNode, run, runDev, signElectronNativeBinary }

if (require.main === module) runDev().catch((error) => { console.error(error); process.exitCode = 1 })
