/**
 * Barrel file for docker tool modules.
 * Re-exports all public APIs from the docker tool.
 */

// Client
export {
  // Types
  type Container,
  type ContainerInspect,
  createContainer,
  createVolume,
  type DockerApiResponse,
  execInContainer,
  getContainerLogs,
  type Image,
  type ImageInspect,
  inspectContainer,
  inspectImage,
  // Container operations
  listContainers,
  // Image operations
  listImages,
  // Network operations
  listNetworks,
  // Volume operations
  listVolumes,
  type Network,
  // Health
  ping,
  pullImage,
  removeContainer,
  removeImage,
  removeVolume,
  startContainer,
  stopContainer,
  type Volume,
} from './client'

// Permissions
export {
  buildOperationPattern,
  getPermissions,
  matchOperation,
} from './permissions'

// Types
export type {
  CompiledPermissionPattern,
  ConstraintConfig,
  ConstraintResult,
  ConstraintType,
  ContainerConfig,
  Decision,
  DockerOperationType,
  ExecConfig,
  HostConfig,
  LogEntry,
  MatchResult,
  PermissionPattern,
  PermissionsConfig,
  YamlRule,
} from './types'

// Utils
export {
  formatBytes,
  formatContainerName,
  formatTimestamp,
  parseSince,
  truncate,
} from './utils'

// Validators
export {
  matchesAnyPattern,
  patternToRegex,
  type ValidationContext,
  validateAllowedMounts,
  validateConstraint,
  validateConstraints,
  validateContainerPattern,
  validateImagePattern,
  validateNoHostNetwork,
  validateNoPrivileged,
  validateResourceLimits,
  validateYamlConfig,
  validateYamlRule,
} from './validators'
