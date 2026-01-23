import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm'

export type ToolExecutionDecision = 'started' | 'completed' | 'failed'

@Entity('tool_executions')
@Index(['timestamp'])
@Index(['sessionId'])
@Index(['toolName'])
@Index(['decision'])
@Index(['sessionId', 'timestamp'])
export class ToolExecution {
  @PrimaryGeneratedColumn()
  id!: number

  @CreateDateColumn()
  timestamp!: Date

  @Column({ type: 'text' })
  @Index()
  sessionId!: string

  @Column({ type: 'text', nullable: true })
  messageId!: string | null

  @Column({ type: 'text', nullable: true })
  callId!: string | null

  @Column({ type: 'text' })
  @Index()
  toolName!: string

  @Column({ type: 'text', nullable: true })
  agentId!: string | null

  @Column({ type: 'text', nullable: true })
  arguments!: string | null

  @Column({ type: 'text' })
  @Index()
  decision!: ToolExecutionDecision

  @Column({ type: 'text', nullable: true })
  resultSummary!: string | null

  @Column({ type: 'integer', nullable: true })
  durationMs!: number | null
}
