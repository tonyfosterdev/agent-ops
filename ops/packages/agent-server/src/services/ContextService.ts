import { anthropic } from '@ai-sdk/anthropic';
import { generateText } from 'ai';
import type { Journal } from '../interfaces/Journal.js';
import { AgentRun } from '../entities/AgentRun.js';
import { logger } from '../config.js';

export interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export interface ConversationContext {
  summary: string;
  recentMessages: Message[];
}

export class ContextService {
  private journal: Journal;

  constructor(journal: Journal) {
    this.journal = journal;
  }

  async buildContext(sessionId: string): Promise<ConversationContext> {
    const runs = await this.journal.getRunsForSession(sessionId);
    const completedRuns = runs.filter((r) => r.status === 'completed');

    if (completedRuns.length === 0) {
      return { summary: '', recentMessages: [] };
    }

    // Keep last 3 runs with full messages
    const recentRuns = completedRuns.slice(-3);
    const olderRuns = completedRuns.slice(0, -3);

    // Build recent messages
    const recentMessages = this.buildMessagesFromRuns(recentRuns);

    // Summarize older runs if they exist
    let summary = '';
    if (olderRuns.length > 0) {
      summary = await this.summarizeRuns(olderRuns);
    }

    return { summary, recentMessages };
  }

  private buildMessagesFromRuns(runs: AgentRun[]): Message[] {
    const messages: Message[] = [];

    for (const run of runs) {
      // Add user message (the task)
      messages.push({ role: 'user', content: run.task });

      // Build assistant message from journal entries
      const assistantContent = this.buildAssistantContent(run);
      if (assistantContent) {
        messages.push({ role: 'assistant', content: assistantContent });
      }
    }

    return messages;
  }

  private buildAssistantContent(run: AgentRun): string {
    const parts: string[] = [];

    // Sort entries by sequence number
    const sortedEntries = [...(run.entries || [])].sort(
      (a, b) => a.sequence_number - b.sequence_number
    );

    for (const entry of sortedEntries) {
      switch (entry.entry_type) {
        case 'text':
          if (entry.data.text) {
            parts.push(entry.data.text);
          }
          break;
        case 'tool:complete':
          if (entry.data.summary) {
            parts.push(`[Tool: ${entry.data.toolName}] ${entry.data.summary}`);
          }
          break;
        case 'run:complete':
          if (entry.data.message) {
            parts.push(entry.data.message);
          }
          break;
      }
    }

    return parts.join('\n');
  }

  private async summarizeRuns(runs: AgentRun[]): Promise<string> {
    const runSummaries = runs
      .map((run) => {
        const result = run.result as Record<string, any> | undefined;
        return `Run ${run.run_number}: Task: "${run.task}" - ${result?.success ? 'Succeeded' : 'Failed'}: ${result?.message || ''}`;
      })
      .join('\n');

    try {
      const { text } = await generateText({
        model: anthropic('claude-3-haiku-20240307'),
        prompt: `Summarize these previous agent runs in 2-3 sentences, focusing on what was accomplished:\n\n${runSummaries}`,
        maxTokens: 200,
      });
      return text;
    } catch (error) {
      logger.warn({ error }, 'Failed to summarize runs, using fallback');
      // Fallback to simple summary
      return `Previous runs: ${runs.length} completed tasks.`;
    }
  }
}
