import React, { useEffect, useRef, useState } from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import { AgentClient } from '../api/client.js';

interface OutputItem {
  type: 'task' | 'text' | 'text_chunk' | 'tool' | 'tool_starting' | 'thinking' | 'complete' | 'error';
  content: string;
  success?: boolean;
}

interface Props {
  task: string;
  sessionId?: string | null;
  onOutput: (item: OutputItem) => void;
  onComplete: (sessionId: string | null) => void;
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

export function AgentRunner({ task, sessionId, onOutput, onComplete }: Props) {
  const hasStarted = useRef(false);
  const [thinkingTime, setThinkingTime] = useState(0);

  useEffect(() => {
    // Prevent double execution
    if (hasStarted.current) return;
    hasStarted.current = true;

    const client = new AgentClient();

    // Set session ID if provided
    if (sessionId) {
      client.setSessionId(sessionId);
    }

    // Health check first
    client.healthCheck().then((healthy) => {
      if (!healthy) {
        onOutput({ type: 'error', content: 'Agent server is unreachable. Please ensure it is running.' });
        onComplete(null);
        return;
      }

      // Subscribe to journal events
      client.on('event', (event: JournalEvent) => {
        if (event.type === 'entry' && event.entry) {
          const entry = event.entry;

          switch (entry.entry_type) {
            case 'thinking':
              // Update thinking time indicator
              setThinkingTime(entry.data.elapsed_ms || 0);
              break;

            case 'text':
              // Text output from agent
              if (entry.data.text) {
                onOutput({ type: 'text', content: entry.data.text });
              }
              break;

            case 'tool:starting':
              // Tool is starting
              onOutput({
                type: 'tool_starting',
                content: entry.data.toolName,
              });
              break;

            case 'tool:complete':
              // Tool execution completed
              onOutput({
                type: 'tool',
                content: entry.data.summary || entry.data.toolName,
                success: entry.data.success,
              });
              break;

            case 'run:complete':
              // Run completed successfully
              onOutput({ type: 'complete', content: '' });
              break;

            case 'run:error':
              // Run failed with error
              onOutput({ type: 'error', content: entry.data.error || 'Unknown error' });
              break;

            case 'step:complete':
              // Step completed, reset thinking time
              setThinkingTime(0);
              break;
          }
        } else if (event.type === 'complete') {
          // Stream completed, pass back session ID
          onComplete(client.getSessionId());
        }
      });

      // Run agent
      client.runAgent('orchestration', task).catch((err) => {
        onOutput({ type: 'error', content: err.message });
        onComplete(client.getSessionId());
      });
    });
  }, []);

  // Format thinking time for display
  const formatThinkingTime = (ms: number): string => {
    const seconds = Math.floor(ms / 1000);
    return `${seconds}s`;
  };

  // Show a spinner with optional thinking time
  return (
    <Box>
      <Text color="yellow">
        <Spinner type="dots" />
        {thinkingTime > 0 && <Text color="gray"> {formatThinkingTime(thinkingTime)}</Text>}
      </Text>
    </Box>
  );
}
