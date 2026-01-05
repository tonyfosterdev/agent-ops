/**
 * Agent Server for AgentOps.
 *
 * Provides HTTP endpoints for:
 * - AgentKit network execution via Inngest
 * - Thread management for conversation persistence
 * - Real-time streaming tokens for dashboard updates
 * - Health checks for container orchestration
 *
 * ## Endpoints
 *
 * ### AgentKit
 * - POST /agents/* - Inngest function handler (managed by serve())
 *
 * ### Thread Management
 * - POST /threads - Create a new conversation thread
 * - GET /threads/:userId - List threads for a user
 * - GET /threads/:threadId/messages - Get messages for a thread
 *
 * ### Real-time Streaming
 * - GET /realtime/token - Get subscription token for a thread's stream
 *
 * ### Operations
 * - GET /health - Health check endpoint
 *
 * ## Inngest Integration
 *
 * The server registers Inngest functions via the serve() handler which:
 * - Exposes the /api/inngest endpoint for the Inngest dev server
 * - Handles function invocation and step execution
 * - Manages event ingestion
 */

import { Hono } from 'hono';
import { serve as serveHono } from '@hono/node-server';
import { serve as serveInngest } from 'inngest/hono';
import { cors } from 'hono/cors';
import { getSubscriptionToken } from '@inngest/realtime';
import { inngest } from './inngest.js';
import { inngestFunctions, agentChannel, AGENT_STREAM_TOPIC } from './inngest/index.js';
import { historyAdapter } from './db/index.js';
import { ensureSchema } from './db/postgres.js';
import { config, validateConfig } from './config.js';

/**
 * Input Validation Helpers
 *
 * These functions provide basic validation for API inputs to prevent
 * malformed data from reaching the Inngest functions.
 */

// UUID v4 regex pattern
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Maximum message length (64KB - reasonable for chat messages)
const MAX_MESSAGE_LENGTH = 65536;

/**
 * Validate that a string is a valid UUID v4 format.
 */
function isValidUUID(value: string): boolean {
  return typeof value === 'string' && UUID_REGEX.test(value);
}

/**
 * Validate that a message is non-empty and within reasonable length.
 */
function isValidMessage(value: string): { valid: boolean; reason?: string } {
  if (typeof value !== 'string') {
    return { valid: false, reason: 'message must be a string' };
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return { valid: false, reason: 'message cannot be empty' };
  }
  if (value.length > MAX_MESSAGE_LENGTH) {
    return { valid: false, reason: `message exceeds maximum length of ${MAX_MESSAGE_LENGTH} characters` };
  }
  return { valid: true };
}

const app = new Hono();

// CORS configuration for dashboard access
app.use(
  '*',
  cors({
    origin: ['http://localhost:3001', 'http://localhost:5173', 'http://agents.localhost', 'http://dashboard.localhost'],
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    exposeHeaders: ['Content-Length'],
    maxAge: 86400,
    credentials: true,
  })
);

// Health check endpoint for container orchestration
app.get('/health', (c) =>
  c.json({
    status: 'ok',
    service: 'agent-server',
    timestamp: new Date().toISOString(),
  })
);

// Inngest serve handler - handles function execution
// This creates endpoints at /api/inngest for the Inngest dev server
app.on(['GET', 'POST', 'PUT'], '/api/inngest', (c) => {
  const handler = serveInngest({
    client: inngest,
    functions: inngestFunctions,
  });

  return handler(c);
});

// Thread Management Endpoints

/**
 * Create a new conversation thread.
 *
 * Request body:
 * - userId: Identifier for the user creating the thread
 * - title: Optional title for the thread
 *
 * Response:
 * - threadId: UUID of the created thread
 */
app.post('/threads', async (c) => {
  try {
    const body = await c.req.json();
    const { userId, title } = body as { userId: string; title?: string };

    if (!userId) {
      return c.json({ error: 'userId is required' }, 400);
    }

    const threadId = await historyAdapter.createThread(userId, title);
    return c.json({ threadId });
  } catch (error) {
    console.error('Failed to create thread:', error);
    return c.json({ error: 'Failed to create thread' }, 500);
  }
});

/**
 * List threads for a user.
 *
 * Query parameters:
 * - limit: Maximum number of threads to return (default 50)
 *
 * Response:
 * - threads: Array of thread metadata
 */
app.get('/threads/:userId', async (c) => {
  try {
    const userId = c.req.param('userId');
    const limit = Number(c.req.query('limit')) || 50;

    const threads = await historyAdapter.listThreads(userId, limit);
    return c.json({ threads });
  } catch (error) {
    console.error('Failed to list threads:', error);
    return c.json({ error: 'Failed to list threads' }, 500);
  }
});

/**
 * Get messages for a thread.
 *
 * Path parameters:
 * - threadId: UUID of the thread
 *
 * Query parameters:
 * - limit: Maximum number of messages (default: all)
 *
 * Response:
 * - messages: Array of messages in chronological order
 */
app.get('/thread/:threadId/messages', async (c) => {
  try {
    const threadId = c.req.param('threadId');
    const limit = c.req.query('limit');

    let messages;
    if (limit) {
      messages = await historyAdapter.getRecentMessages(threadId, Number(limit));
    } else {
      messages = await historyAdapter.get(threadId);
    }

    return c.json({ messages });
  } catch (error) {
    console.error('Failed to get messages:', error);
    return c.json({ error: 'Failed to get messages' }, 500);
  }
});

/**
 * Send a chat message to trigger agent processing.
 *
 * This endpoint sends an event to Inngest which triggers the
 * agentChat function for durable execution.
 *
 * Request body:
 * - threadId: UUID of the conversation thread
 * - message: User's message to process
 * - userId: Optional user identifier for audit
 *
 * Response:
 * - ok: true if event was sent successfully
 * - eventId: ID of the sent event
 */
app.post('/chat', async (c) => {
  try {
    const body = await c.req.json();
    const { threadId, message, userId } = body as {
      threadId: string;
      message: string;
      userId?: string;
    };

    // Validate threadId is a valid UUID
    if (!threadId) {
      return c.json({ error: 'threadId is required' }, 400);
    }
    if (!isValidUUID(threadId)) {
      return c.json({ error: 'threadId must be a valid UUID' }, 400);
    }

    // Validate message content
    if (!message) {
      return c.json({ error: 'message is required' }, 400);
    }
    const messageValidation = isValidMessage(message);
    if (!messageValidation.valid) {
      return c.json({ error: messageValidation.reason }, 400);
    }

    // Send event to Inngest for durable execution
    const result = await inngest.send({
      name: 'agent/chat',
      data: { threadId, message, userId },
    });

    return c.json({
      ok: true,
      eventIds: result.ids,
    });
  } catch (error) {
    console.error('Failed to send chat event:', error);
    return c.json({ error: 'Failed to send chat event' }, 500);
  }
});

/**
 * Send a tool approval/rejection event.
 *
 * Used by the dashboard to approve or reject dangerous tool calls
 * that are waiting via step.waitForEvent().
 *
 * Request body:
 * - runId: Inngest run ID for correlation
 * - toolCallId: ID of the tool call being approved/rejected
 * - approved: boolean indicating approval status
 * - feedback: Optional feedback message
 * - threadId: Thread UUID for authorization check
 * - userId: User ID for authorization check
 *
 * Response:
 * - ok: true if event was sent successfully
 *
 * Security:
 * - Verifies user owns the thread before allowing approval
 */
app.post('/approve', async (c) => {
  try {
    const body = await c.req.json();
    const { runId, toolCallId, approved, feedback, threadId, userId } = body as {
      runId: string;
      toolCallId: string;
      approved: boolean;
      feedback?: string;
      threadId: string;
      userId: string;
    };

    // Validate runId (Inngest run IDs are ULIDs, but we accept any non-empty string)
    if (!runId || typeof runId !== 'string' || runId.trim().length === 0) {
      return c.json({ error: 'runId is required and must be a non-empty string' }, 400);
    }

    // Validate toolCallId is a valid UUID
    if (!toolCallId) {
      return c.json({ error: 'toolCallId is required' }, 400);
    }
    if (!isValidUUID(toolCallId)) {
      return c.json({ error: 'toolCallId must be a valid UUID' }, 400);
    }

    // Validate approved is a boolean
    if (typeof approved !== 'boolean') {
      return c.json({ error: 'approved must be a boolean' }, 400);
    }

    // Validate threadId for authorization
    if (!threadId) {
      return c.json({ error: 'threadId is required for authorization' }, 400);
    }
    if (!isValidUUID(threadId)) {
      return c.json({ error: 'threadId must be a valid UUID' }, 400);
    }

    // Validate userId for authorization
    if (!userId) {
      return c.json({ error: 'userId is required for authorization' }, 400);
    }

    // Verify user owns this thread before allowing approval
    const thread = await historyAdapter.getThread(threadId);
    if (!thread) {
      return c.json({ error: 'Thread not found' }, 404);
    }

    if (thread.userId !== userId) {
      return c.json({ error: 'Unauthorized: you do not own this thread' }, 403);
    }

    // Send approval event to Inngest
    await inngest.send({
      name: 'agentops/tool.approval',
      data: { runId, toolCallId, approved, feedback },
    });

    return c.json({ ok: true });
  } catch (error) {
    console.error('Failed to send approval event:', error);
    return c.json({ error: 'Failed to send approval event' }, 500);
  }
});

// Real-time Streaming Endpoints

/**
 * Get a subscription token for real-time streaming.
 *
 * Generates a time-limited, scoped token that allows the dashboard
 * to subscribe to agent stream events for a specific thread.
 *
 * Query parameters:
 * - threadId: UUID of the thread to subscribe to
 * - userId: User ID for ownership verification
 *
 * Response:
 * - token: Subscription token for use with useInngestSubscription
 *
 * Security:
 * - Verifies user owns the thread before issuing token
 * - Tokens are time-limited (default TTL set by Inngest)
 * - Tokens are scoped to specific channels and topics
 */
app.get('/realtime/token', async (c) => {
  try {
    const threadId = c.req.query('threadId');
    const userId = c.req.query('userId');

    if (!threadId) {
      return c.json({ error: 'threadId is required' }, 400);
    }

    if (!isValidUUID(threadId)) {
      return c.json({ error: 'threadId must be a valid UUID' }, 400);
    }

    if (!userId) {
      return c.json({ error: 'userId is required for authorization' }, 400);
    }

    // Verify user owns this thread
    const thread = await historyAdapter.getThread(threadId);
    if (!thread) {
      return c.json({ error: 'Thread not found' }, 404);
    }

    if (thread.userId !== userId) {
      return c.json({ error: 'Unauthorized: you do not own this thread' }, 403);
    }

    // Generate subscription token for this thread's channel
    const token = await getSubscriptionToken(inngest, {
      channel: agentChannel({ threadId }),
      topics: [AGENT_STREAM_TOPIC],
    });

    return c.json({ token });
  } catch (error) {
    console.error('Failed to generate subscription token:', error);
    return c.json({ error: 'Failed to generate subscription token' }, 500);
  }
});

// Validate configuration and start server
validateConfig();

const port = config.server.port;
const host = config.server.host;

// Async startup to ensure schema exists before accepting requests
async function startServer() {
  try {
    // Ensure database schema exists (idempotent - safe to run every startup)
    await ensureSchema();

    console.log(`Agent server starting on ${host}:${port}`);
    console.log(`  Health check: http://localhost:${port}/health`);
    console.log(`  Inngest endpoint: http://localhost:${port}/api/inngest`);
    console.log(`  Thread management: http://localhost:${port}/threads`);
    console.log(`  Chat endpoint: http://localhost:${port}/chat`);
    console.log(`  Realtime token: http://localhost:${port}/realtime/token`);

    serveHono({
      fetch: app.fetch,
      port,
      hostname: host,
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();

export default app;
