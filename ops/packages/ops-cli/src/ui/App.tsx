import React, { useState } from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import TextInput from 'ink-text-input';
import { AgentRunner } from './AgentRunner.js';

// Display item from agent run
interface OutputItem {
  type: 'task' | 'text' | 'text_chunk' | 'tool' | 'tool_starting' | 'complete' | 'error';
  content: string;
  success?: boolean;
}

// ASCII art banner for OPS Agent
function Banner() {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text>
        <Text color="magenta" bold>{'█▀█ █▀█ █▀▀ '}</Text>
        <Text color="yellow" bold>{'  █▀█ █▀▀ █▀▀ █▄ █ ▀█▀'}</Text>
      </Text>
      <Text>
        <Text color="magenta" bold>{'█▄█ █▀▀ ▄▄█ '}</Text>
        <Text color="yellow" bold>{'  █▀█ █ █ ██▀ █ ▀█  █ '}</Text>
      </Text>
      <Text color="gray">{'Autonomous Agent Operations System'}</Text>
    </Box>
  );
}

export function App() {
  const [task, setTask] = useState<string>('');
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [outputHistory, setOutputHistory] = useState<OutputItem[]>([]);
  const [currentRunKey, setCurrentRunKey] = useState<number>(0);
  // Accumulator for streaming text chunks
  const [streamingText, setStreamingText] = useState<string>('');
  // Session management
  const [sessionId, setSessionId] = useState<string | null>(null);

  const handleSubmit = () => {
    const trimmedTask = task.trim();

    if (!trimmedTask || isRunning) return;

    // Handle special commands
    if (trimmedTask === '/new') {
      setSessionId(null);
      setTask('');
      setOutputHistory((prev) => [
        ...prev,
        { type: 'text', content: 'Session reset. Next task starts a new session.' },
      ]);
      return;
    }

    if (trimmedTask === '/session') {
      setTask('');
      setOutputHistory((prev) => [
        ...prev,
        {
          type: 'text',
          content: sessionId ? `Current session: ${sessionId}` : 'No active session',
        },
      ]);
      return;
    }

    // Regular task - add to output and run
    setOutputHistory((prev) => [...prev, { type: 'task', content: trimmedTask }]);
    setIsRunning(true);
    setCurrentRunKey((prev) => prev + 1);
    setStreamingText('');
  };

  const handleAgentOutput = (item: OutputItem) => {
    if (item.type === 'text_chunk') {
      // Accumulate text chunks into streamingText
      setStreamingText(prev => prev + item.content);
    } else {
      // For non-chunk items, first flush any accumulated streaming text
      setStreamingText(prev => {
        if (prev.trim()) {
          // Add the accumulated text as a single text item
          setOutputHistory(history => [...history, { type: 'text', content: prev.trim() }]);
        }
        return '';
      });

      // For tool_starting, replace any existing tool_starting item
      if (item.type === 'tool_starting') {
        setOutputHistory(prev => {
          // Remove any existing tool_starting items
          const filtered = prev.filter(i => i.type !== 'tool_starting');
          return [...filtered, item];
        });
      } else if (item.type === 'tool') {
        // When tool completes, remove the tool_starting item
        setOutputHistory(prev => {
          const filtered = prev.filter(i => i.type !== 'tool_starting');
          return [...filtered, item];
        });
      } else {
        setOutputHistory(prev => [...prev, item]);
      }
    }
  };

  const handleAgentComplete = (newSessionId: string | null) => {
    // Update session ID from the completed run
    if (newSessionId) {
      setSessionId(newSessionId);
    }

    // Flush any remaining streaming text
    setStreamingText((prev) => {
      if (prev.trim()) {
        setOutputHistory((history) => [...history, { type: 'text', content: prev.trim() }]);
      }
      return '';
    });

    // Only add complete if we haven't already
    setOutputHistory((prev) => {
      const lastItem = prev[prev.length - 1];
      if (lastItem?.type === 'complete') {
        return prev; // Already have complete, don't add another
      }
      return [...prev, { type: 'complete', content: '' }];
    });
    setIsRunning(false);
    setTask('');
  };

  // Sanitize input to remove newlines and control characters
  const handleChange = (value: string) => {
    // Remove newlines and control characters that can corrupt the display
    const sanitized = value.replace(/[\r\n\x00-\x1F\x7F]/g, '');
    setTask(sanitized);
  };

  // Show banner only when no output yet
  const showBanner = outputHistory.length === 0;

  return (
    <Box flexDirection="column" padding={1}>
      {showBanner && <Banner />}

      {/* Output history */}
      {outputHistory.length > 0 && (
        <Box flexDirection="column" marginBottom={1}>
          {outputHistory.map((item, i) => (
            <OutputItemView key={i} item={item} />
          ))}
        </Box>
      )}

      {/* Streaming text (live as it arrives) */}
      {streamingText && (
        <Box marginLeft={2} marginBottom={1}>
          <Text>{streamingText}</Text>
        </Box>
      )}

      {/* Active agent runner (hidden, just for processing) */}
      {isRunning && (
        <AgentRunner
          key={currentRunKey}
          task={outputHistory.filter((o) => o.type === 'task').pop()?.content || ''}
          sessionId={sessionId}
          onOutput={handleAgentOutput}
          onComplete={handleAgentComplete}
        />
      )}

      {/* Input area */}
      <Box flexDirection="column" borderStyle="round" borderColor={isRunning ? "gray" : "green"} padding={1}>
        <Text bold color={isRunning ? "gray" : "green"}>
          {isRunning ? "Running..." : "Enter your task:"}
        </Text>
        <Box marginTop={1}>
          <Text color={isRunning ? "gray" : "yellow"}>❯ </Text>
          {isRunning ? (
            <Text color="gray">{task}</Text>
          ) : (
            <TextInput
              value={task}
              onChange={handleChange}
              onSubmit={handleSubmit}
            />
          )}
        </Box>
      </Box>
      {!isRunning && (
        <Box marginTop={1}>
          <Text color="gray">Press Enter to start</Text>
        </Box>
      )}
    </Box>
  );
}

function OutputItemView({ item }: { item: OutputItem }) {
  switch (item.type) {
    case 'task':
      return (
        <Box marginBottom={1}>
          <Text color="cyan" bold>❯ {item.content}</Text>
        </Box>
      );
    case 'text':
      return (
        <Box marginLeft={2}>
          <Text>{item.content}</Text>
        </Box>
      );
    case 'tool_starting':
      return (
        <Box marginLeft={2}>
          <Text color="yellow">
            <Spinner type="dots" /> {item.content}...
          </Text>
        </Box>
      );
    case 'tool':
      const icon = item.success ? '✓' : '✗';
      const color = item.success ? 'green' : 'red';
      return (
        <Box marginLeft={2}>
          <Text color={color}>{icon} {item.content}</Text>
        </Box>
      );
    case 'complete':
      return (
        <Box marginTop={1} marginBottom={1}>
          <Text color="green">✓ Complete</Text>
        </Box>
      );
    case 'error':
      return (
        <Box marginTop={1} marginBottom={1}>
          <Text color="red">✗ Error: {item.content}</Text>
        </Box>
      );
    default:
      return null;
  }
}
