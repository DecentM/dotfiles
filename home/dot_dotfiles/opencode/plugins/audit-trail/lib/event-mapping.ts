/**
 * Event type mapping utilities.
 */

import type { SessionEventType } from '../types'

/**
 * Map SDK event types to our session event types.
 */
export const mapEventType = (eventType: string): SessionEventType | null => {
  const mapping: Record<string, SessionEventType> = {
    'session.created': 'created',
    'session.compacted': 'compacted',
    'session.deleted': 'deleted',
    'session.error': 'error',
    'session.idle': 'idle',
  }
  return mapping[eventType] ?? null
}
