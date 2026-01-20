# Stage 1: Build dummy packages (from Flaresolverr)
FROM python:3.13-slim-bookworm AS builder

# Build dummy packages to skip installing them and their dependencies
RUN apt-get update \
    && apt-get install -y --no-install-recommends equivs \
    && equivs-control libgl1-mesa-dri \
    && printf 'Section: misc\nPriority: optional\nStandards-Version: 3.9.2\nPackage: libgl1-mesa-dri\nVersion: 99.0.0\nDescription: Dummy package for libgl1-mesa-dri\n' >> libgl1-mesa-dri \
    && equivs-build libgl1-mesa-dri \
    && mv libgl1-mesa-dri_*.deb /libgl1-mesa-dri.deb \
    && equivs-control adwaita-icon-theme \
    && printf 'Section: misc\nPriority: optional\nStandards-Version: 3.9.2\nPackage: adwaita-icon-theme\nVersion: 99.0.0\nDescription: Dummy package for adwaita-icon-theme\n' >> adwaita-icon-theme \
    && equivs-build adwaita-icon-theme \
    && mv adwaita-icon-theme_*.deb /adwaita-icon-theme.deb

# Stage 2: Final image
FROM python:3.13-slim-bookworm

# Copy dummy packages from builder
COPY --from=builder /*.deb /

WORKDIR /app

# Install dummy packages, system dependencies, Chromium, and Node.js
RUN dpkg -i /libgl1-mesa-dri.deb \
    && dpkg -i /adwaita-icon-theme.deb \
    && rm -f /*.deb \
    # Install Chromium and system dependencies
    && apt-get update \
    && apt-get install -y --no-install-recommends \
        chromium \
        chromium-common \
        chromium-driver \
        xvfb \
        dumb-init \
        procps \
        curl \
        xauth \
        ca-certificates \
        gnupg \
    # Install Node.js 22 from NodeSource
    && mkdir -p /etc/apt/keyrings \
    && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
    && echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" > /etc/apt/sources.list.d/nodesource.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends nodejs \
    # Clean up
    && rm -rf /var/lib/apt/lists/* \
    && rm -f /usr/lib/x86_64-linux-gnu/libmfxhw* \
    && rm -f /usr/lib/x86_64-linux-gnu/mfx/* \
    # Move chromedriver to app directory
    && mv /usr/bin/chromedriver /app/chromedriver \
    # Create config dir for Flaresolverr
    && mkdir -p /config \
    && mkdir -p /app/.config/chromium/Crash\ Reports/pending

# Install Python dependencies for Flaresolverr
COPY mcp-flaresolverr/requirements-flaresolverr.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

# Copy Flaresolverr source (cloned during build or downloaded)
# We'll use git to fetch the source in the build context
ARG FLARESOLVERR_VERSION=v3.3.21
ADD https://github.com/FlareSolverr/FlareSolverr/archive/refs/tags/${FLARESOLVERR_VERSION}.tar.gz /tmp/flaresolverr.tar.gz
RUN tar -xzf /tmp/flaresolverr.tar.gz -C /tmp \
    && cp -r /tmp/FlareSolverr-*/src/* /app/ \
    && cp /tmp/FlareSolverr-*/package.json /app/ \
    && rm -rf /tmp/flaresolverr.tar.gz /tmp/FlareSolverr-*

# Copy MCP server
WORKDIR /mcp
COPY mcp-flaresolverr/package.json ./
RUN npm install --omit=dev
COPY mcp-flaresolverr/index.js ./

# Copy entrypoint script
COPY mcp-flaresolverr/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Environment variables for Flaresolverr
ENV LOG_LEVEL=info
ENV LOG_HTML=false
ENV CAPTCHA_SOLVER=none
ENV TZ=UTC
ENV HEADLESS=true

EXPOSE 8191

# dumb-init avoids zombie chromium processes
ENTRYPOINT ["/usr/bin/dumb-init", "--", "/entrypoint.sh"]
