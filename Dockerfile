FROM node:20-slim
WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build && \
    chmod +x build/index.js && \
    chmod +x docker-entrypoint.sh && \
    mkdir -p config

ENTRYPOINT ["./docker-entrypoint.sh"]
