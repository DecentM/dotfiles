import { tool } from '@opencode-ai/plugin'

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_MODEL = 'llava'
const DEFAULT_QUESTION = 'Describe this image in detail.'
const SUPPORTED_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp'] as const
const DEFAULT_OLLAMA_HOST = 'http://ollama.cluster.arpa:11434'
const MAX_IMAGE_SIZE_MB = 20
const URL_FETCH_TIMEOUT_SECONDS = 30
const OLLAMA_API_TIMEOUT_SECONDS = 120

// =============================================================================
// Types
// =============================================================================

/**
 * Unified message type for chat history and current messages.
 * Images are optional to support both history messages and current queries.
 */
interface Message {
  role: 'user' | 'assistant'
  content: string
  images?: string[]
}

interface OllamaChatRequest {
  model: string
  messages: Message[]
  stream: false
}

interface OllamaChatResponse {
  model: string
  created_at: string
  message: {
    role: 'assistant'
    content: string
  }
  done: boolean
  total_duration?: number
  load_duration?: number
  prompt_eval_count?: number
  prompt_eval_duration?: number
  eval_count?: number
  eval_duration?: number
}

interface OllamaErrorResponse {
  error: string
}

/**
 * Discriminated union for operations that can succeed or fail.
 * Provides type-safe error handling throughout the codebase.
 */
type Result<T> =
  | { success: true; data: T }
  | { success: false; error: string }

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Get MIME type from file extension
 */
const getMimeType = (extension: string): string => {
  const mimeTypes: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
  }
  return mimeTypes[extension.toLowerCase()] ?? 'application/octet-stream'
}

/**
 * Extract and validate file extension from path or URL.
 * Returns null if extension is invalid or unsupported.
 */
const getExtension = (pathOrUrl: string): string | null => {
  const urlPath = pathOrUrl.split('?')[0] // Remove query params
  const lastDot = urlPath.lastIndexOf('.')
  if (lastDot === -1) return null

  const extension = urlPath.substring(lastDot + 1).toLowerCase()
  return SUPPORTED_EXTENSIONS.includes(extension as typeof SUPPORTED_EXTENSIONS[number])
    ? extension
    : null
}

/**
 * Fetch image from URL and return base64 encoded string
 */
const fetchImageFromUrl = async (
  url: string
): Promise<Result<{ base64: string; mimeType: string }>> => {
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), URL_FETCH_TIMEOUT_SECONDS * 1000)

    let response: Response
    try {
      response = await fetch(url, { signal: controller.signal })
    } finally {
      clearTimeout(timeoutId)
    }

    if (!response.ok) {
      return { success: false, error: `Failed to fetch image: HTTP ${response.status} ${response.statusText}` }
    }

    const contentLength = response.headers.get('content-length')
    if (contentLength !== null) {
      const size = Number.parseInt(contentLength, 10)
      if (!Number.isNaN(size) && size > MAX_IMAGE_SIZE_MB * 1024 * 1024) {
        return {
          success: false,
          error: `Image too large: ${Math.round(size / 1024 / 1024)}MB exceeds maximum of ${MAX_IMAGE_SIZE_MB}MB`,
        }
      }
    }

    const contentType = response.headers.get('content-type') ?? ''
    const arrayBuffer = await response.arrayBuffer()

    if (arrayBuffer.byteLength > MAX_IMAGE_SIZE_MB * 1024 * 1024) {
      return {
        success: false,
        error: `Image too large: ${Math.round(arrayBuffer.byteLength / 1024 / 1024)}MB exceeds maximum of ${MAX_IMAGE_SIZE_MB}MB`,
      }
    }

    const base64 = Buffer.from(arrayBuffer).toString('base64')

    let mimeType = contentType.split(';')[0].trim()
    if (!mimeType || mimeType === 'application/octet-stream') {
      const ext = getExtension(url)
      mimeType = ext ? getMimeType(ext) : 'application/octet-stream'
    }

    return { success: true, data: { base64, mimeType } }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    if (error instanceof Error && error.name === 'AbortError') {
      return { success: false, error: `Image fetch timed out after ${URL_FETCH_TIMEOUT_SECONDS} seconds` }
    }

    return { success: false, error: `Failed to fetch image from URL: ${message}` }
  }
}

/**
 * Read image from local file and return base64 encoded string
 */
const readImageFromFile = async (
  filePath: string
): Promise<Result<{ base64: string; mimeType: string }>> => {
  try {
    const file = Bun.file(filePath)
    const exists = await file.exists()

    if (!exists) {
      return { success: false, error: `File not found: ${filePath}` }
    }

    const arrayBuffer = await file.arrayBuffer()
    const base64 = Buffer.from(arrayBuffer).toString('base64')
    const ext = getExtension(filePath)
    const mimeType = ext ? getMimeType(ext) : 'application/octet-stream'

    return { success: true, data: { base64, mimeType } }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { success: false, error: `Failed to read image file: ${message}` }
  }
}

/**
 * Load image from path or URL
 */
const loadImage = async (
  image: string
): Promise<Result<{ base64: string; mimeType: string }>> => {
  const isUrl = image.startsWith('http://') || image.startsWith('https://')
  return isUrl ? fetchImageFromUrl(image) : readImageFromFile(image)
}

/**
 * Parse history JSON string into messages array
 */
const parseHistory = (historyJson: string | undefined): Result<Message[]> => {
  if (!historyJson || historyJson.trim() === '') {
    return { success: true, data: [] }
  }

  try {
    const parsed = JSON.parse(historyJson) as unknown

    if (!Array.isArray(parsed)) {
      return { success: false, error: 'History must be a JSON array' }
    }

    for (const msg of parsed) {
      if (typeof msg !== 'object' || msg === null) {
        return { success: false, error: 'Each history message must be an object' }
      }
      if (msg.role !== 'user' && msg.role !== 'assistant') {
        return { success: false, error: 'Each history message must have role "user" or "assistant"' }
      }
      if (typeof msg.content !== 'string') {
        return { success: false, error: 'Each history message must have a string content' }
      }
    }

    return { success: true, data: parsed as Message[] }
  } catch {
    return { success: false, error: 'Invalid JSON in history parameter' }
  }
}

/**
 * Call Ollama chat API
 */
const callOllamaChat = async (
  model: string,
  messages: Message[]
): Promise<Result<OllamaChatResponse>> => {
  const host = process.env.OLLAMA_HOST ?? DEFAULT_OLLAMA_HOST
  const endpoint = `${host}/api/chat`

  const request: OllamaChatRequest = {
    model,
    messages,
    stream: false,
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), OLLAMA_API_TIMEOUT_SECONDS * 1000)

  try {
    let response: Response
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timeoutId)
    }

    if (!response.ok) {
      const text = await response.text()
      try {
        const errorData = JSON.parse(text) as OllamaErrorResponse
        return { success: false, error: `Ollama API error: ${errorData.error}` }
      } catch {
        return { success: false, error: `Ollama API error: HTTP ${response.status} - ${text}` }
      }
    }

    const data = (await response.json()) as OllamaChatResponse
    return { success: true, data }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    if (error instanceof Error && error.name === 'AbortError') {
      return { success: false, error: `Ollama API request timed out after ${OLLAMA_API_TIMEOUT_SECONDS} seconds` }
    }

    if (message.includes('ECONNREFUSED') || message.includes('fetch failed')) {
      return { success: false, error: `Cannot connect to Ollama at ${host}. Is Ollama running?` }
    }

    return { success: false, error: `Ollama API request failed: ${message}` }
  }
}

/**
 * Build messages array for Ollama API from history and current query.
 * Simplifies complex conditional logic into a linear approach:
 * - Returns history messages as-is
 * - Appends current question with image attached
 */
const buildMessages = (
  history: Message[],
  question: string,
  imageBase64: string
): Message[] => {
  return [
    ...history,
    { role: 'user', content: question, images: [imageBase64] },
  ]
}

/**
 * Format response as markdown
 */
const formatResponse = (
  image: string,
  model: string,
  response: string,
  isError: boolean
): string => {
  const header = isError ? '## Image Analysis Error' : '## Image Analysis'
  const statusLabel = isError ? 'Error' : 'Response'

  return `${header}

**Model:** ${model}
**Image:** ${image}

### ${statusLabel}
${isError ? response : response}`
}

// =============================================================================
// Main Tool
// =============================================================================

export default tool({
  description: `Analyze images using AI vision models via Ollama API.

Features:
- Supports local file paths and URLs
- Multi-turn conversation with history parameter
- Configurable vision model (default: llava)
- Base64 encodes images automatically

Supported formats: ${SUPPORTED_EXTENSIONS.join(', ')}`,
  args: {
    image: tool.schema.string().describe('File path (local) or URL of the image to analyze'),
    question: tool.schema
      .string()
      .optional()
      .describe(`Question to ask about the image (default: "${DEFAULT_QUESTION}")`),
    history: tool.schema
      .string()
      .optional()
      .describe(
        'JSON array of previous conversation messages for multi-turn conversations. Format: [{"role": "user"|"assistant", "content": "..."}]'
      ),
    model: tool.schema
      .string()
      .optional()
      .describe(`Vision model to use (default: "${DEFAULT_MODEL}")`),
  },
  async execute(args) {
    const { image, question = DEFAULT_QUESTION, history, model = DEFAULT_MODEL } = args

    // Validate image extension
    const ext = getExtension(image)
    if (!ext) {
      return formatResponse(image, model, 'Cannot determine image format. File must have an extension.', true)
    }

    // Load and encode the image
    const imageResult = await loadImage(image)
    if (!imageResult.success) {
      return formatResponse(image, model, imageResult.error, true)
    }

    // Parse history if provided
    const historyResult = parseHistory(history)
    if (!historyResult.success) {
      return formatResponse(image, model, historyResult.error, true)
    }

    // Build messages array with simplified linear approach
    const messages = buildMessages(historyResult.data, question, imageResult.data.base64)

    // Call Ollama API
    const response = await callOllamaChat(model, messages)
    if (!response.success) {
      return formatResponse(image, model, response.error, true)
    }

    return formatResponse(image, model, response.data.message.content, false)
  },
})

// Export helper functions for direct testing
export {
  getMimeType,
  getExtension,
  loadImage,
  parseHistory,
  buildMessages,
  formatResponse,
}