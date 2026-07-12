const { readdirSync, rmSync } = require('node:fs')
const { join, resolve } = require('node:path')

/** Remove generated build/package trees without touching source or dependencies. */
function clean(projectDir = resolve(__dirname, '..')) {
  for (const directory of readdirSync(projectDir, { withFileTypes: true })) {
    if (!directory.isDirectory()) continue
    if (directory.name === 'dist' || directory.name === '.package-staging' || /^release(?:-|$)/.test(directory.name)) {
      rmSync(join(projectDir, directory.name), { recursive: true, force: true })
    }
  }
}

if (require.main === module) clean()

module.exports = { clean }
