/**
 * Docker socket client using native fetch with Unix socket support.
 * Connects directly to /var/run/docker.sock for API operations.
 */

import type {
	Container,
	ContainerConfig,
	ContainerInspect,
	CreateContainerResponse,
	DockerApiResponse,
	ExecConfig,
	ExecCreateResponse,
	ExecInspectResponse,
	Image,
	ImageInspect,
	WaitContainerResponse,
} from "./types";

const DOCKER_SOCKET = "/var/run/docker.sock";
const DOCKER_API_VERSION = "v1.44";

// =============================================================================
// Fetch Helper
// =============================================================================

/**
 * Make a request to the Docker API via Unix socket.
 * @param path - API endpoint path (e.g., "/containers/json")
 * @param options - Request options including method, body, and headers
 */
export const dockerFetch = async <T>(
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
 * @param id - Container ID or name
 */
export const inspectContainer = async (
	id: string
): Promise<DockerApiResponse<ContainerInspect>> => {
	return dockerFetch<ContainerInspect>(
		`/containers/${encodeURIComponent(id)}/json`
	);
};

/**
 * Create a new container.
 * @param config - Container configuration
 * @param name - Optional container name
 */
export const createContainer = async (
	config: ContainerConfig,
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
 * @param id - Container ID or name
 */
export const startContainer = async (
	id: string
): Promise<DockerApiResponse<void>> => {
	return dockerFetch<void>(`/containers/${encodeURIComponent(id)}/start`, {
		method: "POST",
	});
};

/**
 * Stop a container.
 * @param id - Container ID or name
 * @param timeout - Seconds to wait before killing (default 10)
 */
export const stopContainer = async (
	id: string,
	timeout = 10
): Promise<DockerApiResponse<void>> => {
	return dockerFetch<void>(
		`/containers/${encodeURIComponent(id)}/stop?t=${timeout}`,
		{
			method: "POST",
		}
	);
};

/**
 * Remove a container.
 * @param id - Container ID or name
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
 * Wait for a container to finish and get its exit code.
 * @param id - Container ID or name
 * @param condition - Wait condition: "not-running", "next-exit", or "removed" (default: "not-running")
 */
export const waitContainer = async (
	id: string,
	condition: "not-running" | "next-exit" | "removed" = "not-running"
): Promise<DockerApiResponse<WaitContainerResponse>> => {
	return dockerFetch<WaitContainerResponse>(
		`/containers/${encodeURIComponent(id)}/wait?condition=${condition}`,
		{ method: "POST" }
	);
};

/**
 * Get container logs.
 * @param id - Container ID or name
 * @param options - Log options
 */
export const getContainerLogs = async (
	id: string,
	options: {
		tail?: number;
		timestamps?: boolean;
		stdout?: boolean;
		stderr?: boolean;
	} = {}
): Promise<DockerApiResponse<string>> => {
	const { tail = 100, timestamps = false, stdout = true, stderr = true } = options;

	const response = await dockerFetch<string>(
		`/containers/${encodeURIComponent(id)}/logs?stdout=${stdout}&stderr=${stderr}&tail=${tail}&timestamps=${timestamps}`
	);

	// Docker multiplexes stdout/stderr with a header per frame
	// Each frame: [stream_type (1 byte), 0, 0, 0, size (4 bytes big-endian), payload]
	if (response.success && response.data) {
		const cleaned = stripDockerLogHeaders(response.data);
		return { ...response, data: cleaned };
	}

	return response;
};

/**
 * Get container logs separated by stream (stdout/stderr).
 * @param id - Container ID or name
 * @param options - Log options
 */
export const getContainerLogsSeparated = async (
	id: string,
	options: { tail?: number; timestamps?: boolean } = {}
): Promise<DockerApiResponse<{ stdout: string; stderr: string }>> => {
	const { tail = 100, timestamps = false } = options;

	const response = await dockerFetch<string>(
		`/containers/${encodeURIComponent(id)}/logs?stdout=true&stderr=true&tail=${tail}&timestamps=${timestamps}`
	);

	if (response.success && response.data) {
		const { stdout, stderr } = parseDockerLogsSeparated(response.data);
		return { success: true, data: { stdout, stderr }, statusCode: response.statusCode };
	}

	return { success: false, error: response.error };
};

// =============================================================================
// Log Processing Helpers
// =============================================================================

/**
 * Strip Docker multiplexed log headers from raw log output.
 * Returns all output combined.
 * @param data - Raw log data with Docker multiplex headers
 */
export const stripDockerLogHeaders = (data: string): string => {
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
 * Parse Docker multiplexed logs into separate stdout/stderr streams.
 * Stream type: 1 = stdout, 2 = stderr
 * @param data - Raw log data with Docker multiplex headers
 */
export const parseDockerLogsSeparated = (
	data: string
): { stdout: string; stderr: string } => {
	const stdoutLines: string[] = [];
	const stderrLines: string[] = [];
	let offset = 0;
	const buffer = new TextEncoder().encode(data);

	while (offset < buffer.length) {
		if (offset + 8 > buffer.length) {
			// Not enough bytes for a header, treat rest as stdout
			stdoutLines.push(new TextDecoder().decode(buffer.slice(offset)));
			break;
		}

		// First byte indicates stream type: 1 = stdout, 2 = stderr
		const streamType = buffer[offset];

		// Read frame size from bytes 4-7 (big-endian)
		const size =
			(buffer[offset + 4] << 24) |
			(buffer[offset + 5] << 16) |
			(buffer[offset + 6] << 8) |
			buffer[offset + 7];

		if (size <= 0 || offset + 8 + size > buffer.length) {
			// Invalid frame, just return remaining as stdout
			stdoutLines.push(new TextDecoder().decode(buffer.slice(offset)));
			break;
		}

		// Extract payload
		const payload = buffer.slice(offset + 8, offset + 8 + size);
		const text = new TextDecoder().decode(payload);

		if (streamType === 2) {
			stderrLines.push(text);
		} else {
			stdoutLines.push(text);
		}

		offset += 8 + size;
	}

	return {
		stdout: stdoutLines.join(""),
		stderr: stderrLines.join(""),
	};
};

// =============================================================================
// Exec Operations
// =============================================================================

/**
 * Create an exec instance in a container.
 * @param containerId - Container ID or name
 * @param config - Exec configuration
 */
export const execCreate = async (
	containerId: string,
	config: ExecConfig
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
 * @param execId - Exec instance ID
 */
export const execStart = async (
	execId: string
): Promise<DockerApiResponse<string>> => {
	const response = await dockerFetch<string>(
		`/exec/${encodeURIComponent(execId)}/start`,
		{
			method: "POST",
			body: { Detach: false, Tty: false },
		}
	);

	// Strip docker log headers from exec output
	if (response.success && response.data) {
		const cleaned = stripDockerLogHeaders(response.data);
		return { ...response, data: cleaned };
	}

	return response;
};

/**
 * Inspect an exec instance to get exit code and status.
 * @param execId - Exec instance ID
 */
export const execInspect = async (
	execId: string
): Promise<DockerApiResponse<ExecInspectResponse>> => {
	return dockerFetch<ExecInspectResponse>(
		`/exec/${encodeURIComponent(execId)}/json`
	);
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
 * Pull an image from a registry.
 * Note: This is a streaming operation; we wait for completion.
 * @param name - Image name (with or without tag)
 * @param tag - Image tag (default: "latest")
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

	return { success: response.success, error: response.error, statusCode: response.statusCode };
};

/**
 * Inspect an image.
 * @param name - Image name or ID
 */
export const inspectImage = async (
	name: string
): Promise<DockerApiResponse<ImageInspect>> => {
	return dockerFetch<ImageInspect>(`/images/${encodeURIComponent(name)}/json`);
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
