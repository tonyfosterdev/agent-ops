/**
 * Context Building Tests
 *
 * Tests for conversation context building from session history.
 */

import { TestDataSource } from './setup.js';
import { JournalService } from '../services/JournalService.js';
import { ContextService } from '../services/ContextService.js';
import { SessionService } from '../services/SessionService.js';
import { JournalOutputSink } from '../sinks/JournalOutputSink.js';

describe('Context Building', () => {
  let journalService: JournalService;
  let contextService: ContextService;
  let sessionService: SessionService;

  beforeEach(() => {
    // Create fresh service instances for each test
    journalService = new JournalService();
    contextService = new ContextService(journalService);
    sessionService = new SessionService();
  });

  /**
   * Helper to create a completed run with entries
   */
  async function createCompletedRun(
    sessionId: string,
    task: string,
    textContent: string,
    toolSummary?: string
  ): Promise<string> {
    const runId = await journalService.createRun(sessionId, 'mock', task);
    const sink = new JournalOutputSink(runId, journalService);

    await sink.writeRunStarted({ task, maxSteps: 10, agentType: 'mock' });
    await sink.writeText(textContent, 1);

    if (toolSummary) {
      await sink.writeToolStarting('mockTool', 'call-1', { input: 'test' }, 1);
      await sink.writeToolComplete(
        'mockTool',
        'call-1',
        { result: 'done' },
        true,
        toolSummary,
        1
      );
    }

    await sink.writeStepComplete(1);
    await sink.writeRunComplete({ success: true, message: 'Done', steps: 1 });

    return runId;
  }

  /**
   * Helper to create a failed run
   */
  async function createFailedRun(sessionId: string, task: string): Promise<string> {
    const runId = await journalService.createRun(sessionId, 'mock', task);
    const sink = new JournalOutputSink(runId, journalService);

    await sink.writeRunStarted({ task, maxSteps: 10, agentType: 'mock' });
    await sink.writeText('Starting...', 1);
    await sink.writeRunError('Simulated failure');

    return runId;
  }

  it('builds empty context for new session', async () => {
    const sessionId = await sessionService.createSession('mock');

    const context = await contextService.buildContext(sessionId);

    expect(context.summary).toBe('');
    expect(context.recentMessages).toEqual([]);
  });

  it('includes previous run messages in context', async () => {
    const sessionId = await sessionService.createSession('mock');

    await createCompletedRun(sessionId, 'First task', 'First response text');

    const context = await contextService.buildContext(sessionId);

    expect(context.recentMessages.length).toBe(2); // user + assistant
    expect(context.recentMessages[0]).toEqual({
      role: 'user',
      content: 'First task',
    });
    expect(context.recentMessages[1].role).toBe('assistant');
    expect(context.recentMessages[1].content).toContain('First response text');
  });

  it('keeps last 3 runs as full messages', async () => {
    const sessionId = await sessionService.createSession('mock');

    // Create 3 completed runs (no summarization needed)
    await createCompletedRun(sessionId, 'Task 1', 'Response 1');
    await createCompletedRun(sessionId, 'Task 2', 'Response 2');
    await createCompletedRun(sessionId, 'Task 3', 'Response 3');

    const context = await contextService.buildContext(sessionId);

    // Should have 6 recent messages (3 runs * 2 messages each)
    expect(context.recentMessages.length).toBe(6);

    // All three runs should be in recent messages
    const userMessages = context.recentMessages.filter((m) => m.role === 'user');
    expect(userMessages.map((m) => m.content)).toEqual(['Task 1', 'Task 2', 'Task 3']);

    // No summary needed for 3 runs
    expect(context.summary).toBe('');
  });

  // Skipping summarization test as it requires Claude API
  it.skip('summarizes older runs (requires Claude API)', async () => {
    // This test would create 4+ runs to trigger summarization
    // Skipped in automated tests to avoid API calls
  });

  it('excludes failed runs from context', async () => {
    const sessionId = await sessionService.createSession('mock');

    await createCompletedRun(sessionId, 'Successful task', 'Success response');
    await createFailedRun(sessionId, 'Failed task');

    const context = await contextService.buildContext(sessionId);

    // Should only have messages from the successful run
    expect(context.recentMessages.length).toBe(2);
    expect(context.recentMessages[0].content).toBe('Successful task');
  });

  it('includes only text, tool:complete summary, and run:complete in assistant message', async () => {
    const sessionId = await sessionService.createSession('mock');

    await createCompletedRun(
      sessionId,
      'Task with tool',
      'Agent text output',
      'Tool result summary'
    );

    const context = await contextService.buildContext(sessionId);

    const assistantMessage = context.recentMessages.find((m) => m.role === 'assistant');
    expect(assistantMessage).toBeDefined();

    // Should contain text output
    expect(assistantMessage?.content).toContain('Agent text output');

    // Should contain tool summary in formatted form
    expect(assistantMessage?.content).toContain('[Tool: mockTool]');
    expect(assistantMessage?.content).toContain('Tool result summary');
  });

  it('excludes thinking entries from context', async () => {
    const sessionId = await sessionService.createSession('mock');

    // Create run with thinking entry
    const runId = await journalService.createRun(sessionId, 'mock', 'Task');
    const sink = new JournalOutputSink(runId, journalService);

    await sink.writeRunStarted({ task: 'Task', maxSteps: 10, agentType: 'mock' });
    await sink.writeThinking(1000); // Write thinking entry
    await sink.writeText('Final response', 1);
    await sink.writeStepComplete(1);
    await sink.writeRunComplete({ success: true, message: 'Done', steps: 1 });

    const context = await contextService.buildContext(sessionId);

    const assistantMessage = context.recentMessages.find((m) => m.role === 'assistant');

    // Should contain text but NOT any thinking indicators
    expect(assistantMessage?.content).toContain('Final response');
    expect(assistantMessage?.content).not.toContain('thinking');
    expect(assistantMessage?.content).not.toContain('1000');
  });

  it('excludes running runs from context', async () => {
    const sessionId = await sessionService.createSession('mock');

    // Create a completed run
    await createCompletedRun(sessionId, 'Completed task', 'Completed response');

    // Create a running run (don't complete it)
    const runId = await journalService.createRun(sessionId, 'mock', 'Running task');
    const sink = new JournalOutputSink(runId, journalService);
    await sink.writeRunStarted({ task: 'Running task', maxSteps: 10, agentType: 'mock' });
    // Don't call writeRunComplete

    const context = await contextService.buildContext(sessionId);

    // Should only have the completed run
    expect(context.recentMessages.length).toBe(2);
    expect(context.recentMessages[0].content).toBe('Completed task');
  });

  it('handles multiple runs with context growing', async () => {
    const sessionId = await sessionService.createSession('mock');

    // First run - no context
    const context1 = await contextService.buildContext(sessionId);
    expect(context1.recentMessages.length).toBe(0);

    // Create first run
    await createCompletedRun(sessionId, 'Task 1', 'Response 1');

    // Second run - should see first run
    const context2 = await contextService.buildContext(sessionId);
    expect(context2.recentMessages.length).toBe(2);
    expect(context2.recentMessages[0].content).toBe('Task 1');

    // Create second run
    await createCompletedRun(sessionId, 'Task 2', 'Response 2');

    // Third run - should see both previous runs
    const context3 = await contextService.buildContext(sessionId);
    expect(context3.recentMessages.length).toBe(4);
  });
});
