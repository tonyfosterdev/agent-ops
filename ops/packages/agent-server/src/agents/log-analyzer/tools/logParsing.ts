/**
 * Log parsing and analysis tool
 */

import { z } from 'zod';
import { tool } from 'ai';
import type { LogAnalysisResult, LogFinding, LokiLogEntry } from 'ops-shared/types';

/**
 * Schema for log analysis tool
 */
export const analyzeLogsSchema = z.object({
  entries: z.array(z.any()).describe('Array of log entries to analyze'),
  analysisType: z
    .enum(['error-patterns', 'performance', 'timeline', 'summary'])
    .describe('Type of analysis to perform'),
});

/**
 * Analyze log entries for patterns and insights
 */
function analyzeLogs(
  entries: LokiLogEntry[],
  analysisType: 'error-patterns' | 'performance' | 'timeline' | 'summary'
): LogAnalysisResult {
  const findings: LogFinding[] = [];

  if (analysisType === 'error-patterns') {
    // Group errors by type
    const errorCounts: Record<string, number> = {};
    const errorExamples: Record<string, LokiLogEntry[]> = {};

    entries.forEach((entry) => {
      if (entry.level === 'error') {
        const key = entry.message.split(':')[0]; // First part of error message
        errorCounts[key] = (errorCounts[key] || 0) + 1;
        if (!errorExamples[key]) errorExamples[key] = [];
        if (errorExamples[key].length < 3) errorExamples[key].push(entry);
      }
    });

    Object.entries(errorCounts).forEach(([errorType, count]) => {
      findings.push({
        severity: count > 10 ? 'critical' : count > 5 ? 'high' : 'medium',
        category: 'error',
        description: `${errorType}: ${count} occurrences`,
        count,
        examples: errorExamples[errorType],
        rootCause: 'Investigation needed',
      });
    });
  }

  if (analysisType === 'summary') {
    const levels: Record<string, number> = {};
    const services: Record<string, number> = {};

    entries.forEach((entry) => {
      levels[entry.level] = (levels[entry.level] || 0) + 1;
      services[entry.service] = (services[entry.service] || 0) + 1;
    });

    findings.push({
      severity: 'low',
      category: 'summary',
      description: `Total entries: ${entries.length}. Levels: ${JSON.stringify(levels)}. Services: ${JSON.stringify(services)}`,
      count: entries.length,
      examples: entries.slice(0, 3),
    });
  }

  return {
    type: analysisType,
    findings,
    summary: `Analyzed ${entries.length} log entries. Found ${findings.length} patterns.`,
    recommendations: findings.length > 0 ? ['Investigate error patterns', 'Check service health'] : [],
  };
}

/**
 * Create the log analysis tool for Vercel AI SDK
 */
export function createLogAnalysisTool() {
  return tool({
    description:
      'Analyze log entries to find patterns, errors, and insights. Use this after querying logs to identify root causes.',
    parameters: analyzeLogsSchema,
    execute: async ({ entries, analysisType }) => {
      try {
        const result = analyzeLogs(entries as LokiLogEntry[], analysisType);

        return {
          success: true,
          type: result.type,
          summary: result.summary,
          findingsCount: result.findings.length,
          findings: result.findings.map((f) => ({
            severity: f.severity,
            category: f.category,
            description: f.description,
            count: f.count,
          })),
          recommendations: result.recommendations,
        };
      } catch (error: any) {
        return {
          success: false,
          error: error.message,
        };
      }
    },
  });
}
