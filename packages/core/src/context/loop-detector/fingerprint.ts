/* AI start: 指纹计算函数 */

/**
 * 简单的 DJB2 哈希函数（比 crypto 更轻量）
 */
export function simpleHash(str: string): string {
  let hash = 5381
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i)
    hash = hash & 0xFFFFFFFF  // 保持 32 位整数
  }
  return hash.toString(36)
}

/**
 * 确定性 JSON 序列化（key 排序，忽略 undefined）
 * P2-5 修复：JSON.stringify 的 replacer 不保证 key 排序，
 * 需要先对 object 的 key 做 sort 再 stringify
 */
export function deterministicStringify(obj: unknown): string {
  return sortedStringify(obj)
}

/** 递归排序 key 后 stringify */
function sortedStringify(value: unknown): string {
  if (value === null || value === undefined) return String(value)
  if (typeof value !== 'object') return JSON.stringify(value)

  if (Array.isArray(value)) {
    return '[' + value.map(sortedStringify).join(',') + ']'
  }

  // Object: 对 key 排序后递归处理每个值
  const sortedKeys = Object.keys(value as Record<string, unknown>).sort()
  const pairs = sortedKeys
    .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
    .map((k) => {
      const v = (value as Record<string, unknown>)[k]
      return JSON.stringify(k) + ':' + sortedStringify(v)
    })
  return '{' + pairs.join(',') + '}'
}

/**
 * 计算工具调用的确定性字符串
 */
export function computeCallKey(toolName: string, input: unknown): string {
  const normalized = deterministicStringify(input)
  return `${toolName}:${normalized}`
}

/**
 * 计算输出的确定性字符串（排除时间戳等动态字段）
 */
export function computeOutputKey(output: unknown): string {
  if (output === null || output === undefined) {
    return String(output)
  }
  // 如果是对象，提取关键字段（排除时间戳、id 等动态字段）
  if (typeof output === 'object') {
    const obj = output as Record<string, unknown>
    const filtered: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(obj)) {
      // 排除常见动态字段
      if (['timestamp', 'time', 'date', 'id', 'requestId', 'traceId'].includes(key)) {
        continue
      }
      filtered[key] = value
    }
    return deterministicStringify(filtered)
  }
  return String(output)
}

/* AI end: 指纹计算函数结束 */