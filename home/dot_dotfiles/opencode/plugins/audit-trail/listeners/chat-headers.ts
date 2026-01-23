import { getSessionEventStore } from '../db/index'
import type { Hook } from '../types'

interface ChatHeadersInput {
  sessionID: string
  agent: string
  model: unknown
  provider: unknown
  message: unknown
}

interface ChatHeadersOutput {
  headers: Record<string, string>
}

export const chatHeadersListener: Hook<'chat.headers'> =
  () =>
  async (input: ChatHeadersInput, output: ChatHeadersOutput): Promise<void> => {
    const store = await getSessionEventStore()

    // Only log if there are custom headers being set
    const headerCount = Object.keys(output.headers).length
    if (headerCount === 0) {
      return
    }

    await store.logSessionEvent({
      sessionId: input.sessionID,
      eventType: 'chat_headers',
      details: JSON.stringify({
        agent: input.agent,
        headerCount,
        // Don't log actual header values as they may contain sensitive data
        headerNames: Object.keys(output.headers),
      }),
    })
  }
