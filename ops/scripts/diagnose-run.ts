#!/usr/bin/env npx tsx
/**
 * Diagnose an Inngest run by ID.
 *
 * Usage:
 *   npx tsx scripts/diagnose-run.ts <runId>
 *   npx tsx scripts/diagnose-run.ts <runId> --watch
 *   npx tsx scripts/diagnose-run.ts --latest
 *
 * Options:
 *   --watch    Poll for updates every 2 seconds
 *   --latest   Get the most recent run
 *   --logs     Also show agent-server logs (requires docker)
 */

const INNGEST_URL = process.env.INNGEST_URL || 'http://localhost:8288';

interface RunData {
  run_id: string;
  run_started_at: string;
  function_id: string;
  status: string;
  ended_at?: string;
  output?: unknown;
}

interface EventData {
  id: string;
  name: string;
  data: Record<string, unknown>;
  ts: number;
}

async function fetchRun(runId: string): Promise<RunData | null> {
  try {
    const res = await fetch(`${INNGEST_URL}/v1/runs/${runId}`);
    if (!res.ok) return null;
    const json = await res.json();
    return json.data;
  } catch (e) {
    console.error('Failed to fetch run:', e);
    return null;
  }
}

async function fetchLatestRuns(limit = 10): Promise<RunData[]> {
  try {
    // Inngest dev server doesn't have /v1/runs list endpoint
    // Instead, get recent events and find agent/chat events
    const res = await fetch(`${INNGEST_URL}/v1/events?limit=${limit * 2}`);
    if (!res.ok) return [];
    const json = await res.json();

    // Filter for agent/chat events
    const agentEvents = (json.data as EventData[])
      .filter((e: EventData) => e.name === 'agent/chat')
      .slice(0, limit);

    // For each event, try to get run info
    const runs: RunData[] = [];
    for (const event of agentEvents) {
      // Event ID often matches or is close to run ID in dev mode
      const runRes = await fetch(`${INNGEST_URL}/v1/runs/${event.id}`);
      if (runRes.ok) {
        const runJson = await runRes.json();
        runs.push(runJson.data);
      }
    }

    return runs;
  } catch (e) {
    console.error('Failed to fetch runs:', e);
    return [];
  }
}

async function fetchRecentEvents(limit = 20): Promise<EventData[]> {
  try {
    const res = await fetch(`${INNGEST_URL}/v1/events?limit=${limit}`);
    if (!res.ok) return [];
    const json = await res.json();
    return json.data;
  } catch (e) {
    return [];
  }
}

async function getAgentServerLogs(lines = 50): Promise<string> {
  try {
    const { execSync } = await import('child_process');
    return execSync(`docker logs agent-server 2>&1 | tail -${lines}`, { encoding: 'utf-8' });
  } catch {
    return '(Could not fetch docker logs)';
  }
}

function formatDuration(start: string, end?: string): string {
  const startTime = new Date(start).getTime();
  const endTime = end ? new Date(end).getTime() : Date.now();
  const duration = endTime - startTime;

  if (duration < 1000) return `${duration}ms`;
  if (duration < 60000) return `${(duration / 1000).toFixed(1)}s`;
  return `${(duration / 60000).toFixed(1)}m`;
}

function formatStatus(status: string): string {
  const colors: Record<string, string> = {
    'Running': '\x1b[33m⏳ Running\x1b[0m',
    'Completed': '\x1b[32m✅ Completed\x1b[0m',
    'Failed': '\x1b[31m❌ Failed\x1b[0m',
    'Cancelled': '\x1b[35m🚫 Cancelled\x1b[0m',
  };
  return colors[status] || status;
}

async function diagnoseRun(runId: string, options: { watch?: boolean; logs?: boolean }) {
  console.log(`\n🔍 Diagnosing run: ${runId}\n`);

  const printStatus = async () => {
    const run = await fetchRun(runId);

    if (!run) {
      console.log('❌ Run not found. Check the run ID or ensure Inngest dev server is running.');
      return false;
    }

    console.clear();
    console.log('═'.repeat(70));
    console.log(`  Run ID: ${run.run_id}`);
    console.log(`  Status: ${formatStatus(run.status)}`);
    console.log(`  Started: ${new Date(run.run_started_at).toLocaleString()}`);
    console.log(`  Duration: ${formatDuration(run.run_started_at, run.ended_at)}`);
    if (run.ended_at) {
      console.log(`  Ended: ${new Date(run.ended_at).toLocaleString()}`);
    }
    console.log('═'.repeat(70));

    if (run.output && Object.keys(run.output as object).length > 0) {
      console.log('\n📤 Output:');
      console.log(JSON.stringify(run.output, null, 2));
    }

    if (options.logs) {
      console.log('\n📋 Recent Agent Server Logs:');
      console.log('─'.repeat(70));
      const logs = await getAgentServerLogs(30);
      // Filter for relevant lines
      const relevantLogs = logs.split('\n')
        .filter(line =>
          line.includes('[router]') ||
          line.includes('[agent-chat]') ||
          line.includes('tool') ||
          line.includes('error') ||
          line.includes('Error')
        )
        .slice(-20)
        .join('\n');
      console.log(relevantLogs || '(No relevant logs found)');
    }

    return run.status === 'Running';
  };

  const isRunning = await printStatus();

  if (options.watch && isRunning) {
    console.log('\n👀 Watching for updates (Ctrl+C to stop)...\n');
    const interval = setInterval(async () => {
      const stillRunning = await printStatus();
      if (!stillRunning) {
        clearInterval(interval);
        console.log('\n✋ Run finished, stopping watch.');
      }
    }, 2000);
  }
}

async function listRecentRuns() {
  console.log('\n📋 Recent Events:\n');

  const events = await fetchRecentEvents(15);
  const agentEvents = events.filter(e => e.name === 'agent/chat');

  if (agentEvents.length === 0) {
    console.log('No agent/chat events found.');
    return;
  }

  console.log('─'.repeat(90));
  console.log(`${'Event ID'.padEnd(30)} ${'Message'.padEnd(40)} ${'Time'.padEnd(20)}`);
  console.log('─'.repeat(90));

  for (const event of agentEvents) {
    const message = (event.data.message as string || '').slice(0, 38);
    const time = new Date(event.ts).toLocaleTimeString();
    console.log(`${event.id.padEnd(30)} ${message.padEnd(40)} ${time}`);
  }

  console.log('─'.repeat(90));
  console.log('\nTo diagnose a run: npx tsx scripts/diagnose-run.ts <event-id>');
}

async function analyzeRouterLogs() {
  console.log('\n🔬 Analyzing Router Behavior:\n');

  const logs = await getAgentServerLogs(200);
  const lines = logs.split('\n');

  const routerLines = lines.filter(l => l.includes('[router]'));

  // Count patterns
  const patterns: Record<string, number> = {};
  for (const line of routerLines) {
    if (line.includes('Sticky:')) patterns['Sticky behavior'] = (patterns['Sticky behavior'] || 0) + 1;
    if (line.includes('Task complete')) patterns['Task complete'] = (patterns['Task complete'] || 0) + 1;
    if (line.includes('Classifying intent')) patterns['LLM classification'] = (patterns['LLM classification'] || 0) + 1;
    if (line.includes('User confirmed')) patterns['User confirmed handoff'] = (patterns['User confirmed handoff'] || 0) + 1;
    if (line.includes('Low confidence')) patterns['Low confidence (clarification)'] = (patterns['Low confidence (clarification)'] || 0) + 1;
  }

  console.log('Router Decision Counts (last 200 log lines):');
  console.log('─'.repeat(50));
  for (const [pattern, count] of Object.entries(patterns).sort((a, b) => b[1] - a[1])) {
    const bar = '█'.repeat(Math.min(count, 30));
    console.log(`${pattern.padEnd(30)} ${String(count).padStart(4)} ${bar}`);
  }

  // Check for looping
  const stickyCount = patterns['Sticky behavior'] || 0;
  const completeCount = patterns['Task complete'] || 0;

  if (stickyCount > 20 && completeCount === 0) {
    console.log('\n⚠️  POTENTIAL ISSUE DETECTED:');
    console.log('   High sticky count with no task completions.');
    console.log('   The agent may not be calling complete_task when done.');
    console.log('\n   Possible causes:');
    console.log('   1. Agent prompt doesn\'t instruct to call complete_task');
    console.log('   2. Agent is waiting for user input but not completing');
    console.log('   3. Tool errors preventing completion');
  }
}

// Main
const args = process.argv.slice(2);
const watch = args.includes('--watch');
const showLogs = args.includes('--logs');
const latest = args.includes('--latest');
const analyze = args.includes('--analyze');

const runId = args.find(a => !a.startsWith('--'));

if (analyze || (!runId && !latest)) {
  await analyzeRouterLogs();
  await listRecentRuns();
} else if (latest) {
  await listRecentRuns();
} else if (runId) {
  await diagnoseRun(runId, { watch, logs: showLogs });
}
