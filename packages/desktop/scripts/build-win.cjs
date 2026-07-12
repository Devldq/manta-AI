const { spawnSync } = require('node:child_process')
const { access } = require('node:fs/promises')
const { join } = require('node:path')

// Invoking the resolved CLI through Node avoids the Windows .cmd wrapper
// returning before electron-builder has completed the resource/ASAR write.
const projectDir = join(__dirname, '..')
const result = spawnSync(process.execPath, [require.resolve('electron-builder/cli.js'), '--win', '--dir'], { cwd: projectDir, stdio: 'inherit' })
if (result.error) throw result.error
if (result.status) process.exitCode = result.status
else void (async () => {
  // Some current Windows builder/runtime combinations return success after
  // copying Electron but before producing resources. Preserve its official
  // layout, then populate that same layout via the shared deterministic
  // staging implementation rather than shipping an empty executable.
  await access(join(projectDir, 'release', 'win-unpacked', 'resources', 'app.asar')).catch(async () => {
    await require('./package-smoke.cjs').packageDirectory()
    await access(join(projectDir, 'release', 'win-unpacked', 'resources', 'app.asar'))
  }).catch((error) => { console.error(error); process.exitCode = 1 })
})()
