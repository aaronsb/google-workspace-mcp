# syntax=docker/dockerfile:1.4

# Build stage
FROM --platform=$BUILDPLATFORM node:20-slim AS builder
WORKDIR /app

# Add metadata
LABEL org.opencontainers.image.source="https://github.com/aaronsb/google-workspace-mcp"
LABEL org.opencontainers.image.description="Google Workspace MCP Server"
LABEL org.opencontainers.image.licenses="MIT"

# Install dependencies first (better layer caching)
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm,sharing=locked \
    npm ci --prefer-offline --no-audit --no-fund

# Copy source and build
COPY . .
RUN --mount=type=cache,target=/root/.npm,sharing=locked \
    npm run build

# Production stage
FROM node:20-slim AS production
WORKDIR /app

# Set docker hash as environment variable
ARG DOCKER_HASH=unknown
ENV DOCKER_HASH=$DOCKER_HASH

# Copy only necessary files from builder
COPY --from=builder /app/build ./build
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/docker-entrypoint.sh ./

# Install production dependencies and set up directories
RUN --mount=type=cache,target=/root/.npm,sharing=locked \
    npm ci --prefer-offline --no-audit --no-fund --omit=dev && \
    npm install uuid@11.1.0 && \
    chmod +x build/index.js && \
    chmod +x docker-entrypoint.sh && \
    mkdir -p /app/logs && \
    chown -R 1000:1000 /app

# Switch to non-root user
USER 1000:1000

ENTRYPOINT ["./docker-entrypoint.sh"]
