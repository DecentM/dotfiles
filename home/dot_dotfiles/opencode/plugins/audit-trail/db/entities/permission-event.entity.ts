import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm'

import type { IPermissionEvent, PermissionStatus } from '../types'

@Entity('permission_events')
@Index(['timestamp'])
@Index(['sessionId'])
@Index(['status'])
@Index(['sessionId', 'timestamp'])
export class PermissionEvent implements IPermissionEvent {
  @PrimaryGeneratedColumn()
  id!: number

  @CreateDateColumn()
  timestamp!: Date

  @Column({ type: 'text' })
  @Index()
  sessionId!: string

  @Column({ type: 'text' })
  permissionType!: string

  @Column({ type: 'text', nullable: true })
  resource!: string | null

  @Column({ type: 'text' })
  @Index()
  status!: PermissionStatus

  @Column({ type: 'text', nullable: true })
  detailsJson!: string | null
}
