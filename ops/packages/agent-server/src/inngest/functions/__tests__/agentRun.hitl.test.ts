/**
 * HITL (Human-in-the-Loop) Integration Tests for Agent Run Function
 *
 * These tests verify the HITL suspension and resume behavior for dangerous tools.
 * They mock the Inngest step functions and journalService to test the flow
 * without requiring actual database or LLM connections.
 */

import type { JournalEntry } from '../../../entities/JournalEntry';
import type { Run } from '../../../entities/Run';

// Mock the config first (before importing the module under test)
jest.mock('../../../config', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
  config: {
    workDir: '/tmp/test-workdir',
    lokiUrl: 'http://localhost:3100',
  },
}));

// Mock the AI SDK
jest.mock('ai', () => ({
  generateText: jest.fn(),
}));

jest.mock('@ai-sdk/anthropic', () => ({
  anthropic: jest.fn(() => 'mock-model'),
}));

// Mock the Inngest client
jest.mock('../../client', () => ({
  inngest: {
    createFunction: jest.fn((config, trigger, handler) => {
      // Store the handler for testing
      (global as any).__agentRunHandler = handler;
      return { config, trigger, handler };
    }),
  },
}));

// Mock journal service
const mockJournalService = {
  getRun: jest.fn(),
  getEvents: jest.fn(),
  appendEventIdempotent: jest.fn(),
  updateStatus: jest.fn(),
  incrementStep: jest.fn(),
};

jest.mock('../../../services/JournalService', () => ({
  journalService: mockJournalService,
}));

// Mock agent definitions
jest.mock('../../../agents/definitions', () => ({
  loadAgentDefinition: jest.fn(() => ({
    getSystemPrompt: () => 'You are a helpful agent.',
    getTools: () => ({
      shell_command_execute: {
        description: 'Execute a shell command',
        parameters: { type: 'object', properties: { command: { type: 'string' } } },
        execute: jest.fn().mockResolvedValue({ stdout: 'command output' }),
      },
      read_file: {
        description: 'Read a file',
        parameters: { type: 'object', properties: { path: { type: 'string' } } },
        execute: jest.fn().mockResolvedValue('file contents'),
      },
    }),
  })),
}));

// Import after mocks are set up
import { generateText } from 'ai';

describe('Agent Run HITL Integration Tests', () => {
  // Step function mocks
  let stepRunMock: jest.Mock;
  let stepWaitForEventMock: jest.Mock;

  // Test data
  const testRunId = 'test-run-123';
  const testUserId = 'test-user-456';
  const testPrompt = 'Run a shell command to list files';

  const mockRun: Partial<Run> = {
    id: testRunId,
    prompt: testPrompt,
    user_id: testUserId,
    agent_type: 'orchestrator',
    status: 'running',
    current_step: 0,
  };

  const mockEvent = {
    data: {
      runId: testRunId,
      prompt: testPrompt,
      userId: testUserId,
      agentType: 'orchestrator',
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();

    // Set up step function mocks
    stepRunMock = jest.fn();
    stepWaitForEventMock = jest.fn();

    // Default mock implementations
    mockJournalService.getRun.mockResolvedValue(mockRun);
    mockJournalService.getEvents.mockResolvedValue([]);
    mockJournalService.appendEventIdempotent.mockResolvedValue({
      id: 'entry-1',
      sequence: 0,
      event_type: 'RUN_STARTED',
      payload: {},
    } as JournalEntry);
    mockJournalService.updateStatus.mockResolvedValue(undefined);
    mockJournalService.incrementStep.mockResolvedValue(undefined);
  });

  /**
   * Helper to create a mock step context for testing
   */
  function createMockStepContext() {
    return {
      run: stepRunMock.mockImplementation(async (name: string, fn: () => Promise<any>) => {
        return fn();
      }),
      waitForEvent: stepWaitForEventMock,
    };
  }

  describe('HITL Suspension on Dangerous Tool', () => {
    it('should suspend run when dangerous tool is proposed', async () => {
      // Set up LLM to return a dangerous tool call
      (generateText as jest.Mock).mockResolvedValueOnce({
        text: 'I will execute the shell command.',
        toolCalls: [
          {
            toolName: 'shell_command_execute',
            toolCallId: 'call-1',
            args: { command: 'ls -la' },
          },
        ],
        finishReason: 'tool-calls',
      });

      const step = createMockStepContext();

      // Import the function to get the handler
      require('../agentRun');
      const handler = (global as any).__agentRunHandler;

      // The handler should be defined
      expect(handler).toBeDefined();

      // Execute the init step
      let stepResultFromExecute: any;
      stepRunMock.mockImplementation(async (name: string, fn: () => Promise<any>) => {
        const result = await fn();
        if (name.startsWith('execute-step-')) {
          stepResultFromExecute = result;
        }
        return result;
      });

      // Mock waitForEvent to simulate pending approval
      stepWaitForEventMock.mockResolvedValue({
        data: { decision: 'approved', feedback: '' },
      });

      // Run the handler (will go through init and first execute step)
      await handler({ event: mockEvent, step });

      // Verify the run was suspended
      expect(mockJournalService.appendEventIdempotent).toHaveBeenCalledWith(
        testRunId,
        expect.objectContaining({
          type: 'RUN_SUSPENDED',
          payload: expect.objectContaining({
            reason: expect.stringContaining('shell_command_execute'),
          }),
        }),
        expect.any(String)
      );

      expect(mockJournalService.updateStatus).toHaveBeenCalledWith(testRunId, 'suspended');
    });
  });

  describe('Resume with Approval', () => {
    it('should execute dangerous tool after approval', async () => {
      // Set up LLM to return a dangerous tool call on first step
      (generateText as jest.Mock)
        .mockResolvedValueOnce({
          text: 'I will execute the shell command.',
          toolCalls: [
            {
              toolName: 'shell_command_execute',
              toolCallId: 'call-1',
              args: { command: 'ls -la' },
            },
          ],
          finishReason: 'tool-calls',
        })
        // After approval, LLM completes
        .mockResolvedValueOnce({
          text: 'The command was executed successfully.',
          toolCalls: [],
          finishReason: 'stop',
        });

      // Set up events - return pending tool when process-approval checks
      mockJournalService.getEvents.mockImplementation(async () => {
        // Return the pending tool so the approval handler can find it
        return [
          {
            event_type: 'TOOL_PROPOSED',
            payload: {
              tool_name: 'shell_command_execute',
              args: { command: 'ls -la' },
              call_id: 'call-1',
            },
          },
        ];
      });

      const step = createMockStepContext();

      // Mock waitForEvent to return approval
      stepWaitForEventMock.mockResolvedValue({
        data: { decision: 'approved', feedback: 'Looks good' },
      });

      // Track appendEventIdempotent calls to inspect later
      const appendCalls: any[] = [];
      mockJournalService.appendEventIdempotent.mockImplementation(
        async (runId: string, event: any, key: string) => {
          appendCalls.push({ runId, event, key });
          return { id: 'entry', sequence: appendCalls.length } as JournalEntry;
        }
      );

      require('../agentRun');
      const handler = (global as any).__agentRunHandler;

      await handler({ event: mockEvent, step });

      // Verify RUN_RESUMED was recorded with approval
      const resumedEvent = appendCalls.find((c) => c.event.type === 'RUN_RESUMED');
      expect(resumedEvent).toBeDefined();
      expect(resumedEvent.event.payload.decision).toBe('approved');

      // Verify TOOL_RESULT was recorded after execution (from process-approval step)
      const toolResultEvents = appendCalls.filter((c) => c.event.type === 'TOOL_RESULT');
      expect(toolResultEvents.length).toBeGreaterThan(0);

      const successResult = toolResultEvents.find(
        (c) => c.event.payload.call_id === 'call-1' && c.event.payload.status === 'success'
      );
      expect(successResult).toBeDefined();

      // Verify status was set back to running
      expect(mockJournalService.updateStatus).toHaveBeenCalledWith(testRunId, 'running');
    });
  });

  describe('Resume with Rejection', () => {
    it('should record rejection feedback and continue loop', async () => {
      // Set up LLM to return a dangerous tool call on first step
      (generateText as jest.Mock)
        .mockResolvedValueOnce({
          text: 'I will execute the shell command.',
          toolCalls: [
            {
              toolName: 'shell_command_execute',
              toolCallId: 'call-1',
              args: { command: 'rm -rf /' },
            },
          ],
          finishReason: 'tool-calls',
        })
        // After rejection, LLM responds appropriately
        .mockResolvedValueOnce({
          text: 'I understand. The command was rejected because it is dangerous.',
          toolCalls: [],
          finishReason: 'stop',
        });

      const step = createMockStepContext();

      // Mock waitForEvent to return rejection
      stepWaitForEventMock.mockResolvedValue({
        data: {
          decision: 'rejected',
          feedback: 'This command is too dangerous to execute.',
        },
      });

      require('../agentRun');
      const handler = (global as any).__agentRunHandler;

      await handler({ event: mockEvent, step });

      // Verify RUN_RESUMED was recorded with rejection
      expect(mockJournalService.appendEventIdempotent).toHaveBeenCalledWith(
        testRunId,
        expect.objectContaining({
          type: 'RUN_RESUMED',
          payload: expect.objectContaining({
            decision: 'rejected',
            feedback: 'This command is too dangerous to execute.',
          }),
        }),
        expect.any(String)
      );

      // Verify status was set back to running (loop continues)
      expect(mockJournalService.updateStatus).toHaveBeenCalledWith(testRunId, 'running');
    });
  });

  describe('HITL Timeout Behavior', () => {
    it('should fail run after timeout waiting for approval', async () => {
      // Set up LLM to return a dangerous tool call
      (generateText as jest.Mock).mockResolvedValueOnce({
        text: 'I will execute the shell command.',
        toolCalls: [
          {
            toolName: 'shell_command_execute',
            toolCallId: 'call-1',
            args: { command: 'ls -la' },
          },
        ],
        finishReason: 'tool-calls',
      });

      const step = createMockStepContext();

      // Mock waitForEvent to return null (timeout)
      stepWaitForEventMock.mockResolvedValue(null);

      require('../agentRun');
      const handler = (global as any).__agentRunHandler;

      await handler({ event: mockEvent, step });

      // Verify SYSTEM_ERROR was recorded with timeout message
      expect(mockJournalService.appendEventIdempotent).toHaveBeenCalledWith(
        testRunId,
        expect.objectContaining({
          type: 'SYSTEM_ERROR',
          payload: expect.objectContaining({
            error_details: expect.stringContaining('timeout'),
          }),
        }),
        expect.any(String)
      );

      // Verify run was marked as failed
      expect(mockJournalService.updateStatus).toHaveBeenCalledWith(testRunId, 'failed');
    });
  });

  describe('Multiple Dangerous Tools Handling', () => {
    it('should only queue first dangerous tool and skip others', async () => {
      // Set up LLM to return multiple dangerous tool calls
      (generateText as jest.Mock)
        .mockResolvedValueOnce({
          text: 'I will execute multiple commands.',
          toolCalls: [
            {
              toolName: 'shell_command_execute',
              toolCallId: 'call-1',
              args: { command: 'ls -la' },
            },
            {
              toolName: 'write_file',
              toolCallId: 'call-2',
              args: { path: '/tmp/test.txt', content: 'hello' },
            },
            {
              toolName: 'shell_command_execute',
              toolCallId: 'call-3',
              args: { command: 'pwd' },
            },
          ],
          finishReason: 'tool-calls',
        })
        // After approval and second step
        .mockResolvedValueOnce({
          text: 'First command completed. Continuing with the rest.',
          toolCalls: [],
          finishReason: 'stop',
        });

      const step = createMockStepContext();

      // Mock waitForEvent to return approval
      stepWaitForEventMock.mockResolvedValue({
        data: { decision: 'approved', feedback: '' },
      });

      // Track all appendEventIdempotent calls
      const appendCalls: any[] = [];
      mockJournalService.appendEventIdempotent.mockImplementation(
        async (runId: string, event: any, key: string) => {
          appendCalls.push({ runId, event, key });
          return { id: 'entry', sequence: appendCalls.length } as JournalEntry;
        }
      );

      mockJournalService.getEvents.mockResolvedValue([
        {
          event_type: 'TOOL_PROPOSED',
          payload: {
            tool_name: 'shell_command_execute',
            args: { command: 'ls -la' },
            call_id: 'call-1',
          },
        },
      ]);

      require('../agentRun');
      const handler = (global as any).__agentRunHandler;

      await handler({ event: mockEvent, step });

      // Verify skipped TOOL_RESULT events for non-first dangerous tools
      const skippedResults = appendCalls.filter(
        (call) =>
          call.event.type === 'TOOL_RESULT' &&
          call.event.payload.status === 'skipped'
      );

      expect(skippedResults.length).toBe(2); // call-2 and call-3 should be skipped

      // Verify the skipped tools have appropriate error messages
      for (const skipped of skippedResults) {
        expect(skipped.event.payload.output_data.error).toContain(
          'only one dangerous tool can be approved at a time'
        );
      }

      // Verify only the first dangerous tool was suspended for approval
      const suspendedEvents = appendCalls.filter(
        (call) => call.event.type === 'RUN_SUSPENDED'
      );
      expect(suspendedEvents.length).toBe(1);
      expect(suspendedEvents[0].event.payload.reason).toContain('shell_command_execute');
    });
  });

  describe('Safe Tool Execution', () => {
    it('should execute safe tools immediately without HITL', async () => {
      // Set up LLM to return a safe tool call
      (generateText as jest.Mock)
        .mockResolvedValueOnce({
          text: 'I will read the file.',
          toolCalls: [
            {
              toolName: 'read_file',
              toolCallId: 'call-1',
              args: { path: '/tmp/test.txt' },
            },
          ],
          finishReason: 'tool-calls',
        })
        .mockResolvedValueOnce({
          text: 'The file contents are: hello world',
          toolCalls: [],
          finishReason: 'stop',
        });

      const step = createMockStepContext();

      require('../agentRun');
      const handler = (global as any).__agentRunHandler;

      await handler({ event: mockEvent, step });

      // Verify waitForEvent was NOT called (no HITL needed)
      expect(stepWaitForEventMock).not.toHaveBeenCalled();

      // Verify TOOL_RESULT was recorded immediately
      expect(mockJournalService.appendEventIdempotent).toHaveBeenCalledWith(
        testRunId,
        expect.objectContaining({
          type: 'TOOL_RESULT',
          payload: expect.objectContaining({
            call_id: 'call-1',
            status: 'success',
          }),
        }),
        expect.any(String)
      );

      // Verify run completed
      expect(mockJournalService.appendEventIdempotent).toHaveBeenCalledWith(
        testRunId,
        expect.objectContaining({
          type: 'RUN_COMPLETED',
        }),
        expect.any(String)
      );
    });
  });
});
