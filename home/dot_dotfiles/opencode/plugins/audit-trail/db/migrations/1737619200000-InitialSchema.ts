import type { MigrationInterface, QueryRunner } from 'typeorm'
import { Table, TableIndex } from 'typeorm'

export class InitialSchema1737619200000 implements MigrationInterface {
  name = 'InitialSchema1737619200000'

  async up(queryRunner: QueryRunner): Promise<void> {
    // Create tool_executions table
    await queryRunner.createTable(
      new Table({
        name: 'tool_executions',
        columns: [
          {
            name: 'id',
            type: 'integer',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'increment',
          },
          {
            name: 'timestamp',
            type: 'datetime',
            default: 'CURRENT_TIMESTAMP',
          },
          {
            name: 'sessionId',
            type: 'text',
            isNullable: false,
          },
          {
            name: 'messageId',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'callId',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'toolName',
            type: 'text',
            isNullable: false,
          },
          {
            name: 'agentId',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'arguments',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'decision',
            type: 'text',
            isNullable: false,
          },
          {
            name: 'resultSummary',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'durationMs',
            type: 'integer',
            isNullable: true,
          },
        ],
      }),
      true
    )

    // Create indices for tool_executions
    await queryRunner.createIndex(
      'tool_executions',
      new TableIndex({
        name: 'IDX_tool_executions_timestamp',
        columnNames: ['timestamp'],
      })
    )

    await queryRunner.createIndex(
      'tool_executions',
      new TableIndex({
        name: 'IDX_tool_executions_sessionId',
        columnNames: ['sessionId'],
      })
    )

    await queryRunner.createIndex(
      'tool_executions',
      new TableIndex({
        name: 'IDX_tool_executions_toolName',
        columnNames: ['toolName'],
      })
    )

    await queryRunner.createIndex(
      'tool_executions',
      new TableIndex({
        name: 'IDX_tool_executions_decision',
        columnNames: ['decision'],
      })
    )

    // Create session_events table
    await queryRunner.createTable(
      new Table({
        name: 'session_events',
        columns: [
          {
            name: 'id',
            type: 'integer',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'increment',
          },
          {
            name: 'timestamp',
            type: 'datetime',
            default: 'CURRENT_TIMESTAMP',
          },
          {
            name: 'sessionId',
            type: 'text',
            isNullable: false,
          },
          {
            name: 'eventType',
            type: 'text',
            isNullable: false,
          },
          {
            name: 'details',
            type: 'text',
            isNullable: true,
          },
        ],
      }),
      true
    )

    // Create indices for session_events
    await queryRunner.createIndex(
      'session_events',
      new TableIndex({
        name: 'IDX_session_events_timestamp',
        columnNames: ['timestamp'],
      })
    )

    await queryRunner.createIndex(
      'session_events',
      new TableIndex({
        name: 'IDX_session_events_sessionId',
        columnNames: ['sessionId'],
      })
    )

    await queryRunner.createIndex(
      'session_events',
      new TableIndex({
        name: 'IDX_session_events_eventType',
        columnNames: ['eventType'],
      })
    )
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // Drop indices for session_events
    await queryRunner.dropIndex('session_events', 'IDX_session_events_eventType')
    await queryRunner.dropIndex('session_events', 'IDX_session_events_sessionId')
    await queryRunner.dropIndex('session_events', 'IDX_session_events_timestamp')

    // Drop session_events table
    await queryRunner.dropTable('session_events')

    // Drop indices for tool_executions
    await queryRunner.dropIndex('tool_executions', 'IDX_tool_executions_decision')
    await queryRunner.dropIndex('tool_executions', 'IDX_tool_executions_toolName')
    await queryRunner.dropIndex('tool_executions', 'IDX_tool_executions_sessionId')
    await queryRunner.dropIndex('tool_executions', 'IDX_tool_executions_timestamp')

    // Drop tool_executions table
    await queryRunner.dropTable('tool_executions')
  }
}
