/*  start: 工作流 YAML 加载器 — 解析 workflows/*.yaml，返回 WorkflowDef */
import * as fs from 'fs'
import * as path from 'path'
import type { WorkflowDef, WorkflowStep, WorkflowStepType } from '../types'

// AI: workflows 目录路径（项目根目录下的 workflows/）
const WORKFLOWS_DIR = path.join(process.cwd(), 'workflows')

// AI: 极简 YAML 解析 — 只解析工作流定义所需的结构
// 不引入 js-yaml 等库，手动解析 key: value 格式

// AI: 解析 YAML 标量值：去掉首尾引号；若无引号则去掉行内注释（# 及之后内容）
function parseScalar(raw: string): string {
  const trimmed = raw.trim()
  // AI: 带引号的值，# 是字符串内容，只去引号
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1)
  }
  // AI: 不带引号时，去除行内注释（空格+# 之后的内容）
  const commentIdx = trimmed.search(/\s+#/)
  if (commentIdx >= 0) {
    return trimmed.slice(0, commentIdx).trim()
  }
  return trimmed
}

function parseSimpleYaml(content: string): Record<string, unknown> {
  const lines = content.split('\n')
  const result: Record<string, unknown> = {}
  
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trimStart()
    
    // AI: 跳过注释和空行
    if (!trimmed || trimmed.startsWith('#')) {
      i++
      continue
    }
    
    const indent = line.length - trimmed.length
    
    // AI: 顶层 key: value
    if (indent === 0) {
      const colonIdx = trimmed.indexOf(':')
      if (colonIdx === -1) { i++; continue }
      const key = trimmed.slice(0, colonIdx).trim()
      const val = trimmed.slice(colonIdx + 1).trim()
      
      if (val) {
        // AI: 解析标量值（去引号 + 去行内注释）
        result[key] = parseScalar(val)
        i++
      } else {
        // AI: 值在下一行（列表或子对象）
        const { value, nextIndex } = parseBlock(lines, i + 1, 2)
        result[key] = value
        i = nextIndex
      }
    } else {
      i++
    }
  }
  
  return result
}

function parseBlock(lines: string[], startIdx: number, expectedIndent: number): { value: unknown; nextIndex: number } {
  let i = startIdx
  
  // AI: 跳过空行和注释
  while (i < lines.length) {
    const trimmed = lines[i]?.trimStart()
    if (trimmed && !trimmed.startsWith('#')) break
    i++
  }
  
  if (i >= lines.length) return { value: null, nextIndex: i }
  
  const firstLine = lines[i]
  const firstTrimmed = firstLine.trimStart()
  const actualIndent = firstLine.length - firstTrimmed.length
  
  // AI: 列表项以 '- ' 开头
  if (firstTrimmed.startsWith('- ')) {
    return parseList(lines, i, actualIndent)
  }
  
  // AI: 普通 key:value 块
  if (firstTrimmed.includes(':')) {
    return parseObject(lines, i, actualIndent)
  }
  
  return { value: parseScalar(firstTrimmed), nextIndex: i + 1 }
}

function parseList(lines: string[], startIdx: number, baseIndent: number): { value: unknown[]; nextIndex: number } {
  const items: unknown[] = []
  let i = startIdx
  
  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line?.trimStart()
    if (!trimmed || trimmed.startsWith('#')) { i++; continue }
    
    const indent = line.length - trimmed.length
    if (indent < baseIndent) break
    if (indent > baseIndent) { i++; continue }
    
    if (trimmed.startsWith('- ')) {
      const rest = trimmed.slice(2).trim()
      if (rest && !rest.startsWith('#')) {
        // AI: 行内列表项（可能是 key: value）
        if (rest.includes(':')) {
          const obj: Record<string, unknown> = {}
          const colonIdx = rest.indexOf(':')
          const k = rest.slice(0, colonIdx).trim()
          const v = rest.slice(colonIdx + 1).trim()
          if (v) {
            obj[k] = parseScalar(v)
          }
          // AI: 继续读取同一 item 的后续子字段
          i++
          while (i < lines.length) {
            const subLine = lines[i]
            const subTrimmed = subLine?.trimStart()
            if (!subTrimmed || subTrimmed.startsWith('#')) { i++; continue }
            const subIndent = subLine.length - subTrimmed.length
            if (subIndent <= baseIndent) break
            if (subTrimmed.startsWith('- ')) break
            
            // AI: 子字段解析
            if (subTrimmed.includes(':')) {
              const subColonIdx = subTrimmed.indexOf(':')
              const sk = subTrimmed.slice(0, subColonIdx).trim()
              const sv = subTrimmed.slice(subColonIdx + 1).trim()
              if (sv) {
                obj[sk] = parseScalar(sv)
              } else {
                // AI: 值在下行，如 branches: 或 actions:
                const { value, nextIndex: ni } = parseBlock(lines, i + 1, subIndent + 2)
                obj[sk] = value
                i = ni
                continue
              }
            }
            i++
          }
          items.push(obj)
        } else {
          items.push(parseScalar(rest))
          i++
        }
      } else {
        // AI: 下一行才是内容，如多行对象
        const obj: Record<string, unknown> = {}
        i++
        while (i < lines.length) {
          const subLine = lines[i]
          const subTrimmed = subLine?.trimStart()
          if (!subTrimmed || subTrimmed.startsWith('#')) { i++; continue }
          const subIndent = subLine.length - subTrimmed.length
          if (subIndent <= baseIndent) break
          if (subTrimmed.startsWith('- ')) break
          
          if (subTrimmed.includes(':')) {
            const subColonIdx = subTrimmed.indexOf(':')
            const sk = subTrimmed.slice(0, subColonIdx).trim()
            const sv = subTrimmed.slice(subColonIdx + 1).trim()
            if (sv) {
              obj[sk] = parseScalar(sv)
            } else {
              const { value, nextIndex: ni } = parseBlock(lines, i + 1, subIndent + 2)
              obj[sk] = value
              i = ni
              continue
            }
          }
          i++
        }
        if (Object.keys(obj).length > 0) items.push(obj)
      }
    } else {
      break
    }
  }
  
  return { value: items, nextIndex: i }
}

function parseObject(lines: string[], startIdx: number, baseIndent: number): { value: Record<string, unknown>; nextIndex: number } {
  const obj: Record<string, unknown> = {}
  let i = startIdx
  
  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line?.trimStart()
    if (!trimmed || trimmed.startsWith('#')) { i++; continue }
    
    const indent = line.length - trimmed.length
    if (indent < baseIndent) break
    if (indent > baseIndent) { i++; continue }
    
    if (trimmed.startsWith('- ')) break
    
    if (trimmed.includes(':')) {
      const colonIdx = trimmed.indexOf(':')
      const k = trimmed.slice(0, colonIdx).trim()
      const v = trimmed.slice(colonIdx + 1).trim()
      if (v && !v.startsWith('#')) {
        obj[k] = parseScalar(v)
        i++
      } else {
        const { value, nextIndex: ni } = parseBlock(lines, i + 1, baseIndent + 2)
        obj[k] = value
        i = ni
      }
    } else {
      i++
    }
  }
  
  return { value: obj, nextIndex: i }
}

// AI: 将原始 YAML 对象转换为 WorkflowDef
function normalizeWorkflowDef(raw: Record<string, unknown>): WorkflowDef | null {
  if (!raw.id || !raw.name) return null
  
  const rawSteps = Array.isArray(raw.steps) ? raw.steps : []
  const steps: WorkflowStep[] = rawSteps
    .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
    .map((s) => {
      const stepType: WorkflowStepType =
        s.type === 'human_in_loop' ? 'human_in_loop'
        : s.parallel === true || s.parallel === 'true' ? 'parallel'
        : s.type === 'conditional' ? 'conditional'
        : s.type === 'loop' ? 'loop'
        : 'agent'
      
      // AI: 解析 actions 子对象
      let actions: Record<string, string> | undefined
      if (s.actions && typeof s.actions === 'object' && !Array.isArray(s.actions)) {
        actions = Object.fromEntries(
          Object.entries(s.actions as Record<string, unknown>).map(([k, v]) => [k, String(v)])
        )
      }
      
      // AI: 解析 branches（并行步骤子分支）
      let branches: WorkflowStep[] | undefined
      if (Array.isArray(s.branches)) {
        branches = (s.branches as Record<string, unknown>[]).map((b) => ({
          id: String(b.name ?? b.agent ?? 'branch'),
          type: 'agent' as WorkflowStepType,
          name: String(b.name ?? b.agent ?? ''),
          agentName: b.agent ? String(b.agent) : undefined,
        }))
      }
      
      const step: WorkflowStep = {
        id: String(s.id ?? ''),
        type: stepType,
        name: String(s.name ?? s.id ?? ''),
        agentName: s.agent ? String(s.agent) : undefined,
        next: s.next ? String(s.next) : s.after_all ? String(s.after_all) : undefined,
        actions,
        notify: s.notify === true || s.notify === 'mac_notification' || s.notify === 'true',
        branches,
      }
      
      return step
    })
    .filter((s) => s.id)
  
  return {
    id: String(raw.id),
    name: String(raw.name),
    description: raw.description ? String(raw.description) : undefined,
    version: raw.version ? String(raw.version) : undefined,
    steps,
  }
}

// AI: 加载单个工作流 YAML 文件
export function loadWorkflowFile(filePath: string): WorkflowDef | null {
  try {
    const content = fs.readFileSync(filePath, 'utf-8')
    const raw = parseSimpleYaml(content)
    return normalizeWorkflowDef(raw)
  } catch (err) {
    console.error(`[workflow-loader] 加载失败 ${filePath}:`, err)
    return null
  }
}

// AI: 加载所有工作流（扫描 workflows/ 目录下所有 .yaml 文件）
export function loadAllWorkflows(): WorkflowDef[] {
  if (!fs.existsSync(WORKFLOWS_DIR)) return []
  
  try {
    const files = fs.readdirSync(WORKFLOWS_DIR)
      .filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'))
    
    return files
      .map((f) => loadWorkflowFile(path.join(WORKFLOWS_DIR, f)))
      .filter((w): w is WorkflowDef => w !== null)
  } catch (err) {
    console.error('[workflow-loader] 扫描工作流目录失败:', err)
    return []
  }
}

// AI: 根据 ID 查找单个工作流
export function findWorkflow(id: string): WorkflowDef | null {
  const all = loadAllWorkflows()
  return all.find((w) => w.id === id) ?? null
}
/*  end: 工作流 YAML 加载器结束 */
