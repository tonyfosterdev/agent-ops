FROM node:20-alpine

# Set up directory structure to match local
WORKDIR /workspace

# Copy and build shared package
COPY shared ./shared
WORKDIR /workspace/shared
RUN npm install && npm install --save-dev typescript
RUN npx tsc --declaration --outDir . --module commonjs --target ES2022 --esModuleInterop true --skipLibCheck true types/index.ts
RUN sed -i 's|"main": "types/index.ts"|"main": "index.js"|g; s|"types": "types/index.ts"|"types": "index.d.ts"|g' package.json

# Switch to service directory
WORKDIR /workspace/services/warehouse-api

# Copy only package.json
COPY services/warehouse-api/package.json ./

# Install dependencies (will resolve file:../../shared correctly)
RUN npm install

# Copy source code
COPY services/warehouse-api/src ./src
COPY services/warehouse-api/tsconfig.json ./
COPY services/warehouse-api/nodemon.json ./
COPY services/warehouse-api/.env.example ./
COPY services/warehouse-api/start.sh ./

# Build TypeScript
RUN npm run build

# Make start script executable
RUN chmod +x start.sh

# Expose port
EXPOSE 3000

# Start application (with automatic seeding)
CMD ["./start.sh"]
