/**
 * OpenTelemetry setup for AgentOps.
 *
 * This module initializes the OpenTelemetry SDK for distributed tracing,
 * exporting traces to Tempo (or any OTLP-compatible backend).
 *
 * IMPORTANT: This module must be imported BEFORE any other modules
 * to ensure proper instrumentation. Use the --import flag:
 *   node --import ./dist/telemetry.js ./dist/server.js
 */
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';

// Read configuration directly from environment to avoid circular imports
const serviceName = process.env.OTEL_SERVICE_NAME ?? 'agentops';
const otlpEndpoint =
  process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ??
  'http://tempo:4318/v1/traces';
const isEnabled = process.env.OTEL_ENABLED !== 'false';

/**
 * Initialize and start the OpenTelemetry SDK.
 *
 * The SDK automatically instruments:
 * - HTTP requests (incoming and outgoing)
 * - PostgreSQL queries
 * - Fetch API calls
 * - And more via auto-instrumentations
 */
function initTelemetry(): NodeSDK | null {
  if (!isEnabled) {
    console.log('[telemetry] OpenTelemetry disabled via OTEL_ENABLED=false');
    return null;
  }

  console.log(`[telemetry] Initializing OpenTelemetry`);
  console.log(`[telemetry]   Service: ${serviceName}`);
  console.log(`[telemetry]   Exporting to: ${otlpEndpoint}`);

  const sdk = new NodeSDK({
    resource: new Resource({
      [ATTR_SERVICE_NAME]: serviceName,
      [ATTR_SERVICE_VERSION]: process.env.npm_package_version ?? '1.0.0',
    }),
    traceExporter: new OTLPTraceExporter({
      url: otlpEndpoint,
      // Set a reasonable timeout for trace export
      timeoutMillis: 10000,
    }),
    instrumentations: [
      getNodeAutoInstrumentations({
        // Disable noisy instrumentations that may cause issues
        '@opentelemetry/instrumentation-fs': {
          enabled: false,
        },
        // Configure HTTP instrumentation
        '@opentelemetry/instrumentation-http': {
          ignoreIncomingPaths: ['/health', '/healthz', '/ready'],
        },
      }),
    ],
  });

  // Start the SDK
  sdk.start();

  console.log('[telemetry] OpenTelemetry SDK started');

  return sdk;
}

// Initialize on module load
const sdk = initTelemetry();

/**
 * Graceful shutdown handler for the OpenTelemetry SDK.
 * Ensures all pending traces are flushed before process exit.
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
