# Builder stage
FROM node:20-slim AS builder
WORKDIR /app

# Update npm to latest version and install dependencies
RUN npm install -g npm@latest

# Copy package files and install all dependencies
COPY package*.json ./
RUN npm ci

# Copy source code and build
COPY . .
RUN npm run build
RUN npm test

# Runtime stage
FROM node:20-slim
WORKDIR /app

# Update npm to latest version and install production dependencies
RUN npm install -g npm@latest

# Copy package files and install only production dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy built files from builder stage
COPY --from=builder /app/build ./build

# Create config directory and set permissions
RUN mkdir -p config && chmod +x build/index.js

CMD ["node", "build/index.js"]
