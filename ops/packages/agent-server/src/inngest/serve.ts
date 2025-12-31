/**
 * Inngest Serve Handler for Hono
 *
 * Creates a Hono-compatible request handler that serves the Inngest API.
 * This handler is registered at /api/inngest in the main app.
 *
 * The handler:
 * - Receives incoming requests from Inngest Dev Server (or Cloud)
 * - Executes registered functions when triggered by events
 * - Handles function introspection requests
 *
 * @see https://www.inngest.com/docs/sdk/serve
 */

import { Hono } from 'hono';
import { serve } from 'inngest/hono';
import { inngest } from './client';
import { agentRunFunction } from './functions/agentRun';

/**
 * Raw Inngest handler function
 *
 * The serve() function from inngest/hono returns a handler function
 * that takes a Hono Context and returns a Response.
 */
const handler = serve({
  client: inngest,
  functions: [
    agentRunFunction,
    // Add more functions here as we migrate other agents
  ],
});

/**
 * Hono sub-app for Inngest API
 *
 * Wraps the Inngest handler in a Hono app so it can be mounted
 * using app.route(). Handles all HTTP methods (GET for introspection,
 * PUT/POST for function execution).
 */
export const inngestHandler = new Hono();

// Handle all methods at root - Inngest uses GET for discovery, PUT/POST for execution
inngestHandler.all('/', async (c) => {
  return handler(c);
});

// Also handle wildcard paths for Inngest's internal routing
inngestHandler.all('/*', async (c) => {
  return handler(c);
});
