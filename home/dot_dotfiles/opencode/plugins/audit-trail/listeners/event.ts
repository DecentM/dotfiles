import { getSessionEventStore } from '../db/index'
import type { Hook } from '../types'

interface EventInput {
  event: {
    type: string
    properties?: Record<string, unknown>
  }
}

export const eventListener: Hook<'event'> =
  () =>
  async (input: EventInput): Promise<void> => {
    const store = await getSessionEventStore()

    // Extract sessionId from event properties if available
    const sessionId =
      (input.event.properties?.sessionId as string) ??
      (input.event.properties?.session_id as string) ??
      'unknown'

    await store.logSessionEvent({
      sessionId,
      eventType: 'event',
      details: JSON.stringify({
        eventType: input.event.type,
        properties: input.event.properties,
      }),
    })
  }
