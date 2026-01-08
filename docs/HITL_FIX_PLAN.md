# Fix HITL Approval Not Working

## Root Cause

The approval button never appears because tools don't publish `hitl.requested` events. The comment claiming "AgentKit automatically emits hitl.requested" is incorrect - tools must publish manually.

## Two Issues

1. **No `hitl.requested` published** - Dashboard never knows approval is needed
2. **Wrong approval format** - Server expects `resolution` but hook sends `action`

## Solution: Factory Pattern with Dependency Injection

Convert tools/agents/network from static exports to factories that receive `publish` as a parameter. This is type-safe, concurrency-safe, and requires no global state.

## Files to Modify

1. `ops/src/tools/types.ts` (NEW) - Shared types for publish function
2. `ops/src/tools/shell-tools.ts` - Convert to factory
3. `ops/src/tools/write-tools.ts` - Convert to factory
4. `ops/src/tools/docker-tools.ts` - Convert to factory
5. `ops/src/tools/index.ts` - Export factories
6. `ops/src/agents/coding.ts` - Convert to factory
7. `ops/src/agents/log-analyzer.ts` - Convert to factory
8. `ops/src/agents/index.ts` - Export factories
9. `ops/src/network.ts` - Convert to factory
10. `ops/src/inngest/functions.ts` - Instantiate with publish
11. `ops/src/server.ts` - Fix approval endpoint format

## Implementation

### Step 1: Create shared types (`ops/src/tools/types.ts`)

```typescript
import type { AgentMessageChunk, HitlRequestedEvent } from '@inngest/agent-kit';

/**
 * Publish function for streaming events.
 * Omits auto-generated fields (timestamp, sequenceNumber, id).
 */
export type StreamingPublishFn = (
  event: Omit<AgentMessageChunk, 'timestamp' | 'sequenceNumber' | 'id'>
) => Promise<void>;

/**
 * Context passed to tool/agent/network factories.
 */
export interface FactoryContext {
  publish: StreamingPublishFn;
}

/**
 * Helper to create a properly typed hitl.requested event.
 */
export function createHitlRequestedEvent(
  data: HitlRequestedEvent['data']
): Omit<HitlRequestedEvent, 'timestamp' | 'sequenceNumber' | 'id'> {
  return { event: 'hitl.requested', data };
}
```

### Step 2: Convert tools to factories (`ops/src/tools/shell-tools.ts`)

```typescript
import { createTool } from '@inngest/agent-kit';
import { z } from 'zod';
import * as crypto from 'node:crypto';
import type { FactoryContext } from './types.js';
import { createHitlRequestedEvent } from './types.js';
import { validateCommand } from './security.js';

export function createShellExecuteTool({ publish }: FactoryContext) {
  return createTool({
    name: 'shell_command_execute',
    description: 'Execute a shell command. Requires human approval.',
    parameters: z.object({
      command: z.string(),
      reason: z.string(),
      workingDirectory: z.string().optional(),
      timeout: z.number().optional().default(30000),
    }),
    handler: async ({ command, reason, workingDirectory, timeout }, { step, network }) => {
      if (!step) {
        return { error: 'Step context not available' };
      }

      const validation = validateCommand(command);
      if (!validation.valid) {
        return { success: false, error: 'Command validation failed', reason: validation.reason };
      }

      const toolCallId = await step.run('generate-shell-tool-id', () => crypto.randomUUID());
      const runId = network?.state?.kv?.get('runId') as string || 'unknown';

      // Publish HITL request - dashboard will show approval button
      await publish(createHitlRequestedEvent({
        requestId: toolCallId,
        runId,
        toolCalls: [{
          partId: toolCallId,
          toolName: 'shell_command_execute',
          toolInput: { command, reason, workingDirectory },
        }],
        expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
        metadata: { reason, riskLevel: 'high' },
      }));

      // Wait for approval
      const approval = await step.waitForEvent(`wait-for-shell-approval-${toolCallId}`, {
        event: 'agentops/tool.approval',
        if: `async.data.toolCallId == "${toolCallId}"`,
        timeout: '4h',
      });

      if (!approval?.data.approved) {
        return { status: 'rejected', error: 'Command rejected', feedback: approval?.data?.feedback };
      }

      // Execute command...
      return await step.run(`execute-shell-command-${toolCallId}`, async () => {
        // ... execution logic
      });
    },
  });
}
```

### Step 3: Convert agents to factories (`ops/src/agents/coding.ts`)

```typescript
import { createAgent, anthropic } from '@inngest/agent-kit';
import type { FactoryContext } from '../tools/types.js';
import { createShellExecuteTool, createWriteFileTool, createDockerRestartTool } from '../tools/index.js';
import { readFileTool, searchCodeTool } from '../tools/file-tools.js';

export function createCodingAgent({ publish }: FactoryContext) {
  return createAgent({
    name: 'coding',
    description: 'Code analysis, debugging, and repairs',
    system: '...',
    model: anthropic({ model: 'claude-sonnet-4-20250514' }),
    tools: [
      // Safe tools (no publish needed)
      readFileTool,
      searchCodeTool,
      // Dangerous tools (need publish for HITL)
      createShellExecuteTool({ publish }),
      createWriteFileTool({ publish }),
      createDockerRestartTool({ publish }),
    ],
  });
}
```

### Step 4: Convert network to factory (`ops/src/network.ts`)

```typescript
import { createNetwork, anthropic } from '@inngest/agent-kit';
import type { FactoryContext } from './tools/types.js';
import { createCodingAgent, createLogAnalyzer } from './agents/index.js';

export function createAgentNetwork({ publish }: FactoryContext) {
  const codingAgent = createCodingAgent({ publish });
  const logAnalyzer = createLogAnalyzer({ publish });

  return createNetwork({
    name: 'ops-network',
    agents: [codingAgent, logAnalyzer],
    defaultModel: anthropic({ model: 'claude-sonnet-4-20250514' }),
    maxIter: 15,
    history: { /* ... */ },
    router: async ({ network, input, lastResult }) => { /* ... */ },
  });
}
```

### Step 5: Instantiate in function (`ops/src/inngest/functions.ts`)

```typescript
import { createState } from '@inngest/agent-kit';
import { inngest } from '../inngest.js';
import { createAgentNetwork } from '../network.js';
import { AGENT_STREAM_TOPIC } from './realtime.js';
import type { StreamingPublishFn } from '../tools/types.js';

export const agentChat = inngest.createFunction(
  { id: 'agent-chat', retries: 3 },
  { event: 'agent/chat.requested' },
  async ({ event, publish }) => {
    const { threadId, userMessage, userId, channelKey } = event.data;
    const runId = event.id ?? `run-${Date.now()}`;
    const subscriptionKey = channelKey || userId;
    const channelName = `user:${subscriptionKey}`;

    // Create bound publish function for tools
    const boundPublish: StreamingPublishFn = async (chunk) => {
      await publish({
        channel: channelName,
        topic: AGENT_STREAM_TOPIC,
        data: {
          ...chunk,
          timestamp: Date.now(),
          sequenceNumber: 0,
          id: `${chunk.event}-${Date.now()}`,
        },
      });
    };

    // Create network with publish injected
    const agentNetwork = createAgentNetwork({ publish: boundPublish });

    const runState = createState({ runId, threadId, userId });

    const networkRun = await agentNetwork.run(userMessage.content, {
      state: runState,
      streaming: {
        publish: async (chunk) => {
          await publish({
            channel: channelName,
            topic: AGENT_STREAM_TOPIC,
            data: chunk,
          });
        },
      },
    });

    return {
      success: true,
      threadId: networkRun.state.threadId,
      resultCount: networkRun.state.results.length,
    };
  }
);
```

### Step 6: Fix approval endpoint (`ops/src/server.ts`)

```typescript
app.post('/api/approve-tool', async (c) => {
  try {
    const body = await c.req.json();
    const { toolCallId, action, reason, threadId } = body as {
      toolCallId: string;
      action: 'approve' | 'deny';
      reason?: string;
      threadId?: string;
    };

    if (!toolCallId || !isValidUUID(toolCallId)) {
      return c.json({ error: 'Valid toolCallId is required' }, 400);
    }
    if (!action || !['approve', 'deny'].includes(action)) {
      return c.json({ error: 'action must be "approve" or "deny"' }, 400);
    }

    await inngest.send({
      name: 'agentops/tool.approval',
      data: {
        toolCallId,
        approved: action === 'approve',
        feedback: reason,
      },
    });

    return c.json({ success: true });
  } catch (error) {
    console.error('Failed to send approval event:', error);
    return c.json({ error: 'Failed to send approval event' }, 500);
  }
});
```

## Implementation Order

1. Create `ops/src/tools/types.ts` with shared types
2. Convert `shell-tools.ts` to factory pattern
3. Convert `write-tools.ts` to factory pattern
4. Convert `docker-tools.ts` to factory pattern
5. Update `ops/src/tools/index.ts` exports
6. Convert `coding.ts` agent to factory
7. Convert `log-analyzer.ts` agent to factory
8. Update `ops/src/agents/index.ts` exports
9. Convert `network.ts` to factory
10. Update `functions.ts` to instantiate with publish
11. Fix `server.ts` approval endpoint
12. Test end-to-end

## Testing

1. `docker compose up --build`
2. Open http://localhost:3001
3. Send "run ls -la" to trigger shell tool
4. Verify approval button appears
5. Click approve, verify command executes
6. Test deny flow with reason
