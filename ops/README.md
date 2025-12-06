# AgentOps - Autonomous Agent System

A distributed client-server system for running autonomous AI agents that can debug code, analyze logs, and orchestrate complex tasks.

## Architecture

This is a **monorepo** with three packages:

- **shared**: Common types, base classes, configuration, and utilities
- **agent-server**: Hono-based HTTP server that runs agents and streams events via SSE
- **ops-cli**: Interactive CLI client that connects to the server

## Quick Start

### Development

```bash
# Install dependencies
npm install --legacy-peer-deps

# Build all packages
npm run build

# Run server
npm run dev:server

# Run CLI (in another terminal)
npm run dev:cli
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
- `packages/ops-cli/` - CLI usage guide

## Tech Stack

- **Server**: Hono, TypeScript, SSE streaming
- **CLI**: Ink, React, Commander
- **Infrastructure**: Docker, Traefik, Loki

## License

MIT
