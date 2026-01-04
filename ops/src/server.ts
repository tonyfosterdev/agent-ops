/**
 * Agent Server - Stub for Phase 1
 *
 * This is a minimal stub to allow the dev scripts to run.
 * Full implementation will be added in Phase 5.
 */

import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { config } from './config.js';

const app = new Hono();

// Health check endpoint
app.get('/health', (c) =>
  c.json({
    status: 'ok',
    phase: 'setup',
    message: 'Agent server stub - full implementation in Phase 5',
  })
);

// Placeholder for AgentKit endpoints (Phase 5)
app.get('/agents', (c) =>
  c.json({
    message: 'AgentKit endpoints not yet implemented',
    phase: 'Phase 5: Network & Server',
  })
);

// Start server
const port = config.server.port;

console.log(`🚀 Agent server starting on port ${port}`);
console.log(`📍 Health check: http://localhost:${port}/health`);

serve({
  fetch: app.fetch,
  port,
});

export default app;
