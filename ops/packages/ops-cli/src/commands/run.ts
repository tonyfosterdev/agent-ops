import chalk from 'chalk';
import { AgentClient } from '../api/client.js';

interface RunOptions {
  agent: 'coding' | 'log-analyzer' | 'orchestration';
  maxSteps: string;
  sessionId?: string;
}

interface JournalEvent {
  type: 'entry' | 'complete';
  entry?: {
    entry_type: string;
    data: Record<string, any>;
    step_number?: number;
  };
  run?: {
    id: string;
    status: string;
    result?: Record<string, any>;
  };
}

export async function runCommand(task: string, options: RunOptions) {
  try {
    const client = new AgentClient();

    // Set session ID if provided
    if (options.sessionId) {
      client.setSessionId(options.sessionId);
    }

    // Health check first
    console.log(chalk.gray('Checking server connection...'));
    const healthy = await client.healthCheck();

    if (!healthy) {
      console.error(chalk.red('❌ Agent server is unreachable.'));
      console.error(chalk.gray('Please ensure the server is running at the configured URL.'));
      process.exit(1);
    }

    console.log(chalk.cyan('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
    console.log(chalk.cyan(`Agent: ${options.agent}`));
    console.log(chalk.cyan(`Task: ${task}`));
    if (options.sessionId) {
      console.log(chalk.cyan(`Session: ${options.sessionId}`));
    }
    console.log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));

    // Subscribe to journal events
    client.on('event', (event: JournalEvent) => {
      if (event.type === 'entry' && event.entry) {
        const entry = event.entry;

        switch (entry.entry_type) {
          case 'text':
            if (entry.data.text) {
              console.log(entry.data.text);
            }
            break;

          case 'tool:complete':
            const icon = entry.data.success ? chalk.green('✓') : chalk.red('✗');
            console.log(`${icon} ${entry.data.summary || entry.data.toolName}`);
            break;

          case 'run:complete':
            console.log(chalk.green('\n✓ Complete\n'));
            break;

          case 'run:error':
            console.error(chalk.red(`\n❌ Error: ${entry.data.error}\n`));
            break;
        }
      }
    });

    // Run agent
    await client.runAgent(options.agent, task, { maxSteps: parseInt(options.maxSteps) });

    // Show session ID after completion
    const finalSessionId = client.getSessionId();
    if (finalSessionId) {
      console.log(chalk.gray(`Session: ${finalSessionId}`));
    }
  } catch (error: any) {
    console.error(chalk.red(`\n❌ Error: ${error.message}\n`));
    process.exit(1);
  }
}
