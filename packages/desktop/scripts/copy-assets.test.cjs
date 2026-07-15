const { mkdtempSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { runInNewContext } = require('node:vm')
const test = require('node:test')
const assert = require('node:assert/strict')

test('copyAssets emits an executable browser onboarding bundle', async () => {
  const root = mkdtempSync(join(tmpdir(), 'manta-onboarding-build-'))
  const source = join(root, 'src', 'onboarding')
  mkdirSync(source, { recursive: true })
  writeFileSync(join(source, 'index.html'), '<script src="./index.js"></script>')
  writeFileSync(join(source, 'index.ts'), 'document.querySelector("#choose")!.addEventListener("click", () => { window.started = true }); export {}')

  const { copyAssets } = require('./copy-assets.cjs')
  await copyAssets(root)

  const listeners = new Map()
  const bundle = readFileSync(join(root, 'dist', 'onboarding', 'index.js'), 'utf8')
  assert.doesNotMatch(bundle, /\b(?:exports|require)\b/)
  const context = {
    window: { started: false },
    document: { querySelector: () => ({ addEventListener: (name, listener) => listeners.set(name, listener) }) },
  }
  runInNewContext(bundle, context)
  listeners.get('click')()
  assert.equal(context.window.started, true)
})

test('onboarding source contains readable Simplified Chinese controls', () => {
  const html = readFileSync(join(__dirname, '..', 'src', 'onboarding', 'index.html'), 'utf8')
  for (const label of ['设置 Agent Storage Hub', '选择文件夹', '创建并启动', '退出', '尚未选择']) {
    assert.match(html, new RegExp(label))
  }
})
