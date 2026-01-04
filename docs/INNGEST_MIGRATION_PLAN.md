# Migration Plan: Current Agent Framework → Inngest AgentKit

## Overview

**FULL REPLACEMENT** of the custom event-sourced agent framework with Inngest AgentKit v0.13.2.

### Non-Negotiable Requirements
1. Basic HITL interface for prompting and approvals
2. Multi-agent support (log analysis + coding)
3. Durable functions (Inngest step functions)
4. OpenTelemetry integration
5. **REMOVE ALL OLD AGENT CODE** - follow proven AgentKit patterns

### What We Gain
- Built-in durability (Inngest step functions)
- `useAgent` React hook for chat-like UI
- Network-based multi-agent orchestration
- MCP tool support
- Dev server with waterfall trace view
- OpenTelemetry export to Tempo/Grafana

## Architecture Mapping

| Current Concept | AgentKit Equivalent |
|-----------------|---------------------|
| `DurableLoop.ts` | Inngest step functions (automatic) |
| `JournalService.ts` | Network state + Inngest history |
| `JournalEvent` types | AgentKit message parts |
| Agent definitions | `createAgent()` |
| Tool definitions | `createTool()` with Zod schemas |
| HITL suspension | `step.waitForEvent()` |
| Multi-agent routing | Network with router function |
| SSE streaming | `useAgent` hook |
| `useRun` hook | `useAgent` hook |

## Files to Delete (Full Replacement)

**DELETE ALL OLD CODE** - this is a clean break, not a partial migration.

```bash
# Delete old monorepo packages
rm -rf ops/packages/

# Clear any partial new implementation
rm -rf ops/src/*
rm -rf ops/dashboard/*
```

This removes:
```
ops/packages/
├── agent-server/           # ENTIRE PACKAGE - replaced by AgentKit
│   ├── src/
│   │   ├── services/       # DurableLoop.ts, JournalService.ts
│   │   ├── entities/       # Run.ts, JournalEntry.ts
│   │   ├── routes/         # runs.ts, health.ts
│   │   ├── agents/         # All agent definitions, tools, prompts
│   │   ├── middleware/     # auth.ts, errorHandler.ts
│   │   ├── tools/          # delegation.ts
│   │   └── types/          # journal.ts
│   └── scripts/            # test scripts
├── dashboard/              # ENTIRE PACKAGE - replaced by new chat UI
│   └── src/
│       ├── hooks/          # useRun.ts
│       ├── components/     # Timeline.tsx, CreateRunForm.tsx
│       └── types/          # journal.ts
└── shared/                 # ENTIRE PACKAGE - no longer needed
    └── src/
        ├── events/         # AgentEventEmitter.ts
        └── types/          # agent.ts, api.ts
```

**Nothing from the old architecture is preserved.**

## New Structure (Flattened)

```
ops/
├── src/
│   ├── agents/
│   │   ├── coding.ts           # Code analysis + repairs
│   │   └── log-analyzer.ts     # Log parsing + diagnostics
│   │   # NOTE: No "default" agent needed - AgentKit provides getDefaultRoutingAgent()
│   ├── tools/
│   │   ├── file-tools.ts       # read_file, find_files, search_code
│   │   ├── shell-tools.ts      # shell_command_execute (HITL)
│   │   ├── loki-tools.ts       # loki_query, loki_labels
│   │   └── write-tools.ts      # write_file (HITL)
│   ├── db/
│   │   ├── postgres.ts         # PostgreSQL connection
│   │   ├── history-adapter.ts  # Conversation persistence
│   │   └── schema.sql          # Tables for threads/messages
│   ├── network.ts              # createNetwork() with hybrid router
│   ├── server.ts               # AgentKit HTTP server
│   ├── inngest.ts              # Inngest client setup
│   └── telemetry.ts            # OpenTelemetry → Tempo
├── dashboard/
│   └── src/
│       ├── App.tsx             # Uses AgentProvider
│       ├── main.tsx            # Entry point
│       └── components/
│           ├── AgentChat.tsx   # Chat UI with parts rendering
│           └── ToolApproval.tsx # HITL approval via Inngest events
├── package.json                # Single package (no monorepo)
├── tsconfig.json
└── Dockerfile
```

**Key Changes**:
- No `orchestrator` agent - hybrid router handles routing
- Added `db/` for PostgreSQL history adapter
- OpenTelemetry exports to your existing Tempo

## Clarified Decisions

Based on architectural review:

| Decision | Choice |
|----------|--------|
| **HITL Discovery** | `@inngest/use-agent` hook provides `approveToolCall()` and `denyToolCall()` methods with built-in streaming |
| **Timeout Behavior** | Mark run as failed after 4-hour timeout (tool returns timeout error to agent) |
| **Default Agent** | No custom default - use `getDefaultRoutingAgent()` for LLM-based routing fallback |
| **State.kv Persistence** | Ephemeral per-run (PostgreSQL for conversation history) |
| **Event Correlation** | Use `runId` from network state, matched via `data.runId` in waitForEvent |

## HITL Implementation Details

### How It Works (AgentKit Pattern)

1. **Tool requests approval** via `step.waitForEvent()` inside the tool handler
2. **Dashboard discovers pending approvals** via the `useAgent` hook's streaming - tool calls needing approval appear in the message stream
3. **User approves/rejects** using `approveToolCall(toolCallId)` or `denyToolCall(toolCallId, reason)` from the `useAgent` hook
4. **Event correlation** uses `runId` stored in network state, matched via `match: 'data.runId'`

### Event Correlation Pattern

```typescript
// In tool handler - store runId in state BEFORE waiting
const runId = network.state.kv.get('runId') as string;

// Wait for approval event matching this run
const approval = await step.waitForEvent('agentops/tool.approval', {
  match: 'data.runId',  // Match on the runId field
  timeout: '4h',
});
```

### Timeout Handling

```typescript
const approval = await step.waitForEvent('agentops/tool.approval', {
  match: 'data.runId',
  timeout: '4h',
}).catch((err) => {
  if (err.name === 'TimeoutError') {
    return { data: { approved: false, feedback: 'Approval timed out after 4 hours' } };
  }
  throw err;
});

if (!approval?.data?.approved) {
  return {
    success: false,
    error: approval?.data?.feedback || 'Tool execution rejected',
    timedOut: err?.name === 'TimeoutError'
  };
}
```

### Frontend Integration (useAgent hook)

```tsx
import { useAgent, AgentProvider } from '@inngest/use-agent';

function ChatComponent() {
  const {
    messages,
    sendMessage,
    status,
    approveToolCall,  // Built-in method for HITL
    denyToolCall,     // Built-in method for HITL
  } = useAgent();

  // Tool calls needing approval appear in messages with requiresApproval flag
  // Use approveToolCall(toolCallId) or denyToolCall(toolCallId, reason)
}
```

## Streaming Architecture

AgentKit uses **Inngest Realtime** for streaming, which is a managed **WebSocket** service:

```
┌─────────────┐      WebSocket      ┌─────────────────┐
│  Dashboard  │ ◄─────────────────► │ Inngest Realtime│
│  (useAgent) │                     │   (managed)     │
└─────────────┘                     └────────┬────────┘
                                             │
                                    publish()│
                                             │
                                    ┌────────▼────────┐
                                    │  Agent Server   │
                                    │ (Inngest func)  │
                                    └─────────────────┘
```

### How Streaming Works

1. **Agent server** publishes events via Inngest's `publish()` function
2. **Inngest Realtime** manages WebSocket connections to clients
3. **Clients subscribe** using time-sensitive tokens (server-generated for auth)
4. **`useAgent` hook** abstracts this - handles subscription, reconnection, event ordering

### Required Endpoints

```typescript
// ops/src/server.ts - Required endpoints for streaming

// 1. Token endpoint - generates subscription tokens for WebSocket auth
app.post('/api/realtime/token', authMiddleware, async (c) => {
  const { threadId } = await c.req.json();
  const token = await inngest.realtime.subscribe({
    channel: `thread:${threadId}`,
    topics: ['message', 'tool-call', 'tool-result', 'error'],
  });
  return c.json({ token });
});

// 2. Chat endpoint - triggers agent runs
app.post('/api/chat', authMiddleware, async (c) => {
  const { threadId, message } = await c.req.json();
  await inngest.send({
    name: 'agent/chat',
    data: { threadId, message },
  });
  return c.json({ ok: true });
});
```

### Inngest Function with publish()

```typescript
// ops/src/inngest/functions.ts
export const agentChat = inngest.createFunction(
  { id: 'agent-chat' },
  { event: 'agent/chat' },
  async ({ event, step, publish }) => {
    const { threadId, message } = event.data;

    // Store runId in network state for HITL correlation
    const network = agentNetwork;
    network.state.kv.set('runId', event.id);
    network.state.kv.set('threadId', threadId);

    // Run network with streaming via publish()
    const result = await network.run(message, {
      step,
      streaming: {
        publish: async (data) => {
          await publish({
            channel: `thread:${threadId}`,
            topic: data.type,  // 'message', 'tool-call', etc.
            data,
          });
        },
      },
    });

    return result;
  }
);
```

## Reference: AgentKit Starter Kit

Based on: https://github.com/inngest/agent-kit/tree/main/examples/agentkit-starter

Key patterns to follow:
- PostgreSQL history adapter for conversation persistence
- Client-authoritative message handling for low latency
- WebSocket streaming via Inngest Realtime
- Network with `maxIter` for controlled execution

## Implementation Phases

### Phase 1: Setup & Dependencies

1. Install AgentKit v0.13.2, Inngest, and React hook:
   ```bash
   # Server dependencies
   npm i @inngest/agent-kit@^0.13.2 inngest@^3.45.0 @anthropic-ai/sdk zod

   # Dashboard dependencies (in ops/dashboard/)
   npm i @inngest/use-agent @inngest/realtime react react-dom
   ```

2. Install OpenTelemetry (per Inngest docs):
   ```bash
   npm i @opentelemetry/sdk-node @opentelemetry/auto-instrumentations-node
   npm i @opentelemetry/exporter-trace-otlp-http
   ```

3. Create Inngest client (`ops/src/inngest.ts`):
   ```typescript
   import { Inngest } from 'inngest';
   export const inngest = new Inngest({ id: 'agentops' });
   ```

4. Create OpenTelemetry setup (`ops/src/telemetry.ts`):
   ```typescript
   import { NodeSDK } from '@opentelemetry/sdk-node';
   import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
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

5. Update `docker-compose.yaml` to include Inngest Dev Server

### Phase 2: Migrate Tools

Convert current tools to AgentKit format with Zod schemas:

```typescript
// ops/src/tools/file-tools.ts
import { createTool } from '@inngest/agent-kit';
import { z } from 'zod';

export const readFileTool = createTool({
  name: 'read_file',
  description: 'Read contents of a file',
  parameters: z.object({
    path: z.string().describe('Path to file'),
  }),
  handler: async ({ path }, { step }) => {
    return step.run('read-file', async () => {
      // Implementation from current read_file tool
    });
  },
});
```

**HITL Tools** (shell_command_execute, write_file):

Based on [support-agent-human-in-the-loop example](https://github.com/inngest/agent-kit/tree/main/examples/support-agent-human-in-the-loop):

```typescript
// ops/src/tools/shell-tools.ts
import { createTool } from '@inngest/agent-kit';
import { z } from 'zod';

export const shellExecuteTool = createTool({
  name: 'shell_command_execute',
  description: 'Execute shell command (requires human approval)',
  parameters: z.object({
    command: z.string().describe('The shell command to execute'),
    reason: z.string().describe('Why this command needs to be run'),
  }),
  handler: async ({ command, reason }, { step, network }) => {
    // Get runId from network state for event correlation
    const runId = network.state.kv.get('runId') as string;

    // Wait for human approval (4 hour timeout)
    // The useAgent hook will show this as a pending approval in the UI
    const approval = await step.waitForEvent('agentops/tool.approval', {
      match: 'data.runId',  // Correlate by runId
      timeout: '4h',
    }).catch((err) => {
      if (err.name === 'TimeoutError') {
        return { data: { approved: false, feedback: 'Approval timed out after 4 hours' } };
      }
      throw err;
    });

    if (!approval?.data?.approved) {
      return {
        success: false,
        error: 'Command rejected by human',
        feedback: approval?.data?.feedback,
      };
    }

    // Execute after approval
    return step.run('execute-shell', async () => {
      const { execSync } = await import('child_process');
      const output = execSync(command, {
        encoding: 'utf-8',
        timeout: 30000,
        cwd: '/workspace',
      });
      return { success: true, output };
    });
  },
});
```

### Phase 3: Migrate Agents

**2 Agents** - AgentKit's built-in `getDefaultRoutingAgent()` handles LLM-based routing:

```typescript
// ops/src/agents/coding.ts
import { createAgent } from '@inngest/agent-kit';
import { readFileTool, searchCodeTool, shellExecuteTool, writeFileTool } from '../tools';

export const codingAgent = createAgent({
  name: 'coding',
  description: 'Code analysis, debugging, and repairs',
  system: ({ network }) => {
    const logFindings = network.state.kv.get('log_findings');
    return `You are a coding agent specializing in debugging and code repairs.
${logFindings ? `\nContext from log analysis:\n${JSON.stringify(logFindings, null, 2)}` : ''}
When done, set state.complete = true.`;
  },
  tools: [readFileTool, searchCodeTool, shellExecuteTool, writeFileTool],
});
```

```typescript
// ops/src/agents/log-analyzer.ts
import { createAgent } from '@inngest/agent-kit';
import { lokiQueryTool, lokiLabelsTool, lokiServiceErrorsTool } from '../tools/loki-tools';

export const logAnalyzer = createAgent({
  name: 'log-analyzer',
  description: 'Log parsing, pattern detection, and diagnostics',
  system: `You are a log analyzer agent. Use Loki to query logs and identify:
- Error patterns and root causes
- Service health issues
- Performance anomalies
Store findings in state.log_findings for other agents.
If code changes needed, set state.route_to = 'coding'.
When done, set state.complete = true.`,
  tools: [lokiQueryTool, lokiLabelsTool, lokiServiceErrorsTool],
});
```

### History DB (Dedicated PostgreSQL Instance)

**Important**: The agent has its own isolated PostgreSQL instance (`agent-db`), separate from the Store and Warehouse databases. This ensures:
- Clean separation of concerns
- No risk of agent data polluting application data
- Independent scaling and backup policies

Following the AgentKit starter pattern:

```typescript
// ops/src/db/history-adapter.ts
import { sql } from './postgres';

export const historyAdapter = {
  async createThread(userId: string) {
    const result = await sql`
      INSERT INTO agent_threads (user_id)
      VALUES (${userId})
      RETURNING id
    `;
    return result[0].id;
  },

  async get(threadId: string) {
    const messages = await sql`
      SELECT role, content, created_at
      FROM agent_messages
      WHERE thread_id = ${threadId}
      ORDER BY created_at
    `;
    return messages;
  },

  async appendResults(threadId: string, messages: any[]) {
    for (const msg of messages) {
      await sql`
        INSERT INTO agent_messages (thread_id, role, content)
        VALUES (${threadId}, ${msg.role}, ${JSON.stringify(msg.content)})
      `;
    }
  },
};
```

**Schema** (PostgreSQL - following starter kit pattern):
```sql
-- Thread table
CREATE TABLE agent_threads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  title TEXT,  -- Optional thread title
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Message table (enhanced for multi-agent attribution)
CREATE TABLE agent_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id UUID REFERENCES agent_threads(id) ON DELETE CASCADE,
  message_type TEXT NOT NULL CHECK (message_type IN ('user', 'agent', 'tool')),
  agent_name TEXT,  -- NULL for user messages, agent name for agent/tool messages
  role TEXT NOT NULL,
  content JSONB NOT NULL,
  checksum TEXT,  -- For deduplication
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (thread_id, checksum)
);

-- Indexes for performance
CREATE INDEX idx_messages_thread ON agent_messages(thread_id);
CREATE INDEX idx_messages_created ON agent_messages(created_at);
CREATE INDEX idx_threads_user ON agent_threads(user_id);
CREATE INDEX idx_threads_updated ON agent_threads(updated_at);
```

### Phase 4: Create Network with Hybrid Router

**No separate orchestrator agent** - AgentKit's built-in `getDefaultRoutingAgent()` provides LLM-based routing.

**Hybrid Approach**: Code rules first, then AgentKit's built-in routing agent for LLM fallback.

```typescript
// ops/src/network.ts
import { createNetwork, getDefaultRoutingAgent } from '@inngest/agent-kit';
import { anthropic } from '@inngest/agent-kit/models';
import { codingAgent } from './agents/coding';
import { logAnalyzer } from './agents/log-analyzer';

export const agentNetwork = createNetwork({
  name: 'ops-network',
  agents: [codingAgent, logAnalyzer],  // Only 2 agents - no custom "default"
  defaultModel: anthropic({ model: 'claude-sonnet-4-20250514' }),

  // Hybrid router: code rules first, then AgentKit's built-in LLM routing
  router: async ({ network, history, ...context }) => {
    const state = network.state.kv;
    const lastMessage = history[history.length - 1]?.content?.toLowerCase() || '';

    // 1. Check if work is complete
    if (state.get('complete')) {
      return undefined; // Network done
    }

    // 2. Code-based routing rules (deterministic)
    if (lastMessage.includes('log') || lastMessage.includes('error') || lastMessage.includes('trace')) {
      return logAnalyzer;
    }

    if (lastMessage.includes('code') || lastMessage.includes('fix') || lastMessage.includes('debug')) {
      return codingAgent;
    }

    // 3. Check if agent explicitly requested handoff via state
    const nextAgent = state.get('route_to');
    if (nextAgent === 'coding') return codingAgent;
    if (nextAgent === 'log-analyzer') return logAnalyzer;

    // 4. Fallback to AgentKit's built-in LLM routing agent
    // This agent analyzes the request and selects the best agent from the network
    return getDefaultRoutingAgent();
  },
});
```

**State Passing Between Agents**:

The `network.state.kv` is shared across all agents:

```typescript
// In log-analyzer tool
export const analyzeLogsTool = createTool({
  name: 'analyze_logs',
  handler: async (args, { network }) => {
    const findings = await analyzeLogs(args);

    // Pass findings to other agents via shared state
    network.state.kv.set('log_findings', findings);

    // Request handoff to coding agent
    network.state.kv.set('route_to', 'coding');

    return findings;
  },
});

// In coding agent, can read the findings
export const codingAgent = createAgent({
  system: ({ network }) => {
    const logFindings = network.state.kv.get('log_findings');
    return `You are a coding agent. ${logFindings ? `Recent log findings: ${JSON.stringify(logFindings)}` : ''}`;
  },
});
```

### Phase 5: Server Setup

Replace Hono routes with AgentKit server:

```typescript
// ops/src/server.ts
import { serve } from '@inngest/agent-kit/hono';
import { Hono } from 'hono';
import { agentNetwork } from './network';
import { inngest } from './inngest';

const app = new Hono();

// AgentKit endpoints (handles /agents/*)
app.route('/agents', serve({
  client: inngest,
  networks: [agentNetwork],
}));

// Health check
app.get('/health', (c) => c.json({ status: 'ok' }));

export default app;
```

### Phase 6: Dashboard Migration

Replace custom SSE with `useAgent` and native Inngest events for HITL:

```tsx
// ops/dashboard/src/components/AgentChat.tsx
import { useAgent, AgentProvider } from '@inngest/use-agent';

function AgentChat() {
  const {
    messages,
    sendMessage,
    status,
    approveToolCall,  // Built-in HITL method from useAgent
    denyToolCall,     // Built-in HITL method from useAgent
  } = useAgent();

  return (
    <div>
      {messages.map(({ id, role, parts }) => (
        <div key={id} className={role === 'user' ? 'user-msg' : 'agent-msg'}>
          {parts.map((part) => {
            if (part.type === 'text') {
              return <p key={part.id}>{part.content}</p>;
            }
            if (part.type === 'tool-call' && part.requiresApproval) {
              return (
                <ToolApproval
                  key={part.id}
                  tool={part}
                  onApprove={() => approveToolCall(part.id)}
                  onDeny={(reason) => denyToolCall(part.id, reason)}
                />
              );
            }
            if (part.type === 'tool-result') {
              return <ToolResult key={part.id} result={part} />;
            }
            return null;
          })}
        </div>
      ))}

      <ChatInput onSend={sendMessage} disabled={status !== 'ready'} />
    </div>
  );
}

export function App() {
  return (
    <AgentProvider url="/agents">
      <AgentChat />
    </AgentProvider>
  );
}
```

**HITL Approval Component** (uses built-in useAgent methods):

```tsx
// ops/dashboard/src/components/ToolApproval.tsx
import { useState } from 'react';

interface ToolApprovalProps {
  tool: { id: string; name: string; args: Record<string, unknown> };
  onApprove: () => void;
  onDeny: (reason: string) => void;
}

export function ToolApproval({ tool, onApprove, onDeny }: ToolApprovalProps) {
  const [feedback, setFeedback] = useState('');

  return (
    <div className="tool-approval border p-4 rounded bg-yellow-50">
      <h4 className="font-bold text-yellow-800">⚠️ Approval Required: {tool.name}</h4>
      <pre className="bg-gray-100 p-2 rounded mt-2 text-sm">
        {JSON.stringify(tool.args, null, 2)}
      </pre>
      <input
        className="w-full border rounded p-2 mt-2"
        value={feedback}
        onChange={(e) => setFeedback(e.target.value)}
        placeholder="Optional feedback..."
      />
      <div className="flex gap-2 mt-2">
        <button
          className="bg-green-500 text-white px-4 py-2 rounded"
          onClick={onApprove}
        >
          Approve
        </button>
        <button
          className="bg-red-500 text-white px-4 py-2 rounded"
          onClick={() => onDeny(feedback)}
        >
          Reject
        </button>
      </div>
    </div>
  );
}
```

**Note**: The `useAgent` hook from `@inngest/use-agent` handles all the event sending internally via `approveToolCall()` and `denyToolCall()` methods. No need to manually send Inngest events.

### Phase 7: Docker & Infrastructure

1. Add Inngest Dev Server and dedicated Agent DB to docker-compose:
   ```yaml
   # Dedicated PostgreSQL for agent history (isolated from app DBs)
   agent-db:
     image: postgres:16-alpine
     environment:
       POSTGRES_USER: agentuser
       POSTGRES_PASSWORD: agentpass
       POSTGRES_DB: agent_db
     volumes:
       - agent-db-data:/var/lib/postgresql/data
       - ./ops/src/db/schema.sql:/docker-entrypoint-initdb.d/init.sql
     networks:
       - agentops
     healthcheck:
       test: ["CMD-SHELL", "pg_isready -U agentuser -d agent_db"]
       interval: 5s
       timeout: 5s
       retries: 5

   inngest-dev:
     image: inngest/inngest:latest
     ports:
       - "8288:8288"
     environment:
       - INNGEST_DEV=1
     networks:
       - agentops

   volumes:
     agent-db-data:
   ```

2. Create new ops Dockerfile:
   ```dockerfile
   FROM node:20-alpine
   WORKDIR /app
   COPY package*.json ./
   RUN npm ci
   COPY . .
   RUN npm run build
   # Import telemetry first
   # Using --import for ES modules (not --require)
   CMD ["node", "--import", "./dist/telemetry.js", "./dist/server.js"]
   ```

3. Configure environment (using your existing Tempo):
   ```env
   # Agent Database (dedicated instance)
   AGENT_DATABASE_URL=postgres://agentuser:agentpass@agent-db:5432/agent_db

   # Inngest
   INNGEST_EVENT_KEY=local
   INNGEST_DEV=1
   INNGEST_DEV_SERVER_URL=http://inngest-dev:8288

   # OpenTelemetry → Tempo (your existing stack)
   OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=http://tempo:4318/v1/traces
   OTEL_SERVICE_NAME=agentops

   # Anthropic
   ANTHROPIC_API_KEY=your-key
   ```

### Phase 8: DELETE ALL OLD AGENT CODE

**CRITICAL**: Remove entire `ops/packages/` directory structure:

```bash
# Delete old monorepo packages entirely
rm -rf ops/packages/

# Delete legacy ops/src if it exists
rm -rf ops/src/

# Delete legacy dashboard
rm -rf ops/dashboard/
```

**Files being permanently removed:**

| Old File | Reason |
|----------|--------|
| `packages/agent-server/src/services/DurableLoop.ts` | Replaced by Inngest step functions |
| `packages/agent-server/src/services/JournalService.ts` | Replaced by Inngest history |
| `packages/agent-server/src/entities/Run.ts` | Replaced by Inngest runs |
| `packages/agent-server/src/entities/JournalEntry.ts` | Replaced by Inngest history |
| `packages/agent-server/src/routes/runs.ts` | Replaced by AgentKit serve() |
| `packages/agent-server/src/types/journal.ts` | No longer needed |
| `packages/agent-server/src/agents/definitions/*` | Replaced by createAgent() |
| `packages/dashboard/src/hooks/useRun.ts` | Replaced by useAgent (if using) |
| `packages/dashboard/src/components/Timeline.tsx` | Replaced by new chat UI |

**No backward compatibility** - this is a clean break.

State now lives in:
- Inngest's built-in run history (durable)
- PostgreSQL via history adapter (conversation persistence)

## HITL Flow Comparison

### Current Flow
```
TOOL_PROPOSED → RUN_SUSPENDED → (user action) → RUN_RESUMED → TOOL_RESULT
```

### AgentKit Flow
```
tool-call part → waitForEvent('hitl/approval') → (user action) → tool-result part
```

The `useAgent` hook automatically renders tool-call parts with approve/reject buttons.

## Key Files to Create

| File | Purpose |
|------|---------|
| `ops/src/inngest.ts` | Inngest client configuration |
| `ops/src/network.ts` | Agent network with hybrid router (uses `getDefaultRoutingAgent()`) |
| `ops/src/server.ts` | Hono server with AgentKit |
| `ops/src/agents/coding.ts` | Coding specialist agent |
| `ops/src/agents/log-analyzer.ts` | Log analyzer agent |
| `ops/src/tools/*.ts` | Tool definitions with Zod |
| `ops/dashboard/src/components/AgentChat.tsx` | Chat UI with useAgent |

**Note**: No custom "default" or "orchestrator" agent needed - AgentKit's built-in `getDefaultRoutingAgent()` handles LLM-based routing.

## Key Files to Delete

| File | Reason |
|------|--------|
| `ops/packages/agent-server/src/services/DurableLoop.ts` | Replaced by Inngest |
| `ops/packages/agent-server/src/services/JournalService.ts` | Replaced by Inngest |
| `ops/packages/agent-server/src/entities/Run.ts` | Replaced by Inngest |
| `ops/packages/agent-server/src/entities/JournalEntry.ts` | Replaced by Inngest |
| `ops/packages/agent-server/src/routes/runs.ts` | Replaced by AgentKit server |
| `ops/packages/dashboard/src/hooks/useRun.ts` | Replaced by useAgent |

## Migration Checklist

### Phase 1: Setup
- [ ] Delete `ops/packages/` directory entirely
- [ ] Create new `ops/src/` structure
- [ ] Install `@inngest/agent-kit@^0.13.2`, `inngest@^3.45.0`
- [ ] Install OpenTelemetry packages
- [ ] Create `ops/src/inngest.ts` client
- [ ] Create `ops/src/telemetry.ts` (OTel → Tempo)

### Phase 2: Database
- [ ] `ops/src/db/postgres.ts` connection
- [ ] `ops/src/db/history-adapter.ts` (threads + messages)
- [ ] `ops/src/db/schema.sql` (agent_threads, agent_messages)

### Phase 3: Tools
- [ ] `ops/src/tools/file-tools.ts` (read_file, find_files, search_code)
- [ ] `ops/src/tools/shell-tools.ts` (shell_command_execute with HITL)
- [ ] `ops/src/tools/write-tools.ts` (write_file with HITL)
- [ ] `ops/src/tools/loki-tools.ts` (loki_query, loki_labels)

### Phase 4: Agents (only 2 - no "default" agent needed)
- [ ] `ops/src/agents/coding.ts` (reads log_findings from state)
- [ ] `ops/src/agents/log-analyzer.ts` (writes to state)
- Note: AgentKit's `getDefaultRoutingAgent()` handles LLM-based routing fallback

### Phase 5: Network & Server
- [ ] `ops/src/network.ts` with hybrid router (code rules → LLM fallback)
- [ ] `ops/src/server.ts` with Hono + AgentKit serve()
- [ ] Wire history adapter into network

### Phase 6: Dashboard
- [ ] Create new `ops/dashboard/` with basic chat UI
- [ ] `ops/dashboard/src/components/Chat.tsx`
- [ ] `ops/dashboard/src/components/ToolApproval.tsx`
- [ ] Wire up Inngest event sending for approvals

### Phase 7: Infrastructure
- [ ] Add `inngest-dev` to docker-compose.yaml
- [ ] Create `ops/Dockerfile`
- [ ] Create `ops/.env.example`
- [ ] Run schema.sql on existing PostgreSQL

### Phase 8: Validation
- [ ] Test basic chat flow
- [ ] Test HITL approval via Inngest events
- [ ] Test hybrid routing (code rules + LLM fallback)
- [ ] Test state passing between agents
- [ ] Verify OTel traces in Tempo/Grafana
- [ ] Verify durability on server restart

## Success Criteria

1. **HITL Interface**: Chat UI where users can prompt agents and approve/reject dangerous tool calls
2. **Multi-Agent**: Hybrid router (code rules first, `getDefaultRoutingAgent()` fallback) delegates to coding/log-analyzer
3. **State Sharing**: `network.state.kv` passes findings between agents
4. **History DB**: PostgreSQL stores conversation threads/messages
5. **Durability**: Inngest step functions automatically resume on failure/restart
6. **OpenTelemetry**: Traces visible in Tempo via Grafana
7. **No Old Code**: `ops/packages/` directory completely removed
8. **Proven Patterns**: Implementation follows AgentKit starter examples

## Architecture Note: Built-in vs Custom Routing

AgentKit provides **three routing options**:

| Option | Description | When to Use |
|--------|-------------|-------------|
| **No router specified** | Uses built-in `getDefaultRoutingAgent()` automatically | Fully autonomous LLM routing |
| **Custom function router** | Code-based deterministic rules | When you need predictable behavior |
| **Hybrid (our choice)** | Code rules + `getDefaultRoutingAgent()` fallback | Best of both worlds |

The built-in routing agent:
- Uses LLM inference to select the best agent based on agent descriptions
- Has `select_agent` and `done` tools internally
- Requires `defaultModel` on the network
