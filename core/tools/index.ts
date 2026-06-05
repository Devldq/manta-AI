/* core/tools — 工具实现层，汇总导出所有工具定义
 *
 * 目录结构：
 * - utils.ts            共享工具函数（参数解析、文件遍历、访问控制等）
 * - bash.ts             Bash 命令执行工具 (bash / bashOutput / bashKill)
 * - file-ops.ts         文件操作工具 — CC 风格，无访问控制 (read / write / edit / multiEdit)
 * - fs-access.ts        文件系统工具 — 带 CWD 访问控制 (readFile / lsDir / glob / grep)
 * - web.ts              网络工具 (webFetch / webSearch)
 * - todo.ts             待办事项工具 (todoRead / todoWrite)
 * - conversation-tools.ts  会话管理工具 (createConversation / listConversations / ...)
 * - tool-search.ts      工具搜索元工具 — 位于 tool-registry/ 目录
 *
 * 每个文件导出工厂函数 createXxxTools(): ToolDefinition[]
 * index.ts 汇总为 createAllTools() 一行搞定
 */
import type { ToolDefinition } from '@/core/tool-registry'
import { createBashTools } from './bash'
import { createFileOpsTools } from './file-ops'
import { createFsTools } from './fs-access'
import { createWebTools } from './web'
import { createTodoTools } from './todo'
import { createConversationTools } from './conversation-tools'
import { createMemoryTool } from './memory-tools'
import { getMemoryStore } from '@/core/memory'

// ─── 汇总工厂函数 ────────────────────────────────────────────────────────────

/** 创建所有内置工具（不含 tool_search，后者在 tool-registry/mcp-setup.ts 中单独注册） */
export function createAllTools(): ToolDefinition[] {
  return [
    ...createConversationTools(),
    ...createFsTools(),
    ...createBashTools(),
    ...createFileOpsTools(),
    ...createWebTools(),
    ...createTodoTools(),
    createMemoryTool(getMemoryStore()),
  ]
}

// ─── 向后兼容导出（@deprecated） ─────────────────────────────────────────────

/** @deprecated 使用 createFsTools() 替代 */
export { createFsTools as createFsToolDefs } from './fs-access'
/** @deprecated 使用 createBashTools() + createFileOpsTools() + createWebTools() + createTodoTools() 替代 */
export const ccToolDefs: ToolDefinition[] = [
  ...createBashTools(),
  ...createFileOpsTools(),
  ...createWebTools(),
  ...createTodoTools(),
]
/** @deprecated 使用 createFsTools() 替代 */
export const fsToolDefs: ToolDefinition[] = createFsTools()
/** @deprecated 使用 createConversationTools() 替代 */
export { conversationToolDefs } from './conversation-tools'

// ─── 按模块重新导出工厂函数 ──────────────────────────────────────────────────

export { createBashTools } from './bash'
export { createFileOpsTools } from './file-ops'
export { createFsTools } from './fs-access'
export { createWebTools } from './web'
export { createTodoTools } from './todo'
export { createConversationTools } from './conversation-tools'
export { createMemoryTool } from './memory-tools'
