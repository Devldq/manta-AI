#!/usr/bin/env npx tsx
/**
 * 版本自动更新脚本
 * 
 * 根据 git commit message 自动更新版本号：
 * - feat/feature: → minor 版本 +1
 * - fix/bugfix: → patch 版本 +1
 * - breaking/BREAKING CHANGE: → major 版本 +1
 * - 其他: → patch 版本 +1
 * 
 * 用法: npx tsx scripts/update-version.ts "commit message"
 */

import * as fs from 'fs'
import * as path from 'path'

const VERSION_FILE = path.join(process.cwd(), 'version.json')

interface VersionData {
  version: string
  lastUpdated: string
  changelog: Array<{
    version: string
    date: string
    changes: string[]
  }>
}

/** 解析版本号 */
function parseVersion(version: string): [number, number, number] {
  const parts = version.split('.').map(Number)
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0]
}

/** 格式化版本号 */
function formatVersion(major: number, minor: number, patch: number): string {
  return `${major}.${minor}.${patch}`
}

/** 获取当前日期 */
function getCurrentDate(): string {
  const now = new Date()
  return now.toISOString().split('T')[0]
}

/** 根据 commit message 判断版本更新类型 */
function getVersionBumpType(message: string): 'major' | 'minor' | 'patch' {
  const lowerMessage = message.toLowerCase()
  
  // Breaking change
  if (lowerMessage.includes('breaking') || lowerMessage.includes('break:')) {
    return 'major'
  }
  
  // Feature
  if (lowerMessage.startsWith('feat') || lowerMessage.startsWith('feature')) {
    return 'minor'
  }
  
  // Bug fix
  if (lowerMessage.startsWith('fix') || lowerMessage.startsWith('bugfix')) {
    return 'patch'
  }
  
  // 默认 patch
  return 'patch'
}

/** 更新版本号 */
function bumpVersion(currentVersion: string, type: 'major' | 'minor' | 'patch'): string {
  const [major, minor, patch] = parseVersion(currentVersion)
  
  switch (type) {
    case 'major':
      return formatVersion(major + 1, 0, 0)
    case 'minor':
      return formatVersion(major, minor + 1, 0)
    case 'patch':
      return formatVersion(major, minor, patch + 1)
  }
}

/** 主函数 */
function main() {
  const commitMessage = process.argv[2]
  
  if (!commitMessage) {
    console.error('❌ 缺少 commit message 参数')
    process.exit(1)
  }
  
  // 读取当前版本
  let versionData: VersionData
  try {
    const content = fs.readFileSync(VERSION_FILE, 'utf-8')
    versionData = JSON.parse(content)
  } catch (error) {
    console.error('❌ 读取 version.json 失败:', error)
    process.exit(1)
  }
  
  // 判断版本更新类型
  const bumpType = getVersionBumpType(commitMessage)
  const newVersion = bumpVersion(versionData.version, bumpType)
  
  // 提取变更描述（去掉前缀如 feat: fix: 等）
  const changeDescription = commitMessage
    .replace(/^(feat|feature|fix|bugfix|breaking|chore|docs|style|refactor|perf|test|build|ci|revert)(\([^)]+\))?\s*:\s*/i, '')
    .trim() || commitMessage
  
  // 更新版本数据
  versionData.version = newVersion
  versionData.lastUpdated = getCurrentDate()
  
  // 添加到 changelog（最多保留 50 条）
  versionData.changelog.unshift({
    version: newVersion,
    date: getCurrentDate(),
    changes: [changeDescription],
  })
  
  // 保留最近 50 条记录
  if (versionData.changelog.length > 50) {
    versionData.changelog = versionData.changelog.slice(0, 50)
  }
  
  // 写入文件
  try {
    fs.writeFileSync(VERSION_FILE, JSON.stringify(versionData, null, 2) + '\n', 'utf-8')
    console.log(`✅ 版本已更新: ${bumpType} → ${newVersion}`)
    console.log(`📝 变更: ${changeDescription}`)
  } catch (error) {
    console.error('❌ 写入 version.json 失败:', error)
    process.exit(1)
  }
}

main()
