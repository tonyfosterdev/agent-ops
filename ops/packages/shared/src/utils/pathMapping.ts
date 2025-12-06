/**
 * Path mapping utilities for Docker-to-local path translation
 */

export interface PathMappingConfig {
  dockerWorkspace: string;
  localWorkspace: string;
}

/**
 * Translate Docker paths to local paths in a string
 *
 * Handles:
 * - /workspace → local working directory
 * - /dist/ → /src/ (compiled JS to source TS)
 * - .js → .ts (for TypeScript projects)
 *
 * @param text - Text containing Docker paths (e.g., stack traces, file references)
 * @param config - Path mapping configuration
 * @returns Text with paths translated to local equivalents
 */
export function translateDockerPaths(text: string, config: PathMappingConfig): string {
  let result = text;

  // Replace Docker workspace with local workspace
  result = result.replaceAll(config.dockerWorkspace, config.localWorkspace);

  // Replace dist with src (compiled → source)
  result = result.replaceAll('/dist/', '/src/');

  // Replace .js with .ts for TypeScript source files
  // Handle common patterns: filename.js:line, filename.js (context), filename.js)
  result = result.replaceAll('.js:', '.ts:');
  result = result.replaceAll('.js (', '.ts (');
  result = result.replaceAll('.js)', '.ts)');

  return result;
}
