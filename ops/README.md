# AgentOps - Durable Agent Framework

A durable agent framework with human-in-the-loop approval. Agents can pause for human review, survive server restarts, and maintain full audit trails via event sourcing.

## Architecture

This is a **monorepo** with four packages:

- **shared**: Common types, base classes, configuration, and utilities
- **agent-server**: Hono-based HTTP server that runs agents and streams events via SSE
- **dashboard**: React dashboard for submitting tasks and approving dangerous operations
- **ops-cli**: Interactive CLI client (legacy, use dashboard for HITL)

## Quick Start

### Development

```bash
# Install dependencies
npm install --legacy-peer-deps

# Build all packages
npm run build

# Run server
npm run dev:server

# Run dashboard (in another terminal)
npm run dev:dashboard
```

### Via Docker

```bash
docker compose up --build agent-server
```

## Usage

### Server API

```bash
# Health check
curl http://localhost:3200/health

# List agents
curl -u admin:admin123 http://localhost:3200/agents/types

# Run an agent
curl -X POST http://localhost:3200/agents/coding/run \
  -u admin:admin123 \
  -H "Content-Type: application/json" \
  -d '{"task": "Fix bugs", "config": {"maxSteps": 10}}'
```

### CLI

```bash
# Interactive mode
ops

# Direct command
ops run "Fix TypeScript errors" --agent coding
```

## Documentation

See README files in each package:
- `packages/shared/` - Shared utilities and types
- `packages/agent-server/` - HTTP server documentation
- `packages/dashboard/` - React dashboard with approval UI

## Tech Stack

- **Server**: Hono, TypeScript, TypeORM, PostgreSQL
- **Dashboard**: React, Tailwind CSS, SSE streaming
- **Infrastructure**: Docker, Traefik, Loki

## License

MIT
