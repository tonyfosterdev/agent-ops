import React, { useEffect, useRef } from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import { AgentClient } from '../api/client.js';

interface OutputItem {
  type: 'task' | 'text' | 'text_chunk' | 'tool' | 'tool_starting' | 'complete' | 'error';
  content: string;
  success?: boolean;
}

interface Props {
  task: string;
  onOutput: (item: OutputItem) => void;
  onComplete: () => void;
}

interface Event {
  type: string;
  [key: string]: any;
}

export function AgentRunner({ task, onOutput, onComplete }: Props) {
  const hasStarted = useRef(false);

  useEffect(() => {
    // Prevent double execution
    if (hasStarted.current) return;
    hasStarted.current = true;

    const client = new AgentClient();

    // Health check first
    client.healthCheck().then(healthy => {
      if (!healthy) {
        onOutput({ type: 'error', content: 'Agent server is unreachable. Please ensure it is running.' });
        onComplete();
        return;
      }

      // Subscribe to events
      client.on('event', (event: Event) => {
        switch (event.type) {
          // Real-time text streaming
          case 'step:text_chunk':
            if (event.chunk) {
              onOutput({ type: 'text_chunk', content: event.chunk });
            }
            break;

          // Full text for step (backup if chunks weren't received)
          case 'step:text_complete':
            // We don't need to do anything here since we already streamed the text
            // This is just a marker that the text for this step is complete
            break;

          // Tool is starting to be called (early notification)
          case 'step:tool_call_streaming_start':
            onOutput({
              type: 'tool_starting',
              content: event.toolName,
            });
            break;

          // Tool execution completed
          case 'step:tool_call_complete':
            onOutput({
              type: 'tool',
              content: event.summary || event.toolName,
              success: event.success,
            });
            break;

          case 'agent:complete':
            onComplete();
            break;

          case 'agent:error':
            onOutput({ type: 'error', content: event.error || 'Unknown error' });
            onComplete();
            break;
        }
      });

      // Run agent
      client.runAgent('orchestration', task).catch(err => {
        onOutput({ type: 'error', content: err.message });
        onComplete();
      });
    });
  }, []);

  // Show a spinner while running
  return (
    <Box>
      <Text color="yellow">
        <Spinner type="dots" />
      </Text>
    </Box>
  );
}
