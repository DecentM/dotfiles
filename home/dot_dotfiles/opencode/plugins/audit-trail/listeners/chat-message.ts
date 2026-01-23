import { getChatMessageStore } from '../db/index'
import type { Hook } from '../types'

interface ChatMessageInput {
  sessionID: string
  agent?: string
  model?: { providerID: string; modelID: string }
  messageID?: string
  variant?: string
}

interface ChatMessageOutput {
  message: unknown
  parts: unknown[]
}

export const chatMessageListener: Hook<'chat.message'> =
  () =>
  async (input: ChatMessageInput, output: ChatMessageOutput): Promise<void> => {
    const store = await getChatMessageStore()

    await store.logChatMessage({
      sessionId: input.sessionID,
      messageId: input.messageID,
      agent: input.agent,
      providerId: input.model?.providerID,
      modelId: input.model?.modelID,
      variant: input.variant,
      messageContent: JSON.stringify(output.message),
      partsJson: JSON.stringify(output.parts),
    })
  }
