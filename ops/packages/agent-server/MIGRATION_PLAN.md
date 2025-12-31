# Agent Server Migration Plan: Inngest + AgentKit + OpenTelemetry

> **Version**: 2.1 (Architect Reviewed)
> **Status**: Ready for Implementation (with caveats - see Part 8)
> **Last Updated**: December 2024

---

## Executive Summary

This plan migrates the agent-server from a custom `DurableLoop` implementation to **Inngest** for durable execution, **AgentKit** for multi-agent coordination, and **OpenTelemetry** for comprehensive observability.

### The Demo Moment

> *"Watch me restart this server mid-agent-execution... and see the agent resume exactly where it left off, with full distributed traces visible in Grafana."*

### What We're Building

| Layer | Technology | Purpose |
|-------|------------|---------|
| **Execution** | Inngest | Durable functions, HITL via `step.waitForEvent()` |
| **Agents** | AgentKit | Multi-agent networks with routing |
| **Observability** | OTel + Grafana | Traces, metrics, log correlation |
| **UI** | React + `useAgent` | Real-time streaming dashboard |

### Code Impact

| Component | Lines Removed | Lines Added | Net Change |
|-----------|---------------|-------------|------------|
| DurableLoop.ts | ~515 | 0 | -515 |
| delegation.ts | ~257 | 0 | -257 |
| SSE streaming | ~200 | ~50 | -150 |
| Inngest functions | 0 | ~200 | +200 |
| AgentKit network | 0 | ~100 | +100 |
| OTel setup | 0 | ~150 | +150 |
| **Total** | **~972** | **~500** | **-472** |

---

## Part 1: Architecture Overview

### Current vs. Target State

```
CURRENT STATE                           TARGET STATE
─────────────────                       ─────────────────
┌─────────────────┐                     ┌─────────────────┐
│ React Dashboard │                     │ React Dashboard │
│ (Custom SSE)    │                     │ (useAgent hook) │
└────────┬────────┘                     └────────┬────────┘
         │                                       │
    EventEmitter                          Inngest Realtime
         │                                       │
┌────────▼────────┐                     ┌────────▼────────┐
│  DurableLoop    │                     │ Inngest Platform│
│  while(true)    │                     │ • Durable steps │
│  MAX_STEPS      │                     │ • waitForEvent  │
│  Manual state   │                     │ • Auto-retry    │
└────────┬────────┘                     └────────┬────────┘
         │                                       │
┌────────▼────────┐                     ┌────────▼────────┐
│ JournalService  │                     │ AgentKit Network│
│ • Execution ctrl│                     │ • Orchestrator  │
│ • State recovery│                     │ • Coding Agent  │
│ • Audit log     │                     │ • Log Analyzer  │
└─────────────────┘                     └────────┬────────┘
                                                 │
                                        ┌────────▼────────┐
                                        │ JournalService  │
                                        │ (Audit log ONLY)│
                                        └─────────────────┘
```

### Feature Mapping

| Current Concept | Replacement | Status |
|-----------------|-------------|--------|
| `DurableLoop.ts` (while loop) | Inngest Function + `step.run()` | **REPLACE** |
| `JournalService` (execution control) | Inngest state management | **REMOVE** |
| `JournalService` (audit log) | Keep for UI/compliance | **KEEP** |
| HITL (RUN_SUSPENDED + polling) | `step.waitForEvent()` | **REPLACE** |
| Agent delegation (child runs) | AgentKit Networks + Routers | **REPLACE** |
| SSE streaming | `useAgent` hook + Inngest Realtime | **REPLACE** |

---

## Part 2: Inngest + AgentKit Integration

### 2.1 Inngest Setup

**Install Dependencies:**
```bash
# Core packages
npm install inngest @inngest/agent-kit

# Dashboard real-time (separate package - NOT in @inngest/agent-kit)
npm install @inngest/use-agent
```

> ⚠️ **NOTE**: `useAgent` is in a **separate package** `@inngest/use-agent`, not `@inngest/agent-kit/react`

**Create Client (`src/inngest/client.ts`):**
```typescript
import { Inngest } from 'inngest';
import { extendedTracesMiddleware } from 'inngest/experimental';

export const inngest = new Inngest({
  id: 'agent-server',
  middleware: [extendedTracesMiddleware()],  // OTel traces - see telemetry section
});
```

**Create Serve Handler (`src/inngest/serve.ts`):**
```typescript
import { serve } from 'inngest/hono';
import { inngest } from './client';
import { agentRunFunction } from './functions/agentRun';

export const inngestHandler = serve({
  client: inngest,
  functions: [agentRunFunction],
});
```

**Register Route (`src/app.ts`):**
```typescript
import { inngestHandler } from './inngest/serve';

app.route('/api/inngest', inngestHandler);
```

### 2.2 AgentKit Network

**Define Agents (`src/inngest/agents/index.ts`):**
```typescript
import { createAgent, createNetwork, anthropic } from '@inngest/agent-kit';

export const orchestratorAgent = createAgent({
  name: 'orchestrator',
  description: 'Routes tasks to specialized agents',
  system: orchestratorSystemPrompt,
  model: anthropic({ model: 'claude-sonnet-4-20250514' }),
  tools: [/* orchestration tools */],
});

export const codingAgent = createAgent({
  name: 'coding',
  description: 'Writes and modifies code',
  system: codingSystemPrompt,
  model: anthropic({ model: 'claude-sonnet-4-20250514' }),
  tools: [shellTool, writeFileTool, readFileTool],
});

export const logAnalyzerAgent = createAgent({
  name: 'log-analyzer',
  description: 'Queries and analyzes logs',
  system: logAnalyzerSystemPrompt,
  model: anthropic({ model: 'claude-sonnet-4-20250514' }),
  tools: [lokiQueryTool, readFileTool],
});

// Network with code-based routing (deterministic)
export const agentNetwork = createNetwork({
  name: 'ops-network',
  agents: [orchestratorAgent, codingAgent, logAnalyzerAgent],
  defaultRouter: ({ lastResult, state, callCount }) => {
    // Max iterations guard
    if (callCount > 20) return undefined;

    // Route based on state
    const task = state.get('currentTask');
    if (task?.type === 'coding') return codingAgent;
    if (task?.type === 'logs') return logAnalyzerAgent;

    // Default to orchestrator
    return orchestratorAgent;
  },
});
```

### 2.3 Inngest Function with HITL

**Core Function (`src/inngest/functions/agentRun.ts`):**
```typescript
import { inngest } from '../client';
import { agentNetwork } from '../agents';
import { journalService } from '../../services/JournalService';

export const agentRunFunction = inngest.createFunction(
  {
    id: 'agent-run',
    retries: 0,  // We handle retries at step level
  },
  { event: 'agent/run.started' },
  async ({ event, step }) => {
    const { runId, task } = event.data;

    // Initialize run
    await step.run('init', async () => {
      await journalService.appendEvent(runId, {
        type: 'RUN_STARTED',
        payload: { task },
      });
    });

    // Run agent network
    const result = await step.run('execute-network', async () => {
      return agentNetwork.run(task, {
        // Hook into tool execution for HITL
        onToolCall: async (toolCall, agent) => {
          if (isDangerousTool(toolCall.name)) {
            // Record suspension
            await journalService.appendEvent(runId, {
              type: 'RUN_SUSPENDED',
              payload: { tool: toolCall.name, args: toolCall.args },
            });

            // Wait for approval (up to 72 hours)
            const approval = await step.waitForEvent('agent/run.resumed', {
              match: 'data.runId',
              timeout: '72h',
            });

            if (!approval || approval.data.decision === 'rejected') {
              await journalService.appendEvent(runId, {
                type: 'RUN_RESUMED',
                payload: { decision: 'rejected' },
              });
              return { skip: true, feedback: approval?.data.feedback };
            }

            await journalService.appendEvent(runId, {
              type: 'RUN_RESUMED',
              payload: { decision: 'approved' },
            });
          }
          return { skip: false };
        },
      });
    });

    // Complete run
    await step.run('complete', async () => {
      await journalService.appendEvent(runId, {
        type: 'RUN_COMPLETED',
        payload: { result },
      });
    });

    return result;
  }
);
```

### 2.4 API Route Updates

**POST /runs (Create Run):**
```typescript
runsRouter.post('/', async (c) => {
  const { task, agentType } = await c.req.json();

  // Create run record
  const run = await journalService.createRun({ agentType, task });

  // Trigger Inngest function (replaces startRun)
  await inngest.send({
    name: 'agent/run.started',
    data: { runId: run.id, task, agentType },
  });

  return c.json({ id: run.id, status: 'pending' });
});
```

**POST /runs/:id/resume (Resume Run):**
```typescript
runsRouter.post('/:id/resume', async (c) => {
  const { id } = c.req.param();
  const { decision, feedback } = await c.req.json();

  // Send event to resume waiting function
  await inngest.send({
    name: 'agent/run.resumed',
    data: { runId: id, decision, feedback },
  });

  return c.json({ success: true });
});
```

---

## Part 3: OpenTelemetry Observability

### 3.1 Telemetry Coverage Matrix

> **IMPORTANT FOR ENGINEERS**: This matrix shows what's built-in vs custom.

| Telemetry Type | Source | Built-in? | Notes |
|----------------|--------|-----------|-------|
| **Traces** | | | |
| Function execution spans | Inngest | ✅ **YES** | `extendedTracesMiddleware()` auto-captures |
| Step execution spans | Inngest | ✅ **YES** | Each `step.run()` becomes a span |
| HTTP request spans | Inngest | ✅ **YES** | Auto-instrumented with middleware |
| Database query spans | OTel | ✅ **YES** | `@opentelemetry/instrumentation-pg` |
| LLM call spans | AgentKit | ✅ **YES** | `step.ai.infer()` captures AI calls |
| Custom business spans | Custom | ❌ **NO** | Need `withToolSpan()` helpers |
| **Metrics** | | | |
| Function run counts | Inngest | ✅ **YES** | In Inngest Dashboard only |
| Step throughput | Inngest | ✅ **YES** | In Inngest Dashboard only |
| Failure rates | Inngest | ✅ **YES** | In Inngest Dashboard only |
| **Export to Prometheus** | Custom | ❌ **NO** | Need OTel SDK + Collector |
| Token usage counters | Custom | ❌ **NO** | Need custom `meter.createCounter()` |
| HITL wait time histogram | Custom | ❌ **NO** | Need custom metrics |
| **Logs** | | | |
| Structured JSON logs | Pino | ✅ **YES** | Existing setup |
| Trace ID correlation | OTel | ⚠️ **PARTIAL** | Need `@opentelemetry/instrumentation-pino` |
| Log → Trace links | Grafana | ❌ **NO** | Need datasource config |

### 3.2 What Inngest Provides Out-of-Box

```
┌─────────────────────────────────────────────────────────────┐
│                 INNGEST DEV SERVER                          │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Waterfall Trace View (built-in, no config needed)   │   │
│  │ ├─ agent-run                          [2.3s]        │   │
│  │ │  ├─ step: init                      [15ms]        │   │
│  │ │  ├─ step: execute-network           [2.1s]        │   │
│  │ │  │  ├─ ai.infer (claude-sonnet)     [800ms]       │   │ ← AgentKit auto-captures
│  │ │  │  ├─ tool: write_file             [50ms]        │   │
│  │ │  │  └─ ai.infer (claude-sonnet)     [600ms]       │   │
│  │ │  └─ step: complete                  [20ms]        │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Function Metrics (built-in, no config needed)       │   │
│  │ • Runs: 142 succeeded, 3 failed, 2 cancelled        │   │
│  │ • Throughput: 12 runs/min                           │   │
│  │ • Backlog: 0 pending                                │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

**To enable OTel export from Inngest (sends to external systems):**

> ⚠️ **CORRECTION**: `InngestSpanProcessor` does NOT exist as a standalone export. The `extendedTracesMiddleware` works via environment variables, not programmatic SDK integration.

```typescript
// Inngest client setup - middleware captures spans internally
import { Inngest } from 'inngest';
import { extendedTracesMiddleware } from 'inngest/experimental';

const inngest = new Inngest({
  id: 'agent-server',
  middleware: [extendedTracesMiddleware()],  // Captures workflow steps as spans
});

// OTel SDK setup - SEPARATE from Inngest, uses standard processors
import { NodeSDK } from '@opentelemetry/sdk-node';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';

const sdk = new NodeSDK({
  traceExporter: new OTLPTraceExporter({ url: 'http://otel-collector:4318/v1/traces' }),
  // Standard batch processor - NOT InngestSpanProcessor
  spanProcessor: new BatchSpanProcessor(new OTLPTraceExporter()),
  // ...
});
```

**How it works**: `extendedTracesMiddleware` uses standard OTel environment variables (`OTEL_EXPORTER_*`) to export. The middleware creates spans that flow through your configured OTel pipeline.

### 3.3 What Requires Custom Code

**Custom Business Metrics (`src/otel/metrics.ts`):**
```typescript
// ❌ NOT built-in - we must create these
import { metrics } from '@opentelemetry/api';

const meter = metrics.getMeter('agent-server');

// LLM token tracking (not in Inngest/AgentKit)
export const llmTokensCounter = meter.createCounter('llm.tokens.total', {
  description: 'Total tokens used by LLM calls',
});

// HITL wait time (not in Inngest metrics export)
export const hitlWaitTimeHistogram = meter.createHistogram('hitl.wait_time', {
  description: 'Time waiting for human approval',
  unit: 'ms',
});

// Tool execution tracking
export const toolExecutionCounter = meter.createCounter('tool.executions.total');
```

**Custom Span Helpers (`src/otel/spans.ts`):**
```typescript
// ❌ NOT built-in - for business-specific spans
import { trace, SpanStatusCode } from '@opentelemetry/api';

const tracer = trace.getTracer('agent-server');

export async function withHITLSpan<T>(
  runId: string,
  toolName: string,
  fn: () => Promise<T>
): Promise<T> {
  return tracer.startActiveSpan('hitl.wait_for_approval', async (span) => {
    span.setAttribute('hitl.run_id', runId);
    span.setAttribute('hitl.tool_name', toolName);

    const startTime = Date.now();
    const result = await fn();

    span.setAttribute('hitl.wait_time_ms', Date.now() - startTime);
    span.end();
    return result;
  });
}
```

### 3.4 Infrastructure Stack

**Add to `docker-compose.yaml`:**
```yaml
services:
  # ⚠️ CRITICAL: Inngest Dev Server - REQUIRED for local development
  inngest:
    image: inngest/inngest:latest
    container_name: inngest-dev
    command: 'inngest dev -u http://agent-server:3200/api/inngest --no-discovery'
    ports:
      - "8288:8288"   # Dev Server UI
    networks:
      - agentops-network
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.inngest.rule=Host(`inngest.localhost`)"
      - "traefik.http.routers.inngest.entrypoints=web"
      - "traefik.http.services.inngest.loadbalancer.server.port=8288"
    restart: unless-stopped

  # OpenTelemetry Collector - routes telemetry to backends
  otel-collector:
    image: otel/opentelemetry-collector-contrib:0.115.0
    command: ['--config=/etc/otel-collector.yaml']
    volumes:
      - ./infra/otel/otel-collector.yaml:/etc/otel-collector.yaml:ro
    ports:
      - "4317:4317"   # OTLP gRPC
      - "4318:4318"   # OTLP HTTP
      - "8889:8889"   # Prometheus metrics
    networks:
      - agentops-network

  # Tempo - distributed trace storage
  tempo:
    image: grafana/tempo:2.6.1
    command: ['-config.file=/etc/tempo.yaml']
    volumes:
      - ./infra/tempo/tempo.yaml:/etc/tempo.yaml:ro
      - tempo-data:/var/tempo
    ports:
      - "3200:3200"
    networks:
      - agentops-network
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.tempo.rule=Host(`tempo.localhost`)"

  # Prometheus - metrics storage
  prometheus:
    image: prom/prometheus:v2.54.0
    command:
      - '--config.file=/etc/prometheus.yaml'
      - '--web.enable-remote-write-receiver'
    volumes:
      - ./infra/prometheus/prometheus.yaml:/etc/prometheus.yaml:ro
      - prometheus-data:/prometheus
    ports:
      - "9090:9090"
    networks:
      - agentops-network
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.prometheus.rule=Host(`prometheus.localhost`)"

volumes:
  tempo-data:
  prometheus-data:
```

### 3.5 OTel Collector Configuration

**`infra/otel/otel-collector.yaml`:**
```yaml
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318

processors:
  batch:
    timeout: 1s
    send_batch_size: 1024

exporters:
  # Traces → Tempo
  otlp/tempo:
    endpoint: tempo:4317
    tls:
      insecure: true

  # Metrics → Prometheus
  prometheus:
    endpoint: 0.0.0.0:8889
    namespace: agentops

  # Logs → Loki (optional, we keep Docker plugin)
  loki:
    endpoint: http://loki:3100/loki/api/v1/push

service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [batch]
      exporters: [otlp/tempo]
    metrics:
      receivers: [otlp]
      processors: [batch]
      exporters: [prometheus]
```

### 3.6 Service Instrumentation

**Agent Server (`src/otel/setup.ts`):**
```typescript
// MUST be imported FIRST in index.ts
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { Resource } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';

// NOTE: Inngest's extendedTracesMiddleware exports via OTEL_EXPORTER_* env vars
// It does NOT require programmatic integration here - just ensure env vars are set

export const otelSdk = new NodeSDK({
  resource: new Resource({
    [ATTR_SERVICE_NAME]: 'agent-server',
  }),
  traceExporter: new OTLPTraceExporter({
    url: process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT || 'http://otel-collector:4318/v1/traces',
  }),
  metricReader: new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter({
      url: process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT || 'http://otel-collector:4318/v1/metrics',
    }),
    exportIntervalMillis: 10000,
  }),
  instrumentations: [
    getNodeAutoInstrumentations({
      '@opentelemetry/instrumentation-pino': {
        enabled: true,
        logKeys: { traceId: 'trace_id', spanId: 'span_id' },
      },
    }),
  ],
});

otelSdk.start();
```

**Store/Warehouse APIs (`src/otel.ts`):**
```typescript
// Similar setup - auto-instruments Koa, HTTP, Postgres
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';

const sdk = new NodeSDK({
  serviceName: process.env.SERVICE_NAME || 'store-api',
  traceExporter: new OTLPTraceExporter({ url: 'http://otel-collector:4318/v1/traces' }),
  instrumentations: [getNodeAutoInstrumentations()],
});
sdk.start();
```

### 3.7 Grafana Configuration

**Update `infra/grafana/provisioning/datasources/datasources.yaml`:**
```yaml
apiVersion: 1

datasources:
  - name: Loki
    type: loki
    url: http://loki:3100
    jsonData:
      derivedFields:
        - datasourceUid: tempo
          matcherRegex: '"trace_id":"([a-f0-9]+)"'
          name: TraceID
          url: '$${__value.raw}'

  - name: Tempo
    uid: tempo
    type: tempo
    url: http://tempo:3200
    isDefault: true
    jsonData:
      tracesToLogsV2:
        datasourceUid: loki
        filterByTraceID: true
        query: '{service="${__span.tags.service.name}"} | json | trace_id="${__span.traceId}"'
      serviceMap:
        datasourceUid: prometheus
      nodeGraph:
        enabled: true

  - name: Prometheus
    uid: prometheus
    type: prometheus
    url: http://prometheus:9090
```

---

## Part 4: Dashboard Strategy

### 4.1 Recommendation: Keep Custom Dashboard + Add Inngest Dev Server

| Dashboard | Purpose | Audience |
|-----------|---------|----------|
| **Custom React Dashboard** | HITL approvals, agent progress | End users |
| **Inngest Dev Server** | Function debugging, waterfall traces | Developers |
| **Grafana** | Distributed traces, metrics, logs | Operations |

### 4.2 Dashboard Migration

**Replace SSE with `useAgent` hook:**

> ⚠️ **IMPORTANT**: The hook is in `@inngest/use-agent`, NOT `@inngest/agent-kit/react`

```typescript
// Before: Custom SSE subscription
const [events, setEvents] = useState([]);
useEffect(() => {
  const es = new EventSource(`/api/runs/${runId}/stream`);
  es.onmessage = (e) => setEvents(prev => [...prev, JSON.parse(e.data)]);
  return () => es.close();
}, [runId]);

// After: Inngest useAgent hook
import { useAgent } from '@inngest/use-agent';  // ← Correct package!

const { messages, status, sendMessage } = useAgent({
  agentId: 'orchestrator',
  threadId: runId,
});
```

**Required setup**: Wrap your app in `<AgentProvider>` from `@inngest/use-agent`.

### 4.3 Grafana Dashboards for Demo

**Dashboard 1: Agent Command Center**
- Active runs (gauge)
- Run timeline (time series)
- Service map (node graph)
- Recent traces (tempo search)

**Dashboard 2: LLM Performance**
- Token usage (counter)
- Latency distribution (histogram)
- Model breakdown (pie chart)
- Cost estimation (stat)

**Dashboard 3: HITL Analytics**
- Pending approvals (gauge)
- Approval rate (pie chart)
- Wait time distribution (histogram)
- Tool trigger frequency (bar chart)

---

## Part 5: Implementation Phases

### Phase 1: Inngest MVP (Days 1-3) ✅ COMPLETED

**Goal**: Single agent with durable execution and HITL

**Status**: Completed and signed off by architect.

### Phase 1.5: Testing Infrastructure (Days 4-5) 🆕

**Goal**: Establish test infrastructure before building features that depend on it

| Task | Owner | Notes |
|------|-------|-------|
| Create `ops/packages/mock-llm/` package | - | Deterministic LLM responses |
| Create mock LLM server with Hono | - | OpenAI/Anthropic compatible |
| Create LLM response fixtures | - | safe-tool, dangerous-tool, etc. |
| Create `docker-compose.test.yaml` | - | Isolated test environment |
| Add Jest E2E config to agent-server | - | `jest.e2e.config.js` |
| Create `src/__tests__/e2e/` directory | - | Backend E2E tests |
| Create E2E test setup helpers | - | `setup.ts`, `helpers.ts` |
| Write smoke test (health + create run) | - | Verify infrastructure works |
| Add Playwright to dashboard | - | `@playwright/test` |
| Create `e2e/` directory in dashboard | - | Browser E2E tests |
| Write first Playwright test | - | Dashboard loads, form visible |
| Add test scripts to package.json | - | `test:e2e`, `test:playwright` |
| Document test commands | - | In TESTING.md |

**Verification:**
- [ ] `docker compose -f docker-compose.test.yaml up` starts all test services
- [ ] Mock LLM returns deterministic responses
- [ ] `npm run test:e2e` runs backend E2E tests
- [ ] `npm run test:playwright` runs browser E2E tests
- [ ] All tests pass in isolation

**Success Criteria:**
- Test commands exist and work
- Mock LLM server responds correctly
- At least 1 backend E2E test passes
- At least 1 Playwright test passes

---

### Phase 2: OpenTelemetry + Backend E2E Tests (Days 6-8)

**Goal**: Full observability stack + comprehensive backend E2E test coverage

#### OpenTelemetry Tasks

| Task | Owner | Notes |
|------|-------|-------|
| Add Tempo, Prometheus, OTel Collector to docker-compose | - | |
| Create `infra/otel/otel-collector.yaml` | - | |
| Create `infra/tempo/tempo.yaml` | - | |
| Create `infra/prometheus/prometheus.yaml` | - | |
| Update Grafana datasources | - | Loki + Tempo + Prometheus |
| Add OTel SDK to agent-server | - | |
| Add OTel SDK to store-api | - | |
| Add OTel SDK to warehouse-api | - | |
| Verify trace correlation across services | - | **Demo moment** |

#### Backend E2E Test Tasks

| Task | Owner | Notes |
|------|-------|-------|
| Write `runs.e2e.test.ts` | - | Create run, complete with safe tools |
| Write `hitl.e2e.test.ts` | - | Suspension, approval, rejection flows |
| Write `recovery.e2e.test.ts` | - | Server restart recovery test |
| Write `cancel.e2e.test.ts` | - | Cancellation flow |
| Achieve 100% E2E coverage of HITL paths | - | **Gate for Phase 3** |

**Verification:**
- [ ] `curl http://tempo.localhost/api/status/buildinfo` works
- [ ] `curl http://prometheus.localhost/api/v1/status/config` works
- [ ] Traces appear in Grafana Tempo
- [ ] Logs have `trace_id` field
- [ ] Click trace → see related logs
- [ ] All backend E2E tests pass
- [ ] HITL suspension/resume tested end-to-end

### Phase 3: AgentKit Multi-Agent (Days 9-11)

**Goal**: Full network with routing

| Task | Owner | Notes |
|------|-------|-------|
| Install `@inngest/agent-kit` | - | |
| Create orchestrator agent definition | - | |
| Create coding agent definition | - | |
| Create log-analyzer agent definition | - | |
| Create network with router | - | |
| Implement tool definitions | - | Wrap existing tools |
| Test delegation flow | - | |
| Verify traces show all agents | - | **Demo moment** |

**Verification:**
- [ ] Orchestrator delegates to coding agent
- [ ] Child agent results return to parent
- [ ] Single trace shows entire multi-agent flow
- [ ] Network handles 20+ iterations without issues

### Phase 4: Dashboard + Playwright E2E (Days 12-14)

**Goal**: Modern streaming UI with full browser E2E test coverage

#### Dashboard Tasks

| Task | Owner | Notes |
|------|-------|-------|
| Add `@inngest/use-agent` to dashboard | - | NOT agent-kit/react |
| Replace SSE with `useAgent` hook | - | |
| Update Timeline component | - | |
| Update ApprovalCard component | - | |
| Add `data-testid` attributes | - | Required for Playwright |
| Remove old SSE code from runs.ts | - | |
| Test multi-client sync | - | **Demo moment** |

#### Playwright E2E Test Tasks

| Task | Owner | Notes |
|------|-------|-------|
| Write `create-run.spec.ts` | - | Create run from UI |
| Write `approval-flow.spec.ts` | - | Approve dangerous tool via UI |
| Write `rejection-flow.spec.ts` | - | Reject with feedback via UI |
| Write `cancel-run.spec.ts` | - | Cancel run via UI |
| Write `real-time-updates.spec.ts` | - | Events stream in real-time |
| Write `multi-tab-sync.spec.ts` | - | Multiple tabs stay synchronized |
| Achieve 100% coverage of UI approval paths | - | **Gate for Phase 5** |

**Verification:**
- [ ] Dashboard shows real-time updates
- [ ] Multiple browser tabs stay in sync
- [ ] HITL approval works from dashboard
- [ ] No SSE code remains
- [ ] All Playwright E2E tests pass
- [ ] UI latency < 500ms from event to display

### Phase 5: Custom Metrics + Dashboards (Days 15-16)

**Goal**: Demo-ready Grafana dashboards

| Task | Owner | Notes |
|------|-------|-------|
| Add custom metrics (tokens, HITL, tools) | - | See metrics.ts |
| Create Agent Command Center dashboard | - | |
| Create LLM Performance dashboard | - | |
| Create HITL Analytics dashboard | - | |
| Add service map visualization | - | |
| Create demo script | - | |

**Verification:**
- [ ] Grafana shows custom metrics
- [ ] Service map displays correctly
- [ ] End-to-end demo flows smoothly

### Phase 6: Cleanup (Day 17)

| Task | Owner | Notes |
|------|-------|-------|
| Remove `DurableLoop.ts` | - | |
| Remove `delegation.ts` polling code | - | |
| Remove execution control from JournalService | - | Keep audit only |
| Update documentation | - | |
| Final testing | - | |

---

## Part 6: Risk Assessment

### High Risk

| Risk | Impact | Mitigation |
|------|--------|------------|
| Child run coordination with AgentKit | Significant rework | Prototype Network routing early |
| Real-time SSE degradation with Inngest | UX impact | Test `useAgent` latency before removing SSE |
| `extendedTracesMiddleware` is experimental | API changes | Pin Inngest version, have manual span fallback |

### Medium Risk

| Risk | Impact | Mitigation |
|------|--------|------------|
| Journal writes inside steps causing issues | Duplicate events | Ensure idempotency, use step IDs |
| Cancellation semantics unclear | Stuck runs | Test `step.waitForEvent` cancellation behavior |
| Learning curve | Slower progress | Start with simplest agent |

### Low Risk

| Risk | Impact | Mitigation |
|------|--------|------------|
| Performance overhead | Acceptable latency | Inngest is production-grade |
| OTel Collector bottleneck | Missing telemetry | Use batching, sampling if needed |

---

## Part 7: Success Criteria

### Functional

- [ ] Agent runs survive server restart
- [ ] HITL approvals work with up to 72h timeout
- [ ] Multi-agent delegation completes successfully
- [ ] Dashboard shows real-time progress
- [ ] All 3 agent types (orchestrator, coding, log-analyzer) work

### Observability

- [ ] Traces span all services (agent-server → store-api → database)
- [ ] Logs correlate with traces via `trace_id`
- [ ] Custom metrics (tokens, HITL, tools) appear in Prometheus
- [ ] Grafana dashboards show meaningful visualizations
- [ ] Service map displays agent → service connections

### Performance

- [ ] Dashboard latency < 500ms from event to display
- [ ] Inngest function overhead < 100ms per step
- [ ] Trace export latency < 5s to Grafana

### Demo

- [ ] "Restart server" demo works reliably
- [ ] "Click trace, see everything" demo works
- [ ] "Multi-agent waterfall" demo works
- [ ] "HITL approval" demo works

---

## Part 8: Critical Issues & Open Questions

> ⚠️ **This section must be resolved before implementation begins.**

### 8.1 PROTOTYPE REQUIRED: HITL Inside AgentKit Callbacks

The pattern in Part 2.3 shows `step.waitForEvent()` nested inside an AgentKit `onToolCall` callback:

```typescript
const result = await step.run('execute-network', async () => {
  return agentNetwork.run(task, {
    onToolCall: async (toolCall, agent) => {
      // ⚠️ Can step.waitForEvent() be called here?
      const approval = await step.waitForEvent('agent/run.resumed', { ... });
    },
  });
});
```

**Problem**: Inngest steps must typically be at the top level of the function body, not deeply nested in async callbacks. This pattern is **unverified**.

**Required Action**: Before Phase 3, build a minimal prototype that:
1. Creates an AgentKit network with a dangerous tool
2. Uses `step.waitForEvent()` inside the tool handler
3. Verifies the Inngest step checkpoint actually persists

**Alternative Pattern (from AgentKit docs)**: HITL as a first-class tool:
```typescript
const askHumanTool = createTool({
  name: 'ask_human',
  description: 'Request human approval for dangerous operations',
  handler: async (input, { step }) => {
    const response = await step.waitForEvent('human/response', {
      match: 'data.requestId',
      timeout: '72h',
    });
    return response.data;
  },
});
```

### 8.2 Journal Write Idempotency

**Problem**: If `step.run('init')` succeeds but the function crashes before checkpoint, Inngest retries the step, potentially inserting duplicate journal events.

**Required Schema Change**:
```sql
ALTER TABLE journal_entries ADD COLUMN idempotency_key VARCHAR(255);
CREATE UNIQUE INDEX idx_journal_idempotency ON journal_entries(run_id, idempotency_key);
```

**Required Code Change**:
```typescript
await step.run('record-thought', async () => {
  const stepId = 'thought-' + toolCallId;  // Derive from Inngest step context
  await journalService.appendEventIdempotent(runId, {
    type: 'AGENT_THOUGHT',
    payload: { text },
    idempotencyKey: stepId,
  });
});
```

### 8.3 Cancellation Semantics

**Missing from plan**: How to cancel in-flight agent runs.

**Required Addition to Function Definition**:
```typescript
export const agentRunFunction = inngest.createFunction(
  {
    id: 'agent-run',
    cancelOn: [
      { event: 'agent/run.cancelled', match: 'data.runId' }
    ],
  },
  { event: 'agent/run.started' },
  // ...
);
```

**Required API Endpoint**:
```typescript
runsRouter.post('/:id/cancel', async (c) => {
  const { id } = c.req.param();

  // Send cancellation event
  await inngest.send({
    name: 'agent/run.cancelled',
    data: { runId: id },
  });

  // Update database
  await journalService.updateRunStatus(id, 'cancelled');

  return c.json({ success: true });
});
```

### 8.4 Questions Requiring User Decision

**Q1: Child Run Semantics**

The current system has explicit parent/child run relationships (see `delegation.ts`). AgentKit Networks replace this with agent routing.

**Decision needed**: Do you need to preserve:
- Dashboard display of nested runs?
- Per-agent audit trails?
- Per-agent token/cost attribution?

**Q2: Real-Time Latency Tolerance**

Current SSE is near-instant (EventEmitter-based). `useAgent` goes through Inngest infrastructure.

**Decision needed**: What latency is acceptable?
- < 100ms (may require keeping SSE)
- < 500ms (useAgent likely fine)
- < 2s (definitely fine)

**Q3: Production Deployment**

The plan uses local Inngest Dev Server.

**Decision needed**:
- Inngest Cloud (managed, costs money)
- Self-hosted Inngest (more operational burden)

**Q4: Trace Sampling**

Plan sets `OTEL_TRACES_SAMPLER=always_on`.

**Decision needed**: For high-volume production, what sampling rate?
- 100% (full visibility, higher cost)
- 10% (reduced cost, statistical sampling)
- Head-based sampling on errors only

---

## Appendix A: File Structure After Migration

```
ops/packages/agent-server/
├── src/
│   ├── inngest/
│   │   ├── client.ts           # Inngest client + middleware
│   │   ├── serve.ts            # Hono serve handler
│   │   ├── functions/
│   │   │   └── agentRun.ts     # Main agent function
│   │   └── agents/
│   │       ├── index.ts        # Network definition
│   │       ├── orchestrator.ts # Orchestrator agent
│   │       ├── coding.ts       # Coding agent
│   │       └── logAnalyzer.ts  # Log analyzer agent
│   ├── otel/
│   │   ├── setup.ts            # OTel SDK initialization
│   │   ├── spans.ts            # Custom span helpers
│   │   └── metrics.ts          # Custom metrics
│   ├── services/
│   │   └── JournalService.ts   # Audit log only (execution control removed)
│   ├── routes/
│   │   └── runs.ts             # Updated to use inngest.send()
│   └── app.ts                  # Add /api/inngest route
├── infra/
│   ├── otel/
│   │   └── otel-collector.yaml
│   ├── tempo/
│   │   └── tempo.yaml
│   └── prometheus/
│       └── prometheus.yaml
```

---

## Appendix B: Environment Variables

**Add to `agent-server` service in docker-compose.yaml:**
```yaml
agent-server:
  environment:
    # Inngest connection (REQUIRED)
    INNGEST_DEV: "1"
    INNGEST_BASE_URL: http://inngest:8288
    INNGEST_EVENT_KEY: local

    # OpenTelemetry
    OTEL_EXPORTER_OTLP_ENDPOINT: http://otel-collector:4318
    OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: http://otel-collector:4318/v1/traces
    OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: http://otel-collector:4318/v1/metrics
    OTEL_SERVICE_NAME: agent-server
    OTEL_TRACES_SAMPLER: always_on
  depends_on:
    - inngest  # ← Must start after Inngest Dev Server
```

**For `.env` file:**
```bash
# Inngest
INNGEST_DEV=1
INNGEST_BASE_URL=http://inngest:8288
INNGEST_EVENT_KEY=local
INNGEST_SIGNING_KEY=              # For production only

# OpenTelemetry
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=http://otel-collector:4318/v1/traces
OTEL_EXPORTER_OTLP_METRICS_ENDPOINT=http://otel-collector:4318/v1/metrics
OTEL_SERVICE_NAME=agent-server
OTEL_TRACES_SAMPLER=always_on
```

---

## Appendix C: Sources & References

### Inngest
- [Inngest Documentation](https://www.inngest.com/docs)
- [Inngest OpenTelemetry Integration](https://www.inngest.com/blog/opentelemetry-nodejs-tracing-express-inngest)
- [Inngest Observability & Metrics](https://www.inngest.com/docs/platform/monitor/observability-metrics)
- [Inngest waitForEvent](https://www.inngest.com/docs/features/inngest-functions/steps-workflows/wait-for-event)

### AgentKit
- [AgentKit Overview](https://agentkit.inngest.com/overview)
- [AgentKit Networks](https://agentkit.inngest.com/concepts/networks)
- [AgentKit Human-in-the-Loop](https://agentkit.inngest.com/advanced-patterns/human-in-the-loop)
- [useAgent Hook](https://www.inngest.com/blog/agentkit-useagent-realtime-hook)
- [GitHub: inngest/agent-kit](https://github.com/inngest/agent-kit)

### OpenTelemetry
- [OpenTelemetry Node.js](https://opentelemetry.io/docs/languages/js/getting-started/nodejs/)
- [OTel Collector Configuration](https://opentelemetry.io/docs/collector/configuration/)
- [@hono/otel Middleware](https://www.npmjs.com/package/@hono/otel)
- [OTel Pino Instrumentation](https://www.npmjs.com/package/@opentelemetry/instrumentation-pino)

### Grafana Stack
- [Grafana Tempo Docker Setup](https://grafana.com/docs/tempo/latest/set-up-for-tracing/setup-tempo/deploy/locally/docker-compose/)
- [Tempo GitHub Examples](https://github.com/grafana/tempo/blob/main/example/docker-compose/otel-collector/readme.md)
- [Grafana Loki OTel Ingestion](https://grafana.com/docs/loki/latest/send-data/otel/)
