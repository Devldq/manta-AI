/* AI start: 插件安装/卸载 API — POST/DELETE /api/plugins/install
 * 安装：将本地插件目录复制到 plugins/<id>/ 即完成安装，无需 npm
 * 卸载：直接删除 plugins/<id>/ 目录（内置插件拒绝删除）
 */
import { NextRequest, NextResponse } from 'next/server'
import * as fs from 'fs'
import * as path from 'path'
import * as yaml from 'js-yaml'

// AI: 项目内 plugins/ 目录
const PLUGINS_DIR = path.join(process.cwd(), 'plugins')

// AI: 内置插件目录名列表（这些目录不允许被卸载）
const BUILTIN_PLUGIN_DIRS = new Set(['codeflicker', 'openclaw', 'claude-code'])

// AI: 读取目录内的 plugin.yaml
function readPluginYaml(dir: string): { id: string; name: string } | null {
  const manifestPath = path.join(dir, 'plugin.yaml')
  if (!fs.existsSync(manifestPath)) return null
  try {
    const parsed = yaml.load(fs.readFileSync(manifestPath, 'utf-8')) as Record<string, unknown>
    if (!parsed?.id || !parsed?.name) return null
    return { id: String(parsed.id), name: String(parsed.name) }
  } catch {
    return null
  }
}

// AI: 递归复制目录（替代 fs.cpSync 以兼容旧版 Node）
function copyDirRecursive(src: string, dest: string) {
  fs.mkdirSync(dest, { recursive: true })
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath)
    } else {
      fs.copyFileSync(srcPath, destPath)
    }
  }
}

// AI: 递归删除目录
function removeDirRecursive(dir: string) {
  fs.rmSync(dir, { recursive: true, force: true })
}

// ─── POST: 安装插件（从本地路径复制） ────────────────────────────
export async function POST(req: NextRequest) {
  let sourcePath: string
  try {
    const body = await req.json()
    sourcePath = (body.sourcePath ?? '').trim()
  } catch {
    return NextResponse.json({ success: false, error: '请求体解析失败' }, { status: 400 })
  }

  if (!sourcePath) {
    return NextResponse.json({ success: false, error: '插件路径不能为空' }, { status: 400 })
  }

  // AI: 展开 ~ 路径
  if (sourcePath.startsWith('~/')) {
    sourcePath = path.join(process.env.HOME ?? process.env.USERPROFILE ?? '', sourcePath.slice(2))
  }

  // AI: 路径安全检查 — 禁止路径穿越
  const resolvedSource = path.resolve(sourcePath)

  if (!fs.existsSync(resolvedSource)) {
    return NextResponse.json({ success: false, error: `路径不存在: ${resolvedSource}` }, { status: 400 })
  }

  const stat = fs.statSync(resolvedSource)
  if (!stat.isDirectory()) {
    return NextResponse.json({ success: false, error: '路径必须是一个目录' }, { status: 400 })
  }

  // AI: 读取 plugin.yaml 获取插件 ID
  const manifest = readPluginYaml(resolvedSource)
  if (!manifest) {
    return NextResponse.json(
      { success: false, error: '该目录没有 plugin.yaml，不是合法的 Manta 插件' },
      { status: 400 }
    )
  }

  // AI: 禁止覆盖内置插件
  if (BUILTIN_PLUGIN_DIRS.has(manifest.id)) {
    return NextResponse.json(
      { success: false, error: `"${manifest.id}" 是内置插件，不允许覆盖` },
      { status: 403 }
    )
  }

  const destDir = path.join(PLUGINS_DIR, manifest.id)

  try {
    // AI: 如目标已存在则先删除（允许覆盖安装/更新）
    if (fs.existsSync(destDir)) {
      removeDirRecursive(destDir)
    }

    // AI: 复制插件目录到 plugins/<id>/
    copyDirRecursive(resolvedSource, destDir)

    return NextResponse.json({ success: true, pluginId: manifest.id, pluginName: manifest.name })
  } catch (err) {
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 })
  }
}

// ─── DELETE: 卸载插件（直接删除目录） ────────────────────────────
export async function DELETE(req: NextRequest) {
  let pluginId: string
  try {
    const body = await req.json()
    pluginId = (body.pluginId ?? '').trim()
  } catch {
    return NextResponse.json({ success: false, error: '请求体解析失败' }, { status: 400 })
  }

  if (!pluginId) {
    return NextResponse.json({ success: false, error: 'pluginId 不能为空' }, { status: 400 })
  }

  // AI: 内置插件不允许卸载
  if (BUILTIN_PLUGIN_DIRS.has(pluginId)) {
    return NextResponse.json({ success: false, error: '内置插件不允许卸载' }, { status: 403 })
  }

  const pluginDir = path.join(PLUGINS_DIR, pluginId)
  if (!fs.existsSync(pluginDir)) {
    return NextResponse.json({ success: false, error: '插件不存在' }, { status: 404 })
  }

  try {
    removeDirRecursive(pluginDir)
    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 })
  }
}
/* AI end: 插件安装/卸载 API 结束 */
