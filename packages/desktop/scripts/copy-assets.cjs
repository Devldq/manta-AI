const { copyFileSync, existsSync, mkdirSync } = require('node:fs')
const { resolve } = require('node:path')
const { build } = require('esbuild')

async function copyAssets(projectDir = resolve(__dirname, '..')) {
  const source = resolve(projectDir, 'src', 'onboarding')
  const target = resolve(projectDir, 'dist', 'onboarding')
  mkdirSync(target, { recursive: true })
  copyFileSync(resolve(source, 'index.html'), resolve(target, 'index.html'))
  await build({
    entryPoints: [resolve(source, 'index.ts')],
    outfile: resolve(target, 'index.js'),
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'chrome138',
  })

  // Sandboxed Electron preloads cannot require arbitrary local modules. Bundle
  // every preload into a single file; only Electron's supported preload module
  // remains external.
  for (const name of ['main-preload', 'onboarding-preload']) {
    const preload = resolve(projectDir, 'src', 'preload', `${name}.ts`)
    if (!existsSync(preload)) continue
    await build({
      entryPoints: [preload],
      outfile: resolve(projectDir, 'dist', 'preload', `${name}.js`),
      bundle: true,
      format: 'cjs',
      platform: 'node',
      target: 'node22',
      external: ['electron'],
    })
  }
}

if (require.main === module) copyAssets().catch((error) => { console.error(error); process.exitCode = 1 })

module.exports = { copyAssets }
