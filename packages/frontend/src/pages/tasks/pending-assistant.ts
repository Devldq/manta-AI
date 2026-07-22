import type { UIMessage } from 'ai'

export function withPendingAssistantMessage(
  messages: UIMessage[],
  awaitingAssistant: boolean,
  conversationId: string,
): UIMessage[] {
  if (!awaitingAssistant || messages[messages.length - 1]?.role !== 'user') return messages

  return [
    ...messages,
    {
      id: `pending-assistant-${conversationId}`,
      role: 'assistant',
      parts: [],
    },
  ]
}
