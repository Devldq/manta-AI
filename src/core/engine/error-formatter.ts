/**
 * AI SDK 错误美化工具
 * 将技术错误信息转换为用户友好的中文提示，并给出可操作的建议
 */

export interface ErrorInfo {
  /** 用户友好的错误标题 */
  title: string
  /** 详细提示（可包含多行） */
  message: string
  /** 建议操作 */
  suggestion?: string
}

/**
 * 从错误对象中读取 cause.code（支持 AggregateError 嵌套）
 */
function getCauseCode(err: unknown): string {
  const cause = (err as Record<string, unknown>).cause as Error | Record<string, unknown> | undefined
  if (!cause) return ''
  if (cause instanceof Error && cause.message) return cause.message
  const code = (cause as Record<string, unknown>).code
  if (typeof code === 'string') return code
  // AggregateError 可能还有内层 cause
  if (typeof cause === 'object') return getCauseCode(cause)
  return ''
}

/**
 * 解析 AI SDK 错误，返回用户友好的错误信息
 */
export function formatAIError(err: unknown): ErrorInfo {
  const error = err instanceof Error ? err : new Error(String(err))
  const errRecord = error as Record<string, unknown>

  // ─── RetryError（重试耗尽，AI SDK v4=AI_RetryError, v5+=RetryError）──
  const hasLastError = errRecord.lastError !== undefined
  const isRetryName = error.name === 'RetryError' || error.name === 'AI_RetryError'
  const hasReason = errRecord.reason === 'maxRetriesExceeded'

  if (hasLastError || isRetryName || hasReason) {
    const lastError = errRecord.lastError as Error | undefined
    if (lastError) {
      // 递归处理底层错误
      return formatAIError(lastError)
    }
    return {
      title: '⚠️ 模型请求失败',
      message: '已重试 3 次但仍未成功，请检查模型服务是否正常运行。',
      suggestion: '请检查模型配置，或尝试切换其他模型。',
    }
  }

  // ─── API 调用错误（AI SDK v4=AI_APICallError, v5+=APICallError）──────────
  // 特征：有 url / statusCode / responseBody
  const isApiCallName = error.name === 'APICallError' || error.name === 'AI_APICallError'
  const hasUrl = 'url' in errRecord
  const hasStatusCode = errRecord.statusCode !== undefined

  if (isApiCallName || hasUrl || hasStatusCode) {
    const statusCode = errRecord.statusCode as number | undefined
    const responseBody = (errRecord.responseBody ?? '') as string
    const url = (errRecord.url ?? '') as string

    // 优先检查 cause（底层网络错误，如 ECONNREFUSED）
    const causeCode = getCauseCode(err)

    // 检查 cause 中的网络错误
    if (causeCode.includes('ECONNREFUSED') || causeCode.includes('ECONNRESET')) {
      if (url.includes('11434') || url.toLowerCase().includes('ollama')) {
        return {
          title: '🔴 Ollama 服务未启动',
          message: '无法连接到 Ollama（localhost:11434）。\n'
            + '可能原因：Ollama 未安装、未启动，或端口被占用。',
          suggestion: '请在终端执行 ollama serve，或打开 Ollama 桌面应用。',
        }
      }
      return {
        title: '🔴 无法连接到模型服务',
        message: '连接被拒绝，请检查模型服务的地址和端口是否正确。',
        suggestion: '请前往设置页面检查 baseUrl 配置。',
      }
    }

    // 如果 cause 为空，但错误消息包含连接相关关键词，也从 url 判断
    const errMsgLower = error.message.toLowerCase()
    if (causeCode === '' && (errMsgLower.includes('cannot connect') || errMsgLower.includes('failed to fetch'))) {
      if (url.includes('11434') || url.toLowerCase().includes('ollama')) {
        return {
          title: '🔴 Ollama 服务未启动',
          message: '无法连接到 Ollama（localhost:11434）。\n'
            + '可能原因：Ollama 未安装、未启动，或端口被占用。',
          suggestion: '请在终端执行 ollama serve，或打开 Ollama 桌面应用。',
        }
      }
      return {
        title: '🔴 无法连接到模型服务',
        message: `无法连接到模型服务：${url}\n请检查服务是否正在运行。`,
        suggestion: '请前往设置页面检查 baseUrl 配置，或确认模型服务已启动。',
      }
    }

    if (causeCode.includes('ETIMEDOUT') || causeCode.includes('ECONNABORTED')) {
      return {
        title: '⏱️ 请求超时',
        message: '模型服务响应超时。\n'
          + '可能原因：模型正在加载、网络不稳定，或模型过大。',
        suggestion: '请稍后重试，或尝试使用更小的模型。',
      }
    }

    if (statusCode != null) {
      if (statusCode === 400) {
        if (responseBody?.includes('reasoning_content')) {
          return {
            title: '⚠️ 模型参数错误',
            message: 'MiMo 模型要求在多轮对话中回传 reasoning_content 字段。',
            suggestion: '请检查模型配置中的 baseUrl 是否包含 "xiaomimimo.com"。',
          }
        }
        return {
          title: '⚠️ 请求参数错误（400）',
          message: responseBody ? `模型返回：${responseBody}` : error.message,
          suggestion: '请检查模型配置是否正确，或尝试切换其他模型。',
        }
      }
      if (statusCode === 401) {
        return {
          title: '🔐 API 密钥错误（401）',
          message: '模型服务的 API 密钥无效或已过期。',
          suggestion: '请前往设置页面检查 API Key 是否正确。',
        }
      }
      if (statusCode === 429) {
        return {
          title: '🚦 请求频率过高（429）',
          message: '模型服务的请求频率超限，请稍后再试。',
          suggestion: '请等待几秒后重试，或升级模型服务配额。',
        }
      }
      if (statusCode >= 500) {
        return {
          title: `❌ 模型服务异常（${statusCode}）`,
          message: '模型服务端出现错误，暂时无法处理请求。',
          suggestion: '请稍后重试，或切换其他模型。',
        }
      }
    }
  }

  // ─── 兜底：检查错误消息中的关键词 ───────────────────────
  const errMsg = error.message.toLowerCase()

  if (errMsg.includes('econnrefused') || getCauseCode(err).includes('ECONNREFUSED')) {
    return {
      title: '🔴 无法连接到模型服务',
      message: '连接被拒绝，请检查模型服务是否正在运行。',
      suggestion: '请检查模型配置，或尝试切换其他模型。',
    }
  }

  if (errMsg.includes('timeout') || errMsg.includes('etimedout')) {
    return {
      title: '⏱️ 请求超时',
      message: '模型服务响应超时，请稍后重试。',
      suggestion: '如果问题持续，请尝试使用更小的模型。',
    }
  }

  if (errMsg.includes('enotfound') || errMsg.includes('eai_again')) {
    return {
      title: '🌐 网络无法连接',
      message: '无法解析模型服务的域名，请检查网络连接。',
      suggestion: '请检查网络代理设置，或确认 baseUrl 是否正确。',
    }
  }

  if (errMsg.includes('abort') || errMsg.includes('aborted')) {
    return {
      title: '⏹️ 已停止生成',
      message: '你主动中断了模型的回复。',
    }
  }

  // ─── 最终兜底 ─────────────────────────────────────────────
  const cleanMessage = error.message
    .replace(/^Error:\s*/, '')
    .replace(/Cannot connect to API:\s*$/, '无法连接到模型服务')

  return {
    title: '❌ 出错了',
    message: cleanMessage || '未知错误，请重试。',
    suggestion: '如果问题持续出现，请尝试切换模型或联系开发者。',
  }
}

/**
 * 将 ErrorInfo 格式化为文本（用于 SSE 传输）
 */
export function formatErrorForSSE(info: ErrorInfo): string {
  const parts = [info.title]
  if (info.message) parts.push(info.message)
  if (info.suggestion) parts.push(`💡 ${info.suggestion}`)
  return parts.join('\n\n')
}
