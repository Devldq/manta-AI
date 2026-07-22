export interface StepUsageEvent {
  type: 'manta:step-usage'
  stepIndex: number
  usage: {
    inputTokens: number
    outputTokens: number
    cacheReadTokens?: number
    cacheWriteTokens?: number
    noCacheTokens?: number
  }
  toolNames?: string[]
}

function parseStepUsageEvent(block: string): StepUsageEvent | undefined {
  const payload = block
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n')
  if (!payload || payload === '[DONE]') return undefined
  try {
    const event = JSON.parse(payload) as Partial<StepUsageEvent>
    return event.type === 'manta:step-usage' ? event as StepUsageEvent : undefined
  } catch {
    return undefined
  }
}

/**
 * Extracts Manta-only telemetry events and removes them from the AI SDK stream.
 * DefaultChatTransport validates every data payload as UIMessageChunk, so a
 * telemetry event must never be forwarded to its parser.
 */
export function createStepUsageFilterStream(
  onStepUsage: (data: StepUsageEvent) => void,
): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  let buffer = ''

  const emitBlock = (block: string, delimiter: string, controller: TransformStreamDefaultController<Uint8Array>) => {
    const usage = parseStepUsageEvent(block)
    if (usage) {
      onStepUsage(usage)
      return
    }
    controller.enqueue(encoder.encode(block + delimiter))
  }

  const drain = (controller: TransformStreamDefaultController<Uint8Array>, flush: boolean) => {
    let boundary = /\r?\n\r?\n/.exec(buffer)
    while (boundary) {
      const block = buffer.slice(0, boundary.index)
      const delimiter = boundary[0]
      buffer = buffer.slice(boundary.index + delimiter.length)
      emitBlock(block, delimiter, controller)
      boundary = /\r?\n\r?\n/.exec(buffer)
    }
    if (flush && buffer) {
      emitBlock(buffer, '', controller)
      buffer = ''
    }
  }

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true })
      drain(controller, false)
    },
    flush(controller) {
      buffer += decoder.decode()
      drain(controller, true)
    },
  })
}

export function createStepUsageInterceptor(
  onStepUsage: (data: StepUsageEvent) => void,
): typeof globalThis.fetch {
  return async (input, init) => {
    const response = await globalThis.fetch(input, init)
    if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream')) return response

    return new Response(response.body.pipeThrough(createStepUsageFilterStream(onStepUsage)), {
      headers: response.headers,
      status: response.status,
      statusText: response.statusText,
    })
  }
}
