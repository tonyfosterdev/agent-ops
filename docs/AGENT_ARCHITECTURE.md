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

The agent server is built with Hono and uses Inngest's `serve()` handler:

```typescript
// ops/src/server.ts
import { Hono } from 'hono';
import { serve as serveInngest } from 'inngest/hono';
import { inngest } from './inngest';
import { inngestFunctions } from './inngest/index';

const app = new Hono();

// Inngest serve handler - handles function execution
app.on(['GET', 'POST', 'PUT'], '/api/inngest', (c) => {
  const handler = serveInngest({
    client: inngest,
    functions: inngestFunctions,
  });
  return handler(c);
});
```

**Endpoints**:
- `POST /api/chat` - Send message to trigger agent execution
- `POST /api/realtime/token` - Get WebSocket subscription token
- `POST /api/approve-tool` - Approve/deny tool execution
- `POST /api/threads` - Create conversation thread
- `GET /api/threads/:threadId/history` - Get thread history
- `GET /api/inngest` - Inngest webhook endpoint
- `GET /api/health` - Health check

**Container Configuration**:
- Port: 3200
- Volumes: `/workspace:rw` (project root), Docker socket
- Dependencies: agent-db, loki, inngest-dev

### 2. Agent Network

The network orchestrates **two agents** with an **LLM-only router** that prioritizes correctness over speed:

```typescript
// ops/src/network.ts
import { createNetwork } from '@inngest/agent-kit';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

// Configurable threshold - below this, ask for clarification
const CLARIFICATION_THRESHOLD = parseFloat(process.env.ROUTING_CONFIDENCE_THRESHOLD ?? '0.7');

// Zod schema for validated LLM responses
const routingDecisionSchema = z.object({
  agent: z.enum(['log-analyzer', 'coding', 'unclear']),
  confidence: z.number().min(0).max(1),
  reason: z.string(),
});

export const opsNetwork = createNetwork({
  name: "ops-network",
  agents: [logAnalyzerAgent, codingAgent],
  maxIter: 15,
  defaultModel: anthropic({ model: "claude-sonnet-4-20250514" }),

  // LLM-ONLY ROUTER: All routing decisions use LLM classification
  // Design principle: Correctness first, optimize for speed later
  router: async ({ network, input, lastResult }) => {
    const state = network.state.kv;

    // Priority 1: Check if work is complete
    if (state.get('complete')) {
      state.delete('currentAgent');
      return undefined;
    }

    // Priority 2: User confirmed handoff from previous suggestion
    const handoffSuggested = state.get('handoff_suggested') as string | undefined;
    if (handoffSuggested && userConfirmsHandoff(input)) {
      state.delete('handoff_suggested');
      state.set('currentAgent', handoffSuggested);
      return handoffSuggested === 'coding' ? codingAgent : logAnalyzer;
    }
    if (handoffSuggested) state.delete('handoff_suggested'); // Clear stale

    // Priority 3: Explicit handoff via state (agent-requested)
    const nextAgent = state.get('route_to') as string | undefined;
    if (nextAgent) {
      state.delete('route_to');
      state.set('currentAgent', nextAgent);
      return nextAgent === 'coding' ? codingAgent : logAnalyzer;
    }

    // Priority 4: Sticky behavior - keep current agent if it has results
    const currentAgent = state.get('currentAgent') as string | undefined;
    if (currentAgent && lastResult) {
      return currentAgent === 'coding' ? codingAgent : logAnalyzer;
    }

    // Priority 5: LLM classification for ALL initial routing
    const decision = await classifyIntentWithLLM(input);
    if (decision.agent === 'unclear' || decision.confidence < CLARIFICATION_THRESHOLD) {
      state.set('needs_clarification', true);
      state.set('currentAgent', 'log-analyzer'); // Default to read-only
      return logAnalyzer;
    }

    state.set('currentAgent', decision.agent);
    return decision.agent === 'coding' ? codingAgent : logAnalyzer;
  },
});
```

**Design Decision: LLM-Only Routing**

Keyword matching was considered but rejected:
- **False positives**: "I got an error trying to fix the code" matches "fix the" → wrong agent
- **Context blindness**: Keywords can't understand nuance or intent
- **Maintenance burden**: Constantly updating keyword lists

LLM classification understands intent, not just keywords. If latency becomes a problem, we can add keyword caching for proven patterns later.

**Routing Priority**:
| Priority | Condition | Action | Rationale |
|----------|-----------|--------|-----------|
| 1 | `state.complete === true` | Stop network | Task finished |
| 2 | User confirms handoff ("yes", "ok") | Route to suggested agent | Explicit user consent |
| 3 | Agent set `route_to` in state | Route to requested agent | Agent-requested handoff |
| 4 | Sticky + has results | Continue current agent | Prevents mid-conversation switching |
| 5 | LLM classification | Route based on intent | Correctness-first routing |
| 6 | LLM uncertain / low confidence | log-analyzer + clarification | Ask user for intent |

**LLM Intent Classification**:
```typescript
async function classifyIntentWithLLM(input: string): Promise<RoutingDecision> {
  // Uses Claude 3.5 Haiku for fast classification
  // Structured messages prevent prompt injection
  // Zod schema validates response format
  // Error handling falls back to log-analyzer (read-only = safer)
}
```

**Clarification Handling**:
When the router sets `needs_clarification: true`, the log-analyzer agent prepends a clarification request:
```
"I want to make sure I help you correctly. Are you looking to:
- Check the logs to see what errors are occurring?
- Look at the code to understand or fix something?"
```

**Environment Configuration**:
- `ROUTING_CONFIDENCE_THRESHOLD` (default: 0.7) - Below this threshold, ask for clarification
- `ANTHROPIC_API_KEY` - Required for LLM router

### 3. Agents

Both agents follow a **conversational, answer-first pattern**: they investigate, ANSWER the user's question, then SUGGEST next actions and wait for user confirmation before taking action.

#### Log Analyzer Agent

**Purpose**: Query Loki logs, identify errors, extract stack traces, and ANSWER questions about system behavior.

**Conversational Behavior**:
1. INVESTIGATE: Query logs to find relevant information
2. ANSWER: Provide a clear, direct answer to the user's question
3. SUGGEST: Offer next steps (e.g., "Would you like me to hand this to the coding agent?")
4. WAIT: Do not hand off automatically - wait for user confirmation

**Example Response**:
```
I found the error. The last error from store-api was:

**Error:** TypeError: Cannot read property 'id' of undefined
**Time:** 2 minutes ago
**Location:** /app/dist/services/bookService.js:42

**Would you like me to:**
- Search for more context around this error?
- Hand this off to the coding agent to investigate and fix the source code?
```

**Tools**:
| Tool | Description |
|------|-------------|
| `loki_query` | Execute LogQL queries against Loki |
| `loki_labels` | List available labels/values |
| `loki_service_errors` | Quick error lookup by service |
| `read_file` | Read source files for context |
| `search_code` | Grep codebase for patterns |
| `report_findings` | Store findings (no longer auto-routes) |
| `complete_task` | Mark task complete |

**State Mutations**:
- `report_findings`: Sets `log_findings → {...}` (user must confirm handoff)
- `complete_task`: Sets `complete → true`

#### Coding Agent

**Purpose**: Read code, EXPLAIN issues, and apply fixes with user confirmation.

**Conversational Behavior**:
1. INVESTIGATE: Read relevant source files, search for patterns
2. ANSWER: Explain what you found - the root cause, the relevant code
3. SUGGEST: Offer to fix it ("Would you like me to remove this error?")
4. WAIT: Only write code after user confirms they want the fix

**Example Response**:
```
I found the issue. In `services/store-api/src/services/bookService.ts`:

**Problem:** Line 12 has a deliberate error throw causing all book requests to fail.
**Code:**
```typescript
async listBooks() {
  throw new Error('Terrible error');  // <-- This is the problem
}
```

**Would you like me to:**
- Remove this error and fix the method?
- Investigate further to understand why this was added?
```

**Tools**:
| Tool | Safety | Description |
|------|--------|-------------|
| `read_file` | Safe | Read file contents |
| `search_code` | Safe | Regex search in codebase |
| `write_file` | **DANGEROUS** | Overwrite file contents (requires approval) |
| `shell_command` | **DANGEROUS** | Execute shell commands (requires approval) |
| `docker_compose_restart` | **DANGEROUS** | Restart Docker containers (requires approval) |
| `complete_task` | Safe | Mark task complete |

**State Mutations**:
- `complete_task`: Sets `complete → true`

**Important**: After docker_compose_restart succeeds, the agent completes immediately - no verification curl commands.

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

### Conversational Execution Flow

The system follows a **conversational pattern** where agents ANSWER questions first, then ASK before taking action:

```
1. User submits prompt via Dashboard
         │
         ▼
2. Router classifies intent (keyword matching or LLM)
         │
         ├── Ambiguous → Set needs_clarification, route to log-analyzer
         │
         ├── Log keywords ("show me logs") → log-analyzer
         │
         └── Code keywords ("fix the bug") → coding
                   │
                   ▼
3. Agent investigates and ANSWERS the question
         │
         ▼
4. Agent SUGGESTS next actions
         │
         ▼
5. Run completes, user sees answer + suggestions
         │
         ▼
6. User responds with their choice (new message)
         │
         ├── "Yes, investigate the code" → Router detects confirmation
         │                                  → Routes to coding agent
         │
         └── "No, search more logs" → Router continues with log-analyzer
```

### Handoff Flow (User-Confirmed)

```
┌────────────────────┐         ┌──────────────┐         ┌────────────────────┐
│    Log Analyzer    │         │     User     │         │    Coding Agent    │
│                    │         │              │         │                    │
│  1. Query logs     │         │              │         │                    │
│  2. Find error     │         │              │         │                    │
│  3. ANSWER:        │         │              │         │                    │
│     "Found error   │         │              │         │                    │
│      at line 42"   │────────►│  Sees answer │         │                    │
│                    │         │              │         │                    │
│  4. SUGGEST:       │         │              │         │                    │
│     "Hand off to   │────────►│  Chooses     │         │                    │
│      coding?"      │         │  option      │         │                    │
│                    │         │              │         │                    │
│  5. complete_task  │         │              │         │                    │
│                    │         │   "Yes"      │─────────►│  6. Read findings │
└────────────────────┘         └──────────────┘         │  7. Read file     │
                                                        │  8. ANSWER:       │
                                                        │     "Issue is..." │
                                                        │  9. SUGGEST:      │
                                                        │     "Fix it?"     │
                                                        │                    │
                                                        │  [User says yes]  │
                                                        │  10. write_file   │
                                                        │  11. restart svc  │
                                                        │  12. complete     │
                                                        └────────────────────┘
```

### State Keys

```
State Keys:
  complete: boolean              - Network stops when true
  currentAgent: string           - Sticky routing (prevents mid-conversation switch)
  handoff_suggested: string      - Agent suggested handoff, awaiting user confirmation
  needs_clarification: boolean   - Router uncertain, agent should ask user
  log_findings: object           - Findings from log-analyzer for coding agent context
  route_to: string               - Explicit agent handoff (legacy, prefer suggestions)
```

### Key Differences from Auto-Handoff

| Old Behavior | New Behavior |
|--------------|--------------|
| Agent calls report_findings(handoffToCoding: true) | Agent stores findings, ASKS user |
| Router auto-selects next agent | User confirms, THEN routing happens |
| Agent immediately acts | Agent ANSWERS, then SUGGESTS action |
| No clarification mechanism | Router asks user when uncertain |

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

### useAgents Hook

```typescript
import { useAgents, AgentProvider } from '@inngest/use-agent';

// Wrap app with AgentProvider
<AgentProvider
  userId={userId}
  transport={{
    api: {
      sendMessage: '/api/chat',
      getRealtimeToken: '/api/realtime/token',
      approveToolCall: '/api/approve-tool',
    },
  }}
>
  <Chat />
</AgentProvider>

// In Chat component
const {
  messages,
  status,
  sendMessage,
  approveToolCall,
  denyToolCall,
  error,
} = useAgents({ debug: true });
```

**Return Values**:
| Property | Type | Description |
|----------|------|-------------|
| `messages` | `ConversationMessage[]` | All messages with parts |
| `status` | `AgentStatus` | Connection/processing status |
| `sendMessage` | `(msg: string) => void` | Send user message |
| `approveToolCall` | `(id: string) => void` | Approve HITL tool |
| `denyToolCall` | `(id: string, reason?: string) => void` | Deny HITL tool |
| `error` | `Error \| null` | Connection errors |

**Agent Status**: `"ready"`, `"submitted"`, `"streaming"`, `"error"`

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
| Agent Dashboard | http://agents.localhost | Submit tasks, approve operations |
| Agent Server API | http://api.localhost/agents/api | AgentKit HTTP interface |
| Inngest Dev UI | http://inngest.localhost | Function debugging, waterfall traces |
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
│   ├── server.ts             # Entry point, Hono server + endpoints
│   ├── inngest.ts            # Inngest client initialization
│   ├── network.ts            # Network definition + LLM router
│   ├── config.ts             # Environment configuration
│   ├── telemetry.ts          # OpenTelemetry setup
│   ├── agents/
│   │   ├── index.ts          # Agent exports
│   │   ├── log-analyzer.ts   # Log analyzer agent factory
│   │   └── coding.ts         # Coding agent factory
│   ├── prompts/
│   │   ├── index.ts          # Prompt exports
│   │   ├── codingPrompt.ts   # Coding agent system prompt
│   │   ├── logAnalyzerPrompt.ts # Log analyzer system prompt
│   │   └── routerPrompt.ts   # Router classifier prompt
│   ├── constants/
│   │   ├── index.ts          # Constants exports
│   │   └── state-keys.ts     # Network state key constants
│   ├── inngest/
│   │   ├── index.ts          # Function exports
│   │   ├── functions.ts      # agentChat function definition
│   │   └── realtime.ts       # Channel/topic constants
│   ├── tools/
│   │   ├── index.ts          # Tool exports
│   │   ├── types.ts          # Tool type definitions
│   │   ├── security.ts       # Command allowlist validation
│   │   ├── file-tools.ts     # Safe: read_file, find_files, search_code
│   │   ├── write-tools.ts    # Dangerous: write_file
│   │   ├── shell-tools.ts    # Dangerous: shell_command_execute
│   │   ├── docker-tools.ts   # Dangerous: docker_compose_restart
│   │   ├── loki-tools.ts     # Safe: loki_query, etc.
│   │   └── state-tools.ts    # report_findings, complete_task
│   └── db/
│       ├── index.ts          # Database exports
│       ├── postgres.ts       # Database connection + schema
│       └── history-adapter.ts # Thread/message persistence
├── dashboard/
│   ├── src/
│   │   ├── main.tsx          # React entry point
│   │   ├── App.tsx           # Main app + AgentProvider
│   │   ├── api/
│   │   │   └── client.ts     # API client with runtime config
│   │   ├── hooks/
│   │   │   └── useHitlState.ts # HITL state from streaming events
│   │   └── components/
│   │       ├── Chat.tsx          # Main chat interface (useAgents)
│   │       ├── MessageList.tsx   # Parts-based message rendering
│   │       ├── ToolApproval.tsx  # HITL approval UI
│   │       └── LoadingSpinner.tsx # Reusable spinner
│   ├── index.html            # HTML template with config.js
│   ├── nginx.conf            # Nginx config with API proxy
│   ├── docker-entrypoint.sh  # Runtime config generation
│   ├── package.json          # Includes @inngest/use-agent
│   ├── vite.config.ts
│   └── Dockerfile
├── package.json
├── tsconfig.json
└── Dockerfile
```
