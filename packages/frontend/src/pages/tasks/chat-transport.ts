import type { PrepareSendMessagesRequest, UIMessage } from 'ai'

/**
 * Conversation history is already durable on the Service. Sending only the
 * newest user message prevents persisted tool inputs/outputs from being
 * serialized into every subsequent request.
 */
export const prepareIncrementalChatRequest: PrepareSendMessagesRequest<UIMessage> = ({
  messages,
  body,
}) => {
  const message = [...messages].reverse().find((item) => item.role === 'user')

  return {
    body: {
      ...body,
      message,
    },
  }
}
