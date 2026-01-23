import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm'

import type { IChatMessage } from '../types'

@Entity('chat_messages')
@Index(['timestamp'])
@Index(['sessionId'])
@Index(['sessionId', 'timestamp'])
export class ChatMessage implements IChatMessage {
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
  agent!: string | null

  @Column({ type: 'text', nullable: true })
  providerId!: string | null

  @Column({ type: 'text', nullable: true })
  modelId!: string | null

  @Column({ type: 'text', nullable: true })
  variant!: string | null

  @Column({ type: 'text', nullable: true })
  messageContent!: string | null

  @Column({ type: 'text', nullable: true })
  partsJson!: string | null
}
