import 'reflect-metadata'

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { DataSource, type DataSourceOptions } from 'typeorm'

import { SessionEvent } from './entities/session-event.entity'
import { ToolExecution } from './entities/tool-execution.entity'
import { InitialSchema1737619200000 } from './migrations/1737619200000-InitialSchema'

export type DatabaseType = 'sqlite' | 'mariadb' | 'postgres' | 'spanner'

const isDevMode = process.env.NODE_ENV !== 'production'

let dataSource: DataSource | null = null
let isInitializing = false
let initPromise: Promise<DataSource> | null = null

/**
 * Expand ~ to the user's home directory
 */
const expandPath = (filePath: string): string => {
  if (filePath.startsWith('~/')) {
    return path.join(os.homedir(), filePath.slice(2))
  }
  return filePath
}

/**
 * Get the SQLite database path, creating the directory if needed
 */
const getSqliteDatabasePath = (): string => {
  const defaultPath = path.join(os.homedir(), '.local', 'share', 'opencode', 'audit-trail.db')
  const dbPath = expandPath(process.env.AUDIT_DB_PATH ?? defaultPath)
  const dataDir = path.dirname(dbPath)

  // Ensure directory exists
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true })
  }

  return dbPath
}

/**
 * Build SQLite DataSource options
 */
const buildSqliteConfig = (): DataSourceOptions => ({
  type: 'better-sqlite3',
  database: getSqliteDatabasePath(),
  entities: [ToolExecution, SessionEvent],
  migrations: [InitialSchema1737619200000],
  synchronize: isDevMode,
  logging: false,
  migrationsRun: !isDevMode,
})

/**
 * Build MariaDB DataSource options
 */
const buildMariadbConfig = (): DataSourceOptions => ({
  type: 'mariadb',
  host: process.env.AUDIT_DB_HOST ?? 'localhost',
  port: Number.parseInt(process.env.AUDIT_DB_PORT ?? '3306', 10),
  username: process.env.AUDIT_DB_USERNAME ?? '',
  password: process.env.AUDIT_DB_PASSWORD ?? '',
  database: process.env.AUDIT_DB_DATABASE ?? 'audit_trail',
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
  database: process.env.AUDIT_DB_DATABASE ?? 'audit_trail',
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
  const dbType = (process.env.AUDIT_DB_TYPE ?? 'sqlite') as DatabaseType

  switch (dbType) {
    case 'sqlite':
      return buildSqliteConfig()

    case 'mariadb':
      return buildMariadbConfig()

    case 'postgres':
      return buildPostgresConfig()

    case 'spanner':
      throw new Error(
        'Spanner is not supported: TypeORM does not have a compatible Spanner driver. Consider using postgres or mariadb instead.'
      )

    default:
      throw new Error(
        `Unsupported database type: ${dbType}. Supported types: sqlite, mariadb, postgres`
      )
  }
}

const createDataSource = (): DataSource => {
  return new DataSource(buildDataSourceConfig())
}

/**
 * Get the DataSource instance, initializing it lazily on first access.
 * Returns a promise that resolves to the initialized DataSource.
 */
export const getDataSource = async (): Promise<DataSource> => {
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
