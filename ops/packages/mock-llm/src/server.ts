import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import {
  loadFixture,
  setActiveFixture,
  queueFixtures,
  getActiveFixture,
  listFixtures,
  clearQueue,
} from './fixtures.js';

const app = new Hono();

// Health check
app.get('/health', (c) => {
  return c.json({
    status: 'ok',
    service: 'mock-llm',
    timestamp: new Date().toISOString(),
  });
});

// List available fixtures
app.get('/fixtures', (c) => {
  const fixtures = listFixtures();
  return c.json({
    fixtures,
    active: getActiveFixture(),
  });
});

// Set fixture for next request(s)
app.post('/fixtures/set', async (c) => {
  const body = await c.req.json();
  const { fixture } = body;

  if (!fixture) {
    return c.json({ error: 'fixture is required' }, 400);
  }

  setActiveFixture(fixture);
  return c.json({ success: true, fixture });
});

// Queue multiple fixtures for sequential responses
app.post('/fixtures/queue', async (c) => {
  const body = await c.req.json();
  const { fixtures } = body;

  if (!Array.isArray(fixtures)) {
    return c.json({ error: 'fixtures array is required' }, 400);
  }

  queueFixtures(fixtures);
  return c.json({ success: true, queued: fixtures.length });
});

// Clear fixture queue
app.post('/fixtures/clear', (c) => {
  clearQueue();
  return c.json({ success: true });
});

// OpenAI-compatible chat completions endpoint
app.post('/v1/chat/completions', async (c) => {
  const body = await c.req.json();
  const fixture = loadFixture();

  console.log(`[mock-llm] /v1/chat/completions - model: ${body.model}, active fixture: ${getActiveFixture()}`);

  // If fixture has OpenAI format, use it directly
  if (fixture.message) {
    return c.json({
      id: `chatcmpl-test-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: body.model || 'mock-model',
      choices: [
        {
          index: 0,
          message: fixture.message,
          finish_reason: fixture.finish_reason || 'stop',
        },
      ],
      usage: fixture.usage || { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
    });
  }

  // Convert Anthropic format to OpenAI format
  const textContent = fixture.content
    ?.filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('\n');

  const toolCalls = fixture.content
    ?.filter((c) => c.type === 'tool_use')
    .map((c) => ({
      id: c.id || `call-${Date.now()}`,
      type: 'function' as const,
      function: {
        name: c.name || 'unknown',
        arguments: JSON.stringify(c.input || {}),
      },
    }));

  const message: Record<string, unknown> = {
    role: 'assistant',
    content: textContent || null,
  };

  if (toolCalls && toolCalls.length > 0) {
    message.tool_calls = toolCalls;
  }

  return c.json({
    id: `chatcmpl-test-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: body.model || 'mock-model',
    choices: [
      {
        index: 0,
        message,
        finish_reason: fixture.stop_reason === 'tool_use' ? 'tool_calls' : 'stop',
      },
    ],
    usage: fixture.usage || { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
  });
});

// Anthropic-compatible messages API
app.post('/v1/messages', async (c) => {
  const body = await c.req.json();
  const fixture = loadFixture();

  console.log(`[mock-llm] /v1/messages - model: ${body.model}, active fixture: ${getActiveFixture()}`);

  return c.json({
    id: `msg-test-${Date.now()}`,
    type: 'message',
    role: 'assistant',
    content: fixture.content || [{ type: 'text', text: 'Mock response' }],
    model: body.model || 'mock-model',
    stop_reason: fixture.stop_reason || 'end_turn',
    stop_sequence: null,
    usage: fixture.usage || { input_tokens: 100, output_tokens: 50 },
  });
});

// Start server
const port = parseInt(process.env.PORT || '3333', 10);
console.log(`Mock LLM Server starting on port ${port}`);
console.log(`Fixture directory: ${process.env.FIXTURE_DIR || 'fixtures/'}`);
console.log(`Default fixture: ${process.env.DEFAULT_FIXTURE || 'default.json'}`);

serve({ fetch: app.fetch, port });
