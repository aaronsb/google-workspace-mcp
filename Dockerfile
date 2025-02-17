# Build stage
FROM node:20-slim AS builder
WORKDIR /app

# Add metadata
LABEL org.opencontainers.image.source="https://github.com/aaronsb/google-workspace-mcp"
LABEL org.opencontainers.image.description="Google Workspace MCP Server"
LABEL org.opencontainers.image.licenses="MIT"

# Install dependencies
COPY package*.json ./
RUN npm ci && \
    npm cache clean --force

# Copy source and build
COPY . .
RUN npm run build

# Production stage
FROM node:20-slim
WORKDIR /app

# Create non-root user
RUN groupadd -r mcp && \
    useradd -r -g mcp -s /bin/false mcp && \
    mkdir -p config && \
    chown -R mcp:mcp /app

# Copy only necessary files from builder
COPY --from=builder /app/build ./build
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/docker-entrypoint.sh ./

# Install production dependencies only
RUN npm ci --only=production && \
    npm cache clean --force && \
    chmod +x build/index.js && \
    chmod +x docker-entrypoint.sh

# Switch to non-root user
USER mcp

ENTRYPOINT ["./docker-entrypoint.sh"]
