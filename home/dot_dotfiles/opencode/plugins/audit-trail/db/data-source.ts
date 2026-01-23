import 'reflect-metadata'

import { DataSource, type DataSourceOptions } from 'typeorm'

import { SessionEvent } from './entities/session-event.entity'
import { ToolExecution } from './entities/tool-execution.entity'
import { isDatabaseConfigured } from './memory-store'
import { InitialSchema1737619200000 } from './migrations/1737619200000-InitialSchema'

export type DatabaseType = 'mariadb' | 'postgres'

const isDevMode = process.env.NODE_ENV !== 'production'

let dataSource: DataSource | null = null
let isInitializing = false
let initPromise: Promise<DataSource> | null = null

/**
 * Build MariaDB DataSource options
 */
const buildMariadbConfig = (): DataSourceOptions => ({
  type: 'mariadb',
  host: process.env.AUDIT_DB_HOST ?? 'localhost',
  port: Number.parseInt(process.env.AUDIT_DB_PORT ?? '3306', 10),
  username: process.env.AUDIT_DB_USERNAME ?? '',
  password: process.env.AUDIT_DB_PASSWORD ?? '',
  database: process.env.AUDIT_DB_DATABASE ?? 'opencode_audit',
  entities: [ToolExecution, SessionEvent],
  migrations: [InitialSchema1737619200000],
  synchronize: isDevMode,
  logging: false,
  migrationsRun: !isDevMode,
})

/**
 * Build PostgreSQL DataSource options
 */
const buildPostgresConfig = (): DataSourceOptions => ({
  type: 'postgres',
  host: process.env.AUDIT_DB_HOST ?? 'localhost',
  port: Number.parseInt(process.env.AUDIT_DB_PORT ?? '5432', 10),
  username: process.env.AUDIT_DB_USERNAME ?? '',
  password: process.env.AUDIT_DB_PASSWORD ?? '',
  database: process.env.AUDIT_DB_DATABASE ?? 'opencode_audit',
  entities: [ToolExecution, SessionEvent],
  migrations: [InitialSchema1737619200000],
  synchronize: isDevMode,
  logging: false,
  migrationsRun: !isDevMode,
})

/**
 * Build DataSource options based on AUDIT_DB_TYPE environment variable
 */
const buildDataSourceConfig = (): DataSourceOptions => {
  const dbType = (process.env.AUDIT_DB_TYPE ?? 'postgres') as DatabaseType

  switch (dbType) {
    case 'mariadb':
      return buildMariadbConfig()

    case 'postgres':
      return buildPostgresConfig()

    default:
      throw new Error(`Unsupported database type: ${dbType}. Supported types: postgres, mariadb`)
  }
}

const createDataSource = (): DataSource => {
  return new DataSource(buildDataSourceConfig())
}

/**
 * Get the DataSource instance, initializing it lazily on first access.
 * Returns null if database is not configured (callers should use memory store).
 * Returns a promise that resolves to the initialized DataSource when configured.
 */
export const getDataSource = async (): Promise<DataSource | null> => {
  // Check if database is configured
  if (!isDatabaseConfigured()) {
    return null
  }

  // Return existing initialized connection
  if (dataSource?.isInitialized) {
    return dataSource
  }

  // Return pending initialization
  if (isInitializing && initPromise) {
    return initPromise
  }

  // Start initialization
  isInitializing = true
  initPromise = (async () => {
    try {
      dataSource = createDataSource()
      await dataSource.initialize()
      return dataSource
    } catch (error) {
      isInitializing = false
      initPromise = null
      dataSource = null
      throw error
    }
  })()

  return initPromise
}

/**
 * Close the DataSource connection gracefully.
 */
export const closeDataSource = async (): Promise<void> => {
  if (dataSource?.isInitialized) {
    await dataSource.destroy()
    dataSource = null
    initPromise = null
  }
}

// Graceful shutdown handlers
const handleShutdown = async () => {
  await closeDataSource()
}

// Register shutdown handlers
process.on('SIGINT', handleShutdown)
process.on('SIGTERM', handleShutdown)
