#!/usr/bin/env node

/**
 * MCP SOCKS5 Proxy Wrapper
 *
 * Receives MCP requests via stdio, forwards them to a remote MCP server
 * through a SOCKS5 proxy, and returns responses back via stdio.
 *
 * Environment variables:
 *   MCP_REMOTE_URL - The remote MCP server URL (required)
 *   SOCKS_PROXY    - SOCKS5 proxy URL, e.g., socks5://host:port (required)
 */

import { createInterface } from "node:readline";
import { request as httpsRequest } from "node:https";
import { request as httpRequest } from "node:http";
import { SocksProxyAgent } from "socks-proxy-agent";

const MCP_REMOTE_URL = process.env.MCP_REMOTE_URL;
const SOCKS_PROXY = process.env.SOCKS_PROXY;

if (!MCP_REMOTE_URL) {
  console.error("Error: MCP_REMOTE_URL environment variable is required");
  process.exit(1);
}

if (!SOCKS_PROXY) {
  console.error("Error: SOCKS_PROXY environment variable is required");
  process.exit(1);
}

const log = (...args) => console.error("[mcp-socks-proxy]", ...args);

log(`Connecting to ${MCP_REMOTE_URL} via ${SOCKS_PROXY}`);

// Parse remote URL
const remoteUrl = new URL(MCP_REMOTE_URL);
const isHttps = remoteUrl.protocol === "https:";
const requestFn = isHttps ? httpsRequest : httpRequest;

// Create SOCKS proxy agent
const socksAgent = new SocksProxyAgent(SOCKS_PROXY);

// Track session ID for MCP HTTP transport
let sessionId = null;

/**
 * Make an HTTP(S) request through the SOCKS proxy
 */
function makeRequest(body) {
  return new Promise((resolve, reject) => {
    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "Content-Length": Buffer.byteLength(body),
    };

    // Include session ID if we have one
    if (sessionId) {
      headers["Mcp-Session-Id"] = sessionId;
    }

    const options = {
      hostname: remoteUrl.hostname,
      port: remoteUrl.port || (isHttps ? 443 : 80),
      path: remoteUrl.pathname + remoteUrl.search,
      method: "POST",
      headers,
      agent: socksAgent,
    };

    const req = requestFn(options, (res) => {
      // Capture session ID from response
      const newSessionId = res.headers["mcp-session-id"];
      if (newSessionId) {
        sessionId = newSessionId;
        log(`Session ID: ${sessionId}`);
      }

      const contentType = res.headers["content-type"] || "";
      const chunks = [];

      res.on("data", (chunk) => chunks.push(chunk));

      res.on("end", () => {
        const data = Buffer.concat(chunks).toString("utf8");
        resolve({
          status: res.statusCode,
          contentType,
          data,
        });
      });

      res.on("error", reject);
    });

    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

/**
 * Send a JSON-RPC message to the remote MCP server
 */
async function sendToRemote(message) {
  try {
    const body = JSON.stringify(message);
    const response = await makeRequest(body);

    if (response.contentType.includes("text/event-stream")) {
      // Handle SSE response
      handleSSEData(response.data);
    } else if (response.contentType.includes("application/json")) {
      // Handle simple JSON response
      const data = JSON.parse(response.data);
      writeResponse(data);
    } else if (response.status === 202) {
      // Accepted - no response body (notification)
      log("Notification accepted (202)");
    } else {
      log(`Unexpected response: ${response.status} ${response.contentType}`);
      log(`Response body: ${response.data}`);
    }
  } catch (error) {
    log(`Error sending to remote: ${error.message}`);

    // If it's a request (has id), send error response
    if (message.id !== undefined) {
      writeResponse({
        jsonrpc: "2.0",
        id: message.id,
        error: {
          code: -32000,
          message: `Proxy error: ${error.message}`,
        },
      });
    }
  }
}

/**
 * Parse SSE data and extract JSON-RPC messages
 */
function handleSSEData(data) {
  const events = data.split("\n\n");

  for (const event of events) {
    if (!event.trim()) continue;

    const lines = event.split("\n");
    let eventType = "message";
    let eventData = "";

    for (const line of lines) {
      if (line.startsWith("event:")) {
        eventType = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        eventData += line.slice(5).trim();
      }
    }

    if (eventData && eventType === "message") {
      try {
        const parsed = JSON.parse(eventData);
        writeResponse(parsed);
      } catch (e) {
        log(`Failed to parse SSE data: ${eventData}`);
      }
    }
  }
}

/**
 * Write a JSON-RPC response to stdout
 */
function writeResponse(data) {
  process.stdout.write(JSON.stringify(data) + "\n");
}

/**
 * Main: Read JSON-RPC messages from stdin and forward to remote
 */
async function main() {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  // Process each line as a JSON-RPC message
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    try {
      const message = JSON.parse(trimmed);
      log(`→ ${message.method || "response"} (id: ${message.id})`);
      await sendToRemote(message);
    } catch (error) {
      log(`Failed to parse input: ${error.message}`);
    }
  }

  log("stdin closed, exiting");
}

// Handle graceful shutdown
process.on("SIGINT", () => {
  log("Received SIGINT, exiting");
  process.exit(0);
});

process.on("SIGTERM", () => {
  log("Received SIGTERM, exiting");
  process.exit(0);
});

main().catch((error) => {
  log(`Fatal error: ${error.message}`);
  process.exit(1);
});
