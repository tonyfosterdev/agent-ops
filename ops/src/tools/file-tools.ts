/**
 * File operation tools for AgentKit.
 *
 * These are standard tools that do not require human approval since
 * they only read files and do not modify the system. All operations
 * are wrapped in step.run() for durability and crash recovery.
 */
import { createTool } from '@inngest/agent-kit';
import { z } from 'zod';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { glob } from 'node:fs/promises';

/**
 * Default workspace root directory.
 * Uses WORK_DIR environment variable (set in docker-compose.yaml) with /workspace fallback.
 * This matches the pattern in security.ts for consistency.
 */
const WORKSPACE_ROOT = process.env.WORK_DIR || '/workspace';

/**
 * Read the contents of a file at the given path.
 *
 * Returns the file content as a string, or an error object
 * if the file cannot be read. Wrapped in step.run() for durability.
 */
export const readFileTool = createTool({
  name: 'read_file',
  description:
    'Read the contents of a file. Returns the file content as text.',
  parameters: z.object({
    path: z.string().describe('Absolute path to the file to read'),
  }),
  handler: async ({ path: filePath }, { step }) => {
    // Ensure step is available (it should always be in agent-kit context)
    if (!step) {
      try {
        // Fallback: execute directly without step wrapper
        // Resolve relative paths against WORKSPACE_ROOT for consistency
        const absolutePath = path.isAbsolute(filePath)
          ? filePath
          : path.resolve(WORKSPACE_ROOT, filePath);

        const stats = await fs.stat(absolutePath);
        if (stats.isDirectory()) {
          return {
            error: 'Path is a directory, not a file',
            path: absolutePath,
          };
        }

        const content = await fs.readFile(absolutePath, 'utf-8');
        return {
          success: true,
          path: absolutePath,
          content,
          size: stats.size,
        };
      } catch (err) {
        const error = err as NodeJS.ErrnoException;
        if (error.code === 'ENOENT') {
          return { error: 'File not found', path: filePath };
        }
        if (error.code === 'EACCES') {
          return { error: 'Permission denied', path: filePath };
        }
        return { error: `Failed to read file: ${error.message}`, path: filePath };
      }
    }

    return step.run('read-file', async () => {
      try {
        // Ensure we're dealing with an absolute path
        // Resolve relative paths against WORKSPACE_ROOT for consistency
        const absolutePath = path.isAbsolute(filePath)
          ? filePath
          : path.resolve(WORKSPACE_ROOT, filePath);

        const stats = await fs.stat(absolutePath);
        if (stats.isDirectory()) {
          return {
            error: 'Path is a directory, not a file',
            path: absolutePath,
          };
        }

        const content = await fs.readFile(absolutePath, 'utf-8');
        return {
          success: true,
          path: absolutePath,
          content,
          size: stats.size,
        };
      } catch (err) {
        const error = err as NodeJS.ErrnoException;
        if (error.code === 'ENOENT') {
          return { error: 'File not found', path: filePath };
        }
        if (error.code === 'EACCES') {
          return { error: 'Permission denied', path: filePath };
        }
        return { error: `Failed to read file: ${error.message}`, path: filePath };
      }
    });
  },
});

/**
 * Find files matching a glob pattern.
 *
 * Uses Node.js built-in glob functionality (Node 22+) to find files
 * matching the specified pattern. Wrapped in step.run() for durability.
 */
export const findFilesTool = createTool({
  name: 'find_files',
  description:
    'Find files matching a glob pattern. Returns a list of matching file paths.',
  parameters: z.object({
    pattern: z
      .string()
      .describe('Glob pattern to match files (e.g., "**/*.ts", "src/**/*.js")'),
    cwd: z
      .string()
      .optional()
      .describe('Base directory to search from (defaults to WORK_DIR, typically /workspace)'),
    maxResults: z
      .number()
      .optional()
      .default(100)
      .describe('Maximum number of results to return (default: 100)'),
  }),
  handler: async ({ pattern, cwd, maxResults }, { step }) => {
    const findFilesLogic = async () => {
      try {
        const baseDir = cwd
          ? path.isAbsolute(cwd)
            ? cwd
            : path.resolve(WORKSPACE_ROOT, cwd)
          : WORKSPACE_ROOT;

        // Verify base directory exists
        try {
          const stats = await fs.stat(baseDir);
          if (!stats.isDirectory()) {
            return { error: 'cwd is not a directory', cwd: baseDir };
          }
        } catch {
          return { error: 'Base directory does not exist', cwd: baseDir };
        }

        const matches: string[] = [];
        const limit = maxResults ?? 100;

        // Use Node.js built-in glob (Node 22+)
        for await (const entry of glob(pattern, { cwd: baseDir })) {
          if (matches.length >= limit) break;
          // Return absolute paths for consistency
          matches.push(path.join(baseDir, entry));
        }

        return {
          success: true,
          pattern,
          cwd: baseDir,
          count: matches.length,
          truncated: matches.length >= limit,
          files: matches,
        };
      } catch (err) {
        const error = err as Error;
        return {
          error: `Failed to find files: ${error.message}`,
          pattern,
        };
      }
    };

    // Ensure step is available (it should always be in agent-kit context)
    if (!step) {
      return findFilesLogic();
    }

    return step.run('find-files', findFilesLogic);
  },
});

/**
 * Search for text or regex pattern in files.
 *
 * Searches file contents for matches, similar to grep.
 * Returns matching lines with context. Wrapped in step.run() for durability.
 */
export const searchCodeTool = createTool({
  name: 'search_code',
  description:
    'Search for text or regex pattern in files. Returns matching lines with file paths and line numbers.',
  parameters: z.object({
    pattern: z.string().describe('Text or regex pattern to search for'),
    glob: z
      .string()
      .optional()
      .default('**/*')
      .describe('Glob pattern to filter which files to search (default: "**/*")'),
    cwd: z
      .string()
      .optional()
      .describe('Base directory to search from (defaults to WORK_DIR, typically /workspace)'),
    isRegex: z
      .boolean()
      .optional()
      .default(false)
      .describe('Whether to treat pattern as a regex (default: false)'),
    ignoreCase: z
      .boolean()
      .optional()
      .default(false)
      .describe('Whether to ignore case when matching (default: false)'),
    maxResults: z
      .number()
      .optional()
      .default(50)
      .describe('Maximum number of matching lines to return (default: 50)'),
    contextLines: z
      .number()
      .optional()
      .default(0)
      .describe('Number of context lines to include before and after matches (default: 0)'),
  }),
  handler: async (
    { pattern, glob: globPattern, cwd, isRegex, ignoreCase, maxResults, contextLines },
    { step }
  ) => {
    const searchCodeLogic = async () => {
      try {
        const baseDir = cwd
          ? path.isAbsolute(cwd)
            ? cwd
            : path.resolve(WORKSPACE_ROOT, cwd)
          : WORKSPACE_ROOT;

        // Build the regex for searching
        let searchRegex: RegExp;
        try {
          const flags = ignoreCase ? 'gi' : 'g';
          searchRegex = isRegex
            ? new RegExp(pattern, flags)
            : new RegExp(escapeRegex(pattern), flags);
        } catch (err) {
          return { error: `Invalid regex pattern: ${(err as Error).message}` };
        }

        const results: Array<{
          file: string;
          line: number;
          content: string;
          context?: { before: string[]; after: string[] };
        }> = [];
        const limit = maxResults ?? 50;
        const ctx = contextLines ?? 0;

        // Find files matching the glob pattern
        const filesToSearch: string[] = [];
        for await (const entry of glob(globPattern ?? '**/*', { cwd: baseDir })) {
          filesToSearch.push(path.join(baseDir, entry));
        }

        // Search each file
        for (const filePath of filesToSearch) {
          if (results.length >= limit) break;

          try {
            const stats = await fs.stat(filePath);
            if (!stats.isFile()) continue;

            // Skip binary files (simple heuristic: skip if file is large or has null bytes early)
            if (stats.size > 1024 * 1024) continue; // Skip files > 1MB

            const content = await fs.readFile(filePath, 'utf-8');

            // Check for binary content (null bytes in first 8KB)
            if (content.slice(0, 8192).includes('\0')) continue;

            const lines = content.split('\n');

            for (let i = 0; i < lines.length && results.length < limit; i++) {
              const line = lines[i];
              // Reset regex state for each line
              searchRegex.lastIndex = 0;

              if (searchRegex.test(line)) {
                const match: {
                  file: string;
                  line: number;
                  content: string;
                  context?: { before: string[]; after: string[] };
                } = {
                  file: filePath,
                  line: i + 1, // 1-indexed line numbers
                  content: line,
                };

                // Add context lines if requested
                if (ctx > 0) {
                  match.context = {
                    before: lines.slice(Math.max(0, i - ctx), i),
                    after: lines.slice(i + 1, i + 1 + ctx),
                  };
                }

                results.push(match);
              }
            }
          } catch {
            // Skip files that can't be read (permission issues, etc.)
            continue;
          }
        }

        return {
          success: true,
          pattern,
          cwd: baseDir,
          matchCount: results.length,
          truncated: results.length >= limit,
          matches: results,
        };
      } catch (err) {
        const error = err as Error;
        return {
          error: `Failed to search files: ${error.message}`,
          pattern,
        };
      }
    };

    // Ensure step is available (it should always be in agent-kit context)
    if (!step) {
      return searchCodeLogic();
    }

    return step.run('search-code', searchCodeLogic);
  },
});

/**
 * Escape special regex characters in a string.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * All file operation tools as an array for convenient registration.
 */
export const fileTools = [readFileTool, findFilesTool, searchCodeTool];
