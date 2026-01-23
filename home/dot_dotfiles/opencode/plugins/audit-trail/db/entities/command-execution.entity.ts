import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm'

@Entity('command_executions')
@Index(['timestamp'])
@Index(['sessionId'])
@Index(['command'])
@Index(['sessionId', 'timestamp'])
export class CommandExecution {
  @PrimaryGeneratedColumn()
  id!: number

  @CreateDateColumn()
  timestamp!: Date

  @Column({ type: 'text' })
  @Index()
  sessionId!: string

  @Column({ type: 'text' })
  @Index()
  command!: string

  @Column({ type: 'text', nullable: true })
  arguments!: string | null

  @Column({ type: 'text', nullable: true })
  partsJson!: string | null
}
