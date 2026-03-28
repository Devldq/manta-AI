/*  start: Claude Code AgentOps — 实现 Core 定义的 AgentOps 接口 */
// AI: 本文件是插件层，封装所有 claude-code 特有的 agent 文件系统操作
// claude sub-agent 格式：~/.claude/agents/<name>.md（YAML frontmatter + 系统提示正文）
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import type { AgentOps, CreateAgentParams, UpdateAgentParams } from '../../core/types'

const CLAUDE_AGENTS_DIR = path.join(os.homedir(), '.claude', 'agents')

// AI: 构造 claude sub-agent 文件内容（YAML frontmatter + 正文）
function buildAgentFileContent(name: string, description: string, soul: string): string {
  const desc = description.replace(/\n/g, ' ').trim()
  return `---\nname: ${name}\ndescription: ${desc || name}\n---\n\n${soul}`
}

// AI: 解析 claude sub-agent 文件，提取 soul（frontmatter 之后的正文部分）
function parseSoulFromFile(content: string): string {
  const match = content.match(/^---\n[\s\S]*?\n---\n\n?([\s\S]*)$/)
  return match ? match[1] : content
}

/**
 * Claude Code 插件的 AgentOps 实现
 * agent 定义文件：~/.claude/agents/<name>.md
 */
export const claudeCodeAgentOps: AgentOps = {
  /**
   * 在 claude-code 中创建 agent：
   * 写入 ~/.claude/agents/<name>.md（YAML frontmatter + SOUL.md 正文）
   */
  async createAgent(params: CreateAgentParams): Promise<void> {
    const { name, soul, description } = params
    fs.mkdirSync(CLAUDE_AGENTS_DIR, { recursive: true })
    const agentPath = path.join(CLAUDE_AGENTS_DIR, `${name}.md`)
    const content = buildAgentFileContent(name, description ?? '', soul ?? `# ${name} Agent\n\n你是一个 AI Agent。\n`)
    fs.writeFileSync(agentPath, content, 'utf-8')
  },

  /**
   * 更新 claude-code agent：
   * 读取现有文件，替换 soul 或 description，重新写入
   */
  async updateAgent(name: string, params: UpdateAgentParams): Promise<void> {
    const { soul, description } = params
    const agentPath = path.join(CLAUDE_AGENTS_DIR, `${name}.md`)

    let existingContent = ''
    if (fs.existsSync(agentPath)) {
      existingContent = fs.readFileSync(agentPath, 'utf-8')
      // AI: 备份原始文件
      fs.copyFileSync(agentPath, `${agentPath}.bak.${Date.now()}`)
    }

    // AI: 解析现有 frontmatter 中的 description 和 soul
    const frontmatterMatch = existingContent.match(/^---\n([\s\S]*?)\n---/)
    let existingDesc = ''
    if (frontmatterMatch) {
      const descMatch = frontmatterMatch[1].match(/^description:\s*(.+)$/m)
      existingDesc = descMatch?.[1]?.trim() ?? ''
    }

    const finalDesc = description !== undefined ? description : existingDesc
    const existingSoul = parseSoulFromFile(existingContent)
    const finalSoul = soul !== undefined ? soul : existingSoul

    const newContent = buildAgentFileContent(name, finalDesc, finalSoul)
    fs.writeFileSync(agentPath, newContent, 'utf-8')
  },

  /**
   * 读取 claude-code agent 的系统提示内容（frontmatter 之后的正文）
   */
  async readAgentContent(name: string): Promise<string | null> {
    const agentPath = path.join(CLAUDE_AGENTS_DIR, `${name}.md`)
    if (!fs.existsSync(agentPath)) return null
    try {
      const content = fs.readFileSync(agentPath, 'utf-8')
      return parseSoulFromFile(content)
    } catch {
      return null
    }
  },

  /**
   * 删除 claude-code agent（删除对应的 .md 文件）
   */
  async deleteAgent(name: string): Promise<void> {
    const agentPath = path.join(CLAUDE_AGENTS_DIR, `${name}.md`)
    if (fs.existsSync(agentPath)) {
      fs.unlinkSync(agentPath)
    }
  },

  /**
   * 检查 agent 是否已存在
   */
  async agentExists(name: string): Promise<boolean> {
    return fs.existsSync(path.join(CLAUDE_AGENTS_DIR, `${name}.md`))
  },
}
/*  end: Claude Code AgentOps 结束 */
