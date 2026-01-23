import type { MigrationInterface, QueryRunner } from 'typeorm'
import { Table, TableIndex } from 'typeorm'

export class AddNewEntities1737705600000 implements MigrationInterface {
  name = 'AddNewEntities1737705600000'

  async up(queryRunner: QueryRunner): Promise<void> {
    // Create chat_messages table
    await queryRunner.createTable(
      new Table({
        name: 'chat_messages',
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
            name: 'agent',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'providerId',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'modelId',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'variant',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'messageContent',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'partsJson',
            type: 'text',
            isNullable: true,
          },
        ],
      }),
      true
    )

    // Create indices for chat_messages
    await queryRunner.createIndex(
      'chat_messages',
      new TableIndex({
        name: 'IDX_chat_messages_timestamp',
        columnNames: ['timestamp'],
      })
    )

    await queryRunner.createIndex(
      'chat_messages',
      new TableIndex({
        name: 'IDX_chat_messages_sessionId',
        columnNames: ['sessionId'],
      })
    )

    // Create permission_events table
    await queryRunner.createTable(
      new Table({
        name: 'permission_events',
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
            name: 'permissionType',
            type: 'text',
            isNullable: false,
          },
          {
            name: 'resource',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'status',
            type: 'text',
            isNullable: false,
          },
          {
            name: 'detailsJson',
            type: 'text',
            isNullable: true,
          },
        ],
      }),
      true
    )

    // Create indices for permission_events
    await queryRunner.createIndex(
      'permission_events',
      new TableIndex({
        name: 'IDX_permission_events_timestamp',
        columnNames: ['timestamp'],
      })
    )

    await queryRunner.createIndex(
      'permission_events',
      new TableIndex({
        name: 'IDX_permission_events_sessionId',
        columnNames: ['sessionId'],
      })
    )

    await queryRunner.createIndex(
      'permission_events',
      new TableIndex({
        name: 'IDX_permission_events_status',
        columnNames: ['status'],
      })
    )

    // Create command_executions table
    await queryRunner.createTable(
      new Table({
        name: 'command_executions',
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
            name: 'command',
            type: 'text',
            isNullable: false,
          },
          {
            name: 'arguments',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'partsJson',
            type: 'text',
            isNullable: true,
          },
        ],
      }),
      true
    )

    // Create indices for command_executions
    await queryRunner.createIndex(
      'command_executions',
      new TableIndex({
        name: 'IDX_command_executions_timestamp',
        columnNames: ['timestamp'],
      })
    )

    await queryRunner.createIndex(
      'command_executions',
      new TableIndex({
        name: 'IDX_command_executions_sessionId',
        columnNames: ['sessionId'],
      })
    )

    await queryRunner.createIndex(
      'command_executions',
      new TableIndex({
        name: 'IDX_command_executions_command',
        columnNames: ['command'],
      })
    )
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // Drop indices for command_executions
    await queryRunner.dropIndex('command_executions', 'IDX_command_executions_command')
    await queryRunner.dropIndex('command_executions', 'IDX_command_executions_sessionId')
    await queryRunner.dropIndex('command_executions', 'IDX_command_executions_timestamp')

    // Drop command_executions table
    await queryRunner.dropTable('command_executions')

    // Drop indices for permission_events
    await queryRunner.dropIndex('permission_events', 'IDX_permission_events_status')
    await queryRunner.dropIndex('permission_events', 'IDX_permission_events_sessionId')
    await queryRunner.dropIndex('permission_events', 'IDX_permission_events_timestamp')

    // Drop permission_events table
    await queryRunner.dropTable('permission_events')

    // Drop indices for chat_messages
    await queryRunner.dropIndex('chat_messages', 'IDX_chat_messages_sessionId')
    await queryRunner.dropIndex('chat_messages', 'IDX_chat_messages_timestamp')

    // Drop chat_messages table
    await queryRunner.dropTable('chat_messages')
  }
}
