/**
 * Tests for the vision tool.
 * Tests image analysis via Ollama vision models.
 */

import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test'

// =============================================================================
// Test Utilities
// =============================================================================

/**
 * Creates a mock Response object for fetch
 */
const createMockResponse = (options: {
  ok?: boolean
  status?: number
  statusText?: string
  headers?: Record<string, string>
  body?: unknown
}): Response => {
  const {
    ok = true,
    status = 200,
    statusText = 'OK',
    headers = {},
    body = {},
  } = options

  return {
    ok,
    status,
    statusText,
    headers: new Headers(headers),
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    arrayBuffer: async () => {
      if (body instanceof ArrayBuffer) return body
      const encoder = new TextEncoder()
      return encoder.encode(typeof body === 'string' ? body : JSON.stringify(body)).buffer
    },
  } as Response
}

/**
 * Creates a mock Bun.file object
 */
const createMockBunFile = (options: {
  exists?: boolean
  content?: ArrayBuffer | string
}) => {
  const { exists = true, content = 'mock image data' } = options
  const arrayBuffer = typeof content === 'string'
    ? new TextEncoder().encode(content).buffer
    : content

  return {
    exists: async () => exists,
    arrayBuffer: async () => {
      if (!exists) throw new Error('File not found')
      return arrayBuffer
    },
  }
}

// =============================================================================
// Helper Function Tests (via indirect testing)
// Since helper functions aren't exported, we test them through the tool
// =============================================================================

// For direct testing of helper functions, we need to import the module
// and test the tool's behavior which uses these functions internally

describe('Vision Tool', () => {
  let originalFetch: typeof globalThis.fetch
  let originalBunFile: typeof Bun.file

  beforeEach(() => {
    originalFetch = globalThis.fetch
    originalBunFile = Bun.file
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    // @ts-expect-error - restoring original
    Bun.file = originalBunFile
  })

  // ===========================================================================
  // getMimeType function (tested indirectly)
  // ===========================================================================

  describe('getMimeType (indirect via file handling)', () => {
    test('handles jpg extension', async () => {
      // @ts-expect-error - mocking Bun.file
      Bun.file = () => createMockBunFile({ exists: true, content: 'test' })

      globalThis.fetch = mock(async () => createMockResponse({
        body: {
          message: { role: 'assistant', content: 'Image description' },
          done: true,
        },
      }))

      const { default: visionTool } = await import('../tools/vision')
      const result = await visionTool.execute({ image: '/path/to/image.jpg' })

      expect(result).toContain('Image Analysis')
      expect(result).not.toContain('Error')
    })

    test('handles jpeg extension', async () => {
      // @ts-expect-error - mocking Bun.file
      Bun.file = () => createMockBunFile({ exists: true, content: 'test' })

      globalThis.fetch = mock(async () => createMockResponse({
        body: {
          message: { role: 'assistant', content: 'Image description' },
          done: true,
        },
      }))

      const { default: visionTool } = await import('../tools/vision')
      const result = await visionTool.execute({ image: '/path/to/image.jpeg' })

      expect(result).toContain('Image Analysis')
    })

    test('handles png extension', async () => {
      // @ts-expect-error - mocking Bun.file
      Bun.file = () => createMockBunFile({ exists: true, content: 'test' })

      globalThis.fetch = mock(async () => createMockResponse({
        body: {
          message: { role: 'assistant', content: 'Image description' },
          done: true,
        },
      }))

      const { default: visionTool } = await import('../tools/vision')
      const result = await visionTool.execute({ image: '/path/to/image.png' })

      expect(result).toContain('Image Analysis')
    })

    test('handles gif extension', async () => {
      // @ts-expect-error - mocking Bun.file
      Bun.file = () => createMockBunFile({ exists: true, content: 'test' })

      globalThis.fetch = mock(async () => createMockResponse({
        body: {
          message: { role: 'assistant', content: 'Image description' },
          done: true,
        },
      }))

      const { default: visionTool } = await import('../tools/vision')
      const result = await visionTool.execute({ image: '/path/to/image.gif' })

      expect(result).toContain('Image Analysis')
    })

    test('handles webp extension', async () => {
      // @ts-expect-error - mocking Bun.file
      Bun.file = () => createMockBunFile({ exists: true, content: 'test' })

      globalThis.fetch = mock(async () => createMockResponse({
        body: {
          message: { role: 'assistant', content: 'Image description' },
          done: true,
        },
      }))

      const { default: visionTool } = await import('../tools/vision')
      const result = await visionTool.execute({ image: '/path/to/image.webp' })

      expect(result).toContain('Image Analysis')
    })

    test('returns error for unsupported extensions', async () => {
      const { default: visionTool } = await import('../tools/vision')
      const result = await visionTool.execute({ image: '/path/to/image.bmp' })

      expect(result).toContain('Error')
      expect(result).toContain('Unsupported image format')
      expect(result).toContain('.bmp')
    })
  })

  // ===========================================================================
  // isUrl function (tested indirectly)
  // ===========================================================================

  describe('isUrl (indirect via URL/file path handling)', () => {
    test('treats http:// as URL', async () => {
      const fetchedUrls: string[] = []
      globalThis.fetch = mock(async (url: string | URL | Request) => {
        const urlStr = url.toString()
        fetchedUrls.push(urlStr)
        if (urlStr.includes('api/chat')) {
          return createMockResponse({
            body: {
              message: { role: 'assistant', content: 'Description' },
              done: true,
            },
          })
        }
        return createMockResponse({
          headers: { 'content-type': 'image/jpeg' },
          body: new ArrayBuffer(10),
        })
      })

      const { default: visionTool } = await import('../tools/vision')
      await visionTool.execute({ image: 'http://example.com/image.jpg' })

      const imageUrlFetched = fetchedUrls.some(url => url.includes('http://example.com/image.jpg'))
      expect(imageUrlFetched).toBe(true)
    })

    test('treats https:// as URL', async () => {
      const fetchedUrls: string[] = []
      globalThis.fetch = mock(async (url: string | URL | Request) => {
        const urlStr = url.toString()
        fetchedUrls.push(urlStr)
        if (urlStr.includes('api/chat')) {
          return createMockResponse({
            body: {
              message: { role: 'assistant', content: 'Description' },
              done: true,
            },
          })
        }
        return createMockResponse({
          headers: { 'content-type': 'image/jpeg' },
          body: new ArrayBuffer(10),
        })
      })

      const { default: visionTool } = await import('../tools/vision')
      await visionTool.execute({ image: 'https://example.com/image.jpg' })

      const imageUrlFetched = fetchedUrls.some(url => url.includes('https://example.com/image.jpg'))
      expect(imageUrlFetched).toBe(true)
    })

    test('treats local paths as files (not URLs)', async () => {
      let bunFileWasCalled = false
      // @ts-expect-error - mocking Bun.file
      Bun.file = (_path: string) => {
        bunFileWasCalled = true
        return createMockBunFile({ exists: true, content: 'test' })
      }

      globalThis.fetch = mock(async () => createMockResponse({
        body: {
          message: { role: 'assistant', content: 'Description' },
          done: true,
        },
      }))

      const { default: visionTool } = await import('../tools/vision')
      await visionTool.execute({ image: '/path/to/local/image.jpg' })

      expect(bunFileWasCalled).toBe(true)
    })

    test('treats paths containing http (but not as protocol) as files', async () => {
      let bunFileWasCalled = false
      // @ts-expect-error - mocking Bun.file
      Bun.file = (_path: string) => {
        bunFileWasCalled = true
        return createMockBunFile({ exists: true, content: 'test' })
      }

      globalThis.fetch = mock(async () => createMockResponse({
        body: {
          message: { role: 'assistant', content: 'Description' },
          done: true,
        },
      }))

      const { default: visionTool } = await import('../tools/vision')
      await visionTool.execute({ image: '/var/www/http-files/image.jpg' })

      expect(bunFileWasCalled).toBe(true)
    })
  })

  // ===========================================================================
  // Input Validation
  // ===========================================================================

  describe('Input validation', () => {
    test('returns error for image without extension', async () => {
      const { default: visionTool } = await import('../tools/vision')
      const result = await visionTool.execute({ image: '/path/to/image-no-ext' })

      expect(result).toContain('Error')
      expect(result).toContain('Cannot determine image format')
    })

    test('returns error for unsupported image format', async () => {
      const { default: visionTool } = await import('../tools/vision')
      const result = await visionTool.execute({ image: '/path/to/image.tiff' })

      expect(result).toContain('Error')
      expect(result).toContain('Unsupported image format')
    })

    test('returns error for invalid history JSON', async () => {
      // @ts-expect-error - mocking Bun.file
      Bun.file = () => createMockBunFile({ exists: true, content: 'test' })

      const { default: visionTool } = await import('../tools/vision')
      const result = await visionTool.execute({
        image: '/path/to/image.jpg',
        history: 'not valid json',
      })

      expect(result).toContain('Error')
      expect(result).toContain('Invalid JSON')
    })

    test('returns error when history is not an array', async () => {
      // @ts-expect-error - mocking Bun.file
      Bun.file = () => createMockBunFile({ exists: true, content: 'test' })

      const { default: visionTool } = await import('../tools/vision')
      const result = await visionTool.execute({
        image: '/path/to/image.jpg',
        history: '{"role": "user", "content": "hello"}',
      })

      expect(result).toContain('Error')
      expect(result).toContain('must be a JSON array')
    })

    test('returns error when history message has invalid role', async () => {
      // @ts-expect-error - mocking Bun.file
      Bun.file = () => createMockBunFile({ exists: true, content: 'test' })

      const { default: visionTool } = await import('../tools/vision')
      const result = await visionTool.execute({
        image: '/path/to/image.jpg',
        history: '[{"role": "system", "content": "hello"}]',
      })

      expect(result).toContain('Error')
      expect(result).toContain('role')
    })

    test('returns error when history message content is not string', async () => {
      // @ts-expect-error - mocking Bun.file
      Bun.file = () => createMockBunFile({ exists: true, content: 'test' })

      const { default: visionTool } = await import('../tools/vision')
      const result = await visionTool.execute({
        image: '/path/to/image.jpg',
        history: '[{"role": "user", "content": 123}]',
      })

      expect(result).toContain('Error')
      expect(result).toContain('string content')
    })
  })

  // ===========================================================================
  // URL Handling (mock fetch)
  // ===========================================================================

  describe('URL handling', () => {
    test('successfully fetches and encodes URL image', async () => {
      const imageData = new Uint8Array([0x89, 0x50, 0x4e, 0x47]) // PNG magic bytes

      globalThis.fetch = mock(async (url: string | URL | Request) => {
        const urlStr = url.toString()
        if (urlStr.includes('api/chat')) {
          return createMockResponse({
            body: {
              message: { role: 'assistant', content: 'A beautiful image' },
              done: true,
            },
          })
        }
        return createMockResponse({
          headers: { 'content-type': 'image/png' },
          body: imageData.buffer,
        })
      })

      const { default: visionTool } = await import('../tools/vision')
      const result = await visionTool.execute({
        image: 'https://example.com/image.png',
      })

      expect(result).toContain('Image Analysis')
      expect(result).toContain('A beautiful image')
    })

    test('returns error on URL fetch failure', async () => {
      globalThis.fetch = mock(async (url: string | URL | Request) => {
        const urlStr = url.toString()
        if (urlStr.includes('example.com')) {
          return createMockResponse({
            ok: false,
            status: 404,
            statusText: 'Not Found',
          })
        }
        return createMockResponse({
          body: { message: { content: '' }, done: true },
        })
      })

      const { default: visionTool } = await import('../tools/vision')
      const result = await visionTool.execute({
        image: 'https://example.com/missing.jpg',
      })

      expect(result).toContain('Error')
      expect(result).toContain('Failed to fetch image')
      expect(result).toContain('404')
    })

    test('uses extension fallback when content-type header is missing', async () => {
      const imageData = new Uint8Array([0xff, 0xd8, 0xff]) // JPEG magic

      globalThis.fetch = mock(async (url: string | URL | Request) => {
        const urlStr = url.toString()
        if (urlStr.includes('api/chat')) {
          return createMockResponse({
            body: {
              message: { role: 'assistant', content: 'Description' },
              done: true,
            },
          })
        }
        // No content-type header
        return createMockResponse({
          headers: {},
          body: imageData.buffer,
        })
      })

      const { default: visionTool } = await import('../tools/vision')
      const result = await visionTool.execute({
        image: 'https://example.com/image.jpg',
      })

      expect(result).toContain('Image Analysis')
      expect(result).not.toContain('Error')
    })

    test('handles network error during URL fetch', async () => {
      globalThis.fetch = mock(async (url: string | URL | Request) => {
        const urlStr = url.toString()
        if (urlStr.includes('example.com')) {
          throw new Error('Network error: ECONNREFUSED')
        }
        return createMockResponse({
          body: { message: { content: '' }, done: true },
        })
      })

      const { default: visionTool } = await import('../tools/vision')
      const result = await visionTool.execute({
        image: 'https://example.com/image.jpg',
      })

      expect(result).toContain('Error')
      expect(result).toContain('Failed to fetch image from URL')
    })
  })

  // ===========================================================================
  // File Handling (mock Bun.file)
  // ===========================================================================

  describe('File handling', () => {
    test('successfully reads and encodes local file', async () => {
      const imageData = new TextEncoder().encode('fake image data')

      // @ts-expect-error - mocking Bun.file
      Bun.file = () => createMockBunFile({
        exists: true,
        content: imageData.buffer,
      })

      globalThis.fetch = mock(async () => createMockResponse({
        body: {
          message: { role: 'assistant', content: 'Local image analysis' },
          done: true,
        },
      }))

      const { default: visionTool } = await import('../tools/vision')
      const result = await visionTool.execute({
        image: '/path/to/local/image.png',
      })

      expect(result).toContain('Image Analysis')
      expect(result).toContain('Local image analysis')
    })

    test('returns error when file not found', async () => {
      // @ts-expect-error - mocking Bun.file
      Bun.file = () => createMockBunFile({ exists: false })

      const { default: visionTool } = await import('../tools/vision')
      const result = await visionTool.execute({
        image: '/path/to/missing/image.jpg',
      })

      expect(result).toContain('Error')
      expect(result).toContain('File not found')
    })

    test('handles file read error', async () => {
      // @ts-expect-error - mocking Bun.file
      Bun.file = () => ({
        exists: async () => true,
        arrayBuffer: async () => {
          throw new Error('Permission denied')
        },
      })

      const { default: visionTool } = await import('../tools/vision')
      const result = await visionTool.execute({
        image: '/path/to/protected/image.jpg',
      })

      expect(result).toContain('Error')
      expect(result).toContain('Failed to read image file')
    })
  })

  // ===========================================================================
  // Ollama API (mock fetch)
  // ===========================================================================

  describe('Ollama API', () => {
    test('successful API response is formatted correctly', async () => {
      // @ts-expect-error - mocking Bun.file
      Bun.file = () => createMockBunFile({ exists: true, content: 'test' })

      globalThis.fetch = mock(async () => createMockResponse({
        body: {
          model: 'llava',
          created_at: '2024-01-01T00:00:00Z',
          message: {
            role: 'assistant',
            content: 'This image shows a sunset over mountains.',
          },
          done: true,
        },
      }))

      const { default: visionTool } = await import('../tools/vision')
      const result = await visionTool.execute({
        image: '/path/to/image.jpg',
        question: 'What is in this image?',
        model: 'llava',
      })

      expect(result).toContain('## Image Analysis')
      expect(result).toContain('**Model:** llava')
      expect(result).toContain('**Image:** /path/to/image.jpg')
      expect(result).toContain('### Response')
      expect(result).toContain('This image shows a sunset over mountains.')
    })

    test('returns error on API connection failure', async () => {
      // @ts-expect-error - mocking Bun.file
      Bun.file = () => createMockBunFile({ exists: true, content: 'test' })

      globalThis.fetch = mock(async () => {
        throw new Error('fetch failed: ECONNREFUSED')
      })

      const { default: visionTool } = await import('../tools/vision')
      const result = await visionTool.execute({
        image: '/path/to/image.jpg',
      })

      expect(result).toContain('Error')
      expect(result).toContain('Cannot connect to Ollama')
    })

    test('returns error when API returns error response (model not found)', async () => {
      // @ts-expect-error - mocking Bun.file
      Bun.file = () => createMockBunFile({ exists: true, content: 'test' })

      globalThis.fetch = mock(async () => createMockResponse({
        ok: false,
        status: 404,
        body: { error: 'model "unknown-model" not found' },
      }))

      const { default: visionTool } = await import('../tools/vision')
      const result = await visionTool.execute({
        image: '/path/to/image.jpg',
        model: 'unknown-model',
      })

      expect(result).toContain('Error')
      expect(result).toContain('Ollama API error')
      expect(result).toContain('not found')
    })

    test('handles non-JSON error response from API', async () => {
      // @ts-expect-error - mocking Bun.file
      Bun.file = () => createMockBunFile({ exists: true, content: 'test' })

      globalThis.fetch = mock(async () => createMockResponse({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        body: 'Internal server error occurred',
      }))

      const { default: visionTool } = await import('../tools/vision')
      const result = await visionTool.execute({
        image: '/path/to/image.jpg',
      })

      expect(result).toContain('Error')
      expect(result).toContain('Ollama API error')
      expect(result).toContain('500')
    })
  })

  // ===========================================================================
  // History Handling
  // ===========================================================================

  describe('History handling', () => {
    test('empty history works correctly', async () => {
      // @ts-expect-error - mocking Bun.file
      Bun.file = () => createMockBunFile({ exists: true, content: 'test' })

      let capturedBody: unknown = null
      globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
        if (init?.body) {
          capturedBody = JSON.parse(init.body as string)
        }
        return createMockResponse({
          body: {
            message: { role: 'assistant', content: 'Response' },
            done: true,
          },
        })
      })

      const { default: visionTool } = await import('../tools/vision')
      await visionTool.execute({
        image: '/path/to/image.jpg',
        history: '',
      })

      expect(capturedBody).toBeDefined()
      const body = capturedBody as { messages: Array<{ role: string; content: string }> }
      expect(body.messages).toHaveLength(1)
      expect(body.messages[0].role).toBe('user')
    })

    test('valid history JSON is parsed and included in request', async () => {
      // @ts-expect-error - mocking Bun.file
      Bun.file = () => createMockBunFile({ exists: true, content: 'test' })

      let capturedBody: unknown = null
      globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
        if (init?.body) {
          capturedBody = JSON.parse(init.body as string)
        }
        return createMockResponse({
          body: {
            message: { role: 'assistant', content: 'Follow-up response' },
            done: true,
          },
        })
      })

      const { default: visionTool } = await import('../tools/vision')
      const history = JSON.stringify([
        { role: 'user', content: 'What is this?' },
        { role: 'assistant', content: 'It is a cat.' },
      ])

      await visionTool.execute({
        image: '/path/to/image.jpg',
        question: 'What color is the cat?',
        history,
      })

      expect(capturedBody).toBeDefined()
      const body = capturedBody as { messages: Array<{ role: string; content: string; images?: string[] }> }
      // First message should have image
      expect(body.messages[0].images).toBeDefined()
      expect(body.messages[0].content).toBe('What is this?')
      // Second message (assistant response)
      expect(body.messages[1].role).toBe('assistant')
      expect(body.messages[1].content).toBe('It is a cat.')
      // Third message (current question)
      expect(body.messages[2].role).toBe('user')
      expect(body.messages[2].content).toBe('What color is the cat?')
    })

    test('history messages are properly ordered', async () => {
      // @ts-expect-error - mocking Bun.file
      Bun.file = () => createMockBunFile({ exists: true, content: 'test' })

      let capturedBody: unknown = null
      globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
        if (init?.body) {
          capturedBody = JSON.parse(init.body as string)
        }
        return createMockResponse({
          body: {
            message: { role: 'assistant', content: 'Final response' },
            done: true,
          },
        })
      })

      const { default: visionTool } = await import('../tools/vision')
      const history = JSON.stringify([
        { role: 'user', content: 'First question' },
        { role: 'assistant', content: 'First answer' },
        { role: 'user', content: 'Second question' },
        { role: 'assistant', content: 'Second answer' },
      ])

      await visionTool.execute({
        image: '/path/to/image.jpg',
        question: 'Third question',
        history,
      })

      const body = capturedBody as { messages: Array<{ role: string; content: string }> }
      expect(body.messages).toHaveLength(5)
      expect(body.messages[0].content).toBe('First question')
      expect(body.messages[1].content).toBe('First answer')
      expect(body.messages[2].content).toBe('Second question')
      expect(body.messages[3].content).toBe('Second answer')
      expect(body.messages[4].content).toBe('Third question')
    })

    test('handles history starting with assistant message', async () => {
      // @ts-expect-error - mocking Bun.file
      Bun.file = () => createMockBunFile({ exists: true, content: 'test' })

      let capturedBody: unknown = null
      globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
        if (init?.body) {
          capturedBody = JSON.parse(init.body as string)
        }
        return createMockResponse({
          body: {
            message: { role: 'assistant', content: 'Response' },
            done: true,
          },
        })
      })

      const { default: visionTool } = await import('../tools/vision')
      const history = JSON.stringify([
        { role: 'assistant', content: 'Previous context' },
      ])

      await visionTool.execute({
        image: '/path/to/image.jpg',
        question: 'My question',
        history,
      })

      const body = capturedBody as { messages: Array<{ role: string; content: string; images?: string[] }> }
      // When history starts with assistant, the question comes first with image
      expect(body.messages[0].role).toBe('user')
      expect(body.messages[0].content).toBe('My question')
      expect(body.messages[0].images).toBeDefined()
    })
  })

  // ===========================================================================
  // Default Parameter Tests
  // ===========================================================================

  describe('Default parameters', () => {
    test('uses default model (llava) when not specified', async () => {
      // @ts-expect-error - mocking Bun.file
      Bun.file = () => createMockBunFile({ exists: true, content: 'test' })

      let capturedBody: unknown = null
      globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
        if (init?.body) {
          capturedBody = JSON.parse(init.body as string)
        }
        return createMockResponse({
          body: {
            message: { role: 'assistant', content: 'Description' },
            done: true,
          },
        })
      })

      const { default: visionTool } = await import('../tools/vision')
      await visionTool.execute({ image: '/path/to/image.jpg' })

      const body = capturedBody as { model: string }
      expect(body.model).toBe('llava')
    })

    test('uses default question when not specified', async () => {
      // @ts-expect-error - mocking Bun.file
      Bun.file = () => createMockBunFile({ exists: true, content: 'test' })

      let capturedBody: unknown = null
      globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
        if (init?.body) {
          capturedBody = JSON.parse(init.body as string)
        }
        return createMockResponse({
          body: {
            message: { role: 'assistant', content: 'Description' },
            done: true,
          },
        })
      })

      const { default: visionTool } = await import('../tools/vision')
      await visionTool.execute({ image: '/path/to/image.jpg' })

      const body = capturedBody as { messages: Array<{ content: string }> }
      expect(body.messages[0].content).toBe('Describe this image in detail.')
    })

    test('uses custom model when specified', async () => {
      // @ts-expect-error - mocking Bun.file
      Bun.file = () => createMockBunFile({ exists: true, content: 'test' })

      let capturedBody: unknown = null
      globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
        if (init?.body) {
          capturedBody = JSON.parse(init.body as string)
        }
        return createMockResponse({
          body: {
            message: { role: 'assistant', content: 'Description' },
            done: true,
          },
        })
      })

      const { default: visionTool } = await import('../tools/vision')
      await visionTool.execute({
        image: '/path/to/image.jpg',
        model: 'llava:13b',
      })

      const body = capturedBody as { model: string }
      expect(body.model).toBe('llava:13b')
    })

    test('uses custom question when specified', async () => {
      // @ts-expect-error - mocking Bun.file
      Bun.file = () => createMockBunFile({ exists: true, content: 'test' })

      let capturedBody: unknown = null
      globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
        if (init?.body) {
          capturedBody = JSON.parse(init.body as string)
        }
        return createMockResponse({
          body: {
            message: { role: 'assistant', content: 'Cat detected' },
            done: true,
          },
        })
      })

      const { default: visionTool } = await import('../tools/vision')
      await visionTool.execute({
        image: '/path/to/image.jpg',
        question: 'Is there a cat in this image?',
      })

      const body = capturedBody as { messages: Array<{ content: string }> }
      expect(body.messages[0].content).toBe('Is there a cat in this image?')
    })
  })
})
