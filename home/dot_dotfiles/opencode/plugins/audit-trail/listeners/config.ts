import { getSessionEventStore } from '../db/index'
import type { ConfigHook } from '../types'

export const configListener: ConfigHook =
  () =>
  async (input): Promise<void> => {
    const store = await getSessionEventStore()

    // Config hook is called once on plugin load with the full config
    // We log it as a session event with a synthetic session ID since no session exists yet
    await store.logSessionEvent({
      sessionId: 'system',
      eventType: 'config',
      details: JSON.stringify({
        mcp: input.mcp ? Object.keys(input.mcp) : [],
        providers: input.provider ? Object.keys(input.provider) : [],
        agents: input.agent ? Object.keys(input.agent) : [],
        models: input.model ? Object.keys(input.model) : [],
      }),
    })
  }
