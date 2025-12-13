#!/usr/bin/env node

import { Command } from 'commander';
import { runCommand } from './commands/run.js';
import { interactiveCommand } from './commands/interactive.js';

const program = new Command();

program
  .name('ops')
  .description('AgentOps CLI - Connect to agent server and run autonomous agents')
  .version('1.0.0');

// Interactive mode (default)
program
  .command('interactive', { isDefault: true })
  .description('Start interactive menu to select and run agents')
  .action(interactiveCommand);

// Direct run command
program
  .command('run <task>')
  .description('Run an agent task directly')
  .option('-a, --agent <type>', 'Agent type (coding|log-analyzer|orchestration)', 'orchestration')
  .option('-s, --max-steps <number>', 'Maximum steps', '10')
  .option('--session-id <id>', 'Continue existing session')
  .action(runCommand);

program.parse();
