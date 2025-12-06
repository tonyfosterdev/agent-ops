/**
 * File search and code search tools for the coding agent
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { glob } from 'glob';
import { z } from 'zod';
import { tool } from 'ai';

/**
 * Default directories/patterns to exclude from searches
 */
const DEFAULT_IGNORE = [
  '**/node_modules/**',
  '**/dist/**',
  '**/.git/**',
  '**/build/**',
  '**/coverage/**',
  '**/.next/**',
  '**/.cache/**',
];

/**
 * Schema for find_files tool
 */
export const findFilesSchema = z.object({
  pattern: z
    .string()
    .describe(
      'File name pattern to search for (e.g., "bookService", "*.ts", "service*.ts", "bookService.js")'
    ),
  directory: z
    .string()
    .optional()
    .describe('Directory to search in (default: working directory)'),
});

/**
 * Schema for search_code tool
 */
export const searchCodeSchema = z.object({
  query: z.string().describe('Text or regex pattern to search for in file contents'),
  filePattern: z
    .string()
    .optional()
    .describe('File pattern to search in (e.g., "*.ts", "*.js") - default: all files'),
  directory: z
    .string()
    .optional()
    .describe('Directory to search in (default: working directory)'),
});

interface SearchResult {
  file: string;
  line: number;
  content: string;
}

/**
 * Find files matching a pattern
 */
async function findFiles(
  pattern: string,
  workDir: string,
  directory?: string
): Promise<string[]> {
  const searchDir = directory ? join(workDir, directory) : workDir;

  // Build glob patterns
  const patterns: string[] = [];

  if (pattern.includes('*')) {
    // User provided a glob pattern
    patterns.push(`**/${pattern}`);
  } else if (pattern.includes('.')) {
    // User provided a filename with extension
    patterns.push(`**/${pattern}`);
    patterns.push(`**/*${pattern}*`);
  } else {
    // User provided a partial name - search flexibly
    patterns.push(`**/*${pattern}*`);
  }

  // If searching for .js, also search for .ts
  const additionalPatterns: string[] = [];
  for (const p of patterns) {
    if (p.endsWith('.js') || p.includes('.js*')) {
      additionalPatterns.push(p.replace(/\.js/g, '.ts'));
    }
  }
  patterns.push(...additionalPatterns);

  // Execute glob search
  const results = await glob(patterns, {
    cwd: searchDir,
    ignore: DEFAULT_IGNORE,
    nodir: true,
    absolute: false,
  });

  // Return unique results with full paths relative to workDir
  const uniqueResults = [...new Set(results)];
  return directory
    ? uniqueResults.map((f) => join(directory, f))
    : uniqueResults;
}

/**
 * Search for text in files
 */
async function searchCode(
  query: string,
  workDir: string,
  filePattern?: string,
  directory?: string
): Promise<SearchResult[]> {
  const searchDir = directory ? join(workDir, directory) : workDir;

  // Find files to search
  const globPattern = filePattern ? `**/${filePattern}` : '**/*';
  const files = await glob(globPattern, {
    cwd: searchDir,
    ignore: DEFAULT_IGNORE,
    nodir: true,
    absolute: true,
  });

  const results: SearchResult[] = [];
  const regex = new RegExp(query, 'gi');

  for (const file of files) {
    try {
      const content = readFileSync(file, 'utf-8');
      const lines = content.split('\n');

      lines.forEach((line, idx) => {
        // Reset regex lastIndex for global regex
        regex.lastIndex = 0;
        if (regex.test(line)) {
          // Get relative path from workDir
          const relativePath = file.replace(workDir + '/', '');
          results.push({
            file: relativePath,
            line: idx + 1,
            content: line.trim().substring(0, 200), // Limit line length
          });
        }
      });
    } catch {
      // Skip files that can't be read (binary, permissions, etc.)
    }

    // Limit total results to prevent overwhelming output
    if (results.length >= 50) {
      break;
    }
  }

  return results;
}

/**
 * Create the find_files tool for Vercel AI SDK
 */
export function createFindFilesTool(workDir: string) {
  return tool({
    description:
      'Find files by name pattern. Automatically excludes node_modules, dist, .git. If searching for a .js file, also searches for .ts equivalent.',
    parameters: findFilesSchema,
    execute: async ({ pattern, directory }) => {
      try {
        const files = await findFiles(pattern, workDir, directory);

        return {
          success: true,
          pattern,
          directory: directory || '.',
          count: files.length,
          files: files.slice(0, 20), // Limit to 20 results
          ...(files.length > 20 && {
            note: `Showing first 20 of ${files.length} results`,
          }),
        };
      } catch (error: any) {
        return {
          success: false,
          error: error.message,
          pattern,
          count: 0,
          files: [],
        };
      }
    },
  });
}

/**
 * Create the search_code tool for Vercel AI SDK
 */
export function createSearchCodeTool(workDir: string) {
  return tool({
    description:
      'Search for text or regex pattern in code files. Automatically excludes node_modules, dist, .git. Returns file path, line number, and matching line content.',
    parameters: searchCodeSchema,
    execute: async ({ query, filePattern, directory }) => {
      try {
        const results = await searchCode(query, workDir, filePattern, directory);

        return {
          success: true,
          query,
          filePattern: filePattern || '*',
          directory: directory || '.',
          count: results.length,
          results: results.slice(0, 20), // Limit to 20 results
          ...(results.length > 20 && {
            note: `Showing first 20 of ${results.length} results`,
          }),
        };
      } catch (error: any) {
        return {
          success: false,
          error: error.message,
          query,
          count: 0,
          results: [],
        };
      }
    },
  });
}
