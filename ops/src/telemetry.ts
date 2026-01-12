/**
 * OpenTelemetry setup for AgentOps.
 *
 * This module initializes the OpenTelemetry SDK for distributed tracing,
 * exporting traces to Tempo (or any OTLP-compatible backend).
 *
 * IMPORTANT: This module must be imported BEFORE any other modules
 * to ensure proper instrumentation. Use the --import flag:
 *   node --import ./dist/telemetry.js ./dist/server.js
 *
 * Integration with Inngest:
 * - extendedTracesMiddleware() in inngest.ts handles step-level tracing
 * - InngestSpanProcessor links Inngest spans to our trace context
 * - The SDK must be created with InngestSpanProcessor in spanProcessors array
 */
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';

// Read configuration directly from environment
const serviceName = process.env.OTEL_SERVICE_NAME ?? 'agentops';
const otlpEndpoint =
  process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ??
  'http://tempo:4318/v1/traces';
const isEnabled = process.env.OTEL_ENABLED !== 'false';

// Store SDK reference for shutdown
let sdk: NodeSDK | null = null;

/**
 * Initialize and start the OpenTelemetry SDK.
 */
async function initTelemetry(): Promise<NodeSDK | null> {
  if (!isEnabled) {
    console.log('[telemetry] OpenTelemetry disabled via OTEL_ENABLED=false');
    return null;
  }

  console.log(`[telemetry] Initializing OpenTelemetry`);
  console.log(`[telemetry]   Service: ${serviceName}`);
  console.log(`[telemetry]   Exporting to: ${otlpEndpoint}`);

  // Import inngest client first - extendedTracesMiddleware will initialize
  // its own tracer provider, but we'll override it with our SDK
  const { InngestSpanProcessor } = await import('inngest/experimental');
  const { inngest } = await import('./inngest.js');

  const traceExporter = new OTLPTraceExporter({
    url: otlpEndpoint,
    timeoutMillis: 10000,
  });

  sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: serviceName,
      [ATTR_SERVICE_VERSION]: process.env.npm_package_version ?? '1.0.0',
    }),
    // When specifying spanProcessors, we must include both:
    // 1. BatchSpanProcessor to export spans to the trace exporter
    // 2. InngestSpanProcessor to link Inngest function spans to trace context
    spanProcessors: [
      new BatchSpanProcessor(traceExporter),
      new InngestSpanProcessor(inngest) as any,
    ],
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': {
          enabled: false,
        },
        '@opentelemetry/instrumentation-http': {
          ignoreIncomingRequestHook: (request) => {
            const url = request.url || '';
            return ['/health', '/healthz', '/ready'].some((path) =>
              url.includes(path)
            );
          },
        },
      }),
    ],
  });

  // Start the SDK - this will register our tracer provider globally
  sdk.start();

  console.log('[telemetry] OpenTelemetry SDK started with InngestSpanProcessor');

  return sdk;
}

// Initialize on module load
await initTelemetry();

/**
 * Graceful shutdown handler for the OpenTelemetry SDK.
 */
async function shutdown(): Promise<void> {
  if (sdk) {
    console.log('[telemetry] Shutting down OpenTelemetry SDK...');
    try {
      await sdk.shutdown();
      console.log('[telemetry] OpenTelemetry SDK shut down successfully');
    } catch (error) {
      console.error('[telemetry] Error shutting down OpenTelemetry SDK:', error);
    }
  }
}

// Register shutdown handlers
process.on('SIGTERM', async () => {
  await shutdown();
  process.exit(0);
});

process.on('SIGINT', async () => {
  await shutdown();
  process.exit(0);
});

export { sdk, shutdown };
