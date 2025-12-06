# Agent Architecture

## Overview

This repository demonstrates a **basic ops agent framework** for building autonomous AI agents that can debug code, analyze logs, and orchestrate complex operational tasks. The framework uses a client-server architecture with real-time event streaming and multi-agent orchestration.

## System Architecture

```
┌─────────────┐
│   ops CLI   │  (Interactive terminal UI)
└──────┬──────┘
       │ HTTP + SSE
       ▼
┌──────────────┐
│ Agent Server │  (Hono HTTP server)
└──────┬───────┘
       │
   ┌───┴───┬──────────┬────────────┐
   ▼       ▼          ▼            ▼
┌─────┐ ┌─────┐  ┌─────────┐  ┌────────┐
│Orch-│ │Cod- │  │Log Ana- │  │Loki/   │
│estr-│ │ing  │  │lyzer    │  │Grafana │
│ation│ │Agent│  │Agent    │  │        │
└─────┘ └──┬──┘  └────┬────┘  └────┬───┘
          │          │             │
          ▼          ▼             ▼
    ┌──────────────────────────────────┐
    │   Bookstore Application          │
    │   (Services + Databases + Logs)  │
    └──────────────────────────────────┘
```

## Core Libraries

### Agent Framework
- **[Vercel AI SDK](https://sdk.vercel.ai/)** (`ai`, `@ai-sdk/anthropic`) - LLM orchestration with tool calling
- **[Hono](https://hono.dev/)** - Lightweight HTTP server framework
- **[Zod](https://zod.dev/)** - Type-safe schema validation
- **[Pino](https://getpino.io/)** - Structured logging

### CLI Interface
- **[Ink](https://github.com/vadimdemedes/ink)** - React for CLIs (interactive terminal UI)
- **[Commander](https://github.com/tj/commander.js)** - Command-line argument parsing
- **[Chalk](https://github.com/chalk/chalk)** - Terminal string styling

### Infrastructure
- **Docker Compose** - Service orchestration
- **Traefik** - Reverse proxy and routing
- **Loki** - Log aggregation
- **Grafana** - Log visualization

## Key Patterns

### 1. BaseAgent Abstract Class

All agents extend a common `BaseAgent` class that provides:
- Lifecycle management (`initialize()`, `run()`, `shutdown()`)
- Event emission for real-time UI updates
- Standardized configuration
- Logging utilities

```typescript
abstract class BaseAgent {
  abstract initialize(): Promise<void>;
  abstract run(task: string): Promise<AgentResult>;
  abstract shutdown(): Promise<void>;

  protected emitEvent(event: AgentEvent): void;
  protected log(level: string, message: string): void;
}
```

### 2. Tool-Based Execution

Agents use the AI SDK's tool calling mechanism to interact with systems:

**Coding Agent Tools**:
- `shell_command_execute` - Run shell commands
- `read_file` - Read file contents
- `write_file` - Modify files
- `find_files` - Search for files by pattern
- `search_code` - Grep codebase

**Log Analyzer Agent Tools**:
- `loki_query` - Query Loki logs with LogQL
- `analyze_logs` - Parse and analyze log patterns
- `generate_report` - Create structured reports

### 3. Multi-Agent Orchestration

The **Orchestration Agent** routes tasks to specialized sub-agents:

```
User Request
     │
     ▼
Orchestration Agent
     │
     ├─→ "Fix bug" ─→ Coding Agent
     ├─→ "Check logs" ─→ Log Analyzer Agent
     └─→ "Fix and verify" ─→ Both (sequential/parallel)
```

Execution modes:
- **Sequential**: Log analysis depends on code changes
- **Parallel**: Tasks are independent

### 4. Event-Driven Architecture

Agents emit typed events for real-time UI updates:

```typescript
type AgentEvent =
  | { type: 'start'; task: string }
  | { type: 'step'; stepNumber: number; reasoning: string }
  | { type: 'tool_call'; tool: string; args: any }
  | { type: 'tool_result'; result: any }
  | { type: 'complete'; success: boolean; message: string }
  | { type: 'error'; error: string };
```

Events flow: `Agent → EventEmitter → HTTP SSE → CLI UI`

### 5. Server-Sent Events (SSE) Streaming

Real-time agent status updates to CLI:

```
Client (CLI)                    Server (Hono)
     │                               │
     ├─── POST /agents/run ──────────▶
     │                               │
     │◀──── SSE: event: start ───────┤
     │◀──── SSE: event: step ────────┤
     │◀──── SSE: event: tool_call ───┤
     │◀──── SSE: event: complete ────┤
     │                               │
```

### 6. Workspace Isolation

Each agent operates in a sandboxed workspace:
- Configurable working directory (`WORK_DIR`)
- Path validation to prevent directory traversal
- Allowlist-based file access control

## Agent Types

### Orchestration Agent
- **Purpose**: Route tasks to specialized agents
- **Pattern**: Decision tree based on task analysis
- **Tools**: Delegation tools (`run_coding_agent`, `run_log_analyzer_agent`, `run_both_agents`)

### Coding Agent
- **Purpose**: Debug and fix code issues
- **Pattern**: ReAct loop (Reasoning → Action → Observation)
- **Tools**: File operations, shell commands, code search

### Log Analyzer Agent
- **Purpose**: Query and analyze distributed logs
- **Pattern**: Query → Parse → Analyze → Report
- **Tools**: Loki queries, log parsing, pattern detection

## Configuration

Agents are configured via environment variables and config objects:

```typescript
interface AgentConfig {
  agentType: string;        // Agent identifier
  model: string;            // LLM model (e.g., 'claude-sonnet-4')
  maxSteps: number;         // Max reasoning steps
  workDir: string;          // Working directory
  logLevel: 'debug' | 'info' | 'error';
}
```

## Communication Protocol

### API Endpoints

```
POST   /agents/coding/run          Run coding agent
POST   /agents/log-analyzer/run    Run log analyzer
POST   /agents/orchestration/run   Run orchestrator
GET    /agents/types                List available agents
GET    /health                      Server health check
```

### Authentication

HTTP Basic Auth for all endpoints:
- Username: `AUTH_USERNAME` (default: admin)
- Password: `AUTH_PASSWORD` (required in `.env`)

## Error Handling

Agents implement graceful error handling:
1. Tool execution errors → Retry or report to LLM
2. LLM API errors → Propagate to user with context
3. Initialization errors → Fail fast with clear message
4. Shutdown errors → Log and continue

## Extensibility

Adding a new agent:

1. **Create agent class**:
```typescript
export class MyAgent extends BaseAgent {
  async initialize(): Promise<void> { /* setup */ }
  async run(task: string): Promise<AgentResult> { /* execute */ }
  async shutdown(): Promise<void> { /* cleanup */ }
}
```

2. **Define tools**:
```typescript
const myTool = tool({
  description: "My tool",
  parameters: z.object({ input: z.string() }),
  execute: async ({ input }) => { /* ... */ }
});
```

3. **Register in server**:
```typescript
app.post('/agents/my-agent/run', async (c) => {
  const agent = new MyAgent(config);
  return await runAgent(agent, c);
});
```

## Monitoring & Observability

- **Agent Logs**: Pino structured JSON logs
- **Application Logs**: Loki aggregation from all services
- **Event Tracing**: Full event history per agent execution
- **Performance**: Step count and execution time tracking

## Security Considerations

- Path traversal prevention in file tools
- Workspace isolation per agent
- Command allowlisting for shell execution
- No direct database access from agents
- Basic auth for API access

## Future Enhancements

- **Agent Memory**: Persist conversation history
- **Tool Caching**: Cache expensive operations
- **Rate Limiting**: Prevent runaway agents
- **Multi-tenancy**: Isolated workspaces per user
- **Agent Pools**: Concurrent agent execution
- **Human-in-the-loop**: Approval for destructive operations
