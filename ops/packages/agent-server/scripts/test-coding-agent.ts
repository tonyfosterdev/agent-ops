#!/usr/bin/env tsx
/**
 * Test Harness - Coding Agent
 *
 * Run in isolation to test the headless coding agent without the full UI.
 *
 * Usage:
 *   npm run test:coding-agent
 *   # or
 *   tsx scripts/test-coding-agent.ts
 */

import 'dotenv/config';
import { runHeadlessCodingAgent } from '../src/agents/coding/headless';

async function main() {
  console.log('='.repeat(60));
  console.log('CODING AGENT - TEST HARNESS');
  console.log('='.repeat(60));
  console.log();

  // Test error context - customize as needed
  const errorContext =
    process.argv[2] ||
    `TypeError: Cannot read property 'id' of undefined
    at OrderService.createOrder (src/services/orderService.ts:45:23)
    at async POST /orders (src/routes/orderRoutes.ts:12:5)`;

  const fileContext = process.argv[3]
    ? process.argv[3].split(',')
    : ['src/services/orderService.ts'];

  console.log(`Error Context: ${errorContext.slice(0, 100)}...`);
  console.log(`File Context: ${fileContext.join(', ')}`);
  console.log('-'.repeat(60));
  console.log();

  try {
    const report = await runHeadlessCodingAgent({
      errorContext,
      fileContext,
      maxSteps: 10,
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
        console.log(`    ${finding.description.slice(0, 200)}...`);
        if (finding.recommendation) {
          console.log(`    Recommendation: ${finding.recommendation.slice(0, 200)}...`);
        }
      }
    }
  } catch (error: any) {
    console.error('ERROR:', error.message);
    process.exit(1);
  }
}

main();
