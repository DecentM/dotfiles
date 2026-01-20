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
    # --- Data & Math ---
    mpmath \
    numexpr \
    numpy \
    pandas \
    scipy \
    sympy \
    # --- Data Science & ML ---
    lightgbm \
    scikit-learn \
    statsmodels \
    xgboost \
    # --- Visualization ---
    matplotlib \
    plotly \
    seaborn \
    # --- Data Handling ---
    duckdb \
    openpyxl \
    polars \
    pyarrow \
    xlrd \
    # --- Text & NLP ---
    nltk \
    spacy \
    textblob \
    # --- HTTP & Network ---
    httpx \
    requests \
    # --- Date & Time ---
    arrow \
    pendulum \
    python-dateutil \
    # --- Config & Serialization ---
    dataclasses-json \
    msgpack \
    orjson \
    python-dotenv \
    pyyaml \
    toml \
    tomli \
    ujson \
    # --- Text & Parsing ---
    chardet \
    jinja2 \
    markdown \
    parse \
    pygments \
    regex \
    # --- Dev & Testing ---
    attrs \
    pydantic \
    pytest \
    rich \
    # --- Crypto & Security ---
    bcrypt \
    cryptography \
    pyjwt \
    # --- Async & Concurrency ---
    anyio \
    trio \
    # --- Utilities ---
    boltons \
    cachetools \
    dacite \
    deepdiff \
    humanize \
    more-itertools \
    shortuuid \
    tabulate \
    toolz \
    validators

# Run as non-root user for security
RUN useradd -m -s /bin/bash sandbox
USER sandbox
WORKDIR /home/sandbox

# Run Python directly - pass "-" to read script from stdin
ENTRYPOINT ["python"]
