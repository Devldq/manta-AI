/* AI start: ARM Agent 触发模块 — 支持本地 CLI 和 IM 两种触发模式 */
import { execSync, spawn } from 'child_process'
import path from 'path'
import fs from 'fs'
import os from 'os'
import { loadArmConfig } from '@/config/arm'
import type { Task } from '@/lib/types'

// AI: 解析 ~ 为 home 目录
function expandHome(p: string) {
  return p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p
}

// AI: 获取 openclaw 可执行文件路径
function getOpenclawBin(): string {
  const cfg = loadArmConfig()
  if (cfg.local.openclaw_bin) {
    return expandHome(cfg.local.openclaw_bin)
  }
  // AI: 从 PATH 和常见位置自动查找
  const candidates = [
    'openclaw',
    path.join(os.homedir(), '.openclaw', 'bin', 'openclaw'),
  ]
  for (const bin of candidates) {
    try {
      execSync(`which ${bin}`, { stdio: 'pipe' })
      return bin
    } catch {
      // 继续尝试下一个
    }
  }
  return 'openclaw'
}

// AI: 通过本地 CLI 触发 agent（同步执行，用于非阻塞 spawn 包装）
function triggerViaLocalCLI(agentId: string, message: string): void {
  const cfg = loadArmConfig()
  const bin = getOpenclawBin()
  const timeout = cfg.local.timeout * 1000

  // AI: 使用 spawn 异步执行，不阻塞 API 响应
  const child = spawn(bin, [
    'agent',
    '--agent', agentId,
    '--message', message,
  ], {
    detached: true,
    stdio: 'ignore',
    timeout,
    env: {
      ...process.env,
      PATH: `${path.join(os.homedir(), '.openclaw', 'bin')}:${process.env.PATH}`,
    },
  })
  child.unref()
  console.log(`[ARM] 已触发 agent ${agentId} (local CLI, pid: ${child.pid})`)
}

// AI: 通过 IM channel 触发 agent（适用于跨机器调用）
function triggerViaIM(agentId: string, message: string): void {
  const cfg = loadArmConfig()
  const { channel, targets } = cfg.im
  const target = targets[agentId]

  if (!target) {
    console.warn(`[ARM] IM 模式：agent ${agentId} 未配置 target，跳过触发`)
    return
  }

  const bin = getOpenclawBin()
  const child = spawn(bin, [
    'message', 'send',
    '--channel', channel,
    '--target', target,
    '--message', message,
  ], {
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      PATH: `${path.join(os.homedir(), '.openclaw', 'bin')}:${process.env.PATH}`,
    },
  })
  child.unref()
  console.log(`[ARM] 已触发 agent ${agentId} (IM: ${channel} → ${target})`)
}

// AI: 核心触发函数 — 读取配置决定触发模式
export function triggerAgent(agentId: string, message: string): void {
  try {
    const cfg = loadArmConfig()
    if (cfg.trigger_mode === 'im') {
      triggerViaIM(agentId, message)
    } else {
      triggerViaLocalCLI(agentId, message)
    }
  } catch (err) {
    // AI: 触发失败只记录日志，不影响 API 响应
    console.error(`[ARM] 触发 agent ${agentId} 失败:`, err)
  }
}

// AI: 根据任务状态和阶段，自动判断应触发哪个 agent
export function resolveAgentForTask(task: Task, targetStatus: string): string | null {
  const cfg = loadArmConfig()

  // AI: 如果任务未绑定工作流，不自动触发
  const rule = cfg.trigger_rules.find(r => r.on_status === targetStatus)
  if (!rule) return null
  if (rule.require_workflow && !task.workflowId) return null

  let agentKey = rule.agent

  // AI: auto 模式 — 有 frontend-design 说明 architect 已完成 → 触发 dev
  if (agentKey === 'auto') {
    const taskDir = path.join(
      process.env.ARM_DATA_ROOT
        ? expandHome(process.env.ARM_DATA_ROOT)
        : path.join(os.homedir(), 'arm-data'),
      'tasks',
      task.id,
    )
    const hasDesign = fs.existsSync(path.join(taskDir, 'frontend-design.md'))
    agentKey = hasDesign ? 'dev' : 'architect'
  }

  return cfg.agent_ids[agentKey] ?? null
}

// AI: 构建给 agent 的标准触发消息
export function buildTriggerMessage(task: Task, event: 'created' | 'status_changed', targetStatus?: string): string {
  const repoList = task.repos?.length ? task.repos.join(', ') : '未指定'
  const base = [
    `任务ID: ${task.id}`,
    `任务标题: ${task.title}`,
    task.description ? `任务描述: ${task.description}` : null,
    task.requirementDoc ? `需求文档: ${task.requirementDoc}` : null,
    task.backendDesign ? `后端技术方案: ${task.backendDesign}` : null,
    `关联仓库: ${repoList}`,
  ].filter(Boolean).join('\n')

  if (event === 'created') {
    return `新任务已创建，请按工作循环开始执行。\n\n${base}`
  }
  return `任务状态已更新为 ${targetStatus}，请按工作循环继续执行。\n\n${base}`
}
/* AI end: ARM Agent 触发模块 */
