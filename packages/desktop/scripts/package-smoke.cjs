/*
 * A directory-package smoke test.  This deliberately does not trust a zero
 * exit status from electron-builder: on Windows some builder/ASAR combinations
 * can leave an electron runtime without app resources.  We build the same
 * directory layout ourselves using the maintained @electron/asar API, then
 * launch the resulting executable.  The fallback is useful in CI as well as
 * locally; release installers continue to use electron-builder.yml.
 */
const { access, copyFile, cp, mkdtemp, mkdir, readFile, rename, rm, writeFile } = require('node:fs/promises')
const { dirname, join, relative, resolve } = require('node:path')
const { tmpdir } = require('node:os')
const { randomUUID } = require('node:crypto')
const { spawn } = require('node:child_process')
const { build: bundle } = require('esbuild')

const projectDir = join(__dirname, '..')
const repositoryDir = resolve(projectDir, '..', '..')
const releaseDir = join(projectDir, 'release', 'win-unpacked')
const resources = join(releaseDir, 'resources')
const command = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const required = ['app.asar', join('frontend', 'dist'), join('backend', 'dist'), join('storage-hub', 'dist'), join('rag', 'dist'), '.manta', join('qdrant', 'qdrant.exe'), join('qdrant', 'qdrant-manifest.json'), join('app.asar.unpacked', 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node')]
const providerPackages = ['@langchain/openai', '@langchain/ollama', '@langchain/anthropic', '@langchain/core']
const runtimeWorkspacePackages = ['@manta/backend', '@manta/service', '@manta/sdk', '@manta/contracts', '@manta/task-runtime', '@manta/skill-runtime']
const nativePackages = ['better-sqlite3']
const nativeBinary = join(dirname(require.resolve('better-sqlite3')), '..', 'build', 'Release', 'better_sqlite3.node')

function run(file, args, options = {}) {
  const { timeoutMs = 180_000, ...spawnOptions } = options
  return new Promise((resolveRun, reject) => {
    const child = spawn(file, args, { cwd: projectDir, stdio: 'pipe', windowsHide: true, shell: process.platform === 'win32' && file.toLowerCase().endsWith('.cmd'), ...spawnOptions })
    let output = ''; let timedOut = false
    const timer = setTimeout(() => { timedOut = true; child.kill() }, timeoutMs)
    child.stdout.on('data', (chunk) => { output += chunk })
    child.stderr.on('data', (chunk) => { output += chunk })
    child.on('error', reject)
    child.on('close', (code) => { clearTimeout(timer); code === 0 ? resolveRun(output) : reject(new Error(`${file} ${timedOut ? 'timed out' : `exited ${code}`}: ${output}`)) })
  })
}

async function snapshotNodeAbi() {
  const backup = join(projectDir, `.package-staging-node-abi-backup-${process.pid}-${randomUUID()}.node`)
  await copyFile(nativeBinary, backup)
  return backup
}

async function restoreNodeAbi(backup) {
  // Builder rebuilds a pnpm-linked native package in place. Preserve the
  // caller's Node ABI before packaging so cleanup never depends on network or
  // a local C++ toolchain.
  await copyFile(backup, nativeBinary)
  await rm(backup, { force: true })
}

function collectDependencies(node, result = new Map()) {
  for (const [name, value] of Object.entries(node.dependencies ?? {})) {
    if (value.path && !result.has(name)) result.set(name, value.path)
    collectDependencies(value, result)
  }
}

async function copyProductionDependencies(appDir) {
  const dependencies = new Map()
  // pnpm's workspace graph does not always expand a workspace dependency's
  // peer/optional provider closure when queried from the desktop root. Merge
  // the production graphs of every runtime package before flattening.
  for (const filter of ['@manta/desktop', '@manta/backend', '@manta/service', '@manta/sdk', '@manta/rag', '@manta/storage-hub', '@manta/skill-runtime']) {
    const graph = JSON.parse(await run(command, ['--filter', filter, 'list', '--prod', '--depth', 'Infinity', '--json']))[0]
    collectDependencies(graph, dependencies)
  }
  const destinationRoot = join(appDir, 'node_modules')
  for (const [name, source] of dependencies) {
    const destination = join(destinationRoot, ...name.split('/'))
    await mkdir(dirname(destination), { recursive: true })
    // Packages from a pnpm virtual store contain links back to the workspace.
    // We intentionally flatten the complete production graph, so copying an
    // embedded node_modules tree would reintroduce broken links into app.asar.
    try {
      await cp(source, destination, {
        recursive: true,
        dereference: true,
        filter: (entry) => relative(source, entry).split(/[\\/]/).every((part) => part !== 'node_modules'),
      })
    } catch (error) {
      // pnpm reports optional packages for every platform in its dependency
      // graph, while only the host package exists on disk.
      if (error.code !== 'ENOENT') throw error
    }
  }
  // Keep the dynamically imported providers explicit. They are intentionally
  // not statically reachable from the backend entry, and pnpm can elide them
  // from a workspace-root JSON tree despite them being production deps.
  for (const name of providerPackages) {
    const source = join(repositoryDir, 'packages', 'backend', 'node_modules', ...name.split('/'))
    const destination = join(destinationRoot, ...name.split('/'))
    await mkdir(dirname(destination), { recursive: true })
    // These are workspace symlinks; filtering their dereferenced target would
    // reject the target's own `node_modules` path before the package root is
    // copied. Keep the provider closure intact here.
    await cp(source, destination, { recursive: true, dereference: true })
  }
  for (const name of nativePackages) {
    const source = join(repositoryDir, 'packages', 'rag', 'node_modules', ...name.split('/'))
    const destination = join(destinationRoot, ...name.split('/'))
    await mkdir(dirname(destination), { recursive: true })
    await cp(source, destination, { recursive: true, dereference: true })
  }
}

async function stageElectronRuntime() {
  await mkdir(releaseDir, { recursive: true })
  try {
    const executable = require('electron')
    await cp(dirname(executable), releaseDir, { recursive: true, dereference: true })
  } catch {
    if (process.platform !== 'win32') throw new Error('Electron runtime is unavailable and the Windows cache fallback cannot be used')
    const version = require('electron/package.json').version
    const archive = join(process.env.LOCALAPPDATA ?? '', 'electron', 'Cache', `electron-v${version}-win32-x64.zip`)
    await access(archive)
    // tar.exe ships with supported Windows releases and handles Electron's zip
    // without an external JS stream implementation.
    await run('tar.exe', ['-xf', archive, '-C', releaseDir])
  }
  await rename(join(releaseDir, 'electron.exe'), join(releaseDir, 'Manta.exe')).catch(async (error) => {
    if (error.code !== 'ENOENT') throw error
  })
}

async function rebuildForElectron() {
  const electronVersion = require('electron/package.json').version
  await run(command, ['--filter', '@manta/rag', 'rebuild', 'better-sqlite3'], {
    timeoutMs: 300_000,
    env: { ...process.env, npm_config_runtime: 'electron', npm_config_target: electronVersion, npm_config_disturl: 'https://electronjs.org/headers' },
  })
}

async function bundleBackendForElectron(appDir) {
  // The backend is ESM today but its TypeScript output intentionally retains
  // extensionless relative specifiers for the tsx development loader.  Native
  // Electron's ESM loader rejects extensionless specifiers in an ASAR. Bundle
  // the desktop runtime entry to CJS: Fastify and several of its transitive
  // modules use CommonJS dynamic require, which cannot run from an ESM bundle.
  // The two import.meta defaults are intentionally replaced: desktop always
  // supplies bundledSeedRoot/frontendDist before those fallbacks are read.
  const backendDir = join(appDir, 'node_modules', '@manta', 'backend')
  const output = join(backendDir, 'dist', 'server.cjs')
  const backendDist = join(repositoryDir, 'packages', 'backend', 'dist')
  await bundle({
    entryPoints: [join(repositoryDir, 'packages', 'backend', 'dist', 'server.js')],
    outfile: output,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    // TypeScript preserves the Backend's internal path aliases in dist.  If
    // esbuild applies the source tsconfig to those specifiers, a package mixes
    // dist modules with a second copy from src (including a second
    // AsyncLocalStorage-backed ASH resolver).  Pin every internal alias to the
    // compiled tree so request hooks and route handlers share one runtime.
    alias: {
      '@core': join(backendDist, 'core'),
      '@engine': join(backendDist, 'core', 'engine'),
      '@context': join(backendDist, 'core', 'context'),
      '@storage': join(backendDist, 'core', 'storage'),
      '@tools': join(backendDist, 'core', 'tools'),
      '@observability': join(backendDist, 'core', 'observability'),
      '@security': join(backendDist, 'core', 'security'),
      '@llm': join(backendDist, 'core', 'llm'),
      '@routes': join(backendDist, 'routes'),
    },
    external: ['better-sqlite3', '@lydell/node-pty', '@langchain/openai', '@langchain/ollama', '@langchain/anthropic', '@langchain/core', '@langchain/core/messages', '@manta/shared', '@manta/storage-hub', '@manta/contracts', '@manta/task-runtime', '@manta/skill-runtime'],
    define: { 'import.meta.url': 'undefined' },
  })
  const backendManifestPath = join(backendDir, 'package.json')
  const backendManifest = JSON.parse(await readFile(backendManifestPath, 'utf8'))
  backendManifest.type = 'commonjs'
  backendManifest.main = './dist/server.cjs'
  backendManifest.exports = './dist/server.cjs'
  await writeFile(backendManifestPath, `${JSON.stringify(backendManifest, null, 2)}\n`)
}

async function prepareAppDirectory() {
  const appDir = join(projectDir, '.package-staging', 'app')
  await rm(join(projectDir, '.package-staging'), { recursive: true, force: true })
  await mkdir(appDir, { recursive: true })
  await Promise.all([
    cp(join(projectDir, 'dist'), join(appDir, 'dist'), { recursive: true, dereference: true }),
    cp(join(projectDir, 'package.json'), join(appDir, 'package.json'), { dereference: true }),
  ])
  await copyProductionDependencies(appDir)
  await bundleBackendForElectron(appDir)
  await Promise.all([...providerPackages, ...runtimeWorkspacePackages].map((name) => access(join(appDir, 'node_modules', ...name.split('/'), 'package.json'))))
  await Promise.all(runtimeWorkspacePackages.map((name) => access(join(appDir, 'node_modules', ...name.split('/'), 'dist'))))
  return appDir
}

async function packageDirectory() {
  if (process.platform !== 'win32') throw new Error('package:dir currently creates the Windows artifact declared in electron-builder.yml')
  const backup = await snapshotNodeAbi()
  let primary
  try {
    await rm(join(projectDir, 'release'), { recursive: true, force: true })
    await rebuildForElectron()
    const appDir = await prepareAppDirectory()
    await stageElectronRuntime()
    await mkdir(resources, { recursive: true })
    await Promise.all([
      cp(join(repositoryDir, 'packages', 'frontend', 'dist'), join(resources, 'frontend', 'dist'), { recursive: true, dereference: true }),
      cp(join(repositoryDir, 'packages', 'backend', 'dist'), join(resources, 'backend', 'dist'), { recursive: true, dereference: true }),
      cp(join(repositoryDir, 'packages', 'storage-hub', 'dist'), join(resources, 'storage-hub', 'dist'), { recursive: true, dereference: true }),
      cp(join(repositoryDir, 'packages', 'rag', 'dist'), join(resources, 'rag', 'dist'), { recursive: true, dereference: true }),
      cp(join(repositoryDir, '.manta'), join(resources, '.manta'), { recursive: true, dereference: true }),
      cp(join(projectDir, '.qdrant', 'win-x64'), join(resources, 'qdrant'), { recursive: true, dereference: true }),
    ])
    // The returned stream is only resolved after its finish event by the public
    // @electron/asar API; this is the completion boundary we verify below.
    const asar = await import('@electron/asar')
    await asar.createPackageWithOptions(appDir, join(resources, 'app.asar'), { unpackDir: 'node_modules/better-sqlite3' })
    await Promise.all(required.map((entry) => access(join(resources, entry))))
  } catch (error) { primary = error } finally {
    try { await restoreNodeAbi(backup) } catch (restoreError) {
      if (primary) throw new AggregateError([primary, restoreError], 'Package directory creation and Node ABI restoration both failed')
      throw restoreError
    }
  }
  if (primary) throw primary
}

async function main() {
  let primary; let markerRoot
  try {
    // build:win/package:dir may already have staged the authoritative tree.
    // Reuse it so the smoke checks precisely the closure electron-builder sees.
    const prepared = process.argv.includes('--prepared')
    if (!prepared) await packageDirectory()
    markerRoot = await mkdtemp(join(tmpdir(), 'manta-package-smoke-'))
    const marker = join(markerRoot, 'main.marker')
    // electron-builder's directory target can retain electron.exe when
    // executable editing is disabled for unsigned local/CI builds.
    const executable = await access(join(releaseDir, 'Manta.exe')).then(() => join(releaseDir, 'Manta.exe')).catch(() => join(releaseDir, 'electron.exe'))
    const output = await run(executable, [], { env: { ...process.env, MANTA_PACKAGE_SMOKE: '1', MANTA_PACKAGE_SMOKE_FILE: marker } })
    const rawMarker = await readFile(marker, 'utf8').catch(() => undefined)
    let mainMarker
    try { mainMarker = rawMarker && JSON.parse(rawMarker) } catch { throw new Error(`Packaged main wrote an invalid smoke marker: ${rawMarker ?? 'missing'}`) }
    const providersLoaded = mainMarker?.providers && Object.values(mainMarker.providers).every(Boolean)
    if (mainMarker?.status !== 'ok' || !mainMarker.actualEntry || !/([\\/])dist\1main\.js$/.test(mainMarker.entryFile ?? '') || !mainMarker.backend || !mainMarker.composition || !mainMarker.server || !mainMarker.routedApis || !mainMarker.nativeSqlite || !providersLoaded || !output.includes('MANTA_PACKAGE_SMOKE_OK')) throw new Error(`Packaged dist/main.js did not complete smoke mode: ${rawMarker ?? 'missing'}; output: ${output}`)
    console.log(`Verified ${required.length} packaged runtime resources, ${providerPackages.length} provider packages, packaged storage composition/server/routed APIs, and actual packaged dist/main.js`)
  } catch (error) { primary = error } finally {
    if (markerRoot) await rm(markerRoot, { recursive: true, force: true }).catch(() => {})
    if (!process.argv.includes('--prepared')) await rm(join(projectDir, '.package-staging'), { recursive: true, force: true }).catch(() => {})
  }
  if (primary) throw primary
}

module.exports = { packageDirectory, prepareAppDirectory, required, providerPackages, runtimeWorkspacePackages }

if (require.main === module) main().catch((error) => { console.error(error); process.exitCode = 1 })
