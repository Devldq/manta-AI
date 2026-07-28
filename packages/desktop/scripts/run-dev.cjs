const { copyFile, cp, mkdtemp, open, rename, rm } = require('node:fs/promises')
const { randomUUID } = require('node:crypto')
const { basename, dirname, join, relative, sep } = require('node:path')
const { tmpdir } = require('node:os')
const { spawn } = require('node:child_process')

const projectDir = join(__dirname, '..')
const nativePackage = dirname(require.resolve('better-sqlite3/package.json'))
const nativeBinary = join(nativePackage, 'build', 'Release', 'better_sqlite3.node')
const prebuildInstall = require.resolve('prebuild-install/bin.js', { paths: [nativePackage] })
const nodeGyp = require.resolve('node-gyp/bin/node-gyp.js')
const forwardedSignals = ['SIGINT', 'SIGTERM']

function createDevTimer(output = process.stdout) {
  const startedAt = process.hrtime.bigint()
  let previousAt = startedAt
  return (phase) => {
    const now = process.hrtime.bigint()
    output.write(`MANTA_DEV_TIMING ${JSON.stringify({
      phase,
      durationMs: Math.round(Number(now - previousAt) / 1e6),
      totalMs: Math.round(Number(now - startedAt) / 1e6),
    })}\n`)
    previousAt = now
  }
}

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
  await replaceNativeBinaryAtomically(snapshot.backup)
  await rm(snapshot.directory, { recursive: true, force: true })
}

function nativeBuildEnvironment(kind) {
  const env = { ...process.env }
  for (const name of ['npm_config_runtime', 'npm_config_target', 'npm_config_disturl']) delete env[name]
  if (kind === 'electron') {
    env.npm_config_runtime = 'electron'
    env.npm_config_target = require('electron/package.json').version
    env.npm_config_disturl = 'https://electronjs.org/headers'
  }
  return env
}

async function createNativeBuildStage() {
  const directory = await mkdtemp(join(tmpdir(), 'manta-dev-native-build-'))
  const packageDirectory = join(directory, 'better-sqlite3')
  await cp(nativePackage, packageDirectory, {
    recursive: true,
    filter(source) {
      const path = relative(nativePackage, source)
      return path !== 'build' && !path.startsWith(`build${sep}`) && path !== 'node_modules' && !path.startsWith(`node_modules${sep}`)
    },
  })
  return { directory, packageDirectory, binary: join(packageDirectory, 'build', 'Release', 'better_sqlite3.node') }
}

async function signNativeBinary(binary, runtime = {}) {
  if ((runtime.platform ?? process.platform) !== 'darwin') return
  // dyld can reject a freshly rebuilt addon with CODESIGNING/Invalid Page even
  // when codesign --verify succeeds, so replace the linker signature explicitly.
  await run('codesign', ['--force', '--sign', '-', binary], {}, runtime)
}

const nativeValidationScript = `
const binary = process.argv[1]
const nativeModule = { exports: {}, filename: binary }
process.dlopen(nativeModule, binary)
`

async function validateNativeBinary(kind, binary, runtime = {}) {
  const executable = kind === 'electron' ? require('electron') : process.execPath
  const env = {
    ...process.env,
    ...(kind === 'electron' ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
  }
  await run(executable, ['-e', nativeValidationScript, binary], { env }, runtime)
}

async function prepareValidatedNativeCandidate(kind, actions) {
  let prebuildError
  try {
    await actions.prebuild()
    await actions.sign()
    await actions.validate()
    return
  } catch (error) {
    prebuildError = error
  }

  try {
    await actions.build()
    await actions.sign()
    await actions.validate()
  } catch (buildError) {
    throw new AggregateError(
      [prebuildError, buildError],
      `Could not build a loadable better-sqlite3 binary for ${kind}`,
    )
  }
}

async function replaceNativeBinaryAtomically(source, target = nativeBinary) {
  // The independent Service may still have the current addon mapped. Replacing
  // the pathname with a new inode keeps those mapped, signed pages untouched.
  const replacement = join(dirname(target), `.${basename(target)}.${process.pid}.${randomUUID()}.tmp`)
  let handle
  try {
    await copyFile(source, replacement)
    handle = await open(replacement, 'r')
    await handle.sync()
    await handle.close()
    handle = undefined
    await rename(replacement, target)
  } finally {
    await handle?.close().catch(() => undefined)
    await rm(replacement, { force: true }).catch(() => undefined)
  }
}

async function rebuildNativeBinary(kind, runtime = {}) {
  const stage = await createNativeBuildStage()
  const env = nativeBuildEnvironment(kind)
  try {
    await prepareValidatedNativeCandidate(kind, {
      prebuild: () => run(process.execPath, [prebuildInstall], { cwd: stage.packageDirectory, env }, runtime),
      build: () => run(process.execPath, [nodeGyp, 'rebuild', '--release'], { cwd: stage.packageDirectory, env }, runtime),
      sign: () => signNativeBinary(stage.binary, runtime),
      validate: () => validateNativeBinary(kind, stage.binary, runtime),
    })
    await replaceNativeBinaryAtomically(stage.binary)
    // Validate the exact inode exposed through the workspace dependency path.
    // This catches an ABI replacement race before the long-lived Electron
    // process starts and defers loading better-sqlite3.
    await validateNativeBinary(kind, nativeBinary, runtime)
  } finally {
    await rm(stage.directory, { recursive: true, force: true })
  }
}

const rebuildForNode = (runtime) => rebuildNativeBinary('node', runtime)
const rebuildForElectron = (runtime) => rebuildNativeBinary('electron', runtime)

async function launchElectron(runtime) {
  await run(require('electron'), ['dist/main.js'], {}, runtime)
}

function interruptedError(signal) {
  const error = new Error(`Development run interrupted by ${signal}`)
  error.signal = signal
  return error
}

async function runDev(deps = { rebuildForNode, snapshotNodeAbi, rebuildForElectron, launchElectron, restoreNodeAbi }, runtime = {}) {
  const signalGuard = createSignalGuard(runtime.signalSource)
  const childRuntime = { ...runtime, signalGuard }
  const recordPhase = createDevTimer(runtime.timingOutput)
  let snapshot
  let hasSnapshot = false
  let primaryError
  let restoreError

  try {
    await deps.rebuildForNode?.(childRuntime)
    recordPhase('prepare-node-native')
    if (signalGuard.signal !== undefined) throw interruptedError(signalGuard.signal)
    snapshot = await deps.snapshotNodeAbi()
    hasSnapshot = true
    recordPhase('snapshot-node-native')
    if (signalGuard.signal !== undefined) throw interruptedError(signalGuard.signal)
    await deps.rebuildForElectron(childRuntime)
    recordPhase('prepare-electron-native')
    if (signalGuard.signal !== undefined) throw interruptedError(signalGuard.signal)
    await deps.launchElectron(childRuntime)
    recordPhase('electron-session')
    if (signalGuard.signal !== undefined) throw interruptedError(signalGuard.signal)
  } catch (error) {
    primaryError = error
  }

  try {
    if (hasSnapshot) await deps.restoreNodeAbi(snapshot)
    if (hasSnapshot) recordPhase('restore-node-native')
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

module.exports = {
  createDevTimer,
  nativeBuildEnvironment,
  prepareValidatedNativeCandidate,
  rebuildForNode,
  replaceNativeBinaryAtomically,
  run,
  runDev,
  signNativeBinary,
  validateNativeBinary,
}

if (require.main === module) runDev().catch((error) => { console.error(error); process.exitCode = 1 })
