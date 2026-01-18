# Dockerfile for mcp-python - Python REPL MCP server
# https://github.com/hdresearch/mcp-python
#
# Build: docker build -t mcp-python -f mcp-python.dockerfile .
# Run:   docker run --rm -i mcp-python

FROM python:3.12-slim-bookworm

# Install uv for fast Python package management
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

# Install common Python packages that might be useful in the REPL
RUN uv pip install --system \
    mcp-python \
    numpy \
    pandas \
    requests \
    httpx \
    pyyaml \
    python-dateutil

# Run as non-root user for security
RUN useradd -m -s /bin/bash sandbox
USER sandbox
WORKDIR /home/sandbox

# The MCP server communicates via stdio
ENTRYPOINT ["mcp-python"]
