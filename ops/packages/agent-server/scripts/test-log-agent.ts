#!/usr/bin/env tsx
/**
 * Test Harness - Log Analyzer Agent
 *
 * Run in isolation to test the headless log analyzer without the full UI.
 *
 * Usage:
 *   npm run test:log-agent
 *   # or
 *   tsx scripts/test-log-agent.ts
 */

import 'dotenv/config';
import { runHeadlessLogAnalyzer } from '../src/agents/log-analyzer/headless';

async function main() {
  console.log('='.repeat(60));
  console.log('LOG ANALYZER AGENT - TEST HARNESS');
  console.log('='.repeat(60));
  console.log();

  // Test prompt - customize as needed
  const prompt = process.argv[2] || 'Check warehouse-alpha for errors in the last hour';

  console.log(`Prompt: ${prompt}`);
  console.log(`Max Queries: 3`);
  console.log('-'.repeat(60));
  console.log();

  try {
    const report = await runHeadlessLogAnalyzer({
      prompt,
      maxQueries: 3,
    });

    console.log('='.repeat(60));
    console.log('AGENT REPORT');
    console.log('='.repeat(60));
    console.log();
    console.log(JSON.stringify(report, null, 2));
    console.log();
    console.log('='.repeat(60));

    // Summary
    console.log(`Success: ${report.success}`);
    console.log(`Summary: ${report.summary}`);
    console.log(`Findings: ${report.findings.length}`);

    if (report.findings.length > 0) {
      console.log();
      console.log('Findings:');
      for (const finding of report.findings) {
        console.log(`  [${finding.severity.toUpperCase()}] ${finding.title}`);
        console.log(`    ${finding.description}`);
        if (finding.evidence) {
          console.log(`    Evidence: "${finding.evidence}"`);
        }
        if (finding.recommendation) {
          console.log(`    Recommendation: ${finding.recommendation}`);
        }
      }
    }
  } catch (error: any) {
    console.error('ERROR:', error.message);
    process.exit(1);
  }
}

main();
