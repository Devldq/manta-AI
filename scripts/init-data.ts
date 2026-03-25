#!/usr/bin/env tsx
/**
 * AI: 初始化本机数据目录 ~/arm-data/
 * 运行：npm run init-data
 */
import fs from 'fs'
import path from 'path'
import os from 'os'

const DATA_ROOT = process.env.ARM_DATA_ROOT
  ? path.resolve(process.env.ARM_DATA_ROOT.replace('~', os.homedir()))
  : path.join(os.homedir(), 'arm-data')

const AGENT_IDS = ['architect', 'dev', 'qa', 'review']
const PROJECT_ROOT = path.join(__dirname, '..')

function ensureDir(p: string) {
  if (!fs.existsSync(p)) {
    fs.mkdirSync(p, { recursive: true })
    console.log(`✅ 创建目录: ${p}`)
  }
}

function copyIfNotExists(src: string, dest: string) {
  if (fs.existsSync(dest)) return
  if (!fs.existsSync(src)) return
  fs.copyFileSync(src, dest)
  console.log(`📄 复制文件: ${path.relative(os.homedir(), dest)}`)
}

function writeIfNotExists(filePath: string, content: string) {
  if (fs.existsSync(filePath)) return
  fs.writeFileSync(filePath, content, 'utf-8')
  console.log(`📝 创建文件: ${path.relative(os.homedir(), filePath)}`)
}

console.log(`\n🏛️  ARM 控制台 — 初始化数据目录`)
console.log(`📁 数据根目录: ${DATA_ROOT}\n`)

// AI: 创建根目录
ensureDir(DATA_ROOT)
ensureDir(path.join(DATA_ROOT, 'workflows'))

// AI: 初始化 tasks.json
writeIfNotExists(
  path.join(DATA_ROOT, 'tasks.json'),
  JSON.stringify([], null, 2)
)

// AI: 初始化 notifications.jsonl
writeIfNotExists(path.join(DATA_ROOT, 'notifications.jsonl'), '')

// AI: 初始化各 Agent 目录
for (const agentId of AGENT_IDS) {
  const agentDir = path.join(DATA_ROOT, 'agents', agentId)
  const tasksDir = path.join(agentDir, 'tasks')
  ensureDir(agentDir)
  ensureDir(tasksDir)

  // AI: 从项目 agents/ 模板复制 SOUL.md
  copyIfNotExists(
    path.join(PROJECT_ROOT, 'agents', agentId, 'SOUL.md'),
    path.join(agentDir, 'SOUL.md')
  )

  // AI: 初始化 stats.json
  writeIfNotExists(
    path.join(agentDir, 'stats.json'),
    JSON.stringify(
      {
        agentId,
        displayName:
          { architect: '架构师', dev: '开发工程师', qa: 'QA 工程师', review: '代码审查官' }[agentId] ?? agentId,
        health: 60,
        status: 'active',
        generation: 1,
        parentId: null,
        completedTasks: 0,
        failedTasks: 0,
        totalTokens: 0,
        skills: [],
        createdAt: new Date().toISOString(),
        lastActiveAt: new Date().toISOString(),
      },
      null,
      2
    )
  )

  // AI: 初始化 queue.jsonl
  writeIfNotExists(path.join(agentDir, 'queue.jsonl'), '')
}

// AI: 复制工作流配置
for (const wf of ['dev-standard.yaml', 'quick-fix.yaml']) {
  copyIfNotExists(
    path.join(PROJECT_ROOT, 'workflows', wf),
    path.join(DATA_ROOT, 'workflows', wf)
  )
}

console.log(`\n🎉 初始化完成！运行 npm run dev 启动控制台\n`)
