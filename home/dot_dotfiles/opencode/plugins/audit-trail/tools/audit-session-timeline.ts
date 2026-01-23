import { tool } from '@opencode-ai/plugin'
import type { SessionEvent } from '../db/entities/session-event.entity'
import type { ToolExecution } from '../db/entities/tool-execution.entity'
import { getSessionEventStore } from '../db/index'
import type { TimelineEntry } from '../db/repositories/session-event.repository'
import { formatDuration, formatTime } from '../lib'

const formatToolDetails = (execution: ToolExecution): string => {
  const duration = formatDuration(execution.durationMs)
  return `${execution.decision} (${duration})`
}

const formatSessionDetails = (event: SessionEvent): string => {
  return event.details ?? '-'
}

const formatTimelineEntry = (entry: TimelineEntry): string => {
  const time = formatTime(entry.timestamp)
  const type = entry.type

  if (type === 'tool') {
    const execution = entry.data as ToolExecution
    return `| ${time} | tool | ${execution.toolName} | ${formatToolDetails(execution)} |`
  }

  const event = entry.data as SessionEvent
  return `| ${time} | session | ${event.eventType} | ${formatSessionDetails(event)} |`
}

const formatTimeline = (timeline: TimelineEntry[], sessionId: string): string => {
  if (timeline.length === 0) {
    return `## Session Timeline: ${sessionId}\n\nNo events found for this session.`
  }

  const header = `## Session Timeline: ${sessionId}

| Time | Type | Tool/Event | Details |
|------|------|------------|---------|`

  const rows = timeline.map(formatTimelineEntry).join('\n')

  return `${header}\n${rows}`
}

export const audit_session_timeline = tool({
  description: 'Get timeline of all events for a specific session. Required param: session_id',
  args: {
    session_id: tool.schema.string().describe('The session ID to get timeline for (required)'),
  },
  async execute(args) {
    try {
      if (!args.session_id) {
        return 'Error: session_id is required'
      }
      const store = await getSessionEventStore()
      const timeline = await store.getSessionTimeline(args.session_id)
      return formatTimeline(timeline, args.session_id)
    } catch (error) {
      return `Error: Failed to get session timeline: ${error instanceof Error ? error.message : String(error)}`
    }
  },
})
