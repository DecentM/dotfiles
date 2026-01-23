/**
 * Docker library for container operations and code execution.
 * Uses socket-based communication with the Docker daemon.
 */

// =============================================================================
// Types
// =============================================================================

export type {
  BuildImageOptions,
  Container,
  // Re-exported from tools/docker
  ContainerConfig,
  ContainerInspect,
  CreateContainerResponse,
  // Docker API types
  DockerApiResponse,
  ExecConfig,
  ExecCreateResponse,
  ExecInspectResponse,
  ExecutionResult,
  HostConfig,
  Image,
  ImageInspect,
  NetworkingConfig,
  // Container running types
  RunContainerOptions,
  RunContainerResult,
  WaitContainerResponse,
} from './types'

// =============================================================================
// Client Functions
// =============================================================================

export {
  // Image build
  buildImage,
  createContainer,
  // Core fetch
  dockerFetch,
  // Exec operations
  execCreate,
  execInspect,
  execStart,
  getContainerLogs,
  getContainerLogsSeparated,
  inspectContainer,
  inspectImage,
  // Container operations
  listContainers,
  // Image operations
  listImages,
  parseDockerLogsSeparated,
  // Health check
  ping,
  pullImage,
  removeContainer,
  startContainer,
  stopContainer,
  // Log processing
  stripDockerLogHeaders,
  waitContainer,
} from './client'

// =============================================================================
// Container Runner
// =============================================================================

export { runContainer } from './runner'

// =============================================================================
// Formatting Utilities
// =============================================================================

export {
  formatErrorResult,
  formatExecutionResult,
  formatNoCodeError,
  truncateOutput,
} from './format'
