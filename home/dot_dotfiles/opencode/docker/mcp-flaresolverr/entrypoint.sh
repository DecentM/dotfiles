#!/bin/bash
set -e

# Start Xvfb for headless display
export DISPLAY=:99
Xvfb :99 -screen 0 1920x1080x24 &
XVFB_PID=$!

# Give Xvfb a moment to start
sleep 1

# Start Flaresolverr in background
cd /app
python -u /app/flaresolverr.py &
FLARESOLVERR_PID=$!

# Wait for Flaresolverr to be ready
echo "[mcp-flaresolverr] Waiting for Flaresolverr to start..."
for i in {1..30}; do
    if curl -sf http://127.0.0.1:8191/v1 -H "Content-Type: application/json" -d '{"cmd":"sessions.list"}' > /dev/null 2>&1; then
        echo "[mcp-flaresolverr] Flaresolverr is ready"
        break
    fi
    if [ $i -eq 30 ]; then
        echo "[mcp-flaresolverr] Warning: Flaresolverr may not be ready after 30 seconds"
    fi
    sleep 1
done

# Handle signals to gracefully shutdown
cleanup() {
    echo "[mcp-flaresolverr] Shutting down..."
    kill $FLARESOLVERR_PID 2>/dev/null || true
    kill $XVFB_PID 2>/dev/null || true
    exit 0
}
trap cleanup SIGTERM SIGINT

# Run MCP server in foreground
exec node /mcp/index.js
