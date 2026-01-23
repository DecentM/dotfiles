import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm'

export type SessionEventType = 'created' | 'compacted' | 'deleted' | 'error' | 'idle'

@Entity('session_events')
@Index(['timestamp'])
@Index(['sessionId'])
@Index(['eventType'])
@Index(['sessionId', 'timestamp'])
export class SessionEvent {
  @PrimaryGeneratedColumn()
  id!: number

  @CreateDateColumn()
  timestamp!: Date

  @Column({ type: 'text' })
  @Index()
  sessionId!: string

  @Column({ type: 'text' })
  @Index()
  eventType!: SessionEventType

  @Column({ type: 'text', nullable: true })
  details!: string | null
}
