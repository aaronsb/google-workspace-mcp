FROM node:20-slim
WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build && \
    chmod +x build/index.js && \
    mkdir -p config

ENTRYPOINT ["node", "build/index.js"]
