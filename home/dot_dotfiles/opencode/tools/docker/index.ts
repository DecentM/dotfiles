/**
 * Barrel file for docker tool modules.
 * Re-exports all public APIs from the docker tool.
 */

// Client
export {
  // Container operations
  listContainers,
  inspectContainer,
  createContainer,
  startContainer,
  stopContainer,
  removeContainer,
  getContainerLogs,
  execInContainer,
  // Image operations
  listImages,
  pullImage,
  inspectImage,
  removeImage,
  // Volume operations
  listVolumes,
  createVolume,
  removeVolume,
  // Network operations
  listNetworks,
  // Health
  ping,
  // Types
  type Container,
  type ContainerInspect,
  type Image,
  type ImageInspect,
  type Volume,
  type Network,
  type DockerApiResponse,
} from "./client";

// Database
export { dbManager, logOperation, updateLogEntry } from "./db";

// Permissions
export { getPermissions, matchOperation, buildOperationPattern } from "./permissions";

// Tools
export { docker_stats, docker_export_logs } from "./tools";

// Types
export type {
  CompiledPermissionPattern,
  ConstraintConfig,
  ConstraintResult,
  ConstraintType,
  ContainerConfig,
  Decision,
  ExecConfig,
  HostConfig,
  LogEntry,
  MatchResult,
  PermissionPattern,
  PermissionsConfig,
  YamlRule,
  DockerOperationType,
} from "./types";

// Utils
export { parseSince, formatBytes, formatTimestamp, truncate, formatContainerName } from "./utils";

// Validators
export {
  patternToRegex,
  matchesAnyPattern,
  validateConstraint,
  validateYamlRule,
  validateYamlConfig,
  validateNoPrivileged,
  validateNoHostNetwork,
  validateAllowedMounts,
  validateImagePattern,
  validateContainerPattern,
  validateResourceLimits,
  validateConstraints,
  type ValidationContext,
} from "./validators";
