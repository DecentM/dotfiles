import { getPermissionEventStore } from '../db/index'
import type { Hook } from '../types'

interface PermissionInput {
  sessionID: string
  type: string
  resource?: string
  action?: string
  [key: string]: unknown
}

interface PermissionOutput {
  status: 'ask' | 'deny' | 'allow'
}

export const permissionAskListener: Hook<'permission.ask'> =
  () =>
  async (input: PermissionInput, output: PermissionOutput): Promise<void> => {
    const store = await getPermissionEventStore()

    await store.logPermissionEvent({
      sessionId: input.sessionID,
      permissionType: input.type,
      resource: input.resource ?? input.action,
      status: output.status,
      detailsJson: JSON.stringify(input),
    })
  }
