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
