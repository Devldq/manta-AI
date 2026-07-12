/*
 * Electron Builder's Windows .cmd shim can detach from PowerShell before the
 * native packager finishes.  Drive Builder through its promise API so a green
 * smoke check means the resources that the packaged main process needs exist.
 */
const { access } = require('node:fs/promises')
const { join } = require('node:path')
const { build, Platform } = require('electron-builder')

// Keep Builder attached to the process in Windows/PowerShell CI; without an
// active debug reporter its native worker can be orphaned before `build()` has
// finished writing the application resources.
process.env.DEBUG ??= 'electron-builder'

const projectDir = join(__dirname, '..')
const resources = join(projectDir, 'release', 'win-unpacked', 'resources')
const required = [
  'app.asar',
  join('frontend', 'dist'),
  join('backend', 'dist'),
  join('storage-hub', 'dist'),
  join('rag', 'dist'),
  '.manta',
  join('app.asar.unpacked', 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node'),
]

async function main() {
  await build({
    projectDir,
    config: join(projectDir, 'electron-builder.yml'),
    targets: Platform.WINDOWS.createTarget(['dir']),
  })
  await Promise.all(required.map(async (relativePath) => {
    try { await access(join(resources, relativePath)) }
    catch { throw new Error(`Packaged resource is missing: ${relativePath}`) }
  }))
  console.log(`Verified ${required.length} packaged runtime resources`)
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
