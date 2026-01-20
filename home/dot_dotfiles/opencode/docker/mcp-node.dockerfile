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

# Create package.json and install packages locally (so require() finds them)
RUN echo '{"type":"commonjs"}' > package.json && \
    npm install --save \
    # --- Utils & Data ---
    change-case \
    date-fns \
    dayjs \
    humanize-duration \
    lodash \
    nanoid \
    pluralize \
    ramda \
    slugify \
    uuid \
    # --- Validation ---
    ajv \
    joi \
    superstruct \
    yup \
    zod \
    # --- CLI Tools (non-interactive) ---
    chalk \
    commander \
    ora \
    yargs \
    # --- Parsing ---
    cheerio \
    csv-parse \
    csv-stringify \
    fast-xml-parser \
    json5 \
    jsonc-parser \
    marked \
    papaparse \
    toml \
    yaml \
    # --- Crypto ---
    bcryptjs \
    crypto-js \
    jose \
    # --- Async Patterns ---
    async \
    bottleneck \
    p-all \
    p-limit \
    p-map \
    p-queue \
    p-retry \
    rxjs \
    # --- Math & Numbers ---
    big.js \
    currency.js \
    decimal.js \
    fraction.js \
    mathjs \
    # --- TypeScript & Build ---
    @swc/core \
    esbuild \
    tsx \
    typescript \
    # --- Linting & Formatting ---
    @biomejs/biome \
    @eslint/js \
    @prettier/plugin-xml \
    eslint \
    eslint-plugin-import \
    eslint-plugin-unicorn \
    prettier \
    typescript-eslint \
    # --- Additional Utilities ---
    @types/node \
    ansi-regex \
    boxen \
    bytes \
    cli-table3 \
    debug \
    deepmerge \
    dotenv \
    effect \
    escape-string-regexp \
    fast-deep-equal \
    fast-json-stringify \
    figures \
    filesize \
    flatted \
    fp-ts \
    immer \
    io-ts \
    log-symbols \
    ms \
    neverthrow \
    object-hash \
    pretty-bytes \
    purify-ts \
    strip-ansi \
    table \
    true-myth \
    ts-pattern \
    type-fest \
    && npm cache clean --force

# Default: run Node reading from stdin
# For TypeScript: docker run --rm -i opencode/node npx tsx
# For Deno: docker run --rm -i --entrypoint deno opencode/node run -
ENTRYPOINT ["node"]
