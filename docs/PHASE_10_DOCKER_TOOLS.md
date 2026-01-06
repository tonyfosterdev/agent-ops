# Phase 10: Docker Tools for Service Management

## Problem Statement

After the coding agent makes code changes, it needs to rebuild and restart the affected service container. Currently:
- The agent tries to use `shell_command_execute` with `npm run build` - but this only rebuilds inside the container
- The actual need is to rebuild the Docker IMAGE and restart the container
- The Docker socket is already mounted (`/var/run/docker.sock:/var/run/docker.sock:rw`)

## Solution: Docker Compose Restart Tool

Create a new `docker-tools.ts` with a single focused tool that rebuilds and restarts services.

## Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `ops/src/tools/docker-tools.ts` | CREATE | Docker compose restart tool with HITL |
| `ops/src/tools/index.ts` | MODIFY | Export docker tools |
| `ops/src/agents/coding.ts` | MODIFY | Add docker tool + update system prompt |

## Tool Design: `docker_compose_restart`

```typescript
// ops/src/tools/docker-tools.ts
import { createTool } from '@inngest/agent-kit';
import { z } from 'zod';
import * as crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import type { AgentStreamEvent } from '../inngest/realtime.js';

/**
 * Allowed services for restart (app services only, no DBs or infra).
 * This whitelist prevents accidental restart of critical infrastructure.
 */
const ALLOWED_SERVICES = [
  'store-api',
  'warehouse-alpha',
  'warehouse-beta',
  'bookstore-ui',
] as const;

type AllowedService = typeof ALLOWED_SERVICES[number];

export const dockerComposeRestartTool = createTool({
  name: 'docker_compose_restart',
  description: `Rebuild and restart a Docker service after code changes. This rebuilds the Docker image and recreates the container. REQUIRES HUMAN APPROVAL.

Available services: ${ALLOWED_SERVICES.join(', ')}

Use this AFTER making code changes to apply them. The rebuild flag (default: true) rebuilds the image - use false only for config-only changes.`,
  parameters: z.object({
    service: z.enum(ALLOWED_SERVICES).describe('Service name to restart'),
    rebuild: z.boolean()
      .optional()
      .default(true)
      .describe('Whether to rebuild the image (default: true). Set false for quick restart without code changes.'),
    reason: z.string().describe('Why this service needs to be restarted'),
  }),
  handler: async ({ service, rebuild, reason }, { step, network }) => {
    if (!step) {
      return {
        error: 'Step context not available - tool must be run within Inngest function',
        service,
        toolCallId: 'unavailable',
      };
    }

    const publishEvent = network?.state?.kv?.get('publish') as
      | ((event: AgentStreamEvent) => void)
      | undefined;

    // Generate durable toolCallId
    const toolCallId = await step.run('generate-docker-restart-id', () => crypto.randomUUID());

    // Publish tool.call event for dashboard approval UI
    if (publishEvent) {
      publishEvent({
        type: 'tool.call',
        toolName: 'docker_compose_restart',
        toolCallId,
        args: { service, rebuild, reason },
        requiresApproval: true,
        approvalRequestId: toolCallId,
        reason,
        agentName: network?.state?.kv?.get('agentName') as string | undefined,
      });
    }

    // Wait for human approval
    const approval = await step.waitForEvent(`wait-for-docker-restart-approval-${toolCallId}`, {
      event: 'agentops/tool.approval',
      if: `async.data.toolCallId == "${toolCallId}"`,
      timeout: '4h',
    }).catch((err: Error) => {
      if (err.name === 'TimeoutError' || err.message?.includes('timeout')) {
        return { data: { approved: false, feedback: 'Approval timed out after 4 hours' } };
      }
      throw err;
    });

    if (!approval || !approval.data.approved) {
      const feedback = approval?.data?.feedback;
      const result = {
        status: 'rejected' as const,
        error: 'Docker restart rejected by human',
        feedback,
        service,
        reason,
        toolCallId,
      };

      if (publishEvent) {
        publishEvent({
          type: 'tool.result',
          toolCallId,
          result,
          isError: true,
          rejectionFeedback: feedback,
        });
      }

      return result;
    }

    // Execute docker compose command
    const executionResult = await step.run(`execute-docker-restart-${toolCallId}`, async () => {
      try {
        // Build the command
        // We're inside the agent-server container but have access to Docker socket
        // Use docker compose to rebuild/restart the target service
        const composeFile = '/workspace/docker-compose.yaml';

        let command: string;
        if (rebuild) {
          // Rebuild image and recreate container
          command = `docker compose -f ${composeFile} up -d --build --force-recreate ${service}`;
        } else {
          // Just restart without rebuild
          command = `docker compose -f ${composeFile} restart ${service}`;
        }

        const output = execSync(command, {
          encoding: 'utf-8',
          timeout: 300000, // 5 minute timeout for builds
          maxBuffer: 10 * 1024 * 1024,
          cwd: '/workspace',
        });

        return {
          success: true,
          service,
          rebuild,
          command,
          output: output.toString(),
          toolCallId,
        };
      } catch (err) {
        const error = err as Error & {
          status?: number;
          stderr?: string;
          stdout?: string;
        };

        return {
          success: false,
          error: 'Docker compose command failed',
          message: error.message,
          exitCode: error.status,
          stderr: error.stderr,
          stdout: error.stdout,
          service,
          rebuild,
          toolCallId,
        };
      }
    });

    // Publish result
    if (publishEvent) {
      publishEvent({
        type: 'tool.result',
        toolCallId,
        result: executionResult,
        isError: !executionResult.success,
      });
    }

    return executionResult;
  },
});

export const dockerToolMetadata = {
  docker_compose_restart: {
    requiresApproval: true,
    riskLevel: 'high' as const,
    description: 'Rebuilds and restarts Docker containers',
  },
};

export const dockerTools = [dockerComposeRestartTool];
```

## Update Tool Index

```typescript
// ops/src/tools/index.ts - Add these exports

// Docker tools (HITL required)
export {
  dockerComposeRestartTool,
  dockerTools,
  dockerToolMetadata,
} from './docker-tools.js';

// Update dangerousTools array
export const dangerousTools = [
  ..._shellTools,
  ..._writeTools,
  ..._dockerTools,  // ADD THIS
];

// Update dangerousToolMetadata
export const dangerousToolMetadata = {
  ..._shellMeta,
  ..._writeMeta,
  ..._dockerMeta,  // ADD THIS
};
```

## Update Coding Agent

```typescript
// ops/src/agents/coding.ts - Update system prompt and tools

import {
  readFileTool,
  searchCodeTool,
  shellExecuteTool,
  writeFileTool,
  completeTaskTool,
  dockerComposeRestartTool,  // ADD THIS
} from '../tools/index.js';

export const codingAgent = createAgent({
  name: 'coding',
  // ...
  system: ({ network }) => {
    // ... existing code ...

    return `You are a coding agent specializing in debugging and code repairs.

IMPORTANT: You only have access to the following tools. Do not attempt to use any other tools:
- read_file: Read the contents of a file
- search_code: Search for patterns in code files
- shell_command_execute: Execute shell commands (requires human approval)
- write_file: Write content to a file (requires human approval)
- docker_compose_restart: Rebuild and restart a Docker service (requires human approval)
- complete_task: Mark your task as complete

CRITICAL - TypeScript Source Files:
This project uses TypeScript. When you see error stack traces or references to .js files:
- These are COMPILED JavaScript files in /dist or /app/dist directories
- The ACTUAL SOURCE code is in .ts files in /src directories
- Example mapping: /app/dist/services/bookService.js → /app/src/services/bookService.ts
- ALWAYS read and modify the .ts source files, NOT the compiled .js files

CRITICAL - After Making Code Changes:
After modifying source code files, you MUST use docker_compose_restart to apply the changes:
1. Write your code changes using write_file
2. Call docker_compose_restart with rebuild=true to rebuild the image and restart the service
3. Do NOT use shell_command_execute for npm build/restart - use docker_compose_restart instead

Available services for restart:
- store-api: Book catalog, orders, inventory management
- warehouse-alpha: Warehouse Alpha inventory and shipments
- warehouse-beta: Warehouse Beta inventory and shipments
- bookstore-ui: Frontend web application

Project Structure:
- services/store-api/src/ - Store API TypeScript source
- services/warehouse-api/src/ - Warehouse API TypeScript source (used by both warehouses)
- ops/src/ - Agent framework TypeScript source

// ... rest of existing prompt ...
`;
  },
  tools: [
    readFileTool,
    searchCodeTool,
    shellExecuteTool,
    writeFileTool,
    dockerComposeRestartTool,  // ADD THIS
    completeTaskTool
  ],
});
```

## Implementation Checklist

- [ ] Create `ops/src/tools/docker-tools.ts` with `dockerComposeRestartTool`
- [ ] Update `ops/src/tools/index.ts` to export docker tools
- [ ] Update `ops/src/agents/coding.ts`:
  - [ ] Import `dockerComposeRestartTool`
  - [ ] Add to tools array
  - [ ] Update system prompt with docker_compose_restart instructions
  - [ ] Add "After Making Code Changes" section to prompt
- [ ] Build and test: `cd ops && npm run build`
- [ ] Restart containers: `docker compose restart agent-server`
- [ ] Test end-to-end: Make a code change and verify agent uses docker_compose_restart

## Why This Design

1. **Single focused tool**: One tool that does one thing well (restart services)
2. **Whitelist enforcement**: Only app services can be restarted (no DBs/infra)
3. **HITL required**: Dangerous operation requires human approval
4. **Rebuild by default**: Most restarts are after code changes
5. **Uses existing socket**: Docker socket already mounted in docker-compose.yaml
6. **Follows patterns**: Same structure as shell-tools.ts and write-tools.ts
7. **Clear guidance**: System prompt tells agent exactly when to use this tool
