# Dockerfile for Node.js sandbox execution
# Standalone tool - spawns fresh container per execution
#
# Build: docker build -t opencode/node -f mcp-node.dockerfile .
# Run:   echo "console.log('hello')" | docker run --rm -i opencode/sandbox-node

FROM node:22-bookworm-slim

# Install Deno for polyglot support
ARG DENO_VERSION=2.6.5
RUN apt-get update && apt-get install -y --no-install-recommends curl unzip ca-certificates \
    && curl -fsSL https://github.com/denoland/deno/releases/download/v${DENO_VERSION}/deno-x86_64-unknown-linux-gnu.zip -o /tmp/deno.zip \
    && unzip /tmp/deno.zip -d /usr/local/bin \
    && rm /tmp/deno.zip \
    && chmod +x /usr/local/bin/deno \
    && apt-get purge -y curl unzip && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*

# Set up package directory
WORKDIR /home/sandbox

# Create sandbox user and fix ownership
RUN useradd -m -s /bin/bash sandbox && \
    chown -R sandbox:sandbox /home/sandbox

USER sandbox

RUN echo '{"type":"commonjs"}' > package.json

# Default: run Node reading from stdin
# For TypeScript: docker run --rm -i opencode/node npx tsx
# For Deno: docker run --rm -i --entrypoint deno opencode/node run -
ENTRYPOINT ["node"]
