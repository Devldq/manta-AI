const { copyFileSync, mkdirSync } = require('node:fs')
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
}

if (require.main === module) copyAssets().catch((error) => { console.error(error); process.exitCode = 1 })

module.exports = { copyAssets }
