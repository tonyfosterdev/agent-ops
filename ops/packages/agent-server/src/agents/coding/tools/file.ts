import { readFileSync, writeFileSync, existsSync } from 'fs';
import { z } from 'zod';
import { tool } from 'ai';

/**
 * Schema for file reading tool
 */
export const readFileSchema = z.object({
  path: z.string().describe('The file path to read'),
});

/**
 * Create the file reading tool for Vercel AI SDK
 */
export function createReadFileTool(workDir: string) {
  return tool({
    description:
      'Read the contents of a file. ALWAYS use this to read a file before modifying it with write_file.',
    parameters: readFileSchema,
    execute: async ({ path }) => {
      try {
        const safePath = path.startsWith('/') ? path : `${workDir}/${path}`;

        if (!existsSync(safePath)) {
          return {
            success: false,
            message: `File not found: ${safePath}`,
            error: 'File does not exist',
          };
        }

        const content = readFileSync(safePath, 'utf-8');

        return {
          success: true,
          content,
          path: safePath,
          lines: content.split('\n').length,
        };
      } catch (error: any) {
        return {
          success: false,
          message: `Failed to read file: ${error.message}`,
          error: error.message,
        };
      }
    },
  });
}

/**
 * Schema for file writing tool
 */
export const writeFileSchema = z.object({
  path: z.string().describe('The file path to write to'),
  content: z.string().describe('The COMPLETE content to write to the file'),
});

/**
 * Create the file writing tool for Vercel AI SDK
 */
export function createWriteFileTool(workDir: string) {
  return tool({
    description:
      'Write content to a file. WARNING: This OVERWRITES the entire file. You MUST use read_file first to get the current content, then include ALL the original content with your changes.',
    parameters: writeFileSchema,
    execute: async ({ path, content }) => {
      try {
        // Ensure path is relative and within work directory
        const safePath = path.startsWith('/') ? path : `${workDir}/${path}`;

        const existed = existsSync(safePath);
        writeFileSync(safePath, content, 'utf-8');

        return {
          success: true,
          message: existed
            ? `Successfully updated ${path} (${content.length} characters)`
            : `Created new file ${path} (${content.length} characters)`,
          path: safePath,
          wasNewFile: !existed,
        };
      } catch (error: any) {
        return {
          success: false,
          message: `Failed to write file: ${error.message}`,
          error: error.message,
        };
      }
    },
  });
}
