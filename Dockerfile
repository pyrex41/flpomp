# Pomelli → X Automation Flywheel
# Production Dockerfile: Bun + Playwright (Chromium) on Debian
FROM oven/bun:1 AS base
WORKDIR /app

# Install system libraries required by Playwright/Chromium
RUN apt-get update && apt-get install -y --no-install-recommends \
  libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 \
  libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 \
  libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libasound2 \
  libxshmfence1 libx11-xcb1 libxcomposite1 libxcursor1 \
  libxdamage1 libxi6 libxtst6 libglib2.0-0 \
  fonts-liberation fonts-noto-color-emoji \
  ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Copy dependency manifests (bun.lock may or may not be present)
COPY package.json bun.lock* ./

# Install production dependencies only (skip devDependencies)
RUN bun install --production

# Copy application source
COPY src/ ./src/
COPY tsconfig.json ./

# Install Playwright Chromium browser
RUN bunx playwright install chromium

# Chromium sandbox flags for container environments
ENV PLAYWRIGHT_CHROMIUM_ARGS="--no-sandbox --disable-setuid-sandbox"

# Data directory for SQLite, browser state, and assets (mounted as Fly.io volume)
ENV DATA_DIR="/data"
ENV PORT="8080"

EXPOSE 8080

CMD ["bun", "run", "src/server.ts"]
