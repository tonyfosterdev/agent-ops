import chalk from 'chalk';
import { AgentClient } from '../api/client.js';

interface RunOptions {
  agent: 'coding' | 'log-analyzer' | 'orchestration';
  maxSteps: string;
}

export async function runCommand(task: string, options: RunOptions) {
  try {
    const client = new AgentClient();

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
    console.log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));

    // Subscribe to events
    client.on('event', (event) => {
      switch (event.type) {
        case 'step:text_complete':
          console.log(event.text);
          break;

        case 'step:tool_call_complete':
          const icon = event.success ? chalk.green('✓') : chalk.red('✗');
          console.log(`${icon} ${event.summary || event.toolName}`);
          break;

        case 'agent:complete':
          console.log(chalk.green('\n✓ Complete\n'));
          break;

        case 'agent:error':
          console.error(chalk.red(`\n❌ Error: ${event.error}\n`));
          break;
      }
    });

    // Run agent
    await client.runAgent(
      options.agent,
      task,
      { maxSteps: parseInt(options.maxSteps) }
    );
  } catch (error: any) {
    console.error(chalk.red(`\n❌ Error: ${error.message}\n`));
    process.exit(1);
  }
}
