import type { Plugin } from '@opencode-ai/plugin'
import * as listeners from './listeners'
import * as tools from './tools/index'

const AuditTrailPlugin: Plugin = async (ctx) => {
  return {
    tool: tools,
    event: listeners.eventListener(ctx.client),
    config: listeners.configListener(ctx.client),
    'chat.message': listeners.chatMessageListener(ctx.client),
    'chat.params': listeners.chatParamsListener(ctx.client),
    'chat.headers': listeners.chatHeadersListener(ctx.client),
    'permission.ask': listeners.permissionAskListener(ctx.client),
    'command.execute.before': listeners.commandExecuteBeforeListener(ctx.client),
    'tool.execute.before': listeners.toolExecuteBeforeListener(ctx.client),
    'tool.execute.after': listeners.toolExecuteAfterListener(ctx.client),
  }
}

export default AuditTrailPlugin
