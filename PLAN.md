# Plan: Hierarchical Multi-Agent System with Recursive Durable Runs

## Summary

Refactor the agent system architecture to support **hierarchical agent definitions** while **preserving existing behavior**:

1. **Keep**: DurableLoop, journaling, SSE streaming, existing event types, Dashboard UI
2. **Change**: How agents are defined (pure config) and how delegation works (child runs)
3. **Result**: Same user experience, cleaner architecture, proper orchestration support

---

## What Stays The Same

- All existing journal event types (RUN_STARTED, AGENT_THOUGHT, TOOL_PROPOSED, etc.)
- SSE streaming via `/runs/:id/events`
- Dashboard Timeline component rendering
- HITL approval flow for dangerous tools
- The DurableLoop execution engine (reused for all agent types)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                      DurableLoop Engine                          │
│  (Reused for ALL agent types - handles journal, LLM, HITL)      │
│                                                                  │
│  loadAgentDefinition(agentType) → { prompt, tools }              │
└────────────────────────────┬────────────────────────────────────┘
                             │
         ┌───────────────────┼───────────────────┐
         ▼                   ▼                   ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│  Orchestrator   │ │  CodingAgent    │ │  LogAnalyzer    │
│  Definition     │ │  Definition     │ │  Definition     │
├─────────────────┤ ├─────────────────┤ ├─────────────────┤
│ Prompt: Router  │ │ Prompt: Debug   │ │ Prompt: Logs    │
│ Tools:          │ │ Tools:          │ │ Tools:          │
│ - run_coding    │ │ - read_file     │ │ - loki_query    │
│ - run_log       │ │ - write_file    │ │ - loki_labels   │
│                 │ │ - shell_exec    │ │ - loki_errors   │
└────────┬────────┘ │ - find_files    │ └─────────────────┘
         │          │ - search_code   │
         │          │ - restart_svc   │
         │          └─────────────────┘
         │
         │ Delegation creates child run (sequential only)
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  Parent Run (orchestrator)                                       │
│  └── Child Run (coding) ← executed via same DurableLoop         │
└─────────────────────────────────────────────────────────────────┘
```

---

## Files to Create

| File | Purpose |
|------|---------|
| `src/agents/types.ts` | AgentDefinition interface |
| `src/agents/definitions/orchestrator.ts` | Orchestrator definition |
| `src/agents/definitions/coding.ts` | Coding agent definition |
| `src/agents/definitions/log-analyzer.ts` | Log analyzer definition |
| `src/agents/definitions/index.ts` | Registry + loader |
| `src/tools/delegation.ts` | Sequential delegation tools |

## Files to Modify

| File | Changes |
|------|---------|
| `src/entities/Run.ts` | Add `agent_type`, `parent_run_id` |
| `src/types/journal.ts` | Add `AgentType` type, `CHILD_RUN_STARTED/COMPLETED` events |
| `src/services/JournalService.ts` | Add `createChildRun()` |
| `src/services/DurableLoop.ts` | Use `loadAgentDefinition()` instead of hardcoded tools |
| `src/routes/runs.ts` | Accept `agentType` parameter |
| `src/routes/index.ts` | Remove agents routes import |
| `ops/packages/dashboard/src/components/Timeline.tsx` | Add child run events |
| `ops/packages/dashboard/src/types/journal.ts` | Add new event types |

## Files to Delete

| File | Reason |
|------|--------|
| `src/agents/orchestration/agent.ts` | Replaced by definition |
| `src/agents/orchestration/tools/*.ts` | Moved to `tools/delegation.ts` |
| `src/agents/coding/agent.ts` | Replaced by definition |
| `src/agents/coding/headless.ts` | Not needed |
| `src/agents/log-analyzer/agent.ts` | Replaced by definition |
| `src/agents/log-analyzer/headless.ts` | Not needed |
| `src/routes/agents.ts` | Legacy streaming removed |
| `src/services/AgentRunner.ts` | Not needed |
| `src/utils/streamingHelper.ts` | Not needed |

---

## Implementation Details

### 1. Agent Definition Interface (`src/agents/types.ts`)

```typescript
import type { CoreTool } from 'ai';

export type AgentType = 'orchestrator' | 'coding' | 'log-analyzer';

export interface AgentDefinition {
  readonly agentType: AgentType;
  getSystemPrompt(): string;
  getTools(context: ToolContext): Record<string, CoreTool>;
}

export interface ToolContext {
  workDir: string;
  lokiUrl: string;
  runId: string;
  parentRunId?: string;
}
```

### 2. Run Entity (`src/entities/Run.ts`)

Add new fields:
```typescript
@Column({ type: 'varchar', length: 50, default: 'orchestrator' })
@Index()
agent_type!: AgentType;

@Column({ type: 'uuid', nullable: true })
@Index()
parent_run_id?: string;

@ManyToOne(() => Run, { nullable: true })
@JoinColumn({ name: 'parent_run_id' })
parent?: Run;

@OneToMany(() => Run, (run) => run.parent)
children!: Run[];
```

### 3. Journal Types (`src/types/journal.ts`)

Add new event types (extend existing, don't replace):
```typescript
export type JournalEventType =
  | 'RUN_STARTED'
  | 'AGENT_THOUGHT'
  | 'TOOL_PROPOSED'
  | 'RUN_SUSPENDED'
  | 'RUN_RESUMED'
  | 'TOOL_RESULT'
  | 'RUN_COMPLETED'
  | 'SYSTEM_ERROR'
  | 'CHILD_RUN_STARTED'    // NEW
  | 'CHILD_RUN_COMPLETED'; // NEW

export interface ChildRunStartedPayload {
  child_run_id: string;
  agent_type: AgentType;
  task: string;
}

export interface ChildRunCompletedPayload {
  child_run_id: string;
  success: boolean;
  summary: string;
}
```

### 4. Coding Agent Definition (`src/agents/definitions/coding.ts`)

```typescript
import type { AgentDefinition, ToolContext } from '../types';
import { getSystemPrompt } from '../coding/prompts';
import {
  createShellTool, createReadFileTool, createWriteFileTool,
  createFindFilesTool, createSearchCodeTool, createLokiQueryTool,
  createLokiLabelsTool, createLokiServiceErrorsTool, createRestartServiceTool,
} from '../coding/tools';

export const codingDefinition: AgentDefinition = {
  agentType: 'coding',

  getSystemPrompt() {
    return getSystemPrompt();
  },

  getTools(ctx: ToolContext) {
    return {
      shell_command_execute: createShellTool(ctx.workDir),
      read_file: createReadFileTool(ctx.workDir),
      write_file: createWriteFileTool(ctx.workDir),
      find_files: createFindFilesTool(ctx.workDir),
      search_code: createSearchCodeTool(ctx.workDir),
      loki_query: createLokiQueryTool(ctx.lokiUrl),
      loki_labels: createLokiLabelsTool(ctx.lokiUrl),
      loki_service_errors: createLokiServiceErrorsTool(ctx.lokiUrl),
      restart_service: createRestartServiceTool(ctx.workDir),
    };
  },
};
```

### 5. Orchestrator Definition (`src/agents/definitions/orchestrator.ts`)

```typescript
import type { AgentDefinition, ToolContext } from '../types';
import { getSystemPrompt } from '../orchestration/prompts';
import { createRunCodingAgentTool, createRunLogAnalyzerTool } from '../../tools/delegation';

export const orchestratorDefinition: AgentDefinition = {
  agentType: 'orchestrator',

  getSystemPrompt() {
    // Update prompt to emphasize SEQUENTIAL execution only
    return getSystemPrompt() + `

IMPORTANT: Execute sub-agent tasks SEQUENTIALLY. Call one sub-agent at a time and wait for results before proceeding.`;
  },

  getTools(ctx: ToolContext) {
    return {
      run_coding_agent: createRunCodingAgentTool(ctx),
      run_log_analyzer_agent: createRunLogAnalyzerTool(ctx),
      // NOTE: run_both_agents removed - orchestrator should call sequentially
    };
  },
};
```

### 6. Definition Registry (`src/agents/definitions/index.ts`)

```typescript
import type { AgentDefinition, AgentType } from '../types';
import { orchestratorDefinition } from './orchestrator';
import { codingDefinition } from './coding';
import { logAnalyzerDefinition } from './log-analyzer';

const definitions: Record<AgentType, AgentDefinition> = {
  orchestrator: orchestratorDefinition,
  coding: codingDefinition,
  'log-analyzer': logAnalyzerDefinition,
};

export function loadAgentDefinition(agentType: AgentType): AgentDefinition {
  const def = definitions[agentType];
  if (!def) throw new Error(`Unknown agent type: ${agentType}`);
  return def;
}
```

### 7. Delegation Tools (`src/tools/delegation.ts`)

Sequential execution - waits for child to complete:

```typescript
import { tool } from 'ai';
import { z } from 'zod';
import { journalService } from '../services/JournalService';
import { runAgentStep } from '../services/DurableLoop';
import type { ToolContext, AgentType } from '../agents/types';

export function createRunCodingAgentTool(ctx: ToolContext) {
  return tool({
    description: 'Delegate a debugging/coding task to the coding agent. Waits for completion.',
    parameters: z.object({
      task: z.string().describe('The task for the coding agent'),
    }),
    execute: async ({ task }) => {
      return await executeChildRun(ctx, 'coding', task);
    },
  });
}

export function createRunLogAnalyzerTool(ctx: ToolContext) {
  return tool({
    description: 'Delegate a log analysis task to the log analyzer agent. Waits for completion.',
    parameters: z.object({
      task: z.string().describe('The task for the log analyzer agent'),
    }),
    execute: async ({ task }) => {
      return await executeChildRun(ctx, 'log-analyzer', task);
    },
  });
}

async function executeChildRun(
  ctx: ToolContext,
  agentType: AgentType,
  task: string
): Promise<{ success: boolean; child_run_id: string; summary: string }> {
  // Get parent run info
  const parentRun = await journalService.getRun(ctx.runId);
  if (!parentRun) throw new Error('Parent run not found');

  // Create child run
  const childRunId = await journalService.createChildRun(
    task,
    parentRun.user_id,
    ctx.runId,
    agentType
  );

  // Record in parent journal
  await journalService.appendEvent(ctx.runId, {
    type: 'CHILD_RUN_STARTED',
    payload: { child_run_id: childRunId, agent_type: agentType, task },
  });

  // Execute child run (uses same DurableLoop!)
  await runAgentStep(childRunId);

  // Wait for child completion (handles HITL by suspending parent too)
  const result = await waitForChildCompletion(ctx.runId, childRunId);

  // Record completion in parent
  await journalService.appendEvent(ctx.runId, {
    type: 'CHILD_RUN_COMPLETED',
    payload: {
      child_run_id: childRunId,
      success: result.success,
      summary: result.summary,
    },
  });

  return { success: result.success, child_run_id: childRunId, summary: result.summary };
}

async function waitForChildCompletion(
  parentRunId: string,
  childRunId: string
): Promise<{ success: boolean; summary: string }> {
  while (true) {
    const run = await journalService.getRun(childRunId);
    if (!run) throw new Error('Child run not found');

    if (run.status === 'completed' || run.status === 'failed') {
      const events = await journalService.getEvents(childRunId);
      const completed = events.find(e => e.event_type === 'RUN_COMPLETED');
      const summary = completed
        ? (completed.payload as { summary: string }).summary
        : 'No summary';
      return { success: run.status === 'completed', summary };
    }

    if (run.status === 'suspended') {
      // Child needs HITL - suspend parent too
      await journalService.appendEvent(parentRunId, {
        type: 'RUN_SUSPENDED',
        payload: { reason: `Waiting for child run ${childRunId} approval` },
      });
      await journalService.updateStatus(parentRunId, 'suspended');

      // Wait for child to be approved and complete
      await waitForChildResume(childRunId);

      // Resume parent
      await journalService.updateStatus(parentRunId, 'running');
      continue; // Re-check child status
    }

    await new Promise(r => setTimeout(r, 500));
  }
}

async function waitForChildResume(childRunId: string): Promise<void> {
  while (true) {
    const run = await journalService.getRun(childRunId);
    if (!run || run.status !== 'suspended') return;
    await new Promise(r => setTimeout(r, 500));
  }
}
```

### 8. DurableLoop Updates (`src/services/DurableLoop.ts`)

Replace hardcoded tools with dynamic loading:

```typescript
import { loadAgentDefinition } from '../agents/definitions';
import type { ToolContext } from '../agents/types';

// Replace getToolsForAgent with:
function getToolsForRun(run: Run) {
  const definition = loadAgentDefinition(run.agent_type);

  const context: ToolContext = {
    workDir: config.workDir,
    lokiUrl: config.lokiUrl,
    runId: run.id,
    parentRunId: run.parent_run_id,
  };

  const allTools = definition.getTools(context);

  // Strip execute from dangerous tools (same logic as before)
  const preparedTools: Record<string, any> = {};
  for (const [name, t] of Object.entries(allTools)) {
    if (isDangerousTool(name)) {
      const { execute, ...rest } = t as any;
      preparedTools[name] = rest;
    } else {
      preparedTools[name] = t;
    }
  }

  return { allTools, preparedTools };
}

// Replace hardcoded system prompt with:
function getSystemPromptForRun(run: Run): string {
  const definition = loadAgentDefinition(run.agent_type);
  return definition.getSystemPrompt();
}

// In executeSingleStep, use run.agent_type to load definition
async function executeSingleStep(runId: string) {
  const run = await journalService.getRun(runId);
  if (!run) return { done: true, needsApproval: false, error: 'Run not found' };

  const { allTools, preparedTools } = getToolsForRun(run);
  const systemPrompt = getSystemPromptForRun(run);

  // Rest stays the same...
  const result = await generateText({
    model: anthropic('claude-sonnet-4-20250514'),
    maxSteps: 1,
    system: systemPrompt,
    messages,
    tools: preparedTools,
  });
  // ...
}
```

### 9. JournalService Updates

```typescript
async createChildRun(
  prompt: string,
  userId: string,
  parentRunId: string,
  agentType: AgentType
): Promise<string> {
  const run = this.runRepository.create({
    prompt,
    user_id: userId,
    parent_run_id: parentRunId,
    agent_type: agentType,
    status: 'pending',
    current_step: 0,
  });
  const saved = await this.runRepository.save(run);
  logger.info({ runId: saved.id, parentRunId, agentType }, 'Created child run');
  return saved.id;
}

// Update createRun to accept agentType
async createRun(prompt: string, userId: string, agentType: AgentType = 'orchestrator'): Promise<string> {
  const run = this.runRepository.create({
    prompt,
    user_id: userId,
    agent_type: agentType,
    status: 'pending',
    current_step: 0,
  });
  // ...
}
```

### 10. Routes Update (`src/routes/runs.ts`)

```typescript
runsRouter.post('/', async (c) => {
  const { prompt, agentType = 'orchestrator' } = await c.req.json();

  if (!['orchestrator', 'coding', 'log-analyzer'].includes(agentType)) {
    return c.json({ error: 'Invalid agent type' }, 400);
  }

  const runId = await startRun(prompt, userId, agentType);
  return c.json({ runId }, 201);
});
```

Update `startRun` in DurableLoop:
```typescript
export async function startRun(
  prompt: string,
  userId: string,
  agentType: AgentType = 'orchestrator'
): Promise<string> {
  const runId = await journalService.createRun(prompt, userId, agentType);
  runAgentStep(runId).catch(/* ... */);
  return runId;
}
```

### 11. Dashboard Timeline Updates

Add new event cases to Timeline.tsx:

```typescript
case 'CHILD_RUN_STARTED': {
  const payload = event.payload as { child_run_id: string; agent_type: string; task: string };
  return (
    <EntryWrapper event={event}>
      <div className="border-l-4 border-purple-500 pl-4 py-2">
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <span className="font-mono">{timestamp}</span>
          <span className="bg-purple-900 text-purple-300 px-2 py-0.5 rounded text-xs">
            DELEGATING
          </span>
        </div>
        <div className="mt-1 text-purple-300">
          <strong>Agent:</strong> {payload.agent_type}
        </div>
        <div className="text-gray-400 text-sm mt-1">{payload.task}</div>
        <a
          href={`?runId=${payload.child_run_id}`}
          className="text-purple-400 hover:text-purple-300 text-sm mt-2 inline-block"
        >
          View child run →
        </a>
      </div>
    </EntryWrapper>
  );
}

case 'CHILD_RUN_COMPLETED': {
  const payload = event.payload as { child_run_id: string; success: boolean; summary: string };
  return (
    <EntryWrapper event={event}>
      <div className={`border-l-4 ${payload.success ? 'border-green-500' : 'border-red-500'} pl-4 py-2`}>
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <span className="font-mono">{timestamp}</span>
          <span className={`px-2 py-0.5 rounded text-xs ${payload.success ? 'bg-green-900 text-green-300' : 'bg-red-900 text-red-300'}`}>
            DELEGATION {payload.success ? 'COMPLETE' : 'FAILED'}
          </span>
        </div>
        <div className="mt-1 text-gray-300">{payload.summary}</div>
      </div>
    </EntryWrapper>
  );
}
```

---

## Execution Order

1. **Schema** - Update Run entity, journal types
2. **Core** - Create `src/agents/types.ts`, update JournalService
3. **Definitions** - Create all definition files
4. **Delegation** - Create `src/tools/delegation.ts`
5. **DurableLoop** - Refactor to use loadAgentDefinition
6. **Routes** - Update runs.ts, remove agents.ts
7. **Dashboard** - Add child run event rendering
8. **Cleanup** - Delete legacy files

---

## Key Design Decisions

1. **Sequential only** - Orchestrator calls sub-agents one at a time
2. **Same DurableLoop** - Child runs use the exact same execution engine
3. **Parent suspends too** - When child needs HITL, parent also suspends
4. **Existing events preserved** - CHILD_RUN_* are additions, not replacements
5. **Same UI behavior** - Timeline shows events in same format

---

## Clarifications (from Architecture Review)

### Timeouts

All polling loops have explicit timeouts:

```typescript
const CHILD_RUN_TIMEOUT_MS = 30 * 60 * 1000;  // 30 minutes max per child run
const CHILD_HITL_TIMEOUT_MS = 60 * 60 * 1000; // 60 minutes max waiting for HITL
const POLL_INTERVAL_MS = 500;

async function waitForChildCompletion(
  parentRunId: string,
  childRunId: string
): Promise<{ success: boolean; summary: string }> {
  const deadline = Date.now() + CHILD_RUN_TIMEOUT_MS;

  while (Date.now() < deadline) {
    // ... existing logic ...
  }

  // Timeout - fail the parent run
  throw new Error(`Child run ${childRunId} timed out after ${CHILD_RUN_TIMEOUT_MS}ms`);
}
```

### Sequential Enforcement

The LLM could propose multiple tool calls in one response. The DurableLoop already handles this with `maxSteps: 1`, but we add explicit handling:

- If multiple delegation tool calls appear in one response, execute only the first
- After the first completes, re-prompt the LLM (it will see the result and can decide next action)

### Parent Status During Child Execution

| Child Status | Parent Status | Dashboard Shows |
|--------------|---------------|-----------------|
| `running` | `running` | "Delegating to coding agent..." |
| `suspended` (HITL) | `suspended` | "Waiting for child approval" + link |
| `completed` | `running` | Parent continues |
| `failed` | `running` | Parent receives failure result |

### HITL Propagation

When a child run is suspended for HITL:
1. Parent transitions to `suspended` with reason `child_hitl`
2. Parent journal records `RUN_SUSPENDED` with `{ reason, blocked_by_child_run_id }`
3. Dashboard shows parent as blocked, with link to child
4. When child is approved/rejected, child transitions out of `suspended`
5. Parent polling detects child no longer suspended → parent resumes automatically (no separate approval needed)

### Circular Dependency Resolution

The plan has a circular dependency:
```
DurableLoop → definitions/orchestrator → tools/delegation → DurableLoop
```

**Resolution**: Use lazy import in `delegation.ts`:

```typescript
// tools/delegation.ts
import type { ToolContext, AgentType } from '../agents/types';
// Note: Do NOT import runAgentStep at top level

export function createRunCodingAgentTool(ctx: ToolContext) {
  return tool({
    // ...
    execute: async ({ task }) => {
      // Lazy import to break circular dependency
      const { runAgentStep } = await import('../services/DurableLoop');
      return await executeChildRun(ctx, 'coding', task, runAgentStep);
    },
  });
}
```

### Error Recovery

**Orphan Detection**: If server crashes during delegation:
- Child run may continue or be orphaned
- On startup, detect orphaned children: `WHERE parent_run_id IS NOT NULL AND status NOT IN ('completed', 'failed') AND parent.status IN ('completed', 'failed')`
- Mark orphaned children as `failed` with `SYSTEM_ERROR` event

**Transaction Safety**: JournalService operations are not wrapped in transactions. For v1, accept this limitation. If a write fails mid-delegation, the parent will timeout waiting for child completion, and fail gracefully.

### Event Projection

`projectToPrompt()` should include `CHILD_RUN_COMPLETED` events so the parent LLM knows what sub-agents returned:

```typescript
case 'CHILD_RUN_COMPLETED': {
  const payload = event.payload as ChildRunCompletedPayload;
  // Add as a tool result so LLM sees sub-agent output
  messages.push({
    role: 'tool',
    content: [{
      type: 'tool-result',
      toolCallId: /* matched from CHILD_RUN_STARTED */,
      result: { success: payload.success, summary: payload.summary },
    }],
  });
  break;
}
```

### Dashboard Navigation

Child run view includes back-navigation:
- Add `parent_run_id` to run details response
- If `parent_run_id` exists, show "← Back to parent run" link at top of Timeline

### Maximum Nesting Depth

For v1: **2 levels only** (orchestrator → worker agents)
- Coding and LogAnalyzer definitions do NOT have delegation tools
- Only Orchestrator definition has `run_coding_agent` / `run_log_analyzer_agent`
- This is enforced by tool availability, not a depth counter

---

## Files Summary

### Create (6 files)
- `ops/packages/agent-server/src/agents/types.ts`
- `ops/packages/agent-server/src/agents/definitions/coding.ts`
- `ops/packages/agent-server/src/agents/definitions/log-analyzer.ts`
- `ops/packages/agent-server/src/agents/definitions/orchestrator.ts`
- `ops/packages/agent-server/src/agents/definitions/index.ts`
- `ops/packages/agent-server/src/tools/delegation.ts`

### Modify (8 files)
- `ops/packages/agent-server/src/entities/Run.ts`
- `ops/packages/agent-server/src/types/journal.ts`
- `ops/packages/agent-server/src/services/JournalService.ts`
- `ops/packages/agent-server/src/services/DurableLoop.ts`
- `ops/packages/agent-server/src/routes/runs.ts`
- `ops/packages/agent-server/src/routes/index.ts`
- `ops/packages/dashboard/src/components/Timeline.tsx`
- `ops/packages/dashboard/src/types/journal.ts`

### Delete (9+ files)
- `ops/packages/agent-server/src/agents/orchestration/agent.ts`
- `ops/packages/agent-server/src/agents/orchestration/tools/` (directory)
- `ops/packages/agent-server/src/agents/coding/agent.ts`
- `ops/packages/agent-server/src/agents/coding/headless.ts`
- `ops/packages/agent-server/src/agents/log-analyzer/agent.ts`
- `ops/packages/agent-server/src/agents/log-analyzer/headless.ts`
- `ops/packages/agent-server/src/routes/agents.ts`
- `ops/packages/agent-server/src/services/AgentRunner.ts`
- `ops/packages/agent-server/src/utils/streamingHelper.ts`
