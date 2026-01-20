# Dockerfile for Python sandbox execution
# Standalone tool - spawns fresh container per execution
#
# Build: docker build -t opencode/sandbox-python -f mcp-python.dockerfile .
# Run:   echo "print('hello')" | docker run --rm -i opencode/sandbox-python -

FROM python:3.12-slim-bookworm

# Install uv for fast Python package management
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

# Install common Python packages
# Note: mcp-python removed since we run Python directly now
RUN uv pip install --system \
    numpy \
    pandas \
    requests \
    httpx \
    pyyaml \
    python-dateutil \
    sympy \
    scipy \
    mpmath \
    numexpr

# Run as non-root user for security
RUN useradd -m -s /bin/bash sandbox
USER sandbox
WORKDIR /home/sandbox

# Run Python directly - pass "-" to read script from stdin
ENTRYPOINT ["python"]
