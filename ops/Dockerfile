FROM node:22-alpine

WORKDIR /app

# Install Docker CLI for docker_compose_restart tool
# Only the CLI is needed - Docker daemon runs on host via mounted socket
RUN apk add --no-cache docker-cli docker-cli-compose

# Install ALL dependencies (tsx needed at runtime)
COPY package*.json ./
RUN npm ci

# Copy source (no build step needed - tsx runs TypeScript directly)
COPY . .

# Run with telemetry instrumentation using tsx
# tsx handles TypeScript execution without separate compilation
CMD ["npx", "tsx", "--import", "./src/telemetry.ts", "./src/server.ts"]
