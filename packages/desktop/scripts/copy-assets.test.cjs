const { mkdtempSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { runInNewContext } = require('node:vm')
const test = require('node:test')
const assert = require('node:assert/strict')

test('copyAssets emits an executable browser onboarding bundle', async () => {
  const root = mkdtempSync(join(tmpdir(), 'manta-onboarding-build-'))
  const source = join(root, 'src', 'onboarding')
  const preloadSource = join(root, 'src', 'preload')
  mkdirSync(source, { recursive: true })
  mkdirSync(preloadSource, { recursive: true })
  writeFileSync(join(source, 'index.html'), '<script src="./index.js"></script>')
  writeFileSync(join(source, 'index.ts'), 'document.querySelector("#choose")!.addEventListener("click", () => { window.started = true }); export {}')
  writeFileSync(join(source, 'progress-contract.ts'), 'export const valid = (value: unknown) => Boolean(value)')
  writeFileSync(join(preloadSource, 'onboarding-preload.ts'), 'import { contextBridge } from "electron"; import { valid } from "../onboarding/progress-contract"; contextBridge.exposeInMainWorld("test", { valid })')
  writeFileSync(join(preloadSource, 'main-preload.ts'), 'import { contextBridge } from "electron"; import { valid } from "../onboarding/progress-contract"; contextBridge.exposeInMainWorld("mainTest", { valid })')

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

  const preloadBundle = readFileSync(join(root, 'dist', 'preload', 'onboarding-preload.js'), 'utf8')
  assert.doesNotMatch(preloadBundle, /require\(["']\.\./)
  assert.match(preloadBundle, /require\(["']electron["']\)/)

  const mainPreloadBundle = readFileSync(join(root, 'dist', 'preload', 'main-preload.js'), 'utf8')
  assert.doesNotMatch(mainPreloadBundle, /require\(["']\.\./)
  assert.match(mainPreloadBundle, /require\(["']electron["']\)/)
})

test('onboarding source contains readable Simplified Chinese controls', () => {
  const html = readFileSync(join(__dirname, '..', 'src', 'onboarding', 'index.html'), 'utf8')
  for (const label of ['设置 Manta AI 数据位置', '选择文件夹', '创建并启动', '退出', '尚未选择存储位置', '初始化进度']) {
    assert.match(html, new RegExp(label))
  }
  const source = readFileSync(join(__dirname, '..', 'src', 'onboarding', 'progress-model.ts'), 'utf8')
  for (const label of ['创建 7 个数据分组', '提交 Bootstrap 配置', '初始化 Manta AI 服务', '启动 Backend 并完成健康检查']) {
    assert.match(source, new RegExp(label))
  }
})
