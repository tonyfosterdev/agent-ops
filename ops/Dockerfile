FROM node:22-alpine

WORKDIR /app

# Install Docker CLI for docker_compose_restart tool
# Only the CLI is needed - Docker daemon runs on host via mounted socket
RUN apk add --no-cache docker-cli docker-cli-compose

# Install ALL dependencies for build (TypeScript needed)
COPY package*.json ./
RUN npm ci

# Copy source and build
COPY . .
RUN npm run build

# Prune devDependencies for smaller production image
RUN npm prune --omit=dev

# Run with telemetry instrumentation
# Using --import for ES modules (not --require)
CMD ["node", "--import", "./dist/telemetry.js", "./dist/server.js"]
