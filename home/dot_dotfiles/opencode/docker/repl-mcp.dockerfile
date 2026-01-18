# Dockerfile for mcp-repl - MCP REPL with code execution
# https://www.npmjs.com/package/mcp-repl
#
# Build: docker build -t mcp-repl -f repl-mcp.dockerfile .
# Run:   docker run --rm -i mcp-repl

FROM node:22-bookworm-slim

# Install build dependencies for native modules (ast-grep)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install mcp-repl globally
RUN npm install -g mcp-repl@latest

# Create sandbox user
RUN useradd -m -s /bin/bash sandbox

# Fix permissions for transformers cache directory (used by @xenova/transformers)
RUN mkdir -p /usr/local/lib/node_modules/mcp-repl/node_modules/@xenova/transformers/.cache && \
    chown -R sandbox:sandbox /usr/local/lib/node_modules/mcp-repl/node_modules/@xenova/transformers/.cache

# Run as non-root user for security
USER sandbox
WORKDIR /home/sandbox

# The MCP server communicates via stdio
ENTRYPOINT ["mcp-repl"]
