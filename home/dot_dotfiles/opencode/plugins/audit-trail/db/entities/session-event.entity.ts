import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm'

import type { ISessionEvent, SessionEventType } from '../types'

@Entity('session_events')
@Index(['timestamp'])
@Index(['sessionId', 'timestamp'])
export class SessionEvent implements ISessionEvent {
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
