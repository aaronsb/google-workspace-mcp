# syntax=docker/dockerfile:1.4

# Build stage
FROM node:20-slim AS builder
WORKDIR /app

# Add metadata
LABEL org.opencontainers.image.source="https://github.com/aaronsb/google-workspace-mcp"
LABEL org.opencontainers.image.description="Google Workspace MCP Server"
LABEL org.opencontainers.image.licenses="MIT"

# Install dependencies
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci

# Copy source and build
COPY . .
RUN npm run build

# Production stage
FROM node:20-slim
WORKDIR /app

# Set docker hash as environment variable
ARG DOCKER_HASH=unknown
ENV DOCKER_HASH=$DOCKER_HASH

# Copy only necessary files from builder
COPY --from=builder /app/build ./build
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/docker-entrypoint.sh ./

# Install production dependencies only
RUN --mount=type=cache,target=/root/.npm \
    npm ci --only=production && \
    chmod +x build/index.js && \
    chmod +x docker-entrypoint.sh

# Switch to host user's UID
USER 1000

ENTRYPOINT ["./docker-entrypoint.sh"]
