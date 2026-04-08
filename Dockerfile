FROM ubuntu:25.04

RUN apt-get update && \
    apt-get install -y --no-install-recommends nodejs npm && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY . .
RUN npm run build

ENTRYPOINT ["node", "build/index.js"]
