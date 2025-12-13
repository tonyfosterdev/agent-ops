# Agent Architecture

## Overview

This repository demonstrates a **basic ops agent framework** for building autonomous AI agents that can debug code, analyze logs, and orchestrate complex operational tasks. The framework uses a client-server architecture with a **database-backed journaling system** for real-time feedback and multi-turn conversational sessions.

## System Architecture

```
┌─────────────┐
│   ops CLI   │  (Interactive terminal UI)
└──────┬──────┘
       │ HTTP + SSE
       ▼
┌──────────────┐     ┌──────────┐
│ Agent Server │────▶│  ops-db  │  (PostgreSQL - Journal Storage)
└──────┬───────┘     └──────────┘
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

### Database & Persistence
- **[TypeORM](https://typeorm.io/)** (`typeorm`, `pg`) - ORM for PostgreSQL
- **PostgreSQL** - Journal storage (ops-db)

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

## Journaling System

The journaling system provides database-backed persistence for agent runs with session management and multi-turn conversation support.

### Architecture

```
┌─────────────┐
│   ops CLI   │
└──────┬──────┘
       │
       │ 1. POST /agents/:type/run
       │    → Returns {runId, sessionId, subscribeUrl}
       │
       │ 2. GET /runs/:runId/subscribe (SSE)
       │    → Streams journal entries
       ▼
┌──────────────┐     ┌───────────────┐
│ Agent Server │────▶│    ops-db     │
└──────────────┘     │  (PostgreSQL) │
                     │               │
                     │ ┌───────────┐ │
                     │ │  Session  │ │
                     │ └─────┬─────┘ │
                     │       │       │
                     │ ┌─────▼─────┐ │
                     │ │ AgentRun  │ │
                     │ └─────┬─────┘ │
                     │       │       │
                     │ ┌─────▼──────┐│
                     │ │JournalEntry││
                     │ └────────────┘│
                     └───────────────┘
```

### Database Entities

#### Session

Groups multiple agent runs for conversation context continuity.

```typescript
@Entity('sessions')
export class Session {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 50 })
  agent_type: string;  // 'coding' | 'log-analyzer' | 'orchestration'

  @Column({ nullable: true })
  title: string;

  @Column({ default: 'active' })
  status: 'active' | 'archived';

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  @OneToMany(() => AgentRun, run => run.session)
  runs: AgentRun[];
}
```

#### AgentRun

Represents a single agent execution within a session.

```typescript
@Entity('agent_runs')
export class AgentRun {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Session, session => session.runs)
  @JoinColumn({ name: 'session_id' })
  session: Session;

  @Column()
  run_number: number;  // 1, 2, 3... within session

  @Column({ length: 50 })
  agent_type: string;

  @Column('text')
  task: string;

  @Column({ default: 'running' })
  status: 'running' | 'completed' | 'failed';

  @Column('jsonb', { nullable: true })
  config: Record<string, any>;

  @Column('jsonb', { nullable: true })
  result: Record<string, any>;

  @Column('text', { nullable: true })
  context_summary: string;  // LLM-generated summary for context building

  @CreateDateColumn()
  started_at: Date;

  @Column({ nullable: true })
  completed_at: Date;

  @OneToMany(() => JournalEntry, entry => entry.run)
  entries: JournalEntry[];
}
```

#### JournalEntry

Individual entries in the agent's execution journal.

```typescript
@Entity('journal_entries')
export class JournalEntry {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => AgentRun, run => run.entries)
  @JoinColumn({ name: 'run_id' })
  run: AgentRun;

  @Column()
  sequence_number: number;  // Ordering within run

  @Column({ length: 50 })
  entry_type: string;  // See entry types below

  @Column({ nullable: true })
  step_number: number;  // LLM step number (if applicable)

  @Column('jsonb')
  data: Record<string, any>;

  @CreateDateColumn()
  created_at: Date;
}
```

**Entry Types:**
- `run:started` - Run has begun
- `thinking` - Agent is processing (heartbeat every 2s)
- `text` - Text output from agent
- `tool:starting` - Tool execution beginning
- `tool:complete` - Tool execution finished
- `step:complete` - LLM reasoning step finished
- `run:complete` - Run finished successfully
- `run:error` - Run failed with error

### Services

#### SessionService

Manages session lifecycle:

```typescript
class SessionService {
  // Create new session
  async createSession(agentType: string, title?: string): Promise<string>;

  // Get session by ID
  async getSession(sessionId: string): Promise<Session | null>;

  // List sessions with filters
  async listSessions(filters?: {
    status?: 'active' | 'archived';
    agentType?: string;
    limit?: number;
    offset?: number;
  }): Promise<Session[]>;

  // Archive a session
  async archiveSession(sessionId: string): Promise<void>;

  // Update timestamp on activity
  async updateSessionTimestamp(sessionId: string): Promise<void>;
}
```

#### JournalService

Manages runs and journal entries:

```typescript
class JournalService {
  // Create new run in session
  async createRun(
    sessionId: string,
    agentType: string,
    task: string,
    config?: Record<string, any>
  ): Promise<string>;

  // Write journal entry
  async writeEntry(
    runId: string,
    entryType: string,
    data: Record<string, any>,
    stepNumber?: number
  ): Promise<JournalEntry>;

  // Get entries since sequence number (for SSE polling)
  async getEntriesSince(
    runId: string,
    afterSequence: number
  ): Promise<JournalEntry[]>;

  // Get run by ID
  async getRun(runId: string): Promise<AgentRun | null>;

  // Mark run as completed
  async completeRun(runId: string, result: Record<string, any>): Promise<void>;

  // Mark run as failed
  async failRun(runId: string, error: string): Promise<void>;

  // Get all runs for a session
  async getRunsForSession(sessionId: string): Promise<AgentRun[]>;
}
```

#### ContextService

Builds conversation context using "Summary + Recent" strategy:

```typescript
interface ConversationContext {
  systemPromptAddition: string;  // Injected into agent's system prompt
  recentRuns: Array<{
    runNumber: number;
    task: string;
    result: Record<string, any>;
  }>;
}

class ContextService {
  // Build context from session history
  async buildContext(sessionId: string): Promise<ConversationContext>;
}
```

**Context Strategy:**
- **Last 3 runs**: Full task and result included
- **Older runs**: Summarized via Claude Haiku to save tokens
- Context injected as system prompt addition

### Two-Phase Run Execution

The CLI uses a two-phase approach for agent runs:

```
Phase 1: Start Run
─────────────────────────────────────────────────────────
CLI                                          Server
 │                                              │
 │── POST /agents/:type/run ──────────────────▶│
 │   {task, sessionId?, maxSteps}              │
 │                                              │
 │   ┌──────────────────────────────────────┐  │
 │   │ 1. Create/get session                │  │
 │   │ 2. Create run record                 │  │
 │   │ 3. Start agent in background         │  │
 │   └──────────────────────────────────────┘  │
 │                                              │
 │◀─ 202 {runId, sessionId, subscribeUrl} ─────│
 │                                              │

Phase 2: Subscribe to Journal
─────────────────────────────────────────────────────────
CLI                                          Server
 │                                              │
 │── GET /runs/:runId/subscribe ──────────────▶│
 │                                              │
 │◀── SSE: {type: "entry", entry: {...}} ──────│
 │◀── SSE: {type: "entry", entry: {...}} ──────│
 │◀── SSE: {type: "entry", entry: {...}} ──────│
 │◀── SSE: {type: "complete", run: {...}} ─────│
 │                                              │
```

### Agent runWithJournal Method

Each agent implements `runWithJournal()` for journal-based execution:

```typescript
async runWithJournal(
  runId: string,
  task: string,
  context: ConversationContext,
  journal: JournalService
): Promise<AgentResult> {
  // 1. Write run:started entry
  await journal.writeEntry(runId, 'run:started', { task });

  // 2. Start heartbeat (every 2s while thinking)
  const heartbeat = setInterval(async () => {
    await journal.writeEntry(runId, 'thinking', {
      elapsed_ms: Date.now() - startTime
    });
  }, 2000);

  // 3. Execute with generateText (not streamText)
  const result = await generateText({
    model: this.model,
    system: this.systemPrompt + context.systemPromptAddition,
    prompt: task,
    tools: this.tools,
    maxSteps: this.config.maxSteps,
    onStepFinish: async ({ text, toolCalls, toolResults }) => {
      // Write text entries
      if (text) {
        await journal.writeEntry(runId, 'text', { text }, stepNumber);
      }
      // Write tool entries
      for (const call of toolCalls) {
        await journal.writeEntry(runId, 'tool:complete', {
          toolName: call.toolName,
          args: call.args,
          result: toolResults[call.toolCallId],
          success: true
        }, stepNumber);
      }
    }
  });

  // 4. Stop heartbeat and write completion
  clearInterval(heartbeat);
  await journal.writeEntry(runId, 'run:complete', { result });

  return result;
}
```

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

### Database Configuration

The ops-db PostgreSQL instance stores journal data:

```typescript
// Environment variables
OPS_DB_HOST=localhost      // or 'ops-db' in Docker
OPS_DB_PORT=5435
OPS_DB_USERNAME=opsuser
OPS_DB_PASSWORD=opspass
OPS_DB_DATABASE=ops_db
```

Docker Compose configuration:
```yaml
ops-db:
  image: postgres:16-alpine
  environment:
    POSTGRES_USER: ${OPS_DB_USERNAME:-opsuser}
    POSTGRES_PASSWORD: ${OPS_DB_PASSWORD}
    POSTGRES_DB: ${OPS_DB_DATABASE:-ops_db}
  volumes:
    - ops-db-data:/var/lib/postgresql/data
  ports:
    - "5435:5432"
  healthcheck:
    test: ["CMD-SHELL", "pg_isready -U opsuser -d ops_db"]
```

TypeORM DataSource initialization:
```typescript
import { DataSource } from 'typeorm';
import { Session, AgentRun, JournalEntry } from './entities';
import { config } from './config';

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: config.db.host,
  port: config.db.port,
  username: config.db.username,
  password: config.db.password,
  database: config.db.database,
  synchronize: true,  // Auto-create tables (dev only)
  entities: [Session, AgentRun, JournalEntry],
});

export async function initializeDatabase(): Promise<void> {
  await AppDataSource.initialize();
}
```

## Communication Protocol

### API Endpoints

**Agent Endpoints** (return runId for journal subscription):
```
POST   /agents/coding/run          Run coding agent
POST   /agents/log-analyzer/run    Run log analyzer
POST   /agents/orchestration/run   Run orchestrator
GET    /agents/types               List available agents
```

Request:
```json
{
  "task": "Fix the authentication bug",
  "sessionId": "uuid-optional",
  "maxSteps": 10
}
```

Response (202 Accepted):
```json
{
  "runId": "uuid",
  "sessionId": "uuid",
  "subscribeUrl": "/runs/{runId}/subscribe"
}
```

**Session Endpoints**:
```
POST   /sessions                   Create new session
GET    /sessions                   List sessions (with filters)
GET    /sessions/:sessionId        Get session with runs
POST   /sessions/:sessionId/runs   Start run in existing session
POST   /sessions/:sessionId/archive  Archive session
```

**Run Endpoints**:
```
GET    /runs/:runId                Get run with entries
GET    /runs/:runId/subscribe      SSE subscription to journal
```

**System Endpoints**:
```
GET    /health                     Server health check
```

### SSE Journal Subscription

`GET /runs/:runId/subscribe` streams journal entries in real-time:

```
event: message
data: {"type": "entry", "entry": {"entry_type": "run:started", "data": {...}}}

event: message
data: {"type": "entry", "entry": {"entry_type": "thinking", "data": {"elapsed_ms": 2000}}}

event: message
data: {"type": "entry", "entry": {"entry_type": "text", "data": {"text": "Analyzing..."}}}

event: message
data: {"type": "entry", "entry": {"entry_type": "tool:complete", "data": {...}}}

event: message
data: {"type": "complete", "run": {"id": "uuid", "status": "completed", "result": {...}}}
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

## CLI Session Management

The CLI supports multi-turn conversations through session management.

### Commands

**Interactive Mode Commands:**
```bash
/new       # Reset session, start fresh conversation
/session   # Display current session ID
```

**CLI Options:**
```bash
# Start interactive mode (default)
ops

# Run a task directly
ops run "Fix the authentication bug"

# Continue an existing session
ops run --session-id <uuid> "Now check the logs"

# Specify agent type
ops run --agent coding "Refactor the login function"
```

### Session Continuity

When continuing a session, the agent receives context from previous runs:

```
You: "Find all TypeScript files with authentication logic"
Agent: [searches and reports findings]

You: "Now add input validation to the login function"
Agent: [has context about which files contain auth logic]
       [modifies the correct file based on previous search]
```

### AgentClient Session API

```typescript
const client = new AgentClient();

// Session management
client.setSessionId(sessionId);    // Continue existing session
client.getSessionId();             // Get current session ID
client.resetSession();             // Clear session (start fresh)

// Two-phase run execution
const { runId, sessionId } = await client.startRun('coding', task);
await client.subscribeToRun(runId);  // Stream journal events

// Direct run (combines both phases)
await client.runAgent('coding', task, { maxSteps: 10 });
```

## Monitoring & Observability

- **Agent Logs**: Pino structured JSON logs
- **Application Logs**: Loki aggregation from all services
- **Journal History**: Full execution history in ops-db
- **Event Tracing**: Journal entries with sequence numbers
- **Performance**: Step count and execution time tracking

## Security Considerations

- Path traversal prevention in file tools
- Workspace isolation per agent
- Command allowlisting for shell execution
- No direct database access from agents
- Basic auth for API access

## Future Enhancements

- ~~**Agent Memory**: Persist conversation history~~ ✓ Implemented via Journaling System
- **Tool Caching**: Cache expensive operations
- **Rate Limiting**: Prevent runaway agents
- **Multi-tenancy**: Isolated workspaces per user
- **Agent Pools**: Concurrent agent execution
- **Human-in-the-loop**: Approval for destructive operations
- **Session Search**: Full-text search across journal entries
- **Session Export**: Export session history to markdown/JSON
- **Branching**: Fork sessions to explore alternatives
