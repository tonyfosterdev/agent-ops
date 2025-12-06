import { Hono } from 'hono';
import type { HealthResponse } from 'ops-shared';

const app = new Hono();

app.get('/', (c) => {
  const response: HealthResponse = {
    status: 'ok',
    service: 'agent-server',
    timestamp: new Date().toISOString(),
  };

  return c.json(response);
});

export default app;
