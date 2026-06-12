/** 默认执行结果最大字符数 */
export const DEFAULT_MAX_RESULT_CHARS = 3000;

/**
 * 截断工具执行结果，防止超大输出撑爆上下文
 * 策略：保留前 60% + 省略提示 + 后 40%
 */
export function truncateResult(
  text: string,
  maxChars: number = DEFAULT_MAX_RESULT_CHARS
): string {
  if (text.length <= maxChars) return text;

  const headSize = Math.floor(maxChars * 0.6);
  const tailSize = maxChars - headSize;
  const head = text.slice(0, headSize);
  const tail = text.slice(-tailSize);
  const dropped = text.length - headSize - tailSize;

  return `${head}\n\n... [省略 ${dropped} 字符] ...\n\n${tail}`;
}
