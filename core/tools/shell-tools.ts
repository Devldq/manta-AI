/* core/tools/shell-tools — 向后兼容包装
 *
 * @deprecated 请使用新的模块化结构：
 * - core/tools/bash.ts      → createBashTools()
 * - core/tools/file-ops.ts  → createFileOpsTools()
 * - core/tools/web.ts       → createWebTools()
 * - core/tools/todo.ts      → createTodoTools()
 * - core/tools/utils.ts     → 共享工具函数
 */
import type { ToolDefinition } from '@/core/tool-registry'
import { createBashTools } from './bash'
import { createFileOpsTools } from './file-ops'
import { createWebTools } from './web'
import { createTodoTools } from './todo'

/** @deprecated 使用 createBashTools() + createFileOpsTools() + createWebTools() + createTodoTools() 替代 */
export const ccToolDefs: ToolDefinition[] = [
  ...createBashTools(),
  ...createFileOpsTools(),
  ...createWebTools(),
  ...createTodoTools(),
]
