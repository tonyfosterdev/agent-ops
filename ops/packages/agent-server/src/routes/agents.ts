import { Hono } from 'hono';
import { stream } from 'hono/streaming';
import { z } from 'zod';
import { AgentRunner, type AgentType } from '../services/AgentRunner';
import { logger } from '../config';
import type { RunAgentRequest, AgentTypeInfo, ListAgentsResponse } from 'ops-shared';

const app = new Hono();

// Request validation schema
const runAgentSchema = z.object({
  task: z.string().min(1, 'Task cannot be empty'),
  config: z
    .object({
      maxSteps: z.number().optional(),
      model: z.string().optional(),
      workDir: z.string().optional(),
    })
    .optional(),
});

/**
 * POST /agents/:type/run
 *
 * Start agent execution with Server-Sent Events streaming
 */
app.post('/:type/run', async (c) => {
  const agentType = c.req.param('type') as AgentType;

  // Validate agent type
  const validTypes: AgentType[] = ['coding', 'log-analyzer', 'orchestration'];
  if (!validTypes.includes(agentType)) {
    return c.json({ error: 'Invalid agent type', validTypes }, 400);
  }

  // Parse and validate request body
  let body: RunAgentRequest;
  try {
    body = await c.req.json();
    const validation = runAgentSchema.safeParse(body);

    if (!validation.success) {
      return c.json(
        {
          error: 'Invalid request',
          details: validation.error.errors,
        },
        400
      );
    }
  } catch (error) {
    return c.json({ error: 'Invalid JSON in request body' }, 400);
  }

  const { task, config } = body;

  logger.info({ agentType, task }, 'Starting agent execution');

  // Stream response using SSE
  return stream(c, async (stream) => {
    try {
      const runner = new AgentRunner(agentType, config);

      // Subscribe to agent events and write to SSE stream
      runner.on('event', (event) => {
        stream.writeln(`data: ${JSON.stringify(event)}`);
      });

      // Run agent
      const result = await runner.run(task);

      // Send final result
      await stream.writeln(
        `data: ${JSON.stringify({
          type: 'agent:complete',
          result,
          timestamp: Date.now(),
        })}`
      );

      logger.info({ agentType, task, success: result.success }, 'Agent execution completed');
    } catch (error: any) {
      logger.error({ agentType, task, error: error.message }, 'Agent execution failed');

      await stream.writeln(
        `data: ${JSON.stringify({
          type: 'agent:error',
          error: error.message,
          timestamp: Date.now(),
        })}`
      );
    }
  });
});

/**
 * GET /agents/types
 *
 * List available agent types
 */
app.get('/types', (c) => {
  const agents: AgentTypeInfo[] = [
    { type: 'coding', description: 'Debug and fix TypeScript bugs' },
    { type: 'log-analyzer', description: 'Analyze Grafana/Loki logs' },
    { type: 'orchestration', description: 'Intelligent task routing' },
  ];

  const response: ListAgentsResponse = { agents };
  return c.json(response);
});

export default app;
