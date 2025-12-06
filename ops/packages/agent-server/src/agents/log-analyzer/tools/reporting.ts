/**
 * Report generation tool
 */

import { z } from 'zod';
import { tool } from 'ai';
import type { ReportOptions } from 'ops-shared/types';

/**
 * Schema for report generation tool
 */
export const generateReportSchema = z.object({
  title: z.string().describe('Report title'),
  findings: z.array(z.any()).describe('Array of findings to include in report'),
  format: z.enum(['json', 'markdown', 'html']).describe('Report format'),
  includeRecommendations: z.boolean().optional().describe('Include recommendations section'),
});

/**
 * Generate a formatted report from findings
 */
function generateReport(
  title: string,
  findings: any[],
  format: 'json' | 'markdown' | 'html',
  includeRecommendations: boolean = true
): string {
  if (format === 'json') {
    return JSON.stringify(
      {
        title,
        timestamp: new Date().toISOString(),
        findings,
        summary: `Found ${findings.length} issues`,
      },
      null,
      2
    );
  }

  if (format === 'markdown') {
    let report = `# ${title}\n\n`;
    report += `**Generated:** ${new Date().toISOString()}\n\n`;
    report += `## Summary\n\nFound ${findings.length} findings.\n\n`;
    report += `## Findings\n\n`;

    findings.forEach((finding, index) => {
      report += `### ${index + 1}. ${finding.description}\n\n`;
      report += `- **Severity:** ${finding.severity}\n`;
      report += `- **Category:** ${finding.category}\n`;
      report += `- **Count:** ${finding.count}\n\n`;
    });

    if (includeRecommendations) {
      report += `## Recommendations\n\n`;
      report += `- Review error patterns\n`;
      report += `- Check service health metrics\n`;
      report += `- Investigate root causes\n\n`;
    }

    return report;
  }

  // HTML format
  let html = `<!DOCTYPE html><html><head><title>${title}</title></head><body>`;
  html += `<h1>${title}</h1>`;
  html += `<p>Generated: ${new Date().toISOString()}</p>`;
  html += `<h2>Summary</h2><p>Found ${findings.length} findings.</p>`;
  html += `<h2>Findings</h2><ul>`;
  findings.forEach((finding) => {
    html += `<li><strong>${finding.description}</strong> (${finding.severity})</li>`;
  });
  html += `</ul></body></html>`;

  return html;
}

/**
 * Create the report generation tool for Vercel AI SDK
 */
export function createReportGenerationTool() {
  return tool({
    description:
      'Generate a formatted report from analysis findings. Use this to create structured output in JSON, Markdown, or HTML format.',
    parameters: generateReportSchema,
    execute: async ({ title, findings, format, includeRecommendations }) => {
      try {
        const report = generateReport(title, findings, format, includeRecommendations ?? true);

        return {
          success: true,
          format,
          report,
          length: report.length,
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
