# AgentOps - Durable Agent Framework

A durable agent framework built on Inngest AgentKit with human-in-the-loop approval. Agents can pause for human review, survive server restarts via Inngest step functions, and export traces to Tempo via OpenTelemetry.

## Architecture

This is a **flattened structure** (not a monorepo):

- **src/**: Agent server with Inngest AgentKit
  - `agents/`: Agent definitions (coding, log-analyzer)
  - `tools/`: Tool definitions with Zod schemas
  - `db/`: PostgreSQL connection and history adapter
  - `inngest/`: Inngest function definitions
- **dashboard/**: React dashboard with `useAgent` hook for chat UI

## Quick Start

### Development

```bash
# Install dependencies
cd ops && npm install
cd dashboard && npm install

# Run server (connects to Inngest Dev Server)
npm run dev:server

# Run dashboard (in another terminal)
cd dashboard && npm run dev
```

### Via Docker

```bash
# Start all services including Inngest Dev Server
docker compose up --build agent-server inngest-dev
```

## Key Technologies

- **Inngest AgentKit**: Multi-agent orchestration with durable execution
- **Inngest Step Functions**: Automatic retry and crash recovery
- **OpenTelemetry**: Distributed tracing exported to Tempo
- **PostgreSQL**: Conversation history persistence
- **Hono**: Lightweight HTTP server
- **React + useAgent**: Real-time chat UI with HITL approval

## Environment Variables

```env
# Required
ANTHROPIC_API_KEY=your-api-key

# Database (dedicated agent PostgreSQL)
AGENT_DATABASE_URL=postgres://agentuser:agentpass@agent-db:5432/agent_db

# Inngest
INNGEST_DEV=1
INNGEST_DEV_SERVER_URL=http://inngest-dev:8288

# OpenTelemetry
OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=http://tempo:4318/v1/traces
OTEL_SERVICE_NAME=agentops
```

## License

MIT
