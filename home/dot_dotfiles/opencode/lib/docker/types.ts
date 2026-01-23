/**
 * Type definitions for the Docker library.
 * Provides types for container running and code execution.
 */

// =============================================================================
// Docker API Types
// =============================================================================

/**
 * Configuration for creating a container.
 */
export interface ContainerConfig {
  Image: string
  Cmd?: string[]
  Env?: string[]
  WorkingDir?: string
  User?: string
  HostConfig?: HostConfig
  NetworkingConfig?: NetworkingConfig
  Labels?: Record<string, string>
  Tty?: boolean
  OpenStdin?: boolean
  AttachStdin?: boolean
  AttachStdout?: boolean
  AttachStderr?: boolean
}

/**
 * Host-level configuration for a container.
 */
export interface HostConfig {
  Binds?: string[]
  Memory?: number
  NanoCpus?: number
  Privileged?: boolean
  NetworkMode?: string
  PortBindings?: Record<string, Array<{ HostPort: string }>>
  AutoRemove?: boolean
  RestartPolicy?: {
    Name: string
    MaximumRetryCount?: number
  }
}

/**
 * Network configuration for a container.
 */
export interface NetworkingConfig {
  EndpointsConfig?: Record<string, object>
}

/**
 * Configuration for executing a command in a running container.
 */
export interface ExecConfig {
  Cmd: string[]
  AttachStdin?: boolean
  AttachStdout?: boolean
  AttachStderr?: boolean
  Tty?: boolean
  Env?: string[]
  WorkingDir?: string
  User?: string
}

// =============================================================================
// Container Running Types
// =============================================================================

/**
 * Options for running a container.
 */
export interface RunContainerOptions {
  /** Docker image to use */
  image: string

  /** Code to pass to container stdin (optional) */
  code?: string

  /** Command to run (overrides image default) */
  cmd?: string[]

  /** Environment variables as KEY=VALUE strings */
  env?: string[]

  /** Working directory inside the container */
  workingDir?: string

  /** Memory limit (e.g., "512m", "1g"). Default: "512m" */
  memory?: string

  /** CPU limit (e.g., 1, 2). Default: 1 */
  cpus?: number

  /** Network mode. Default: "none" for isolation */
  networkMode?: string

  /** Timeout in milliseconds. Default: 30000 */
  timeout?: number

  /** Auto-remove container after exit. Default: true */
  autoRemove?: boolean

  /** Container name (optional, auto-generated if not provided) */
  name?: string
}

/**
 * Result from running a container.
 */
export interface RunContainerResult {
  /** Exit code from the container process */
  exitCode: number

  /** Standard output from the container */
  stdout: string

  /** Standard error from the container */
  stderr: string

  /** Duration in milliseconds */
  durationMs: number

  /** Whether the execution timed out */
  timedOut: boolean

  /** Container ID (useful for debugging) */
  containerId: string
}

/**
 * Result for formatting (extends RunContainerResult with runtime info).
 */
export interface ExecutionResult {
  /** Exit code from the container process */
  exitCode: number

  /** Standard output from the container */
  stdout: string

  /** Standard error from the container */
  stderr: string

  /** Duration in milliseconds */
  durationMs: number

  /** Whether the execution timed out */
  timedOut: boolean

  /** Runtime identifier (e.g., "node", "python", "tsx") */
  runtime?: string
}

// =============================================================================
// Docker API Response Types
// =============================================================================

/**
 * Generic Docker API response wrapper.
 */
export interface DockerApiResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
  statusCode?: number
}

/**
 * Container list item from Docker API.
 */
export interface Container {
  Id: string
  Names: string[]
  Image: string
  ImageID: string
  Command: string
  Created: number
  State: string
  Status: string
  Ports: Array<{
    IP?: string
    PrivatePort: number
    PublicPort?: number
    Type: string
  }>
  Labels: Record<string, string>
  Mounts: Array<{
    Type: string
    Source: string
    Destination: string
    Mode: string
    RW: boolean
  }>
}

/**
 * Container inspect result from Docker API.
 */
export interface ContainerInspect {
  Id: string
  Created: string
  Path: string
  Args: string[]
  State: {
    Status: string
    Running: boolean
    Paused: boolean
    Restarting: boolean
    OOMKilled: boolean
    Dead: boolean
    Pid: number
    ExitCode: number
    Error: string
    StartedAt: string
    FinishedAt: string
  }
  Image: string
  Name: string
  Config: {
    Hostname: string
    User: string
    Env: string[]
    Cmd: string[]
    Image: string
    WorkingDir: string
    Labels: Record<string, string>
  }
  HostConfig: {
    Binds: string[] | null
    Memory: number
    NanoCpus: number
    Privileged: boolean
    NetworkMode: string
  }
  NetworkSettings: {
    Networks: Record<
      string,
      {
        IPAddress: string
        Gateway: string
        MacAddress: string
      }
    >
  }
}

/**
 * Image list item from Docker API.
 */
export interface Image {
  Id: string
  ParentId: string
  RepoTags: string[] | null
  RepoDigests: string[] | null
  Created: number
  Size: number
  VirtualSize: number
  Labels: Record<string, string> | null
}

/**
 * Image inspect result from Docker API.
 */
export interface ImageInspect {
  Id: string
  RepoTags: string[]
  RepoDigests: string[]
  Parent: string
  Created: string
  Container: string
  Config: {
    Hostname: string
    User: string
    Env: string[]
    Cmd: string[] | null
    Entrypoint: string[] | null
    WorkingDir: string
    Labels: Record<string, string> | null
  }
  Architecture: string
  Os: string
  Size: number
  VirtualSize: number
}

/**
 * Response from container create API.
 */
export interface CreateContainerResponse {
  Id: string
  Warnings: string[]
}

/**
 * Response from exec create API.
 */
export interface ExecCreateResponse {
  Id: string
}

/**
 * Response from exec inspect API.
 */
export interface ExecInspectResponse {
  ExitCode: number
  Running: boolean
  Pid: number
}

/**
 * Response from container wait API.
 */
export interface WaitContainerResponse {
  StatusCode: number
  Error?: {
    Message: string
  }
}

// =============================================================================
// Build Types
// =============================================================================

/**
 * Options for building a Docker image.
 */
export interface BuildImageOptions {
  /** Path to Dockerfile relative to context (default: "Dockerfile") */
  dockerfile?: string

  /** Tag to apply to the built image (e.g., "myimage:latest") */
  tag?: string

  /** Use quiet mode - only return image ID (default: true) */
  quiet?: boolean

  /** Build arguments to pass to the build */
  buildArgs?: Record<string, string>
}
