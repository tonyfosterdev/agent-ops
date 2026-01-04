FROM node:20-alpine

WORKDIR /app

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
