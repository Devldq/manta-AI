/** 工具定义接口 — 统一工具描述格式 */
export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema 对象（未经 jsonSchema() 包装） */
  parameters: Record<string, unknown>;
  /** 是否并发安全（可并行执行）：true=共享锁（可并发），false=独占锁（串行） */
  isConcurrencySafe?: boolean;
  /** 执行结果最大字符数，超出则截断（默认 3000） */
  maxResultChars?: number;
  /** 工具执行函数，input 为 AI SDK 传入的参数对象 */
  execute: (input: any) => Promise<unknown>;
}
