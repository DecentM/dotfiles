/**
 * Docker socket client using native fetch with Unix socket support.
 * Connects directly to /var/run/docker.sock for API operations.
 */

const DOCKER_SOCKET = "/var/run/docker.sock";
const DOCKER_API_VERSION = "v1.44";

// =============================================================================
// Types
// =============================================================================

export interface DockerApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  statusCode?: number;
}

export interface Container {
  Id: string;
  Names: string[];
  Image: string;
  ImageID: string;
  Command: string;
  Created: number;
  State: string;
  Status: string;
  Ports: Array<{
    IP?: string;
    PrivatePort: number;
    PublicPort?: number;
    Type: string;
  }>;
  Labels: Record<string, string>;
  Mounts: Array<{
    Type: string;
    Source: string;
    Destination: string;
    Mode: string;
    RW: boolean;
  }>;
}

export interface ContainerInspect {
  Id: string;
  Created: string;
  Path: string;
  Args: string[];
  State: {
    Status: string;
    Running: boolean;
    Paused: boolean;
    Restarting: boolean;
    OOMKilled: boolean;
    Dead: boolean;
    Pid: number;
    ExitCode: number;
    Error: string;
    StartedAt: string;
    FinishedAt: string;
  };
  Image: string;
  Name: string;
  Config: {
    Hostname: string;
    User: string;
    Env: string[];
    Cmd: string[];
    Image: string;
    WorkingDir: string;
    Labels: Record<string, string>;
  };
  HostConfig: {
    Binds: string[] | null;
    Memory: number;
    NanoCpus: number;
    Privileged: boolean;
    NetworkMode: string;
  };
  NetworkSettings: {
    Networks: Record<
      string,
      {
        IPAddress: string;
        Gateway: string;
        MacAddress: string;
      }
    >;
  };
}

export interface Image {
  Id: string;
  ParentId: string;
  RepoTags: string[] | null;
  RepoDigests: string[] | null;
  Created: number;
  Size: number;
  VirtualSize: number;
  Labels: Record<string, string> | null;
}

export interface ImageInspect {
  Id: string;
  RepoTags: string[];
  RepoDigests: string[];
  Parent: string;
  Created: string;
  Container: string;
  Config: {
    Hostname: string;
    User: string;
    Env: string[];
    Cmd: string[] | null;
    Entrypoint: string[] | null;
    WorkingDir: string;
    Labels: Record<string, string> | null;
  };
  Architecture: string;
  Os: string;
  Size: number;
  VirtualSize: number;
}

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

export interface CreateContainerResponse {
  Id: string;
  Warnings: string[];
}

export interface ExecCreateResponse {
  Id: string;
}

export interface ExecInspectResponse {
  ExitCode: number;
  Running: boolean;
  Pid: number;
}

// =============================================================================
// Fetch Helper
// =============================================================================

/**
 * Make a request to the Docker API via Unix socket.
 */
const dockerFetch = async <T>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
  } = {}
): Promise<DockerApiResponse<T>> => {
  const { method = "GET", body, headers = {} } = options;

  const url = `http://localhost/${DOCKER_API_VERSION}${path}`;

  const fetchOptions: RequestInit & { unix: string } = {
    method,
    unix: DOCKER_SOCKET,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
  };

  if (body) {
    fetchOptions.body = JSON.stringify(body);
  }

  try {
    const response = await fetch(url, fetchOptions);

    // Handle no content responses
    if (response.status === 204) {
      return { success: true };
    }

    // Try to parse JSON response
    const contentType = response.headers.get("content-type");
    let data: T | undefined;

    if (contentType?.includes("application/json")) {
      data = (await response.json()) as T;
    } else {
      // For non-JSON responses (like logs), return text as data
      const text = await response.text();
      data = text as unknown as T;
    }

    if (!response.ok) {
      const errorMessage =
        data && typeof data === "object" && "message" in data
          ? String((data as { message: string }).message)
          : `HTTP ${response.status}`;
      return {
        success: false,
        error: errorMessage,
        statusCode: response.status,
      };
    }

    return { success: true, data, statusCode: response.status };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Check for common socket errors
    if (errorMessage.includes("ENOENT") || errorMessage.includes("EACCES")) {
      return {
        success: false,
        error: `Cannot connect to Docker socket at ${DOCKER_SOCKET}. Is Docker running?`,
      };
    }

    return { success: false, error: errorMessage };
  }
};

// =============================================================================
// Container Operations
// =============================================================================

/**
 * List containers.
 * @param all - Include stopped containers
 */
export const listContainers = async (
  all = false
): Promise<DockerApiResponse<Container[]>> => {
  return dockerFetch<Container[]>(`/containers/json?all=${all}`);
};

/**
 * Inspect a container by ID or name.
 */
export const inspectContainer = async (
  id: string
): Promise<DockerApiResponse<ContainerInspect>> => {
  return dockerFetch<ContainerInspect>(`/containers/${encodeURIComponent(id)}/json`);
};

/**
 * Create a new container.
 */
export const createContainer = async (
  config: import("./types").ContainerConfig,
  name?: string
): Promise<DockerApiResponse<CreateContainerResponse>> => {
  const query = name ? `?name=${encodeURIComponent(name)}` : "";
  return dockerFetch<CreateContainerResponse>(`/containers/create${query}`, {
    method: "POST",
    body: config,
  });
};

/**
 * Start a container.
 */
export const startContainer = async (id: string): Promise<DockerApiResponse<void>> => {
  return dockerFetch<void>(`/containers/${encodeURIComponent(id)}/start`, {
    method: "POST",
  });
};

/**
 * Stop a container.
 * @param timeout - Seconds to wait before killing (default 10)
 */
export const stopContainer = async (
  id: string,
  timeout = 10
): Promise<DockerApiResponse<void>> => {
  return dockerFetch<void>(`/containers/${encodeURIComponent(id)}/stop?t=${timeout}`, {
    method: "POST",
  });
};

/**
 * Remove a container.
 * @param force - Force remove running container
 * @param volumes - Remove associated volumes
 */
export const removeContainer = async (
  id: string,
  force = false,
  volumes = false
): Promise<DockerApiResponse<void>> => {
  return dockerFetch<void>(
    `/containers/${encodeURIComponent(id)}?force=${force}&v=${volumes}`,
    { method: "DELETE" }
  );
};

/**
 * Get container logs.
 * @param tail - Number of lines from the end (default 100)
 * @param timestamps - Include timestamps
 */
export const getContainerLogs = async (
  id: string,
  tail = 100,
  timestamps = false
): Promise<DockerApiResponse<string>> => {
  const response = await dockerFetch<string>(
    `/containers/${encodeURIComponent(id)}/logs?stdout=true&stderr=true&tail=${tail}&timestamps=${timestamps}`
  );

  // Docker multiplexes stdout/stderr with a header per frame
  // Each frame: [stream_type (1 byte), 0, 0, 0, size (4 bytes big-endian), payload]
  // For simplicity, we strip the headers and return clean output
  if (response.success && response.data) {
    const cleaned = stripDockerLogHeaders(response.data);
    return { ...response, data: cleaned };
  }

  return response;
};

/**
 * Strip Docker multiplexed log headers from raw log output.
 */
const stripDockerLogHeaders = (data: string): string => {
  // If it looks like binary-prefixed data, attempt to strip headers
  // Each frame: 8-byte header + payload
  const lines: string[] = [];
  let offset = 0;
  const buffer = new TextEncoder().encode(data);

  while (offset < buffer.length) {
    if (offset + 8 > buffer.length) {
      // Not enough bytes for a header, treat rest as text
      lines.push(new TextDecoder().decode(buffer.slice(offset)));
      break;
    }

    // Read frame size from bytes 4-7 (big-endian)
    const size =
      (buffer[offset + 4] << 24) |
      (buffer[offset + 5] << 16) |
      (buffer[offset + 6] << 8) |
      buffer[offset + 7];

    if (size <= 0 || offset + 8 + size > buffer.length) {
      // Invalid frame, just return remaining as text
      lines.push(new TextDecoder().decode(buffer.slice(offset)));
      break;
    }

    // Extract payload
    const payload = buffer.slice(offset + 8, offset + 8 + size);
    lines.push(new TextDecoder().decode(payload));

    offset += 8 + size;
  }

  return lines.join("");
};

/**
 * Create an exec instance in a container.
 */
export const createExec = async (
  containerId: string,
  config: import("./types").ExecConfig
): Promise<DockerApiResponse<ExecCreateResponse>> => {
  return dockerFetch<ExecCreateResponse>(
    `/containers/${encodeURIComponent(containerId)}/exec`,
    {
      method: "POST",
      body: config,
    }
  );
};

/**
 * Start an exec instance and get output.
 */
export const startExec = async (execId: string): Promise<DockerApiResponse<string>> => {
  const response = await dockerFetch<string>(`/exec/${encodeURIComponent(execId)}/start`, {
    method: "POST",
    body: { Detach: false, Tty: false },
  });

  // Strip docker log headers from exec output
  if (response.success && response.data) {
    const cleaned = stripDockerLogHeaders(response.data);
    return { ...response, data: cleaned };
  }

  return response;
};

/**
 * Inspect an exec instance to get exit code.
 */
export const inspectExec = async (
  execId: string
): Promise<DockerApiResponse<ExecInspectResponse>> => {
  return dockerFetch<ExecInspectResponse>(`/exec/${encodeURIComponent(execId)}/json`);
};

/**
 * Execute a command in a container and wait for completion.
 */
export const execInContainer = async (
  containerId: string,
  cmd: string[],
  options: { workdir?: string; user?: string; env?: string[] } = {}
): Promise<DockerApiResponse<{ output: string; exitCode: number }>> => {
  // Create exec instance
  const createResult = await createExec(containerId, {
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
  const startResult = await startExec(execId);
  if (!startResult.success) {
    return { success: false, error: startResult.error ?? "Failed to start exec" };
  }

  // Get exit code
  const inspectResult = await inspectExec(execId);
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
// Image Operations
// =============================================================================

/**
 * List images.
 */
export const listImages = async (): Promise<DockerApiResponse<Image[]>> => {
  return dockerFetch<Image[]>("/images/json");
};

/**
 * Pull an image.
 * Note: This is a streaming operation; we wait for completion.
 */
export const pullImage = async (
  name: string,
  tag = "latest"
): Promise<DockerApiResponse<void>> => {
  const imageName = name.includes(":") ? name : `${name}:${tag}`;
  const response = await dockerFetch<string>(
    `/images/create?fromImage=${encodeURIComponent(imageName)}`,
    { method: "POST" }
  );

  // Pull returns streaming JSON, check for errors in the response
  if (response.success && response.data) {
    const text = String(response.data);
    if (text.includes('"error"') || text.includes('"errorDetail"')) {
      // Parse last line to get error
      const lines = text.trim().split("\n");
      for (const line of lines.reverse()) {
        try {
          const parsed = JSON.parse(line);
          if (parsed.error) {
            return { success: false, error: parsed.error };
          }
        } catch {
          // Not JSON, skip
        }
      }
    }
    return { success: true };
  }

  return response as DockerApiResponse<void>;
};

/**
 * Inspect an image.
 */
export const inspectImage = async (
  name: string
): Promise<DockerApiResponse<ImageInspect>> => {
  return dockerFetch<ImageInspect>(`/images/${encodeURIComponent(name)}/json`);
};

/**
 * Remove an image.
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
// Volume Operations
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
 */
export const removeVolume = async (name: string): Promise<DockerApiResponse<void>> => {
  return dockerFetch<void>(`/volumes/${encodeURIComponent(name)}`, { method: "DELETE" });
};

// =============================================================================
// Network Operations
// =============================================================================

/**
 * List networks.
 */
export const listNetworks = async (): Promise<DockerApiResponse<Network[]>> => {
  return dockerFetch<Network[]>("/networks");
};

// =============================================================================
// Health Check
// =============================================================================

/**
 * Check if Docker daemon is accessible.
 */
export const ping = async (): Promise<DockerApiResponse<string>> => {
  return dockerFetch<string>("/_ping");
};
