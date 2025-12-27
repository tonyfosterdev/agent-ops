FROM node:20-alpine

# Install Docker CLI for restart_service tool (Docker socket is mounted from host)
RUN apk add --no-cache docker-cli docker-cli-compose docker-cli-buildx git

WORKDIR /app

# Copy root package.json and install workspace dependencies
COPY package.json package-lock.json* ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/agent-server/package.json ./packages/agent-server/

# Install all dependencies
RUN npm install --legacy-peer-deps

# Build shared package
COPY tsconfig.json ./
COPY packages/shared/tsconfig.json ./packages/shared/
COPY packages/shared/src ./packages/shared/src
RUN cd packages/shared && npm run build

# Build agent-server
COPY packages/agent-server/tsconfig.json ./packages/agent-server/
COPY packages/agent-server/src ./packages/agent-server/src
RUN cd packages/agent-server && npm run build

# Set working directory to agent-server
WORKDIR /app/packages/agent-server

EXPOSE 3200

CMD ["node", "dist/index.js"]
