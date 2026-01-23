import { getSessionEventStore } from '../db/index'
import type { Hook } from '../types'

interface ChatParamsInput {
  sessionID: string
  agent: string
  model: unknown
  provider: unknown
  message: unknown
}

interface ChatParamsOutput {
  temperature: number
  topP: number
  topK: number
  options: Record<string, unknown>
}

export const chatParamsListener: Hook<'chat.params'> =
  () =>
  async (input: ChatParamsInput, output: ChatParamsOutput): Promise<void> => {
    const store = await getSessionEventStore()

    await store.logSessionEvent({
      sessionId: input.sessionID,
      eventType: 'chat_params',
      details: JSON.stringify({
        agent: input.agent,
        temperature: output.temperature,
        topP: output.topP,
        topK: output.topK,
        options: output.options,
      }),
    })
  }
