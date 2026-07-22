import { describe, expect, it, vi } from 'vitest'
import { createStepUsageFilterStream } from './step-usage-sse'

async function filterChunks(chunks: string[]) {
  const usage = vi.fn()
  const writerInput = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder()
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
  const output = writerInput.pipeThrough(createStepUsageFilterStream(usage))
  const text = await new Response(output).text()
  return { text, usage }
}

describe('step usage SSE filter', () => {
  it('extracts telemetry split across chunks without forwarding it to AI SDK', async () => {
    const validChunk = 'id: 1\ndata: {"type":"text-delta","id":"text-1","delta":"ok"}\n\n'
    const usageChunk = 'id: 2\ndata: {"type":"manta:step-usage","stepIndex":0,"usage":{"inputTokens":10,"outputTokens":2}}\n\n'

    const result = await filterChunks([
      validChunk + usageChunk.slice(0, 37),
      usageChunk.slice(37),
      'data: [DONE]\n\n',
    ])

    expect(result.text).toBe(validChunk + 'data: [DONE]\n\n')
    expect(result.text).not.toContain('manta:step-usage')
    expect(result.usage).toHaveBeenCalledOnce()
    expect(result.usage).toHaveBeenCalledWith(expect.objectContaining({ stepIndex: 0 }))
  })

  it('preserves ordinary SSE blocks byte-for-byte', async () => {
    const stream = 'id: 3\r\ndata: {"type":"finish","finishReason":"stop"}\r\n\r\n'
    const result = await filterChunks([stream])

    expect(result.text).toBe(stream)
    expect(result.usage).not.toHaveBeenCalled()
  })
})
