import { EventEmitter } from 'events';
import { loadCliConfig } from '../config.js';

export class AgentClient extends EventEmitter {
  private serverUrl: string;
  private username: string;
  private password: string;

  constructor() {
    super();
    const config = loadCliConfig();
    this.serverUrl = config.serverUrl;
    this.username = config.username;
    this.password = config.password;
  }

  /**
   * Run an agent and stream events via SSE
   */
  async runAgent(
    agentType: 'coding' | 'log-analyzer' | 'orchestration',
    task: string,
    options: { maxSteps?: number; model?: string } = {}
  ): Promise<void> {
    const url = `${this.serverUrl}/agents/${agentType}/run`;
    const auth = Buffer.from(`${this.username}:${this.password}`).toString('base64');

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${auth}`,
      },
      body: JSON.stringify({
        task,
        config: options,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = `Server error: ${response.statusText}`;

      try {
        const errorJson = JSON.parse(errorText);
        errorMessage = errorJson.error || errorJson.message || errorMessage;
      } catch {
        // Use default error message
      }

      throw new Error(errorMessage);
    }

    // Read SSE stream
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body');
    }

    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n').filter(line => line.trim());

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = line.replace('data: ', '');
              const event = JSON.parse(data);
              this.emit('event', event);
            } catch (e) {
              // Skip malformed events
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.serverUrl}/health`, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * List available agent types
   */
  async listAgents(): Promise<any> {
    const auth = Buffer.from(`${this.username}:${this.password}`).toString('base64');

    const response = await fetch(`${this.serverUrl}/agents/types`, {
      method: 'GET',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to list agents: ${response.statusText}`);
    }

    return await response.json();
  }
}
