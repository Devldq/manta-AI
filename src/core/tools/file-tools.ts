/* core/tools/file-tools — 向后兼容包装
 *
 * @deprecated 请使用新的模块化结构：
 * - core/tools/fs-access.ts  → createFsTools()
 * - core/tools/utils.ts      → 共享工具函数
 */
import type { ToolDefinition } from '@tools/registry'
import { createFsTools } from './builtin/fs-access'

/** @deprecated 使用 createFsTools() 工厂函数替代 */
export const fsToolDefs: ToolDefinition[] = createFsTools()
