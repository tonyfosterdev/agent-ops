/**
 * Docker service management tools for DurableLoop
 *
 * Provides ability to restart Docker services after code changes.
 * Marked as DANGEROUS (requires HITL approval).
 */

import { z } from 'zod';
import { tool } from 'ai';
import { spawn } from 'child_process';
import { config } from '../../../config';

// Available services that can be restarted (app services only, no DBs or infra)
const RESTARTABLE_SERVICES = [
  'store-api',
  'warehouse-alpha',
  'warehouse-beta',
  'bookstore-ui',
] as const;

export const restartServiceSchema = z.object({
  service: z.enum(RESTARTABLE_SERVICES).describe('Service name to restart'),
  rebuild: z
    .boolean()
    .optional()
    .default(true)
    .describe('Rebuild the container before restarting. Set to false only for quick restart without code changes.'),
});

/**
 * Execute docker compose command and return output
 */
async function execDockerCompose(
  workDir: string,
  args: string[]
): Promise<{ success: boolean; output: string; error?: string }> {
  return new Promise((resolve) => {
    const proc = spawn('docker', ['compose', '-p', config.composeProjectName, ...args], {
      cwd: workDir,
      shell: false,
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve({
          success: true,
          output: stdout || stderr, // docker compose often writes to stderr
        });
      } else {
        resolve({
          success: false,
          output: stdout,
          error: stderr || `Process exited with code ${code}`,
        });
      }
    });

    proc.on('error', (err) => {
      resolve({
        success: false,
        output: '',
        error: err.message,
      });
    });
  });
}

/**
 * Create the restart_service tool
 */
export function createRestartServiceTool(workDir: string) {
  return tool({
    description:
      'Restart a Docker service. Rebuilds by default. Use rebuild=false only for quick restart without code changes. Returns docker compose output for verification.',
    parameters: restartServiceSchema,
    execute: async ({ service, rebuild }) => {
      const projectName = config.composeProjectName;
      const command = rebuild
        ? `docker compose -p ${projectName} up -d --build --force-recreate --no-deps ${service}`
        : `docker compose -p ${projectName} restart ${service}`;

      const args = rebuild
        ? ['up', '-d', '--build', '--force-recreate', '--no-deps', service]
        : ['restart', service];

      const result = await execDockerCompose(workDir, args);

      return {
        success: result.success,
        service,
        rebuild,
        command,
        output: result.output,
        ...(result.error && { error: result.error }),
      };
    },
  });
}
