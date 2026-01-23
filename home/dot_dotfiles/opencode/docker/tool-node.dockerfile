# Dockerfile for Node.js sandbox execution
# Standalone tool - spawns fresh container per execution
#
# Build: docker build -t opencode/node -f mcp-node.dockerfile .
# Run:   echo "console.log('hello')" | docker run --rm -i opencode/sandbox-node

ARG NODE_VERSION="25.3.0"

FROM node:${NODE_VERSION}-slim

# Set up package directory
WORKDIR /home/sandbox

ARG INSTALL_PACKAGES=""

# Create sandbox user and fix ownership
RUN useradd -m -s /bin/bash sandbox && \
    chown -R sandbox:sandbox /home/sandbox

USER sandbox

ARG PACKAGE_TYPE="module"

RUN echo '{"type":"${PACKAGE_TYPE}}"}' > package.json

RUN npm i ${INSTALL_PACKAGES}

# Default: run Node reading from stdin
# For TypeScript: docker run --rm -i opencode/node npx tsx
# For Deno: docker run --rm -i --entrypoint deno opencode/node run -
ENTRYPOINT ["node"]
