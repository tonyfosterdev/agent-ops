/**
 * Agent Server for AgentOps.
 *
 * Provides HTTP endpoints for:
 * - AgentKit network execution via Inngest
 * - Thread management for conversation persistence
 * - Real-time subscription tokens for useAgents hook
 * - HITL tool approval resolution
 * - Health checks for container orchestration
 *
 * ## Endpoints
 *
 * ### AgentKit
 * - POST /api/inngest - Inngest function handler (managed by serve())
 *
 * ### Chat (useAgents transport)
 * - POST /api/chat - Send message to trigger agent execution
 *
 * ### Real-time Streaming
 * - POST /api/realtime/token - Get subscription token for WebSocket streaming
 *
 * ### HITL Approval
 * - POST /api/approve-tool - Approve or deny tool execution
 *
 * ### Thread Management
 * - POST /api/threads - Create a new conversation thread
 * - GET /api/threads/:userId - List threads for a user
 * - GET /api/thread/:threadId/messages - Get messages for a thread
 *
 * ### Operations
 * - GET /api/health - Health check endpoint
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
import { inngest } from './inngest';
import { inngestFunctions, userChannel, AGENT_STREAM_TOPIC } from './inngest/index';
import { historyAdapter } from './db/index';
import { ensureSchema } from './db/postgres';
import { config, validateConfig } from './config';

/**
 * Input Validation Helpers
 */

// UUID v4 regex pattern
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Maximum message length (64KB)
const MAX_MESSAGE_LENGTH = 65536;

function isValidUUID(value: string): boolean {
  return typeof value === 'string' && UUID_REGEX.test(value);
}

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

// Health check endpoint
app.get('/api/health', (c) =>
  c.json({
    status: 'ok',
    service: 'agent-server',
    timestamp: new Date().toISOString(),
  })
);

// Legacy health endpoint (without /api prefix)
app.get('/health', (c) =>
  c.json({
    status: 'ok',
    service: 'agent-server',
    timestamp: new Date().toISOString(),
  })
);

// Inngest serve handler - handles function execution
app.on(['GET', 'POST', 'PUT'], '/api/inngest', (c) => {
  const handler = serveInngest({
    client: inngest,
    functions: inngestFunctions,
  });

  return handler(c);
});

/**
 * Chat endpoint for useAgents hook.
 *
 * Sends 'agent/chat.requested' event to Inngest which triggers the
 * agentChat function for durable execution.
 *
 * Request body (from useAgents):
 * - userMessage: { id, content, role } - The user's message
 * - threadId: Optional thread ID for conversation continuity
 * - userId: User identifier for channel scoping
 * - channelKey: Optional channel key override
 * - history: Optional conversation history
 *
 * Response:
 * - success: true if event was sent successfully
 * - threadId: The thread ID (created if not provided)
 */
app.post('/api/chat', async (c) => {
  try {
    const body = await c.req.json();
    const { userMessage, threadId: clientThreadId, userId, channelKey, history } = body as {
      userMessage: { id: string; content: string; role: 'user' };
      threadId?: string;
      userId: string;
      channelKey?: string;
      history?: Array<{ role: string; content: string }>;
    };

    // Validate userMessage
    if (!userMessage || !userMessage.content) {
      return c.json({ error: 'userMessage with content is required' }, 400);
    }
    const messageValidation = isValidMessage(userMessage.content);
    if (!messageValidation.valid) {
      return c.json({ error: messageValidation.reason }, 400);
    }

    // Validate userId
    if (!userId) {
      return c.json({ error: 'userId is required' }, 400);
    }

    // Validate threadId if provided
    if (clientThreadId && !isValidUUID(clientThreadId)) {
      return c.json({ error: 'threadId must be a valid UUID' }, 400);
    }

    // Create threadId synchronously if not provided
    // This ensures the client gets the actual threadId immediately for subsequent messages
    let threadId = clientThreadId;
    if (!threadId) {
      threadId = await historyAdapter.createThread(userId);
    }

    // Send event to Inngest for durable execution
    await inngest.send({
      name: 'agent/chat.requested',
      data: {
        threadId,
        userMessage,
        userId,
        channelKey: channelKey || userId,
        history,
      },
    });

    return c.json({
      success: true,
      threadId, // Always return the actual threadId
    });
  } catch (error) {
    console.error('Failed to send chat event:', error);
    return c.json({ error: 'Failed to send chat event' }, 500);
  }
});

/**
 * Get subscription token for real-time streaming.
 *
 * The useAgents hook calls this to get a WebSocket token for receiving
 * streaming events from the agent.
 *
 * Request body:
 * - userId: User identifier for channel scoping
 * - channelKey: Optional channel key override
 *
 * Response:
 * - token: Subscription token for WebSocket connection
 */
app.post('/api/realtime/token', async (c) => {
  try {
    const body = await c.req.json();
    const { userId, channelKey } = body as {
      userId: string;
      channelKey?: string;
    };

    if (!userId) {
      return c.json({ error: 'userId is required' }, 400);
    }

    const subscriptionKey = channelKey || userId;

    // Generate subscription token for the user's channel
    const token = await getSubscriptionToken(inngest, {
      channel: userChannel(subscriptionKey),
      topics: [AGENT_STREAM_TOPIC],
    });

    return c.json(token);
  } catch (error) {
    console.error('Failed to generate subscription token:', error);
    return c.json({ error: 'Failed to generate subscription token' }, 500);
  }
});

/**
 * HITL tool approval endpoint.
 *
 * Resolves pending tool approvals by sending the approval event to Inngest.
 * The waitForEvent in the tool handler will receive this and continue execution.
 *
 * Request body:
 * - toolCallId: ID of the tool call to approve/deny
 * - resolution: 'approved' | 'denied'
 * - reason: Optional feedback for denial
 * - userId: User identifier for authorization
 *
 * Response:
 * - success: true if event was sent
 */
app.post('/api/approve-tool', async (c) => {
  try {
    const body = await c.req.json();
    // Support both formats:
    // - @inngest/use-agent format: { action: 'approve'|'deny', toolCallId, threadId, reason }
    // - Legacy format: { resolution: 'approved'|'denied', toolCallId, userId, reason }
    const { toolCallId, action, resolution, reason, userId, threadId } = body as {
      toolCallId: string;
      action?: 'approve' | 'deny';
      resolution?: 'approved' | 'denied';
      reason?: string;
      userId?: string;
      threadId?: string;
    };

    if (!toolCallId) {
      return c.json({ error: 'toolCallId is required' }, 400);
    }
    if (!isValidUUID(toolCallId)) {
      return c.json({ error: 'toolCallId must be a valid UUID' }, 400);
    }

    // Determine approval status from either action or resolution field
    let approved: boolean;
    if (action) {
      // @inngest/use-agent format
      if (!['approve', 'deny'].includes(action)) {
        return c.json({ error: 'action must be "approve" or "deny"' }, 400);
      }
      approved = action === 'approve';
    } else if (resolution) {
      // Legacy format
      if (!['approved', 'denied'].includes(resolution)) {
        return c.json({ error: 'resolution must be "approved" or "denied"' }, 400);
      }
      approved = resolution === 'approved';
    } else {
      return c.json({ error: 'Either action or resolution is required' }, 400);
    }

    // Send approval event to Inngest
    await inngest.send({
      name: 'agentops/tool.approval',
      data: {
        toolCallId,
        approved,
        feedback: reason,
        threadId,
        userId: userId || 'anonymous',
      },
    });

    return c.json({ success: true });
  } catch (error) {
    console.error('Failed to send approval event:', error);
    return c.json({ error: 'Failed to send approval event' }, 500);
  }
});

// Legacy approval endpoint (for backward compatibility)
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

    if (!toolCallId) {
      return c.json({ error: 'toolCallId is required' }, 400);
    }
    if (!isValidUUID(toolCallId)) {
      return c.json({ error: 'toolCallId must be a valid UUID' }, 400);
    }

    // Send approval event to Inngest
    await inngest.send({
      name: 'agentops/tool.approval',
      data: { toolCallId, approved, feedback },
    });

    return c.json({ ok: true });
  } catch (error) {
    console.error('Failed to send approval event:', error);
    return c.json({ error: 'Failed to send approval event' }, 500);
  }
});

// Thread Management Endpoints

/**
 * Create a new conversation thread.
 */
app.post('/api/threads', async (c) => {
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

// Legacy thread creation endpoint
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
 * List threads for a user (useAgents format).
 * Gets userId from query parameter.
 */
app.get('/api/threads', async (c) => {
  try {
    const userId = c.req.query('userId');
    if (!userId) {
      return c.json({ error: 'userId query parameter is required' }, 400);
    }
    const limit = Number(c.req.query('limit')) || 50;

    const threads = await historyAdapter.listThreads(userId, limit);
    return c.json({ threads });
  } catch (error) {
    console.error('Failed to list threads:', error);
    return c.json({ error: 'Failed to list threads' }, 500);
  }
});

/**
 * List threads for a user (legacy format with userId in path).
 */
app.get('/api/threads/:userId', async (c) => {
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
 * Get history for a thread (useAgents format).
 */
app.get('/api/threads/:threadId/history', async (c) => {
  try {
    const threadId = c.req.param('threadId');
    if (!isValidUUID(threadId)) {
      return c.json({ error: 'threadId must be a valid UUID' }, 400);
    }
    const limit = c.req.query('limit');

    let messages;
    if (limit) {
      messages = await historyAdapter.getRecentMessages(threadId, Number(limit));
    } else {
      messages = await historyAdapter.get(threadId);
    }

    return c.json({ messages });
  } catch (error) {
    console.error('Failed to get thread history:', error);
    return c.json({ error: 'Failed to get thread history' }, 500);
  }
});

/**
 * Delete a thread (useAgents format).
 */
app.delete('/api/threads/:threadId', async (c) => {
  try {
    const threadId = c.req.param('threadId');
    if (!isValidUUID(threadId)) {
      return c.json({ error: 'threadId must be a valid UUID' }, 400);
    }

    await historyAdapter.deleteThread(threadId);
    return c.json({ success: true });
  } catch (error) {
    console.error('Failed to delete thread:', error);
    return c.json({ error: 'Failed to delete thread' }, 500);
  }
});

// Legacy threads list endpoint
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
 */
app.get('/api/thread/:threadId/messages', async (c) => {
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

// Legacy messages endpoint
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

// Legacy chat endpoint
app.post('/chat', async (c) => {
  try {
    const body = await c.req.json();
    const { threadId, message, userId } = body as {
      threadId: string;
      message: string;
      userId?: string;
    };

    if (!threadId) {
      return c.json({ error: 'threadId is required' }, 400);
    }
    if (!isValidUUID(threadId)) {
      return c.json({ error: 'threadId must be a valid UUID' }, 400);
    }
    if (!message) {
      return c.json({ error: 'message is required' }, 400);
    }
    const messageValidation = isValidMessage(message);
    if (!messageValidation.valid) {
      return c.json({ error: messageValidation.reason }, 400);
    }

    // Convert to new format and send event
    await inngest.send({
      name: 'agent/chat.requested',
      data: {
        threadId,
        userMessage: {
          id: `msg-${Date.now()}`,
          content: message,
          role: 'user' as const,
        },
        userId: userId || 'legacy-user',
        channelKey: userId || 'legacy-user',
      },
    });

    return c.json({
      ok: true,
      eventIds: [], // Legacy format
    });
  } catch (error) {
    console.error('Failed to send chat event:', error);
    return c.json({ error: 'Failed to send chat event' }, 500);
  }
});

// Legacy realtime token endpoint
app.get('/realtime/token', async (c) => {
  try {
    const threadId = c.req.query('threadId');
    const userId = c.req.query('userId');

    if (!userId) {
      return c.json({ error: 'userId is required' }, 400);
    }

    // Generate subscription token for the user's channel
    const token = await getSubscriptionToken(inngest, {
      channel: userChannel(userId),
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

async function startServer() {
  try {
    await ensureSchema();

    console.log(`Agent server starting on ${host}:${port}`);
    console.log(`  Health check: http://localhost:${port}/api/health`);
    console.log(`  Inngest endpoint: http://localhost:${port}/api/inngest`);
    console.log(`  Chat endpoint: http://localhost:${port}/api/chat`);
    console.log(`  Realtime token: http://localhost:${port}/api/realtime/token`);
    console.log(`  Approve tool: http://localhost:${port}/api/approve-tool`);

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
