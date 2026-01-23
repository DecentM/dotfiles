#!/usr/bin/env node

import { createInterface } from 'node:readline'

// Configuration from environment variables
const FLARESOLVERR_URL = process.env.FLARESOLVERR_URL || 'http://127.0.0.1:8191'
const FLARESOLVERR_TIMEOUT = parseInt(process.env.FLARESOLVERR_TIMEOUT || '60000', 10)
const FLARESOLVERR_MAX_TIMEOUT = parseInt(process.env.FLARESOLVERR_MAX_TIMEOUT || '180000', 10)

const log = (...args) => console.error('[mcp-flaresolverr]', ...args)

log(`Flaresolverr URL: ${FLARESOLVERR_URL}`)
log(`Default timeout: ${FLARESOLVERR_TIMEOUT}ms`)
log(`Max timeout: ${FLARESOLVERR_MAX_TIMEOUT}ms`)

const SERVER_INFO = {
  name: 'mcp-flaresolverr',
  version: '1.0.0',
}

const TOOLS = [
  {
    name: 'flaresolverr_get',
    description:
      'Fetch a URL with Cloudflare bypass using Flaresolverr. Returns the HTML content, cookies, and headers after bypassing Cloudflare protection.',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The URL to fetch',
        },
        session: {
          type: 'string',
          description: 'Optional session ID for persistent browser sessions',
        },
        maxTimeout: {
          type: 'number',
          description: 'Maximum timeout in milliseconds (default: 60000)',
        },
        returnScreenshot: {
          type: 'boolean',
          description: 'Return a base64 screenshot of the page (default: false)',
        },
        returnOnlyCookies: {
          type: 'boolean',
          description: 'Only return cookies, not the full page content (default: false)',
        },
        proxy: {
          type: 'string',
          description: 'Proxy URL to use for the request (e.g., http://user:pass@host:port)',
        },
        disableMedia: {
          type: 'boolean',
          description:
            'Disable loading of media (images, CSS, fonts) for faster responses (default: false)',
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'flaresolverr_post',
    description:
      'Send a POST request with Cloudflare bypass using Flaresolverr. Returns the HTML content, cookies, and headers after bypassing Cloudflare protection.',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The URL to send the POST request to',
        },
        postData: {
          type: 'string',
          description: 'The POST data to send (URL-encoded form data or JSON string)',
        },
        session: {
          type: 'string',
          description: 'Optional session ID for persistent browser sessions',
        },
        maxTimeout: {
          type: 'number',
          description: 'Maximum timeout in milliseconds (default: 60000)',
        },
        returnScreenshot: {
          type: 'boolean',
          description: 'Return a base64 screenshot of the page (default: false)',
        },
        returnOnlyCookies: {
          type: 'boolean',
          description: 'Only return cookies, not the full page content (default: false)',
        },
        proxy: {
          type: 'string',
          description: 'Proxy URL to use for the request (e.g., http://user:pass@host:port)',
        },
      },
      required: ['url', 'postData'],
    },
  },
  {
    name: 'flaresolverr_session_create',
    description:
      'Create a persistent browser session in Flaresolverr. Sessions maintain cookies and browser state across requests.',
    inputSchema: {
      type: 'object',
      properties: {
        session: {
          type: 'string',
          description: 'Unique session identifier',
        },
        proxy: {
          type: 'string',
          description: 'Proxy URL to use for this session (e.g., http://user:pass@host:port)',
        },
      },
      required: ['session'],
    },
  },
  {
    name: 'flaresolverr_session_list',
    description: 'List all active Flaresolverr browser sessions.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'flaresolverr_session_destroy',
    description: 'Destroy a Flaresolverr browser session to free resources.',
    inputSchema: {
      type: 'object',
      properties: {
        session: {
          type: 'string',
          description: 'Session identifier to destroy',
        },
      },
      required: ['session'],
    },
  },
]

/**
 * Validate URL format
 */
function isValidUrl(urlString) {
  try {
    const url = new URL(urlString)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * Clamp timeout to valid range
 */
function clampTimeout(timeout) {
  if (typeof timeout !== 'number' || isNaN(timeout)) {
    return FLARESOLVERR_TIMEOUT
  }
  return Math.min(Math.max(timeout, 1000), FLARESOLVERR_MAX_TIMEOUT)
}

/**
 * Make a request to the Flaresolverr API
 */
async function flaresolverrRequest(command, params = {}) {
  const body = {
    cmd: command,
    ...params,
  }

  log(`Sending command: ${command}`)

  const response = await fetch(`${FLARESOLVERR_URL}/v1`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Flaresolverr HTTP ${response.status}: ${text}`)
  }

  const data = await response.json()

  if (data.status !== 'ok') {
    throw new Error(data.message || 'Flaresolverr request failed')
  }

  return data
}

/**
 * Format the Flaresolverr response for MCP output
 */
function formatGetPostResponse(data) {
  const solution = data.solution || {}
  const duration = data.endTimestamp - data.startTimestamp

  const result = {
    success: true,
    url: solution.url,
    status: solution.status,
    duration_ms: duration,
    userAgent: solution.userAgent,
    cookies: solution.cookies || [],
    headers: solution.headers || {},
  }

  // Include response HTML unless returnOnlyCookies was true
  if (solution.response) {
    result.response = solution.response
  }

  // Include screenshot if present
  if (solution.screenshot) {
    result.screenshot = solution.screenshot
  }

  return result
}

/**
 * Handle flaresolverr_get tool
 */
async function handleGet(args) {
  const { url, session, maxTimeout, returnScreenshot, returnOnlyCookies, proxy, disableMedia } =
    args

  if (!url) {
    throw new Error('url is required')
  }

  if (!isValidUrl(url)) {
    throw new Error('Invalid URL format. Must be http:// or https://')
  }

  const params = {
    url,
    maxTimeout: clampTimeout(maxTimeout),
  }

  if (session) params.session = session
  if (returnScreenshot) params.returnScreenshot = true
  if (returnOnlyCookies) params.returnOnlyCookies = true
  if (proxy) params.proxy = proxy
  if (disableMedia) params.disableMedia = true

  const data = await flaresolverrRequest('request.get', params)
  return formatGetPostResponse(data)
}

/**
 * Handle flaresolverr_post tool
 */
async function handlePost(args) {
  const { url, postData, session, maxTimeout, returnScreenshot, returnOnlyCookies, proxy } = args

  if (!url) {
    throw new Error('url is required')
  }

  if (!postData) {
    throw new Error('postData is required')
  }

  if (!isValidUrl(url)) {
    throw new Error('Invalid URL format. Must be http:// or https://')
  }

  const params = {
    url,
    postData,
    maxTimeout: clampTimeout(maxTimeout),
  }

  if (session) params.session = session
  if (returnScreenshot) params.returnScreenshot = true
  if (returnOnlyCookies) params.returnOnlyCookies = true
  if (proxy) params.proxy = proxy

  const data = await flaresolverrRequest('request.post', params)
  return formatGetPostResponse(data)
}

/**
 * Handle flaresolverr_session_create tool
 */
async function handleSessionCreate(args) {
  const { session, proxy } = args

  if (!session) {
    throw new Error('session is required')
  }

  if (typeof session !== 'string' || session.trim() === '') {
    throw new Error('session must be a non-empty string')
  }

  const params = { session: session.trim() }
  if (proxy) params.proxy = proxy

  await flaresolverrRequest('sessions.create', params)

  return {
    success: true,
    message: `Session '${session}' created successfully`,
    session: session.trim(),
  }
}

/**
 * Handle flaresolverr_session_list tool
 */
async function handleSessionList() {
  const data = await flaresolverrRequest('sessions.list')

  return {
    success: true,
    sessions: data.sessions || [],
    count: (data.sessions || []).length,
  }
}

/**
 * Handle flaresolverr_session_destroy tool
 */
async function handleSessionDestroy(args) {
  const { session } = args

  if (!session) {
    throw new Error('session is required')
  }

  if (typeof session !== 'string' || session.trim() === '') {
    throw new Error('session must be a non-empty string')
  }

  await flaresolverrRequest('sessions.destroy', { session: session.trim() })

  return {
    success: true,
    message: `Session '${session}' destroyed successfully`,
  }
}

function writeResponse(data) {
  process.stdout.write(JSON.stringify(data) + '\n')
}

function writeError(id, code, message) {
  writeResponse({
    jsonrpc: '2.0',
    id,
    error: { code, message },
  })
}

function handleInitialize(message) {
  log('Handling initialize')
  writeResponse({
    jsonrpc: '2.0',
    id: message.id,
    result: {
      protocolVersion: '2024-11-05',
      capabilities: {
        tools: {},
      },
      serverInfo: SERVER_INFO,
    },
  })
}

function handleInitialized() {
  log('Received initialized notification')
}

function handleToolsList(message) {
  log('Handling tools/list')
  writeResponse({
    jsonrpc: '2.0',
    id: message.id,
    result: { tools: TOOLS },
  })
}

async function handleToolsCall(message) {
  const { name, arguments: args } = message.params
  log(`Handling tools/call: ${name}`)

  try {
    let result

    switch (name) {
      case 'flaresolverr_get':
        result = await handleGet(args || {})
        break

      case 'flaresolverr_post':
        result = await handlePost(args || {})
        break

      case 'flaresolverr_session_create':
        result = await handleSessionCreate(args || {})
        break

      case 'flaresolverr_session_list':
        result = await handleSessionList()
        break

      case 'flaresolverr_session_destroy':
        result = await handleSessionDestroy(args || {})
        break

      default:
        throw new Error(`Unknown tool: ${name}`)
    }

    const resultText = typeof result === 'string' ? result : JSON.stringify(result, null, 2)

    writeResponse({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        content: [
          {
            type: 'text',
            text: resultText,
          },
        ],
      },
    })

    log(`Tool ${name} completed successfully`)
  } catch (error) {
    log(`Error calling tool ${name}: ${error.message}`)
    writeError(message.id, -32000, `Tool call failed: ${error.message}`)
  }
}

async function processMessage(message) {
  const { method, id } = message

  switch (method) {
    case 'initialize':
      handleInitialize(message)
      break

    case 'initialized':
      handleInitialized()
      break

    case 'notifications/initialized':
      handleInitialized()
      break

    case 'tools/list':
      handleToolsList(message)
      break

    case 'tools/call':
      await handleToolsCall(message)
      break

    default:
      if (id !== undefined) {
        log(`Unknown method: ${method}`)
        writeError(id, -32601, `Method not found: ${method}`)
      } else {
        log(`Ignoring unknown notification: ${method}`)
      }
  }
}

async function main() {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  })

  for await (const line of rl) {
    const trimmed = line.trim()
    if (!trimmed) continue

    try {
      const message = JSON.parse(trimmed)
      log(`-> ${message.method || 'response'} (id: ${message.id})`)
      await processMessage(message)
    } catch (error) {
      log(`Failed to parse input: ${error.message}`)
    }
  }

  log('stdin closed, exiting')
}

process.on('SIGINT', () => {
  log('Received SIGINT, exiting')
  process.exit(0)
})

process.on('SIGTERM', () => {
  log('Received SIGTERM, exiting')
  process.exit(0)
})

main().catch((error) => {
  log(`Fatal error: ${error.message}`)
  process.exit(1)
})
