#!/usr/bin/env node

import { createInterface } from 'node:readline'
import { request as httpsRequest } from 'node:https'
import { request as httpRequest } from 'node:http'
import { SocksProxyAgent } from 'socks-proxy-agent'

const MCP_REMOTE_URL = process.env.MCP_REMOTE_URL
const SOCKS_PROXY = process.env.SOCKS_PROXY
const MCP_TOKEN = process.env.MCP_TOKEN
// Strip this prefix from tool names to avoid double-prefixing
// (e.g., if remote returns "tool_get" and MCP is named "tool", we'd get "tool_tool_get")
const MCP_STRIP_PREFIX = process.env.MCP_STRIP_PREFIX || ''

if (!MCP_REMOTE_URL) {
  console.error('Error: MCP_REMOTE_URL environment variable is required')
  process.exit(1)
}

if (!SOCKS_PROXY) {
  console.error('Error: SOCKS_PROXY environment variable is required')
  process.exit(1)
}

const log = (...args) => console.error('[mcp-socks-proxy]', ...args)

log(`Connecting to ${MCP_REMOTE_URL} via ${SOCKS_PROXY}`)
if (MCP_TOKEN) {
  log('Using MCP_TOKEN for authentication')
}
if (MCP_STRIP_PREFIX) {
  log(`Stripping prefix "${MCP_STRIP_PREFIX}" from tool names`)
}

const remoteUrl = new URL(MCP_REMOTE_URL)
const isHttps = remoteUrl.protocol === 'https:'
const requestFn = isHttps ? httpsRequest : httpRequest

const socksAgent = new SocksProxyAgent(SOCKS_PROXY)

const SERVER_INFO = {
  name: 'mcp-proxy',
  version: '1.0.0',
}

let cachedTools = null

function buildHeaders(contentLength = 0) {
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }

  if (contentLength > 0) {
    headers['Content-Length'] = contentLength
  }

  if (MCP_TOKEN) {
    headers['Authorization'] = `Bearer ${MCP_TOKEN}`
  }

  return headers
}

function makeGetRequest(path) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: remoteUrl.hostname,
      port: remoteUrl.port || (isHttps ? 443 : 80),
      path: path,
      method: 'GET',
      headers: buildHeaders(),
      agent: socksAgent,
    }

    const req = requestFn(options, (res) => {
      const chunks = []

      res.on('data', (chunk) => chunks.push(chunk))

      res.on('end', () => {
        const data = Buffer.concat(chunks).toString('utf8')
        resolve({
          status: res.statusCode,
          data,
        })
      })

      res.on('error', reject)
    })

    req.on('error', reject)
    req.end()
  })
}

/**
 * Make an HTTP(S) POST request through the SOCKS proxy
 */
function makePostRequest(path, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(body)
    const options = {
      hostname: remoteUrl.hostname,
      port: remoteUrl.port || (isHttps ? 443 : 80),
      path: path,
      method: 'POST',
      headers: buildHeaders(Buffer.byteLength(bodyStr)),
      agent: socksAgent,
    }

    const req = requestFn(options, (res) => {
      const chunks = []

      res.on('data', (chunk) => chunks.push(chunk))

      res.on('end', () => {
        const data = Buffer.concat(chunks).toString('utf8')
        resolve({
          status: res.statusCode,
          data,
        })
      })

      res.on('error', reject)
    })

    req.on('error', reject)
    req.write(bodyStr)
    req.end()
  })
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

async function handleToolsList(message) {
  log('Handling tools/list')

  try {
    // Use cached tools if available
    if (cachedTools) {
      log(`Returning ${cachedTools.length} cached tools`)
      writeResponse({
        jsonrpc: '2.0',
        id: message.id,
        result: { tools: cachedTools },
      })
      return
    }

    const response = await makeGetRequest('/api/tools')

    if (response.status !== 200) {
      throw new Error(`HTTP ${response.status}: ${response.data}`)
    }

    const serverResponse = JSON.parse(response.data)

    if (!serverResponse.success) {
      throw new Error(serverResponse.error || 'Failed to fetch tools')
    }

    // returns: { success: true, tools: [{ name, description, inputSchema }] }
    // expects: { tools: [{ name, description, inputSchema }] }
    // Strip prefix from tool names to avoid double-prefixing by opencode
    const tools = serverResponse.tools.map((tool) => {
      let name = tool.name
      if (MCP_STRIP_PREFIX && name.startsWith(MCP_STRIP_PREFIX)) {
        name = name.slice(MCP_STRIP_PREFIX.length)
      }
      return {
        name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      }
    })

    cachedTools = tools
    log(`Fetched and cached ${tools.length} tools`)

    writeResponse({
      jsonrpc: '2.0',
      id: message.id,
      result: { tools },
    })
  } catch (error) {
    log(`Error fetching tools: ${error.message}`)
    writeError(message.id, -32000, `Failed to fetch tools: ${error.message}`)
  }
}

async function handleToolsCall(message) {
  const { name, arguments: args } = message.params
  // Add prefix back when calling remote server
  const remoteName = MCP_STRIP_PREFIX ? MCP_STRIP_PREFIX + name : name
  log(`Handling tools/call: ${name} -> ${remoteName}`)

  try {
    // /api/call expects: { method: "tools/call", params: { name, arguments } }
    const serverResponse = {
      method: 'tools/call',
      params: {
        name: remoteName,
        arguments: args || {},
      },
    }

    const response = await makePostRequest('/api/call', serverResponse)

    if (response.status !== 200) {
      throw new Error(`HTTP ${response.status}: ${response.data}`)
    }

    const serverToolResponse = JSON.parse(response.data)

    if (!serverToolResponse.success) {
      throw new Error(serverToolResponse.error || 'Tool call failed')
    }

    // returns: { success: true, data: <tool_result> }
    // expects: { content: [{ type: "text", text: "..." }] }
    const resultText =
      typeof serverToolResponse.data === 'string'
        ? serverToolResponse.data
        : JSON.stringify(serverToolResponse.data, null, 2)

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

  // Handle requests (have id) and notifications (no id)
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
      await handleToolsList(message)
      break

    case 'tools/call':
      await handleToolsCall(message)
      break

    default:
      if (id !== undefined) {
        // Unknown request - return error
        log(`Unknown method: ${method}`)
        writeError(id, -32601, `Method not found: ${method}`)
      } else {
        // Unknown notification - ignore
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

  // Process each line as a JSON-RPC message
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
