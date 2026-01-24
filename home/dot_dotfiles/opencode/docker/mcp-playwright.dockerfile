# Custom Playwright MCP with stealth evasions
# Based on the official Microsoft Playwright MCP image
FROM mcr.microsoft.com/playwright/mcp:latest

# Copy the stealth init script
COPY mcp-playwright/stealth-init.js /app/stealth-init.js

# Override entrypoint to include the init script
# Original: node cli.js --headless --browser chromium --no-sandbox
ENTRYPOINT ["node", "cli.js", "--headless", "--browser", "chromium", "--no-sandbox", "--init-script", "/app/stealth-init.js"]
