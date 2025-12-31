# Agent Server User Guide

> **Version**: 1.0
> **Last Updated**: December 2024

This guide explains how to run the agent server, send prompts, and interact with the human-in-the-loop (HITL) approval system.

---

## Table of Contents

1. [Quick Start](#quick-start)
2. [Starting the Application](#starting-the-application)
3. [Sending Your First Prompt](#sending-your-first-prompt)
4. [Using the Dashboard](#using-the-dashboard)
5. [API Reference](#api-reference)
6. [Human-in-the-Loop Approval](#human-in-the-loop-approval)
7. [Agent Types](#agent-types)
8. [Viewing Logs](#viewing-logs)
9. [Troubleshooting](#troubleshooting)

---

## Quick Start

```bash
# 1. Copy environment template
cp .env.example .env

# 2. Add your Anthropic API key to .env
echo "ANTHROPIC_API_KEY=sk-ant-your-key-here" >> .env

# 3. Start everything
docker compose up --build -d

# 4. Open the dashboard
open http://localhost:5173

# 5. Create a run via curl (or use the dashboard)
curl -X POST http://localhost:3200/runs \
  -H "Content-Type: application/json" \
  -d '{"prompt": "List the files in the current directory", "user_id": "me"}'
```

---

## Starting the Application

### Option 1: Docker Compose (Recommended)

```bash
# From the repository root
docker compose up --build

# Or in detached mode
docker compose up --build -d

# View logs
docker compose logs -f agent-server
```

**Services Started:**

| Service | Port | Description |
|---------|------|-------------|
| agent-server | 3200 | Main agent API |
| dashboard | 5173 | React UI |
| ops-db | 5435 | PostgreSQL database |
| grafana | 3000 | Log visualization |
| loki | 3100 | Log aggregation |

### Option 2: Local Development

```bash
# Terminal 1: Start the agent server
cd ops/packages/agent-server
npm install
npm run dev

# Terminal 2: Start the dashboard
cd ops/packages/dashboard
npm install
npm run dev
```

### Environment Variables

Create a `.env` file with:

```bash
# Required
ANTHROPIC_API_KEY=sk-ant-xxxxx

# Optional (defaults shown)
PORT=3200
NODE_ENV=development
LOG_LEVEL=info
WORK_DIR=/workspace

# Database (for Docker)
OPS_DB_HOST=ops-db
OPS_DB_PORT=5432
OPS_DB_USERNAME=opsuser
OPS_DB_PASSWORD=opspassword
OPS_DB_DATABASE=ops_db
```

---

## Sending Your First Prompt

### Via Dashboard (Easiest)

1. Open http://localhost:5173
2. Type your task in the text area
3. Press Enter or click "Start Run"
4. Watch the timeline for real-time updates

### Via curl

```bash
# Create a new run
curl -X POST http://localhost:3200/runs \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Explain the structure of the src directory",
    "user_id": "my-user-id",
    "agent_type": "orchestrator"
  }'

# Response
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "pending"
}
```

### Via Test Scripts

```bash
# Test the coding agent directly
npm run test:coding-agent

# Test with custom error context
npm run test:coding-agent -- "TypeError: Cannot read property 'id'" "src/services/auth.ts"

# Test the log analyzer agent
npm run test:log-agent
```

---

## Using the Dashboard

### Dashboard URL

- **Development**: http://localhost:5173
- **Production**: http://localhost/dashboard (via Traefik)

### Features

#### 1. Create Run Form
- Enter your task prompt
- Press **Enter** to submit (Shift+Enter for newline)
- Shows loading state while creating

#### 2. Event Timeline
- Real-time stream of agent actions
- Event types:
  - `RUN_STARTED` - Agent began processing
  - `AGENT_THOUGHT` - Agent reasoning
  - `TOOL_PROPOSED` - Tool about to execute
  - `TOOL_RESULT` - Tool execution result
  - `RUN_SUSPENDED` - Waiting for approval
  - `RUN_COMPLETED` - Task finished
  - `SYSTEM_ERROR` - Error occurred

#### 3. Status Badge
Shows current run state:
- **pending** - Queued for execution
- **running** - Agent actively working
- **suspended** - Waiting for HITL approval
- **completed** - Successfully finished
- **failed** - Error occurred
- **cancelled** - User cancelled

#### 4. HITL Approval Panel
Appears when run is suspended:
- Shows tool name and arguments
- **Approve** - Allow tool execution
- **Reject** - Deny with optional feedback

#### 5. Stop Run Button
- Visible while running or suspended
- Confirms before cancelling

---

## API Reference

### Base URL
```
http://localhost:3200
```

### Endpoints

#### Health Check
```
GET /health
```

#### Create a Run
```
POST /runs
Content-Type: application/json

{
  "prompt": "Your task description",
  "user_id": "your-user-id",
  "agent_type": "orchestrator"  // optional
}
```

#### List Runs
```
GET /runs?user_id=xxx&status=running&limit=20&offset=0
```

#### Get Run Details
```
GET /runs/{run_id}
```

Response includes:
- Run metadata (status, agent_type, timestamps)
- Pending tool (if suspended)
- All events

#### Stream Events (SSE)
```
GET /runs/{run_id}/events
```

Returns Server-Sent Events stream for real-time updates.

#### Resume Suspended Run
```
POST /runs/{run_id}/resume
Content-Type: application/json

{
  "decision": "approved",  // or "rejected"
  "feedback": "Optional rejection reason"
}
```

#### Cancel Run
```
POST /runs/{run_id}/cancel
```

#### Retry Failed Run
```
POST /runs/{run_id}/retry
```

---

## Human-in-the-Loop Approval

The system pauses execution when agents propose "dangerous" tools.

### Dangerous Tools (Require Approval)
- Shell command execution (`exec_shell`)
- File modifications
- Docker operations
- Database operations

### Approval Flow

```
1. Agent proposes dangerous tool
   ↓
2. Run status → "suspended"
   ↓
3. Dashboard shows APPROVAL REQUIRED
   ↓
4. User reviews tool name + arguments
   ↓
5a. User clicks Approve → Tool executes, run continues
5b. User clicks Reject → Agent receives feedback, adapts
```

### Approve via API
```bash
# Approve
curl -X POST http://localhost:3200/runs/{run_id}/resume \
  -H "Content-Type: application/json" \
  -d '{"decision": "approved"}'

# Reject with feedback
curl -X POST http://localhost:3200/runs/{run_id}/resume \
  -H "Content-Type: application/json" \
  -d '{"decision": "rejected", "feedback": "This command is too risky"}'
```

---

## Agent Types

### 1. Orchestrator (Default)
The coordinator agent that delegates to specialized agents.

```bash
curl -X POST http://localhost:3200/runs \
  -d '{"prompt": "Fix the bug and analyze the logs", "agent_type": "orchestrator"}'
```

**Capabilities:**
- Delegates coding tasks to Coding Agent
- Delegates log analysis to Log-Analyzer Agent
- Manages overall workflow

### 2. Coding Agent
Specialized for code understanding and modifications.

```bash
curl -X POST http://localhost:3200/runs \
  -d '{"prompt": "Fix the authentication bug", "agent_type": "coding"}'
```

**Capabilities:**
- Read and analyze files
- Search codebase
- Execute shell commands (with approval)
- Propose code fixes

### 3. Log-Analyzer Agent
Specialized for log analysis and debugging.

```bash
curl -X POST http://localhost:3200/runs \
  -d '{"prompt": "Analyze recent errors in the auth service", "agent_type": "log-analyzer"}'
```

**Capabilities:**
- Query Loki for logs
- Analyze error patterns
- Create detailed reports

---

## Viewing Logs

### Grafana Dashboard
Open http://localhost:3000 (no login required)

**Common Queries:**
```logql
# All agent-server logs
{service="agent-server"}

# Errors only
{service="agent-server"} |= "ERROR"

# Specific run
{service="agent-server"} | json | run_id="550e8400-..."
```

### Docker Logs
```bash
# All services
docker compose logs -f

# Specific service
docker compose logs -f agent-server
```

### Database Queries
```bash
# Connect to database
docker compose exec ops-db psql -U opsuser -d ops_db

# View all runs
SELECT id, status, agent_type, created_at FROM runs ORDER BY created_at DESC;

# View events for a run
SELECT sequence, event_type, created_at
FROM journal_entries
WHERE run_id = '550e8400-...'
ORDER BY sequence;
```

---

## Troubleshooting

### Common Issues

| Problem | Solution |
|---------|----------|
| "Run not found" | Wait a moment - database sync may be delayed |
| Dashboard not loading | Check agent-server is running: `curl http://localhost:3200/health` |
| No events appearing | Check browser DevTools for SSE connection errors |
| Run stuck on approval | Ensure agent-server is connected to database |
| Missing API key error | Add `ANTHROPIC_API_KEY` to `.env` file |
| Database connection refused | Check ops-db is healthy: `docker compose ps` |

### Health Checks

```bash
# Agent server
curl http://localhost:3200/health

# Database
docker compose exec ops-db pg_isready -U opsuser -d ops_db

# All services
docker compose ps
```

### Reset Everything

```bash
# Stop all services and remove data
docker compose down -v

# Rebuild and start fresh
docker compose up --build
```

---

## Example Workflows

### Debug a Bug

```bash
# 1. Create a coding run
curl -X POST http://localhost:3200/runs \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "There is a TypeError in src/services/orderService.ts when processing orders. Debug and fix it.",
    "user_id": "developer",
    "agent_type": "coding"
  }'

# 2. Watch the dashboard for agent progress
# 3. Approve any shell commands when prompted
# 4. Review the fix in the completed run
```

### Analyze Logs

```bash
# 1. Create a log analysis run
curl -X POST http://localhost:3200/runs \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Analyze the last hour of logs for the payment service. Look for errors and patterns.",
    "user_id": "sre",
    "agent_type": "log-analyzer"
  }'

# 2. Review the generated report in the dashboard
```

### Multi-Step Task

```bash
# 1. Use orchestrator for complex tasks
curl -X POST http://localhost:3200/runs \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "First analyze the recent errors in the auth service, then fix any bugs you find.",
    "user_id": "developer",
    "agent_type": "orchestrator"
  }'

# 2. Orchestrator will delegate to log-analyzer, then coding agent
# 3. Approve tools as needed
```

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                         Dashboard                            │
│                    http://localhost:5173                     │
└─────────────────────────────┬───────────────────────────────┘
                              │ REST API + SSE
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      Agent Server                            │
│                    http://localhost:3200                     │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │ Orchestrator│  │   Coding    │  │   Log-Analyzer      │  │
│  │    Agent    │  │    Agent    │  │      Agent          │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
│                              │                               │
│  ┌───────────────────────────▼──────────────────────────┐   │
│  │              Durable Loop (Event Sourcing)            │   │
│  │  - Journal entries persisted to PostgreSQL            │   │
│  │  - Resumable after restart                            │   │
│  │  - HITL via RUN_SUSPENDED state                       │   │
│  └───────────────────────────────────────────────────────┘   │
└─────────────────────────────┬───────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
        ┌──────────┐   ┌──────────┐   ┌──────────┐
        │ ops-db   │   │  Loki    │   │ Grafana  │
        │ Postgres │   │  Logs    │   │Dashboard │
        └──────────┘   └──────────┘   └──────────┘
```

---

## Support

For issues or questions:
- Check the [Troubleshooting](#troubleshooting) section
- View logs in Grafana: http://localhost:3000
- Review the [TESTING.md](./TESTING.md) for test environment setup
