/**
 * Stack trace parsing utilities for error analysis
 */

import { translateDockerPaths, type PathMappingConfig } from './pathMapping';

/**
 * A single frame in a stack trace
 */
export interface StackFrame {
  function?: string;
  file: string;
  line: number;
  column?: number;
  isUserCode: boolean;
}

/**
 * Parsed stack trace with categorized frames
 */
export interface ParsedStackTrace {
  message: string;
  frames: StackFrame[];
  userCodeFrames: StackFrame[];
  primaryErrorLocation?: StackFrame;
}

/**
 * Check if a file path represents user code (not framework/library code)
 */
function isUserCode(filePath: string): boolean {
  return (
    !filePath.includes('node_modules/') &&
    !filePath.startsWith('node:') &&
    !filePath.includes('/internal/')
  );
}

/**
 * Parse a single stack frame line
 *
 * Handles formats:
 * - "at FunctionName (/path/to/file.js:line:col)"
 * - "at /path/to/file.js:line:col"
 * - "at async FunctionName (/path/to/file.js:line:col)"
 */
function parseStackFrame(line: string, pathConfig: PathMappingConfig): StackFrame | null {
  // Match: "at [async] [FunctionName] [(]/path/file:line:col[)]"
  const frameRegex = /at\s+(?:async\s+)?(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?$/;
  const match = line.trim().match(frameRegex);

  if (!match) {
    return null;
  }

  const [, functionName, rawFile, lineStr, colStr] = match;
  const isUser = isUserCode(rawFile);

  // Translate paths for user code
  const file = isUser ? translateDockerPaths(rawFile, pathConfig) : rawFile;

  return {
    function: functionName || undefined,
    file,
    line: parseInt(lineStr, 10),
    column: parseInt(colStr, 10),
    isUserCode: isUser,
  };
}

/**
 * Parse a full stack trace string into structured data
 *
 * @param stack - The stack trace string (from error.stack)
 * @param pathConfig - Path mapping configuration for Docker-to-local translation
 * @returns Parsed stack trace with categorized frames
 */
export function parseStackTrace(
  stack: string,
  pathConfig: PathMappingConfig
): ParsedStackTrace {
  const lines = stack.split('\n');

  // First line is usually the error message
  const message = lines[0] || '';

  // Parse all frames
  const frames: StackFrame[] = [];
  for (const line of lines.slice(1)) {
    const frame = parseStackFrame(line, pathConfig);
    if (frame) {
      frames.push(frame);
    }
  }

  // Extract user code frames only
  const userCodeFrames = frames.filter((f) => f.isUserCode);

  // Primary error location is the first user code frame
  const primaryErrorLocation = userCodeFrames[0];

  return {
    message,
    frames,
    userCodeFrames,
    primaryErrorLocation,
  };
}
