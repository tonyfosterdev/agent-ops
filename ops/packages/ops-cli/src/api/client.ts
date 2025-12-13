import { EventEmitter } from 'events';
import { loadCliConfig } from '../config.js';

export interface RunInfo {
  runId: string;
  sessionId: string;
  subscribeUrl: string;
}

export interface Session {
  id: string;
  agentType: string;
  title?: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface SessionWithRuns {
  session: Session;
  runs: Array<{
    id: string;
    runNumber: number;
    task: string;
    status: string;
    startedAt: string;
    completedAt?: string;
  }>;
}

export class AgentClient extends EventEmitter {
  private serverUrl: string;
  private username: string;
  private password: string;
  private sessionId: string | null = null;

  constructor() {
    super();
    const config = loadCliConfig();
    this.serverUrl = config.serverUrl;
    this.username = config.username;
    this.password = config.password;
  }

  // Session management
  getSessionId(): string | null {
    return this.sessionId;
  }

  setSessionId(sessionId: string): void {
    this.sessionId = sessionId;
  }

  resetSession(): void {
    this.sessionId = null;
  }

  private getAuthHeader(): string {
    return `Basic ${Buffer.from(`${this.username}:${this.password}`).toString('base64')}`;
  }

  /**
   * Create a new session
   */
  async createSession(agentType: string, title?: string): Promise<string> {
    const response = await fetch(`${this.serverUrl}/sessions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: this.getAuthHeader(),
      },
      body: JSON.stringify({ agentType, title }),
    });

    if (!response.ok) {
      throw new Error(`Failed to create session: ${response.statusText}`);
    }

    const data = await response.json();
    this.sessionId = data.sessionId;
    return data.sessionId;
  }

  /**
   * Start a run and return info (does not wait for completion)
   */
  async startRun(
    agentType: 'coding' | 'log-analyzer' | 'orchestration',
    task: string,
    options: { maxSteps?: number; model?: string } = {}
  ): Promise<RunInfo> {
    const response = await fetch(`${this.serverUrl}/agents/${agentType}/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: this.getAuthHeader(),
      },
      body: JSON.stringify({
        task,
        sessionId: this.sessionId,
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

    const data = await response.json();
    this.sessionId = data.sessionId; // Update session ID
    return data;
  }

  /**
   * Subscribe to run updates via SSE
   */
  async subscribeToRun(runId: string): Promise<void> {
    const response = await fetch(`${this.serverUrl}/runs/${runId}/subscribe`, {
      method: 'GET',
      headers: {
        Authorization: this.getAuthHeader(),
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to subscribe: ${response.statusText}`);
    }

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
        const lines = chunk.split('\n').filter((line) => line.trim());

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.replace('data: ', ''));
              this.emit('event', data);

              if (data.type === 'complete') {
                return;
              }
            } catch {
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
   * Run an agent with two-phase execution (startRun + subscribeToRun)
   */
  async runAgent(
    agentType: 'coding' | 'log-analyzer' | 'orchestration',
    task: string,
    options: { maxSteps?: number; model?: string } = {}
  ): Promise<void> {
    const runInfo = await this.startRun(agentType, task, options);
    await this.subscribeToRun(runInfo.runId);
  }

  /**
   * List sessions with optional filters
   */
  async listSessions(filters?: { status?: string; agentType?: string }): Promise<Session[]> {
    const params = new URLSearchParams();
    if (filters?.status) params.set('status', filters.status);
    if (filters?.agentType) params.set('agentType', filters.agentType);

    const response = await fetch(`${this.serverUrl}/sessions?${params.toString()}`, {
      headers: { Authorization: this.getAuthHeader() },
    });

    if (!response.ok) {
      throw new Error(`Failed to list sessions: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Get session with runs
   */
  async getSession(sessionId: string): Promise<SessionWithRuns> {
    const response = await fetch(`${this.serverUrl}/sessions/${sessionId}`, {
      headers: { Authorization: this.getAuthHeader() },
    });

    if (!response.ok) {
      throw new Error(`Failed to get session: ${response.statusText}`);
    }

    return response.json();
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
