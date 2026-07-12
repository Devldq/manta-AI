const { copyFileSync, mkdirSync } = require('node:fs')
const { resolve } = require('node:path')

const target = resolve(__dirname, '..', 'dist', 'onboarding')
mkdirSync(target, { recursive: true })
copyFileSync(resolve(__dirname, '..', 'src', 'onboarding', 'index.html'), resolve(target, 'index.html'))
