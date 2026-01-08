/**
 * Loki log query tools for AgentKit.
 *
 * These tools allow agents to query logs from Grafana Loki,
 * enabling investigation of application issues and monitoring.
 * They are read-only and do not require human approval.
 * All network operations are wrapped in step.run() for durability.
 *
 * Status Publishing:
 * Each tool publishes agent.status events to keep users informed
 * of progress during potentially slow network operations.
 */
import { createTool } from '@inngest/agent-kit';
import { z } from 'zod';
import { config } from '../config.js';

/**
 * Response type from Loki query API.
 */
interface LokiQueryResponse {
  status: string;
  data: {
    resultType: 'streams' | 'matrix' | 'vector' | 'scalar';
    result: Array<{
      stream: Record<string, string>;
      values: Array<[string, string]>; // [timestamp_ns, log_line]
    }>;
    stats?: Record<string, unknown>;
  };
}

/**
 * Response type from Loki labels API.
 */
interface LokiLabelsResponse {
  status: string;
  data: string[];
}

/**
 * Response type from Loki label values API.
 */
interface LokiLabelValuesResponse {
  status: string;
  data: string[];
}

/**
 * Query logs from Grafana Loki using LogQL.
 *
 * LogQL is Loki's query language, similar to PromQL.
 * Common patterns:
 * - {service="store-api"} - Select by label
 * - {service="store-api"} |= "error" - Filter by text
 * - {service="store-api"} | json - Parse JSON logs
 * - {service="store-api"} | json | level="error" - Filter JSON field
 *
 * Wrapped in step.run() for durability and crash recovery.
 */
export const lokiQueryTool = createTool({
  name: 'loki_query',
  description:
    'Query logs from Grafana Loki using LogQL. Use this to investigate application logs, search for errors, and analyze system behavior.',
  parameters: z.object({
    query: z
      .string()
      .describe('LogQL query (e.g., {service="store-api"} |= "error")'),
    limit: z
      .number()
      .optional()
      .default(100)
      .describe('Maximum number of log entries to return (default: 100)'),
    start: z
      .string()
      .optional()
      .describe('Start time for the query range (ISO 8601 or relative like "1h"). Defaults to 1 hour ago.'),
    end: z
      .string()
      .optional()
      .describe('End time for the query range (ISO 8601 or "now"). Defaults to now.'),
    direction: z
      .enum(['forward', 'backward'])
      .optional()
      .default('backward')
      .describe('Sort order: "backward" (newest first) or "forward" (oldest first). Default: backward'),
  }),
  handler: async ({ query, limit, start, end, direction }, { step }) => {
    // AgentKit automatically handles status publishing via streaming.publish
    const queryLogic = async () => {
      try {
        const lokiUrl = config.services.lokiUrl;

        // Build query parameters
        const params = new URLSearchParams();
        params.set('query', query);
        params.set('limit', String(limit ?? 100));
        params.set('direction', direction ?? 'backward');

        // Handle time range
        const now = Date.now();
        const oneHourAgo = now - 60 * 60 * 1000;

        // Start time
        if (start) {
          const startTime = parseTime(start, oneHourAgo);
          params.set('start', String(startTime * 1_000_000)); // Convert ms to nanoseconds
        } else {
          params.set('start', String(oneHourAgo * 1_000_000));
        }

        // End time
        if (end && end !== 'now') {
          const endTime = parseTime(end, now);
          params.set('end', String(endTime * 1_000_000));
        } else {
          params.set('end', String(now * 1_000_000));
        }

        const url = `${lokiUrl}/loki/api/v1/query_range?${params.toString()}`;

        const response = await fetch(url, {
          method: 'GET',
          headers: {
            Accept: 'application/json',
          },
        });

        if (!response.ok) {
          const errorText = await response.text();
          return {
            error: `Loki query failed: ${response.status} ${response.statusText}`,
            details: errorText,
            query,
          };
        }

        const data = (await response.json()) as LokiQueryResponse;

        // Transform the results into a more readable format
        const logs = data.data.result.flatMap((stream) =>
          stream.values.map(([timestampNs, line]) => ({
            timestamp: new Date(Number(timestampNs) / 1_000_000).toISOString(),
            labels: stream.stream,
            line,
          }))
        );

        return {
          success: true,
          query,
          resultType: data.data.resultType,
          count: logs.length,
          logs,
        };
      } catch (err) {
        const error = err as Error;

        // Handle network errors
        if (error.message.includes('fetch failed') || error.message.includes('ECONNREFUSED')) {
          return {
            error: 'Failed to connect to Loki',
            details: 'Loki service may be unavailable',
            lokiUrl: config.services.lokiUrl,
            query,
          };
        }

        return {
          error: `Loki query failed: ${error.message}`,
          query,
        };
      }
    };

    // Ensure step is available (it should always be in agent-kit context)
    if (!step) {
      return queryLogic();
    }

    return step.run('loki-query', queryLogic);
  },
});

/**
 * List available labels in Loki.
 *
 * Labels are key-value pairs attached to log streams.
 * Use this to discover what labels are available for filtering.
 * Wrapped in step.run() for durability.
 */
export const lokiLabelsTool = createTool({
  name: 'loki_labels',
  description:
    'List available labels in Loki. Labels are used to filter and select log streams. Common labels include "service", "level", "container", etc.',
  parameters: z.object({
    start: z
      .string()
      .optional()
      .describe('Start time for label discovery (ISO 8601 or relative like "1h"). Defaults to 1 hour ago.'),
    end: z
      .string()
      .optional()
      .describe('End time for label discovery (ISO 8601 or "now"). Defaults to now.'),
  }),
  handler: async ({ start, end }, { step }) => {
    // AgentKit automatically handles status publishing via streaming.publish
    const labelsLogic = async () => {
      try {
        const lokiUrl = config.services.lokiUrl;

        // Build query parameters
        const params = new URLSearchParams();

        const now = Date.now();
        const oneHourAgo = now - 60 * 60 * 1000;

        if (start) {
          const startTime = parseTime(start, oneHourAgo);
          params.set('start', String(startTime * 1_000_000));
        } else {
          params.set('start', String(oneHourAgo * 1_000_000));
        }

        if (end && end !== 'now') {
          const endTime = parseTime(end, now);
          params.set('end', String(endTime * 1_000_000));
        } else {
          params.set('end', String(now * 1_000_000));
        }

        const url = `${lokiUrl}/loki/api/v1/labels?${params.toString()}`;

        const response = await fetch(url, {
          method: 'GET',
          headers: {
            Accept: 'application/json',
          },
        });

        if (!response.ok) {
          const errorText = await response.text();
          return {
            error: `Failed to fetch labels: ${response.status} ${response.statusText}`,
            details: errorText,
          };
        }

        const data = (await response.json()) as LokiLabelsResponse;

        return {
          success: true,
          labels: data.data,
          count: data.data.length,
        };
      } catch (err) {
        const error = err as Error;

        if (error.message.includes('fetch failed') || error.message.includes('ECONNREFUSED')) {
          return {
            error: 'Failed to connect to Loki',
            details: 'Loki service may be unavailable',
            lokiUrl: config.services.lokiUrl,
          };
        }

        return {
          error: `Failed to fetch labels: ${error.message}`,
        };
      }
    };

    // Ensure step is available (it should always be in agent-kit context)
    if (!step) {
      return labelsLogic();
    }

    return step.run('loki-labels', labelsLogic);
  },
});

/**
 * Get values for a specific label in Loki.
 *
 * After discovering labels with loki_labels, use this to see
 * what values are available for a specific label.
 * Wrapped in step.run() for durability.
 */
export const lokiLabelValuesTool = createTool({
  name: 'loki_label_values',
  description:
    'Get all values for a specific label in Loki. Use this after loki_labels to discover what services, log levels, or other label values are available.',
  parameters: z.object({
    label: z
      .string()
      .describe('The label name to get values for (e.g., "service", "level")'),
    start: z
      .string()
      .optional()
      .describe('Start time (ISO 8601 or relative like "1h"). Defaults to 1 hour ago.'),
    end: z
      .string()
      .optional()
      .describe('End time (ISO 8601 or "now"). Defaults to now.'),
  }),
  handler: async ({ label, start, end }, { step }) => {
    // AgentKit automatically handles status publishing via streaming.publish
    const labelValuesLogic = async () => {
      try {
        const lokiUrl = config.services.lokiUrl;

        const params = new URLSearchParams();

        const now = Date.now();
        const oneHourAgo = now - 60 * 60 * 1000;

        if (start) {
          const startTime = parseTime(start, oneHourAgo);
          params.set('start', String(startTime * 1_000_000));
        } else {
          params.set('start', String(oneHourAgo * 1_000_000));
        }

        if (end && end !== 'now') {
          const endTime = parseTime(end, now);
          params.set('end', String(endTime * 1_000_000));
        } else {
          params.set('end', String(now * 1_000_000));
        }

        const url = `${lokiUrl}/loki/api/v1/label/${encodeURIComponent(label)}/values?${params.toString()}`;

        const response = await fetch(url, {
          method: 'GET',
          headers: {
            Accept: 'application/json',
          },
        });

        if (!response.ok) {
          const errorText = await response.text();
          return {
            error: `Failed to fetch label values: ${response.status} ${response.statusText}`,
            details: errorText,
            label,
          };
        }

        const data = (await response.json()) as LokiLabelValuesResponse;

        return {
          success: true,
          label,
          values: data.data,
          count: data.data.length,
        };
      } catch (err) {
        const error = err as Error;

        if (error.message.includes('fetch failed') || error.message.includes('ECONNREFUSED')) {
          return {
            error: 'Failed to connect to Loki',
            details: 'Loki service may be unavailable',
            lokiUrl: config.services.lokiUrl,
          };
        }

        return {
          error: `Failed to fetch label values: ${error.message}`,
          label,
        };
      }
    };

    // Ensure step is available (it should always be in agent-kit context)
    if (!step) {
      return labelValuesLogic();
    }

    return step.run('loki-label-values', labelValuesLogic);
  },
});

/**
 * Parse a time string into milliseconds since epoch.
 *
 * Supports:
 * - ISO 8601 timestamps
 * - Relative times like "1h", "30m", "24h"
 * - "now" for current time
 */
function parseTime(timeStr: string, defaultTime: number): number {
  if (timeStr === 'now') {
    return Date.now();
  }

  // Check for relative time format (e.g., "1h", "30m", "24h")
  const relativeMatch = timeStr.match(/^(\d+)([smhd])$/);
  if (relativeMatch) {
    const value = parseInt(relativeMatch[1], 10);
    const unit = relativeMatch[2];
    const now = Date.now();

    const multipliers: Record<string, number> = {
      s: 1000,
      m: 60 * 1000,
      h: 60 * 60 * 1000,
      d: 24 * 60 * 60 * 1000,
    };

    return now - value * multipliers[unit];
  }

  // Try to parse as ISO 8601
  const parsed = Date.parse(timeStr);
  if (!isNaN(parsed)) {
    return parsed;
  }

  return defaultTime;
}

/**
 * All Loki tools as an array for convenient registration.
 */
export const lokiTools = [lokiQueryTool, lokiLabelsTool, lokiLabelValuesTool];
