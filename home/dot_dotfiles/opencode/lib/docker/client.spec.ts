/**
 * Tests for the Docker client module.
 * Tests Docker API client functions with mocked fetch.
 *
 * Note: These tests verify the client logic without requiring a running Docker daemon.
 * Integration tests with real Docker should be done separately.
 */

import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test'
import {
  dockerFetch,
  listContainers,
  inspectContainer,
  createContainer,
  startContainer,
  stopContainer,
  removeContainer,
  waitContainer,
  getContainerLogs,
  getContainerLogsSeparated,
  stripDockerLogHeaders,
  parseDockerLogsSeparated,
  execCreate,
  execStart,
  execInspect,
  listImages,
  pullImage,
  inspectImage,
  ping,
} from './client'
import type { ContainerConfig, ExecConfig } from './types'

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Create a mock response object.
 */
const createMockResponse = (options: {
  ok?: boolean
  status?: number
  data?: unknown
  contentType?: string
}): Response => {
  const { ok = true, status = 200, data, contentType = 'application/json' } = options

  const body = data !== undefined ? JSON.stringify(data) : null

  return new Response(body, {
    status,
    headers: { 'content-type': contentType },
  })
}

/**
 * Create a Docker multiplexed log frame.
 * Stream type: 1 = stdout, 2 = stderr
 */
const createDockerLogFrame = (streamType: number, text: string): Uint8Array => {
  const payload = new TextEncoder().encode(text)
  const frame = new Uint8Array(8 + payload.length)

  // First byte is stream type
  frame[0] = streamType
  // Bytes 1-3 are padding (zeros)
  // Bytes 4-7 are size (big-endian)
  frame[4] = (payload.length >> 24) & 0xff
  frame[5] = (payload.length >> 16) & 0xff
  frame[6] = (payload.length >> 8) & 0xff
  frame[7] = payload.length & 0xff
  // Payload follows
  frame.set(payload, 8)

  return frame
}

/**
 * Concatenate multiple Uint8Arrays into one.
 */
const concatUint8Arrays = (...arrays: Uint8Array[]): Uint8Array => {
  const totalLength = arrays.reduce((acc, arr) => acc + arr.length, 0)
  const result = new Uint8Array(totalLength)
  let offset = 0
  for (const arr of arrays) {
    result.set(arr, offset)
    offset += arr.length
  }
  return result
}

// =============================================================================
// stripDockerLogHeaders
// =============================================================================

describe('stripDockerLogHeaders', () => {
  describe('valid Docker log frames', () => {
    test('strips header from single stdout frame', () => {
      const frame = createDockerLogFrame(1, 'Hello, World!')
      const data = new TextDecoder().decode(frame)
      const result = stripDockerLogHeaders(data)
      expect(result).toBe('Hello, World!')
    })

    test('strips headers from multiple frames', () => {
      const frame1 = createDockerLogFrame(1, 'Line 1\n')
      const frame2 = createDockerLogFrame(1, 'Line 2\n')
      const combined = concatUint8Arrays(frame1, frame2)
      const data = new TextDecoder().decode(combined)
      const result = stripDockerLogHeaders(data)
      expect(result).toBe('Line 1\nLine 2\n')
    })

    test('handles mixed stdout and stderr frames', () => {
      const stdout = createDockerLogFrame(1, 'stdout message\n')
      const stderr = createDockerLogFrame(2, 'stderr message\n')
      const combined = concatUint8Arrays(stdout, stderr)
      const data = new TextDecoder().decode(combined)
      const result = stripDockerLogHeaders(data)
      expect(result).toBe('stdout message\nstderr message\n')
    })
  })

  describe('edge cases', () => {
    test('handles empty string', () => {
      const result = stripDockerLogHeaders('')
      expect(result).toBe('')
    })

    test('handles plain text without headers', () => {
      const input = 'Plain text without Docker headers'
      const result = stripDockerLogHeaders(input)
      // Should still output something (treats as incomplete frame)
      expect(result).toContain('Plain')
    })

    test('handles short input (less than 8 bytes)', () => {
      const result = stripDockerLogHeaders('short')
      expect(result).toBe('short')
    })

    test('handles exactly 8 bytes (header only, no payload)', () => {
      const header = new Uint8Array([1, 0, 0, 0, 0, 0, 0, 0])
      const data = new TextDecoder().decode(header)
      const result = stripDockerLogHeaders(data)
      // Should handle gracefully
      expect(typeof result).toBe('string')
    })

    test('handles frame with invalid size (negative)', () => {
      const frame = createDockerLogFrame(1, 'test')
      // Corrupt the size bytes to create an invalid frame
      frame[4] = 0xff
      frame[5] = 0xff
      frame[6] = 0xff
      frame[7] = 0xff
      const data = new TextDecoder().decode(frame)
      const result = stripDockerLogHeaders(data)
      // Should handle gracefully without crashing
      expect(typeof result).toBe('string')
    })

    test('handles unicode content', () => {
      const frame = createDockerLogFrame(1, 'Hello \u4e16\u754c (world in Chinese)')
      const data = new TextDecoder().decode(frame)
      const result = stripDockerLogHeaders(data)
      expect(result).toContain('\u4e16\u754c')
    })

    test('handles multi-byte UTF-8 characters', () => {
      const frame = createDockerLogFrame(1, 'Emoji: \u{1F600}')
      const data = new TextDecoder().decode(frame)
      const result = stripDockerLogHeaders(data)
      expect(result).toContain('\u{1F600}')
    })
  })
})

// =============================================================================
// parseDockerLogsSeparated
// =============================================================================

describe('parseDockerLogsSeparated', () => {
  describe('stream separation', () => {
    test('separates stdout and stderr', () => {
      const stdout = createDockerLogFrame(1, 'stdout output\n')
      const stderr = createDockerLogFrame(2, 'stderr output\n')
      const combined = concatUint8Arrays(stdout, stderr)
      const data = new TextDecoder().decode(combined)
      const result = parseDockerLogsSeparated(data)

      expect(result.stdout).toBe('stdout output\n')
      expect(result.stderr).toBe('stderr output\n')
    })

    test('handles interleaved stdout and stderr', () => {
      const frame1 = createDockerLogFrame(1, 'out1\n')
      const frame2 = createDockerLogFrame(2, 'err1\n')
      const frame3 = createDockerLogFrame(1, 'out2\n')
      const frame4 = createDockerLogFrame(2, 'err2\n')
      const combined = concatUint8Arrays(frame1, frame2, frame3, frame4)
      const data = new TextDecoder().decode(combined)
      const result = parseDockerLogsSeparated(data)

      expect(result.stdout).toBe('out1\nout2\n')
      expect(result.stderr).toBe('err1\nerr2\n')
    })

    test('handles stdout only', () => {
      const frame = createDockerLogFrame(1, 'only stdout')
      const data = new TextDecoder().decode(frame)
      const result = parseDockerLogsSeparated(data)

      expect(result.stdout).toBe('only stdout')
      expect(result.stderr).toBe('')
    })

    test('handles stderr only', () => {
      const frame = createDockerLogFrame(2, 'only stderr')
      const data = new TextDecoder().decode(frame)
      const result = parseDockerLogsSeparated(data)

      expect(result.stdout).toBe('')
      expect(result.stderr).toBe('only stderr')
    })
  })

  describe('edge cases', () => {
    test('handles empty string', () => {
      const result = parseDockerLogsSeparated('')
      expect(result.stdout).toBe('')
      expect(result.stderr).toBe('')
    })

    test('handles plain text as stdout', () => {
      const result = parseDockerLogsSeparated('plain text')
      // Incomplete frames treated as stdout
      expect(result.stdout).toContain('plain')
    })

    test('handles unknown stream type as stdout', () => {
      const frame = createDockerLogFrame(0, 'unknown stream')
      const data = new TextDecoder().decode(frame)
      const result = parseDockerLogsSeparated(data)
      // Stream type 0 should go to stdout (default)
      expect(result.stdout).toBe('unknown stream')
    })
  })
})

// =============================================================================
// dockerFetch
// =============================================================================

describe('dockerFetch', () => {
  let originalFetch: typeof fetch

  beforeEach(() => {
    originalFetch = global.fetch
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  describe('successful requests', () => {
    test('makes GET request with correct URL', async () => {
      let capturedUrl = ''
      let capturedOptions: RequestInit | undefined

      global.fetch = mock(async (url, options) => {
        capturedUrl = url as string
        capturedOptions = options
        return createMockResponse({ data: { Id: 'test' } })
      })

      await dockerFetch('/containers/json')

      expect(capturedUrl).toBe('http://localhost/v1.44/containers/json')
      expect(capturedOptions?.method).toBe('GET')
    })

    test('makes POST request with body', async () => {
      let capturedBody = ''

      global.fetch = mock(async (_url, options) => {
        capturedBody = options?.body as string
        return createMockResponse({ data: { Id: 'abc123' } })
      })

      const body = { Image: 'alpine', Cmd: ['echo', 'hello'] }
      await dockerFetch('/containers/create', { method: 'POST', body })

      expect(JSON.parse(capturedBody)).toEqual(body)
    })

    test('returns success response with data', async () => {
      const responseData = { Id: 'container123', Name: 'test' }
      global.fetch = mock(async () => createMockResponse({ data: responseData }))

      const result = await dockerFetch<typeof responseData>('/test')

      expect(result.success).toBe(true)
      expect(result.data).toEqual(responseData)
      expect(result.statusCode).toBe(200)
    })

    test('handles 204 no content response', async () => {
      global.fetch = mock(async () => new Response(null, { status: 204 }))

      const result = await dockerFetch('/containers/abc/stop')

      expect(result.success).toBe(true)
      expect(result.data).toBeUndefined()
    })

    test('handles non-JSON response as text', async () => {
      global.fetch = mock(
        async () =>
          new Response('OK', {
            status: 200,
            headers: { 'content-type': 'text/plain' },
          })
      )

      const result = await dockerFetch<string>('/_ping')

      expect(result.success).toBe(true)
      expect(result.data).toBe('OK')
    })
  })

  describe('error responses', () => {
    test('returns error for non-OK response', async () => {
      global.fetch = mock(async () =>
        createMockResponse({
          ok: false,
          status: 404,
          data: { message: 'Container not found' },
        })
      )

      const result = await dockerFetch('/containers/nonexistent/json')

      expect(result.success).toBe(false)
      expect(result.error).toBe('Container not found')
      expect(result.statusCode).toBe(404)
    })

    test('handles error response without message field', async () => {
      global.fetch = mock(async () =>
        createMockResponse({
          ok: false,
          status: 500,
          data: { error: 'internal error' },
        })
      )

      const result = await dockerFetch('/test')

      expect(result.success).toBe(false)
      expect(result.error).toBe('HTTP 500')
    })
  })

  describe('connection errors', () => {
    test('handles ENOENT error (socket not found)', async () => {
      global.fetch = mock(async () => {
        throw new Error('ENOENT: no such file or directory')
      })

      const result = await dockerFetch('/test')

      expect(result.success).toBe(false)
      expect(result.error).toContain('Cannot connect to Docker socket')
      expect(result.error).toContain('Is Docker running?')
    })

    test('handles EACCES error (permission denied)', async () => {
      global.fetch = mock(async () => {
        throw new Error('EACCES: permission denied')
      })

      const result = await dockerFetch('/test')

      expect(result.success).toBe(false)
      expect(result.error).toContain('Cannot connect to Docker socket')
    })

    test('handles generic network error', async () => {
      global.fetch = mock(async () => {
        throw new Error('Connection refused')
      })

      const result = await dockerFetch('/test')

      expect(result.success).toBe(false)
      expect(result.error).toBe('Connection refused')
    })

    test('handles non-Error thrown', async () => {
      global.fetch = mock(async () => {
        throw 'String error'
      })

      const result = await dockerFetch('/test')

      expect(result.success).toBe(false)
      expect(result.error).toBe('String error')
    })
  })

  describe('request configuration', () => {
    test('sets Content-Type header to application/json', async () => {
      let capturedHeaders: Record<string, string> = {}

      global.fetch = mock(async (_url, options) => {
        capturedHeaders = (options?.headers as Record<string, string>) ?? {}
        return createMockResponse({ data: {} })
      })

      await dockerFetch('/test')

      expect(capturedHeaders['Content-Type']).toBe('application/json')
    })

    test('allows custom headers', async () => {
      let capturedHeaders: Record<string, string> = {}

      global.fetch = mock(async (_url, options) => {
        capturedHeaders = (options?.headers as Record<string, string>) ?? {}
        return createMockResponse({ data: {} })
      })

      await dockerFetch('/test', { headers: { 'X-Custom': 'value' } })

      expect(capturedHeaders['X-Custom']).toBe('value')
      expect(capturedHeaders['Content-Type']).toBe('application/json')
    })

    test('includes unix socket option', async () => {
      let capturedOptions: RequestInit & { unix?: string } = {}

      global.fetch = mock(async (_url, options) => {
        capturedOptions = options as RequestInit & { unix?: string }
        return createMockResponse({ data: {} })
      })

      await dockerFetch('/test')

      expect(capturedOptions.unix).toBe('/var/run/docker.sock')
    })
  })
})

// =============================================================================
// Container Operations
// =============================================================================

describe('Container Operations', () => {
  let originalFetch: typeof fetch

  beforeEach(() => {
    originalFetch = global.fetch
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  describe('listContainers', () => {
    test('lists running containers by default', async () => {
      let capturedUrl = ''
      global.fetch = mock(async (url) => {
        capturedUrl = url as string
        return createMockResponse({ data: [] })
      })

      await listContainers()

      expect(capturedUrl).toContain('/containers/json?all=false')
    })

    test('lists all containers when all=true', async () => {
      let capturedUrl = ''
      global.fetch = mock(async (url) => {
        capturedUrl = url as string
        return createMockResponse({ data: [] })
      })

      await listContainers(true)

      expect(capturedUrl).toContain('/containers/json?all=true')
    })

    test('returns container list on success', async () => {
      const containers = [
        { Id: 'abc123', Names: ['/container1'] },
        { Id: 'def456', Names: ['/container2'] },
      ]
      global.fetch = mock(async () => createMockResponse({ data: containers }))

      const result = await listContainers()

      expect(result.success).toBe(true)
      expect(result.data).toHaveLength(2)
    })
  })

  describe('inspectContainer', () => {
    test('builds correct URL with container ID', async () => {
      let capturedUrl = ''
      global.fetch = mock(async (url) => {
        capturedUrl = url as string
        return createMockResponse({ data: { Id: 'abc123' } })
      })

      await inspectContainer('abc123')

      expect(capturedUrl).toContain('/containers/abc123/json')
    })

    test('encodes special characters in container name', async () => {
      let capturedUrl = ''
      global.fetch = mock(async (url) => {
        capturedUrl = url as string
        return createMockResponse({ data: { Id: 'test' } })
      })

      await inspectContainer('my/container')

      expect(capturedUrl).toContain('my%2Fcontainer')
    })

    test('returns container details on success', async () => {
      const containerDetails = {
        Id: 'abc123',
        State: { Running: true, ExitCode: 0 },
      }
      global.fetch = mock(async () => createMockResponse({ data: containerDetails }))

      const result = await inspectContainer('abc123')

      expect(result.success).toBe(true)
      expect(result.data?.Id).toBe('abc123')
    })
  })

  describe('createContainer', () => {
    test('makes POST request with config', async () => {
      let capturedMethod = ''
      let capturedBody = ''

      global.fetch = mock(async (_url, options) => {
        capturedMethod = options?.method as string
        capturedBody = options?.body as string
        return createMockResponse({ data: { Id: 'newcontainer' } })
      })

      const config: ContainerConfig = {
        Image: 'alpine:latest',
        Cmd: ['echo', 'hello'],
      }
      await createContainer(config)

      expect(capturedMethod).toBe('POST')
      expect(JSON.parse(capturedBody)).toEqual(config)
    })

    test('includes name parameter when provided', async () => {
      let capturedUrl = ''
      global.fetch = mock(async (url) => {
        capturedUrl = url as string
        return createMockResponse({ data: { Id: 'newcontainer' } })
      })

      await createContainer({ Image: 'alpine' }, 'mycontainer')

      expect(capturedUrl).toContain('?name=mycontainer')
    })

    test('omits name parameter when not provided', async () => {
      let capturedUrl = ''
      global.fetch = mock(async (url) => {
        capturedUrl = url as string
        return createMockResponse({ data: { Id: 'newcontainer' } })
      })

      await createContainer({ Image: 'alpine' })

      expect(capturedUrl).not.toContain('?name=')
    })
  })

  describe('startContainer', () => {
    test('makes POST request to start endpoint', async () => {
      let capturedUrl = ''
      let capturedMethod = ''

      global.fetch = mock(async (url, options) => {
        capturedUrl = url as string
        capturedMethod = options?.method as string
        return new Response(null, { status: 204 })
      })

      await startContainer('abc123')

      expect(capturedUrl).toContain('/containers/abc123/start')
      expect(capturedMethod).toBe('POST')
    })

    test('returns success for 204 response', async () => {
      global.fetch = mock(async () => new Response(null, { status: 204 }))

      const result = await startContainer('abc123')

      expect(result.success).toBe(true)
    })
  })

  describe('stopContainer', () => {
    test('uses default timeout of 10 seconds', async () => {
      let capturedUrl = ''
      global.fetch = mock(async (url) => {
        capturedUrl = url as string
        return new Response(null, { status: 204 })
      })

      await stopContainer('abc123')

      expect(capturedUrl).toContain('/containers/abc123/stop?t=10')
    })

    test('uses custom timeout', async () => {
      let capturedUrl = ''
      global.fetch = mock(async (url) => {
        capturedUrl = url as string
        return new Response(null, { status: 204 })
      })

      await stopContainer('abc123', 30)

      expect(capturedUrl).toContain('/containers/abc123/stop?t=30')
    })
  })

  describe('removeContainer', () => {
    test('uses default options (force=false, volumes=false)', async () => {
      let capturedUrl = ''
      global.fetch = mock(async (url) => {
        capturedUrl = url as string
        return new Response(null, { status: 204 })
      })

      await removeContainer('abc123')

      expect(capturedUrl).toContain('force=false')
      expect(capturedUrl).toContain('v=false')
    })

    test('includes force=true when specified', async () => {
      let capturedUrl = ''
      global.fetch = mock(async (url) => {
        capturedUrl = url as string
        return new Response(null, { status: 204 })
      })

      await removeContainer('abc123', true)

      expect(capturedUrl).toContain('force=true')
    })

    test('includes v=true when volumes=true', async () => {
      let capturedUrl = ''
      global.fetch = mock(async (url) => {
        capturedUrl = url as string
        return new Response(null, { status: 204 })
      })

      await removeContainer('abc123', false, true)

      expect(capturedUrl).toContain('v=true')
    })
  })

  describe('waitContainer', () => {
    test("uses default condition 'not-running'", async () => {
      let capturedUrl = ''
      global.fetch = mock(async (url) => {
        capturedUrl = url as string
        return createMockResponse({ data: { StatusCode: 0 } })
      })

      await waitContainer('abc123')

      expect(capturedUrl).toContain('condition=not-running')
    })

    test('uses custom condition', async () => {
      let capturedUrl = ''
      global.fetch = mock(async (url) => {
        capturedUrl = url as string
        return createMockResponse({ data: { StatusCode: 0 } })
      })

      await waitContainer('abc123', 'removed')

      expect(capturedUrl).toContain('condition=removed')
    })

    test('returns status code on success', async () => {
      global.fetch = mock(async () => createMockResponse({ data: { StatusCode: 42 } }))

      const result = await waitContainer('abc123')

      expect(result.success).toBe(true)
      expect(result.data?.StatusCode).toBe(42)
    })
  })

  describe('getContainerLogs', () => {
    test('uses default parameters', async () => {
      let capturedUrl = ''
      global.fetch = mock(async (url) => {
        capturedUrl = url as string
        return new Response('logs', {
          status: 200,
          headers: { 'content-type': 'text/plain' },
        })
      })

      await getContainerLogs('abc123')

      expect(capturedUrl).toContain('tail=100')
      expect(capturedUrl).toContain('timestamps=false')
      expect(capturedUrl).toContain('stdout=true')
      expect(capturedUrl).toContain('stderr=true')
    })

    test('uses custom tail value', async () => {
      let capturedUrl = ''
      global.fetch = mock(async (url) => {
        capturedUrl = url as string
        return new Response('logs', {
          status: 200,
          headers: { 'content-type': 'text/plain' },
        })
      })

      await getContainerLogs('abc123', { tail: 500 })

      expect(capturedUrl).toContain('tail=500')
    })

    test('strips Docker log headers from response', async () => {
      const frame = createDockerLogFrame(1, 'Log output')
      global.fetch = mock(
        async () =>
          new Response(new TextDecoder().decode(frame), {
            status: 200,
            headers: { 'content-type': 'application/octet-stream' },
          })
      )

      const result = await getContainerLogs('abc123')

      expect(result.success).toBe(true)
      expect(result.data).toBe('Log output')
    })
  })

  describe('getContainerLogsSeparated', () => {
    test('returns separated stdout and stderr', async () => {
      const stdout = createDockerLogFrame(1, 'stdout\n')
      const stderr = createDockerLogFrame(2, 'stderr\n')
      const combined = concatUint8Arrays(stdout, stderr)

      global.fetch = mock(
        async () =>
          new Response(new TextDecoder().decode(combined), {
            status: 200,
            headers: { 'content-type': 'application/octet-stream' },
          })
      )

      const result = await getContainerLogsSeparated('abc123')

      expect(result.success).toBe(true)
      expect(result.data?.stdout).toBe('stdout\n')
      expect(result.data?.stderr).toBe('stderr\n')
    })

    test('returns error when request fails', async () => {
      global.fetch = mock(async () =>
        createMockResponse({
          ok: false,
          status: 404,
          data: { message: 'Container not found' },
        })
      )

      const result = await getContainerLogsSeparated('nonexistent')

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })
  })
})

// =============================================================================
// Exec Operations
// =============================================================================

describe('Exec Operations', () => {
  let originalFetch: typeof fetch

  beforeEach(() => {
    originalFetch = global.fetch
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  describe('execCreate', () => {
    test('makes POST request with exec config', async () => {
      let capturedUrl = ''
      let capturedBody = ''

      global.fetch = mock(async (url, options) => {
        capturedUrl = url as string
        capturedBody = options?.body as string
        return createMockResponse({ data: { Id: 'exec123' } })
      })

      const config: ExecConfig = {
        Cmd: ['ls', '-la'],
        AttachStdout: true,
        AttachStderr: true,
      }
      await execCreate('container123', config)

      expect(capturedUrl).toContain('/containers/container123/exec')
      expect(JSON.parse(capturedBody)).toEqual(config)
    })

    test('returns exec ID on success', async () => {
      global.fetch = mock(async () => createMockResponse({ data: { Id: 'exec123' } }))

      const result = await execCreate('container123', { Cmd: ['ls'] })

      expect(result.success).toBe(true)
      expect(result.data?.Id).toBe('exec123')
    })
  })

  describe('execStart', () => {
    test('makes POST request with correct options', async () => {
      let capturedUrl = ''
      let capturedBody = ''

      global.fetch = mock(async (url, options) => {
        capturedUrl = url as string
        capturedBody = options?.body as string
        return new Response('output', {
          status: 200,
          headers: { 'content-type': 'text/plain' },
        })
      })

      await execStart('exec123')

      expect(capturedUrl).toContain('/exec/exec123/start')
      expect(JSON.parse(capturedBody)).toEqual({ Detach: false, Tty: false })
    })

    test('strips Docker log headers from output', async () => {
      const frame = createDockerLogFrame(1, 'command output')
      global.fetch = mock(
        async () =>
          new Response(new TextDecoder().decode(frame), {
            status: 200,
            headers: { 'content-type': 'application/octet-stream' },
          })
      )

      const result = await execStart('exec123')

      expect(result.success).toBe(true)
      expect(result.data).toBe('command output')
    })
  })

  describe('execInspect', () => {
    test('returns exec status', async () => {
      global.fetch = mock(async () =>
        createMockResponse({
          data: { ExitCode: 0, Running: false, Pid: 12345 },
        })
      )

      const result = await execInspect('exec123')

      expect(result.success).toBe(true)
      expect(result.data?.ExitCode).toBe(0)
      expect(result.data?.Running).toBe(false)
    })
  })
})

// =============================================================================
// Image Operations
// =============================================================================

describe('Image Operations', () => {
  let originalFetch: typeof fetch

  beforeEach(() => {
    originalFetch = global.fetch
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  describe('listImages', () => {
    test('makes GET request to /images/json', async () => {
      let capturedUrl = ''
      global.fetch = mock(async (url) => {
        capturedUrl = url as string
        return createMockResponse({ data: [] })
      })

      await listImages()

      expect(capturedUrl).toContain('/images/json')
    })

    test('returns image list on success', async () => {
      const images = [
        { Id: 'sha256:abc', RepoTags: ['alpine:latest'] },
        { Id: 'sha256:def', RepoTags: ['node:20'] },
      ]
      global.fetch = mock(async () => createMockResponse({ data: images }))

      const result = await listImages()

      expect(result.success).toBe(true)
      expect(result.data).toHaveLength(2)
    })
  })

  describe('pullImage', () => {
    test('adds latest tag when not specified', async () => {
      let capturedUrl = ''
      global.fetch = mock(async (url) => {
        capturedUrl = url as string
        return new Response('{}', { status: 200 })
      })

      await pullImage('alpine')

      expect(capturedUrl).toContain('fromImage=alpine%3Alatest')
    })

    test('uses specified tag when image includes tag', async () => {
      let capturedUrl = ''
      global.fetch = mock(async (url) => {
        capturedUrl = url as string
        return new Response('{}', { status: 200 })
      })

      await pullImage('node:20')

      expect(capturedUrl).toContain('fromImage=node%3A20')
    })

    test('returns success for successful pull', async () => {
      global.fetch = mock(
        async () => new Response('{"status":"Downloaded newer image"}', { status: 200 })
      )

      const result = await pullImage('alpine')

      expect(result.success).toBe(true)
    })

    test('returns error when pull stream contains error', async () => {
      global.fetch = mock(
        async () =>
          new Response(
            '{"status":"Pulling"}\n{"error":"manifest unknown","errorDetail":{"message":"manifest unknown"}}',
            { status: 200 }
          )
      )

      const result = await pullImage('nonexistent:tag')

      expect(result.success).toBe(false)
      expect(result.error).toContain('manifest unknown')
    })
  })

  describe('inspectImage', () => {
    test('builds correct URL with image name', async () => {
      let capturedUrl = ''
      global.fetch = mock(async (url) => {
        capturedUrl = url as string
        return createMockResponse({ data: { Id: 'sha256:abc' } })
      })

      await inspectImage('node:20')

      expect(capturedUrl).toContain('/images/node%3A20/json')
    })

    test('returns image details on success', async () => {
      const imageDetails = {
        Id: 'sha256:abc123',
        RepoTags: ['alpine:latest'],
        Size: 5000000,
      }
      global.fetch = mock(async () => createMockResponse({ data: imageDetails }))

      const result = await inspectImage('alpine')

      expect(result.success).toBe(true)
      expect(result.data?.Id).toBe('sha256:abc123')
    })
  })
})

// =============================================================================
// Health Check
// =============================================================================

describe('ping', () => {
  let originalFetch: typeof fetch

  beforeEach(() => {
    originalFetch = global.fetch
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  test('makes request to /_ping endpoint', async () => {
    let capturedUrl = ''
    global.fetch = mock(async (url) => {
      capturedUrl = url as string
      return new Response('OK', { status: 200 })
    })

    await ping()

    expect(capturedUrl).toContain('/_ping')
  })

  test('returns success when Docker is responsive', async () => {
    global.fetch = mock(
      async () =>
        new Response('OK', {
          status: 200,
          headers: { 'content-type': 'text/plain' },
        })
    )

    const result = await ping()

    expect(result.success).toBe(true)
    expect(result.data).toBe('OK')
  })

  test('returns error when Docker is not running', async () => {
    global.fetch = mock(async () => {
      throw new Error('ENOENT: no such file or directory')
    })

    const result = await ping()

    expect(result.success).toBe(false)
    expect(result.error).toContain('Cannot connect to Docker')
  })
})
