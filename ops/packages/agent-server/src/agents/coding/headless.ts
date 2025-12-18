/**
 * Headless Coding Agent
 *
 * Wrapper that runs the CodingAgent and returns an AgentReport JSON.
 * Used for root cause analysis and patch proposals.
 */

import { generateText } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import {
  createShellTool,
  createReadFileTool,
  createWriteFileTool,
  createFindFilesTool,
  createSearchCodeTool,
} from './tools';
import { getSystemPrompt } from './prompts';
import type { AgentReport, AgentFinding } from '../../types/journal';
import { logger, config } from '../../config';

/**
 * Run the coding agent headlessly and return a structured report
 */
export async function runHeadlessCodingAgent(options: {
  errorContext: string;
  fileContext?: string[];
  maxSteps?: number;
}): Promise<AgentReport> {
  const { errorContext, fileContext = [], maxSteps = 10 } = options;
  const workDir = config.workDir;

  // Create tools
  const tools = {
    shell_command_execute: createShellTool(workDir),
    read_file: createReadFileTool(workDir),
    write_file: createWriteFileTool(workDir),
    find_files: createFindFilesTool(workDir),
    search_code: createSearchCodeTool(workDir),
  };

  const findings: AgentFinding[] = [];
  let summary = '';

  // Build context for the agent
  const contextInfo = fileContext.length > 0
    ? `\nRelevant files to examine: ${fileContext.join(', ')}`
    : '';

  try {
    const result = await generateText({
      model: anthropic('claude-sonnet-4-20250514'),
      maxSteps,
      system: `${getSystemPrompt()}

IMPORTANT: You are running in headless mode for root cause analysis. You MUST:
1. Investigate the error thoroughly
2. Identify the root cause
3. Propose a fix (do not apply it - just describe it)
4. Return a structured analysis

After investigating, provide your analysis in this exact format:
SUMMARY: <one sentence summary of the issue and fix>
ROOT_CAUSE: <what is causing the error>
FINDINGS:
- [SEVERITY] Title: Description
- [SEVERITY] Title: Description
PROPOSED_FIX:
File: <path>
Change: <description of what to change>`,
      prompt: `Analyze this error and propose a fix:

${errorContext}
${contextInfo}

Please investigate the root cause and propose a fix. DO NOT actually apply the fix - just analyze and propose.`,
      tools,
    });

    const finalText = result.text;

    // Parse the summary
    const summaryMatch = finalText.match(/SUMMARY:\s*(.+?)(?:\n|ROOT_CAUSE:|$)/is);
    summary = summaryMatch ? summaryMatch[1].trim() : 'Analysis completed';

    // Parse root cause
    const rootCauseMatch = finalText.match(/ROOT_CAUSE:\s*(.+?)(?:\n|FINDINGS:|$)/is);
    if (rootCauseMatch) {
      findings.push({
        severity: 'error',
        title: 'Root Cause',
        description: rootCauseMatch[1].trim(),
      });
    }

    // Parse findings
    const findingsMatch = finalText.match(/FINDINGS:\s*([\s\S]*?)(?:PROPOSED_FIX:|$)/i);
    if (findingsMatch) {
      const findingsText = findingsMatch[1];
      const findingLines = findingsText.split('\n').filter((line) => line.trim().startsWith('-'));

      for (const line of findingLines) {
        const match = line.match(/-\s*\[(\w+)\]\s*(.+?):\s*(.+)$/i);
        if (match) {
          const [, severity, title, description] = match;
          findings.push({
            severity: (severity.toLowerCase() as AgentFinding['severity']) || 'info',
            title: title.trim(),
            description: description.trim(),
          });
        }
      }
    }

    // Parse proposed fix
    const proposedFixMatch = finalText.match(/PROPOSED_FIX:\s*([\s\S]*)/i);
    if (proposedFixMatch) {
      findings.push({
        severity: 'info',
        title: 'Proposed Fix',
        description: proposedFixMatch[1].trim(),
        recommendation: proposedFixMatch[1].trim(),
      });
    }

    // If no structured findings were parsed, create a generic one
    if (findings.length === 0 && finalText.length > 0) {
      findings.push({
        severity: 'info',
        title: 'Analysis Result',
        description: finalText.slice(0, 500),
      });
    }

    return {
      agent_type: 'coding',
      success: true,
      summary,
      findings,
      metadata: {
        error_context: errorContext.slice(0, 200),
        files_examined: fileContext,
      },
    };
  } catch (error: any) {
    logger.error({ error: error.message }, 'Headless coding agent failed');
    return {
      agent_type: 'coding',
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
        error: error.message,
      },
    };
  }
}
