/**
 * Loki-specific types for log analysis
 */

/**
 * Loki log entry
 */
export interface LokiLogEntry {
  timestamp: string;
  level: string;
  service: string;
  message: string;
  labels: Record<string, string>;
  raw: string;
  // HTTP request context (common for API errors)
  path?: string;
  method?: string;
  status?: number;
  // All other parsed fields from the log entry (error objects, custom fields, etc.)
  context?: Record<string, unknown>;
}

/**
 * Loki query parameters
 */
export interface LokiQueryParams {
  query: string;
  limit?: number;
  start?: string;
  end?: string;
  direction?: 'forward' | 'backward';
}

/**
 * Loki query result
 */
export interface LokiQueryResult {
  entries: LokiLogEntry[];
  totalCount: number;
  query: string;
}

/**
 * Log analysis result
 */
export interface LogAnalysisResult {
  type: 'error-patterns' | 'performance' | 'timeline' | 'summary';
  findings: LogFinding[];
  summary: string;
  recommendations?: string[];
}

/**
 * Individual log finding
 */
export interface LogFinding {
  severity: 'critical' | 'high' | 'medium' | 'low';
  category: string;
  description: string;
  count: number;
  examples: LokiLogEntry[];
  rootCause?: string;
}

/**
 * Report generation options
 */
export interface ReportOptions {
  format: 'json' | 'markdown' | 'html';
  includeTimeline?: boolean;
  includeRecommendations?: boolean;
  title?: string;
}
