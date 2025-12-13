/**
 * Test HTTP Client
 *
 * Provides typed methods for interacting with the agent server API.
 */

export interface SessionResponse {
  sessionId: string;
  runUrl: string;
}

export interface Session {
  id: string;
  agentType: string;
  title?: string;
  status: 'active' | 'archived';
  createdAt: string;
  updatedAt: string;
}

export interface Run {
  id: string;
  sessionId: string;
  runNumber: number;
  agentType: string;
  task: string;
  status: 'running' | 'completed' | 'failed';
  config?: Record<string, unknown>;
  result?: Record<string, unknown>;
  contextSummary?: string;
  startedAt: string;
  completedAt?: string;
  createdAt: string;
}

export interface JournalEntry {
  id: string;
  entryType: string;
  stepNumber?: number;
  data: Record<string, unknown>;
  createdAt: string;
}

export interface SessionWithRuns {
  session: Session;
  runs: Run[];
}

export interface RunWithEntries {
  run: Run;
  entries: JournalEntry[];
}

export interface RunStartResponse {
  runId: string;
  subscribeUrl: string;
}

export interface AgentRunResponse {
  runId: string;
  sessionId: string;
  subscribeUrl: string;
}

export interface SessionFilters {
  status?: 'active' | 'archived';
  agentType?: string;
  limit?: number;
  offset?: number;
}

export interface RunConfig {
  maxSteps?: number;
  model?: string;
}

export class TestClient {
  private baseUrl: string;
  private authHeader: string;

  constructor(baseUrl: string, auth: { username: string; password: string }) {
    this.baseUrl = baseUrl;
    this.authHeader = 'Basic ' + Buffer.from(`${auth.username}:${auth.password}`).toString('base64');
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    skipAuth = false
  ): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (!skipAuth) {
      headers['Authorization'] = this.authHeader;
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorBody}`);
    }

    return response.json() as Promise<T>;
  }

  // ==================== Health ====================

  async healthCheck(): Promise<{ status: string; service: string; timestamp: string }> {
    return this.request('GET', '/health', undefined, true);
  }

  // ==================== Sessions ====================

  async createSession(agentType: string, title?: string): Promise<SessionResponse> {
    return this.request('POST', '/sessions', { agentType, title });
  }

  async getSession(sessionId: string): Promise<SessionWithRuns> {
    return this.request('GET', `/sessions/${sessionId}`);
  }

  async listSessions(filters?: SessionFilters): Promise<Session[]> {
    const params = new URLSearchParams();
    if (filters?.status) params.set('status', filters.status);
    if (filters?.agentType) params.set('agentType', filters.agentType);
    if (filters?.limit) params.set('limit', filters.limit.toString());
    if (filters?.offset) params.set('offset', filters.offset.toString());

    const query = params.toString();
    const path = query ? `/sessions?${query}` : '/sessions';
    return this.request('GET', path);
  }

  async archiveSession(sessionId: string): Promise<{ success: boolean }> {
    return this.request('POST', `/sessions/${sessionId}/archive`);
  }

  // ==================== Runs ====================

  async startRun(sessionId: string, task: string, config?: RunConfig): Promise<RunStartResponse> {
    return this.request('POST', `/sessions/${sessionId}/runs`, { task, config });
  }

  async getRun(runId: string): Promise<RunWithEntries> {
    return this.request('GET', `/runs/${runId}`);
  }

  // ==================== Agents ====================

  async runAgent(
    agentType: string,
    task: string,
    sessionId?: string,
    config?: RunConfig
  ): Promise<AgentRunResponse> {
    return this.request('POST', `/agents/${agentType}/run`, { task, sessionId, config });
  }

  async getAgentTypes(): Promise<{ type: string; description: string }[]> {
    return this.request('GET', '/agents/types');
  }

  // ==================== Generic Methods ====================

  async get<T = any>(path: string): Promise<T> {
    return this.request('GET', path);
  }

  async post<T = any>(path: string, body?: unknown): Promise<T> {
    return this.request('POST', path, body);
  }
}
