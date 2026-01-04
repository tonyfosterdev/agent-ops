/**
 * Environment configuration loader for AgentOps.
 *
 * Centralizes all environment variable access with validation
 * and sensible defaults for development.
 */

/**
 * Configuration schema for the application.
 */
export interface Config {
  /** Server configuration */
  server: {
    port: number;
    host: string;
  };

  /** Database configuration (dedicated agent PostgreSQL instance) */
  database: {
    url: string;
  };

  /** Inngest configuration */
  inngest: {
    isDev: boolean;
    eventKey: string | undefined;
    devServerUrl: string;
  };

  /** OpenTelemetry configuration */
  telemetry: {
    enabled: boolean;
    serviceName: string;
    otlpEndpoint: string;
  };

  /** Anthropic API configuration */
  anthropic: {
    apiKey: string | undefined;
  };

  /** External service URLs */
  services: {
    lokiUrl: string;
    storeApiUrl: string;
    warehouseAlphaUrl: string;
    warehouseBetaUrl: string;
  };
}

/**
 * Parse a boolean environment variable.
 */
function parseBool(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) return defaultValue;
  return value.toLowerCase() === 'true' || value === '1';
}

/**
 * Parse an integer environment variable.
 */
function parseInt(value: string | undefined, defaultValue: number): number {
  if (value === undefined) return defaultValue;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Load configuration from environment variables.
 *
 * Provides sensible defaults for local development while
 * requiring proper configuration in production.
 */
function loadConfig(): Config {
  const isDev = parseBool(process.env.INNGEST_DEV, true);

  return {
    server: {
      port: parseInt(process.env.PORT, 3200),
      host: process.env.HOST ?? '0.0.0.0',
    },

    database: {
      // Dedicated PostgreSQL instance for agent history
      url:
        process.env.AGENT_DATABASE_URL ??
        'postgres://agentuser:agentpass@agent-db:5432/agent_db',
    },

    inngest: {
      isDev,
      eventKey: process.env.INNGEST_EVENT_KEY,
      devServerUrl:
        process.env.INNGEST_DEV_SERVER_URL ?? 'http://inngest-dev:8288',
    },

    telemetry: {
      enabled: parseBool(process.env.OTEL_ENABLED, true),
      serviceName: process.env.OTEL_SERVICE_NAME ?? 'agentops',
      // Default to Tempo endpoint in the Docker network
      otlpEndpoint:
        process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ??
        'http://tempo:4318/v1/traces',
    },

    anthropic: {
      apiKey: process.env.ANTHROPIC_API_KEY,
    },

    services: {
      lokiUrl: process.env.LOKI_URL ?? 'http://loki:3100',
      storeApiUrl: process.env.STORE_API_URL ?? 'http://store-api:3000',
      warehouseAlphaUrl:
        process.env.WAREHOUSE_ALPHA_URL ?? 'http://warehouse-alpha:3000',
      warehouseBetaUrl:
        process.env.WAREHOUSE_BETA_URL ?? 'http://warehouse-beta:3000',
    },
  };
}

/**
 * The loaded configuration object.
 * Frozen to prevent accidental modification.
 */
export const config: Config = Object.freeze(loadConfig());

/**
 * Validate that required configuration is present.
 * Call this at startup to fail fast if misconfigured.
 */
export function validateConfig(): void {
  const errors: string[] = [];

  // Anthropic API key is required for agent operations
  if (!config.anthropic.apiKey) {
    errors.push('ANTHROPIC_API_KEY is required');
  }

  // In production, Inngest event key is required
  if (!config.inngest.isDev && !config.inngest.eventKey) {
    errors.push('INNGEST_EVENT_KEY is required in production');
  }

  if (errors.length > 0) {
    throw new Error(`Configuration errors:\n  - ${errors.join('\n  - ')}`);
  }
}
