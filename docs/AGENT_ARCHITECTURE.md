# Agent Architecture (Inngest AgentKit)

## Executive Summary

This document describes the architecture for the OpsAgent system, migrated from a custom event-sourced framework to Inngest AgentKit v0.13.2. The system provides:

- **Durable Execution**: Inngest step functions provide automatic crash recovery
- **Human-in-the-Loop (HITL)**: Dangerous operations pause for human approval
- **Multi-Agent Orchestration**: Network-based routing between specialized agents
- **Real-time Streaming**: Dashboard receives live updates via `useInngestSubscription` from `@inngest/realtime/hooks`
- **Distributed Tracing**: OpenTelemetry integration with Tempo

---

## System Overview

```
                                   ┌─────────────────────────────────────────┐
                                   │              OpsAgent UI                 │
                                   │         (React Dashboard)               │
                                   │   - Submit tasks (PromptInput)          │
                                   │   - View progress (ThoughtStream)       │
                                   │   - Approve/reject (ApprovalModal)      │
                                   └────────────────┬────────────────────────┘
                                                    │
                                          HTTP / SSE│
                                                    ▼
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│                              Agent Server (Hono + AgentKit)                               │
│                                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────────────────┐ │
│  │                            Inngest AgentKit Network                                  │ │
│  │                                                                                      │ │
│  │   ┌──────────────────────────────────────────────────────────────────────────────┐  │ │
│  │   │                          State-Based Router                                   │  │ │
│  │   │                                                                               │  │ │
│  │   │   callCount == 0 ───────────────────────────────────► log-analyzer           │  │ │
│  │   │   phase == "fix" ───────────────────────────────────► coding                 │  │ │
│  │   │   phase == "complete" ──────────────────────────────► undefined (stop)       │  │ │
│  │   │                                                                               │  │ │
│  │   └──────────────────────────────────────────────────────────────────────────────┘  │ │
│  │                                         │                                            │ │
│  │                    ┌────────────────────┴────────────────────┐                      │ │
│  │                    ▼                                          ▼                      │ │
│  │   ┌──────────────────────────────┐          ┌──────────────────────────────┐        │ │
│  │   │       Log Analyzer            │          │         Coding Agent         │        │ │
│  │   │                               │          │                              │        │ │
│  │   │   Tools (Safe):               │          │   Tools (Safe):              │        │ │
│  │   │   - loki_query               │          │   - read_file               │        │ │
│  │   │   - loki_labels              │          │   - find_files              │        │ │
│  │   │   - loki_service_errors      │          │   - search_code             │        │ │
│  │   │   - read_file                │          │                              │        │ │
│  │   │   - search_code              │          │   Tools (Dangerous/HITL):    │        │ │
│  │   │   - report_findings          │          │   - write_file              │        │ │
│  │   │   - complete_analysis        │          │   - shell_command           │        │ │
│  │   │                               │          │   - restart_service         │        │ │
│  │   │   Sets: phase → "fix"        │          │   - complete_fix            │        │ │
│  │   │         findings → {...}     │          │                              │        │ │
│  │   └──────────────────────────────┘          └──────────────────────────────┘        │ │
│  │                                                                                      │ │
│  │   Shared State (network.state.kv):                                                  │ │
│  │   - phase: "analyze" | "fix" | "complete"                                           │ │
│  │   - findings: { file, line, errorType, suggestedAction }                            │ │
│  │                                                                                      │ │
│  └─────────────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                          │
│  ┌────────────────────────┐     ┌────────────────────────┐     ┌──────────────────────┐ │
│  │   Inngest Client       │     │   History Adapter      │     │   OpenTelemetry      │ │
│  │   (Step Functions)     │     │   (PostgreSQL)         │     │   (Tempo Export)     │ │
│  └───────────┬────────────┘     └───────────┬────────────┘     └──────────┬───────────┘ │
└──────────────┼──────────────────────────────┼───────────────────────────────────────────┘
               │                              │                              │
               ▼                              ▼                              ▼
┌──────────────────────────┐   ┌──────────────────────────┐   ┌──────────────────────────┐
│   Inngest Dev Server     │   │       Agent DB           │   │         Tempo            │
│   (localhost:8288)       │   │   (PostgreSQL)           │   │   (Trace Storage)        │
│                          │   │                          │   │                          │
│   - Function execution   │   │   - agent_threads        │   │   - Distributed traces   │
│   - Event routing        │   │   - agent_messages       │   │   - Span visualization   │
│   - Waterfall traces     │   │   - Conversation history │   │   - Grafana integration  │
└──────────────────────────┘   └──────────────────────────┘   └──────────────────────────┘
```

---

## Component Details

### 1. Agent Server

The agent server is built with Hono and uses the AgentKit `createServer()` function:

```typescript
// ops/src/index.ts
import { createServer } from "@inngest/agent-kit/server";
import { opsNetwork } from "./network.js";

const server = createServer({
  appId: "ops-agent",
  networks: [opsNetwork],
});

server.listen(3200);
```

**Endpoints Provided by AgentKit**:
- `POST /` - Start a new agent run
- `GET /` - Health check
- Inngest webhook endpoint (internal)

**Container Configuration**:
- Port: 3200
- Volumes: `/workspace:rw` (project root), Docker socket
- Dependencies: agent-db, loki, inngest-dev

### 2. Agent Network

The network orchestrates **two agents** with a **hybrid router** (code rules first, built-in LLM router for fallback):

```typescript
// ops/src/network.ts
import { createNetwork, getDefaultRoutingAgent } from '@inngest/agent-kit';

export const opsNetwork = createNetwork({
  name: "ops-network",
  agents: [logAnalyzerAgent, codingAgent],  // Only 2 agents - no custom "default"
  maxIter: 15,
  defaultModel: anthropic({ model: "claude-sonnet-4-20250514" }),

  // HYBRID ROUTER: Code rules first, then AgentKit's built-in LLM routing
  defaultRouter: ({ network, history }) => {
    const state = network.state.kv;
    const lastMessage = history[history.length - 1]?.content?.toLowerCase() || '';

    // 1. Check if work is complete
    if (state.get('complete')) {
      return undefined; // Network done
    }

    // 2. Code-based routing rules (deterministic)
    if (lastMessage.includes('log') || lastMessage.includes('error') || lastMessage.includes('trace')) {
      return logAnalyzerAgent;
    }
    if (lastMessage.includes('code') || lastMessage.includes('fix') || lastMessage.includes('debug')) {
      return codingAgent;
    }

    // 3. Check if agent explicitly requested handoff via state
    const nextAgent = state.get('route_to');
    if (nextAgent === 'coding') return codingAgent;
    if (nextAgent === 'log-analyzer') return logAnalyzerAgent;

    // 4. Fallback to AgentKit's built-in LLM routing agent
    // This uses the agent descriptions to intelligently select the next agent
    return getDefaultRoutingAgent();
  },
});
```

**Hybrid Routing Logic**:
| Priority | Condition | Next Agent | Rationale |
|----------|-----------|------------|-----------|
| 1 | `state.complete === true` | undefined (stop) | Task finished |
| 2 | Message contains "log/error/trace" | log-analyzer | Keyword-based routing |
| 3 | Message contains "code/fix/debug" | coding | Keyword-based routing |
| 4 | `state.route_to === "coding"` | coding | Agent-requested handoff |
| 5 | `state.route_to === "log-analyzer"` | log-analyzer | Agent-requested handoff |
| 6 | **fallback** | **`getDefaultRoutingAgent()`** | AgentKit's built-in LLM routing |

**Note**: No custom "default" agent is needed. AgentKit provides `getDefaultRoutingAgent()` which:
- Uses LLM inference to analyze the request and available agents
- Has built-in `select_agent` and `done` tools
- Reads agent descriptions to make intelligent routing decisions

### 3. Agents

**Only 2 custom agents** - AgentKit's built-in `getDefaultRoutingAgent()` handles LLM-based routing for ambiguous requests.

#### Log Analyzer Agent

**Purpose**: Query Loki logs, identify errors, extract stack traces, report findings.

**Tools**:
| Tool | Description |
|------|-------------|
| `loki_query` | Execute LogQL queries against Loki |
| `loki_labels` | List available labels/values |
| `loki_service_errors` | Quick error lookup by service |
| `read_file` | Read source files for context |
| `search_code` | Grep codebase for patterns |
| `report_findings` | Hand off to coding agent with details |
| `complete_analysis` | Mark task complete (no issues found) |

**State Mutations**:
- `report_findings`: Sets `phase → "fix"`, `findings → {...}`
- `complete_analysis`: Sets `phase → "complete"`

#### Coding Agent

**Purpose**: Read code, apply fixes, execute commands, restart services.

**Tools**:
| Tool | Safety | Description |
|------|--------|-------------|
| `read_file` | Safe | Read file contents |
| `find_files` | Safe | Find files by pattern |
| `search_code` | Safe | Regex search in codebase |
| `write_file` | **DANGEROUS** | Overwrite file contents |
| `shell_command` | **DANGEROUS** | Execute shell commands (allowlisted) |
| `restart_service` | **DANGEROUS** | Restart Docker containers |
| `complete_fix` | Safe | Mark task complete |

**State Mutations**:
- `complete_fix`: Sets `phase → "complete"`

### 4. History Database

A dedicated PostgreSQL instance stores conversation history:

```sql
-- ops/src/db/schema.sql
CREATE TABLE agent_threads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE agent_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id UUID REFERENCES agent_threads(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'tool')),
  content JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_messages_thread ON agent_messages(thread_id);
CREATE INDEX idx_threads_user ON agent_threads(user_id);
```

**Why a Dedicated Database?**
- Isolation from application data (Store, Warehouse DBs)
- Independent scaling and backup policies
- No risk of agent data polluting business data
- Clean security boundary

### 5. OpenTelemetry Integration

Traces are exported to Tempo via OTLP:

```typescript
// ops/src/telemetry.ts
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';

const sdk = new NodeSDK({
  traceExporter: new OTLPTraceExporter({
    url: process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT || 'http://tempo:4318/v1/traces',
  }),
  instrumentations: [getNodeAutoInstrumentations()],
  serviceName: 'agentops',
});

sdk.start();
```

**Trace Data Includes**:
- Agent execution spans
- Tool invocation timing
- LLM API calls
- Database queries
- HTTP requests to external services

---

## Data Flow

### Standard Execution Flow

```
1. User submits prompt via Dashboard
         │
         ▼
2. Dashboard POSTs to Agent Server
         │
         ▼
3. AgentKit creates Inngest function run
         │
         ▼
4. Router selects log-analyzer (callCount=0)
         │
         ▼
5. Log analyzer queries Loki
         │
         ├── No errors found → complete_analysis() → phase="complete" → Stop
         │
         └── Errors found → report_findings({file, line, ...}) → phase="fix"
                   │
                   ▼
6. Router selects coding agent
         │
         ▼
7. Coding agent reads findings from state
         │
         ▼
8. Coding agent proposes fix (write_file)
         │
         ▼
9. HITL: Run suspends, waits for approval
         │
         ▼
10. User approves via Dashboard
         │
         ▼
11. Tool executes, coding agent continues
         │
         ▼
12. complete_fix() → phase="complete" → Stop
```

### State Flow Between Agents

```
┌────────────────────┐                    ┌────────────────────┐
│    Log Analyzer    │                    │    Coding Agent    │
│                    │                    │                    │
│  1. Query logs     │                    │                    │
│  2. Find error     │                    │                    │
│  3. report_findings│───── state ──────► │  4. Read findings  │
│     - file         │    kv.set()        │  5. Read file      │
│     - line         │                    │  6. Write fix      │
│     - errorType    │                    │  7. complete_fix   │
│     - suggestion   │                    │                    │
└────────────────────┘                    └────────────────────┘

State Keys:
  phase: "analyze" → "fix" → "complete"
  findings: { file, line, errorType, errorMessage, suggestedAction }
```

---

## HITL Approval Flow

### Dangerous Tool Detection

Tools are marked dangerous in their definition:

```typescript
// ops/src/tools/write-file.ts
export const writeFileTool = {
  name: "write_file",
  dangerous: true,  // Triggers HITL
  timeout: "1h",    // Max wait time for approval
  // ...
};
```

### Approval Sequence

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Agent     │     │   Inngest   │     │  Dashboard  │     │    User     │
└──────┬──────┘     └──────┬──────┘     └──────┬──────┘     └──────┬──────┘
       │                   │                   │                   │
       │ write_file(...)   │                   │                   │
       │──────────────────►│                   │                   │
       │                   │                   │                   │
       │                   │ waitForEvent()    │                   │
       │                   │ (suspends)        │                   │
       │                   │                   │                   │
       │                   │ SSE: pending      │                   │
       │                   │ approval          │                   │
       │                   │──────────────────►│                   │
       │                   │                   │                   │
       │                   │                   │ ApprovalModal     │
       │                   │                   │──────────────────►│
       │                   │                   │                   │
       │                   │                   │     [Approve]     │
       │                   │                   │◄──────────────────│
       │                   │                   │                   │
       │                   │ send event        │                   │
       │                   │◄──────────────────│                   │
       │                   │                   │                   │
       │ resume            │                   │                   │
       │◄──────────────────│                   │                   │
       │                   │                   │                   │
       │ execute tool      │                   │                   │
       │──────────────────►│                   │                   │
       │                   │                   │                   │
```

### Approval Event Schema

```typescript
// Sent by Dashboard when user approves/rejects
{
  name: "agentops/tool.approval",
  data: {
    requestId: "uuid",
    approved: true | false,
    feedback?: "optional rejection reason"
  }
}
```

### Timeout Behavior

| Scenario | Behavior |
|----------|----------|
| User approves | Tool executes, agent continues |
| User rejects | Tool returns error with feedback, agent may try alternative |
| **4 hour timeout** | **Run marked as FAILED** with `approval_timeout` error |

**Design Decision**: Runs are failed on timeout rather than left suspended indefinitely. This ensures no orphaned runs and provides clear feedback to users.

---

## Real-time Streaming Architecture

### Overview

The dashboard receives live updates via Inngest's Realtime infrastructure and the `useInngestSubscription` hook from `@inngest/realtime/hooks`. This replaces manual polling with true streaming.

### Components

```
┌───────────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│      Dashboard        │     │  Agent Server   │     │  Inngest Dev    │
│       (React)         │     │    (Hono)       │     │     Server      │
│                       │     │                 │     │                 │
│ useInngestSubscription│     │ /chat           │────►│ Event Queue     │
│         │             │     │                 │     │                 │
│         │ GET token   │     │ agentChat fn ◄──┼─────┤ Function Run    │
│         │─────────────┼────►│ /realtime/token │     │                 │
│         │             │     │   │             │     │                 │
│         │             │     │   │ publish()   │     │                 │
│         │◄────────────┼─────┼───┘             │     │                 │
│    (streaming)        │     │ Realtime        │     │                 │
│                       │     │ Channel         │     │                 │
└───────────────────────┘     └─────────────────┘     └─────────────────┘
```

### Streaming Flow

1. **User sends message** → `POST /chat` with threadId, message
2. **Dashboard fetches token** → `GET /realtime/token?threadId=...`
3. **Dashboard subscribes** → `useInngestSubscription({ refreshToken })`
4. **Server sends Inngest event** → `agent/chat`
5. **Inngest runs function** → `agentChat` executes network
6. **Function publishes updates** → `publish({ channel, topic, data })`
7. **Dashboard receives stream** → `useInngestSubscription().data` updates
8. **UI renders events** → Text deltas, tool-calls, tool-results in real-time

### Event Types Published

| Event Type | When | Payload |
|------------|------|---------|
| `run.started` | Agent run begins | `{ runId }` |
| `text.delta` | Agent generates text | `{ content: "partial..." }` |
| `tool.call` | Agent calls a tool | `{ toolName, args, toolCallId, requiresApproval }` |
| `tool.result` | Tool execution completes | `{ toolCallId, result, isError }` |
| `run.complete` | Network execution finishes | `{}` |
| `run.error` | Execution failed | `{ error: "message" }` |

### useInngestSubscription Hook

```typescript
import { useInngestSubscription } from '@inngest/realtime/hooks';

const { data, error, state, latestData, clear } = useInngestSubscription({
  enabled: !!threadId,
  refreshToken: () => fetchSubscriptionToken(threadId),
});
```

**Return Values**:
| Property | Type | Description |
|----------|------|-------------|
| `data` | `Array<Message>` | All messages in chronological order |
| `latestData` | `Message` | Most recent message |
| `error` | `Error \| null` | Subscription errors |
| `state` | `InngestSubscriptionState` | Connection state |
| `clear` | `() => void` | Clear accumulated data |

**Connection States**: `"closed"`, `"connecting"`, `"active"`, `"error"`, `"refresh_token"`, `"closing"`

### Token-based Authentication

Frontend subscribes to realtime updates via a signed token:

```typescript
// Server: Generate subscription token
import { getSubscriptionToken } from '@inngest/realtime';

app.get('/realtime/token', async (c) => {
  const threadId = c.req.query('threadId');

  // IMPORTANT: Verify user owns this thread before issuing token
  // const userId = getUserIdFromAuth(c);
  // const thread = await getThread(threadId);
  // if (thread.userId !== userId) return c.json({ error: 'Unauthorized' }, 403);

  const token = await getSubscriptionToken(inngest, {
    channel: createAgentChannel(threadId),
    topics: ['agent_stream'],
  });

  return c.json({ token });
});

// Dashboard: Use token for subscription
useInngestSubscription({
  refreshToken: async () => {
    const res = await fetch(`/realtime/token?threadId=${threadId}`);
    return res.json();
  },
});
```

### Server-side Publishing

```typescript
// ops/src/inngest/functions.ts
export const agentChat = inngest.createFunction(
  { id: 'agent-chat' },
  { event: 'agent/chat' },
  async ({ event, step, publish }) => {
    const { threadId, message } = event.data;

    // Publish events to thread channel
    publish({
      channel: `thread:${threadId}`,
      topic: 'agent_stream',
      data: { type: 'run.started', runId: event.id },
    });

    // ... agent execution ...

    publish({
      channel: `thread:${threadId}`,
      topic: 'agent_stream',
      data: { type: 'run.complete' },
    });
  }
);
```

### HITL Streaming Flow

When a tool requires human approval, the function **suspends** at `step.waitForEvent()`. Events must be published before suspension:

```
Agent calls HITL tool
    │
    ├─► publish({ type: 'tool.call', requiresApproval: true, approvalRequestId })
    │
    ▼
step.waitForEvent('agentops/tool.approval')  ─── FUNCTION SUSPENDS
    │
    │   [Dashboard shows approval UI]
    │   [User clicks Approve/Reject]
    │   [Dashboard POSTs to Inngest: agentops/tool.approval event]
    │
    ▼
FUNCTION RESUMES
    │
    ├─► Execute tool (if approved)
    ├─► publish({ type: 'tool.result', ... })
    │
    ▼
Continue agent execution
```

**Key Points**:
- `tool.call` with `requiresApproval: true` signals the UI to show approval buttons
- Approval events are sent directly to Inngest via `POST /e/{eventKey}`, not through streaming
- Dashboard waits for `tool.result` event to confirm the approval was processed

---

## Durability Guarantees

### Inngest Step Functions

Every significant operation is wrapped in an Inngest step:

```typescript
const result = await step.run('query-loki', async () => {
  return await lokiClient.query(logql);
});
```

**Guarantees**:
- **At-least-once execution**: Steps retry on failure
- **Idempotent replays**: Same step ID = cached result
- **Crash recovery**: Function resumes from last completed step
- **No data loss**: Step results persisted before proceeding

### Failure Modes

| Failure | Recovery |
|---------|----------|
| Server crash mid-execution | Inngest resumes from last step |
| LLM API timeout | Step retries with exponential backoff |
| Tool execution error | Error returned to agent, continues reasoning |
| Database unavailable | Step retries until available |
| Inngest Dev Server down | Queued events delivered when restored |

### Retry Configuration

```typescript
// Default retry policy
{
  attempts: 3,
  backoff: {
    initial: 1000,
    multiplier: 2,
    maxDelay: 30000
  }
}
```

---

## Docker Infrastructure

### Service Topology

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              agentops-network                                │
│                                                                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │   traefik   │  │ inngest-dev │  │  agent-db   │  │    agent-server     │ │
│  │   :80/:8080 │  │    :8288    │  │    :5436    │  │       :3200         │ │
│  │             │  │             │  │             │  │                     │ │
│  │  Routing:   │  │ Dev Server  │  │ PostgreSQL  │  │ Hono + AgentKit     │ │
│  │  api.local/ │  │ Function    │  │ Threads     │  │ Network + Agents    │ │
│  │  agents     │  │ Execution   │  │ Messages    │  │ Tools               │ │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────────────┘ │
│                                                                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │    loki     │  │   grafana   │  │    tempo    │  │   ops-dashboard     │ │
│  │    :3100    │  │    :3000    │  │    :4318    │  │       :3001         │ │
│  │             │  │             │  │             │  │                     │ │
│  │ Log Storage │  │ Dashboards  │  │ Trace Store │  │ React UI            │ │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────────────┘ │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────────┐ │
│  │                    Application Services (Test Environment)              │ │
│  │  store-api, warehouse-alpha, warehouse-beta, store-db, warehouse-dbs   │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
```

### New Services (to add to docker-compose.yaml)

```yaml
# Inngest Dev Server
inngest-dev:
  image: inngest/inngest:latest
  container_name: inngest-dev
  command: "inngest dev -u http://agent-server:3200/api/inngest"
  ports:
    - "8288:8288"
  networks:
    - agentops-network
  restart: unless-stopped

# Dedicated Agent Database
agent-db:
  image: postgres:16-alpine
  container_name: agent-db
  environment:
    POSTGRES_USER: agentuser
    POSTGRES_PASSWORD: ${AGENT_DB_PASSWORD}
    POSTGRES_DB: agent_db
  volumes:
    - agent-db-data:/var/lib/postgresql/data
    - ./ops/src/db/schema.sql:/docker-entrypoint-initdb.d/init.sql
  ports:
    - "5436:5432"
  networks:
    - agentops-network
  healthcheck:
    test: ["CMD-SHELL", "pg_isready -U agentuser -d agent_db"]
    interval: 5s
    timeout: 5s
    retries: 5
  restart: unless-stopped

# Tempo for Trace Storage
tempo:
  image: grafana/tempo:latest
  container_name: tempo
  command: ["-config.file=/etc/tempo.yaml"]
  volumes:
    - ./infra/tempo/tempo.yaml:/etc/tempo.yaml:ro
    - tempo-data:/tmp/tempo
  ports:
    - "4318:4318"  # OTLP HTTP
  networks:
    - agentops-network
  restart: unless-stopped

# Agent Dashboard
ops-dashboard:
  build:
    context: ./ops/dashboard
    dockerfile: Dockerfile
  container_name: ops-dashboard
  ports:
    - "3001:80"
  networks:
    - agentops-network
  labels:
    - "traefik.enable=true"
    - "traefik.http.routers.ops-dashboard.rule=Host(`ops.localhost`)"
    - "traefik.http.routers.ops-dashboard.entrypoints=web"
    - "traefik.http.services.ops-dashboard.loadbalancer.server.port=80"
  depends_on:
    - agent-server
  restart: unless-stopped
```

### Volume Mounts for Agent Server

```yaml
agent-server:
  volumes:
    - .:/workspace:rw                              # Full project access for tools
    - /var/run/docker.sock:/var/run/docker.sock:rw # Docker control for restart_service
```

---

## Security Considerations

### Tool Safety Classification

| Classification | Tools | Approval Required |
|----------------|-------|-------------------|
| **Safe** | read_file, find_files, search_code, loki_* | No |
| **Dangerous** | write_file, shell_command, restart_service | Yes (HITL) |

### Shell Command Allowlist

```typescript
const ALLOWED_COMMANDS = [
  'cat', 'node', 'tsx', 'npm', 'npx',
  'echo', 'ls', 'pwd', 'mkdir', 'test',
  'git', 'docker', 'docker-compose'
];

// Commands validated before execution
function validateCommand(cmd: string): { valid: boolean; reason?: string } {
  const parts = cmd.trim().split(/\s+/);
  const program = parts[0];
  if (!ALLOWED_COMMANDS.includes(program)) {
    return { valid: false, reason: `Command '${program}' not in allowlist` };
  }
  return { valid: true };
}
```

### Path Traversal Prevention

```typescript
function validatePath(requestedPath: string, workDir: string): boolean {
  const resolved = path.resolve(workDir, requestedPath);
  return resolved.startsWith(workDir);
}
```

### Restartable Services Allowlist

```typescript
const RESTARTABLE_SERVICES = [
  'store-api',
  'warehouse-alpha',
  'warehouse-beta',
  'bookstore-ui'
];
// Infrastructure services (traefik, loki, grafana) excluded
```

### API Authentication

```typescript
// Basic Auth middleware (existing)
const authMiddleware = async (c: Context, next: Next) => {
  const auth = c.req.header("Authorization");
  if (!auth?.startsWith("Basic ")) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  // Validate credentials...
};
```

### Container Isolation

- Agent server runs in isolated container
- Docker socket mounted read-write (required for restart_service)
- Workspace mounted read-write (required for write_file)
- No host network access
- Resource limits should be configured

---

## Access Points

| Service | URL | Purpose |
|---------|-----|---------|
| OpsAgent Dashboard | http://localhost:3001 or http://ops.localhost | Submit tasks, approve operations |
| Agent Server API | http://api.localhost/agents | AgentKit HTTP interface |
| Inngest Dev UI | http://localhost:8288 | Function debugging, waterfall traces |
| Grafana | http://grafana.localhost | Logs (Loki) and traces (Tempo) |
| Traefik Dashboard | http://localhost:8080 | Routing inspection |

---

## Observability Stack

### Logs (Loki)

```logql
# Agent activity
{service="agent-server"} | json

# Errors only
{service="agent-server"} | json | level="error"

# Specific run
{service="agent-server"} | json | runId="abc123"

# Tool calls
{service="agent-server"} |= "tool_call"
```

### Traces (Tempo)

Traces include:
- Full agent execution span
- Individual tool call spans
- LLM API call timing
- Database query timing

Query in Grafana Explore with TraceQL:
```
{service.name="agentops" && name="tool_call"}
```

### Inngest Dev UI

Access http://localhost:8288 for:
- Function execution history
- Step-by-step waterfall view
- Event timeline
- Retry/replay capabilities
- Debug logs

---

## Migration Notes

### Components Removed

| Old Component | Replacement |
|--------------|-------------|
| `DurableLoop.ts` | Inngest step functions |
| `JournalService.ts` | Inngest history + PostgreSQL adapter |
| `JournalEntry` entity | `agent_messages` table |
| `Run` entity | Inngest run state |
| Custom SSE streaming | AgentKit built-in streaming |
| EventEmitter pub/sub | Inngest event system |

### Breaking Changes

1. **No backward compatibility** with old run history
2. **Different event format** (AgentKit message parts vs. journal events)
3. **New database schema** (agent_threads, agent_messages)
4. **Different API endpoints** (AgentKit standard vs. custom)

---

## Known Limitations

1. **Single Inngest Dev Server**: Development environment only; production requires Inngest Cloud
2. **No Run History UI**: Historical run queries require direct database access
3. **Approval Timeout Fixed at 1 Hour**: Configurable per-tool but no dynamic adjustment
4. **Sequential Agent Execution**: No parallel agent execution within a single run
5. **Memory Not Persisted Across Runs**: Each run starts fresh (by design)

---

## Future Enhancements

- **Inngest Cloud Integration**: Production deployment with managed infrastructure
- **Run History Dashboard**: Query and visualize past runs
- **Approval Policies**: Auto-approve based on rules (e.g., low-risk commands)
- **Agent Memory**: Optional persistence across runs
- **Parallel Agents**: Execute multiple agents concurrently
- **MCP Tool Support**: Integrate Model Context Protocol tools

---

## Configuration Reference

### Environment Variables

```bash
# Required
ANTHROPIC_API_KEY=sk-ant-...

# Agent Database
AGENT_DATABASE_URL=postgres://agentuser:password@agent-db:5432/agent_db

# Inngest
INNGEST_DEV=1
INNGEST_DEV_SERVER_URL=http://inngest-dev:8288

# OpenTelemetry
OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=http://tempo:4318/v1/traces
OTEL_SERVICE_NAME=agentops

# Loki (for log queries)
LOKI_URL=http://loki:3100

# Agent Server
PORT=3200
WORK_DIR=/workspace
AUTH_USERNAME=admin
AUTH_PASSWORD=secret
```

### Tool Timeouts

| Tool | Timeout | Rationale |
|------|---------|-----------|
| write_file | **4 hours** | User may need to review code changes |
| shell_command | **4 hours** | Consistent timeout across all dangerous tools |
| restart_service | **4 hours** | Consistent timeout across all dangerous tools |

**Note**: All HITL tools use a 4-hour timeout. If not approved within this window, the run is marked as **FAILED** with `approval_timeout` error.

---

## Appendix: File Structure

```
ops/
├── src/
│   ├── index.ts              # Entry point, createServer()
│   ├── network.ts            # Network definition + hybrid router (uses getDefaultRoutingAgent())
│   ├── config.ts             # Environment configuration
│   ├── logger.ts             # Pino logger setup
│   ├── telemetry.ts          # OpenTelemetry setup
│   ├── agents/
│   │   ├── log-analyzer.ts   # Log analyzer system prompt
│   │   └── coding.ts         # Coding agent system prompt
│   │   # NOTE: No "default.ts" - AgentKit's getDefaultRoutingAgent() handles LLM routing
│   ├── tools/
│   │   ├── index.ts          # Tool exports
│   │   ├── allowlist.ts      # Command allowlist
│   │   ├── read-file.ts      # Safe: read file
│   │   ├── write-file.ts     # Dangerous: write file
│   │   ├── search.ts         # Safe: find_files, search_code
│   │   ├── shell.ts          # Dangerous: shell_command
│   │   ├── docker.ts         # Dangerous: restart_service
│   │   ├── loki.ts           # Safe: loki_query, etc.
│   │   └── handoff.ts        # Handoff schema (unused in current impl)
│   ├── db/
│   │   ├── postgres.ts       # Database connection
│   │   ├── history-adapter.ts # Thread/message persistence
│   │   └── schema.sql        # Database schema
│   └── types/
│       └── index.ts          # TypeScript type definitions
├── dashboard/
│   ├── src/
│   │   ├── main.tsx          # React entry point
│   │   ├── App.tsx           # Main app component
│   │   ├── api/
│   │   │   └── client.ts     # API client with runtime config
│   │   ├── hooks/
│   │   │   ├── useAgentStream.ts  # useInngestSubscription wrapper (STREAMING)
│   │   │   └── types.ts           # Stream event types
│   │   └── components/
│   │       ├── Chat.tsx          # Main chat interface
│   │       ├── MessageList.tsx   # Parts-based message rendering
│   │       └── ToolApproval.tsx  # HITL approval UI
│   ├── package.json          # Includes @inngest/realtime
│   ├── vite.config.ts
│   └── Dockerfile
├── package.json
├── tsconfig.json
└── Dockerfile
```
