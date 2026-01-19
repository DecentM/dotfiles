# Dockerfile for mcp-socks-proxy - MCP SOCKS5 proxy wrapper
# Forwards MCP stdio to remote MCP servers via SOCKS5 proxy
#
# Build: docker build -t mcp-socks-proxy -f mcp-socks-proxy.dockerfile .
# Run:   docker run --rm -i -e MCP_REMOTE_URL=https://example.com/mcp -e SOCKS_PROXY=socks5://proxy:1080 mcp-socks-proxy

FROM node:22-bookworm-slim

WORKDIR /app

# Copy package files and install dependencies
COPY mcp-socks-proxy/package.json ./
RUN npm install --omit=dev

# Copy application code
COPY mcp-socks-proxy/index.js ./

# Run as non-root user for security (node user exists in base image)
USER node

# The MCP server communicates via stdio
ENTRYPOINT ["node", "index.js"]
