/**
 * Docker socket client for the docker tool.
 *
 * @deprecated For new code, prefer importing from '../../lib/docker/client' directly.
 * This module re-exports from lib/docker/client for backward compatibility and adds
 * tool-specific functions (volume/network operations, execInContainer).
 */

// =============================================================================
// Re-exports from lib/docker/client
// =============================================================================

// Core fetch helper and container operations
export {
  dockerFetch,
  listContainers,
  inspectContainer,
  createContainer,
  startContainer,
  stopContainer,
  removeContainer,
  // Exec operations (with original names for backward compat)
  execCreate as createExec,
  execStart as startExec,
  execInspect as inspectExec,
  // Image operations
  listImages,
  pullImage,
  inspectImage,
  // Health check
  ping,
  // Log processing helpers
  stripDockerLogHeaders,
} from "../../lib/docker/client";

// =============================================================================
// Re-exports from lib/docker/types
// =============================================================================

export type {
  DockerApiResponse,
  Container,
  ContainerInspect,
  Image,
  ImageInspect,
  CreateContainerResponse,
  ExecCreateResponse,
  ExecInspectResponse,
} from "../../lib/docker/types";

// =============================================================================
// Tool-specific types (not in lib)
// =============================================================================

export interface Volume {
  Name: string;
  Driver: string;
  Mountpoint: string;
  CreatedAt: string;
  Status: Record<string, string>;
  Labels: Record<string, string>;
  Scope: string;
  Options: Record<string, string> | null;
}

export interface Network {
  Name: string;
  Id: string;
  Created: string;
  Scope: string;
  Driver: string;
  EnableIPv6: boolean;
  IPAM: {
    Driver: string;
    Options: Record<string, string> | null;
    Config: Array<{
      Subnet: string;
      Gateway: string;
    }>;
  };
  Internal: boolean;
  Attachable: boolean;
  Ingress: boolean;
  Options: Record<string, string>;
  Labels: Record<string, string>;
}

// =============================================================================
// Imports for local use
// =============================================================================

import {
  dockerFetch,
  execCreate,
  execStart,
  execInspect,
} from "../../lib/docker/client";

import type { DockerApiResponse } from "../../lib/docker/types";

// =============================================================================
// Tool-specific: Container logs (backward-compatible signature)
// =============================================================================

/**
 * Get container logs.
 * @deprecated Use getContainerLogs from lib/docker/client with options object instead.
 * @param id - Container ID or name
 * @param tail - Number of lines from the end (default 100)
 * @param timestamps - Include timestamps
 */
export const getContainerLogs = async (
  id: string,
  tail = 100,
  timestamps = false
): Promise<DockerApiResponse<string>> => {
  // Import dynamically to use the lib version with options object
  const { getContainerLogs: libGetContainerLogs } = await import("../../lib/docker/client");
  return libGetContainerLogs(id, { tail, timestamps });
};

// =============================================================================
// Tool-specific: Exec convenience function
// =============================================================================

/**
 * Execute a command in a container and wait for completion.
 * @param containerId - Container ID or name
 * @param cmd - Command to execute as array
 * @param options - Execution options (workdir, user, env)
 */
export const execInContainer = async (
  containerId: string,
  cmd: string[],
  options: { workdir?: string; user?: string; env?: string[] } = {}
): Promise<DockerApiResponse<{ output: string; exitCode: number }>> => {
  // Create exec instance
  const createResult = await execCreate(containerId, {
    Cmd: cmd,
    AttachStdout: true,
    AttachStderr: true,
    WorkingDir: options.workdir,
    User: options.user,
    Env: options.env,
  });

  if (!createResult.success || !createResult.data) {
    return { success: false, error: createResult.error ?? "Failed to create exec" };
  }

  const execId = createResult.data.Id;

  // Start exec and get output
  const startResult = await execStart(execId);
  if (!startResult.success) {
    return { success: false, error: startResult.error ?? "Failed to start exec" };
  }

  // Get exit code
  const inspectResult = await execInspect(execId);
  const exitCode = inspectResult.data?.ExitCode ?? -1;

  return {
    success: true,
    data: {
      output: startResult.data ?? "",
      exitCode,
    },
  };
};

// =============================================================================
// Tool-specific: Image operations (removeImage not in lib)
// =============================================================================

/**
 * Remove an image.
 * @param name - Image name or ID
 * @param force - Force remove
 * @param noprune - Don't delete untagged parents
 */
export const removeImage = async (
  name: string,
  force = false,
  noprune = false
): Promise<DockerApiResponse<void>> => {
  return dockerFetch<void>(
    `/images/${encodeURIComponent(name)}?force=${force}&noprune=${noprune}`,
    { method: "DELETE" }
  );
};

// =============================================================================
// Tool-specific: Volume Operations (not in lib)
// =============================================================================

/**
 * List volumes.
 */
export const listVolumes = async (): Promise<
  DockerApiResponse<{ Volumes: Volume[]; Warnings: string[] }>
> => {
  return dockerFetch<{ Volumes: Volume[]; Warnings: string[] }>("/volumes");
};

/**
 * Create a volume.
 * @param name - Volume name
 * @param options - Volume creation options
 */
export const createVolume = async (
  name: string,
  options: { driver?: string; labels?: Record<string, string> } = {}
): Promise<DockerApiResponse<Volume>> => {
  return dockerFetch<Volume>("/volumes/create", {
    method: "POST",
    body: {
      Name: name,
      Driver: options.driver ?? "local",
      Labels: options.labels,
    },
  });
};

/**
 * Remove a volume.
 * @param name - Volume name
 */
export const removeVolume = async (name: string): Promise<DockerApiResponse<void>> => {
  return dockerFetch<void>(`/volumes/${encodeURIComponent(name)}`, { method: "DELETE" });
};

// =============================================================================
// Tool-specific: Network Operations (not in lib)
// =============================================================================

/**
 * List networks.
 */
export const listNetworks = async (): Promise<DockerApiResponse<Network[]>> => {
  return dockerFetch<Network[]>("/networks");
};
