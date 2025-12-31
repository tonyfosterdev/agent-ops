FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package.json ./

# Install dependencies
RUN npm install

# Copy source code and fixtures
COPY tsconfig.json ./
COPY src ./src
COPY fixtures ./fixtures

# Build TypeScript
RUN npm run build

# Set environment variables
ENV PORT=3333
ENV FIXTURE_DIR=/app/fixtures
ENV DEFAULT_FIXTURE=default.json

# Expose port
EXPOSE 3333

# Health check
HEALTHCHECK --interval=5s --timeout=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3333/health || exit 1

# Start server
CMD ["node", "dist/server.js"]
