/*
 * A directory-package smoke test.  This deliberately does not trust a zero
 * exit status from electron-builder: on Windows some builder/ASAR combinations
 * can leave an electron runtime without app resources.  We build the same
 * directory layout ourselves using the maintained @electron/asar API, then
 * launch the resulting executable.  The fallback is useful in CI as well as
 * locally; release installers continue to use electron-builder.yml.
 */
const { access, cp, mkdtemp, mkdir, readFile, rename, rm, writeFile } = require('node:fs/promises')
const { dirname, join, relative, resolve } = require('node:path')
const { tmpdir } = require('node:os')
const { spawn } = require('node:child_process')
const { build: bundle } = require('esbuild')

const projectDir = join(__dirname, '..')
const repositoryDir = resolve(projectDir, '..', '..')
const releaseDir = join(projectDir, 'release', 'win-unpacked')
const resources = join(releaseDir, 'resources')
const command = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const required = ['app.asar', join('frontend', 'dist'), join('backend', 'dist'), join('storage-hub', 'dist'), join('rag', 'dist'), '.manta', join('app.asar.unpacked', 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node')]

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

async function restoreNodeAbi() {
  await run(command, ['--filter', '@manta/rag', 'rebuild', 'better-sqlite3'])
  await run(process.execPath, ['-e', "const Database=require('better-sqlite3');const db=new Database(':memory:');db.prepare('select 1').get();db.close()"])
}

function collectDependencies(node, result = new Map()) {
  for (const [name, value] of Object.entries(node.dependencies ?? {})) {
    if (value.path && !result.has(name)) result.set(name, value.path)
    collectDependencies(value, result)
  }
}

async function copyProductionDependencies(appDir) {
  const graph = JSON.parse(await run(command, ['--filter', '@manta/desktop', 'list', '--prod', '--depth', 'Infinity', '--json']))[0]
  const dependencies = new Map()
  collectDependencies(graph, dependencies)
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
  // Electron's ESM loader rejects those specifiers in an ASAR.  Bundle the
  // desktop runtime entry to a CJS boundary, retaining the native binding as
  // an external dependency; Electron can then dynamically import the package
  // exactly as desktop main does in production.
  const backendDir = join(appDir, 'node_modules', '@manta', 'backend')
  const output = join(backendDir, 'dist', 'server.cjs')
  await bundle({
    entryPoints: [join(repositoryDir, 'packages', 'backend', 'dist', 'server.js')],
    outfile: output,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    external: ['better-sqlite3', '@langchain/openai', '@langchain/ollama', '@langchain/anthropic'],
  })
  const backendManifestPath = join(backendDir, 'package.json')
  const backendManifest = JSON.parse(await readFile(backendManifestPath, 'utf8'))
  backendManifest.type = 'commonjs'
  backendManifest.main = './dist/server.cjs'
  backendManifest.exports = './dist/server.cjs'
  await writeFile(backendManifestPath, `${JSON.stringify(backendManifest, null, 2)}\n`)
}

async function packageDirectory() {
  if (process.platform !== 'win32') throw new Error('package:dir currently creates the Windows artifact declared in electron-builder.yml')
  await rm(join(projectDir, 'release'), { recursive: true, force: true })
  await rebuildForElectron()
  const appDir = join(projectDir, '.package-staging', 'app')
  await rm(join(projectDir, '.package-staging'), { recursive: true, force: true })
  await mkdir(appDir, { recursive: true })
  await Promise.all([
    cp(join(projectDir, 'dist'), join(appDir, 'dist'), { recursive: true, dereference: true }),
    cp(join(projectDir, 'package.json'), join(appDir, 'package.json'), { dereference: true }),
  ])
  // Electron evaluates the package entry before it can reach main.ts.  Keep a
  // tiny CommonJS dispatcher as that entry so smoke diagnostics prove module
  // resolution independently of window creation and never depend on Electron's
  // `require.main` implementation for packaged apps.
  const manifest = JSON.parse(await readFile(join(appDir, 'package.json'), 'utf8'))
  manifest.main = 'smoke-dispatcher.cjs'
  await writeFile(join(appDir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  await writeFile(join(appDir, 'smoke-dispatcher.cjs'), `
const { writeFileSync } = require('node:fs')
const marker = process.env.MANTA_PACKAGE_SMOKE_FILE
const finish = (value) => { if (marker) writeFileSync(marker, value) }
if (process.env.MANTA_PACKAGE_SMOKE === '1') {
  finish('started')
  ;(async () => {
    const backend = await import('@manta/backend')
    if (typeof backend.startServer !== 'function' || typeof backend.createBackendStorageComposition !== 'function') throw new Error('Packaged @manta/backend did not resolve its ESM exports')
    const Database = require('better-sqlite3'); const db = new Database(':memory:'); db.prepare('select 1').get(); db.close()
    finish('ok'); process.stdout.write('MANTA_PACKAGE_SMOKE_OK\\n'); process.exit(0)
  })().catch((error) => { finish('error:' + (error.stack || error)); process.stderr.write(String(error)); process.exit(1) })
} else {
  require('./dist/main.js')
}
`)
  await copyProductionDependencies(appDir)
  await bundleBackendForElectron(appDir)
  await stageElectronRuntime()
  await mkdir(resources, { recursive: true })
  await Promise.all([
    cp(join(repositoryDir, 'packages', 'frontend', 'dist'), join(resources, 'frontend', 'dist'), { recursive: true, dereference: true }),
    cp(join(repositoryDir, 'packages', 'backend', 'dist'), join(resources, 'backend', 'dist'), { recursive: true, dereference: true }),
    cp(join(repositoryDir, 'packages', 'storage-hub', 'dist'), join(resources, 'storage-hub', 'dist'), { recursive: true, dereference: true }),
    cp(join(repositoryDir, 'packages', 'rag', 'dist'), join(resources, 'rag', 'dist'), { recursive: true, dereference: true }),
    cp(join(repositoryDir, '.manta'), join(resources, '.manta'), { recursive: true, dereference: true }),
  ])
  // The returned stream is only resolved after its finish event by the public
  // @electron/asar API; this is the completion boundary we verify below.
  const asar = await import('@electron/asar')
  await asar.createPackageWithOptions(appDir, join(resources, 'app.asar'), { unpackDir: 'node_modules/better-sqlite3' })
  await Promise.all(required.map((entry) => access(join(resources, entry))))
}

async function main() {
  let primary; let markerRoot
  try {
    await packageDirectory()
    markerRoot = await mkdtemp(join(tmpdir(), 'manta-package-smoke-'))
    const marker = join(markerRoot, 'main.marker')
    const executable = join(releaseDir, 'Manta.exe')
    const output = await run(executable, [], { env: { ...process.env, MANTA_PACKAGE_SMOKE: '1', MANTA_PACKAGE_SMOKE_FILE: marker } })
    const mainMarker = await readFile(marker, 'utf8').catch(() => undefined)
    if (mainMarker !== 'ok' || !output.includes('MANTA_PACKAGE_SMOKE_OK')) throw new Error(`Packaged main did not complete smoke mode (marker=${mainMarker ?? 'missing'}): ${output}`)
    console.log(`Verified ${required.length} packaged runtime resources and actual packaged main`)
  } catch (error) { primary = error } finally {
    if (markerRoot) await rm(markerRoot, { recursive: true, force: true }).catch(() => {})
    await rm(join(projectDir, '.package-staging'), { recursive: true, force: true }).catch(() => {})
    try { await restoreNodeAbi() } catch (restoreError) { if (primary) throw new AggregateError([primary, restoreError], 'Package smoke and Node ABI restoration both failed'); throw restoreError }
  }
  if (primary) throw primary
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
