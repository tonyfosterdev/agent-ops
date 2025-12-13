/**
 * Test Server Utility
 *
 * Starts a Hono server on a random available port for testing.
 */

import { serve } from '@hono/node-server';
import { createApp } from '../../app.js';

export class TestServer {
  private server: ReturnType<typeof serve> | null = null;
  private port: number = 0;

  /**
   * Start the test server on a random available port
   */
  async start(): Promise<void> {
    const app = createApp();

    return new Promise((resolve, reject) => {
      // Start on port 0 to get a random available port
      this.server = serve({
        fetch: app.fetch,
        port: 0,
      });

      this.server.on('listening', () => {
        const address = this.server?.address();
        if (address && typeof address === 'object') {
          this.port = address.port;
        }
        resolve();
      });

      this.server.on('error', (err) => {
        reject(err);
      });
    });
  }

  /**
   * Stop the test server
   */
  async stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.server) {
        resolve();
        return;
      }

      this.server.close((err) => {
        if (err) {
          reject(err);
        } else {
          this.server = null;
          this.port = 0;
          resolve();
        }
      });
    });
  }

  /**
   * Get the base URL for the test server
   */
  getBaseUrl(): string {
    if (!this.port) {
      throw new Error('Server not started');
    }
    return `http://localhost:${this.port}`;
  }

  /**
   * Get the port the server is running on
   */
  getPort(): number {
    return this.port;
  }
}
