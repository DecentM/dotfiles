# Dockerfile for Python sandbox execution
# Standalone tool - spawns fresh container per execution
#
# Build: docker build -t opencode/sandbox-python -f mcp-python.dockerfile .
# Run:   echo "print('hello')" | docker run --rm -i opencode/sandbox-python -

ARG PYTHON_VERSION="3.12"

FROM python:${PYTHON_VERSION}-slim

# Install uv for fast Python package management
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

# Install system dependencies for ML libraries
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

ARG PYTHON_PACKAGES=""

RUN uv pip install --system ${PYTHON_PACKAGES}

# Run as non-root user for security
RUN useradd -m -s /bin/bash sandbox
USER sandbox
WORKDIR /home/sandbox

# Run Python directly - pass "-" to read script from stdin
ENTRYPOINT ["python"]
