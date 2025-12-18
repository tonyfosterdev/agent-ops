/**
 * Headless Log Analyzer Agent
 *
 * Wrapper that runs the LogAnalyzerAgent and returns an AgentReport JSON.
 * Max 3 Loki queries enforced.
 */

import { generateText } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { getLokiConfig } from 'ops-shared/config';
import { createLokiQueryTool, createLogAnalysisTool, createReportGenerationTool } from './tools';
import { getSystemPrompt } from './prompts';
import type { AgentReport, AgentFinding } from '../../types/journal';
import { logger } from '../../config';

const MAX_QUERIES = 3;

/**
 * Run the log analyzer agent headlessly and return a structured report
 */
export async function runHeadlessLogAnalyzer(options: {
  prompt: string;
  maxQueries?: number;
}): Promise<AgentReport> {
  const { prompt, maxQueries = MAX_QUERIES } = options;
  const lokiConfig = getLokiConfig();

  // Track query count
  let queryCount = 0;

  // Create tools with query limiting
  const lokiQueryTool = createLokiQueryTool(lokiConfig.url);
  const logAnalysisTool = createLogAnalysisTool();
  const reportGenerationTool = createReportGenerationTool();

  // Wrap loki_query to enforce limit
  const limitedLokiQueryTool = {
    ...lokiQueryTool,
    execute: async (args: any, context: any) => {
      if (queryCount >= maxQueries) {
        return {
          success: false,
          error: `Query limit reached (max ${maxQueries} queries). Please summarize findings.`,
          totalCount: 0,
          logs: [],
        };
      }
      queryCount++;
      logger.info({ queryCount, maxQueries }, 'Executing Loki query');
      return lokiQueryTool.execute(args, context);
    },
  };

  const findings: AgentFinding[] = [];
  let summary = '';

  try {
    const result = await generateText({
      model: anthropic('claude-sonnet-4-20250514'),
      maxSteps: maxQueries + 2, // Allow a few extra steps for analysis
      system: `${getSystemPrompt()}

IMPORTANT: You are running in headless mode. You MUST:
1. Use at most ${maxQueries} loki_query calls
2. Summarize all findings concisely
3. Return a structured analysis

After investigating, provide a summary in this exact format:
SUMMARY: <one sentence summary>
FINDINGS:
- [SEVERITY] Title: Description (evidence: "relevant log excerpt")`,
      prompt,
      tools: {
        loki_query: limitedLokiQueryTool,
        analyze_logs: logAnalysisTool,
        generate_report: reportGenerationTool,
      },
    });

    const finalText = result.text;

    // Parse the summary
    const summaryMatch = finalText.match(/SUMMARY:\s*(.+?)(?:\n|FINDINGS:|$)/is);
    summary = summaryMatch ? summaryMatch[1].trim() : finalText.slice(0, 200);

    // Parse findings
    const findingsMatch = finalText.match(/FINDINGS:\s*([\s\S]*)/i);
    if (findingsMatch) {
      const findingsText = findingsMatch[1];
      const findingLines = findingsText.split('\n').filter((line) => line.trim().startsWith('-'));

      for (const line of findingLines) {
        const match = line.match(
          /-\s*\[(\w+)\]\s*(.+?):\s*(.+?)(?:\(evidence:\s*"(.+?)"\))?$/i
        );
        if (match) {
          const [, severity, title, description, evidence] = match;
          findings.push({
            severity: (severity.toLowerCase() as AgentFinding['severity']) || 'info',
            title: title.trim(),
            description: description.trim(),
            evidence: evidence?.trim(),
          });
        }
      }
    }

    // If no structured findings were parsed, create a generic one
    if (findings.length === 0 && finalText.length > 0) {
      findings.push({
        severity: 'info',
        title: 'Analysis Result',
        description: summary || finalText.slice(0, 500),
      });
    }

    return {
      agent_type: 'log-analyzer',
      success: true,
      summary,
      findings,
      metadata: {
        queries_used: queryCount,
        max_queries: maxQueries,
      },
    };
  } catch (error: any) {
    logger.error({ error: error.message }, 'Headless log analyzer failed');
    return {
      agent_type: 'log-analyzer',
      success: false,
      summary: `Analysis failed: ${error.message}`,
      findings: [
        {
          severity: 'error',
          title: 'Agent Error',
          description: error.message,
        },
      ],
      metadata: {
        queries_used: queryCount,
        error: error.message,
      },
    };
  }
}
