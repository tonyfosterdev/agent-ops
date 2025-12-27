/**
 * Loki query tools for DurableLoop
 *
 * Provides read-only log querying capabilities via Loki.
 * All tools are SAFE (auto-execute without approval).
 */

import { z } from 'zod';
import { tool } from 'ai';

/**
 * Schema for Loki query tool
 */
export const lokiQuerySchema = z.object({
  query: z.string().describe('LogQL query string (e.g., {service="store-api"} |= "ERROR")'),
  limit: z.number().optional().describe('Maximum number of log entries to return (default: 100)'),
  timeRange: z.string().optional().describe('Time range (e.g., "10m", "1h", "24h", "7d") - default: 1h'),
});

/**
 * Schema for Loki labels tool
 */
export const lokiLabelsSchema = z.object({
  label: z.string().optional().describe('Specific label to get values for (e.g., "service"). If not provided, lists all available labels.'),
});

/**
 * Schema for Loki service errors tool
 */
export const lokiServiceErrorsSchema = z.object({
  service: z.string().describe('Service name (e.g., "store-api", "warehouse-alpha")'),
  timeRange: z.string().optional().describe('Time range (e.g., "10m", "1h", "24h", "7d") - default: 1h'),
  limit: z.number().optional().describe('Maximum number of entries to return (default: 50)'),
});

/**
 * Parse time range string (e.g., "10m", "1h", "24h") to Date
 */
function parseTimeRange(range: string, relativeTo: Date): Date {
  const match = range.match(/^-?(\d+)(s|m|h|d)$/);
  if (!match) return new Date(relativeTo.getTime() - 3600000); // default 1h

  const [, value, unit] = match;
  const ms: Record<string, number> = {
    s: 1000,
    m: 60000,
    h: 3600000,
    d: 86400000,
  };

  return new Date(relativeTo.getTime() - parseInt(value) * (ms[unit] || 3600000));
}

/**
 * Parse Loki API response into structured entries
 */
function parseLokiResponse(data: any, query: string) {
  const entries: Array<{
    timestamp: string;
    level: string;
    service: string;
    message: string;
    labels: Record<string, string>;
    context?: Record<string, unknown>;
  }> = [];

  // Loki returns streams with values
  for (const stream of data.data?.result || []) {
    const labels = stream.stream || {};
    for (const [timestamp, line] of stream.values || []) {
      // Parse the JSON log line
      let parsed: any = {};
      try {
        parsed = JSON.parse(line);
      } catch {
        parsed = { message: line };
      }

      // Extract known fields, collect the rest into context
      const {
        level: parsedLevel,
        service: parsedService,
        msg,
        message: parsedMessage,
        time,
        timestamp: ts,
        path,
        method,
        status,
        ...rest
      } = parsed;

      entries.push({
        timestamp: new Date(parseInt(timestamp) / 1000000).toISOString(),
        level: parsedLevel || labels.level || 'unknown',
        service: parsedService || labels.service || 'unknown',
        message: msg || parsedMessage || line,
        labels,
        // Include additional context (error objects, custom fields, etc.)
        context: Object.keys(rest).length > 0 ? rest : undefined,
      });
    }
  }

  return {
    entries,
    totalCount: entries.length,
    query,
  };
}

/**
 * Execute a LogQL query against Loki API
 */
async function executeLokiQuery(
  lokiUrl: string,
  params: { query: string; limit?: number; start?: string; direction?: string }
) {
  // Calculate time range
  const end = new Date();
  const start = parseTimeRange(params.start || '-1h', end);

  // Build Loki query_range URL
  const url = new URL(`${lokiUrl}/loki/api/v1/query_range`);
  url.searchParams.set('query', params.query);
  url.searchParams.set('start', Math.floor(start.getTime() / 1000).toString());
  url.searchParams.set('end', Math.floor(end.getTime() / 1000).toString());
  url.searchParams.set('limit', (params.limit || 100).toString());
  url.searchParams.set('direction', params.direction || 'backward');

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Loki query failed: ${response.status} ${response.statusText} - ${errorText}`);
  }

  const data = await response.json();
  return parseLokiResponse(data, params.query);
}

/**
 * Fetch labels or label values from Loki
 */
async function fetchLokiLabels(lokiUrl: string, label?: string) {
  const endpoint = label
    ? `${lokiUrl}/loki/api/v1/label/${encodeURIComponent(label)}/values`
    : `${lokiUrl}/loki/api/v1/labels`;

  const response = await fetch(endpoint, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Loki labels request failed: ${response.status} ${response.statusText} - ${errorText}`);
  }

  const data = (await response.json()) as { data?: string[] };
  return data.data || [];
}

/**
 * Create the Loki query tool for Vercel AI SDK
 */
export function createLokiQueryTool(lokiUrl: string) {
  return tool({
    description:
      'Query application logs from Loki using LogQL. Use this to investigate errors, check service health, trace requests, and analyze log patterns. Prefer this over running applications or docker logs commands.',
    parameters: lokiQuerySchema,
    execute: async ({ query, limit, timeRange }) => {
      try {
        const result = await executeLokiQuery(lokiUrl, {
          query,
          limit: limit || 100,
          start: timeRange ? `-${timeRange}` : '-1h',
        });

        return {
          success: true,
          query: result.query,
          totalCount: result.totalCount,
          entries: result.entries.map((e) => ({
            timestamp: e.timestamp,
            level: e.level,
            service: e.service,
            message: e.message,
            ...(e.context && { context: e.context }),
          })),
        };
      } catch (error: any) {
        return {
          success: false,
          error: error.message,
          query,
          totalCount: 0,
          entries: [],
        };
      }
    },
  });
}

/**
 * Create the Loki labels tool for discovering available log sources
 */
export function createLokiLabelsTool(lokiUrl: string) {
  return tool({
    description:
      'List available log labels and their values from Loki. Use this to discover what services and labels are available to query before writing LogQL queries.',
    parameters: lokiLabelsSchema,
    execute: async ({ label }) => {
      try {
        const values = await fetchLokiLabels(lokiUrl, label);

        if (label) {
          return {
            success: true,
            label,
            values,
            hint: `Use these values in queries like: {${label}="${values[0] || 'value'}"}`,
          };
        }

        return {
          success: true,
          labels: values,
          hint: 'Use loki_labels with a specific label to get its values, e.g., label="service"',
        };
      } catch (error: any) {
        return {
          success: false,
          error: error.message,
          label,
          values: [],
        };
      }
    },
  });
}

/**
 * Create convenience tool for quickly finding service errors
 */
export function createLokiServiceErrorsTool(lokiUrl: string) {
  return tool({
    description:
      'Quick query to find errors for a specific service. Simpler than writing raw LogQL. Use this as a first step when investigating issues with a service.',
    parameters: lokiServiceErrorsSchema,
    execute: async ({ service, timeRange, limit }) => {
      try {
        // Build query that matches common error patterns
        // Looks for ERROR level or error text in the message
        const query = `{service="${service}"} |~ "(?i)(error|exception|failed|failure)"`;

        const result = await executeLokiQuery(lokiUrl, {
          query,
          limit: limit || 50,
          start: timeRange ? `-${timeRange}` : '-1h',
        });

        return {
          success: true,
          service,
          query,
          totalCount: result.totalCount,
          entries: result.entries.map((e) => ({
            timestamp: e.timestamp,
            level: e.level,
            message: e.message,
            ...(e.context && { context: e.context }),
          })),
        };
      } catch (error: any) {
        return {
          success: false,
          error: error.message,
          service,
          totalCount: 0,
          entries: [],
        };
      }
    },
  });
}
