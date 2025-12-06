/**
 * Loki query tool for log analysis
 */

import { z } from 'zod';
import { tool } from 'ai';
import type { LokiQueryParams, LokiQueryResult, LokiLogEntry } from 'ops-shared/types';
import { getPathMappingConfig, parseStackTrace } from 'ops-shared';

/**
 * Schema for Loki query tool
 */
export const lokiQuerySchema = z.object({
  query: z.string().describe('LogQL query string (e.g., {service="store-api"} |= "ERROR")'),
  limit: z.number().optional().describe('Maximum number of log entries to return (default: 100)'),
  timeRange: z.string().optional().describe('Time range (e.g., "10m", "1h", "24h", "7d") - default: 1h'),
});

/**
 * Parse time range string (e.g., "-10m", "-1h", "-24h") to Date
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
 * Parse Loki API response into LokiQueryResult
 */
function parseLokiResponse(data: any, query: string): LokiQueryResult {
  const entries: LokiLogEntry[] = [];

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
        raw: line,
        // HTTP context
        path,
        method,
        status,
        // Everything else (error objects, custom fields, etc.)
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
  params: LokiQueryParams
): Promise<LokiQueryResult> {
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
 * Create the Loki query tool for Vercel AI SDK
 */
export function createLokiQueryTool(lokiUrl: string) {
  return tool({
    description:
      'Query logs from Loki using LogQL syntax. Use this to search for errors, trace requests, and investigate issues across services.',
    parameters: lokiQuerySchema,
    execute: async ({ query, limit, timeRange }) => {
      try {
        const result = await executeLokiQuery(lokiUrl, {
          query,
          limit: limit || 100,
          start: timeRange ? `-${timeRange}` : '-1h',
        });

        // Get path mapping config for stack trace translation
        const pathConfig = getPathMappingConfig();

        return {
          success: true,
          query: result.query,
          totalCount: result.totalCount,
          entries: result.entries.map(e => {
            // Check if there's an error with a stack trace to parse
            const errorStack = (e.context as any)?.error?.stack;
            const parsedStack = errorStack
              ? parseStackTrace(errorStack, pathConfig)
              : undefined;

            return {
              timestamp: e.timestamp,
              level: e.level,
              service: e.service,
              message: e.message,
              // Include HTTP context if present
              ...(e.path && { path: e.path }),
              ...(e.method && { method: e.method }),
              ...(e.status && { status: e.status }),
              // Include additional context (error objects, custom fields, etc.)
              ...(e.context && { context: e.context }),
              // Include parsed stack trace with user code highlighted
              ...(parsedStack && { parsedStack }),
            };
          }),
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
